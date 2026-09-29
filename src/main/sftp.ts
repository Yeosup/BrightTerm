import { randomUUID } from 'crypto'
import { app, clipboard, shell } from 'electron'
import { promises as fs, watch, FSWatcher, statSync } from 'fs'
import { join, basename, extname, posix } from 'path'
import type { SFTPWrapper, Stats } from 'ssh2'
import type { ClipboardInfo, SftpEntry, Transfer } from '@shared/types'
import { sessions } from './sessions'
import { send } from './ui'
import { store } from './store'

function sftpOf(sessionId: string): Promise<SFTPWrapper> {
  const s = sessions.get(sessionId)
  const t = s?.sshTransport()
  if (!t) return Promise.reject(new Error('SSH로 연결된 세션에서만 사용할 수 있습니다'))
  return t.sftp()
}

const p = <T>(fn: (cb: (err: Error | null | undefined, v: T) => void) => void): Promise<T> =>
  new Promise((res, rej) => fn((err, v) => (err ? rej(err) : res(v))))

function permString(mode: number): string {
  const t = (mode & 0o170000) === 0o040000 ? 'd' : (mode & 0o170000) === 0o120000 ? 'l' : '-'
  const r = (b: number, c: string): string => (mode & b ? c : '-')
  return t + r(0o400, 'r') + r(0o200, 'w') + r(0o100, 'x') + r(0o040, 'r') + r(0o020, 'w') + r(0o010, 'x') + r(0o004, 'r') + r(0o002, 'w') + r(0o001, 'x')
}

const homeCache = new Map<string, string>()

export async function home(sessionId: string): Promise<string> {
  const c = homeCache.get(sessionId)
  if (c) return c
  const s = await sftpOf(sessionId)
  const h = await p<string>((cb) => s.realpath('.', cb))
  homeCache.set(sessionId, h)
  return h
}

async function expand(sessionId: string, path: string): Promise<string> {
  if (path === '~' || path.startsWith('~/')) return posix.join(await home(sessionId), path.slice(1))
  return path
}

export async function list(sessionId: string, path: string): Promise<{ path: string; entries: SftpEntry[] }> {
  const s = await sftpOf(sessionId)
  const expanded = await expand(sessionId, path || '~')
  const real = await p<string>((cb) => s.realpath(expanded, cb)).catch(() => expanded)
  const items = await p<{ filename: string; attrs: Stats }[]>((cb) => s.readdir(real, cb as never))
  const entries: SftpEntry[] = items
    .filter((i) => i.filename !== '.' && i.filename !== '..')
    .map((i) => {
      const mode = i.attrs.mode ?? 0
      const isLink = (mode & 0o170000) === 0o120000
      return {
        name: i.filename,
        path: posix.join(real, i.filename),
        isDir: (mode & 0o170000) === 0o040000,
        isLink,
        size: i.attrs.size ?? 0,
        mtime: (i.attrs.mtime ?? 0) * 1000,
        mode,
        perm: permString(mode)
      }
    })
  // resolve symlinks to dirs
  await Promise.all(
    entries.filter((e) => e.isLink).map(async (e) => {
      try {
        const st = await p<Stats>((cb) => s.stat(e.path, cb))
        e.isDir = st.isDirectory()
      } catch { /* broken link */ }
    })
  )
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return { path: real, entries }
}

export async function mkdir(sessionId: string, path: string): Promise<void> {
  const s = await sftpOf(sessionId)
  await p<void>((cb) => s.mkdir(path, cb as never))
}

async function mkdirp(s: SFTPWrapper, path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean)
  let cur = path.startsWith('/') ? '' : '.'
  for (const part of parts) {
    cur = cur === '' ? '/' + part : cur + '/' + part
    try {
      await p<Stats>((cb) => s.stat(cur, cb))
    } catch {
      await p<void>((cb) => s.mkdir(cur, cb as never)).catch(() => {})
    }
  }
}

export async function rename(sessionId: string, from: string, to: string): Promise<void> {
  const s = await sftpOf(sessionId)
  await p<void>((cb) => s.rename(from, to, cb as never))
}

export async function chmod(sessionId: string, path: string, mode: number): Promise<void> {
  const s = await sftpOf(sessionId)
  await p<void>((cb) => s.chmod(path, mode, cb as never))
}

async function removeRec(s: SFTPWrapper, path: string): Promise<void> {
  const st = await p<Stats>((cb) => s.lstat(path, cb))
  if (st.isDirectory()) {
    const items = await p<{ filename: string }[]>((cb) => s.readdir(path, cb as never))
    for (const i of items) if (i.filename !== '.' && i.filename !== '..') await removeRec(s, posix.join(path, i.filename))
    await p<void>((cb) => s.rmdir(path, cb as never))
  } else {
    await p<void>((cb) => s.unlink(path, cb as never))
  }
}

export async function remove(sessionId: string, paths: string[]): Promise<void> {
  const s = await sftpOf(sessionId)
  for (const path of paths) await removeRec(s, path)
}

// ---------------- transfers ----------------

const queues = new Map<string, Promise<unknown>>()

function enqueue<T>(sessionId: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(sessionId) ?? Promise.resolve()
  const next = prev.then(job, job)
  queues.set(sessionId, next.catch(() => {}))
  return next
}

function update(t: Transfer): void {
  send('transfer:update', { ...t })
}

async function putFile(s: SFTPWrapper, t: Transfer, local: string, remote: string): Promise<void> {
  t.state = 'running'
  update(t)
  let last = 0
  await p<void>((cb) =>
    s.fastPut(local, remote, {
      concurrency: 32,
      step: (done: number, _chunk: number, total: number) => {
        t.bytes = done
        t.total = total
        const now = Date.now()
        if (now - last > 150) { last = now; update(t) }
      }
    }, cb as never)
  )
}

async function getFile(s: SFTPWrapper, t: Transfer, remote: string, local: string): Promise<void> {
  t.state = 'running'
  update(t)
  let last = 0
  await p<void>((cb) =>
    s.fastGet(remote, local, {
      concurrency: 32,
      step: (done: number, _chunk: number, total: number) => {
        t.bytes = done
        t.total = total
        const now = Date.now()
        if (now - last > 150) { last = now; update(t) }
      }
    }, cb as never)
  )
}

async function uploadPath(s: SFTPWrapper, sessionId: string, local: string, remoteDir: string): Promise<string> {
  const st = await fs.stat(local)
  const remote = posix.join(remoteDir, basename(local))
  if (st.isDirectory()) {
    await p<void>((cb) => s.mkdir(remote, cb as never)).catch(() => {})
    for (const f of await fs.readdir(local)) await uploadPath(s, sessionId, join(local, f), remote)
    return remote
  }
  const t: Transfer = { id: randomUUID(), sessionId, name: basename(local), direction: 'up', bytes: 0, total: st.size, state: 'queued', remotePath: remote, localPath: local }
  update(t)
  try {
    await putFile(s, t, local, remote)
    t.state = 'done'
    t.bytes = t.total
  } catch (e) {
    t.state = 'error'
    t.error = (e as Error).message
  }
  update(t)
  if (t.state === 'error') throw new Error(t.error)
  return remote
}

export function upload(sessionId: string, localPaths: string[], remoteDir: string): Promise<string[]> {
  return enqueue(sessionId, async () => {
    const s = await sftpOf(sessionId)
    const dir = await expand(sessionId, remoteDir)
    const out: string[] = []
    for (const l of localPaths) out.push(await uploadPath(s, sessionId, l, dir))
    return out
  })
}

async function downloadPath(s: SFTPWrapper, sessionId: string, remote: string, localDir: string): Promise<void> {
  const st = await p<Stats>((cb) => s.stat(remote, cb))
  const local = join(localDir, posix.basename(remote))
  if (st.isDirectory()) {
    await fs.mkdir(local, { recursive: true })
    const items = await p<{ filename: string }[]>((cb) => s.readdir(remote, cb as never))
    for (const i of items) if (i.filename !== '.' && i.filename !== '..') await downloadPath(s, sessionId, posix.join(remote, i.filename), local)
    return
  }
  const t: Transfer = { id: randomUUID(), sessionId, name: posix.basename(remote), direction: 'down', bytes: 0, total: st.size ?? 0, state: 'queued', remotePath: remote, localPath: local }
  update(t)
  try {
    await getFile(s, t, remote, local)
    t.state = 'done'
    t.bytes = t.total
  } catch (e) {
    t.state = 'error'
    t.error = (e as Error).message
  }
  update(t)
}

export function download(sessionId: string, remotePaths: string[], localDir: string): Promise<void> {
  return enqueue(sessionId, async () => {
    const s = await sftpOf(sessionId)
    for (const r of remotePaths) await downloadPath(s, sessionId, r, localDir)
  })
}

// ---------------- clipboard / prompt uploads (Claude Code CLI etc.) ----------------

function readClipboardFiles(): string[] {
  try {
    if (process.platform === 'win32') {
      const buf = clipboard.readBuffer('FileNameW')
      if (buf.length) {
        const s = buf.toString('ucs2').replace(/\0+$/, '').split('\0').filter(Boolean)
        return s
      }
    } else {
      if (process.platform === 'darwin') {
        // Finder copies every selected file into a plist here; public.file-url only carries the first one
        const plist = clipboard.read('NSFilenamesPboardType')
        const paths = [...plist.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
        if (paths.length) return paths
      }
      const uri = clipboard.read('text/uri-list') || clipboard.read('public.file-url')
      if (uri) return uri.split(/\r?\n/).filter((u) => u.startsWith('file://')).map((u) => decodeURIComponent(u.replace('file://', '')))
    }
  } catch { /* */ }
  return []
}

export function clipboardInfo(): ClipboardInfo {
  const files = readClipboardFiles().filter((f) => { try { return statSync(f).isFile() || statSync(f).isDirectory() } catch { return false } })
  if (files.length) return { type: 'files', files }
  const text = clipboard.readText()
  if (text) return { type: 'text', text }
  const img = clipboard.readImage()
  if (!img.isEmpty()) return { type: 'image', imageSize: img.getSize() }
  return { type: 'empty' }
}

export function clipboardHasImage(): boolean {
  return !clipboard.readImage().isEmpty()
}

function stamp(): string {
  const d = new Date()
  const z = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
}

async function cleanup(s: SFTPWrapper, dir: string, days: number): Promise<void> {
  if (!days || days <= 0) return
  try {
    const items = await p<{ filename: string; attrs: Stats }[]>((cb) => s.readdir(dir, cb as never))
    const cutoff = Date.now() / 1000 - days * 86400
    for (const i of items) {
      if (i.filename.startsWith('bt-') && (i.attrs.mtime ?? 0) < cutoff) {
        await p<void>((cb) => s.unlink(posix.join(dir, i.filename), cb as never)).catch(() => {})
      }
    }
  } catch { /* */ }
}

/**
 * Upload clipboard image or local files into the configured upload folder on the server and
 * return the remote paths, so they can be typed into the terminal (e.g. Claude Code CLI prompt).
 */
export function uploadForPrompt(sessionId: string, source: { kind: 'clipboardImage' } | { kind: 'files'; paths: string[] } | { kind: 'buffer'; name: string; data: Uint8Array }): Promise<string[]> {
  return enqueue(sessionId, async () => {
    const s = await sftpOf(sessionId)
    const settings = store.get().settings
    const dir = await expand(sessionId, settings.uploadDir || '~/.brightterm/uploads')
    await mkdirp(s, dir)
    const rand = (): string => Math.random().toString(36).slice(2, 6)
    const out: string[] = []

    const writeBuf = async (name: string, data: Buffer): Promise<string> => {
      const remote = posix.join(dir, name)
      const t: Transfer = { id: randomUUID(), sessionId, name, direction: 'up', bytes: 0, total: data.length, state: 'running', remotePath: remote }
      update(t)
      await p<void>((cb) => s.writeFile(remote, data, cb as never))
      t.state = 'done'
      t.bytes = data.length
      update(t)
      return remote
    }

    if (source.kind === 'clipboardImage') {
      const img = clipboard.readImage()
      if (img.isEmpty()) throw new Error('클립보드에 이미지가 없습니다')
      out.push(await writeBuf(`bt-${stamp()}-${rand()}.png`, img.toPNG()))
    } else if (source.kind === 'buffer') {
      const ext = extname(source.name) || '.png'
      out.push(await writeBuf(`bt-${stamp()}-${rand()}${ext}`, Buffer.from(source.data)))
    } else {
      for (const f of source.paths) {
        const st = await fs.stat(f)
        const safe = basename(f).replace(/[\s'"`$\\]/g, '_')
        const name = `bt-${stamp()}-${rand()}-${safe}`
        if (st.isDirectory()) {
          out.push(await uploadPath(s, sessionId, f, dir))
          continue
        }
        const remote = posix.join(dir, name)
        const t: Transfer = { id: randomUUID(), sessionId, name: basename(f), direction: 'up', bytes: 0, total: st.size, state: 'queued', remotePath: remote, localPath: f }
        update(t)
        await putFile(s, t, f, remote)
        t.state = 'done'
        t.bytes = t.total
        update(t)
        out.push(remote)
      }
    }
    cleanup(s, dir, settings.uploadCleanupDays)
    return out
  })
}

const IMG_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' }

export async function preview(sessionId: string, path: string): Promise<{ kind: 'image' | 'text'; data: string } | null> {
  const s = await sftpOf(sessionId)
  const st = await p<Stats>((cb) => s.stat(path, cb))
  const ext = extname(path).toLowerCase()
  if (IMG_MIME[ext]) {
    if ((st.size ?? 0) > 20 * 1024 * 1024) return null
    const buf = await p<Buffer>((cb) => s.readFile(path, cb as never))
    return { kind: 'image', data: `data:${IMG_MIME[ext]};base64,${buf.toString('base64')}` }
  }
  if ((st.size ?? 0) > 512 * 1024) return null
  const buf = await p<Buffer>((cb) => s.readFile(path, cb as never))
  if (buf.includes(0)) return null
  return { kind: 'text', data: buf.toString('utf8') }
}

const watchers = new Map<string, FSWatcher>()

/** Download to temp, open with default app, upload back on every save. */
export async function editRemote(sessionId: string, remote: string): Promise<string> {
  const s = await sftpOf(sessionId)
  const dir = join(app.getPath('temp'), 'brightterm-edit', randomUUID().slice(0, 8))
  await fs.mkdir(dir, { recursive: true })
  const local = join(dir, posix.basename(remote))
  await p<void>((cb) => s.fastGet(remote, local, cb as never))
  const key = sessionId + ':' + remote
  watchers.get(key)?.close()
  let timer: NodeJS.Timeout | null = null
  let lastMtime = (await fs.stat(local)).mtimeMs
  const w = watch(local, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        const m = (await fs.stat(local)).mtimeMs
        if (m === lastMtime) return
        lastMtime = m
        const s2 = await sftpOf(sessionId)
        await p<void>((cb) => s2.fastPut(local, remote, cb as never))
        send('toast', { kind: 'ok', text: `${posix.basename(remote)} 저장됨 → 서버에 업로드 완료` })
      } catch (e) {
        send('toast', { kind: 'error', text: `업로드 실패: ${(e as Error).message}` })
      }
    }, 400)
  })
  watchers.set(key, w)
  const err = await shell.openPath(local)
  if (err) throw new Error(err)
  return local
}

export function forgetSession(sessionId: string): void {
  homeCache.delete(sessionId)
  queues.delete(sessionId)
  for (const [k, w] of watchers) if (k.startsWith(sessionId + ':')) { w.close(); watchers.delete(k) }
}
