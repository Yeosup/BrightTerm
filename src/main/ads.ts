import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { dataDir } from './store'

/** 1.3.0 에서 광고 배너를 뺐다 — 이전 버전이 남긴 배너 캐시만 지운다(피드 요청 없음). */
export function removeBannerCache(): void {
  try {
    for (const f of ['banners.json', 'banners.json.bak'].map((n) => join(dataDir(), n))) if (existsSync(f)) unlinkSync(f)
  } catch { /* */ }
}
