import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, Search, Plus, FolderPlus, Download, Star, Terminal, SquareTerminal, Cpu, Radio, Clock, SplitSquareHorizontal, Play } from 'lucide-react'
import { useApp, newHost } from '../state'
import { ENV_COLORS, ENV_LABELS, type Group, type Host } from '@shared/types'
import { panes } from '../layout'
import { isMac, modKey } from '../platform'
import { AdBanner } from './AdBanner'

export function hostColor(h: Host, groups: Group[]): string | undefined {
  if (h.color) return h.color
  if (h.env && h.env !== 'none') return ENV_COLORS[h.env]
  let gid = h.groupId
  while (gid) {
    const g = groups.find((x) => x.id === gid)
    if (!g) break
    if (g.color) return g.color
    if (g.env && g.env !== 'none') return ENV_COLORS[g.env]
    gid = g.parentId
  }
  return undefined
}

export function ProtoIcon({ p, size = 14 }: { p: Host['protocol']; size?: number }): JSX.Element {
  if (p === 'serial') return <Cpu size={size} />
  if (p === 'telnet') return <Radio size={size} />
  if (p === 'local') return <SquareTerminal size={size} />
  return <Terminal size={size} />
}

/** 목록·툴팁에 쓰는 접속 대상 한 줄 */
export function hostTarget(h: Host, withPort = false): string {
  if (h.protocol === 'serial') return h.serial?.path ?? ''
  if (h.protocol === 'local') return `로컬 · ${h.local?.cwd?.trim() || '~'}`
  return `${h.username ? h.username + '@' : ''}${h.host}${withPort ? ':' + h.port : ''}`
}

function matches(h: Host, q: string, groups: Group[]): boolean {
  if (!q) return true
  const g = groups.find((x) => x.id === h.groupId)?.name ?? ''
  const hay = `${h.alias} ${h.host} ${h.username} ${h.tags.join(' ')} ${g} ${h.notes ?? ''}`.toLowerCase()
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t))
}

export function Sidebar(): JSX.Element {
  const { groups, hosts, filter, tabs, sessions, settings } = useApp()
  const [selected, setSelected] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [width, setWidth] = useState(settings.sidebarWidth)
  const dragging = useRef(false)

  const liveCount = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of tabs) for (const p of panes(t.root)) {
      const s = sessions[p.sessionId]
      if (s?.hostId && s.state === 'connected') m[s.hostId] = (m[s.hostId] ?? 0) + 1
    }
    return m
  }, [tabs, sessions])
  // 끊긴 것까지 포함해 패널이 하나라도 있는 서버 — 더블클릭 때 새로 열지 판단
  const openIds = useMemo(() => new Set(tabs.flatMap((t) => panes(t.root).map((p) => sessions[p.sessionId]?.hostId).filter(Boolean))), [tabs, sessions])

  // 패널을 옮기면 사이드바 선택도 따라간다
  const focusedHost = useApp((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTab)
    const p = tab && panes(tab.root).find((x) => x.id === tab.focused)
    return (p && s.sessions[p.sessionId]?.hostId) ?? null
  })
  useEffect(() => {
    if (!focusedHost) return
    setSelected(focusedHost)
    document.querySelector(`.sidebar [data-host="${focusedHost}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focusedHost])

  const q = filter.trim()
  const visibleHosts = hosts.filter((h) => matches(h, q, groups))
  const favorites = hosts.filter((h) => h.favorite)
  const recent = [...hosts].filter((h) => h.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 5)

  const st = useApp.getState
  const moveHost = (hostId: string, groupId: string | null): void => {
    const h = hosts.find((x) => x.id === hostId)
    if (h && h.groupId !== groupId) st().upsertHost({ ...h, groupId })
  }
  const moveGroup = (gid: string, parentId: string | null): void => {
    if (gid === parentId) return
    // prevent cycles
    let p = parentId
    while (p) {
      if (p === gid) return
      p = groups.find((g) => g.id === p)?.parentId ?? null
    }
    const g = groups.find((x) => x.id === gid)
    if (g) st().upsertGroup({ ...g, parentId })
  }

  const hostMenu = (e: React.MouseEvent, h: Host): void => {
    e.preventDefault()
    setSelected(h.id)
    st().showMenu(e, [
      { label: '새 탭에서 연결', shortcut: 'Enter', onClick: () => st().openHost(h.id) },
      { label: '오른쪽으로 분할해 연결', onClick: () => st().openHost(h.id, 'row') },
      { label: '아래로 분할해 연결', onClick: () => st().openHost(h.id, 'col') },
      { separator: true },
      { label: '편집', shortcut: 'F2', onClick: () => useApp.setState({ dialog: { kind: 'host', host: h } }) },
      { label: '복제', onClick: () => st().upsertHost({ ...structuredClone(h), id: crypto.randomUUID(), alias: h.alias + ' (복사본)', lastUsedAt: undefined }) },
      { label: h.favorite ? '즐겨찾기 해제' : '즐겨찾기', onClick: () => st().upsertHost({ ...h, favorite: !h.favorite }) },
      { label: '주소 복사', onClick: () => navigator.clipboard.writeText(`${h.username ? h.username + '@' : ''}${h.host}`) },
      { separator: true },
      { label: '삭제', danger: true, onClick: async () => { if (await st().confirm({ title: '서버 삭제', message: `"${h.alias}"을(를) 삭제할까요?`, okText: '삭제', danger: true })) st().removeHosts([h.id]) } }
    ])
  }

  const groupMenu = (e: React.MouseEvent, g: Group): void => {
    e.preventDefault()
    e.stopPropagation()
    st().showMenu(e, [
      { label: '폴더 전체를 그리드로 열기', onClick: () => st().openGroupGrid(g.id) },
      { separator: true },
      { label: '이 폴더에 새 서버', onClick: () => useApp.setState({ dialog: { kind: 'host', groupId: g.id } }) },
      { label: '하위 폴더 만들기', onClick: () => useApp.setState({ dialog: { kind: 'group', parentId: g.id } }) },
      { label: '폴더 편집 (이름·색·환경)', onClick: () => useApp.setState({ dialog: { kind: 'group', group: g } }) },
      { separator: true },
      { label: '폴더 삭제 (서버는 상위로 이동)', danger: true, onClick: async () => { if (await st().confirm({ title: '폴더 삭제', message: `"${g.name}" 폴더를 삭제할까요? 안의 서버는 상위 폴더로 옮겨집니다.`, okText: '삭제', danger: true })) st().removeGroup(g.id) } }
    ])
  }

  const onKey = (e: React.KeyboardEvent): void => {
    const h = hosts.find((x) => x.id === selected)
    if (!h) return
    if (e.key === 'Enter') st().openHost(h.id, modKey(e) ? 'row' : e.shiftKey ? 'col' : 'tab')
    if (e.key === 'F2') useApp.setState({ dialog: { kind: 'host', host: h } })
    if (e.key === 'Delete') {
      st().confirm({ title: '서버 삭제', message: `"${h.alias}"을(를) 삭제할까요?`, okText: '삭제', danger: true }).then((ok) => ok && st().removeHosts([h.id]))
    }
  }

  const HostNode = ({ h, depth, section }: { h: Host; depth: number; section?: string }): JSX.Element => {
    const color = hostColor(h, groups)
    const live = liveCount[h.id]
    return (
      <div
        className={`node ${selected === h.id && !section ? 'selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={!section}
        onDragStart={(e) => e.dataTransfer.setData('bt/host', h.id)}
        data-host={section ? undefined : h.id}
        onClick={() => { setSelected(h.id); st().revealHost(h.id) }}
        onDoubleClick={() => { if (!openIds.has(h.id)) st().openHost(h.id) }}
        onContextMenu={(e) => hostMenu(e, h)}
        title={`${h.alias}\n${hostTarget(h, true)}${h.notes ? '\n' + h.notes : ''}`}
      >
        <span className="chev" />
        <span className="color-bar" style={{ background: color ?? 'transparent' }} />
        <span className="proto"><ProtoIcon p={h.protocol} size={13} /></span>
        <span className="n-label">{h.alias || h.host}</span>
        <span className="n-sub">{h.protocol === 'serial' ? h.serial?.path : h.protocol === 'local' ? h.local?.cwd?.trim() || '~' : h.host}</span>
        {live ? <span className="n-live"><span className="dot connected" style={{ width: 6, height: 6 }} />{live > 1 ? live : ''}</span> : null}
        <span className="n-hover">
          <button className="ibtn sm" title="분할로 연결" onClick={(e) => { e.stopPropagation(); st().openHost(h.id, 'row') }}><SplitSquareHorizontal size={13} /></button>
          <button className="ibtn sm" title="연결" onClick={(e) => { e.stopPropagation(); st().openHost(h.id) }}><Play size={13} /></button>
        </span>
      </div>
    )
  }

  const countIn = (gid: string): number => {
    const sub = groups.filter((g) => g.parentId === gid)
    return visibleHosts.filter((h) => h.groupId === gid).length + sub.reduce((a, g) => a + countIn(g.id), 0)
  }

  const GroupNode = ({ g, depth }: { g: Group; depth: number }): JSX.Element | null => {
    const n = countIn(g.id)
    if (q && n === 0) return null
    const open = q ? true : !g.collapsed
    const color = g.color ?? (g.env && g.env !== 'none' ? ENV_COLORS[g.env] : undefined)
    const children = groups.filter((x) => x.parentId === g.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    const hs = visibleHosts.filter((h) => h.groupId === g.id).sort((a, b) => a.sort - b.sort || a.alias.localeCompare(b.alias))
    return (
      <>
        <div
          className={`node ${dropOn === g.id ? 'drop' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('bt/group', g.id)}
          onDragOver={(e) => { e.preventDefault(); setDropOn(g.id) }}
          onDragLeave={() => setDropOn(null)}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setDropOn(null)
            const hid = e.dataTransfer.getData('bt/host')
            const gid = e.dataTransfer.getData('bt/group')
            if (hid) moveHost(hid, g.id)
            if (gid) moveGroup(gid, g.id)
          }}
          onClick={() => st().upsertGroup({ ...g, collapsed: !g.collapsed })}
          onDoubleClick={(e) => e.preventDefault()}
          onContextMenu={(e) => groupMenu(e, g)}
        >
          <span className="chev">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
          <span style={{ color: color ?? 'var(--text-3)', display: 'grid' }}>{open ? <FolderOpen size={14} /> : <Folder size={14} />}</span>
          <span className="n-label" style={{ fontWeight: 600 }}>{g.name}</span>
          {g.env && g.env !== 'none' && <span className="pill" style={{ background: ENV_COLORS[g.env] + '26', color: ENV_COLORS[g.env] }}>{ENV_LABELS[g.env]}</span>}
          <span className="n-count">{n}</span>
          <span className="n-hover">
            <button className="ibtn sm" title="폴더 전체 그리드로 열기" onClick={(e) => { e.stopPropagation(); st().openGroupGrid(g.id) }}><Play size={13} /></button>
          </span>
        </div>
        {open && children.map((c) => <GroupNode key={c.id} g={c} depth={depth + 1} />)}
        {open && hs.map((h) => <HostNode key={h.id} h={h} depth={depth + 1} />)}
      </>
    )
  }

  const roots = groups.filter((g) => !g.parentId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
  const loose = visibleHosts.filter((h) => !h.groupId || !groups.some((g) => g.id === h.groupId)).sort((a, b) => a.sort - b.sort || a.alias.localeCompare(b.alias))

  const startResize = (e: React.MouseEvent): void => {
    dragging.current = true
    const x0 = e.clientX
    const w0 = width
    const move = (ev: MouseEvent): void => setWidth(Math.max(200, Math.min(520, w0 + ev.clientX - x0)))
    const up = (ev: MouseEvent): void => {
      dragging.current = false
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      st().setSettings({ sidebarWidth: Math.max(200, Math.min(520, w0 + ev.clientX - x0)) })
      window.dispatchEvent(new Event('resize'))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <aside className="sidebar" style={{ width }} onKeyDown={onKey} tabIndex={-1}>
      <div className="sb-head">
        <div className="search">
          <Search size={15} />
          <input id="sidebar-search" className="input" placeholder="서버 검색" value={filter} onChange={(e) => useApp.setState({ filter: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visibleHosts[0]) st().openHost(visibleHosts[0].id)
              if (e.key === 'Escape') useApp.setState({ filter: '' })
            }} />
        </div>
        <div className="sb-actions">
          <button className="btn" onClick={() => useApp.setState({ dialog: { kind: 'host', host: undefined, groupId: null } })}><Plus size={14} />서버</button>
          <button className="btn" onClick={() => useApp.setState({ dialog: { kind: 'group', parentId: null } })}><FolderPlus size={14} />폴더</button>
          <button className="btn" onClick={() => useApp.setState({ dialog: { kind: 'import' } })} title={isMac ? 'SSH config / PuTTY 세션 가져오기' : 'PuTTY / SSH config 가져오기'}><Download size={14} />가져오기</button>
        </div>
      </div>
      <div
        className="tree"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const hid = e.dataTransfer.getData('bt/host')
          const gid = e.dataTransfer.getData('bt/group')
          if (hid) moveHost(hid, null)
          if (gid) moveGroup(gid, null)
        }}
      >
        {!q && favorites.length > 0 && (
          <>
            <div className="sec-title"><Star size={11} /> 즐겨찾기</div>
            {favorites.map((h) => <HostNode key={'f' + h.id} h={h} depth={0} section="fav" />)}
          </>
        )}
        {!q && recent.length > 0 && hosts.length > 6 && (
          <>
            <div className="sec-title"><Clock size={11} /> 최근 접속</div>
            {recent.map((h) => <HostNode key={'r' + h.id} h={h} depth={0} section="recent" />)}
          </>
        )}
        <div className="sec-title">서버 {hosts.length > 0 && <span style={{ fontWeight: 500 }}>· {hosts.length}</span>}</div>
        {roots.map((g) => <GroupNode key={g.id} g={g} depth={0} />)}
        {loose.map((h) => <HostNode key={h.id} h={h} depth={0} />)}
        {hosts.length === 0 && (
          <div className="empty">
            아직 저장된 서버가 없습니다.<br />
            <b>+ 서버</b>로 추가하거나<br /><b>가져오기</b>로 {isMac ? '~/.ssh/config' : 'PuTTY 세션'}을 불러오세요.
          </div>
        )}
        {hosts.length > 0 && q && visibleHosts.length === 0 && <div className="empty">"{q}"와 일치하는 서버가 없습니다</div>}
      </div>
      <AdBanner slot="sidebar" />
      <div className={`sb-resize ${dragging.current ? 'drag' : ''}`} onMouseDown={startResize} />
    </aside>
  )
}

export { newHost }
