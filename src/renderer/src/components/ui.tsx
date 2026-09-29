import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useApp } from '../state'
import { PALETTE } from '@shared/types'
import { refocusTerminal } from '../terms'

export function Modal(props: { title: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; size?: 'sm' | 'lg'; className?: string; icon?: ReactNode }): JSX.Element {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        props.onClose()
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [props.onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.size ?? ''} ${props.className ?? ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {props.icon}
          <h2>{props.title}</h2>
          <button className="ibtn" onClick={props.onClose}><X size={16} /></button>
        </div>
        {props.children}
        {props.foot && <div className="modal-foot">{props.foot}</div>}
      </div>
    </div>
  )
}

export function Field(props: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={`field ${props.className ?? ''}`}>
      {props.label && <label>{props.label}</label>}
      {props.children}
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  )
}

export function Switch(props: { value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return <button type="button" className={`switch ${props.value ? 'on' : ''}`} onClick={() => props.onChange(!props.value)} />
}

export function Toggle(props: { label: ReactNode; desc?: ReactNode; value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <div className="toggle">
      <div className="t-label"><span>{props.label}</span>{props.desc && <small>{props.desc}</small>}</div>
      <Switch value={props.value} onChange={props.onChange} />
    </div>
  )
}

export function Seg<T extends string | number>(props: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }): JSX.Element {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button type="button" key={String(o.value)} className={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ColorPick(props: { value?: string; onChange: (v?: string) => void }): JSX.Element {
  return (
    <div className="swatches">
      <div className={`swatch none ${!props.value ? 'on' : ''}`} title="자동(환경/폴더 색)" onClick={() => props.onChange(undefined)} />
      {PALETTE.map((c) => (
        <div key={c} className={`swatch ${props.value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => props.onChange(c)} />
      ))}
    </div>
  )
}

export function ContextMenu(): JSX.Element | null {
  const menu = useApp((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) })
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const close = (): void => useApp.setState({ menu: null })
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', k)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', k)
    }
  }, [menu])
  if (!menu) return null
  return (
    <div className="ctx" ref={ref} style={{ left: pos.x || menu.x, top: pos.y || menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) =>
        it.separator ? <hr key={i} /> : (
          <button key={i} className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { useApp.setState({ menu: null }); it.onClick?.() }}>
            <span>{it.label}</span>
            {it.shortcut && <span className="sc">{it.shortcut}</span>}
          </button>
        )
      )}
    </div>
  )
}

export function Toasts(): JSX.Element {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  )
}

export function ConfirmDialog(): JSX.Element | null {
  const c = useApp((s) => s.confirmReq)
  const okRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // dangerous actions: default focus on Cancel so a stray Enter never confirms
  useEffect(() => { if (c) setTimeout(() => (c.danger ? cancelRef : okRef).current?.focus(), 30) }, [c])
  if (!c) return null
  const done = (ok: boolean): void => {
    useApp.setState({ confirmReq: null })
    c.resolve(ok)
    refocusTerminal()
  }
  return (
    <Modal title={c.title} onClose={() => done(false)} size="sm"
      foot={<>
        <button ref={cancelRef} className="btn" onClick={() => done(false)}>취소</button>
        <button ref={okRef} className={`btn ${c.danger ? 'danger' : 'primary'}`} onClick={() => done(true)}>{c.okText ?? '확인'}</button>
      </>}>
      <div className="modal-body">
        <div style={{ lineHeight: 1.6 }}>{c.message}</div>
        {c.detail && <div className="code">{c.detail}</div>}
      </div>
    </Modal>
  )
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function fmtDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  const z = (x: number): string => String(x).padStart(2, '0')
  if (d.getFullYear() === now.getFullYear()) return `${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

export function PromptDialog(): JSX.Element | null {
  const p = useApp((s) => s.promptReq)
  const [v, setV] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (p) {
      setV(p.value)
      setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 30)
    }
  }, [p])
  if (!p) return null
  const done = (val: string | null): void => {
    useApp.setState({ promptReq: null })
    p.resolve(val)
    refocusTerminal()
  }
  return (
    <Modal title={p.title} onClose={() => done(null)} size="sm"
      foot={<>
        <button className="btn" onClick={() => done(null)}>취소</button>
        <button className="btn primary" onClick={() => done(v)}>확인</button>
      </>}>
      <div className="modal-body">
        <Field label={p.label}>
          <input ref={ref} className="input" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') done(v) }} />
        </Field>
      </div>
    </Modal>
  )
}
