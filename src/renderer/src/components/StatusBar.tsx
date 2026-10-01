import { useEffect, useState } from 'react'
import { Lock, Unlock, ImageUp, Radio, Download, X } from 'lucide-react'
import { useApp } from '../state'
import { api } from '../api'
import { focusedEntry } from '../terms'
import { SC } from '../platform'
import type { UpdateInfo } from '@shared/types'

function dur(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const z = (n: number): string => String(n).padStart(2, '0')
  return `${z(h)}:${z(m)}:${z(s % 60)}`
}

/** 닫은 새 버전 알림 — 그 버전만 다시 안 띄운다(더 새 버전이 나오면 다시 뜬다) */
const DISMISS_KEY = 'bt.update.dismissed'
const readDismissed = (): string | null => {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

const STATE_LABEL: Record<string, string> = { connected: '연결됨', connecting: '접속 중', reconnecting: '재접속 대기', closed: '끊김', error: '실패' }

export function StatusBar(): JSX.Element {
  const s = useApp((st) => st.focusedSession())
  const vault = useApp((st) => st.vault)
  const tab = useApp((st) => st.tabs.find((t) => t.id === st.activeTab))
  const hosts = useApp((st) => st.hosts)
  const checkUpdates = useApp((st) => st.settings.checkUpdates)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [, tick] = useState(0)
  useEffect(() => {
    api.update.get().then(setUpdate).catch(() => undefined)
    return api.on.update((u) => {
      setUpdate(u)
      // 실행 중 처음 알게 된 새 버전은 한 번 알려 준다(닫아 둔 버전·알림 끔이면 조용히)
      if (u && u.version !== readDismissed() && useApp.getState().settings.checkUpdates) {
        useApp.getState().toast('info', `BrightTerm ${u.version}이 나왔습니다 — 아래 상태 표시줄의 '새 버전'을 누르면 내려받기 페이지가 열립니다`)
      }
    })
  }, [])
  const dismiss = (v: string): void => {
    setDismissed(v)
    try {
      localStorage.setItem(DISMISS_KEY, v)
    } catch {
      /* 저장 못 해도 이번 실행에서는 닫힌다 */
    }
  }
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
      {checkUpdates && update && update.version !== dismissed && (
        <span className="sb-item sb-update">
          <span className="sb-btn" title="릴리스 페이지를 브라우저로 엽니다" onClick={() => api.app.openExternal(update.url)}><Download size={12} />새 버전 {update.version}</span>
          <span className="sb-btn sb-x" title="이 버전 알림 닫기" onClick={() => dismiss(update.version)}><X size={11} /></span>
        </span>
      )}
      {(s?.canSftp || s?.protocol === 'local') && s.state === 'connected' && <span className="sb-item muted" title={s.protocol === 'local' ? '클립보드 이미지를 이 PC에 저장하고 경로를 입력합니다 (Claude Code 등 CLI에서 이미지 첨부)' : '클립보드 이미지를 서버에 올리고 경로를 입력합니다 (Claude Code 등 CLI에서 이미지 첨부)'}><ImageUp size={12} />이미지 붙여넣기 {SC.paste}</span>}
      {host && <span className="sb-item">{(host.encoding || 'utf-8').toUpperCase()}</span>}
      {e && <span className="sb-item">{e.term.cols}×{e.term.rows}</span>}
      <span className="sb-item sb-btn" title={vault.unlocked ? '클릭하면 볼트를 잠급니다' : '볼트 잠김'} onClick={() => vault.unlocked && api.vault.lock()}>
        {vault.unlocked ? <Unlock size={12} /> : <Lock size={12} />}{vault.unlocked ? '볼트 열림' : '볼트 잠김'}
      </span>
    </div>
  )
}
