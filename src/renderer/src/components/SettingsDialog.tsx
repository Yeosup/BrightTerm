import { useEffect, useState } from 'react'
import { Palette, Keyboard, ImageUp, Plug, Shield, Archive, Info, Trash2, FolderOpen, RefreshCw } from 'lucide-react'
import { useApp } from '../state'
import { api } from '../api'
import { Modal, Field, Toggle, Seg } from './ui'
import { TERMINAL_THEMES } from '../themes'
import { SHORTCUTS } from './Welcome'
import { DEFAULT_SETTINGS, type SyncStatus } from '@shared/types'
import { isMac, SC, osUnlockText } from '../platform'

type Sec = 'look' | 'input' | 'image' | 'conn' | 'security' | 'sync' | 'backup' | 'about'

export function SettingsDialog({ section }: { section?: string }): JSX.Element {
  const { settings, vault, creds, hosts } = useApp()
  const [sec, setSec] = useState<Sec>((section as Sec) ?? 'look')
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [pw, setPw] = useState({ old: '', a: '', b: '', msg: '' })
  const st = useApp.getState
  const set = st().setSettings
  const close = (): void => useApp.setState({ dialog: null })
  useEffect(() => { api.app.info().then(setInfo) }, [])

  const nav: [Sec, string, JSX.Element][] = [
    ['look', '모양', <Palette size={15} key="a" />],
    ['input', '입력·붙여넣기', <Keyboard size={15} key="b" />],
    ['image', '이미지·파일 전송', <ImageUp size={15} key="c" />],
    ['conn', '연결', <Plug size={15} key="d" />],
    ['security', '보안·계정', <Shield size={15} key="e" />],
    ['sync', '동기화 (git)', <RefreshCw size={15} key="s" />],
    ['backup', '백업', <Archive size={15} key="f" />],
    ['about', '정보·단축키', <Info size={15} key="g" />]
  ]

  return (
    <Modal title="설정" onClose={close} size="lg">
      <div className="settings">
        <nav>
          {nav.map(([k, l, i]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}>{i}{l}</button>)}
        </nav>
        <div className="s-body">
          {sec === 'look' && (
            <>
              <div className="card">
                <Toggle label="창 크기·위치 기억" desc="앱을 다시 켜면 마지막 크기·위치(최대화 포함)로 엽니다. 모니터가 바뀌어 화면 밖이면 가운데로 엽니다" value={settings.rememberWindow} onChange={(v) => set({ rememberWindow: v })} />
                <div className="toggle">
                  <div className="t-label"><span>창 크기 원래대로</span><small>처음 크기(1440×900, 화면보다 크면 화면에 맞춤)로 되돌리고 가운데에 놓습니다</small></div>
                  <button className="btn sm" onClick={() => api.app.resetWindow()}>원래 크기로</button>
                </div>
              </div>
              <Field label="앱 테마">
                <Seg value={settings.theme} onChange={(v) => set({ theme: v, terminalTheme: v === 'light' && settings.terminalTheme === 'BrightTerm Dark' ? 'BrightTerm Light' : v === 'dark' && settings.terminalTheme === 'BrightTerm Light' ? 'BrightTerm Dark' : settings.terminalTheme })}
                  options={[{ value: 'dark', label: '다크' }, { value: 'light', label: '라이트' }]} />
              </Field>
              <Field label="터미널 색 테마">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {Object.entries(TERMINAL_THEMES).map(([name, t]) => (
                    <div key={name} onClick={() => set({ terminalTheme: name })}
                      style={{ cursor: 'pointer', borderRadius: 8, padding: '8px 10px', background: t.background, color: t.foreground, border: `2px solid ${settings.terminalTheme === name ? 'var(--accent)' : 'var(--border)'}`, fontFamily: settings.fontFamily, fontSize: 12 }}>
                      <div style={{ marginBottom: 4 }}>{name}</div>
                      <span style={{ color: t.green }}>user@host</span>:<span style={{ color: t.blue }}>~</span>$ <span style={{ color: t.yellow }}>ls</span> <span style={{ color: t.red }}>err</span>
                    </div>
                  ))}
                </div>
              </Field>
              <div className="grid3">
                <Field label="글꼴" hint="D2Coding, Cascadia Mono 등 설치된 고정폭 글꼴"><input className="input" value={settings.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} /></Field>
                <Field label="글자 크기"><input className="input" type="number" min={8} max={32} value={settings.fontSize} onChange={(e) => set({ fontSize: Math.max(8, Math.min(32, +e.target.value || 14)) })} /></Field>
                <Field label="줄 간격"><input className="input" type="number" step={0.05} min={1} max={2} value={settings.lineHeight} onChange={(e) => set({ lineHeight: +e.target.value || 1.15 })} /></Field>
              </div>
              <div className="grid2">
                <Field label="커서 모양"><Seg value={settings.cursorStyle} onChange={(v) => set({ cursorStyle: v })} options={[{ value: 'block', label: '블록' }, { value: 'bar', label: '막대' }, { value: 'underline', label: '밑줄' }]} /></Field>
                <Field label="스크롤백 (줄)"><input className="input" type="number" value={settings.scrollback} onChange={(e) => set({ scrollback: Math.max(500, Math.min(200000, +e.target.value || 10000)) })} /></Field>
              </div>
              <div className="card">
                <Toggle label="커서 깜빡임" value={settings.cursorBlink} onChange={(v) => set({ cursorBlink: v })} />
                <Toggle label="벨 소리" value={settings.bell} onChange={(v) => set({ bell: v })} />
              </div>
            </>
          )}
          {sec === 'input' && (
            <>
              <div className="card">
                <Toggle label="선택하면 자동 복사" desc="PuTTY처럼 마우스로 드래그하면 바로 클립보드에 복사됩니다" value={settings.copyOnSelect} onChange={(v) => set({ copyOnSelect: v })} />
                <Toggle label="원격 복사를 이 PC 클립보드로" desc="tmux 마우스 선택·vim·Claude Code 등이 보내는 복사(OSC 52)를 클립보드에 넣습니다. 클립보드 읽기 요청은 거절합니다" value={settings.osc52Clipboard} onChange={(v) => set({ osc52Clipboard: v })} />
                <Toggle label="Shift+Enter 로 줄바꿈" desc="명령을 실행하지 않고 새 줄을 넣습니다 (Claude Code 등 여러 줄 입력). 끄면 Enter 와 같습니다" value={settings.shiftEnterNewline} onChange={(v) => set({ shiftEnterNewline: v })} />
                <Toggle label="오른쪽 클릭으로 붙여넣기" desc="끄면 오른쪽 클릭 시 메뉴가 나옵니다 (켜져 있어도 Shift+오른쪽 클릭은 메뉴)" value={settings.rightClickPaste} onChange={(v) => set({ rightClickPaste: v })} />
                {!isMac && <Toggle label="Ctrl+V로 붙여넣기" desc="끄면 Ctrl+V가 서버로 전달되고, 붙여넣기는 Ctrl+Shift+V" value={settings.ctrlVPaste} onChange={(v) => set({ ctrlVPaste: v })} />}
                <Toggle label="여러 줄 붙여넣기 확인" desc="여러 줄을 붙여넣으면 실행 전에 한 번 확인합니다" value={settings.confirmMultilinePaste} onChange={(v) => set({ confirmMultilinePaste: v })} />
                <Toggle label="운영 서버 위험 명령 확인" desc="'운영' 환경 서버에서 아래 패턴의 명령을 실행하거나 붙여넣을 때 확인 창을 띄웁니다" value={settings.guardDangerousOnProd} onChange={(v) => set({ guardDangerousOnProd: v })} />
              </div>
              <Field label="위험 명령 패턴 (정규식, 한 줄에 하나)">
                <textarea className="textarea" rows={7} value={settings.dangerousPatterns.join('\n')} onChange={(e) => set({ dangerousPatterns: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
              </Field>
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ dangerousPatterns: DEFAULT_SETTINGS.dangerousPatterns })}>기본값으로</button>
            </>
          )}
          {sec === 'image' && (
            <>
              <div className="notice">
                <ImageUp size={16} style={{ flexShrink: 0 }} />
                <div>
                  SSH 터미널에서 <b>{SC.paste}</b>로 이미지(캡처)를 붙여넣거나 파일을 터미널로 끌어다 놓으면, 서버의 업로드 폴더로 전송한 뒤 그 <b>경로를 터미널에 입력</b>합니다.
                  서버에서 실행 중인 <b>Claude Code</b> 등 CLI는 이 경로로 이미지를 읽을 수 있습니다. 예: <span className="kbd">이 화면의 오류 원인 알려줘</span> 입력 후 {SC.paste}.
                </div>
              </div>
              <Field label="서버 업로드 폴더" hint="~ 는 서버의 홈 디렉터리입니다. 폴더가 없으면 자동으로 만듭니다.">
                <input className="input mono" value={settings.uploadDir} onChange={(e) => set({ uploadDir: e.target.value })} />
              </Field>
              <Field label="오래된 업로드 자동 삭제 (일)" hint="BrightTerm이 올린 파일(bt- 로 시작)만 삭제합니다. 0이면 삭제하지 않습니다.">
                <input className="input" type="number" min={0} value={settings.uploadCleanupDays} onChange={(e) => set({ uploadCleanupDays: Math.max(0, +e.target.value || 0) })} />
              </Field>
              <div className="card">
                <Toggle label="공백이 있는 경로는 따옴표로 감싸기" value={settings.insertPathQuote} onChange={(v) => set({ insertPathQuote: v })} />
              </div>
            </>
          )}
          {sec === 'conn' && (
            <>
              <div className="card">
                <Toggle label="끊기면 자동 재접속" desc="네트워크가 끊기면 2·4·8…초 간격으로 최대 8번 다시 연결합니다" value={settings.autoReconnect} onChange={(v) => set({ autoReconnect: v })} />
                <Toggle label="시작할 때 지난 탭·분할 다시 열기" desc="앱을 다시 켜면 닫을 때 열려 있던 탭과 분할 배치로 다시 접속합니다. 세션 유지(tmux)를 켠 창은 하던 화면 그대로 돌아옵니다" value={settings.restoreTabs} onChange={(v) => set({ restoreTabs: v })} />
                <Toggle label="세션 로그 저장" desc="터미널 출력을 텍스트 파일로 저장합니다 (새 연결부터 적용)" value={settings.sessionLog} onChange={(v) => set({ sessionLog: v })} />
              </div>
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => api.app.openLogs()}><FolderOpen size={13} />로그 폴더 열기</button>
            </>
          )}
          {sec === 'sync' && <SyncSection />}
          {sec === 'security' && (
            <>
              <Field label="자동 잠금 (분)" hint={(isMac ? 'Mac을 이 시간 동안 사용하지 않거나, 화면을 잠그거나 잠자기에 들어가면' : 'PC를 이 시간 동안 사용하지 않거나, Windows를 잠그거나 절전하면') + ' 볼트를 잠급니다. 열린 세션은 유지됩니다. 0 = 사용 안 함'}>
                <input className="input" type="number" min={0} value={settings.autoLockMinutes} onChange={(e) => set({ autoLockMinutes: Math.max(0, +e.target.value || 0) })} />
              </Field>
              {vault.osUnlockAvailable && (
                <div className="card">
                  <Toggle label={osUnlockText(vault.osUnlockKind).toggle} desc={osUnlockText(vault.osUnlockKind).desc} value={vault.osUnlockEnabled}
                    onChange={async (v) => { try { await api.vault.setOsUnlock(v); useApp.setState({ vault: await api.vault.status() }) } catch (e) { st().toast('error', (e as Error).message) } }} />
                </div>
              )}
              {api.platform === 'linux' && (
                <Field label="리눅스 키링" hint={`볼트 OS 잠금해제에 쓸 키링. 자동이면 데스크톱에 맞춰 고릅니다(지금: ${vault.linuxBackend ?? '알 수 없음'}${vault.osUnlockAvailable ? '' : ' — 쓸 수 있는 키링이 없어 OS 잠금해제가 꺼져 있습니다'}). 바꾸면 앱을 다시 시작해야 적용됩니다`}>
                  <Seg value={settings.linuxKeyring} onChange={(v) => { set({ linuxKeyring: v }); st().toast('info', '앱을 다시 시작하면 적용됩니다') }}
                    options={[{ value: 'auto', label: '자동' }, { value: 'gnome-libsecret', label: 'GNOME 키링' }, { value: 'kwallet5', label: 'KWallet 5' }, { value: 'kwallet6', label: 'KWallet 6' }]} />
                </Field>
              )}
              <h3>마스터 비밀번호 변경</h3>
              <div className="grid3">
                <input className="input" type="password" placeholder="현재 비밀번호" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
                <input className="input" type="password" placeholder="새 비밀번호" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
                <input className="input" type="password" placeholder="새 비밀번호 확인" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
              </div>
              <div className="row">
                <button className="btn sm" onClick={async () => {
                  if (pw.a.length < 8) return setPw({ ...pw, msg: '새 비밀번호는 8자 이상' })
                  if (pw.a !== pw.b) return setPw({ ...pw, msg: '새 비밀번호가 일치하지 않습니다' })
                  const ok = await api.vault.changePassword(pw.old, pw.a)
                  setPw({ old: '', a: '', b: '', msg: ok ? '변경했습니다' : '현재 비밀번호가 틀립니다' })
                }}>변경</button>
                <span className="muted">{pw.msg}</span>
              </div>
              <h3>저장된 계정 ({creds.length})</h3>
              <div className="card" style={{ padding: 0 }}>
                {creds.length === 0 && <div className="empty">저장된 계정이 없습니다</div>}
                {creds.map((c) => {
                  const used = hosts.filter((h) => h.credentialId === c.id)
                  return (
                    <div key={c.id} className="toggle" style={{ padding: '8px 12px' }}>
                      <div className="t-label">
                        <span>{c.name} {c.username && <span className="muted">({c.username})</span>} <span className="pill" style={{ background: 'var(--bg-3)' }}>{c.kind === 'key' ? '키' : '비밀번호'}</span></span>
                        <small>{used.length ? `사용 중: ${used.map((h) => h.alias).slice(0, 4).join(', ')}${used.length > 4 ? ` 외 ${used.length - 4}` : ''}` : '사용하는 서버 없음'}</small>
                      </div>
                      <div className="row">
                        <button className="btn sm" onClick={async () => { const n = await st().prompt('계정 이름', c.name); if (n) { await api.cred.save({ id: c.id, name: n, kind: c.kind }); st().refreshCreds() } }}>이름</button>
                        <button className="ibtn sm" onClick={async () => {
                          if (!(await st().confirm({ title: '계정 삭제', message: `"${c.name}" 계정을 볼트에서 삭제할까요?${used.length ? ` ${used.length}개 서버가 접속할 때 비밀번호를 다시 묻게 됩니다.` : ''}`, danger: true, okText: '삭제' }))) return
                          await api.cred.remove(c.id)
                          st().save({ hosts: st().hosts.map((h) => (h.credentialId === c.id ? { ...h, credentialId: null } : h)) })
                          st().refreshCreds()
                        }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
          {sec === 'backup' && (
            <>
              <div className="notice">백업 파일에는 서버 목록·설정·스니펫과 <b>암호화된</b> 볼트가 들어 있습니다. 다른 PC에서 가져온 뒤 같은 마스터 비밀번호로 열 수 있습니다.</div>
              <div className="row">
                <button className="btn primary" onClick={async () => { try { const p = await api.backup.export(); if (p) st().toast('ok', `백업 저장: ${p}`) } catch (e) { st().toast('error', (e as Error).message) } }}>백업 내보내기</button>
                <button className="btn" onClick={async () => {
                  if (!(await st().confirm({ title: '백업 가져오기', message: '현재 서버 목록과 볼트가 백업 파일 내용으로 바뀝니다. 계속할까요?', danger: true, okText: '가져오기' }))) return
                  try { if (await api.backup.import()) { await st().reloadStore(); useApp.setState({ vault: await api.vault.status() }); st().toast('ok', '백업을 가져왔습니다. 백업한 PC의 마스터 비밀번호로 잠금을 해제하세요.') } } catch (e) { st().toast('error', (e as Error).message) }
                }}>백업 가져오기</button>
              </div>
            </>
          )}
          {sec === 'about' && (
            <>
              <div className="row" style={{ gap: 14 }}>
                <div className="logo-mark" style={{ width: 44, height: 44, fontSize: 22, borderRadius: 12 }}>B</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>BrightTerm {info?.version}</div>
                  <div className="muted">SSH · Telnet · Serial · 로컬 터미널 — 밝은터</div>
                </div>
              </div>
              <div className="card">
                <Toggle label="새 버전 알림" desc="새 버전이 나오면 아래 상태 표시줄에 알려 줍니다. 시작할 때와 12시간마다 GitHub 릴리스를 확인하며, 어떤 정보도 보내지 않습니다. 설치는 직접 내려받아 합니다" value={settings.checkUpdates} onChange={(v) => set({ checkUpdates: v })} />
              </div>
              <button
                className="btn sm"
                style={{ alignSelf: 'flex-start' }}
                disabled={checking}
                onClick={async () => {
                  setChecking(true)
                  const r = await api.update.check().catch(() => ({ ok: false, latest: null }))
                  setChecking(false)
                  if (r.latest) {
                    st().toast('info', `새 버전 ${r.latest.version}이 나왔습니다 — 릴리스 페이지를 엽니다`)
                    void api.app.openExternal(r.latest.url)
                  } else if (r.ok) st().toast('ok', `최신 버전입니다 (${info?.version ?? ''})`)
                  else st().toast('error', '확인하지 못했습니다 — 인터넷 연결을 확인하세요')
                }}
              >{checking ? '확인 중…' : '지금 확인'}</button>
              <Field label="개발자·저작권자"><div>Dany Kim · Copyright © 2026 Dany Kim</div></Field>
              <Field label="라이선스" hint="1.0.0~1.1.0 은 MIT 로 배포되었습니다">
                <div>BrightTerm Source-Available License 1.0</div>
                <div className="muted">개인·회사 업무 사용 무료 · 유료 재배포·유료 번들은 별도 허락 필요</div>
                <div className="row" style={{ marginTop: 8, gap: 8 }}>
                  <button className="btn sm" onClick={() => api.app.openLegal('license').catch((e) => st().toast('error', (e as Error).message))}>라이선스 전문</button>
                  <button className="btn sm" onClick={() => api.app.openLegal('notices').catch((e) => st().toast('error', (e as Error).message))}>제3자 라이선스</button>
                  <button className="btn sm" onClick={() => api.app.openLegal('chromium').catch((e) => st().toast('error', (e as Error).message))}>Chromium 고지</button>
                </div>
              </Field>
              <Field label="데이터 폴더"><div className="code">{info?.dataDir}</div></Field>
              <h3>단축키</h3>
              <div className="shortcut-list" style={{ marginTop: 0 }}>
                {SHORTCUTS.map(([a, b]) => <div key={a}><span>{a}</span><span className="kbd">{b}</span></div>)}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function syncLine(s: SyncStatus | null): string {
  if (!s || s.state === 'off') return '꺼짐 — 저장소 주소를 넣으면 켜집니다'
  if (s.state === 'running') return '동기화 중...'
  if (s.state === 'error') return `실패: ${s.error}`
  if (s.state === 'mismatch') return s.error ?? '저장소의 볼트가 다릅니다'
  if (!s.lastSyncAt) return '아직 동기화하지 않았습니다'
  const parts = [`${new Date(s.lastSyncAt).toLocaleString()} 동기화`]
  if (s.pulled) parts.push(`받음 ${s.pulled}`)
  if (s.pushed) parts.push('올림')
  if (s.conflicts) parts.push(`양쪽에서 고친 ${s.conflicts}개는 이 PC 것으로`)
  if (!s.pulled && !s.pushed) parts.push('바뀐 것 없음')
  return parts.join(' · ')
}

function SyncSection(): JSX.Element {
  const sync = useApp((s) => s.settings.sync)
  const st = useApp.getState
  const [remote, setRemote] = useState(sync.remote)
  const [branch, setBranch] = useState(sync.branch)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  useEffect(() => {
    api.sync.status().then(setStatus)
    return api.on.sync(setStatus)
  }, [])
  const save = (p: Partial<typeof sync>): void => st().setSettings({ sync: { ...st().settings.sync, ...p } })
  const run = async (mode: 'merge' | 'takeRemote' | 'pushLocal'): Promise<void> => {
    save({ remote: remote.trim(), branch: branch.trim() || 'main' })
    const r = await api.sync.run(mode)
    setStatus(r)
    if (r.state === 'idle' && mode === 'takeRemote') st().toast('info', '저장소의 볼트를 받았습니다 — 그 볼트의 마스터 비밀번호로 여세요')
    else if (r.state === 'idle') st().toast('ok', '동기화했습니다')
    else if (r.state === 'error') st().toast('error', `동기화 실패: ${r.error}`)
  }
  return (
    <>
      <div className="muted" style={{ lineHeight: 1.6 }}>
        서버 목록·폴더·스니펫·저장된 계정을 git 저장소로 여러 PC 에 맞춥니다. 저장소에는 <b>볼트 키로 암호화한 파일 하나</b>만 올라가
        주소·계정명도 평문으로 남지 않고, 다른 PC 는 <b>같은 마스터 비밀번호</b>로 엽니다. 비공개 저장소를 쓰세요.
        인증은 이 PC 의 git 설정(SSH 키·자격 증명 도우미)을 그대로 씁니다.
      </div>
      <Field label="git 저장소 주소" hint="예: git@github.com:me/brightterm-sync.git — 비어 있는 새 저장소여도 됩니다">
        <input className="input mono" placeholder="git@github.com:사용자/저장소.git" value={remote} onChange={(e) => setRemote(e.target.value)} onBlur={() => save({ remote: remote.trim() })} />
      </Field>
      <div className="grid2">
        <Field label="브랜치"><input className="input mono" value={branch} onChange={(e) => setBranch(e.target.value)} onBlur={() => save({ branch: branch.trim() || 'main' })} /></Field>
      </div>
      <div className="card">
        <Toggle label="자동 동기화" desc="볼트를 열 때, 서버·계정을 바꾸고 20초 뒤, 그리고 10분마다" value={sync.auto} onChange={(v) => save({ auto: v })} />
      </div>
      <div className="row">
        <button className="btn sm primary" disabled={!remote.trim() || status?.state === 'running'} onClick={() => run('merge')}><RefreshCw size={13} />지금 동기화</button>
        <span className={`muted sync-line ${status?.state ?? ''}`}>{syncLine(status)}</span>
      </div>
      {status?.state === 'mismatch' && (
        <div className="card" style={{ gap: 10, padding: 12 }}>
          <div>저장소에 <b>다른 볼트</b>(다른 마스터 비밀번호로 만든 볼트)가 있습니다. 어느 쪽으로 맞출까요?</div>
          <div className="row">
            <button className="btn sm" onClick={async () => {
              if (await st().confirm({ title: '저장소 볼트 받기', message: '이 PC 의 볼트를 저장소의 볼트로 바꿉니다. 볼트가 잠기고, 저장소 볼트의 마스터 비밀번호로 열어야 합니다. 이 PC 에만 있던 저장된 계정은 사라집니다(서버 목록은 합쳐집니다).', okText: '받기', danger: true })) run('takeRemote')
            }}>저장소 볼트 받기 (이 PC 가 새 PC 일 때)</button>
            <button className="btn sm" onClick={async () => {
              if (await st().confirm({ title: '이 PC 볼트로 덮어쓰기', message: '저장소의 동기화 파일을 이 PC 의 볼트·서버 목록으로 덮어씁니다. 다른 PC 들은 이 볼트의 마스터 비밀번호로 다시 맞춰야 합니다.', okText: '덮어쓰기', danger: true })) run('pushLocal')
            }}>이 PC 볼트로 덮어쓰기</button>
          </div>
        </div>
      )}
    </>
  )
}
