import { contextBridge, ipcRenderer, webUtils } from 'electron'

type Res<T> = { ok: true; value: T } | { ok: false; error: string }

async function call<T>(ch: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(ch, ...args)) as Res<T>
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function on(ch: string, cb: (...a: never[]) => void): () => void {
  const l = (_e: unknown, ...a: unknown[]): void => (cb as (...x: unknown[]) => void)(...a)
  ipcRenderer.on(ch, l)
  return () => ipcRenderer.removeListener(ch, l)
}

const api = {
  call,
  on,
  write: (id: string, data: string) => ipcRenderer.send('session:write', id, data),
  resize: (id: string, cols: number, rows: number) => ipcRenderer.send('session:resize', id, cols, rows),
  respond: (reqId: string, value: unknown) => ipcRenderer.send('ui:respond', reqId, value),
  pathForFile: (f: File): string => {
    try {
      return webUtils.getPathForFile(f)
    } catch {
      return ''
    }
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('bt', api)

export type BtApi = typeof api
