import { app, BrowserWindow, ipcMain, dialog, shell, powerMonitor, clipboard, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { store, dataDir } from './store'
import { vault, VaultFile } from './vault'
import { sessions } from './sessions'
import * as sftp from './sftp'
import { setWindow, respond, send } from './ui'
import { scanPutty, scanSshConfig, scanPuttyHostKeys } from './importers'
import { listSerialPorts } from './transports/serial'
import { listShells } from './transports/local'
import { scanAws } from './aws'
import { cachedBanners, refreshBanners } from './ads'
import type { AdhocTarget, CredentialInput, Group, Host, ImportCandidate, StoreData } from '@shared/types'

let win: BrowserWindow | null = null

// 테스트·개발: 데이터 폴더를 따로 주면 Chromium 프로필도 분리해 실행 중인 앱과 별개 인스턴스로 뜬다
if (process.env.BRIGHTTERM_DATA) app.setPath('userData', join(process.env.BRIGHTTERM_DATA, 'userdata'))

// Single instance – second launch focuses the existing window
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

function createWindow(): void {
  const dark = store.get().settings.theme !== 'light'
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: dark ? '#0f1115' : '#f5f6f8',
    title: 'BrightTerm',
    icon: join(__dirname, '../../resources/icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: dark ? '#0f1115' : '#f5f6f8', symbolColor: dark ? '#c9d1d9' : '#334155', height: 38 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })
  setWindow(win)
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.on('close', (e) => {
    const open = [...sessions.sessions.values()].filter((s) => s.info.state === 'connected').length
    if (open > 0 && !(win as BrowserWindow & { _forceClose?: boolean })._forceClose) {
      const r = dialog.showMessageBoxSync(win!, {
        type: 'question',
        buttons: ['종료', '취소'],
        defaultId: 1,
        cancelId: 1,
        title: 'BrightTerm',
        message: `연결된 세션 ${open}개가 있습니다. 모두 닫고 종료할까요?`
      })
      if (r !== 0) e.preventDefault()
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function handle<T extends unknown[], R>(ch: string, fn: (...a: T) => R | Promise<R>): void {
  ipcMain.handle(ch, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...(args as T)) }
    } catch (err) {
      return { ok: false, error: (err as Error).message || String(err) }
    }
  })
}

function registerIpc(): void {
  // store
  handle('store:get', () => store.get())
  handle('store:patch', (p: Partial<StoreData>) => store.patch(p))

  // vault
  handle('vault:status', () => vault.status())
  handle('vault:setup', (pw: string) => vault.setup(pw))
  handle('vault:unlock', (pw: string) => vault.unlock(pw))
  handle('vault:unlockOs', () => vault.tryOsUnlock(win))
  handle('vault:recover', (code: string, pw: string) => vault.resetWithRecovery(code, pw))
  handle('vault:lock', () => vault.lock())
  handle('vault:changePassword', (a: string, b: string) => vault.changePassword(a, b))
  handle('vault:setOsUnlock', (en: boolean) => vault.setOsUnlock(en))
  handle('cred:list', () => vault.list())
  handle('cred:get', (id: string) => vault.get(id))
  handle('cred:save', (c: CredentialInput) => vault.save_(c))
  handle('cred:delete', (id: string) => vault.remove(id))

  // sessions
  handle('session:open', (o: { hostId?: string; adhoc?: AdhocTarget; cols?: number; rows?: number }) => sessions.open(o))
  handle('session:close', (id: string) => {
    sessions.close(id)
    sftp.forgetSession(id)
  })
  handle('session:reconnect', (id: string) => sessions.get(id)?.reconnectNow())
  ipcMain.on('session:write', (_e, id: string, data: string) => sessions.get(id)?.write(data))
  ipcMain.on('session:resize', (_e, id: string, cols: number, rows: number) => sessions.get(id)?.setSize(cols, rows))
  ipcMain.on('ui:respond', (_e, reqId: string, value: unknown) => respond(reqId, value))

  // sftp
  handle('sftp:home', (id: string) => sftp.home(id))
  handle('sftp:list', (id: string, path: string) => sftp.list(id, path))
  handle('sftp:mkdir', (id: string, path: string) => sftp.mkdir(id, path))
  handle('sftp:rename', (id: string, a: string, b: string) => sftp.rename(id, a, b))
  handle('sftp:remove', (id: string, paths: string[]) => sftp.remove(id, paths))
  handle('sftp:chmod', (id: string, path: string, mode: number) => sftp.chmod(id, path, mode))
  handle('sftp:upload', (id: string, locals: string[], dir: string) => sftp.upload(id, locals, dir))
  handle('sftp:uploadPick', async (id: string, dir: string) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] })
    if (r.canceled || !r.filePaths.length) return []
    return sftp.upload(id, r.filePaths, dir)
  })
  handle('sftp:download', async (id: string, remotes: string[], localDir?: string) => {
    let dir = localDir
    if (!dir) {
      const r = await dialog.showOpenDialog(win!, { title: '저장할 폴더 선택', defaultPath: app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths[0]) return false
      dir = r.filePaths[0]
    }
    await sftp.download(id, remotes, dir)
    return dir
  })
  handle('sftp:downloadTemp', async (id: string, remotes: string[]) => {
    const dir = join(app.getPath('downloads'))
    await sftp.download(id, remotes, dir)
    return dir
  })
  handle('sftp:preview', (id: string, path: string) => sftp.preview(id, path))
  handle('sftp:edit', (id: string, path: string) => sftp.editRemote(id, path))
  handle('local:saveForPrompt', (src: Parameters<typeof sftp.saveForPromptLocal>[0]) => sftp.saveForPromptLocal(src))
  handle('local:shells', () => listShells())
  handle('sftp:uploadForPrompt', (id: string, src: Parameters<typeof sftp.uploadForPrompt>[1]) => sftp.uploadForPrompt(id, src))

  // clipboard
  handle('clip:info', () => sftp.clipboardInfo())
  handle('clip:hasImage', () => sftp.clipboardHasImage())
  handle('clip:writeText', (t: string) => clipboard.writeText(t))
  handle('clip:readText', () => clipboard.readText())

  // dialogs
  handle('dialog:readKeyFile', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '개인 키 파일 선택',
      defaultPath: join(app.getPath('home'), '.ssh'),
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: '키 파일', extensions: ['pem', 'key', 'ppk', '*'] }, { name: '모든 파일', extensions: ['*'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const text = await fs.readFile(r.filePaths[0], 'utf8')
    return { path: r.filePaths[0], text }
  })
  handle('dialog:chooseDir', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  // import
  handle('import:scan', async () => {
    const [putty, ssh] = await Promise.all([scanPutty(), scanSshConfig()])
    return [...putty, ...ssh]
  })
  handle('import:scanAws', (profile?: string) => scanAws(profile))
  handle('import:apply', async (cands: ImportCandidate[], groupName: string) => importApply(cands, groupName))

  // serial
  handle('serial:list', () => listSerialPorts())

  // backup
  handle('backup:export', async () => {
    const r = await dialog.showSaveDialog(win!, {
      title: '백업 내보내기',
      defaultPath: join(app.getPath('documents'), `brightterm-backup-${new Date().toISOString().slice(0, 10)}.btbackup`),
      filters: [{ name: 'BrightTerm 백업', extensions: ['btbackup'] }]
    })
    if (r.canceled || !r.filePath) return false
    store.flush()
    await fs.writeFile(r.filePath, JSON.stringify({ app: 'brightterm', version: 1, exportedAt: Date.now(), store: store.get(), vault: vault.exportRaw() }, null, 2))
    return r.filePath
  })
  handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(win!, { filters: [{ name: 'BrightTerm 백업', extensions: ['btbackup', 'json'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return false
    const data = JSON.parse(await fs.readFile(r.filePaths[0], 'utf8')) as { app: string; store: StoreData; vault: VaultFile | null }
    if (data.app !== 'brightterm') throw new Error('BrightTerm 백업 파일이 아닙니다')
    store.replaceAll(data.store)
    if (data.vault) vault.importRaw(data.vault)
    return true
  })

  // app
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataDir: dataDir() }))
  handle('app:titlebar', (bg: string, fg: string) => {
    try { win?.setTitleBarOverlay?.({ color: bg, symbolColor: fg, height: 38 }) } catch { /* */ }
    nativeTheme.themeSource = store.get().settings.theme === 'light' ? 'light' : 'dark'
  })
  handle('app:openLogs', () => shell.openPath(join(dataDir(), 'logs')))
  handle('app:openExternal', (url: string) => { if (/^https?:\/\//.test(url)) shell.openExternal(url) })
  handle('ads:get', () => cachedBanners())
  handle('app:openBanner', (url: string) => { if (/^https:\/\//.test(url)) shell.openExternal(url) })
  handle('app:toggleFullScreen', () => win?.setFullScreen(!win.isFullScreen()))
}

/**
 * macOS menu bar. App commands are dispatched to the renderer (the same code path as the keyboard);
 * their accelerators are display-only so the renderer stays the single place that decides.
 * Edit roles keep real accelerators – without them ⌘C/⌘V do nothing in text fields on macOS.
 * Deliberately no 'close' role: ⌘W closes a pane, not the window.
 */
function buildMacMenu(): Menu {
  const act = (label: string, action: string, accelerator?: string): Electron.MenuItemConstructorOptions => ({
    label, accelerator, registerAccelerator: false, click: () => send('menu:action', action)
  })
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'BrightTerm 정보' },
        { type: 'separator' },
        act('설정…', 'settings', 'Cmd+,'),
        { type: 'separator' },
        { role: 'services', label: '서비스' },
        { type: 'separator' },
        { role: 'hide', label: 'BrightTerm 가리기' },
        { role: 'hideOthers', label: '기타 가리기' },
        { role: 'unhide', label: '모두 보기' },
        { type: 'separator' },
        { role: 'quit', label: 'BrightTerm 종료' }
      ]
    },
    {
      label: '셸',
      submenu: [
        act('새 연결 / 빠른 접속', 'quick', 'Cmd+T'),
        act('새 로컬 터미널', 'localTerm', 'Cmd+Shift+T'),
        act('명령 팔레트', 'quickOpen', 'Cmd+Shift+P'),
        { type: 'separator' },
        act('오른쪽으로 분할', 'splitRight', 'Cmd+D'),
        act('아래로 분할', 'splitDown', 'Cmd+Shift+D'),
        act('패널 닫기', 'closePane', 'Cmd+W'),
        { type: 'separator' },
        act('동시 입력', 'broadcast', 'Cmd+Shift+B'),
        act('SFTP 패널', 'sftp', 'Cmd+Shift+S'),
        { type: 'separator' },
        act('PuTTY / SSH config 가져오기…', 'import')
      ]
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '실행 복귀' },
        { type: 'separator' },
        { role: 'cut', label: '오려두기' },
        { role: 'copy', label: '복사하기' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '전체 선택' },
        { type: 'separator' },
        act('찾기', 'find', 'Cmd+F')
      ]
    },
    {
      label: '보기',
      submenu: [
        act('서버 목록', 'sidebar', 'Cmd+Shift+L'),
        act('패널 크게 보기', 'zoom', 'Cmd+Shift+Enter'),
        { type: 'separator' },
        act('글자 크게', 'fontUp', 'Cmd+='),
        act('글자 작게', 'fontDown', 'Cmd+-'),
        act('기본 크기', 'fontReset', 'Cmd+0'),
        { type: 'separator' },
        act('전체 화면', 'fullscreen', 'Ctrl+Cmd+F')
      ]
    },
    {
      label: '윈도우',
      submenu: [
        { role: 'minimize', label: '최소화' },
        { role: 'zoom', label: '확대/축소' },
        { type: 'separator' },
        act('다음 탭', 'nextTab', 'Cmd+Shift+]'),
        act('이전 탭', 'prevTab', 'Cmd+Shift+['),
        { type: 'separator' },
        { role: 'front', label: '모두 앞으로 가져오기' }
      ]
    }
  ])
}

async function importApply(cands: ImportCandidate[], groupName: string): Promise<{ hosts: number; keys: number; skipped: string[] }> {
  const data = store.get()
  const groups: Group[] = [...data.groups]
  let groupId: string | null = null
  if (groupName) {
    const existing = groups.find((g) => g.name === groupName && !g.parentId)
    if (existing) groupId = existing.id
    else {
      groupId = randomUUID()
      groups.push({ id: groupId, parentId: null, name: groupName, sort: groups.length, env: 'none' })
    }
  }
  const hosts: Host[] = [...data.hosts]
  const skipped: string[] = []
  let keys = 0
  for (const c of cands) {
    const h = c.host
    let credentialId: string | null = null
    if (c.keyFile) {
      try {
        const text = await fs.readFile(c.keyFile, 'utf8')
        if (vault.isUnlocked()) {
          credentialId = vault.save_({ name: `${c.name} 키`, kind: 'key', username: h.username, privateKey: text }).id
          keys++
        }
      } catch {
        skipped.push(`${c.name}: 키 파일을 읽지 못함 (${c.keyFile})`)
      }
    }
    // prefix → env
    const lower = c.name.toLowerCase()
    const env: Host['env'] = /^(prod|prd|live|운영)/.test(lower) ? 'prod' : /^(stg|stage|staging)/.test(lower) ? 'stage' : /^(dev|test|개발)/.test(lower) ? 'dev' : h.protocol === 'serial' ? 'device' : 'none'
    hosts.push({
      id: randomUUID(),
      groupId,
      alias: h.alias ?? c.name,
      protocol: h.protocol ?? 'ssh',
      host: h.host ?? '',
      port: h.port ?? 22,
      username: h.username ?? '',
      authType: credentialId ? 'key' : h.authType === 'key' ? 'agent' : 'password',
      credentialId,
      tags: [c.source],
      encoding: h.encoding ?? 'utf-8',
      termType: h.termType ?? 'xterm-256color',
      startupCommand: h.startupCommand,
      keepaliveSec: h.keepaliveSec ?? 30,
      forwards: h.forwards ?? [],
      serial: h.serial,
      notes: h.notes,
      env,
      sort: hosts.length
    })
  }
  // 점프 호스트 연결: 새로 가져온 서버를 먼저, 없으면 기존 서버에서 주소로 찾는다
  const added = hosts.slice(hosts.length - cands.length)
  cands.forEach((c, i) => {
    if (!c.jumpVia) return
    const jh = added.find((h) => h.host === c.jumpVia) ?? hosts.find((h) => h.host === c.jumpVia)
    if (jh && jh.id !== added[i].id) added[i].jumpHostId = jh.id
    else skipped.push(`${c.name}: 점프 호스트 ${c.jumpVia} 를 찾지 못해 직접 접속으로 등록`)
  })
  store.patch({ groups, hosts })
  // PuTTY known host keys can't be converted to fingerprints (stored as raw numbers); note count only
  await scanPuttyHostKeys().catch(() => [])
  return { hosts: cands.length, keys, skipped }
}

function startAutoLock(): void {
  setInterval(() => {
    const m = store.get().settings.autoLockMinutes
    if (m > 0 && vault.isUnlocked() && powerMonitor.getSystemIdleTime() >= m * 60) vault.lock()
  }, 20000)
  powerMonitor.on('lock-screen', () => {
    if (store.get().settings.autoLockMinutes > 0) vault.lock()
  })
  powerMonitor.on('suspend', () => {
    if (store.get().settings.autoLockMinutes > 0) vault.lock()
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('kr.balkeunter.brightterm')
  // macOS "BrightTerm 정보" 창
  app.setAboutPanelOptions({
    applicationName: 'BrightTerm',
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Copyright © 2026 Dany Kim',
    credits: '개발: Dany Kim'
  })
  Menu.setApplicationMenu(process.platform === 'darwin' ? buildMacMenu() : null)
  store.load()
  vault.init()
  vault.onLockChange = (u) => send('vault:changed', u)
  registerIpc()
  createWindow()
  startAutoLock()
  setTimeout(() => void refreshBanners(), 3000)
})

app.on('before-quit', () => {
  sessions.closeAll()
  store.flush()
})

app.on('window-all-closed', () => {
  app.quit()
})
