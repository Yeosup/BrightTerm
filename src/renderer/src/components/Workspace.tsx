import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Columns2, Rows2, X, Maximize2, Minimize2, FolderTree, RotateCw, Search, ChevronUp, ChevronDown, ImageUp, Radio } from 'lucide-react'
import { useApp, Tab } from '../state'
import { LayoutNode, PaneNode, panes, setSizes } from '../layout'
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
    if (p) return <Pane tab={tab} pane={p} />
  }
  return <Node tab={tab} node={tab.root} />
}

function Node({ tab, node }: { tab: Tab; node: LayoutNode }): JSX.Element {
  if (node.type === 'pane') return <Pane tab={tab} pane={node} />
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
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false) }}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        const paths = Array.from(e.dataTransfer.files).map((f) => api.pathForFile(f)).filter(Boolean)
        if (paths.length) uploadAndInsert(pane.sessionId, { kind: 'files', paths })
      }}
    >
      {(
        <div className="pane-head" style={color ? { background: `color-mix(in srgb, ${color} ${focused ? 22 : 12}%, var(--bg-3))`, borderBottomColor: color } : undefined}>
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
      {dropping && (
        <div className="pane-drop"><div><ImageUp size={18} /> {info?.canSftp ? `서버(${settings.uploadDir})로 업로드하고 경로를 입력합니다` : info?.protocol === 'local' ? '파일 경로를 입력합니다 (이미지는 저장 후 경로)' : '파일 경로를 입력합니다'}</div></div>
      )}
    </div>
  )
}
