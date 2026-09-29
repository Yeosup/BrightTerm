import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Home, RefreshCw, FolderPlus, Upload, Folder, File, FileImage, X, Code2, Plus, Trash2, Pencil, TerminalSquare, FolderTree, Link2, CheckCircle2, AlertCircle, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { useApp } from '../state'
import { api } from '../api'
import { fmtBytes, fmtDate, Modal, Field, Switch } from './ui'
import type { SftpEntry, Snippet } from '@shared/types'
import { sendSnippet, focusSession } from '../terms'
import { modKey } from '../platform'

export function RightPanel(): JSX.Element | null {
  const panel = useApp((s) => s.rightPanel)
  const settings = useApp((s) => s.settings)
  const [width, setWidth] = useState(settings.rightPanelWidth)
  if (!panel) return null
  const startResize = (e: React.MouseEvent): void => {
    const x0 = e.clientX
    const w0 = width
    const move = (ev: MouseEvent): void => setWidth(Math.max(260, Math.min(760, w0 - (ev.clientX - x0))))
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      useApp.getState().setSettings({ rightPanelWidth: Math.max(260, Math.min(760, w0 - (ev.clientX - x0))) })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <aside className="rpanel" style={{ width }}>
      <div className="rp-resize" onMouseDown={startResize} />
      <div className="rp-tabs">
        <button className={`rp-tab ${panel === 'sftp' ? 'on' : ''}`} onClick={() => useApp.setState({ rightPanel: 'sftp' })}><FolderTree size={14} />SFTP</button>
        <button className={`rp-tab ${panel === 'snippets' ? 'on' : ''}`} onClick={() => useApp.setState({ rightPanel: 'snippets' })}><Code2 size={14} />스니펫</button>
        <span style={{ flex: 1 }} />
        <button className="ibtn sm" onClick={() => useApp.setState({ rightPanel: null })}><X size={14} /></button>
      </div>
      <div className="rp-body">{panel === 'sftp' ? <SftpPanel /> : <SnippetsPanel />}</div>
    </aside>
  )
}

function iconFor(e: SftpEntry): JSX.Element {
  if (e.isDir) return <span className="ic dir"><Folder size={15} fill="currentColor" fillOpacity={0.25} /></span>
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(e.name)) return <span className="ic"><FileImage size={15} /></span>
  return <span className="ic"><File size={15} /></span>
}

const pathCache = new Map<string, string>()

function SftpPanel(): JSX.Element {
  const session = useApp((s) => s.focusedSession())
  const transfers = useApp((s) => s.transfers)
  const sid = session?.canSftp && session.state === 'connected' ? session.id : null
  const [path, setPath] = useState('')
  const [edit, setEdit] = useState('')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [drop, setDrop] = useState(false)
  const st = useApp.getState
  const listRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (p: string) => {
    if (!sid) return
    setLoading(true)
    setErr('')
    try {
      const r = await api.sftp.list(sid, p)
      setPath(r.path)
      setEdit(r.path)
      setEntries(r.entries)
      setSel(new Set())
      pathCache.set(sid, r.path)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [sid])

  useEffect(() => {
    if (sid) load(pathCache.get(sid) ?? '~')
    else { setEntries([]); setPath('') }
  }, [sid, load])

  // refresh when an upload into this directory finishes
  const doneCount = Object.values(transfers).filter((t) => t.sessionId === sid && t.state === 'done' && t.direction === 'up' && t.remotePath.startsWith(path + '/')).length
  useEffect(() => { if (sid && path && doneCount) load(path) }, [doneCount])

  if (!session) return <div className="empty">세션을 선택하면 해당 서버의 파일이 표시됩니다.</div>
  if (!session.canSftp) return <div className="empty">SFTP는 SSH 세션에서만 사용할 수 있습니다.<br />({session.protocol.toUpperCase()} 세션)</div>
  if (!sid) return <div className="empty">연결되면 파일 목록이 표시됩니다.</div>

  const parent = path === '/' ? '/' : path.replace(/\/[^/]+\/?$/, '') || '/'
  const selected = entries.filter((e) => sel.has(e.path))

  const clickRow = (e: React.MouseEvent, i: number, ent: SftpEntry): void => {
    const s = new Set(e.ctrlKey || e.metaKey ? sel : [])
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]
      for (let k = a; k <= b; k++) s.add(entries[k].path)
    } else if ((e.ctrlKey || e.metaKey) && sel.has(ent.path)) s.delete(ent.path)
    else s.add(ent.path)
    if (!e.shiftKey) setAnchor(i)
    setSel(s)
  }

  const open = (ent: SftpEntry): void => {
    if (ent.isDir) load(ent.path)
    else useApp.setState({ dialog: { kind: 'preview', sessionId: sid, path: ent.path } })
  }

  const download = async (items: SftpEntry[]): Promise<void> => {
    try {
      const dir = await api.sftp.download(sid, items.map((x) => x.path))
      if (dir) st().toast('ok', `다운로드 완료 → ${dir}`)
    } catch (e) { st().toast('error', (e as Error).message) }
  }

  const remove = async (items: SftpEntry[]): Promise<void> => {
    const ok = await st().confirm({ title: '삭제', message: `${items.length === 1 ? `"${items[0].name}"` : `${items.length}개 항목`}을(를) 서버에서 영구 삭제할까요?${items.some((x) => x.isDir) ? ' 폴더는 안의 내용까지 모두 삭제됩니다.' : ''}`, okText: '삭제', danger: true })
    if (!ok) return
    try {
      await api.sftp.remove(sid, items.map((x) => x.path))
      load(path)
    } catch (e) { st().toast('error', (e as Error).message) }
  }

  const rowMenu = (e: React.MouseEvent, ent: SftpEntry): void => {
    e.preventDefault()
    const items = sel.has(ent.path) ? selected : [ent]
    if (!sel.has(ent.path)) setSel(new Set([ent.path]))
    const q = (p: string): string => (/[\s'"$`\\()&;|<>*?!#]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p)
    st().showMenu(e, [
      { label: ent.isDir ? '열기' : '미리보기', onClick: () => open(ent) },
      { label: '다운로드...', onClick: () => download(items) },
      { label: '로컬 앱으로 편집 (저장 시 자동 업로드)', disabled: ent.isDir || items.length > 1, onClick: async () => { try { await api.sftp.edit(sid, ent.path); st().toast('info', '편집 후 저장하면 서버에 자동 업로드됩니다') } catch (er) { st().toast('error', (er as Error).message) } } },
      { separator: true },
      { label: '경로를 터미널에 입력', onClick: () => { api.write(sid, items.map((x) => q(x.path)).join(' ') + ' '); focusSession(sid) } },
      { label: ent.isDir ? '터미널에서 이 폴더로 cd' : '터미널에서 이 폴더로 cd', onClick: () => { api.write(sid, `cd ${q(ent.isDir ? ent.path : path)}\r`); focusSession(sid) } },
      { label: '경로 복사', onClick: () => api.clip.writeText(items.map((x) => x.path).join('\n')) },
      { separator: true },
      { label: '이름 바꾸기', disabled: items.length > 1, onClick: async () => { const n = await st().prompt('이름 바꾸기', ent.name); if (n && n !== ent.name) { try { await api.sftp.rename(sid, ent.path, `${path.replace(/\/$/, '')}/${n}`); load(path) } catch (er) { st().toast('error', (er as Error).message) } } } },
      { label: `권한 변경 (현재 ${ent.perm})`, disabled: items.length > 1, onClick: async () => { const m = await st().prompt('권한 (8진수, 예: 755)', (ent.mode & 0o777).toString(8)); if (m && /^[0-7]{3,4}$/.test(m)) { try { await api.sftp.chmod(sid, ent.path, parseInt(m, 8)); load(path) } catch (er) { st().toast('error', (er as Error).message) } } } },
      { label: '삭제', danger: true, onClick: () => remove(items) }
    ])
  }

  const trList = Object.values(transfers).filter((t) => t.sessionId === sid).slice(-30).reverse()

  return (
    <>
      <div className="sftp-bar">
        <button className="ibtn sm" title="상위 폴더" onClick={() => load(parent)}><ArrowUp size={14} /></button>
        <button className="ibtn sm" title="홈" onClick={() => load('~')}><Home size={14} /></button>
        <div className="sftp-path">
          <input className="input" value={edit} onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(edit) }} spellCheck={false} />
        </div>
        <button className="ibtn sm" title="새로고침" onClick={() => load(path)}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
        <button className="ibtn sm" title="새 폴더" onClick={async () => { const n = await st().prompt('새 폴더 이름', ''); if (n) { try { await api.sftp.mkdir(sid, `${path.replace(/\/$/, '')}/${n}`); load(path) } catch (e) { st().toast('error', (e as Error).message) } } }}><FolderPlus size={14} /></button>
        <button className="ibtn sm" title="파일 업로드" onClick={async () => { try { await api.sftp.uploadPick(sid, path); load(path) } catch (e) { st().toast('error', (e as Error).message) } }}><Upload size={14} /></button>
        <button className="ibtn sm" title="터미널에서 이 폴더로 cd" onClick={() => { api.write(sid, `cd '${path.replace(/'/g, `'\\''`)}'\r`); focusSession(sid) }}><TerminalSquare size={14} /></button>
      </div>
      <div
        className="sftp-list"
        ref={listRef}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Delete' && selected.length) remove(selected)
          if (e.key === 'Backspace') load(parent)
          if (e.key === 'Enter' && selected.length === 1) open(selected[0])
          if (e.key === 'a' && modKey(e)) { e.preventDefault(); setSel(new Set(entries.map((x) => x.path))) }
        }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrop(true) } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false) }}
        onDrop={async (e) => {
          e.preventDefault()
          setDrop(false)
          const paths = Array.from(e.dataTransfer.files).map((f) => api.pathForFile(f)).filter(Boolean)
          if (!paths.length) return
          try { await api.sftp.upload(sid, paths, path); load(path) } catch (er) { st().toast('error', (er as Error).message) }
        }}
      >
        <div className="sftp-row sftp-head"><span /><span>이름</span><span className="sz">크기</span><span className="mt">수정일</span></div>
        {err && <div className="notice danger" style={{ margin: 8 }}><AlertCircle size={15} />{err}</div>}
        {entries.map((ent, i) => (
          <div key={ent.path} className={`sftp-row ${sel.has(ent.path) ? 'sel' : ''}`} title={`${ent.name}\n${ent.perm}  ${fmtBytes(ent.size)}`}
            onClick={(e) => clickRow(e, i, ent)} onDoubleClick={() => open(ent)} onContextMenu={(e) => rowMenu(e, ent)}>
            {iconFor(ent)}
            <span className="nm">{ent.name}{ent.isLink && <Link2 size={11} style={{ marginLeft: 4, color: 'var(--text-3)' }} />}</span>
            <span className="sz">{ent.isDir ? '' : fmtBytes(ent.size)}</span>
            <span className="mt">{fmtDate(ent.mtime)}</span>
          </div>
        ))}
        {!err && !loading && entries.length === 0 && <div className="empty">빈 폴더입니다. 파일을 여기로 끌어다 놓으면 업로드됩니다.</div>}
        {drop && <div className="sftp-drop">여기에 놓으면 {path} 로 업로드</div>}
      </div>
      {trList.length > 0 && (
        <div className="transfers">
          <div className="sec-title" style={{ padding: '8px 10px 2px' }}>전송<span style={{ flex: 1 }} />
            <button className="link" onClick={() => useApp.setState((s) => ({ transfers: Object.fromEntries(Object.entries(s.transfers).filter(([, t]) => t.state === 'running' || t.state === 'queued')) }))}>지우기</button>
          </div>
          {trList.map((t) => {
            const pct = t.total ? Math.round((t.bytes / t.total) * 100) : t.state === 'done' ? 100 : 0
            return (
              <div className="tr" key={t.id} title={t.error ?? t.remotePath}>
                <div className="tr-top">
                  {t.direction === 'up' ? <ArrowUpFromLine size={12} /> : <ArrowDownToLine size={12} />}
                  <span className="tr-name">{t.name}</span>
                  {t.state === 'done' ? <CheckCircle2 size={13} color="var(--ok)" /> : t.state === 'error' ? <AlertCircle size={13} color="var(--danger)" /> : <span className="muted">{pct}%</span>}
                  <span className="muted" style={{ fontSize: 11 }}>{fmtBytes(t.total)}</span>
                </div>
                <div className={`bar ${t.state}`}><div style={{ width: `${pct}%` }} /></div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export function PreviewDialog({ sessionId, path }: { sessionId: string; path: string }): JSX.Element {
  const [data, setData] = useState<{ kind: 'image' | 'text'; data: string } | null | undefined>(undefined)
  const st = useApp.getState
  useEffect(() => { api.sftp.preview(sessionId, path).then(setData).catch(() => setData(null)) }, [sessionId, path])
  const close = (): void => useApp.setState({ dialog: null })
  const name = path.split('/').pop()
  return (
    <Modal title={name} onClose={close} size="lg"
      foot={<>
        <span className="left muted" style={{ fontSize: 12 }}>{path}</span>
        <button className="btn" onClick={() => { api.write(sessionId, (/[\s'"]/.test(path) ? `'${path}'` : path) + ' '); close(); focusSession(sessionId) }}>경로를 터미널에 입력</button>
        <button className="btn" onClick={async () => { try { await api.sftp.edit(sessionId, path); close() } catch (e) { st().toast('error', (e as Error).message) } }}>로컬 앱으로 편집</button>
        <button className="btn primary" onClick={async () => { const d = await api.sftp.download(sessionId, [path]); if (d) st().toast('ok', `다운로드 완료 → ${d}`) }}>다운로드</button>
      </>}>
      <div className="modal-body" style={{ alignItems: 'center' }}>
        {data === undefined && <div className="muted">불러오는 중...</div>}
        {data === null && <div className="muted">미리보기를 지원하지 않는 파일입니다 (이진 파일 또는 512KB 초과).</div>}
        {data?.kind === 'image' && <img className="preview-img" src={data.data} />}
        {data?.kind === 'text' && <pre className="code" style={{ width: '100%', maxHeight: '60vh', margin: 0 }}>{data.data}</pre>}
      </div>
    </Modal>
  )
}

function SnippetsPanel(): JSX.Element {
  const snippets = useApp((s) => s.snippets)
  const [editing, setEditing] = useState<Snippet | null>(null)
  const [q, setQ] = useState('')
  const st = useApp.getState
  const list = snippets.filter((s) => !q || `${s.name} ${s.body}`.toLowerCase().includes(q.toLowerCase()))
  const save = (s: Snippet): void => {
    const next = snippets.some((x) => x.id === s.id) ? snippets.map((x) => (x.id === s.id ? s : x)) : [...snippets, s]
    st().save({ snippets: next })
    setEditing(null)
  }
  return (
    <>
      <div className="sftp-bar">
        <div className="sftp-path"><input className="input" placeholder="스니펫 검색" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="ibtn sm" title="새 스니펫" onClick={() => setEditing({ id: crypto.randomUUID(), name: '', body: '', sendEnter: true })}><Plus size={15} /></button>
      </div>
      <div className="sftp-list">
        {list.map((s) => (
          <div key={s.id} className="snip" onClick={() => sendSnippet(s.body, s.sendEnter)} title="클릭하면 현재 세션에 입력합니다">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, marginBottom: 3 }}>{s.name || '(이름 없음)'}</div>
              <div className="s-body">{s.body}</div>
            </div>
            <button className="ibtn sm" onClick={(e) => { e.stopPropagation(); setEditing(s) }}><Pencil size={13} /></button>
            <button className="ibtn sm" onClick={async (e) => { e.stopPropagation(); if (await st().confirm({ title: '스니펫 삭제', message: `"${s.name}"을(를) 삭제할까요?`, danger: true, okText: '삭제' })) st().save({ snippets: snippets.filter((x) => x.id !== s.id) }) }}><Trash2 size={13} /></button>
          </div>
        ))}
        {snippets.length === 0 && <div className="empty">자주 쓰는 명령을 저장해 두고 클릭 한 번으로 실행하세요.<br />동시 입력이 켜진 탭에서는 모든 패널에 입력됩니다.</div>}
      </div>
      {editing && (
        <Modal title={snippets.some((x) => x.id === editing.id) ? '스니펫 편집' : '새 스니펫'} onClose={() => setEditing(null)} size="sm"
          foot={<><button className="btn" onClick={() => setEditing(null)}>취소</button><button className="btn primary" disabled={!editing.body} onClick={() => save(editing)}>저장</button></>}>
          <div className="modal-body">
            <Field label="이름"><input className="input" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="예: 로그 보기" /></Field>
            <Field label="명령" hint="여러 줄은 순서대로 입력됩니다"><textarea className="textarea" rows={5} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} placeholder="tail -f /var/log/nginx/error.log" /></Field>
            <div className="toggle"><div className="t-label"><span>입력 후 Enter 실행</span></div><Switch value={editing.sendEnter} onChange={(v) => setEditing({ ...editing, sendEnter: v })} /></div>
          </div>
        </Modal>
      )}
    </>
  )
}
