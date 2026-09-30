import { randomUUID } from 'crypto'
import { createWriteStream, WriteStream, mkdirSync } from 'fs'
import { join } from 'path'
import * as iconv from 'iconv-lite'
import type { AdhocTarget, Host, SessionInfo, SessionState } from '@shared/types'
import { ENV_COLORS } from '@shared/types'
import type { Transport } from './transports/types'
import { SshTransport } from './transports/ssh'
import { TelnetTransport } from './transports/telnet'
import { SerialTransport } from './transports/serial'
import { LocalTransport } from './transports/local'
import { persistSupported, startupLine } from './persist'
import { send } from './ui'
import { store, dataDir } from './store'
import { vault } from './vault'

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78DEHMc]/g

export function resolveHostColor(h: Host): string | undefined {
  if (h.color) return h.color
  if (h.env && h.env !== 'none') return ENV_COLORS[h.env]
  const groups = store.get().groups
  let gid = h.groupId
  while (gid) {
    const g = groups.find((x) => x.id === gid)
    if (!g) break
    if (g.color) return g.color
    if (g.env && g.env !== 'none') return ENV_COLORS[g.env]
    gid = g.parentId
  }
  return undefined
}

export function resolveHostEnv(h: Host): Host['env'] {
  if (h.env && h.env !== 'none') return h.env
  const groups = store.get().groups
  let gid = h.groupId
  while (gid) {
    const g = groups.find((x) => x.id === gid)
    if (!g) break
    if (g.env && g.env !== 'none') return g.env
    gid = g.parentId
  }
  return 'none'
}

function adhocHost(t: AdhocTarget): Host {
  const protocol = t.protocol ?? 'ssh'
  if (protocol === 'local') {
    return {
      id: 'adhoc-' + randomUUID(),
      groupId: null,
      alias: '로컬 터미널',
      protocol,
      host: '',
      port: 0,
      username: '',
      authType: 'ask',
      tags: [],
      encoding: 'utf-8',
      termType: 'xterm-256color',
      keepaliveSec: 0,
      forwards: [],
      local: { cwd: t.cwd },
      sort: 0
    }
  }
  return {
    id: 'adhoc-' + randomUUID(),
    groupId: null,
    alias: `${t.username ? t.username + '@' : ''}${t.host}`,
    protocol,
    host: t.host,
    port: t.port ?? (protocol === 'telnet' ? 23 : 22),
    username: t.username ?? '',
    authType: 'ask',
    tags: [],
    encoding: 'utf-8',
    termType: 'xterm-256color',
    keepaliveSec: 30,
    forwards: [],
    sort: 0
  }
}

export class Session {
  info: SessionInfo
  transport: Transport | null = null
  private decoder: iconv.DecoderStream | null = null
  private cols = 120
  private rows = 32
  private userClosed = false
  private retry = 0
  private retryTimer: NodeJS.Timeout | null = null
  private log: WriteStream | null = null

  constructor(public host: Host, public persistent: boolean) {
    this.info = {
      id: randomUUID(),
      hostId: persistent ? host.id : null,
      title: host.alias,
      protocol: host.protocol,
      target: this.targetLabel(),
      color: persistent ? resolveHostColor(host) : undefined,
      env: persistent ? resolveHostEnv(host) : 'none',
      state: 'connecting',
      canSftp: host.protocol === 'ssh',
      persist: persistSupported(host)
    }
  }

  private targetLabel(): string {
    const h = this.host
    if (h.protocol === 'serial') return `${h.serial?.path ?? '?'} @ ${h.serial?.baudRate ?? 9600}`
    if (h.protocol === 'local') return `로컬 · ${h.local?.cwd?.trim() || '~'}`
    return `${h.username ? h.username + '@' : ''}${h.host}:${h.port}`
  }

  private setState(state: SessionState, message?: string): void {
    this.info = { ...this.info, state, message, connectedAt: state === 'connected' ? Date.now() : this.info.connectedAt }
    send('session:state', this.info)
  }

  private emitText(s: string): void {
    send('session:data', this.info.id, s)
  }

  info_(msg: string, color = '36'): void {
    this.emitText(`\r\n\x1b[${color}m● ${msg}\x1b[0m\r\n`)
  }

  setSize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.transport?.resize(cols, rows)
  }

  async connect(): Promise<void> {
    const h = this.host
    this.setState(this.retry ? 'reconnecting' : 'connecting')
    if (h.protocol !== 'local') this.info_(`${this.info.title} (${this.info.target}) 접속 중...`, '90')
    const enc = this.encoding()
    this.decoder = iconv.getDecoder(enc) as unknown as iconv.DecoderStream
    try {
      let t: Transport
      if (h.protocol === 'ssh') {
        const st = new SshTransport(h, {
          title: h.alias,
          cols: this.cols,
          rows: this.rows,
          onInfo: (m) => this.info_(m, '90'),
          onSavePassword: (username, password) => this.savePassword(username, password)
        })
        await st.start()
        t = st
      } else if (h.protocol === 'local') {
        const lt = new LocalTransport(h.local ?? {}, h.termType)
        await lt.start(this.cols, this.rows)
        if (lt.cwdFallback) this.info_(`시작 폴더(${h.local?.cwd})가 없어 홈 폴더에서 엽니다`, '33')
        const line = startupLine(h)
        if (line) setTimeout(() => lt.write(Buffer.from(line.replace(/\r?\n/g, '\r') + '\r')), 300)
        t = lt
      } else if (h.protocol === 'telnet') {
        const tt = new TelnetTransport(h.host, h.port, h.termType)
        await tt.start(this.cols, this.rows)
        t = tt
      } else {
        if (!h.serial) throw new Error('시리얼 설정이 없습니다')
        const s = new SerialTransport(h.serial)
        await s.start()
        t = s
      }
      this.transport = t
      this.retry = 0
      t.on('data', (d: Buffer) => this.onData(d))
      t.on('close', (reason?: string) => this.onClose(reason))
      this.setState('connected')
      if (h.protocol !== 'local') this.emitText('\x1b[2K\r')
      if (this.persistent) store.touchHost(h.id)
      if (store.get().settings.sessionLog) this.openLog()
    } catch (e) {
      const msg = (e as Error).message || String(e)
      this.info_(`${h.protocol === 'local' ? '셸 실행 실패' : '접속 실패'}: ${translateError(msg)}`, '31')
      this.transport = null
      this.scheduleReconnect(true)
    }
  }

  private savePassword(username: string, password: string): void {
    try {
      if (!vault.isUnlocked() || !this.persistent) return
      const meta = vault.save_({ id: this.host.credentialId || undefined, name: this.host.alias, kind: 'password', username, password })
      const hosts = store.get().hosts.map((x) => (x.id === this.host.id ? { ...x, credentialId: meta.id, username: x.username || username, authType: x.authType === 'ask' ? 'password' as const : x.authType } : x))
      store.patch({ hosts })
      this.host = hosts.find((x) => x.id === this.host.id) ?? this.host
      send('store:changed')
      this.info_('비밀번호를 볼트에 저장했습니다', '90')
    } catch { /* ignore */ }
  }

  private openLog(): void {
    try {
      const dir = join(dataDir(), 'logs')
      mkdirSync(dir, { recursive: true })
      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
      const safe = this.host.alias.replace(/[\\/:*?"<>|]/g, '_')
      this.log = createWriteStream(join(dir, `${safe}-${stamp}.log`), { flags: 'a' })
    } catch { /* */ }
  }

  private onData(d: Buffer): void {
    const s = this.decoder ? this.decoder.write(d) : d.toString('utf8')
    if (s) {
      this.emitText(s)
      this.log?.write(s.replace(ANSI, '').replace(/\r/g, ''))
    }
  }

  private onClose(reason?: string): void {
    this.transport = null
    this.log?.end()
    this.log = null
    if (this.userClosed) return
    if (this.host.protocol === 'local') {
      this.setState('closed')
      this.info_(`${reason ?? '셸이 종료되었습니다'} — Enter 키를 누르면 새 셸을 엽니다.`, '90')
      return
    }
    this.info_(reason ? `연결 끊김: ${reason}` : '연결이 끊어졌습니다', '33')
    this.scheduleReconnect(false)
  }

  private scheduleReconnect(failed: boolean): void {
    const auto = store.get().settings.autoReconnect && this.host.protocol !== 'serial'
    // only auto-retry when a previously working session drops (or retries in progress)
    if (auto && (!failed || this.retry > 0) && this.retry < 8) {
      const delay = Math.min(30, 2 ** this.retry * 2)
      this.retry++
      this.setState('reconnecting', `${delay}초 후 재접속 (${this.retry}/8)`)
      this.info_(`${delay}초 후 자동 재접속합니다... (Enter: 즉시 재접속)`, '90')
      this.retryTimer = setTimeout(() => this.connect(), delay * 1000)
    } else {
      this.retry = 0
      this.setState(failed ? 'error' : 'closed')
      this.info_('Enter 키를 누르면 다시 접속합니다.', '90')
    }
  }

  reconnectNow(): void {
    if (this.transport) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.connect()
  }

  /** 로컬 셸은 항상 UTF-8 (pty 가 문자열로 주고받는다) */
  private encoding(): string {
    const h = this.host
    if (h.protocol === 'local') return 'utf-8'
    return h.encoding === 'cp949' ? 'euc-kr' : h.encoding || 'utf-8'
  }

  write(data: string): void {
    if (!this.transport) {
      if (data === '\r' && this.info.state !== 'connecting') this.reconnectNow()
      return
    }
    const enc = this.encoding()
    this.transport.write(enc === 'utf-8' ? Buffer.from(data, 'utf8') : iconv.encode(data, enc))
  }

  sshTransport(): SshTransport | null {
    return this.transport instanceof SshTransport ? this.transport : null
  }

  close(): void {
    this.userClosed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.transport?.close()
    this.transport = null
    this.log?.end()
  }
}

function translateError(m: string): string {
  if (/ECONNREFUSED/.test(m)) return '서버가 접속을 거부했습니다 (포트 확인)'
  if (/ETIMEDOUT|Timed out/i.test(m)) return '응답 시간 초과 (주소·방화벽 확인)'
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return '호스트 이름을 찾을 수 없습니다'
  if (/EHOSTUNREACH|ENETUNREACH/.test(m)) return '네트워크에 도달할 수 없습니다'
  if (/All configured authentication methods failed/i.test(m)) return '인증 실패 (사용자 이름/비밀번호/키 확인)'
  if (/host key|Host denied/i.test(m)) return '호스트 키를 승인하지 않아 접속을 중단했습니다'
  if (/Access denied|File not found|cannot open/i.test(m)) return m + ' (포트 사용 중이거나 권한 없음)'
  return m
}

class SessionManager {
  sessions = new Map<string, Session>()

  open(opts: { hostId?: string; adhoc?: AdhocTarget; cols?: number; rows?: number }): SessionInfo {
    let host: Host | undefined
    let persistent = true
    if (opts.hostId) host = store.get().hosts.find((h) => h.id === opts.hostId)
    if (!host && opts.adhoc) {
      host = adhocHost(opts.adhoc)
      persistent = false
    }
    if (!host) throw new Error('서버를 찾을 수 없습니다')
    const s = new Session(structuredClone(host), persistent)
    if (opts.cols && opts.rows) s.setSize(opts.cols, opts.rows)
    this.sessions.set(s.info.id, s)
    // give renderer a tick to register the terminal before data arrives
    setTimeout(() => s.connect(), 30)
    return s.info
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  close(id: string): void {
    this.sessions.get(id)?.close()
    this.sessions.delete(id)
  }

  closeAll(): void {
    for (const s of this.sessions.values()) s.close()
    this.sessions.clear()
  }
}

export const sessions = new SessionManager()
