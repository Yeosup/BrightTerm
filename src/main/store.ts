import { app } from 'electron'
import { promises as fs, existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { DEFAULT_SETTINGS, MAC_FONT_FAMILY, StoreData, KnownHost, Settings } from '@shared/types'

/** Defaults + saved values, with the Windows font stack swapped out on macOS (fresh install or a Windows backup). */
function withDefaults(saved: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
  if (process.platform === 'darwin' && s.fontFamily === DEFAULT_SETTINGS.fontFamily) s.fontFamily = MAC_FONT_FAMILY
  return s
}

export const dataDir = (): string => {
  const d = process.env.BRIGHTTERM_DATA || join(app.getPath('userData'), 'data')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** Atomic JSON write: write temp file then rename (survives crash / power loss mid-write). */
export function writeJsonAtomicSync(file: string, data: unknown): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  if (existsSync(file)) {
    try { writeFileSync(file + '.bak', readFileSync(file)) } catch { /* ignore */ }
  }
  renameSync(tmp, file)
}

export function readJson<T>(file: string): T | null {
  for (const f of [file, file + '.bak']) {
    try {
      if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as T
    } catch { /* try backup */ }
  }
  return null
}

class Store {
  private data!: StoreData
  private file = ''
  private timer: NodeJS.Timeout | null = null

  load(): StoreData {
    this.file = join(dataDir(), 'store.json')
    const raw = readJson<StoreData>(this.file)
    this.data = {
      version: 1,
      groups: raw?.groups ?? [],
      hosts: raw?.hosts ?? [],
      snippets: raw?.snippets ?? [],
      knownHosts: raw?.knownHosts ?? [],
      settings: withDefaults(raw?.settings),
      workspace: raw?.workspace
    }
    return this.data
  }

  get(): StoreData {
    return this.data
  }

  patch(p: Partial<StoreData>): void {
    this.data = { ...this.data, ...p }
    this.scheduleSave()
  }

  replaceAll(d: StoreData): void {
    this.data = { ...d, settings: withDefaults(d.settings) }
    this.flush()
  }

  findKnownHost(hostPort: string): KnownHost | undefined {
    return this.data.knownHosts.find((k) => k.hostPort === hostPort)
  }

  setKnownHost(k: KnownHost): void {
    this.data.knownHosts = [...this.data.knownHosts.filter((x) => x.hostPort !== k.hostPort), k]
    this.scheduleSave()
  }

  touchHost(id: string): void {
    const h = this.data.hosts.find((x) => x.id === id)
    if (h) {
      h.lastUsedAt = Date.now()
      this.scheduleSave()
    }
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    writeJsonAtomicSync(this.file, this.data)
  }

  async exists(p: string): Promise<boolean> {
    try { await fs.access(p); return true } catch { return false }
  }
}

export const store = new Store()
