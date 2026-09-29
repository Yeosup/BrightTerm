import { api } from './api'

/**
 * Platform keyboard model.
 *
 * Windows: app shortcuts live on Ctrl(+Shift); the terminal only gets what is left.
 * macOS:   app shortcuts live on ⌘ so every Ctrl chord (Ctrl+C/K/V/W …) reaches the shell untouched.
 */
export const isMac = api.platform === 'darwin'

export type Action =
  | 'quick' | 'quickOpen' | 'closePane' | 'splitRight' | 'splitDown' | 'zoom' | 'find' | 'sftp'
  | 'broadcast' | 'sidebar' | 'moveTabLeft' | 'moveTabRight' | 'nextTab' | 'prevTab'
  | 'tab1' | 'tab2' | 'tab3' | 'tab4' | 'tab5' | 'tab6' | 'tab7' | 'tab8' | 'tab9'
  | 'paneLeft' | 'paneRight' | 'paneUp' | 'paneDown' | 'fontUp' | 'fontDown' | 'fontReset'
  | 'settings' | 'import' | 'fullscreen'

/** The platform's primary modifier: ⌘ on macOS, Ctrl elsewhere. */
export function modKey(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}

/**
 * Normalise a key event to "mod+ctrl+alt+shift+key".
 * Letters/digits come from e.code so Korean IME input and ⌥-produced symbols (⌥V = √) still match.
 */
export function combo(e: KeyboardEvent): string {
  const c = e.code || ''
  let key = e.key.toLowerCase()
  if (c.startsWith('Key')) key = c.slice(3).toLowerCase()
  else if (c.startsWith('Digit')) key = c.slice(5)
  else if (c === 'BracketLeft') key = '['
  else if (c === 'BracketRight') key = ']'
  else if (c === 'Equal') key = '='
  else if (c === 'Minus') key = '-'
  else if (c === 'Comma') key = ','
  else if (key === '+') key = '='
  const parts: string[] = []
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod')
  if (isMac ? e.ctrlKey : e.metaKey) parts.push(isMac ? 'ctrl' : 'meta')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

const WIN: Record<string, Action> = {
  'mod+k': 'quick', 'mod+shift+t': 'quick', 'mod+shift+n': 'quick', 'mod+shift+p': 'quickOpen',
  'mod+shift+w': 'closePane', 'mod+shift+d': 'splitRight', 'mod+shift+e': 'splitDown', 'mod+shift+enter': 'zoom',
  'mod+shift+f': 'find', 'mod+shift+s': 'sftp', 'mod+shift+b': 'broadcast', 'mod+shift+l': 'sidebar',
  'mod+shift+arrowleft': 'moveTabLeft', 'mod+shift+arrowright': 'moveTabRight', 'mod+tab': 'nextTab', 'mod+shift+tab': 'prevTab',
  'alt+arrowleft': 'paneLeft', 'alt+arrowright': 'paneRight', 'alt+arrowup': 'paneUp', 'alt+arrowdown': 'paneDown',
  'mod+=': 'fontUp', 'mod+-': 'fontDown', 'mod+0': 'fontReset', f11: 'fullscreen'
}

const MAC: Record<string, Action> = {
  'mod+k': 'quick', 'mod+t': 'quick', 'mod+n': 'quick', 'mod+shift+p': 'quickOpen',
  'mod+w': 'closePane', 'mod+d': 'splitRight', 'mod+shift+d': 'splitDown', 'mod+shift+enter': 'zoom',
  'mod+f': 'find', 'mod+shift+s': 'sftp', 'mod+shift+b': 'broadcast', 'mod+shift+l': 'sidebar',
  'mod+shift+arrowleft': 'moveTabLeft', 'mod+shift+arrowright': 'moveTabRight',
  'mod+shift+]': 'nextTab', 'mod+shift+[': 'prevTab', 'ctrl+tab': 'nextTab', 'ctrl+shift+tab': 'prevTab',
  'mod+alt+arrowleft': 'paneLeft', 'mod+alt+arrowright': 'paneRight', 'mod+alt+arrowup': 'paneUp', 'mod+alt+arrowdown': 'paneDown',
  'mod+=': 'fontUp', 'mod+-': 'fontDown', 'mod+0': 'fontReset', 'mod+,': 'settings', 'mod+ctrl+f': 'fullscreen'
}
for (let i = 1; i <= 9; i++) {
  WIN[`mod+${i}`] = `tab${i}` as Action
  MAC[`mod+${i}`] = `tab${i}` as Action
}

const MAP = isMac ? MAC : WIN

export function actionOf(e: KeyboardEvent): Action | null {
  return MAP[combo(e)] ?? null
}

// ---------- labels shown in menus, tooltips and the shortcut table ----------

const L = (win: string, mac: string): string => (isMac ? mac : win)

export const SC = {
  quick: L('Ctrl+K', '⌘K'),
  newTab: L('Ctrl+Shift+T', '⌘T'),
  closePane: L('Ctrl+Shift+W', '⌘W'),
  splitRight: L('Ctrl+Shift+D', '⌘D'),
  splitDown: L('Ctrl+Shift+E', '⇧⌘D'),
  paneMove: L('Alt+방향키', '⌥⌘+방향키'),
  zoom: L('Ctrl+Shift+Enter', '⇧⌘↩'),
  tabs: L('Ctrl+Tab / Ctrl+1~9', '⇧⌘[ ] / ⌘1~9'),
  paste: L('Ctrl+V', '⌘V'),
  pasteImage: L('Ctrl+Alt+V', '⌥⌘V'),
  copy: L('Ctrl+Shift+C', '⌘C'),
  copyLong: L('Ctrl+Shift+C / 선택', '⌘C / 선택'),
  find: L('Ctrl+Shift+F', '⌘F'),
  sftp: L('Ctrl+Shift+S', '⇧⌘S'),
  broadcast: L('Ctrl+Shift+B', '⇧⌘B'),
  sidebar: L('Ctrl+Shift+L', '⇧⌘L'),
  font: L('Ctrl+= / Ctrl+- / Ctrl+0', '⌘= / ⌘- / ⌘0'),
  openRight: L('Ctrl+Enter', '⌘↩'),
  settings: L('', '⌘,')
}

export function osUnlockText(kind: 'windows' | 'touchid' | 'keychain' | undefined): { button: string; toggle: string; desc: string; fail: string } {
  if (kind === 'touchid') return { button: 'Touch ID로 잠금 해제', toggle: 'Touch ID로 잠금 해제', desc: '잠금 화면에서 마스터 비밀번호 대신 Touch ID로 열 수 있습니다. 볼트 키는 macOS 키체인에 보관됩니다', fail: 'Touch ID 잠금 해제를 취소했거나 실패했습니다' }
  if (kind === 'keychain') return { button: 'macOS 키체인으로 잠금 해제', toggle: 'macOS 키체인으로 잠금 해제', desc: '잠금 화면에서 마스터 비밀번호 대신 macOS 로그인 키체인으로 열 수 있습니다', fail: '키체인 잠금 해제에 실패했습니다' }
  return { button: 'Windows 계정으로 잠금 해제', toggle: 'Windows 계정으로 잠금 해제', desc: '잠금 화면에서 마스터 비밀번호 대신 Windows 로그인(DPAPI)으로 열 수 있습니다', fail: 'Windows 자동 잠금해제에 실패했습니다' }
}
