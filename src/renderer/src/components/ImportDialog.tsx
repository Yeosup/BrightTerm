import { useEffect, useState } from 'react'
import { Download, Cloud } from 'lucide-react'
import { useApp } from '../state'
import { api } from '../api'
import { Modal, Field } from './ui'
import type { ImportCandidate } from '@shared/types'
import { isMac } from '../platform'

export function ImportDialog(): JSX.Element {
  const hosts = useApp((s) => s.hosts)
  const vault = useApp((s) => s.vault)
  const [cands, setCands] = useState<ImportCandidate[] | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [group, setGroup] = useState(isMac ? '가져온 서버' : 'PuTTY 가져오기')
  const [busy, setBusy] = useState(false)
  const close = (): void => useApp.setState({ dialog: null })
  const st = useApp.getState

  const [awsBusy, setAwsBusy] = useState(false)
  // preselect all not already existing (same host+port+user)
  const exists = (x: ImportCandidate): boolean => hosts.some((h) => h.host === x.host.host && h.port === x.host.port && h.username === (x.host.username ?? ''))

  useEffect(() => {
    api.importer.scan().then((c) => {
      setCands(c)
      setSel(new Set(c.map((x, i) => (exists(x) ? -1 : i)).filter((i) => i >= 0)))
    })
  }, [])

  const scanAws = async (): Promise<void> => {
    setAwsBusy(true)
    try {
      const a = await api.importer.scanAws()
      if (!a.length) st().toast('info', 'AWS 에서 가져올 인스턴스를 찾지 못했습니다')
      const base = (cands ?? []).filter((c) => c.source !== 'aws')
      const next = [...base, ...a]
      setCands(next)
      setSel((s) => new Set([...[...s].filter((i) => i < base.length), ...a.map((x, j) => (exists(x) ? -1 : base.length + j)).filter((i) => i >= 0)]))
      if (a.length) setGroup('AWS')
    } catch (e) {
      st().toast('error', `AWS 조회 실패: ${(e as Error).message} — 터미널에서 aws configure 로 자격 증명을 확인하세요`)
    } finally {
      setAwsBusy(false)
    }
  }

  const apply = async (): Promise<void> => {
    if (!cands) return
    setBusy(true)
    try {
      const r = await api.importer.apply(cands.filter((_, i) => sel.has(i)), group.trim())
      await st().reloadStore()
      st().toast('ok', `${r.hosts}개 서버를 가져왔습니다${r.keys ? ` (키 ${r.keys}개 볼트에 저장)` : ''}`)
      if (r.skipped.length) st().toast('error', r.skipped.join('\n'))
      close()
    } catch (e) {
      st().toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const all = cands?.length ?? 0
  return (
    <Modal title="서버 가져오기" icon={<Download size={18} />} onClose={close} size="lg"
      foot={<>
        <span className="left muted">{sel.size}/{all}개 선택</span>
        <button className="btn" onClick={close}>취소</button>
        <button className="btn primary" disabled={!sel.size || busy} onClick={apply}>{busy ? '가져오는 중...' : `${sel.size}개 가져오기`}</button>
      </>}>
      <div className="modal-body">
        <div className="notice">
          {isMac ? <>PuTTY 세션(<span className="kbd">~/.putty/sessions</span>)</> : 'PuTTY 저장 세션(레지스트리)'}과 <span className="kbd">~/.ssh/config</span>를 읽어 옵니다. 호스트·포트·사용자·키 파일·포트 포워딩·시리얼 설정·인코딩이 옮겨집니다.
          {isMac && 'Windows에서 쓰던 서버·비밀번호를 그대로 옮기려면 Windows의 BrightTerm에서 설정 → 백업 내보내기 후 여기서 백업 가져오기를 쓰세요. '}
          PuTTY는 비밀번호를 저장하지 않으므로, 비밀번호는 처음 접속할 때 한 번 입력하면 저장됩니다.
          {!vault.unlocked && ' (볼트가 잠겨 있으면 키 파일은 볼트에 복사되지 않습니다)'}
        </div>
        <div className="row">
          <button className="btn" disabled={awsBusy} onClick={scanAws}><Cloud size={14} />{awsBusy ? 'AWS 전 리전 조회 중...' : 'AWS EC2 불러오기'}</button>
          <span className="muted">aws CLI 자격 증명으로 인스턴스를 읽습니다. 사설 IP 서버는 같은 VPC 의 배스천을 점프 호스트로 잇고, 키는 ~/.ssh/&lt;키 이름&gt;.pem 에서 찾습니다.</span>
        </div>
        {cands === null && <div className="muted">검색 중...</div>}
        {cands && cands.length === 0 && <div className="empty">가져올 세션을 찾지 못했습니다.<br />PuTTY에 저장된 세션이 없거나 ~/.ssh/config가 없습니다.</div>}
        {cands && cands.length > 0 && (
          <>
            <Field label="넣을 폴더 이름" hint="이름이 prod-/stg-/dev- 로 시작하면 운영/스테이징/개발 환경이 자동 지정됩니다. 비우면 최상위에 넣습니다.">
              <input className="input" value={group} onChange={(e) => setGroup(e.target.value)} />
            </Field>
            <div className="import-list">
              <div className="import-row head">
                <input type="checkbox" checked={sel.size === all} onChange={(e) => setSel(e.target.checked ? new Set(cands.map((_, i) => i)) : new Set())} />
                <span>이름</span><span>주소</span><span>종류</span><span>출처</span>
              </div>
              {cands.map((c, i) => (
                <label key={i} className="import-row">
                  <input type="checkbox" checked={sel.has(i)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(i); else s.delete(i); setSel(s) }} />
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.host.protocol === 'serial' ? `${c.host.serial?.path} @ ${c.host.serial?.baudRate}` : `${c.host.username ? c.host.username + '@' : ''}${c.host.host}:${c.host.port}`}{c.keyFile ? ' 🔑' : ''}</span>
                  <span>{(c.host.protocol ?? 'ssh').toUpperCase()}</span>
                  <span className="muted" title={c.note}>{c.source === 'putty' ? 'PuTTY' : c.source === 'aws' ? `AWS${c.jumpVia ? ' · 배스천 경유' : ''}${c.note?.includes('키 파일 없음') ? ' ⚠' : ''}` : 'ssh config'}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
