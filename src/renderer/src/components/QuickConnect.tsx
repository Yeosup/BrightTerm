import { useEffect, useMemo, useRef, useState } from 'react'
import { Zap, Settings, Download, Plus, Lock, SunMoon, LayoutGrid, FolderPlus } from 'lucide-react'
import { useApp } from '../state'
import { api } from '../api'
import { hostColor, ProtoIcon } from './Sidebar'
import type { Host } from '@shared/types'
import { SC, isMac, modKey } from '../platform'

interface Item { key: string; icon: JSX.Element; color?: string; title: string; sub?: string; run: (where: 'tab' | 'row' | 'col') => void }

function score(h: Host, q: string, groupName: string): number {
  if (!q) return 1
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  const alias = h.alias.toLowerCase()
  let s = 0
  for (const t of terms) {
    if (alias.startsWith(t)) s += 10
    else if (alias.includes(t)) s += 6
    else if (h.host.toLowerCase().includes(t)) s += 5
    else if (groupName.toLowerCase().includes(t) || h.tags.some((x) => x.toLowerCase().includes(t))) s += 3
    else if (h.username.toLowerCase().includes(t)) s += 2
    else {
      // subsequence (fuzzy)
      let i = 0
      for (const c of alias) if (c === t[i]) i++
      if (i === t.length) s += 1
      else return 0
    }
  }
  return s
}

export function QuickConnect(): JSX.Element {
  const { hosts, groups, settings } = useApp()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const close = (): void => useApp.setState({ dialog: null })
  const st = useApp.getState
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 20) }, [])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const raw = q.trim()
    if (raw.startsWith('>')) {
      const c = raw.slice(1).trim().toLowerCase()
      const cmds: Item[] = [
        { key: 'c-new', icon: <Plus size={15} />, title: '새 서버 등록', run: () => useApp.setState({ dialog: { kind: 'host', groupId: null } }) },
        { key: 'c-folder', icon: <FolderPlus size={15} />, title: '새 폴더', run: () => useApp.setState({ dialog: { kind: 'group', parentId: null } }) },
        { key: 'c-import', icon: <Download size={15} />, title: isMac ? 'SSH config / PuTTY 세션 가져오기' : 'PuTTY / SSH config 가져오기', run: () => useApp.setState({ dialog: { kind: 'import' } }) },
        { key: 'c-settings', icon: <Settings size={15} />, title: '설정 열기', run: () => useApp.setState({ dialog: { kind: 'settings' } }) },
        { key: 'c-theme', icon: <SunMoon size={15} />, title: `테마 전환 (${settings.theme === 'dark' ? '라이트' : '다크'})`, run: () => { st().setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark', terminalTheme: settings.theme === 'dark' ? 'BrightTerm Light' : 'BrightTerm Dark' }); close() } },
        { key: 'c-gather', icon: <LayoutGrid size={15} />, title: '모든 탭을 그리드로 모으기', run: () => { st().gatherAll(); close() } },
        { key: 'c-lock', icon: <Lock size={15} />, title: '볼트 잠그기', run: () => { api.vault.lock(); close() } }
      ]
      return cmds.filter((x) => x.title.toLowerCase().includes(c))
    }
    const m = raw.match(/^(?:(ssh|telnet):\/\/)?(?:([^@\s]+)@)?([a-zA-Z0-9.\-_:[\]]+?)(?::(\d+))?$/)
    if (raw && m && (raw.includes('@') || /\d+\.\d+\.\d+\.\d+/.test(raw) || raw.includes('.') || raw.startsWith('ssh') || raw.startsWith('telnet'))) {
      const protocol = (m[1] as 'ssh' | 'telnet') ?? 'ssh'
      out.push({
        key: 'adhoc',
        icon: <Zap size={15} />,
        title: `바로 접속: ${raw}`,
        sub: '저장하지 않고 연결합니다',
        run: (w) => { st().openAdhoc({ host: m[3], port: m[4] ? +m[4] : undefined, username: m[2], protocol }, w === 'tab' ? 'tab' : w); close() }
      })
    }
    const gname = (id: string | null): string => groups.find((g) => g.id === id)?.name ?? ''
    const scored = hosts
      .map((h) => ({ h, s: score(h, raw, gname(h.groupId)) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (b.h.lastUsedAt ?? 0) - (a.h.lastUsedAt ?? 0) || a.h.alias.localeCompare(b.h.alias))
      .slice(0, 50)
    for (const { h } of scored) {
      out.push({
        key: h.id,
        icon: <ProtoIcon p={h.protocol} size={15} />,
        color: hostColor(h, groups),
        title: h.alias,
        sub: `${h.protocol === 'serial' ? h.serial?.path : `${h.username ? h.username + '@' : ''}${h.host}${h.port !== 22 ? ':' + h.port : ''}`}${gname(h.groupId) ? ' · ' + gname(h.groupId) : ''}`,
        run: (w) => { st().openHost(h.id, w === 'tab' ? 'tab' : w); close() }
      })
    }
    return out
  }, [q, hosts, groups, settings.theme])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('.p-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      items[idx]?.run(modKey(e) ? 'row' : e.shiftKey ? 'col' : 'tab')
    } else if (e.key === 'Escape') close()
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal palette">
        <div className="p-input">
          <Zap size={17} color="var(--accent)" />
          <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="서버 이름, IP, user@host:port 입력  ·  > 명령" spellCheck={false} />
        </div>
        <div className="p-list" ref={listRef}>
          {items.map((it, i) => (
            <div key={it.key} className={`p-item ${i === idx ? 'on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={(e) => it.run(modKey(e) ? 'row' : e.shiftKey ? 'col' : 'tab')}>
              <span className="p-bar" style={{ background: it.color ?? 'transparent' }} />
              <span style={{ color: 'var(--text-2)', display: 'grid' }}>{it.icon}</span>
              <div className="p-main"><b>{it.title}</b>{it.sub && <span>{it.sub}</span>}</div>
              {i === idx && <span className="kbd">Enter</span>}
            </div>
          ))}
          {items.length === 0 && <div className="empty">일치하는 서버가 없습니다. <b>user@host</b> 형식으로 입력하면 바로 접속할 수 있습니다.</div>}
        </div>
        <div className="p-foot">
          <span><span className="kbd">Enter</span> 새 탭</span>
          <span><span className="kbd">{SC.openRight}</span> 오른쪽 분할</span>
          <span><span className="kbd">Shift+Enter</span> 아래 분할</span>
          <span><span className="kbd">&gt;</span> 명령</span>
        </div>
      </div>
    </div>
  )
}
