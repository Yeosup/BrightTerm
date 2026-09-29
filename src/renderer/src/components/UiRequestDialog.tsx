import { useEffect, useRef, useState } from 'react'
import { ShieldAlert, ShieldQuestion, KeyRound, User } from 'lucide-react'
import { useApp } from '../state'
import { api } from '../api'
import { refocusTerminal } from '../terms'
import { Modal, Field } from './ui'
import type { UiRequest } from '@shared/types'

export function UiRequestDialog(): JSX.Element | null {
  const req = useApp((s) => s.requests[0])
  const vault = useApp((s) => s.vault)
  const [vals, setVals] = useState<string[]>([])
  const [save, setSave] = useState(true)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setVals([])
    setSave(vault.unlocked)
    setTimeout(() => ref.current?.focus(), 40)
  }, [req?.reqId])
  if (!req) return null

  const done = (value: unknown): void => {
    api.respond(req.reqId, value)
    useApp.setState((s) => ({ requests: s.requests.filter((r) => r.reqId !== req.reqId) }))
    refocusTerminal()
  }
  const cancel = (): void => done(req.kind === 'hostkey' ? false : null)

  if (req.kind === 'hostkey') {
    return (
      <Modal title={req.changed ? '경고: 서버의 호스트 키가 바뀌었습니다' : '처음 접속하는 서버입니다'} icon={req.changed ? <ShieldAlert size={20} color="var(--danger)" /> : <ShieldQuestion size={20} color="var(--accent)" />} onClose={cancel}
        foot={<>
          <button className="btn" onClick={cancel}>접속 취소</button>
          <button className={`btn ${req.changed ? 'danger' : 'primary'}`} onClick={() => done(true)} autoFocus={!req.changed}>{req.changed ? '위험을 알고 새 키 신뢰' : '신뢰하고 접속'}</button>
        </>}>
        <div className="modal-body">
          {req.changed ? (
            <div className="notice danger">
              <div>[{req.sessionTitle}] {req.hostPort}의 호스트 키가 이전에 저장한 키와 다릅니다. 서버를 재설치했거나 IP가 바뀐 경우가 아니라면 <b>중간자 공격</b>일 수 있습니다. 확실하지 않으면 접속하지 마세요.</div>
            </div>
          ) : (
            <div>[{req.sessionTitle}] <b>{req.hostPort}</b> 서버의 신원을 아직 확인하지 않았습니다. 아래 지문이 서버 관리자가 알려준 값과 같은지 확인하세요.</div>
          )}
          <Field label={`${req.keyType} 키 지문`}><div className="fp">{req.fingerprint}</div></Field>
          {req.oldFingerprint && <Field label="이전에 저장된 지문"><div className="fp" style={{ opacity: 0.7 }}>{req.oldFingerprint}</div></Field>}
        </div>
      </Modal>
    )
  }

  if (req.kind === 'password' || req.kind === 'passphrase' || req.kind === 'username') {
    const title = req.kind === 'password' ? '비밀번호 입력' : req.kind === 'passphrase' ? '개인 키 암호 입력' : '사용자 이름 입력'
    const submit = (): void => {
      if (req.kind === 'password') done({ password: vals[0] ?? '', save: save && vault.unlocked })
      else done(vals[0] ?? '')
    }
    return (
      <Modal title={title} size="sm" icon={req.kind === 'username' ? <User size={18} /> : <KeyRound size={18} />} onClose={cancel}
        foot={<><button className="btn" onClick={cancel}>취소</button><button className="btn primary" onClick={submit}>확인</button></>}>
        <form className="modal-body" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <div className="muted">{req.sessionTitle}</div>
          {req.kind === 'password' && req.failed && <div className="err">비밀번호가 틀렸거나 인증에 실패했습니다. 다시 입력하세요.</div>}
          <Field label={req.kind === 'password' ? req.prompt : req.kind === 'passphrase' ? '키 파일이 암호로 보호되어 있습니다' : '접속할 계정'}>
            <input ref={ref} className="input" type={req.kind === 'username' ? 'text' : 'password'} value={vals[0] ?? ''} onChange={(e) => setVals([e.target.value])} autoComplete="off" />
          </Field>
          {req.kind === 'password' && req.allowSave && (
            <label className="row" style={{ fontSize: 12.5, opacity: vault.unlocked ? 1 : 0.5 }}>
              <input type="checkbox" checked={save && vault.unlocked} disabled={!vault.unlocked} onChange={(e) => setSave(e.target.checked)} />
              볼트에 저장하고 다음부터 자동 로그인 {!vault.unlocked && '(볼트 잠김)'}
            </label>
          )}
          <button type="submit" hidden />
        </form>
      </Modal>
    )
  }

  // keyboard-interactive
  const r = req as Extract<UiRequest, { kind: 'keyboard' }>
  return (
    <Modal title={r.name || '추가 인증'} size="sm" icon={<KeyRound size={18} />} onClose={cancel}
      foot={<><button className="btn" onClick={cancel}>취소</button><button className="btn primary" onClick={() => done(r.prompts.map((_, i) => vals[i] ?? ''))}>확인</button></>}>
      <form className="modal-body" onSubmit={(e) => { e.preventDefault(); done(r.prompts.map((_, i) => vals[i] ?? '')) }}>
        <div className="muted">{r.sessionTitle}</div>
        {r.instructions && <div>{r.instructions}</div>}
        {r.prompts.map((p, i) => (
          <Field key={i} label={p.prompt}>
            <input ref={i === 0 ? ref : undefined} className="input" type={p.echo ? 'text' : 'password'} value={vals[i] ?? ''} onChange={(e) => { const v = [...vals]; v[i] = e.target.value; setVals(v) }} autoComplete="one-time-code" />
          </Field>
        ))}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
