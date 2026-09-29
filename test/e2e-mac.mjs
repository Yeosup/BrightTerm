// macOS 시나리오: ⌘ 단축키 / Ctrl 조합이 셸로 가는지 / ⌘V(메뉴 paste) 경로 / 이미지 업로드 / SFTP.
// 준비: 로컬 sshd(키 인증)를 띄우고 BT_SSH_TARGET, BT_SSH_KEY 를 넘긴다.
//   BT_SSH_TARGET=me@127.0.0.1:2222 BT_SSH_KEY=/path/clientkey node test/e2e-mac.mjs
import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import { rmSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs'
import { homedir, tmpdir } from 'os'
import path from 'path'

const TARGET = process.env.BT_SSH_TARGET
const KEY = process.env.BT_SSH_KEY
if (!TARGET || !KEY) throw new Error('BT_SSH_TARGET / BT_SSH_KEY 가 필요합니다')
const DATA = path.join(tmpdir(), 'bt-e2e-mac-data')
const SHOTS = process.env.SHOTS || path.join(tmpdir(), 'bt-shots-mac')
const MARK = path.join(tmpdir(), 'bt-e2e-mac')
rmSync(DATA, { recursive: true, force: true })
rmSync(MARK, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
mkdirSync(MARK, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const waitFile = async (f, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (existsSync(f)) return true; await sleep(100) } return false }

const app = await electron.launch({ executablePath: electronPath, args: ['.'], env: { ...process.env, BRIGHTTERM_DATA: DATA } })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log('[pageerror]', e.message))
const shot = (n) => win.screenshot({ path: `${SHOTS}/${n}.png` })
const panesConnected = () => win.evaluate(() => document.querySelectorAll('.pane .dot.connected').length)

// vault
await win.waitForSelector('.lock-card')
await win.fill('input[placeholder^="마스터 비밀번호"]', 'MasterPass!2026')
await win.fill('input[placeholder="비밀번호 확인"]', 'MasterPass!2026')
await win.click('button:has-text("볼트 만들기")')
await win.waitForSelector('.recovery', { timeout: 30000 })
await win.check('input[type=checkbox]')
await win.click('button:has-text("시작하기")')
await win.waitForSelector('.welcome')
await sleep(400)
if (await win.$('.modal')) await win.keyboard.press('Escape')
const status = await win.evaluate(() => window.bt.call('vault:status'))
check('vault status reports macOS unlock kind', status.osUnlockKind === 'touchid' || status.osUnlockKind === 'keychain', status.osUnlockKind)
const welcomeText = await win.textContent('.welcome')
check('welcome shows ⌘ shortcuts', welcomeText.includes('⌘K') && !welcomeText.includes('Ctrl+Shift'))
await shot('01-welcome')

// host with key auth
await win.click('.sb-actions button:has-text("서버")')
await win.fill('input[placeholder="예: 운영-WEB01"]', '로컬-sshd')
await win.fill('input[placeholder^="10.0.0.11"]', TARGET)
await win.click('.modal .seg button:has-text("개발")')
await win.click('.mtabs button:has-text("인증")')
await win.click('.modal .seg button:has-text("키")')
await win.fill('textarea[placeholder^="-----BEGIN"]', readFileSync(KEY, 'utf8'))
await win.click('button:has-text("저장 후 연결")')
await win.waitForSelector('button:has-text("신뢰하고 접속")', { timeout: 15000 })
await win.click('button:has-text("신뢰하고 접속")')
await win.waitForSelector('.pane .dot.connected', { timeout: 15000 })
await sleep(1200)
await win.keyboard.type(`echo BT_OK > ${MARK}/1\n`)
check('ssh key auth + typing', await waitFile(`${MARK}/1`))
await shot('02-connected')

// Ctrl chords must reach the shell on macOS
await win.keyboard.type('sleep 30\n')
await sleep(500)
await win.keyboard.press('Control+c')
await sleep(300)
await win.keyboard.type(`echo CTRLC > ${MARK}/2\n`)
check('Ctrl+C interrupts remote command', await waitFile(`${MARK}/2`, 3000))
await win.keyboard.press('Control+k')
await sleep(300)
check('Ctrl+K does not open the palette', !(await win.$('.palette')))
await win.keyboard.type(`echo KILL_LINE_JUNK`)
await win.keyboard.press('Control+u')
await win.keyboard.type(`echo CTRLU > ${MARK}/3\n`)
check('Ctrl+U reaches readline', await waitFile(`${MARK}/3`, 3000) && readFileSync(`${MARK}/3`, 'utf8').trim() === 'CTRLU')

// ⌘ app shortcuts
await win.keyboard.press('Meta+k')
await win.waitForSelector('.palette', { timeout: 3000 }).catch(() => {})
check('⌘K opens the palette', !!(await win.$('.palette')))
await win.keyboard.type('로컬')
await sleep(200)
await win.keyboard.press('Meta+Enter')
await win.waitForFunction(() => document.querySelectorAll('.pane .dot.connected').length >= 2, null, { timeout: 15000 }).catch(() => {})
check('⌘↩ in palette opens split', (await panesConnected()) >= 2)
await win.keyboard.press('Meta+d')
await win.waitForFunction(() => document.querySelectorAll('.pane .dot.connected').length >= 3, null, { timeout: 15000 }).catch(() => {})
check('⌘D splits right', (await panesConnected()) >= 3)
await shot('03-splits')
await win.keyboard.press('Meta+w')
await sleep(600)
check('⌘W closes one pane (not the window)', (await win.evaluate(() => document.querySelectorAll('.pane').length)) === 2)
await win.keyboard.press('Meta+Alt+ArrowLeft')
await sleep(200)

// ⌘V: the Edit menu's paste role fires a DOM paste event; emulate exactly that
await app.evaluate(({ clipboard }, f) => clipboard.writeText(`echo PASTE > ${f}`), `${MARK}/4`)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste())
await sleep(400)
await win.keyboard.press('Enter')
check('menu paste (⌘V) goes through smartPaste once', await waitFile(`${MARK}/4`, 3000) && readFileSync(`${MARK}/4`, 'utf8').trim() === 'PASTE')

// ⌘A + ⌘C copy
await win.keyboard.press('Meta+a')
await win.keyboard.press('Meta+c')
await sleep(300)
const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
check('⌘A ⌘C copies terminal text', copied.includes('PASTE'))

// ⌥⌘V: clipboard image → server upload → path typed
const uploads = path.join(homedir(), '.brightterm', 'uploads')
const before = existsSync(uploads) ? readdirSync(uploads) : []
const clip = await app.evaluate(({ clipboard, nativeImage }, f) => {
  clipboard.clear()
  clipboard.writeImage(nativeImage.createFromPath(f))
  return { empty: clipboard.readImage().isEmpty(), formats: clipboard.availableFormats() }
}, path.resolve('resources/icon.png'))
console.log('clipboard:', JSON.stringify(clip))
await win.keyboard.type('file ')
await win.keyboard.press('Meta+Alt+v')
await sleep(2500)
await win.keyboard.press('Enter')
await sleep(600)
const after = existsSync(uploads) ? readdirSync(uploads) : []
const added = after.filter((f) => !before.includes(f))
check('⌥⌘V uploads clipboard image', added.length === 1, added.join(','))
await shot('04-image')

// SFTP + settings + font
await win.keyboard.press('Meta+Shift+s')
await win.waitForSelector('.sftp-row:not(.sftp-head)', { timeout: 10000 }).catch(() => {})
check('⇧⌘S opens SFTP', !!(await win.$('.sftp-row:not(.sftp-head)')))
await shot('05-sftp')
const fs0 = await win.evaluate(() => window.bt.call('store:get').then((s) => s.settings.fontSize))
await win.keyboard.press('Meta+=')
await sleep(300)
const fs1 = await win.evaluate(() => window.bt.call('store:get').then((s) => s.settings.fontSize))
check('⌘= enlarges font', fs1 === fs0 + 1, `${fs0}->${fs1}`)
await win.keyboard.press('Meta+0')
const font = await win.evaluate(() => window.bt.call('store:get').then((s) => s.settings.fontFamily))
check('macOS default font stack', font.startsWith('Menlo'), font)
await win.keyboard.press('Meta+,')
await win.waitForSelector('.settings', { timeout: 3000 }).catch(() => {})
check('⌘, opens settings', !!(await win.$('.settings')))
await win.click('.settings nav button:has-text("보안")').catch(() => {})
await sleep(200)
await shot('06-settings-security')
await win.keyboard.press('Escape')

const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label))
check('macOS menu bar', menu.includes('셸') && menu.includes('편집'), menu.join('|'))

for (const f of added) rmSync(path.join(uploads, f), { force: true })
await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]._forceClose = true })
await app.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — FAILED: ' + failed.map((f) => f.name).join(', ') : ''}`)
process.exit(failed.length ? 1 : 0)
