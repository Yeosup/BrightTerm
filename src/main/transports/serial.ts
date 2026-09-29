import { EventEmitter } from 'events'
import type { Transport } from './types'
import type { SerialOptions } from '@shared/types'

type SerialPortCtor = typeof import('serialport').SerialPort

let SP: SerialPortCtor | null = null
function loadSerial(): SerialPortCtor {
  if (!SP) {
    // Lazy require: native module – if it fails to load only serial sessions are affected
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    SP = require('serialport').SerialPort as SerialPortCtor
  }
  return SP
}

export async function listSerialPorts(): Promise<{ path: string; label: string }[]> {
  try {
    const ports = await loadSerial().list()
    return ports.map((p) => {
      // macOS: /dev/tty.* waits for carrier detect and hangs on most USB-serial adapters; /dev/cu.* is the one to open
      const path = process.platform === 'darwin' ? p.path.replace(/^\/dev\/tty\./, '/dev/cu.') : p.path
      return { path, label: [path, p.manufacturer, p.friendlyName].filter(Boolean).join(' · ') }
    })
  } catch {
    return []
  }
}

export class SerialTransport extends EventEmitter implements Transport {
  private port: InstanceType<SerialPortCtor> | null = null
  private closed = false

  constructor(private o: SerialOptions) {
    super()
  }

  start(): Promise<void> {
    const Ctor = loadSerial()
    return new Promise((res, rej) => {
      const p = new Ctor({
        path: this.o.path,
        baudRate: this.o.baudRate,
        dataBits: this.o.dataBits,
        parity: this.o.parity,
        stopBits: this.o.stopBits,
        rtscts: this.o.flowControl === 'rtscts',
        xon: this.o.flowControl === 'xonxoff',
        xoff: this.o.flowControl === 'xonxoff',
        autoOpen: false
      })
      p.open((err) => {
        if (err) return rej(err)
        res()
      })
      p.on('data', (d: Buffer) => this.emit('data', d))
      p.on('close', () => this.finish('포트가 닫혔습니다'))
      p.on('error', (e: Error) => this.finish(e.message))
      this.port = p
    })
  }

  write(data: Buffer): void {
    const eol = this.o.enterSends === 'CRLF' ? '\r\n' : this.o.enterSends === 'LF' ? '\n' : '\r'
    let s = data
    if (eol !== '\r' && data.includes(13)) s = Buffer.from(data.toString('latin1').replace(/\r/g, eol), 'latin1')
    if (this.o.localEcho) this.emit('data', Buffer.from(s.toString('latin1').replace(/\r(?!\n)/g, '\r\n'), 'latin1'))
    this.port?.write(s)
  }

  resize(): void { /* no-op */ }

  private finish(reason?: string): void {
    if (this.closed) return
    this.closed = true
    try { if (this.port?.isOpen) this.port.close() } catch { /* */ }
    this.emit('close', reason)
  }

  close(): void {
    this.finish()
  }
}
