import { Plus, Download, Zap } from 'lucide-react'
import { useApp } from '../state'
import { hostColor, ProtoIcon } from './Sidebar'
import { SC, isMac } from '../platform'
import logo from '../assets/logo.png'
import { AdBanner } from './AdBanner'

export const SHORTCUTS: [string, string][] = [
  ['빠른 접속 / 명령', SC.quick],
  ['새 탭 (빠른 접속)', SC.newTab],
  [isMac ? '패널 닫기' : '탭 닫기', SC.closePane],
  ['오른쪽 분할 (같은 서버)', SC.splitRight],
  ['아래 분할 (같은 서버)', SC.splitDown],
  ['패널 이동', SC.paneMove],
  ['패널 크게 보기', SC.zoom],
  ['탭 이동', SC.tabs],
  ['붙여넣기 (이미지·파일 자동 업로드)', SC.paste],
  ['클립보드 이미지 → 서버', SC.pasteImage],
  ['복사', SC.copyLong],
  ['터미널에서 찾기', SC.find],
  ['SFTP 패널', SC.sftp],
  ['동시 입력(브로드캐스트)', SC.broadcast],
  ['서버 목록 표시/숨김', SC.sidebar],
  ['글자 크기', SC.font],
  ...(isMac ? [['설정', SC.settings] as [string, string]] : [])
]

export function Welcome(): JSX.Element {
  const hosts = useApp((s) => s.hosts)
  const groups = useApp((s) => s.groups)
  const recent = [...hosts].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.alias.localeCompare(b.alias)).slice(0, 9)
  const st = useApp.getState
  return (
    <div className="welcome">
      <div className="welcome-card">
        <img className="logo-mark" src={logo} alt="" style={{ width: 48, height: 48, margin: '0 auto' }} />
        <h1>BrightTerm</h1>
        <p>서버를 더블클릭하거나 <span className="kbd">{SC.quick}</span> 로 바로 접속하세요.</p>
        <div className="actions">
          <button className="btn primary" onClick={() => useApp.setState({ dialog: { kind: 'quick' } })}><Zap size={15} />빠른 접속</button>
          <button className="btn" onClick={() => useApp.setState({ dialog: { kind: 'host', groupId: null } })}><Plus size={15} />새 서버 등록</button>
          <button className="btn" onClick={() => useApp.setState({ dialog: { kind: 'import' } })}><Download size={15} />{isMac ? 'SSH config 가져오기' : 'PuTTY에서 가져오기'}</button>
        </div>
        <AdBanner slot="welcome" />
        {recent.length > 0 && (
          <div className="recent-grid">
            {recent.map((h) => (
              <div key={h.id} className="recent-card" onClick={() => st().openHost(h.id)}>
                <span className="rc-bar" style={{ background: hostColor(h, groups) ?? 'var(--border-2)' }} />
                <ProtoIcon p={h.protocol} />
                <div style={{ minWidth: 0 }}>
                  <b>{h.alias}</b>
                  <span>{h.protocol === 'serial' ? h.serial?.path : `${h.username ? h.username + '@' : ''}${h.host}`}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="shortcut-list">
          {SHORTCUTS.slice(0, 12).map(([a, b]) => (
            <div key={a}><span>{a}</span><span className="kbd">{b}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}
