import { useEffect, useState } from 'react'
import { Lock, Unlock, ImageUp, Radio } from 'lucide-react'
import { useApp } from '../state'
import { api } from '../api'
import { focusedEntry } from '../terms'
import { SC } from '../platform'

function dur(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const z = (n: number): string => String(n).padStart(2, '0')
  return `${z(h)}:${z(m)}:${z(s % 60)}`
}

const STATE_LABEL: Record<string, string> = { connected: '연결됨', connecting: '접속 중', reconnecting: '재접속 대기', closed: '끊김', error: '실패' }

export function StatusBar(): JSX.Element {
  const s = useApp((st) => st.focusedSession())
  const vault = useApp((st) => st.vault)
  const tab = useApp((st) => st.tabs.find((t) => t.id === st.activeTab))
  const hosts = useApp((st) => st.hosts)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const e = focusedEntry()
  const host = s?.hostId ? hosts.find((h) => h.id === s.hostId) : undefined
  return (
    <div className="statusbar">
      {s ? (
        <>
          <span className="sb-item" style={{ color: s.color ?? 'var(--text)' , fontWeight: 600 }}><span className={`dot ${s.state}`} />{s.title}</span>
          <span className="sb-item">{s.target}</span>
          <span className="sb-item">{STATE_LABEL[s.state]}{s.state === 'connected' && s.connectedAt ? ` · ${dur(Date.now() - s.connectedAt)}` : s.message ? ` · ${s.message}` : ''}</span>
          {tab?.broadcast && <span className="sb-item bc"><Radio size={11} />동시 입력 ON</span>}
        </>
      ) : (
        <span className="sb-item muted">연결된 세션 없음</span>
      )}
      <span className="sb-fill" />
      {s?.canSftp && s.state === 'connected' && <span className="sb-item muted" title="클립보드 이미지를 서버에 올리고 경로를 입력합니다 (Claude Code 등 CLI에서 이미지 첨부)"><ImageUp size={12} />이미지 붙여넣기 {SC.paste}</span>}
      {host && <span className="sb-item">{(host.encoding || 'utf-8').toUpperCase()}</span>}
      {e && <span className="sb-item">{e.term.cols}×{e.term.rows}</span>}
      <span className="sb-item sb-btn" title={vault.unlocked ? '클릭하면 볼트를 잠급니다' : '볼트 잠김'} onClick={() => vault.unlocked && api.vault.lock()}>
        {vault.unlocked ? <Unlock size={12} /> : <Lock size={12} />}{vault.unlocked ? '볼트 열림' : '볼트 잠김'}
      </span>
    </div>
  )
}
