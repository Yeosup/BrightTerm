import { useEffect, useRef, useState } from 'react'
import { Lock, ShieldCheck, Copy, KeyRound } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../state'
import { osUnlockText } from '../platform'
import logo from '../assets/logo.png'

function strength(pw: string): number {
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return Math.min(4, s)
}

const S_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#10b981']
const S_LABELS = ['매우 약함', '약함', '보통', '강함', '매우 강함']

export function LockScreen(props: { overlay: boolean }): JSX.Element {
  const vault = useApp((s) => s.vault)
  const [mode, setMode] = useState<'unlock' | 'setup' | 'recovery' | 'recover'>(vault.initialized ? 'unlock' : 'setup')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [code, setCode] = useState('')
  const [rc, setRc] = useState('')
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50) }, [mode])

  const refresh = async (): Promise<void> => {
    useApp.setState({ vault: await api.vault.status() })
    await useApp.getState().refreshCreds()
  }

  const unlock = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      const ok = await api.vault.unlock(pw)
      if (!ok) { setErr('비밀번호가 올바르지 않습니다'); setPw(''); return }
      await refresh()
    } finally { setBusy(false) }
  }

  const setup = async (): Promise<void> => {
    if (pw.length < 8) return setErr('8자 이상 입력하세요')
    if (pw !== pw2) return setErr('비밀번호가 일치하지 않습니다')
    setBusy(true)
    setErr('')
    try {
      const r = await api.vault.setup(pw)
      setRc(r.recoveryCode)
      setMode('recovery')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const recover = async (): Promise<void> => {
    if (pw.length < 8) return setErr('새 비밀번호는 8자 이상이어야 합니다')
    if (pw !== pw2) return setErr('새 비밀번호가 일치하지 않습니다')
    setBusy(true)
    try {
      const ok = await api.vault.recover(code, pw)
      if (!ok) return setErr('복구 코드가 올바르지 않습니다')
      await refresh()
    } finally { setBusy(false) }
  }

  const st = strength(pw)

  return (
    <div className={`lock ${props.overlay ? 'overlay-mode' : ''}`}>
      <div className="lock-card">
        <img className="logo-mark" src={logo} alt="" />
        {mode === 'unlock' && (
          <form onSubmit={(e) => { e.preventDefault(); unlock() }} style={{ display: 'contents' }}>
            <h1><Lock size={18} style={{ verticalAlign: -2 }} /> BrightTerm 잠금</h1>
            <p>{props.overlay ? '세션은 계속 연결되어 있습니다. 마스터 비밀번호를 입력하면 다시 사용할 수 있습니다.' : '저장된 서버 계정을 열려면 마스터 비밀번호를 입력하세요.'}</p>
            <input ref={inputRef} className="input" type="password" placeholder="마스터 비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} />
            {err && <div className="err">{err}</div>}
            <button className="btn primary" disabled={busy || !pw} style={{ justifyContent: 'center' }}>{busy ? '확인 중...' : '잠금 해제'}</button>
            {vault.osUnlockEnabled && (
              <button type="button" className="btn" style={{ justifyContent: 'center' }} onClick={async () => { if (await api.vault.unlockOs()) refresh(); else setErr(osUnlockText(vault.osUnlockKind).fail) }}>
                <ShieldCheck size={15} /> {osUnlockText(vault.osUnlockKind).button}
              </button>
            )}
            <button type="button" className="link" onClick={() => { setMode('recover'); setErr(''); setPw('') }}>비밀번호를 잊으셨나요? 복구 코드로 재설정</button>
          </form>
        )}
        {mode === 'setup' && (
          <form onSubmit={(e) => { e.preventDefault(); setup() }} style={{ display: 'contents' }}>
            <h1>BrightTerm 시작하기</h1>
            <p>서버 ID·비밀번호·키는 이 마스터 비밀번호로 AES-256 암호화되어 이 PC에만 저장됩니다. 마스터 비밀번호는 어디에도 전송되지 않습니다.</p>
            <input ref={inputRef} className="input" type="password" placeholder="마스터 비밀번호 (8자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} />
            {pw && (
              <div>
                <div className="strength"><div style={{ width: `${(st + 1) * 20}%`, background: S_COLORS[st] }} /></div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>강도: {S_LABELS[st]}</div>
              </div>
            )}
            <input className="input" type="password" placeholder="비밀번호 확인" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            {err && <div className="err">{err}</div>}
            <button className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? '암호화 키 생성 중...' : '볼트 만들기'}</button>
          </form>
        )}
        {mode === 'recovery' && (
          <>
            <h1><KeyRound size={18} style={{ verticalAlign: -2 }} /> 복구 코드</h1>
            <p>마스터 비밀번호를 잊었을 때 이 코드로만 복구할 수 있습니다. 인쇄하거나 안전한 곳에 적어 두세요. 이 화면을 닫으면 다시 볼 수 없습니다.</p>
            <div className="recovery">{rc}</div>
            <button className="btn" style={{ justifyContent: 'center' }} onClick={() => { api.clip.writeText(rc); useApp.getState().toast('ok', '복구 코드를 복사했습니다') }}>
              <Copy size={14} /> 복사
            </button>
            <label className="row" style={{ fontSize: 12.5 }}>
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> 복구 코드를 안전한 곳에 저장했습니다
            </label>
            <button className="btn primary" disabled={!saved} style={{ justifyContent: 'center' }} onClick={refresh}>시작하기</button>
          </>
        )}
        {mode === 'recover' && (
          <form onSubmit={(e) => { e.preventDefault(); recover() }} style={{ display: 'contents' }}>
            <h1>복구 코드로 재설정</h1>
            <p>볼트를 만들 때 받은 24자리 복구 코드와 새 마스터 비밀번호를 입력하세요. 저장된 계정은 그대로 유지됩니다.</p>
            <input ref={inputRef} className="input mono" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <input className="input" type="password" placeholder="새 마스터 비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} />
            <input className="input" type="password" placeholder="새 비밀번호 확인" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            {err && <div className="err">{err}</div>}
            <button className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>재설정</button>
            <button type="button" className="link" onClick={() => { setMode('unlock'); setErr('') }}>돌아가기</button>
          </form>
        )}
      </div>
    </div>
  )
}
