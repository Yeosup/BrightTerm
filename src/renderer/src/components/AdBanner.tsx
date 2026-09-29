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

function pick(list: Shown[]): Shown | undefined {
  const total = list.reduce((a, b) => a + (b.weight ?? 1), 0)
  let r = Math.random() * total
  for (const b of list) if ((r -= b.weight ?? 1) < 0) return b
  return list[0]
}

export function AdBanner({ slot }: { slot: BannerSlot }): JSX.Element | null {
  const [banner, setBanner] = useState<Shown | undefined>()
  useEffect(() => {
    const load = (): void => {
      api.ads.get().then((all) => {
        const now = Date.now()
        const remote = all.filter((b) => b.slot === slot && live(b, now))
        setBanner(pick(remote.length ? remote : BUILTIN[slot]))
      }).catch(() => setBanner(pick(BUILTIN[slot])))
    }
    load()
    return api.on.ads(load)
  }, [slot])
  if (!banner) return null
  return (
    <button type="button" className={`ad-banner ad-${slot}`} title={banner.alt} onClick={() => api.app.openBanner(banner.link)}>
      <img src={banner.image} alt={banner.alt} draggable={false} />
      <span className="ad-tag">광고</span>
    </button>
  )
}
