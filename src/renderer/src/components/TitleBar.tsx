import { useState } from 'react'
import { X, Plus, PanelLeft, Settings, Lock, Radio, FolderTree, LayoutGrid } from 'lucide-react'
import { useApp, Tab } from '../state'
import { panes, findPane } from '../layout'
import { api } from '../api'
import { SC, isMac } from '../platform'
import logo from '../assets/logo.png'

function tabInfo(t: Tab): { title: string; color?: string; state: string; count: number; activity: boolean } {
  const st = useApp.getState()
  const ps = panes(t.root)
  const fp = findPane(t.root, t.focused) ?? ps[0]
  const s = st.sessions[fp.sessionId]
  const states = ps.map((p) => st.sessions[p.sessionId]?.state ?? 'closed')
  const state = states.includes('connected') ? (states.every((x) => x === 'connected') ? 'connected' : 'reconnecting') : states.includes('connecting') || states.includes('reconnecting') ? 'connecting' : states.includes('error') ? 'error' : 'closed'
  return {
    title: t.title || s?.title || '세션',
    color: s?.color,
    state,
    count: ps.length,
    activity: ps.some((p) => st.activity[p.sessionId])
  }
}

export function TitleBar(): JSX.Element {
  const { tabs, activeTab, sidebar, vault } = useApp()
  useApp((s) => s.sessions)
  useApp((s) => s.activity)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const st = useApp.getState

  const menu = (e: React.MouseEvent, t: Tab): void => {
    e.preventDefault()
    const n = panes(t.root).length
    st().showMenu(e, [
      { label: '탭 이름 바꾸기', onClick: async () => { const name = await st().prompt('탭 이름 바꾸기', tabInfo(t).title); if (name !== null) st().updateTab(t.id, { title: name || undefined }) } },
      { label: t.broadcast ? '동시 입력 끄기' : '이 탭의 모든 패널에 동시 입력', shortcut: SC.broadcast, disabled: n < 2, onClick: () => st().updateTab(t.id, { broadcast: !t.broadcast }) },
      { label: '패널을 각각 탭으로 분리', disabled: n < 2, onClick: () => st().splitToTabs(t.id) },
      { label: '모든 탭을 이 창 그리드로 모으기', onClick: () => st().gatherAll() },
      { separator: true },
      { label: '다른 탭 모두 닫기', onClick: async () => { for (const x of st().tabs.filter((x) => x.id !== t.id)) await st().closeTab(x.id, true) } },
      { label: '탭 닫기', shortcut: isMac ? undefined : SC.closePane, danger: true, onClick: () => st().closeTab(t.id) }
    ])
  }

  return (
    <div className={`titlebar ${api.platform === 'darwin' ? 'mac' : ''}`}>
      <div className="tb-left">
        <div className="logo"><img className="logo-mark" src={logo} alt="" />BrightTerm</div>
        <button className={`ibtn ${sidebar ? 'on' : ''}`} title={`서버 목록 (${SC.sidebar})`} onClick={() => useApp.setState({ sidebar: !sidebar })}><PanelLeft size={16} /></button>
      </div>
      <div className="tabs">
        {tabs.map((t, i) => {
          const info = tabInfo(t)
          return (
            <div
              key={t.id}
              className={`tab ${t.id === activeTab ? 'active' : ''} ${overIdx === i && dragIdx !== i ? 'drag-over' : ''}`}
              style={info.color ? { background: t.id === activeTab ? `color-mix(in srgb, ${info.color} 14%, var(--bg-2))` : `color-mix(in srgb, ${info.color} 7%, transparent)` } : undefined}
              onMouseDown={(e) => { if (e.button === 0) st().setActiveTab(t.id) }}
              onAuxClick={(e) => { if (e.button === 1) st().closeTab(t.id) }}
              onContextMenu={(e) => menu(e, t)}
              onDoubleClick={async () => { const name = await st().prompt('탭 이름 바꾸기', info.title); if (name !== null) st().updateTab(t.id, { title: name || undefined }) }}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(i) }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
              onDrop={() => { if (dragIdx !== null && dragIdx !== i) st().moveTab(dragIdx, i); setDragIdx(null); setOverIdx(null) }}
              title={info.title}
            >
              {info.color && <span className="tab-color" style={{ background: info.color }} />}
              <span className={`dot ${info.activity && t.id !== activeTab ? 'activity' : info.state}`} />
              <span className="tab-title">{info.title}</span>
              {t.broadcast && <Radio size={12} color="var(--warn)" />}
              {info.count > 1 && <span className="tab-count">{info.count}</span>}
              <span className="tab-close" onMouseDown={(e) => e.stopPropagation()} onClick={() => st().closeTab(t.id)}><X size={13} /></span>
            </div>
          )
        })}
      </div>
      <button className="ibtn tab-new" title={`새 연결 (${SC.quick})`} onClick={() => useApp.setState({ dialog: { kind: 'quick' } })}><Plus size={16} /></button>
      <div className="tb-fill" />
      <div className="tb-right">
        {tabs.length > 1 && <button className="ibtn" title="모든 탭을 그리드로 모으기" onClick={() => st().gatherAll()}><LayoutGrid size={15} /></button>}
        <button className="ibtn" title={`SFTP 패널 (${SC.sftp})`} onClick={() => useApp.setState((s) => ({ rightPanel: s.rightPanel ? null : 'sftp' }))}><FolderTree size={15} /></button>
        {vault.unlocked && <button className="ibtn" title="지금 잠그기" onClick={() => api.vault.lock()}><Lock size={15} /></button>}
        <button className="ibtn" title={isMac ? `설정 (${SC.settings})` : '설정'} onClick={() => useApp.setState({ dialog: { kind: 'settings' } })}><Settings size={15} /></button>
      </div>
    </div>
  )
}
