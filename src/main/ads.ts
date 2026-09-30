import { net } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { dataDir, readJson, writeJsonAtomicSync } from './store'
import { send } from './ui'
import type { Banner, BannerSlot } from '@shared/types'

/**
 * 배너 피드. 보안 원칙:
 *  - 요청에는 아무 정보도 붙이지 않는다(쿼리·쿠키·서버 목록 없음). 받는 쪽이 아는 건 IP 와 앱 버전(User-Agent)뿐
 *  - 피드는 이미지 URL + 링크 + 대체 문구만. HTML·스크립트는 받지 않는다
 *  - https 만, 크기 상한, 이미지 형식 확인. 이미지는 메인이 받아 data: URL 로 넘겨 렌더러는 외부에 접속하지 않는다
 *  - 실패하면 조용히 캐시 → 앱 내장 기본 배너 순으로 떨어진다
 */
// 배너는 모두의 앱 관리자(moduapp.kr/admin/banners)에서 관리 — 앱 재배포 불필요. 빈 문자열로 덮으면 끈다
// (1.0.0 은 저장소 banners/feed.json 을 읽는다 — 그 파일은 구버전용으로 남겨 둔다)
export const BANNER_FEED_URL = process.env.BRIGHTTERM_BANNER_FEED ?? 'https://moduapp.kr/api/banners/brightterm'

const MAX_FEED = 64 * 1024
const MAX_IMAGE = 768 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const SLOTS: BannerSlot[] = ['welcome', 'sidebar']

export interface ResolvedBanner extends Omit<Banner, 'image'> { image: string /* data: URL */ }
interface Cache { fetchedAt: number; banners: ResolvedBanner[] }

const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u) && u.length < 2048

export function validateFeed(raw: unknown): Banner[] {
  const list = Array.isArray(raw) ? raw : (raw as { banners?: unknown })?.banners
  if (!Array.isArray(list)) return []
  const out: Banner[] = []
  for (const b of list.slice(0, 20)) {
    if (!b || typeof b !== 'object') continue
    const x = b as Record<string, unknown>
    if (typeof x.id !== 'string' || !SLOTS.includes(x.slot as BannerSlot) || !isHttps(x.image) || !isHttps(x.link)) continue
    out.push({
      id: x.id.slice(0, 64),
      slot: x.slot as BannerSlot,
      image: x.image,
      link: x.link,
      alt: typeof x.alt === 'string' ? x.alt.slice(0, 120) : '',
      weight: typeof x.weight === 'number' && x.weight > 0 ? Math.min(x.weight, 100) : 1,
      start: typeof x.start === 'string' ? x.start : undefined,
      end: typeof x.end === 'string' ? x.end : undefined
    })
  }
  return out
}

async function get(url: string, max: number): Promise<{ type: string; body: Buffer }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 8000)
  try {
    const r = await net.fetch(url, { signal: ctl.signal, credentials: 'omit', cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    // Electron net.fetch 는 url 을 비워 줄 때가 있다 — 값이 있을 때만 검사
    if (r.url && !r.url.startsWith('https://')) throw new Error('redirected off https')
    const body = Buffer.from(await r.arrayBuffer())
    if (body.length > max) throw new Error('too large')
    return { type: (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), body }
  } finally {
    clearTimeout(t)
  }
}

const cacheFile = (): string => join(dataDir(), 'banners.json')

export function cachedBanners(): ResolvedBanner[] {
  return readJson<Cache>(cacheFile())?.banners ?? []
}

let refreshing = false
/** 앱 시작 때 한 번. 새 목록을 받으면 렌더러에 알린다. */
export async function refreshBanners(): Promise<void> {
  if (!BANNER_FEED_URL || refreshing) return
  refreshing = true
  try {
    const feed = await get(BANNER_FEED_URL, MAX_FEED)
    const banners = validateFeed(JSON.parse(feed.body.toString('utf8')))
    const prev = new Map(cachedBanners().map((b) => [b.id + b.link, b]))
    const resolved: ResolvedBanner[] = []
    for (const b of banners) {
      try {
        const img = await get(b.image, MAX_IMAGE)
        if (!IMAGE_TYPES.includes(img.type)) continue
        resolved.push({ ...b, image: `data:${img.type};base64,${img.body.toString('base64')}` })
      } catch {
        const old = prev.get(b.id + b.link) // 이미지만 실패하면 전에 받아 둔 것을 쓴다
        if (old) resolved.push({ ...old, ...b, image: old.image })
      }
    }
    const before = createHash('sha1').update(JSON.stringify(cachedBanners())).digest('hex')
    writeJsonAtomicSync(cacheFile(), { fetchedAt: Date.now(), banners: resolved } satisfies Cache)
    if (createHash('sha1').update(JSON.stringify(resolved)).digest('hex') !== before) send('ads:changed')
  } catch {
    /* 오프라인·사내망: 캐시나 내장 배너로 */
  } finally {
    refreshing = false
  }
}
