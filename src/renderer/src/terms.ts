import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { api } from './api'
import { useApp } from './state'
import { TERMINAL_THEMES } from './themes'
import { panes, findPane } from './layout'
import type { Settings } from '@shared/types'
import { actionOf, combo, isMac } from './platform'

export interface TermEntry {
  sessionId: string
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  el: HTMLDivElement
  line: string
  lineUnknown: boolean
  webgl?: WebglAddon
}

const entries = new Map<string, TermEntry>()
let parking: HTMLDivElement | null = null

function parkingLot(): HTMLDivElement {
  if (!parking) {
    parking = document.createElement('div')
    parking.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:600px;overflow:hidden;visibility:hidden'
    document.body.appendChild(parking)
  }
  return parking
}

function termOptions(s: Settings): ConstructorParameters<typeof Terminal>[0] {
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    cursorStyle: s.cursorStyle,
    cursorBlink: s.cursorBlink,
    scrollback: s.scrollback,
    theme: TERMINAL_THEMES[s.terminalTheme] ?? TERMINAL_THEMES['BrightTerm Dark'],
    allowProposedApi: true,
    macOptionIsMeta: true,
    // tmux 등이 마우스를 잡고 있어도 ⌥+드래그(Windows 는 Shift+드래그)로 글자를 선택·복사할 수 있게
    macOptionClickForcesSelection: true,
    rightClickSelectsWord: false,
    drawBoldTextInBrightColors: true,
    minimumContrastRatio: 1,
    smoothScrollDuration: 0,
    altClickMovesCursor: true
  }
}

export function getEntry(sessionId: string): TermEntry | undefined {
  return entries.get(sessionId)
}

export function ensureEntry(sessionId: string): TermEntry {
  let e = entries.get(sessionId)
  if (e) return e
  const settings = useApp.getState().settings
  const term = new Terminal(termOptions(settings))
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(new WebLinksAddon((ev, uri) => {
    if (ev.ctrlKey || ev.metaKey) api.app.openExternal(uri)
  }))
  const u = new Unicode11Addon()
  term.loadAddon(u)
  term.unicode.activeVersion = '11'
  const el = document.createElement('div')
  el.className = 'term-host'
  parkingLot().appendChild(el)
  term.open(el)
  e = { sessionId, term, fit, search, el, line: '', lineUnknown: false }
  try {
    const gl = new WebglAddon()
    gl.onContextLoss(() => gl.dispose())
    term.loadAddon(gl)
    e.webgl = gl
  } catch { /* DOM renderer fallback */ }
  const entry = e
  term.onData((d) => handleInput(entry, d))
  term.onBinary((d) => api.write(sessionId, d))
  term.onResize(({ cols, rows }) => api.resize(sessionId, cols, rows))
  term.onSelectionChange(() => {
    if (useApp.getState().settings.copyOnSelect && term.hasSelection()) {
      const sel = term.getSelection()
      if (sel) api.clip.writeText(sel)
    }
  })
  term.onBell(() => {
    if (useApp.getState().settings.bell) new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play().catch(() => {})
  })
  term.attachCustomKeyEventHandler((ev) => keyHandler(entry, ev))
  if (isMac) {
    // ⌘V arrives as a native menu paste: route it through smartPaste (image/file upload, multi-line guard)
    el.addEventListener('paste', (ev) => {
      ev.preventDefault()
      ev.stopImmediatePropagation()
      smartPaste(sessionId)
    }, true)
  }
  entries.set(sessionId, e)
  return e
}

export function attach(sessionId: string, container: HTMLElement): TermEntry {
  const e = ensureEntry(sessionId)
  if (e.el.parentElement !== container) container.appendChild(e.el)
  requestAnimationFrame(() => fitEntry(e))
  return e
}

export function detach(sessionId: string, container: HTMLElement): void {
  const e = entries.get(sessionId)
  if (e && e.el.parentElement === container) parkingLot().appendChild(e.el)
}

export function fitEntry(e: TermEntry): void {
  if (!e.el.isConnected || e.el.parentElement === parking) return
  const r = e.el.getBoundingClientRect()
  if (r.width < 20 || r.height < 20) return
  try {
    e.fit.fit()
  } catch { /* */ }
}

export function disposeEntry(sessionId: string): void {
  const e = entries.get(sessionId)
  if (!e) return
  e.term.dispose()
  e.el.remove()
  entries.delete(sessionId)
}

export function applySettingsToAll(s: Settings): void {
  for (const e of entries.values()) {
    const o = termOptions(s)
    e.term.options.fontFamily = o!.fontFamily
    e.term.options.fontSize = o!.fontSize
    e.term.options.lineHeight = o!.lineHeight
    e.term.options.cursorStyle = o!.cursorStyle
    e.term.options.cursorBlink = o!.cursorBlink
    e.term.options.scrollback = o!.scrollback
    e.term.options.theme = o!.theme
    fitEntry(e)
  }
}

// ---------------- data from main ----------------

let wired = false
export function wireData(): void {
  if (wired) return
  wired = true
  api.on.data((id, data) => {
    const e = ensureEntry(id)
    e.term.write(data)
    const st = useApp.getState()
    const tab = st.tabs.find((t) => t.id === st.activeTab)
    const visible = tab && panes(tab.root).some((p) => p.sessionId === id)
    if (!visible && !st.activity[id]) useApp.setState((s) => ({ activity: { ...s.activity, [id]: true } }))
  })
}

// ---------------- input handling ----------------

function sessionsForInput(sessionId: string): string[] {
  const st = useApp.getState()
  const tab = st.tabOfSession(sessionId)
  if (tab?.broadcast) return panes(tab.root).map((p) => p.sessionId).filter((id) => st.sessions[id]?.state === 'connected' || id === sessionId)
  return [sessionId]
}

function isDangerous(text: string): string | null {
  const st = useApp.getState()
  for (const p of st.settings.dangerousPatterns) {
    try {
      if (new RegExp(p, 'i').test(text)) return p
    } catch { /* bad regex */ }
  }
  return null
}

function guardEnabled(sessionId: string): boolean {
  const st = useApp.getState()
  return st.settings.guardDangerousOnProd && st.sessions[sessionId]?.env === 'prod'
}

function sendAll(sessionId: string, d: string): void {
  for (const id of sessionsForInput(sessionId)) api.write(id, d)
}

let confirming = false

function handleInput(e: TermEntry, d: string): void {
  const id = e.sessionId
  // Track the current command line for dangerous-command guard (best effort)
  if (guardEnabled(id) && e.term.buffer.active.type === 'normal') {
    if (d === '\r') {
      const line = e.line
      const hit = !e.lineUnknown && line ? isDangerous(line) : null
      e.line = ''
      e.lineUnknown = false
      if (hit && !confirming) {
        confirming = true
        const info = useApp.getState().sessions[id]
        useApp.getState().confirm({
          title: '운영 서버 위험 명령',
          message: `[${info?.title}] 운영 서버에서 실행하려는 명령입니다. 정말 실행할까요?`,
          detail: line,
          okText: '실행',
          danger: true
        }).then((ok) => {
          confirming = false
          if (ok) sendAll(id, '\r')
          e.term.focus()
        })
        return
      }
    } else if (d === '\x7f' || d === '\b') e.line = e.line.slice(0, -1)
    else if (d === '\x03' || d === '\x15') { e.line = ''; e.lineUnknown = false }
    else if (/^[\x20-\x7e\u0080-￿]+$/.test(d)) e.line += d
    else e.lineUnknown = true
  }
  sendAll(id, d)
}

function isAppShortcut(ev: KeyboardEvent): boolean {
  if (actionOf(ev)) return true
  return !isMac && combo(ev) === 'mod+shift+m'
}

/** macOS: ⌘ is the app's key, so every Ctrl chord goes to the shell unchanged. */
function macKeyHandler(e: TermEntry, ev: KeyboardEvent): boolean {
  if (!ev.metaKey) return !isAppShortcut(ev)
  const c = combo(ev)
  if (c === 'mod+c') {
    ev.preventDefault()
    if (e.term.hasSelection()) api.clip.writeText(e.term.getSelection())
  } else if (c === 'mod+a') {
    ev.preventDefault()
    e.term.selectAll()
  } else if (c === 'mod+alt+v') {
    ev.preventDefault()
    smartPaste(e.sessionId, true)
  }
  // ⌘V / ⇧⌘V are left to the Edit menu's paste role; the 'paste' event it raises is caught in ensureEntry.
  // Everything else with ⌘ (⌘Q, ⌘H, ⌘M, app shortcuts) must not reach the shell.
  return false
}

function keyHandler(e: TermEntry, ev: KeyboardEvent): boolean {
  if (ev.type !== 'keydown') return true
  if (isMac) return macKeyHandler(e, ev)
  const st = useApp.getState()
  const k = ev.key.toLowerCase()
  // copy
  if (ev.ctrlKey && ev.shiftKey && k === 'c') {
    ev.preventDefault()
    if (e.term.hasSelection()) api.clip.writeText(e.term.getSelection())
    return false
  }
  // Ctrl+C with selection → copy (Windows Terminal style)
  if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && k === 'c' && e.term.hasSelection()) {
    ev.preventDefault()
    api.clip.writeText(e.term.getSelection())
    e.term.clearSelection()
    return false
  }
  // paste
  if ((ev.ctrlKey && ev.shiftKey && k === 'v') || (ev.ctrlKey && !ev.shiftKey && !ev.altKey && k === 'v' && st.settings.ctrlVPaste) || (ev.shiftKey && k === 'insert')) {
    ev.preventDefault()
    smartPaste(e.sessionId)
    return false
  }
  if (ev.ctrlKey && ev.altKey && k === 'v') {
    ev.preventDefault()
    smartPaste(e.sessionId, true)
    return false
  }
  if (isAppShortcut(ev)) return false
  return true
}

function quotePath(p: string): string {
  if (!useApp.getState().settings.insertPathQuote) return p
  return /[\s'"$`\\()&;|<>*?!#]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p
}

async function insertPaths(sessionId: string, paths: string[]): Promise<void> {
  const e = getEntry(sessionId)
  const text = paths.map(quotePath).join(' ') + ' '
  // bracketed paste: CLIs like Claude Code treat a pasted image path like a dropped image
  if (e) e.term.paste(text)
  else api.write(sessionId, text)
  e?.term.focus()
}

export async function uploadAndInsert(sessionId: string, src: { kind: 'clipboardImage' } | { kind: 'files'; paths: string[] }): Promise<void> {
  const st = useApp.getState()
  const info = st.sessions[sessionId]
  if (info?.protocol === 'local') {
    // 로컬 셸: 서버로 올릴 필요 없이 이미지는 이 PC 에 저장한 경로, 파일은 원래 경로를 넣는다
    try {
      await insertPaths(sessionId, await api.local.saveForPrompt(src))
    } catch (err) {
      st.toast('error', (err as Error).message)
    }
    return
  }
  if (!info?.canSftp || info.state !== 'connected') {
    if (src.kind === 'files') return insertPaths(sessionId, src.paths)
    st.toast('error', '이미지 전송은 연결된 SSH 세션에서만 가능합니다')
    return
  }
  const label = src.kind === 'clipboardImage' ? '클립보드 이미지' : src.paths.length === 1 ? src.paths[0].split(/[\\/]/).pop() : `파일 ${src.paths.length}개`
  st.toast('info', `${label} 서버로 전송 중...`)
  try {
    const remote = await api.sftp.uploadForPrompt(sessionId, src)
    await insertPaths(sessionId, remote)
    useApp.getState().toast('ok', `${label} 전송 완료 → ${remote.join(', ')}`)
  } catch (err) {
    useApp.getState().toast('error', `전송 실패: ${(err as Error).message}`)
  }
}

export async function smartPaste(sessionId: string, forceImage = false): Promise<void> {
  const st = useApp.getState()
  const e = getEntry(sessionId)
  if (!e) return
  if (forceImage) {
    if (await api.clip.hasImage()) return uploadAndInsert(sessionId, { kind: 'clipboardImage' })
    st.toast('info', '클립보드에 이미지가 없습니다')
    return
  }
  const info = await api.clip.info()
  if (info.type === 'files' && info.files?.length) return uploadAndInsert(sessionId, { kind: 'files', paths: info.files })
  if (info.type === 'image') return uploadAndInsert(sessionId, { kind: 'clipboardImage' })
  if (info.type !== 'text' || !info.text) return
  const text = info.text
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/)
  const sess = st.sessions[sessionId]
  if (guardEnabled(sessionId) && isDangerous(text)) {
    const ok = await st.confirm({ title: '운영 서버 위험 명령 붙여넣기', message: `[${sess?.title}] 붙여넣을 내용에 위험한 명령이 있습니다.`, detail: text.slice(0, 2000), okText: '붙여넣기', danger: true })
    if (!ok) return e.term.focus()
  } else if (st.settings.confirmMultilinePaste && lines.length > 1 && !e.term.modes.bracketedPasteMode) {
    const ok = await st.confirm({ title: '여러 줄 붙여넣기', message: `${lines.length}줄을 [${sess?.title}]에 붙여넣습니다. 각 줄이 명령으로 실행될 수 있습니다.`, detail: text.slice(0, 2000), okText: '붙여넣기' })
    if (!ok) return e.term.focus()
  }
  e.term.paste(text)
  e.term.focus()
}

export function focusSession(sessionId: string): void {
  getEntry(sessionId)?.term.focus()
}

export function focusedEntry(): TermEntry | undefined {
  const st = useApp.getState()
  const tab = st.tabs.find((t) => t.id === st.activeTab)
  if (!tab) return
  const p = findPane(tab.root, tab.focused)
  return p ? getEntry(p.sessionId) : undefined
}

export function sendSnippet(body: string, enter: boolean): void {
  const e = focusedEntry()
  if (!e) return useApp.getState().toast('info', '먼저 세션을 선택하세요')
  const text = body.replace(/\r?\n/g, '\r') + (enter ? '\r' : '')
  sendAll(e.sessionId, text)
  e.term.focus()
}

/** Give keyboard focus back to the focused pane's terminal (after dialogs close). */
export function refocusTerminal(): void {
  setTimeout(() => {
    if (document.querySelector('.modal')) return
    focusedEntry()?.term.focus()
  }, 30)
}
