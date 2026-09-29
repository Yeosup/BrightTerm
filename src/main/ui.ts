import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import type { UiRequest } from '@shared/types'

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

const pending = new Map<string, (v: unknown) => void>()
let win: BrowserWindow | null = null

export function setWindow(w: BrowserWindow): void {
  win = w
}

export function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

/** Ask the renderer a question (host key, password, keyboard-interactive...). Resolves null when cancelled. */
export function ask<T>(req: DistributiveOmit<UiRequest, 'reqId'>): Promise<T | null> {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve(null)
    const reqId = randomUUID()
    pending.set(reqId, resolve as (v: unknown) => void)
    win.webContents.send('ui:request', { ...req, reqId })
    if (win.isMinimized()) win.restore()
    win.flashFrame(true)
  })
}

export function respond(reqId: string, value: unknown): void {
  const r = pending.get(reqId)
  if (r) {
    pending.delete(reqId)
    r(value)
  }
}
