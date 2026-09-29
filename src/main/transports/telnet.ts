import { EventEmitter } from 'events'
import { Socket, connect } from 'net'
import type { Transport } from './types'

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240
const ECHO = 1, SGA = 3, TTYPE = 24, NAWS = 31

/** Minimal RFC854 telnet client: ECHO, SGA, TTYPE, NAWS negotiation. */
export class TelnetTransport extends EventEmitter implements Transport {
  private sock: Socket | null = null
  private cols = 80
  private rows = 24
  private naws = false
  private closed = false
  private state: 'data' | 'iac' | 'cmd' | 'sb' | 'sbiac' = 'data'
  private cmd = 0
  private sbBuf: number[] = []

  constructor(private host: string, private port: number, private termType: string) {
    super()
  }

  start(cols: number, rows: number): Promise<void> {
    this.cols = cols
    this.rows = rows
    return new Promise((res, rej) => {
      const s = connect({ host: this.host, port: this.port })
      s.setTimeout(15000, () => s.destroy(new Error('연결 시간 초과')))
      s.once('connect', () => {
        s.setTimeout(0)
        res()
      })
      s.once('error', (e) => (this.sock ? this.finish(e.message) : rej(e)))
      s.on('data', (d) => this.parse(d))
      s.on('close', () => this.finish('연결이 종료되었습니다'))
      this.sock = s
    })
  }

  private sendCmd(verb: number, opt: number): void {
    this.sock?.write(Buffer.from([IAC, verb, opt]))
  }

  private sendNaws(): void {
    if (!this.naws) return
    const b = [IAC, SB, NAWS, (this.cols >> 8) & 255, this.cols & 255, (this.rows >> 8) & 255, this.rows & 255, IAC, SE]
    this.sock?.write(Buffer.from(b))
  }

  private parse(d: Buffer): void {
    const out: number[] = []
    for (const b of d) {
      switch (this.state) {
        case 'data':
          if (b === IAC) this.state = 'iac'
          else out.push(b)
          break
        case 'iac':
          if (b === IAC) { out.push(255); this.state = 'data' }
          else if (b === SB) { this.state = 'sb'; this.sbBuf = [] }
          else if (b >= WILL && b <= DONT) { this.cmd = b; this.state = 'cmd' }
          else this.state = 'data'
          break
        case 'cmd':
          this.negotiate(this.cmd, b)
          this.state = 'data'
          break
        case 'sb':
          if (b === IAC) this.state = 'sbiac'
          else this.sbBuf.push(b)
          break
        case 'sbiac':
          if (b === SE) {
            this.subneg(this.sbBuf)
            this.state = 'data'
          } else {
            this.sbBuf.push(b)
            this.state = 'sb'
          }
          break
      }
    }
    if (out.length) this.emit('data', Buffer.from(out))
  }

  private negotiate(verb: number, opt: number): void {
    if (verb === DO) {
      if (opt === NAWS) { this.sendCmd(WILL, NAWS); this.naws = true; this.sendNaws() }
      else if (opt === TTYPE) this.sendCmd(WILL, TTYPE)
      else this.sendCmd(WONT, opt)
    } else if (verb === WILL) {
      if (opt === ECHO || opt === SGA) this.sendCmd(DO, opt)
      else this.sendCmd(DONT, opt)
    }
  }

  private subneg(b: number[]): void {
    if (b[0] === TTYPE && b[1] === 1) {
      const t = Buffer.from(this.termType || 'xterm-256color', 'ascii')
      this.sock?.write(Buffer.concat([Buffer.from([IAC, SB, TTYPE, 0]), t, Buffer.from([IAC, SE])]))
    }
  }

  write(data: Buffer): void {
    // escape IAC bytes
    if (data.includes(IAC)) {
      const out: number[] = []
      for (const b of data) { out.push(b); if (b === IAC) out.push(IAC) }
      data = Buffer.from(out)
    }
    this.sock?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.sendNaws()
  }

  private finish(reason?: string): void {
    if (this.closed) return
    this.closed = true
    this.sock?.destroy()
    this.emit('close', reason)
  }

  close(): void {
    this.finish()
  }
}
