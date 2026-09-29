import { EventEmitter } from 'events'

/**
 * A transport is a byte pipe to a remote shell / device.
 * Events: 'data' (Buffer), 'close' (reason?: string)
 */
export interface Transport extends EventEmitter {
  write(data: Buffer): void
  resize(cols: number, rows: number): void
  close(): void
}
