import { app, net } from 'electron'
import { store } from './store'
import { send } from './ui'
import type { UpdateInfo } from '@shared/types'

/**
 * 새 버전 알림. GitHub 공개 릴리스의 latest 하나만 읽는다(pre-release 는 제외된다).
 * 보안 원칙은 배너와 같다 — 요청에 아무 정보도 붙이지 않고, https 만, 크기 상한.
 * 내려받기·설치는 하지 않는다. 릴리스 페이지를 브라우저로 열어 줄 뿐이다.
 */
const LATEST_URL = 'https://api.github.com/repos/Yeosup/BrightTerm/releases/latest'
const RELEASE_PREFIX = 'https://github.com/Yeosup/BrightTerm/releases/'
const MAX_BODY = 256 * 1024
const EVERY_MS = 12 * 60 * 60 * 1000

let latest: UpdateInfo | null = null

const parse = (v: string): number[] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? m.slice(1).map(Number) : null
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parse(candidate)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

export const updateInfo = (): UpdateInfo | null => latest

/** ok = GitHub 에서 확인했는지, latest = 지금보다 새 버전(없으면 null) */
export async function checkUpdate(): Promise<{ ok: boolean; latest: UpdateInfo | null }> {
  const fail = { ok: false, latest }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 8000)
  try {
    const r = await net.fetch(LATEST_URL, {
      signal: ctl.signal,
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!r.ok) return fail
    const body = Buffer.from(await r.arrayBuffer())
    if (body.length > MAX_BODY) return fail
    const j = JSON.parse(body.toString('utf8')) as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown }
    if (typeof j.tag_name !== 'string' || j.draft || j.prerelease) return fail
    const version = j.tag_name.replace(/^v/, '')
    const url = typeof j.html_url === 'string' && j.html_url.startsWith(RELEASE_PREFIX) ? j.html_url : `${RELEASE_PREFIX}latest`
    const next = isNewer(version, app.getVersion()) ? { version, url } : null
    if (next?.version !== latest?.version) {
      latest = next
      send('update:changed', latest)
    }
    return { ok: true, latest }
  } catch {
    return fail /* 오프라인·사내망: 조용히 넘어간다 */
  } finally {
    clearTimeout(t)
  }
}

/** 시작 직후 한 번, 그 뒤 12시간마다 — 설정에서 끄면 건너뛴다 */
export function startUpdateCheck(): void {
  const run = (): void => {
    if (store.get().settings.checkUpdates) void checkUpdate()
  }
  setTimeout(run, 5000)
  setInterval(run, EVERY_MS)
}
