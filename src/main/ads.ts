import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { dataDir } from './store'

/** 1.2.5 에서 광고 배너를 뺐다 — 이전 버전이 남긴 배너 캐시만 지운다(피드 요청 없음). */
export function removeBannerCache(): void {
  try {
    const f = join(dataDir(), 'banners.json')
    if (existsSync(f)) unlinkSync(f)
  } catch { /* */ }
}
