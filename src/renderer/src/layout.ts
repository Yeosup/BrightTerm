export type Dir = 'row' | 'col'
export interface PaneNode { type: 'pane'; id: string; sessionId: string }
export interface SplitNode { type: 'split'; id: string; dir: Dir; children: LayoutNode[]; sizes: number[] }
export type LayoutNode = PaneNode | SplitNode

export const uid = (): string => Math.random().toString(36).slice(2, 10)

export function panes(n: LayoutNode): PaneNode[] {
  return n.type === 'pane' ? [n] : n.children.flatMap(panes)
}

export function findPane(n: LayoutNode, id: string): PaneNode | undefined {
  return panes(n).find((p) => p.id === id)
}

/** 빈 칸 — 창을 닫아도 분할 자리를 남겨 두고, 그 자리에 다시 열 수 있게(sessionId 가 빈 문자열). */
export const isEmptyPane = (p: PaneNode): boolean => !p.sessionId

export function emptyPane(): PaneNode {
  return { type: 'pane', id: uid(), sessionId: '' }
}

export function setPaneSession(root: LayoutNode, paneId: string, sessionId: string): LayoutNode {
  if (root.type === 'pane') return root.id === paneId ? { ...root, sessionId } : root
  return { ...root, children: root.children.map((c) => setPaneSession(c, paneId, sessionId)) }
}

/** 두 칸의 내용(세션)을 맞바꾼다 — 칸 자리·크기는 그대로 */
export function swapPanes(root: LayoutNode, a: string, b: string): LayoutNode {
  const pa = findPane(root, a)
  const pb = findPane(root, b)
  if (!pa || !pb || a === b) return root
  return setPaneSession(setPaneSession(root, a, pb.sessionId), b, pa.sessionId)
}

/** src 칸을 빼서 target 칸의 dir 방향(before=왼쪽·위)으로 붙인다 */
export function movePane(root: LayoutNode, src: string, target: string, dir: Dir, before: boolean): LayoutNode {
  const p = findPane(root, src)
  if (!p || src === target) return root
  const rest = removePane(root, src)
  if (!rest || !findPane(rest, target)) return root
  return splitPane(rest, target, dir, p, before)
}

/** Split `targetId` pane, placing `newPane` after it (before=true: before it) in direction dir. */
export function splitPane(root: LayoutNode, targetId: string, dir: Dir, newPane: PaneNode, before = false): LayoutNode {
  const rec = (n: LayoutNode): LayoutNode => {
    if (n.type === 'pane') {
      if (n.id !== targetId) return n
      return { type: 'split', id: uid(), dir, children: before ? [newPane, n] : [n, newPane], sizes: [50, 50] }
    }
    // if the target is a direct child and this split has same dir, insert as sibling
    const idx = n.children.findIndex((c) => c.type === 'pane' && c.id === targetId)
    if (idx >= 0 && n.dir === dir) {
      const children = [...n.children]
      children.splice(before ? idx : idx + 1, 0, newPane)
      const each = 100 / children.length
      return { ...n, children, sizes: children.map(() => each) }
    }
    return { ...n, children: n.children.map(rec) }
  }
  return rec(root)
}

/** Remove a pane; collapses splits with a single child. Returns null when tree becomes empty. */
export function removePane(root: LayoutNode, paneId: string): LayoutNode | null {
  const rec = (n: LayoutNode): LayoutNode | null => {
    if (n.type === 'pane') return n.id === paneId ? null : n
    const kept: LayoutNode[] = []
    const sizes: number[] = []
    n.children.forEach((c, i) => {
      const r = rec(c)
      if (r) { kept.push(r); sizes.push(n.sizes[i]) }
    })
    if (!kept.length) return null
    if (kept.length === 1) return kept[0]
    const total = sizes.reduce((a, b) => a + b, 0)
    return { ...n, children: kept, sizes: sizes.map((s) => (s / total) * 100) }
  }
  return rec(root)
}

export function setSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (root.type === 'pane') return root
  if (root.id === splitId) return { ...root, sizes }
  return { ...root, children: root.children.map((c) => setSizes(c, splitId, sizes)) }
}

/** Build a balanced grid from a list of panes. */
export function grid(ps: PaneNode[]): LayoutNode {
  if (ps.length === 1) return ps[0]
  const cols = Math.ceil(Math.sqrt(ps.length))
  const rows: LayoutNode[] = []
  for (let i = 0; i < ps.length; i += cols) {
    const slice = ps.slice(i, i + cols)
    rows.push(slice.length === 1 ? slice[0] : { type: 'split', id: uid(), dir: 'row', children: slice, sizes: slice.map(() => 100 / slice.length) })
  }
  if (rows.length === 1) return rows[0]
  return { type: 'split', id: uid(), dir: 'col', children: rows, sizes: rows.map(() => 100 / rows.length) }
}

/** Neighbour pane in a direction based on DOM rects. */
export function neighbour(paneIds: string[], current: string, dir: 'left' | 'right' | 'up' | 'down'): string | null {
  const rect = (id: string): DOMRect | undefined => document.querySelector(`[data-pane="${id}"]`)?.getBoundingClientRect()
  const cur = rect(current)
  if (!cur) return null
  const cx = cur.left + cur.width / 2
  const cy = cur.top + cur.height / 2
  let best: string | null = null
  let bestD = Infinity
  for (const id of paneIds) {
    if (id === current) continue
    const r = rect(id)
    if (!r) continue
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const ok = dir === 'left' ? x < cx - 5 : dir === 'right' ? x > cx + 5 : dir === 'up' ? y < cy - 5 : y > cy + 5
    if (!ok) continue
    const d = Math.hypot(x - cx, y - cy)
    if (d < bestD) { bestD = d; best = id }
  }
  return best
}
