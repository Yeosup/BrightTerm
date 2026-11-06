import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LayoutGrid, Plus } from 'lucide-react'
import type { AdhocTarget } from '@shared/types'
import { useApp, type DropZone, type Placement, type Tab } from '../state'
import { LayoutNode, PaneNode, isEmptyPane, panes } from '../layout'
import { Modal } from './ui'
import { refocusTerminal } from '../terms'

/**
 * 사이드바 오른쪽 클릭 → "위치 골라서 연결" — 열린 탭마다 분할 배치를 작게 그려 보여 주고,
 * 칸의 가장자리(←→↑↓)를 누르면 그쪽에 분할해서, 빈 칸은 그 칸에 연다.
 */
export function PlaceDialog({ title, hostId, adhoc }: { title: string; hostId?: string; adhoc?: AdhocTarget }): JSX.Element {
  const tabs = useApp((s) => s.tabs)
  const activeTab = useApp((s) => s.activeTab)
  const close = (): void => {
    useApp.setState({ dialog: null })
    refocusTerminal()
  }
  const open = (where: Placement): void => {
    useApp.setState({ dialog: null })
    const st = useApp.getState()
    if (hostId) void st.openHost(hostId, where)
    else if (adhoc) void st.openAdhoc(adhoc, where)
  }
  // 지금 보고 있는 탭을 맨 앞에
  const ordered = [...tabs].sort((a, b) => Number(b.id === activeTab) - Number(a.id === activeTab))
  return (
    <Modal title={`"${title}" 열 위치`} icon={<LayoutGrid size={18} />} onClose={close} size="lg">
      <div className="modal-body">
        <button className="btn place-newtab" onClick={() => open('tab')}><Plus size={15} />새 탭으로 열기</button>
        {ordered.length === 0 && <div className="place-hint">열린 탭이 없습니다 — 새 탭으로 열립니다</div>}
        {ordered.length > 0 && <div className="place-hint">칸의 화살표를 누르면 그쪽으로 나눠서, 빈 칸은 그 칸에 엽니다</div>}
        <div className="place-tabs">
          {ordered.map((t, i) => (
            <div key={t.id} className={`place-tab ${t.id === activeTab ? 'active' : ''}`}>
              <div className="place-tab-title">{tabTitle(t, i)}{t.id === activeTab && <span className="place-now">지금 탭</span>}</div>
              <div className="place-map"><MiniNode tab={t} node={t.root} onPick={(p, zone) => open({ tabId: t.id, paneId: p.id, zone })} /></div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function tabTitle(t: Tab, i: number): string {
  if (t.title) return t.title
  const s = useApp.getState().sessions
  const names = panes(t.root).map((p) => s[p.sessionId]?.title).filter(Boolean)
  return names.length ? names.slice(0, 3).join(' · ') + (names.length > 3 ? ` 외 ${names.length - 3}` : '') : `탭 ${i + 1}`
}

function MiniNode({ tab, node, onPick }: { tab: Tab; node: LayoutNode; onPick: (p: PaneNode, z: DropZone) => void }): JSX.Element {
  if (node.type === 'pane') return <MiniPane tab={tab} pane={node} onPick={onPick} />
  return (
    <div className={`place-split s-${node.dir}`}>
      {node.children.map((c, i) => (
        <div key={c.id} className="place-child" style={{ flex: `${node.sizes[i]} 1 0` }}>
          <MiniNode tab={tab} node={c} onPick={onPick} />
        </div>
      ))}
    </div>
  )
}

function MiniPane({ tab, pane, onPick }: { tab: Tab; pane: PaneNode; onPick: (p: PaneNode, z: DropZone) => void }): JSX.Element {
  const info = useApp((s) => s.sessions[pane.sessionId])
  if (isEmptyPane(pane)) {
    return (
      <button className="place-cell empty" title="이 빈 칸에 열기" onClick={() => onPick(pane, 'center')}>
        <Plus size={16} /><span>여기에 열기</span>
      </button>
    )
  }
  const edge = (z: DropZone, icon: JSX.Element, label: string): JSX.Element => (
    <button className={`place-edge pe-${z}`} title={`${info?.title ?? '이 칸'} ${label}에 열기`} onClick={() => onPick(pane, z)}>{icon}</button>
  )
  return (
    <div className={`place-cell ${tab.focused === pane.id ? 'focused' : ''}`} style={info?.color ? { ['--cell' as string]: info.color } : undefined}>
      <span className="place-name">{info?.title ?? '세션'}</span>
      {edge('left', <ArrowLeft size={13} />, '왼쪽')}
      {edge('right', <ArrowRight size={13} />, '오른쪽')}
      {edge('top', <ArrowUp size={13} />, '위')}
      {edge('bottom', <ArrowDown size={13} />, '아래')}
    </div>
  )
}
