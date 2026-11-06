import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Columns2, Rows2, X, Maximize2, Minimize2, FolderTree, RotateCw, Search, ChevronUp, ChevronDown, ImageUp, Radio, GripVertical, SquareTerminal, Zap, SquareDashed } from 'lucide-react'
import { useApp, Tab, type DropZone } from '../state'
import { LayoutNode, PaneNode, panes, setSizes, isEmptyPane } from '../layout'
import { attach, detach, fitEntry, getEntry, smartPaste, uploadAndInsert, disposeEntry } from '../terms'
import { api } from '../api'
import { ENV_COLORS, ENV_LABELS } from '@shared/types'
import { TERMINAL_THEMES } from '../themes'
import { Welcome } from './Welcome'
import { SC } from '../platform'

export function Workspace(): JSX.Element {
  const tabs = useApp((s) => s.tabs)
  const activeTab = useApp((s) => s.activeTab)
  return (
    <div className="workspace">
      {tabs.length === 0 && <Welcome />}
      {tabs.map((t) => (
        <div key={t.id} className={`tab-view ${t.id === activeTab ? '' : 'hidden'}`}>
          <TabView tab={t} active={t.id === activeTab} />
        </div>
      ))}
    </div>
  )
}

function TabView({ tab, active }: { tab: Tab; active: boolean }): JSX.Element {
  useEffect(() => {
    if (!active) return
    const id = requestAnimationFrame(() => {
      for (const p of panes(tab.root)) {
        const e = getEntry(p.sessionId)
        if (e) fitEntry(e)
      }
      const fp = panes(tab.root).find((p) => p.id === tab.focused)
      if (fp) getEntry(fp.sessionId)?.term.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [active, tab.root, tab.focused, tab.zoomed])
  if (tab.zoomed) {
    const p = panes(tab.root).find((x) => x.id === tab.zoomed)
    if (p) return isEmptyPane(p) ? <EmptySlot tab={tab} pane={p} /> : <Pane tab={tab} pane={p} />
  }
  return <Node tab={tab} node={tab.root} />
}

function Node({ tab, node }: { tab: Tab; node: LayoutNode }): JSX.Element {
  if (node.type === 'pane') return isEmptyPane(node) ? <EmptySlot key={`e-${node.id}`} tab={tab} pane={node} /> : <Pane key={node.sessionId} tab={tab} pane={node} />
  return <Split tab={tab} node={node} />
}

function Split({ tab, node }: { tab: Tab; node: Extract<LayoutNode, { type: 'split' }> }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const startDrag = (i: number, e: React.MouseEvent): void => {
    e.preventDefault()
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const total = node.dir === 'row' ? rect.width : rect.height
    const start = node.dir === 'row' ? e.clientX : e.clientY
    const s0 = [...node.sizes]
    setDrag(i)
    const move = (ev: MouseEvent): void => {
      const delta = (((node.dir === 'row' ? ev.clientX : ev.clientY) - start) / total) * 100
      const a = Math.max(8, s0[i] + delta)
      const b = Math.max(8, s0[i] + s0[i + 1] - a)
      const sizes = [...s0]
      sizes[i] = s0[i] + s0[i + 1] - b
      sizes[i + 1] = b
      const st = useApp.getState()
      const t = st.tabs.find((x) => x.id === tab.id)
      if (t) st.updateTab(tab.id, { root: setSizes(t.root, node.id, sizes) })
    }
    const up = (): void => {
      setDrag(null)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <div ref={ref} className={`split s-${node.dir}`}>
      {node.children.map((c, i) => (
        <SplitChild key={c.id} size={node.sizes[i]} last={i === node.children.length - 1} dragging={drag === i} onDrag={(e) => startDrag(i, e)}>
          <Node tab={tab} node={c} />
        </SplitChild>
      ))}
    </div>
  )
}

function SplitChild(props: { size: number; last: boolean; dragging: boolean; onDrag: (e: React.MouseEvent) => void; children: React.ReactNode }): JSX.Element {
  return (
    <>
      <div className="split-child" style={{ flex: `${props.size} 1 0` }}>{props.children}</div>
      {!props.last && <div className={`divider ${props.dragging ? 'drag' : ''}`} onMouseDown={props.onDrag} />}
    </>
  )
}

function Pane({ tab, pane }: { tab: Tab; pane: PaneNode }): JSX.Element {
  const info = useApp((s) => s.sessions[pane.sessionId])
  const settings = useApp((s) => s.settings)
  const focused = tab.focused === pane.id
  const multi = panes(tab.root).length > 1
  const bodyRef = useRef<HTMLDivElement>(null)
  const [dropping, setDropping] = useState(false)
  const drop = usePaneDrop(tab, pane)
  const [find, setFind] = useState<string | null>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const st = useApp.getState

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const e = attach(pane.sessionId, el)
    const ro = new ResizeObserver(() => fitEntry(e))
    ro.observe(el)
    return () => {
      ro.disconnect()
      detach(pane.sessionId, el)
    }
  }, [pane.sessionId])

  // dispose terminal when session is gone for good
  useEffect(() => () => {
    setTimeout(() => {
      if (!useApp.getState().sessions[pane.sessionId]) disposeEntry(pane.sessionId)
    }, 0)
  }, [pane.sessionId])

  useEffect(() => {
    const h = (ev: Event): void => {
      const d = (ev as CustomEvent).detail
      if (d === pane.sessionId) {
        setFind('')
        setTimeout(() => findRef.current?.focus(), 20)
      }
    }
    window.addEventListener('bt:find', h)
    return () => window.removeEventListener('bt:find', h)
  }, [pane.sessionId])

  const color = info?.color
  const env = info?.env && info.env !== 'none' ? info.env : null
  const termBg = TERMINAL_THEMES[settings.terminalTheme]?.background ?? '#0d1117'

  const onContext = (e: React.MouseEvent): void => {
    e.preventDefault()
    const entry = getEntry(pane.sessionId)
    const hasSel = !!entry?.term.hasSelection()
    if (settings.rightClickPaste && !e.shiftKey) {
      if (hasSel && !settings.copyOnSelect) {
        api.clip.writeText(entry!.term.getSelection())
        entry!.term.clearSelection()
        return
      }
      smartPaste(pane.sessionId)
      return
    }
    st().showMenu(e, [
      { label: '복사', shortcut: SC.copy, disabled: !hasSel, onClick: () => entry && api.clip.writeText(entry.term.getSelection()) },
      { label: '붙여넣기', shortcut: SC.paste, onClick: () => smartPaste(pane.sessionId) },
      { label: info?.protocol === 'local' ? '클립보드 이미지 붙여넣기 (경로 입력)' : '클립보드 이미지를 서버로 붙여넣기', shortcut: SC.pasteImage, disabled: !info?.canSftp && info?.protocol !== 'local', onClick: () => smartPaste(pane.sessionId, true) },
      { separator: true },
      { label: '모두 선택', onClick: () => entry?.term.selectAll() },
      { label: '화면 지우기', onClick: () => entry?.term.clear() },
      { label: '찾기', shortcut: SC.find, onClick: () => window.dispatchEvent(new CustomEvent('bt:find', { detail: pane.sessionId })) },
      { separator: true },
      { label: '오른쪽으로 분할 (같은 서버)', shortcut: SC.splitRight, onClick: () => st().duplicatePane('row') },
      { label: '아래로 분할 (같은 서버)', shortcut: SC.splitDown, onClick: () => st().duplicatePane('col') },
      { label: 'SFTP 열기', shortcut: SC.sftp, disabled: !info?.canSftp, onClick: () => useApp.setState({ rightPanel: 'sftp' }) },
      { label: '다시 접속', disabled: info?.state === 'connected', onClick: () => api.session.reconnect(pane.sessionId) },
      { separator: true },
      { label: '패널 닫기', danger: true, onClick: () => st().closePane(pane.id, tab.id) }
    ])
  }

  const doFind = (dir: 'next' | 'prev'): void => {
    const e = getEntry(pane.sessionId)
    if (!e || !find) return
    const opt = { caseSensitive: false, decorations: { matchOverviewRuler: '#f59e0b', activeMatchColorOverviewRuler: '#ef4444', matchBackground: '#f59e0b55', activeMatchBackground: '#ef4444aa' } }
    if (dir === 'next') e.search.findNext(find, opt)
    else e.search.findPrevious(find, opt)
  }

  return (
    <div
      className={`pane ${focused ? 'focused' : ''} ${env === 'prod' ? 'prod' : ''}`}
      data-pane={pane.id}
      style={{ ['--pane-color' as string]: color ?? 'var(--accent)', ['--term-bg' as string]: termBg }}
      onMouseDown={() => { if (!focused || useApp.getState().activeTab !== tab.id) st().focusPane(tab.id, pane.id) }}
      onDragOver={(e) => { if (drop.over(e)) return; if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDropping(false); drop.leave() } }}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        if (drop.drop(e)) return
        const paths = Array.from(e.dataTransfer.files).map((f) => api.pathForFile(f)).filter(Boolean)
        if (paths.length) uploadAndInsert(pane.sessionId, { kind: 'files', paths })
      }}
    >
      {(
        <div className="pane-head" draggable onDragStart={(e) => startPaneDrag(e, tab, pane)} onDragEnd={endPaneDrag} title="끌어서 다른 칸과 자리 바꾸기·옮기기" style={color ? { background: `color-mix(in srgb, ${color} ${focused ? 22 : 12}%, var(--bg-3))`, borderBottomColor: color } : undefined}>
          <GripVertical size={12} className="ph-grip" />
          <span className={`dot ${info?.state ?? 'closed'}`} />
          {env && <span className="env-tag" style={{ background: ENV_COLORS[env] }}>{ENV_LABELS[env]}</span>}
          <span className="ph-title">{info?.title ?? '세션'}</span>
          {info?.persist && <span className="ph-persist" title="세션 유지(tmux) — 창을 닫아도 안의 프로그램은 계속 돕니다. 끝내려면 exit">유지</span>}
          <span className="ph-target">{info?.target}</span>
          {tab.broadcast && <Radio size={12} color="var(--warn)" />}
          <span className="ph-actions">
            {info && info.state !== 'connected' && <button className="ibtn sm" title="다시 접속" onClick={() => api.session.reconnect(pane.sessionId)}><RotateCw size={13} /></button>}
            {(info?.canSftp || info?.protocol === 'local') && <button className="ibtn sm" title={info?.protocol === 'local' ? `클립보드 이미지를 저장하고 경로 입력 (${SC.pasteImage})` : `클립보드 이미지 → 서버 업로드 후 경로 입력 (${SC.pasteImage})`} onClick={() => smartPaste(pane.sessionId, true)}><ImageUp size={13} /></button>}
            <button className="ibtn sm" title={`찾기 (${SC.find})`} onClick={() => { setFind(''); setTimeout(() => findRef.current?.focus(), 20) }}><Search size={13} /></button>
            {info?.canSftp && <button className="ibtn sm" title={`SFTP (${SC.sftp})`} onClick={() => { st().focusPane(tab.id, pane.id); useApp.setState({ rightPanel: 'sftp' }) }}><FolderTree size={13} /></button>}
            <button className="ibtn sm" title={`오른쪽으로 분할 (${SC.splitRight})`} onClick={() => { st().focusPane(tab.id, pane.id); st().duplicatePane('row') }}><Columns2 size={13} /></button>
            <button className="ibtn sm" title={`아래로 분할 (${SC.splitDown})`} onClick={() => { st().focusPane(tab.id, pane.id); st().duplicatePane('col') }}><Rows2 size={13} /></button>
            {multi && (
              <button className="ibtn sm" title={tab.zoomed ? `원래대로 (${SC.zoom})` : `크게 보기 (${SC.zoom})`} onClick={() => st().updateTab(tab.id, { zoomed: tab.zoomed ? null : pane.id })}>
                {tab.zoomed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            )}
            <button className="ibtn sm" title="닫기" onClick={() => st().closePane(pane.id, tab.id)}><X size={13} /></button>
          </span>
        </div>
      )}
      <div className="pane-body" ref={bodyRef} onContextMenu={onContext} />
      {multi && info && <div className="watermark" style={{ color: color ?? 'var(--text)' }}>{info.title}</div>}
      {find !== null && (
        <div className="findbar" onMouseDown={(e) => e.stopPropagation()}>
          <input ref={findRef} className="input" placeholder="터미널에서 찾기" value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doFind(e.shiftKey ? 'prev' : 'next')
              if (e.key === 'Escape') { setFind(null); getEntry(pane.sessionId)?.search.clearDecorations(); getEntry(pane.sessionId)?.term.focus() }
            }} />
          <button className="ibtn sm" onClick={() => doFind('prev')}><ChevronUp size={14} /></button>
          <button className="ibtn sm" onClick={() => doFind('next')}><ChevronDown size={14} /></button>
          <button className="ibtn sm" onClick={() => { setFind(null); getEntry(pane.sessionId)?.search.clearDecorations() }}><X size={14} /></button>
        </div>
      )}
      {drop.zone && <div className={`drop-zone dz-${drop.zone}`}><span>{drop.label}</span></div>}
      {dropping && (
        <div className="pane-drop"><div><ImageUp size={18} /> {info?.canSftp ? `서버(${settings.uploadDir})로 업로드하고 경로를 입력합니다` : info?.protocol === 'local' ? '파일 경로를 입력합니다 (이미지는 저장 후 경로)' : '파일 경로를 입력합니다'}</div></div>
      )}
    </div>
  )
}

// ---------------- 칸 끌어 놓기 · 빈 칸 ----------------

/** 지금 끌고 있는 칸(같은 창 안). dragover 중에는 dataTransfer 내용을 못 읽어서 따로 기억한다 */
let draggingPane: { tabId: string; paneId: string } | null = null

function startPaneDrag(e: React.DragEvent, tab: Tab, pane: PaneNode): void {
  if ((e.target as HTMLElement).closest('button')) return e.preventDefault()
  draggingPane = { tabId: tab.id, paneId: pane.id }
  e.dataTransfer.setData('bt/pane', `${tab.id}|${pane.id}`)
  e.dataTransfer.effectAllowed = 'move'
}

function endPaneDrag(): void {
  draggingPane = null
}

const ZONE_LABEL: Record<DropZone, string> = { center: '', left: '왼쪽에', right: '오른쪽에', top: '위에', bottom: '아래에' }

/** 마우스 위치 → 놓을 자리. 빈 칸은 늘 가운데(채우기), 서버를 이미 쓰는 칸 위로 서버를 끌면 가장자리만 */
function zoneAt(e: React.DragEvent, el: HTMLElement, allowCenter: boolean, onlyCenter: boolean): DropZone {
  if (onlyCenter) return 'center'
  const r = el.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width
  const y = (e.clientY - r.top) / r.height
  const d = { left: x, right: 1 - x, top: y, bottom: 1 - y }
  const [edge, dist] = (Object.entries(d) as [DropZone, number][]).sort((a, b) => a[1] - b[1])[0]
  return allowCenter && dist > 0.25 ? 'center' : edge
}

function usePaneDrop(tab: Tab, pane: PaneNode): { zone: DropZone | null; label: string; over: (e: React.DragEvent) => boolean; leave: () => void; drop: (e: React.DragEvent) => boolean } {
  const [zone, setZone] = useState<DropZone | null>(null)
  const [kind, setKind] = useState<'pane' | 'host' | null>(null)
  const empty = isEmptyPane(pane)
  const over = (e: React.DragEvent): boolean => {
    const types = e.dataTransfer.types
    const k = types.includes('bt/pane') && draggingPane?.tabId === tab.id ? 'pane' : types.includes('bt/host') ? 'host' : null
    if (!k || (k === 'pane' && draggingPane?.paneId === pane.id)) { if (zone) setZone(null); return false }
    e.preventDefault()
    e.dataTransfer.dropEffect = k === 'pane' ? 'move' : 'copy'
    const z = zoneAt(e, e.currentTarget as HTMLElement, k === 'pane', empty)
    if (z !== zone) setZone(z)
    if (k !== kind) setKind(k)
    return true
  }
  const drop = (e: React.DragEvent): boolean => {
    const z = zone
    setZone(null)
    if (!z) return false
    const st = useApp.getState()
    const p = e.dataTransfer.getData('bt/pane')
    if (p) {
      const [tabId, src] = p.split('|')
      if (tabId === tab.id) st.dropPane(tab.id, src, pane.id, z)
      return true
    }
    const hostId = e.dataTransfer.getData('bt/host')
    if (hostId) {
      void st.openHost(hostId, { tabId: tab.id, paneId: pane.id, zone: z })
      return true
    }
    return false
  }
  const label = !zone ? '' : zone === 'center' ? (empty ? '이 칸에 열기' : '자리 바꾸기') : `${ZONE_LABEL[zone]} ${kind === 'host' ? '열기' : '옮기기'}`
  return { zone, label, over, leave: () => setZone(null), drop }
}

function EmptySlot({ tab, pane }: { tab: Tab; pane: PaneNode }): JSX.Element {
  const hosts = useApp((s) => s.hosts)
  const focused = tab.focused === pane.id
  const drop = usePaneDrop(tab, pane)
  const st = useApp.getState
  const select = (): void => st().focusPane(tab.id, pane.id)
  const recent = [...hosts].filter((h) => h.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 6)
  return (
    <div
      className={`pane empty-slot ${focused ? 'focused' : ''}`}
      data-pane={pane.id}
      tabIndex={-1}
      onMouseDown={() => { if (!focused || st().activeTab !== tab.id) select() }}
      onDragOver={(e) => drop.over(e)}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) drop.leave() }}
      onDrop={(e) => { e.preventDefault(); drop.drop(e) }}
    >
      <div className="pane-head">
        <SquareDashed size={13} />
        <span className="ph-title">빈 칸</span>
        <span className="ph-actions">
          <button className="ibtn sm" title="칸 없애기 (남은 칸이 이 자리를 채웁니다)" onClick={() => st().closePane(pane.id, tab.id)}><X size={13} /></button>
        </span>
      </div>
      <div className="empty-body">
        <div className="empty-hint">사이드바에서 서버를 이 칸으로 끌어다 놓거나,<br />이 칸을 선택한 채 서버를 더블클릭하면 여기에 열립니다</div>
        <div className="empty-actions">
          <button className="btn" onClick={() => { select(); useApp.setState({ dialog: { kind: 'quick' } }) }}><Zap size={14} />서버 고르기</button>
          <button className="btn" onClick={() => { select(); void st().openAdhoc({ host: '', protocol: 'local' }, { tabId: tab.id, paneId: pane.id, zone: 'center' }) }}><SquareTerminal size={14} />로컬 터미널</button>
          <button className="btn" onClick={() => st().closePane(pane.id, tab.id)}><X size={14} />칸 없애기</button>
        </div>
        {recent.length > 0 && (
          <div className="empty-recent">
            {recent.map((h) => (
              <button key={h.id} className="chip" title={`${h.username ? h.username + '@' : ''}${h.host}`} onClick={() => void st().openHost(h.id, { tabId: tab.id, paneId: pane.id, zone: 'center' })}>
                {h.alias || h.host}
              </button>
            ))}
          </div>
        )}
      </div>
      {drop.zone && <div className={`drop-zone dz-${drop.zone}`}><span>{drop.label}</span></div>}
    </div>
  )
}
