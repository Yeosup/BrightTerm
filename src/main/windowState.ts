import { BrowserWindow, Rectangle, screen } from 'electron'
import { join } from 'path'
import { dataDir, readJson, writeJsonAtomicSync } from './store'

/** 창 크기·위치 기억. 저장 위치가 지금 모니터 어디에도 안 걸리면 크기만 살려 가운데로 */
interface Saved { x: number; y: number; width: number; height: number; maximized: boolean }

export const DEFAULT_SIZE = { width: 1440, height: 900 }
const MIN = { width: 900, height: 560 }
const file = (): string => join(dataDir(), 'window.json')

function fitToScreen(width: number, height: number): { width: number; height: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return { width: Math.max(MIN.width, Math.min(width, wa.width)), height: Math.max(MIN.height, Math.min(height, wa.height)) }
}

function visible(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: w }) => {
    const x = Math.max(0, Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x))
    const y = Math.max(0, Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y))
    return x >= 120 && y >= 80 // 제목 줄을 잡아 끌 수 있을 만큼은 보여야 한다
  })
}

/** BrowserWindow 옵션에 넣을 크기·위치 + 최대화 여부 */
export function initialBounds(remember: boolean): { bounds: Partial<Rectangle>; maximized: boolean } {
  const s = remember ? readJson<Saved>(file()) : null
  if (!s || !(s.width > 0 && s.height > 0)) return { bounds: fitToScreen(DEFAULT_SIZE.width, DEFAULT_SIZE.height), maximized: false }
  const size = fitToScreen(s.width, s.height)
  const b = { x: s.x, y: s.y, ...size }
  return { bounds: visible(b) ? b : size, maximized: !!s.maximized }
}

let timer: NodeJS.Timeout | null = null

function save(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return
  const b = win.getNormalBounds()
  writeJsonAtomicSync(file(), { ...b, maximized: win.isMaximized() } satisfies Saved)
}

/** 크기·위치가 바뀌면 0.5초 뒤, 닫을 때는 바로 저장 */
export function trackWindow(win: BrowserWindow, remember: () => boolean): void {
  const later = (): void => {
    if (!remember()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => save(win), 500)
  }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) win.on(ev as 'resize', later)
  win.on('close', () => { if (remember()) save(win) })
}

/** 설정 → 원래 크기로: 처음 크기로 되돌려 가운데에 */
export function resetWindow(win: BrowserWindow): void {
  if (win.isFullScreen()) win.setFullScreen(false)
  if (win.isMaximized()) win.unmaximize()
  const size = fitToScreen(DEFAULT_SIZE.width, DEFAULT_SIZE.height)
  win.setSize(size.width, size.height)
  win.center()
  save(win)
}
