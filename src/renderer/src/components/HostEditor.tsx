import { useEffect, useState } from 'react'
import { KeyRound, Lock, Plus, Trash2, RefreshCw, FileKey, FolderOpen } from 'lucide-react'
import { useApp, newHost } from '../state'
import { api } from '../api'
import { Modal, Field, Seg, ColorPick, Switch } from './ui'
import { ENV_COLORS, ENV_LABELS, type Env, type Group, type Host, type InlineJump, type SerialOptions } from '@shared/types'
import { isMac } from '../platform'

const ENVS: Env[] = ['none', 'prod', 'stage', 'dev', 'device']
const DEFAULT_SERIAL: SerialOptions = { path: isMac ? '' : 'COM1', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none', enterSends: 'CR', localEcho: false }
const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

function groupPath(groups: Group[], id: string | null): string {
  const parts: string[] = []
  let g = groups.find((x) => x.id === id)
  while (g) {
    parts.unshift(g.name)
    g = groups.find((x) => x.id === g!.parentId)
  }
  return parts.join(' / ')
}

export function HostEditor({ host: initial, groupId }: { host?: Host; groupId?: string | null }): JSX.Element {
  const { groups, hosts, creds, vault } = useApp()
  const isNew = !initial
  const [h, setH] = useState<Host>(() => initial ? structuredClone(initial) : newHost(groupId ?? null))
  const [tab, setTab] = useState<'basic' | 'auth' | 'adv' | 'fw'>('basic')
  const [password, setPassword] = useState('')
  const [keyText, setKeyText] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [credMode, setCredMode] = useState<'own' | 'shared'>('own')
  const [ports, setPorts] = useState<{ path: string; label: string }[]>([])
  const [shells, setShells] = useState<{ path: string; label: string }[]>([])
  // 직접 입력한 베스천의 새 비밀(저장 때 볼트로)
  const [jKeyText, setJKeyText] = useState('')
  const [jKeyPath, setJKeyPath] = useState('')
  const [jPassphrase, setJPassphrase] = useState('')
  const [jPassword, setJPassword] = useState('')
  const jumpInline = !!h.jump
  const jump: InlineJump = h.jump ?? { host: '', port: 22, username: '', authType: 'key', credentialId: null }
  const setJump = (p: Partial<InlineJump>): void => set('jump', { ...jump, ...p })
  const jumpCred = creds.find((c) => c.id === h.jump?.credentialId)
  const [err, setErr] = useState('')
  const st = useApp.getState

  const cred = creds.find((c) => c.id === h.credentialId)
  useEffect(() => {
    if (cred && cred.name !== (initial?.alias ?? '') && hosts.filter((x) => x.credentialId === cred.id).length > 1) setCredMode('shared')
  }, [])

  const set = <K extends keyof Host>(k: K, v: Host[K]): void => setH((x) => ({ ...x, [k]: v }))
  const refreshPorts = (): void => { api.serial.list().then(setPorts) }
  useEffect(() => { if (h.protocol === 'serial') refreshPorts() }, [h.protocol])
  useEffect(() => { if (h.protocol === 'local' && !shells.length) api.local.shells().then(setShells) }, [h.protocol])
  const setLocal = (p: Partial<NonNullable<Host['local']>>): void => set('local', { ...h.local, ...p })
  const pickDir = async (): Promise<void> => {
    const d = await api.dialog.chooseDir()
    if (d) setLocal({ cwd: d })
  }

  const close = (): void => useApp.setState({ dialog: null })

  const save = async (connect = false): Promise<void> => {
    setErr('')
    const localName = h.local?.cwd?.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '로컬 터미널'
    const out = { ...h, alias: h.alias.trim() || (h.protocol === 'serial' ? h.serial?.path ?? 'Serial' : h.protocol === 'local' ? localName : h.host.trim()), host: h.host.trim(), username: h.username.trim() }
    if (out.protocol === 'local') Object.assign(out, { host: '', port: 0, username: '', authType: 'ask', credentialId: null, jumpHostId: null, forwards: [], encoding: 'utf-8', local: { shell: h.local?.shell?.trim() || undefined, cwd: h.local?.cwd?.trim() || undefined } })
    if (out.protocol !== 'serial' && out.protocol !== 'local' && !out.host) { setTab('basic'); return setErr('호스트 주소를 입력하세요') }
    if (out.protocol !== 'ssh' || out.jumpHostId) out.jump = null
    if (out.jump) {
      out.jump = { ...out.jump, host: out.jump.host.trim(), username: out.jump.username.trim(), port: out.jump.port || 22 }
      if (!out.jump.host) { setTab('adv'); return setErr('베스천 주소를 입력하세요') }
    }
    if (out.protocol === 'serial' && !out.serial?.path) { setTab('basic'); return setErr('시리얼 포트를 선택하세요') }
    try {
      const needsSecret = (out.authType === 'password' && password) || (out.authType === 'key' && keyText)
      if (needsSecret && credMode === 'own') {
        if (!vault.unlocked) return setErr('볼트가 잠겨 있어 비밀번호를 저장할 수 없습니다')
        const ownId = cred && hosts.filter((x) => x.credentialId === cred.id && x.id !== out.id).length === 0 ? cred.id : undefined
        const meta = await api.cred.save({
          id: ownId,
          name: out.alias,
          kind: out.authType === 'key' ? 'key' : 'password',
          username: out.username,
          password: out.authType === 'password' ? password : undefined,
          privateKey: out.authType === 'key' ? keyText : undefined,
          passphrase: out.authType === 'key' && passphrase ? passphrase : undefined
        })
        out.credentialId = meta.id
        await st().refreshCreds()
      }
      if (out.jump) {
        const jNeeds = (out.jump.authType === 'key' && jKeyText) || (out.jump.authType === 'password' && jPassword)
        if (jNeeds) {
          if (!vault.unlocked) return setErr('볼트가 잠겨 있어 베스천 키를 저장할 수 없습니다')
          const meta = await api.cred.save({
            id: out.jump.credentialId && hosts.filter((x) => x.jump?.credentialId === out.jump!.credentialId && x.id !== out.id).length === 0 ? out.jump.credentialId : undefined,
            name: `${out.alias} 베스천`,
            kind: out.jump.authType === 'key' ? 'key' : 'password',
            username: out.jump.username,
            password: out.jump.authType === 'password' ? jPassword : undefined,
            privateKey: out.jump.authType === 'key' ? jKeyText : undefined,
            passphrase: out.jump.authType === 'key' && jPassphrase ? jPassphrase : undefined
          })
          out.jump.credentialId = meta.id
          await st().refreshCreds()
        }
      }
      if (out.authType === 'ask' || out.authType === 'agent') {
        // keep credential link only if shared explicitly
        if (credMode === 'own') out.credentialId = out.authType === 'agent' ? out.credentialId : null
      }
      st().upsertHost(out)
      close()
      if (connect) st().openHost(out.id)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const loadJumpKey = async (): Promise<void> => {
    const r = await api.dialog.readKeyFile()
    if (!r) return
    setJKeyText(r.text)
    setJKeyPath(r.path)
    if (/PuTTY-User-Key-File-3/.test(r.text)) setErr('PPK v3 키는 PuTTYgen → Conversions → Export OpenSSH key 로 변환해 주세요')
  }

  const loadKey = async (): Promise<void> => {
    const r = await api.dialog.readKeyFile()
    if (!r) return
    setKeyText(r.text)
    setKeyPath(r.path)
    if (/PuTTY-User-Key-File-3/.test(r.text)) setErr('PPK v3 키는 PuTTYgen → Conversions → Export OpenSSH key 로 변환해 주세요')
  }

  const serial = h.serial ?? DEFAULT_SERIAL
  const setSerial = (p: Partial<SerialOptions>): void => set('serial', { ...serial, ...p })
  const flatGroups = groups.map((g) => ({ id: g.id, label: groupPath(groups, g.id) })).sort((a, b) => a.label.localeCompare(b.label))

  return (
    <Modal title={isNew ? '새 서버' : `서버 편집 · ${initial?.alias}`} onClose={close}
      foot={<>
        {err && <span className="left err">{err}</span>}
        <button className="btn" onClick={close}>취소</button>
        <button className="btn" onClick={() => save(false)}>저장</button>
        <button className="btn primary" onClick={() => save(true)}>저장 후 연결</button>
      </>}>
      <div className="mtabs">
        {([['basic', '기본'], ['auth', '인증'], ['adv', '고급'], ['fw', '포트 포워딩']] as const).filter(([k]) => h.protocol === 'ssh' || (k !== 'auth' && k !== 'fw')).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="modal-body" style={{ paddingTop: 14, minHeight: 380 }}>
        {tab === 'basic' && (
          <>
            <Field label="프로토콜">
              <Seg value={h.protocol} onChange={(v) => { set('protocol', v); if (v === 'telnet' && h.port === 22) set('port', 23); if (v === 'ssh' && h.port === 23) set('port', 22); if (v === 'serial' && !h.serial) set('serial', DEFAULT_SERIAL); if (v === 'serial' && (!h.env || h.env === 'none')) set('env', 'device'); if (v !== 'local' && h.port === 0) set('port', v === 'telnet' ? 23 : 22) }}
                options={[{ value: 'ssh', label: 'SSH' }, { value: 'telnet', label: 'Telnet' }, { value: 'serial', label: isMac ? '시리얼 (USB/RS-485)' : '시리얼 (COM/RS-485)' }, { value: 'local', label: '로컬 (이 PC)' }]} />
            </Field>
            <Field label="별칭 (탭·목록에 표시될 이름)">
              <input className="input" autoFocus value={h.alias} onChange={(e) => set('alias', e.target.value)} placeholder="예: 운영-WEB01" />
            </Field>
            {h.protocol === 'local' ? (
              <div className="grid2">
                <Field label="시작 폴더" hint="비워 두면 홈 폴더에서 열립니다">
                  <div className="row">
                    <input className="input mono grow" value={h.local?.cwd ?? ''} onChange={(e) => setLocal({ cwd: e.target.value })} placeholder={isMac ? '~/Work/프로젝트' : 'C:\\Work\\프로젝트'} />
                    <button className="btn" onClick={pickDir} title="폴더 선택"><FolderOpen size={14} /></button>
                  </div>
                </Field>
                <Field label="셸">
                  <select className="select" value={h.local?.shell ?? ''} onChange={(e) => setLocal({ shell: e.target.value || undefined })}>
                    <option value="">기본 ({shells[0]?.label ?? '…'})</option>
                    {shells.slice(1).map((s) => <option key={s.path} value={s.path}>{s.label}</option>)}
                  </select>
                </Field>
              </div>
            ) : h.protocol !== 'serial' ? (
              <div className="grid3">
                <Field label="호스트 (IP 또는 도메인)">
                  <input className="input mono" value={h.host} onChange={(e) => {
                    const v = e.target.value
                    const m = v.match(/^([^@\s]+)@([^:\s]+)(?::(\d+))?$/)
                    if (m) { set('username', m[1]); set('host', m[2]); if (m[3]) set('port', +m[3]) } else set('host', v)
                  }} placeholder="10.0.0.11  또는  user@host:22" />
                </Field>
                <Field label="포트"><input className="input mono" type="number" value={h.port} onChange={(e) => set('port', +e.target.value || 0)} /></Field>
                <Field label="사용자 이름"><input className="input mono" value={h.username} onChange={(e) => set('username', e.target.value)} placeholder="root" /></Field>
              </div>
            ) : (
              <>
                <div className="grid2">
                  <Field label={<span className="row">포트 <button className="link" onClick={refreshPorts}><RefreshCw size={11} /> 새로고침</button></span>}>
                    <input className="input mono" list="serial-ports" value={serial.path} onChange={(e) => setSerial({ path: e.target.value })} placeholder={isMac ? '/dev/cu.usbserial-XXXX' : 'COM3'} />
                    <datalist id="serial-ports">{ports.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}</datalist>
                  </Field>
                  <Field label="속도 (baud)">
                    <select className="select" value={serial.baudRate} onChange={(e) => setSerial({ baudRate: +e.target.value })}>{BAUDS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
                  </Field>
                </div>
                <div className="grid2">
                  <Field label="데이터 / 패리티 / 정지 비트">
                    <div className="row">
                      <select className="select" value={serial.dataBits} onChange={(e) => setSerial({ dataBits: +e.target.value as SerialOptions['dataBits'] })}>{[8, 7, 6, 5].map((b) => <option key={b}>{b}</option>)}</select>
                      <select className="select" value={serial.parity} onChange={(e) => setSerial({ parity: e.target.value as SerialOptions['parity'] })}>{['none', 'even', 'odd', 'mark', 'space'].map((b) => <option key={b}>{b}</option>)}</select>
                      <select className="select" value={serial.stopBits} onChange={(e) => setSerial({ stopBits: +e.target.value as SerialOptions['stopBits'] })}>{[1, 1.5, 2].map((b) => <option key={b}>{b}</option>)}</select>
                    </div>
                  </Field>
                  <Field label="흐름 제어 / Enter 전송값">
                    <div className="row">
                      <select className="select" value={serial.flowControl} onChange={(e) => setSerial({ flowControl: e.target.value as SerialOptions['flowControl'] })}><option value="none">없음</option><option value="rtscts">RTS/CTS</option><option value="xonxoff">XON/XOFF</option></select>
                      <select className="select" value={serial.enterSends} onChange={(e) => setSerial({ enterSends: e.target.value as SerialOptions['enterSends'] })}><option>CR</option><option>LF</option><option>CRLF</option></select>
                    </div>
                  </Field>
                </div>
                <div className="toggle"><div className="t-label"><span>로컬 에코</span><small>장비가 입력한 글자를 돌려주지 않을 때 켜세요</small></div><Switch value={serial.localEcho} onChange={(v) => setSerial({ localEcho: v })} /></div>
              </>
            )}
            <div className="grid2">
              <Field label="폴더">
                <select className="select" value={h.groupId ?? ''} onChange={(e) => set('groupId', e.target.value || null)}>
                  <option value="">(최상위)</option>
                  {flatGroups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
              </Field>
              <Field label="태그 (쉼표로 구분)">
                <input className="input" value={h.tags.join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} placeholder="web, nginx" />
              </Field>
            </div>
            <Field label="환경" hint="운영 서버는 빨간 테두리로 표시되고 위험 명령 실행 전에 확인을 받습니다">
              <Seg value={h.env ?? 'none'} onChange={(v) => set('env', v)} options={ENVS.map((e) => ({ value: e, label: <><span className="dot" style={{ background: ENV_COLORS[e] }} />{ENV_LABELS[e]}</> }))} />
            </Field>
            <Field label="색상 (지정하지 않으면 환경/폴더 색을 따름)"><ColorPick value={h.color} onChange={(v) => set('color', v)} /></Field>
            <Field label="메모"><textarea className="textarea" rows={2} style={{ fontFamily: 'inherit' }} value={h.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
          </>
        )}

        {tab === 'auth' && (
          <>
            {!vault.unlocked && <div className="notice warn"><Lock size={15} />볼트가 잠겨 있습니다. 비밀번호나 키를 저장하려면 먼저 잠금을 해제하세요.</div>}
            <Field label="인증 방식">
              <Seg value={h.authType} onChange={(v) => set('authType', v)} options={[
                { value: 'password', label: '비밀번호' },
                { value: 'key', label: <><KeyRound size={13} />개인 키</> },
                { value: 'agent', label: 'SSH 에이전트 (Pageant)' },
                { value: 'ask', label: '매번 묻기' }
              ]} />
            </Field>
            {(h.authType === 'password' || h.authType === 'key') && (
              <Field label="계정 저장 방식">
                <Seg value={credMode} onChange={setCredMode} options={[{ value: 'own', label: '이 서버 전용' }, { value: 'shared', label: '공유 계정 선택' }]} />
              </Field>
            )}
            {credMode === 'shared' && (h.authType === 'password' || h.authType === 'key') ? (
              <Field label="저장된 계정" hint="같은 계정을 쓰는 서버 여러 대가 하나의 비밀번호를 공유합니다. 비밀번호를 바꾸면 모두 적용됩니다.">
                <select className="select" value={h.credentialId ?? ''} onChange={(e) => set('credentialId', e.target.value || null)}>
                  <option value="">선택하세요</option>
                  {creds.map((c) => <option key={c.id} value={c.id}>{c.name} {c.username ? `(${c.username})` : ''} · {c.kind === 'key' ? '키' : '비밀번호'}</option>)}
                </select>
              </Field>
            ) : h.authType === 'password' ? (
              <Field label="비밀번호" hint={cred ? '저장된 비밀번호가 있습니다. 바꾸려면 새로 입력하세요.' : '비워 두면 처음 접속할 때 묻고, 저장 여부를 선택할 수 있습니다.'}>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={cred ? '••••••••  (저장됨)' : '비밀번호'} autoComplete="new-password" />
              </Field>
            ) : h.authType === 'key' ? (
              <>
                <Field label="개인 키" hint="OpenSSH(id_ed25519, id_rsa), PEM, PuTTY PPK v2 지원. 키 내용은 볼트에 암호화되어 저장됩니다.">
                  <div className="row">
                    <button className="btn" onClick={loadKey}><FileKey size={14} />키 파일 불러오기</button>
                    <span className="muted grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{keyPath || (cred?.kind === 'key' ? '저장된 키 사용 중' : '선택된 키 없음')}</span>
                  </div>
                </Field>
                <Field label="또는 키 내용 붙여넣기">
                  <textarea className="textarea" rows={4} value={keyText} onChange={(e) => setKeyText(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                </Field>
                <Field label="키 암호 (있는 경우)"><input className="input" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" /></Field>
              </>
            ) : h.authType === 'agent' ? (
              <div className="notice">{isMac ? 'macOS의 ssh-agent(SSH_AUTH_SOCK)를 사용합니다. 키체인에 넣은 키는 ssh-add --apple-use-keychain 으로 등록해 두세요.' : 'Windows에서는 Pageant, 그 외에는 SSH_AUTH_SOCK 에이전트를 사용합니다.'} 에이전트 인증이 실패하면 비밀번호를 묻습니다.</div>
            ) : (
              <div className="notice">접속할 때마다 비밀번호를 묻습니다. 입력 창에서 "저장"을 선택하면 다음부터 자동으로 로그인됩니다.</div>
            )}
          </>
        )}

        {tab === 'adv' && (
          <>
            {h.protocol === 'ssh' && (
              <Field label="점프 호스트 (배스천 경유)" hint="이 서버에 접속하기 전에 먼저 거쳐 갈 서버입니다 (ProxyJump).">
                <select className="select" value={jumpInline ? '__inline' : h.jumpHostId ?? ''} onChange={(e) => {
                  const v = e.target.value
                  if (v === '__inline') setH((x) => ({ ...x, jumpHostId: null, jump: x.jump ?? { host: '', port: 22, username: x.username || '', authType: 'key', credentialId: null } }))
                  else setH((x) => ({ ...x, jumpHostId: v || null, jump: null }))
                }}>
                  <option value="">사용 안 함</option>
                  <option value="__inline">직접 입력 (베스천을 따로 등록하지 않음)</option>
                  {hosts.filter((x) => x.id !== h.id && x.protocol === 'ssh').map((x) => <option key={x.id} value={x.id}>{x.alias} ({x.host})</option>)}
                </select>
              </Field>
            )}
            {h.protocol === 'ssh' && jumpInline && (
              <div className="jump-inline">
                <div className="grid3">
                  <Field label="베스천 주소">
                    <input className="input mono" autoFocus={!jump.host} value={jump.host} onChange={(e) => {
                      const v = e.target.value
                      const m = v.match(/^([^@\s]+)@([^:\s]+)(?::(\d+))?$/)
                      if (m) setJump({ username: m[1], host: m[2], ...(m[3] ? { port: +m[3] } : {}) }); else setJump({ host: v })
                    }} placeholder="3.37.115.13  또는  ubuntu@host" />
                  </Field>
                  <Field label="포트"><input className="input mono" type="number" value={jump.port} onChange={(e) => setJump({ port: +e.target.value || 22 })} /></Field>
                  <Field label="사용자 이름"><input className="input mono" value={jump.username} onChange={(e) => setJump({ username: e.target.value })} placeholder="ubuntu" /></Field>
                </div>
                <Field label="베스천 인증">
                  <Seg value={jump.authType} onChange={(v) => setJump({ authType: v })} options={[
                    { value: 'key', label: <><KeyRound size={13} />개인 키</> },
                    { value: 'password', label: '비밀번호' },
                    { value: 'agent', label: 'SSH 에이전트' },
                    { value: 'ask', label: '매번 묻기' }
                  ]} />
                </Field>
                {jump.authType === 'key' && (
                  <div className="grid2">
                    <Field label="베스천 개인 키" hint={isMac ? '~/.ssh 는 숨김 폴더입니다 — 파일 창에서 ⇧⌘G 로 경로를 입력하세요' : undefined}>
                      <div className="row">
                        <button className="btn" onClick={loadJumpKey}><FileKey size={14} />키 파일 불러오기</button>
                        <span className="muted grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{jKeyPath.split(/[\\/]/).pop() || (jumpCred?.kind === 'key' ? '저장된 키 사용 중' : '선택된 키 없음')}</span>
                      </div>
                    </Field>
                    <Field label="키 암호 (있는 경우)"><input className="input" type="password" value={jPassphrase} onChange={(e) => setJPassphrase(e.target.value)} autoComplete="new-password" /></Field>
                  </div>
                )}
                {jump.authType === 'password' && (
                  <Field label="베스천 비밀번호" hint={jumpCred ? '저장된 비밀번호가 있습니다. 바꾸려면 새로 입력하세요.' : undefined}>
                    <input className="input" type="password" value={jPassword} onChange={(e) => setJPassword(e.target.value)} placeholder={jumpCred ? '••••••••  (저장됨)' : '비밀번호'} autoComplete="new-password" />
                  </Field>
                )}
                {!vault.unlocked && (jump.authType === 'key' || jump.authType === 'password') && <div className="notice warn"><Lock size={15} />볼트가 잠겨 있어 베스천 키·비밀번호를 저장할 수 없습니다.</div>}
                <div className="muted" style={{ fontSize: 12 }}>이 서버에 접속할 때 위 베스천을 먼저 거칩니다. 베스천은 서버 목록에 따로 생기지 않습니다.</div>
              </div>
            )}
            <Field label={h.protocol === 'local' ? '셸 시작 후 자동 실행 명령' : '접속 후 자동 실행 명령'} hint={h.protocol === 'local' ? '예: nvm use && claude' : '예: cd /var/www && sudo -i'}>
              <input className="input mono" value={h.startupCommand ?? ''} onChange={(e) => set('startupCommand', e.target.value)} />
            </Field>
            {h.protocol === 'local' ? (
              <Field label="터미널 종류"><input className="input mono" value={h.termType} onChange={(e) => set('termType', e.target.value)} /></Field>
            ) : (
            <div className="grid3">
              <Field label="문자 인코딩">
                <select className="select" value={h.encoding} onChange={(e) => set('encoding', e.target.value as Host['encoding'])}>
                  <option value="utf-8">UTF-8</option><option value="cp949">CP949 / EUC-KR (구형 장비)</option><option value="shift_jis">Shift_JIS</option><option value="latin1">Latin-1</option>
                </select>
              </Field>
              <Field label="터미널 종류"><input className="input mono" value={h.termType} onChange={(e) => set('termType', e.target.value)} /></Field>
              <Field label="Keepalive (초)"><input className="input mono" type="number" value={h.keepaliveSec} onChange={(e) => set('keepaliveSec', +e.target.value || 0)} /></Field>
            </div>
            )}
          </>
        )}

        {tab === 'fw' && (
          <>
            <div className="notice">L: 내 PC의 포트 → 서버에서 접근 가능한 주소 (예: 로컬 3307 → DB 3306). R: 서버의 포트 → 내 PC 쪽 주소.</div>
            <table className="fw-table">
              <thead><tr><th>종류</th><th>바인드 주소</th><th>포트</th><th>대상 호스트</th><th>대상 포트</th><th /></tr></thead>
              <tbody>
                {h.forwards.map((f, i) => (
                  <tr key={f.id}>
                    <td><select className="select" value={f.type} onChange={(e) => set('forwards', h.forwards.map((x, j) => j === i ? { ...x, type: e.target.value as 'L' | 'R' } : x))}><option>L</option><option>R</option></select></td>
                    <td><input className="input mono" value={f.bindHost} onChange={(e) => set('forwards', h.forwards.map((x, j) => j === i ? { ...x, bindHost: e.target.value } : x))} /></td>
                    <td><input className="input mono" type="number" value={f.bindPort} onChange={(e) => set('forwards', h.forwards.map((x, j) => j === i ? { ...x, bindPort: +e.target.value } : x))} /></td>
                    <td><input className="input mono" value={f.destHost} onChange={(e) => set('forwards', h.forwards.map((x, j) => j === i ? { ...x, destHost: e.target.value } : x))} /></td>
                    <td><input className="input mono" type="number" value={f.destPort} onChange={(e) => set('forwards', h.forwards.map((x, j) => j === i ? { ...x, destPort: +e.target.value } : x))} /></td>
                    <td><button className="ibtn sm" onClick={() => set('forwards', h.forwards.filter((_, j) => j !== i))}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div><button className="btn sm" onClick={() => set('forwards', [...h.forwards, { id: crypto.randomUUID(), type: 'L', bindHost: '127.0.0.1', bindPort: 8080, destHost: 'localhost', destPort: 80 }])}><Plus size={13} />포워딩 추가</button></div>
          </>
        )}
      </div>
    </Modal>
  )
}

export function GroupEditor({ group, parentId }: { group?: Group; parentId?: string | null }): JSX.Element {
  const groups = useApp((s) => s.groups)
  const [g, setG] = useState<Group>(() => group ? { ...group } : { id: crypto.randomUUID(), parentId: parentId ?? null, name: '', sort: groups.length, env: 'none' })
  const close = (): void => useApp.setState({ dialog: null })
  const save = (): void => {
    if (!g.name.trim()) return
    useApp.getState().upsertGroup({ ...g, name: g.name.trim() })
    close()
  }
  return (
    <Modal title={group ? '폴더 편집' : '새 폴더'} onClose={close} size="sm"
      foot={<><button className="btn" onClick={close}>취소</button><button className="btn primary" onClick={save} disabled={!g.name.trim()}>저장</button></>}>
      <div className="modal-body">
        <Field label="이름"><input className="input" autoFocus value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="예: 헤펠레코리아" /></Field>
        <Field label="상위 폴더">
          <select className="select" value={g.parentId ?? ''} onChange={(e) => setG({ ...g, parentId: e.target.value || null })}>
            <option value="">(최상위)</option>
            {groups.filter((x) => x.id !== g.id).map((x) => <option key={x.id} value={x.id}>{groupPath(groups, x.id)}</option>)}
          </select>
        </Field>
        <Field label="환경" hint="폴더 안의 서버가 이 환경 색을 물려받습니다">
          <Seg value={g.env ?? 'none'} onChange={(v) => setG({ ...g, env: v })} options={ENVS.map((e) => ({ value: e, label: <><span className="dot" style={{ background: ENV_COLORS[e] }} />{ENV_LABELS[e]}</> }))} />
        </Field>
        <Field label="색상"><ColorPick value={g.color} onChange={(v) => setG({ ...g, color: v })} /></Field>
      </div>
    </Modal>
  )
}
