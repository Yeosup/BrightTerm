import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { hostname } from 'os'
import { join } from 'path'
import type { Group, Host, KnownHost, Snippet, SyncStatus } from '@shared/types'
import { dataDir, readJson, store, writeJsonAtomicSync } from './store'
import { vault, type VaultFile, type VaultEnc } from './vault'

/*
 * 접속 정보·볼트 git 동기화.
 *   저장소에는 파일 하나(brightterm-sync.json)만 둔다:
 *     vault — 원래부터 암호문(볼트 키를 마스터 비밀번호·복구 코드로 감싼 것 + 계정별 AES-GCM). osWrapped(기기 전용)는 뺀다
 *     data  — 서버·폴더·스니펫·알려진 호스트를 **볼트 키로** AES-GCM 암호화 → 저장소엔 IP·계정명도 평문으로 안 남는다
 *   다른 PC 는 같은 볼트(같은 마스터 비밀번호)로 연다. 볼트 키가 다르면 'mismatch' — 사용자가 받기/덮어쓰기를 고른다.
 *   병합 = 마지막 동기화 결과(base, 이 PC 에만 저장)를 기준으로 항목마다 3방향 병합:
 *     한쪽만 바꿨으면 그쪽, 양쪽이 같게 바꿨으면 그대로, 양쪽이 다르게 바꿨으면 이 PC 것(계정은 더 최근 것).
 *     그래서 한쪽에서 지운 항목은 지운 채로 남는다(합집합이 아니다).
 *   git 은 시스템 git 을 그대로 쓴다(인증 = SSH 키·자격 증명 도우미). 비밀번호 창은 띄우지 않는다(GIT_TERMINAL_PROMPT=0).
 */

const FILE = 'brightterm-sync.json'
const DATA_AAD = 'brightterm-sync-data'

type SyncVault = Omit<VaultFile, 'osWrapped'>
interface SyncData { groups: Group[]; hosts: Host[]; snippets: Snippet[]; knownHosts: KnownHost[] }
interface SyncDoc { app: 'brightterm-sync'; version: 1; updatedAt: number; device: string; vault: SyncVault; data: VaultEnc }
interface Snapshot { vault: SyncVault; data: SyncData }

const repoDir = (): string => join(dataDir(), 'sync-repo')
const baseFile = (): string => join(dataDir(), 'sync-base.json')

let status: SyncStatus = { state: 'off' }
let running: Promise<SyncStatus> | null = null
let applying = false
let notify: (s: SyncStatus) => void = () => {}
let afterApply: () => void = () => {}

function setStatus(s: Partial<SyncStatus>): SyncStatus {
  status = { ...status, ...s }
  notify(status)
  return status
}

export function syncStatus(): SyncStatus {
  return store.get().settings.sync.remote ? status : { ...status, state: 'off' }
}

// ---------------- git ----------------

const GIT_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

function git(args: string[], cwd = repoDir()): Promise<string> {
  const env = {
    ...process.env,
    PATH: [process.env.PATH, ...GIT_PATHS].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
    GIT_TERMINAL_PROMPT: '0',
    // 호스트 키 확인·암호 입력 창이 뜨면 영영 기다리게 된다 — 처음 보는 호스트는 받아들이고, 묻는 것은 실패로
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new'
  }
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || err.message).trim().split('\n').filter((l) => !/^hint:/.test(l)).slice(-3).join(' ')
        reject(new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'git 을 찾을 수 없습니다 — git 을 설치해 주세요' : msg))
      } else resolve(stdout)
    })
  })
}

async function prepareRepo(remote: string, branch: string): Promise<boolean> {
  const dir = repoDir()
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true })
    await git(['init', '-q'])
    await git(['remote', 'add', 'origin', remote])
  } else {
    const cur = (await git(['remote', 'get-url', 'origin']).catch(() => '')).trim()
    if (cur !== remote) {
      if (cur) await git(['remote', 'set-url', 'origin', remote])
      else await git(['remote', 'add', 'origin', remote])
    }
  }
  await git(['fetch', '-q', 'origin'])
  const hasRemote = await git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`]).then(() => true, () => false)
  if (hasRemote) await git(['checkout', '-q', '-f', '-B', branch, `origin/${branch}`])
  else await git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
  return hasRemote
}

// ---------------- 3방향 병합 ----------------

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))
}

function merge3<T>(base: T[] | undefined, local: T[], remote: T[], key: (x: T) => string, prefer?: (l: T, r: T) => T): { out: T[]; pulled: number; conflicts: number } {
  const B = new Map((base ?? []).map((x) => [key(x), x]))
  const L = new Map(local.map((x) => [key(x), x]))
  const R = new Map(remote.map((x) => [key(x), x]))
  const order = [...L.keys(), ...[...R.keys()].filter((k) => !L.has(k))]
  for (const k of B.keys()) if (!order.includes(k)) order.push(k)
  const out: T[] = []
  let pulled = 0
  let conflicts = 0
  const eq = (a?: T, b?: T): boolean => (a === undefined || b === undefined ? a === b : stable(a) === stable(b))
  for (const k of order) {
    const l = L.get(k), r = R.get(k), b = B.get(k)
    let v: T | undefined
    if (eq(l, r)) v = l
    else if (base && eq(l, b)) { v = r; pulled++ } // 원격만 바꿈(지움 포함)
    else if (base && eq(r, b)) v = l // 이 PC 만 바꿈
    else if (!base && l === undefined) { v = r; pulled++ } // 첫 동기화: 합집합
    else if (!base && r === undefined) v = l
    else { v = l && r && prefer ? prefer(l, r) : l ?? r; conflicts++; if (v === r) pulled++ }
    if (v !== undefined) out.push(v)
  }
  return { out, pulled, conflicts }
}

/** lastUsedAt 은 접속할 때마다 바뀌어 매번 충돌·커밋이 생긴다 — 이 PC 에만 둔다 */
function localData(): SyncData {
  const d = store.get()
  return {
    groups: d.groups,
    hosts: d.hosts.map(({ lastUsedAt: _l, ...h }) => h as Host),
    snippets: d.snippets,
    knownHosts: d.knownHosts
  }
}

function merge(base: Snapshot | null, local: Snapshot, remote: Snapshot): { result: Snapshot; pulled: number; conflicts: number } {
  let pulled = 0
  let conflicts = 0
  const m = <T>(b: T[] | undefined, l: T[], r: T[], key: (x: T) => string, prefer?: (l: T, r: T) => T): T[] => {
    const x = merge3(b, l, r, key, prefer)
    pulled += x.pulled
    conflicts += x.conflicts
    return x.out
  }
  const data: SyncData = {
    groups: m(base?.data.groups, local.data.groups, remote.data.groups, (g) => g.id),
    hosts: m(base?.data.hosts, local.data.hosts, remote.data.hosts, (h) => h.id),
    snippets: m(base?.data.snippets, local.data.snippets, remote.data.snippets, (s) => s.id),
    knownHosts: m(base?.data.knownHosts, local.data.knownHosts, remote.data.knownHosts, (k) => k.hostPort)
  }
  const items = m(base?.vault.items, local.vault.items, remote.vault.items, (i) => i.id, (l, r) => (r.updatedAt > l.updatedAt ? r : l))
  // 볼트 키를 감싼 부분(마스터 비밀번호·복구 코드) — 이 PC 에서 안 바꿨으면 원격 것(다른 PC 에서 비밀번호를 바꿨을 수 있다)
  const wrapOf = (v: SyncVault): string => stable({ kdf: v.kdf, wrapped: v.wrapped, recoveryKdf: v.recoveryKdf, recoveryWrapped: v.recoveryWrapped })
  const takeRemoteWrap = !!base && wrapOf(local.vault) === wrapOf(base.vault) && wrapOf(remote.vault) !== wrapOf(local.vault)
  const w = takeRemoteWrap ? remote.vault : local.vault
  return { result: { vault: { ...w, items }, data }, pulled, conflicts }
}

function applyLocal(s: Snapshot, before: Snapshot): number {
  applying = true
  try {
    let n = 0
    if (stable(s.data) !== stable(before.data)) {
      const used = new Map(store.get().hosts.map((h) => [h.id, h.lastUsedAt]))
      store.patch({ ...s.data, hosts: s.data.hosts.map((h) => ({ ...h, lastUsedAt: used.get(h.id) })) })
      n++
    }
    if (stable(s.vault) !== stable(before.vault)) {
      vault.applySync(s.vault)
      n++
    }
    if (n) afterApply()
    return n
  } finally {
    applying = false
  }
}

// ---------------- 실행 ----------------

export type SyncMode = 'merge' | 'takeRemote' | 'pushLocal'

export function runSync(mode: SyncMode = 'merge'): Promise<SyncStatus> {
  if (running) return running
  running = doSync(mode, 0).finally(() => { running = null })
  return running
}

async function doSync(mode: SyncMode, attempt: number): Promise<SyncStatus> {
  const cfg = store.get().settings.sync
  if (!cfg.remote.trim()) return setStatus({ state: 'off' })
  if (!vault.isUnlocked() && mode !== 'takeRemote') return setStatus({ state: 'error', error: '볼트를 먼저 여세요' })
  setStatus({ state: 'running', error: undefined })
  try {
    const branch = cfg.branch.trim() || 'main'
    const hadRemote = await prepareRepo(cfg.remote.trim(), branch)
    const file = join(repoDir(), FILE)
    const doc = hadRemote && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SyncDoc) : null
    if (doc && doc.app !== 'brightterm-sync') throw new Error(`${FILE} 이 BrightTerm 동기화 파일이 아닙니다`)

    if (mode === 'takeRemote') {
      // 이 PC 볼트를 원격 볼트로 바꾼다 → 잠김 → 원격 마스터 비밀번호로 열면 base 없이 병합(합집합)
      if (!doc) throw new Error('저장소에 받을 동기화 파일이 없습니다')
      vault.importRaw(doc.vault as VaultFile)
      writeJsonAtomicSync(baseFile(), null)
      return setStatus({ state: 'idle', lastSyncAt: Date.now(), pulled: 0, pushed: false, conflicts: 0 })
    }

    const local: Snapshot = { vault: vault.exportForSync()!, data: localData() }
    let remote: Snapshot | null = null
    if (doc) {
      const plain = vault.openWithKey(doc.data, DATA_AAD)
      if (plain === null && mode !== 'pushLocal') {
        return setStatus({ state: 'mismatch', error: '저장소의 볼트가 이 PC 볼트와 다릅니다(다른 마스터 비밀번호로 만든 볼트)' })
      }
      if (plain !== null) remote = { vault: doc.vault, data: JSON.parse(plain) as SyncData }
    }
    const base = readJson<Snapshot>(baseFile())
    const { result, pulled, conflicts } = mode === 'pushLocal' || !remote ? { result: local, pulled: 0, conflicts: 0 } : merge(base, local, remote)
    applyLocal(result, local)

    let pushed = false
    if (!remote || stable(result) !== stable(remote)) {
      const out: SyncDoc = { app: 'brightterm-sync', version: 1, updatedAt: Date.now(), device: hostname(), vault: result.vault, data: vault.sealWithKey(JSON.stringify(result.data), DATA_AAD) }
      writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
      await git(['add', FILE])
      await git(['-c', 'user.name=BrightTerm', '-c', 'user.email=brightterm@localhost', 'commit', '-q', '-m', `sync from ${hostname()}`])
      try {
        await git(['push', '-q', 'origin', `HEAD:refs/heads/${branch}`])
      } catch (e) {
        // 그사이 다른 PC 가 올렸으면 한 번 더 받아서 병합
        if (attempt === 0 && /rejected|fetch first|non-fast-forward/i.test((e as Error).message)) return doSync(mode, 1)
        throw e
      }
      pushed = true
    }
    writeJsonAtomicSync(baseFile(), result)
    return setStatus({ state: 'idle', lastSyncAt: Date.now(), pulled, pushed, conflicts, error: undefined })
  } catch (e) {
    return setStatus({ state: 'error', error: (e as Error).message })
  }
}

// ---------------- 자동 ----------------

let debounce: ReturnType<typeof setTimeout> | null = null

function schedule(ms: number): void {
  if (applying || !store.get().settings.sync.auto || !store.get().settings.sync.remote || !vault.isUnlocked()) return
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => { debounce = null; void runSync('merge') }, ms)
}

export function startSync(opts: { onStatus: (s: SyncStatus) => void; onApplied: () => void }): void {
  notify = opts.onStatus
  afterApply = opts.onApplied
  store.onDataChange = () => schedule(20_000)
  vault.onDataChange = () => schedule(20_000)
  setInterval(() => schedule(0), 10 * 60_000)
}

/** 볼트를 열었을 때 */
export function syncOnUnlock(): void {
  schedule(1500)
}
