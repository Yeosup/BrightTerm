import type { LayoutNode, PaneNode } from './layout'
import { panes, uid } from './layout'
import { api } from './api'
import { useApp, type Tab } from './state'
import type { SavedLayout, SavedPane, SavedTab, SavedWorkspace, SessionInfo } from '@shared/types'

/**
 * 탭·분할 저장/복원. 창마다 "무엇을 열었나"(서버 id, 로컬이면 시작 폴더)만 기억하고,
 * 다시 켜면 볼트가 열린 뒤 한 번 같은 배치로 새로 접속한다. 저장 없이 바로 연 SSH·시리얼 창은 비밀번호가 필요해 빼 둔다.
 */

function paneSpec(info: SessionInfo | undefined): SavedPane | null {
  if (!info) return null
  if (info.hostId) return { hostId: info.hostId }
  if (info.protocol === 'local') return { local: { cwd: info.target.replace(/^로컬 · /, '').replace(/^~$/, '') || undefined } }
  return null
}

function toSaved(n: LayoutNode, sessions: Record<string, SessionInfo>): SavedLayout | null {
  if (n.type === 'pane') {
    const p = paneSpec(sessions[n.sessionId])
    return p ? { type: 'pane', pane: p } : null
  }
  const kids = n.children.map((c, i) => ({ c: toSaved(c, sessions), s: n.sizes[i] })).filter((x) => x.c) as { c: SavedLayout; s: number }[]
  if (!kids.length) return null
  if (kids.length === 1) return kids[0].c
  const total = kids.reduce((a, k) => a + k.s, 0) || 1
  return { type: 'split', dir: n.dir, sizes: kids.map((k) => (k.s / total) * 100), children: kids.map((k) => k.c) }
}

export function snapshot(): SavedWorkspace {
  const s = useApp.getState()
  const tabs: SavedTab[] = []
  let active = 0
  for (const t of s.tabs) {
    const root = toSaved(t.root, s.sessions)
    if (!root) continue
    const ids = panes(t.root).filter((p) => paneSpec(s.sessions[p.sessionId])).map((p) => p.id)
    if (t.id === s.activeTab) active = tabs.length
    tabs.push({ title: t.title, root, focused: Math.max(0, ids.indexOf(t.focused)), zoomed: t.zoomed ? ids.indexOf(t.zoomed) : null })
  }
  return { tabs, active, savedAt: Date.now() }
}

let restoring = false
let ready = false // 복원이 끝나기 전엔 저장하지 않는다(빈 탭으로 덮어쓰지 않게)
let timer: ReturnType<typeof setTimeout> | null = null
let last = ''

function save(): void {
  if (!ready || restoring) return
  const w = snapshot()
  const key = JSON.stringify(w.tabs) + w.active
  if (key === last) return
  last = key
  api.store.patch({ workspace: w })
}

/** 탭·세션이 바뀔 때마다 1초 뒤 저장. 창을 닫을 때는 바로 */
export function startWorkspaceSaving(): () => void {
  const unsub = useApp.subscribe((s, p) => {
    if (s.tabs === p.tabs && s.activeTab === p.activeTab && s.sessions === p.sessions) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 1000)
  })
  const flush = (): void => { if (timer) clearTimeout(timer); save() }
  window.addEventListener('beforeunload', flush)
  return () => { unsub(); window.removeEventListener('beforeunload', flush) }
}

async function build(n: SavedLayout, out: PaneNode[]): Promise<LayoutNode | null> {
  if (n.type === 'pane') {
    const st = useApp.getState()
    const p = n.pane
    try {
      let info: SessionInfo
      if ('hostId' in p) {
        if (!st.hosts.some((h) => h.id === p.hostId)) return null // 그새 지운 서버
        info = await api.session.open({ hostId: p.hostId })
      } else {
        info = await api.session.open({ adhoc: { host: '', protocol: 'local', cwd: p.local.cwd } })
      }
      useApp.setState((s) => ({ sessions: { ...s.sessions, [info.id]: info } }))
      const pane: PaneNode = { type: 'pane', id: uid(), sessionId: info.id }
      out.push(pane)
      return pane
    } catch {
      return null
    }
  }
  const kids: { c: LayoutNode; s: number }[] = []
  for (let i = 0; i < n.children.length; i++) {
    const c = await build(n.children[i], out)
    if (c) kids.push({ c, s: n.sizes[i] ?? 1 })
  }
  if (!kids.length) return null
  if (kids.length === 1) return kids[0].c
  return { type: 'split', id: uid(), dir: n.dir, children: kids.map((k) => k.c), sizes: kids.map((k) => k.s) }
}

/** 볼트가 열린 뒤 한 번 */
export async function restoreWorkspace(saved: SavedWorkspace | undefined, enabled: boolean): Promise<void> {
  if (ready || restoring) return
  if (!enabled || !saved?.tabs.length || useApp.getState().tabs.length) {
    ready = true
    return
  }
  restoring = true
  try {
    const tabs: Tab[] = []
    let activeTab: string | null = null
    for (let i = 0; i < saved.tabs.length; i++) {
      const t = saved.tabs[i]
      const ps: PaneNode[] = []
      const root = await build(t.root, ps)
      if (!root) continue
      const tab: Tab = { id: uid(), root, focused: (ps[t.focused] ?? ps[0]).id, broadcast: false, title: t.title, zoomed: t.zoomed != null && ps[t.zoomed] ? ps[t.zoomed].id : null }
      tabs.push(tab)
      if (i === saved.active) activeTab = tab.id
    }
    if (tabs.length) useApp.setState((s) => ({ tabs: [...s.tabs, ...tabs], activeTab: activeTab ?? tabs[0].id }))
  } finally {
    restoring = false
    ready = true
  }
}

