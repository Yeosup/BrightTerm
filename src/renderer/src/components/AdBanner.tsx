import { useEffect, useState } from 'react'
import { api } from '../api'
import type { BannerSlot } from '@shared/types'
import moduWide from '../assets/banner-moduapp-wide.png'
import moduSide from '../assets/banner-moduapp-side.png'

interface Shown { id: string; image: string; link: string; alt: string; weight?: number; start?: string; end?: string }

const UTM = 'utm_source=brightterm&utm_medium=app_banner&utm_campaign=house'

/** 앱 내장 기본 배너 — 원격 피드가 없거나 오프라인일 때 */
const BUILTIN: Record<BannerSlot, Shown[]> = {
  welcome: [{ id: 'moduapp', image: moduWide, link: `https://moduapp.kr/?${UTM}&utm_content=welcome`, alt: '모두의 앱 — 사람들이 직접 만든 앱, 모두앱이 찾아드려요' }],
  sidebar: [{ id: 'moduapp', image: moduSide, link: `https://moduapp.kr/?${UTM}&utm_content=sidebar`, alt: '모두의 앱 — 인디 앱, 모두앱이 찾아드려요' }]
}

const live = (b: Shown, now: number): boolean => (!b.start || Date.parse(b.start) <= now) && (!b.end || now <= Date.parse(b.end))

function pick(list: Shown[], skip?: Shown): Shown | undefined {
  const pool = skip && list.length > 1 ? list.filter((b) => b !== skip) : list
  const total = pool.reduce((a, b) => a + (b.weight ?? 1), 0)
  let r = Math.random() * total
  for (const b of pool) if ((r -= b.weight ?? 1) < 0) return b
  return pool[0]
}

/** 배너가 여럿이면 이만큼마다 넘긴다(비중대로 무작위, 같은 배너 연속 없음) */
const ROTATE_MS = 8000

/** 앱 창이 앞에 있고 보일 때만 true — 뒤에 있거나 최소화면 넘기지 않는다 */
function useWindowActive(): boolean {
  const get = (): boolean => document.visibilityState === 'visible' && document.hasFocus()
  const [active, setActive] = useState(get)
  useEffect(() => {
    const on = (): void => setActive(get())
    window.addEventListener('focus', on)
    window.addEventListener('blur', on)
    document.addEventListener('visibilitychange', on)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', on)
      document.removeEventListener('visibilitychange', on)
    }
  }, [])
  return active
}

export function AdBanner({ slot }: { slot: BannerSlot }): JSX.Element | null {
  const [list, setList] = useState<Shown[]>([])
  const [banner, setBanner] = useState<Shown | undefined>()
  const [hover, setHover] = useState(false)
  const active = useWindowActive()
  useEffect(() => {
    const apply = (next: Shown[]): void => {
      setList(next)
      setBanner(pick(next))
    }
    const load = (): void => {
      api.ads.get().then((all) => {
        const now = Date.now()
        const remote = all.filter((b) => b.slot === slot && live(b, now))
        apply(remote.length ? remote : BUILTIN[slot])
      }).catch(() => apply(BUILTIN[slot]))
    }
    load()
    return api.on.ads(load)
  }, [slot])
  const rotating = list.length > 1 && !hover && active
  useEffect(() => {
    if (!rotating) return
    const t = setTimeout(() => setBanner((cur) => pick(list, cur)), ROTATE_MS)
    return () => clearTimeout(t)
  }, [rotating, list, banner])
  if (!banner) return null
  return (
    <div className={`ad-banner ad-${slot}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button type="button" className="ad-frame" title={banner.alt} onClick={() => api.app.openBanner(banner.link)}>
        {list.map((b) => (
          <img key={b.id} src={b.image} alt={b === banner ? b.alt : ''} aria-hidden={b !== banner} className={b === banner ? 'on' : ''} draggable={false} />
        ))}
        <span className="ad-tag">광고</span>
      </button>
    </div>
  )
}
