import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import * as iconv from 'iconv-lite'
import type { Host, ImportCandidate, SerialOptions } from '@shared/types'

/** Decode bytes as UTF-8 if valid, otherwise as CP949 (Korean Windows console / PuTTY session names). */
function decodeSmart(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return iconv.decode(buf, 'cp949')
  }
}

/** PuTTY escapes session names byte-wise (%XX) in the local code page. */
export function decodeSessionName(raw: string): string {
  const bytes: number[] = []
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      for (const b of Buffer.from(raw[i], 'utf8')) bytes.push(b)
    }
  }
  return decodeSmart(Buffer.from(bytes))
}

const PUTTY_KEY = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions'

function regQuery(key: string): Promise<string> {
  return new Promise((res) => {
    execFile('reg', ['query', key, '/s'], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, out) => res(err ? '' : decodeSmart(out as Buffer)))
  })
}

/** Parse `reg query /s` output into { keyPath: { valueName: value } } */
export function parseRegOutput(out: string): Map<string, Record<string, string | number>> {
  const map = new Map<string, Record<string, string | number>>()
  let cur: Record<string, string | number> | null = null
  for (const raw of out.split(/\r?\n/)) {
    if (/^HKEY_/.test(raw)) {
      cur = {}
      map.set(raw.trim(), cur)
      continue
    }
    const m = raw.match(/^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/) || raw.match(/^\s{4}(.+?)\s{4}(REG_\w+)$/)
    if (m && cur) {
      const [, name, type, val = ''] = m
      cur[name] = type === 'REG_DWORD' ? parseInt(val, 16) : val
    }
  }
  return map
}

const CODEPAGE: Record<string, Host['encoding']> = {
  'UTF-8': 'utf-8', 'CP949': 'cp949', 'EUC-KR': 'euc-kr', 'Shift_JIS': 'shift_jis', 'ISO-8859-1:1998 (Latin-1, West Europe)': 'latin1'
}

export function puttyToCandidates(map: Map<string, Record<string, string | number>>): ImportCandidate[] {
  const out: ImportCandidate[] = []
  for (const [key, v] of map) {
    const m = key.match(/\\Sessions\\(.+)$/)
    if (!m) continue
    const name = decodeSessionName(m[1])
    if (name === 'Default Settings' && !v.HostName) continue
    const proto = String(v.Protocol ?? 'ssh')
    const protocol: Host['protocol'] = proto === 'telnet' ? 'telnet' : proto === 'serial' ? 'serial' : 'ssh'
    if (protocol !== 'serial' && !v.HostName) continue
    let hostName = String(v.HostName ?? '')
    let username = String(v.UserName ?? '')
    if (hostName.includes('@')) {
      const [u, h] = hostName.split('@')
      username = username || u
      hostName = h
    }
    const forwards: Host['forwards'] = []
    const pf = String(v.PortForwardings ?? '')
    for (const part of pf.split(',').filter(Boolean)) {
      // e.g. L8080=localhost:80  R9000=127.0.0.1:22  4L127.0.0.1:8080=x:80
      const fm = part.match(/^[46]?([LRD])(?:([^:=]+):)?(\d+)=?([^:]*):?(\d*)$/)
      if (fm && fm[1] !== 'D') {
        forwards.push({ id: crypto.randomUUID(), type: fm[1] as 'L' | 'R', bindHost: fm[2] || '127.0.0.1', bindPort: +fm[3], destHost: fm[4] || 'localhost', destPort: +(fm[5] || 0) })
      }
    }
    let serial: SerialOptions | undefined
    if (protocol === 'serial') {
      const parityMap = ['none', 'odd', 'even', 'mark', 'space'] as const
      serial = {
        path: String(v.SerialLine ?? 'COM1'),
        baudRate: Number(v.SerialSpeed ?? 9600),
        dataBits: (Number(v.SerialDataBits ?? 8) as SerialOptions['dataBits']),
        parity: parityMap[Number(v.SerialParity ?? 0)] ?? 'none',
        stopBits: Number(v.SerialStopHalfbits ?? 2) === 3 ? 1.5 : Number(v.SerialStopHalfbits ?? 2) === 4 ? 2 : 1,
        flowControl: Number(v.SerialFlowControl ?? 1) === 2 ? 'rtscts' : Number(v.SerialFlowControl ?? 1) === 1 ? 'xonxoff' : 'none',
        enterSends: 'CR',
        localEcho: Number(v.LocalEcho ?? 2) === 0
      }
      hostName = serial.path
    }
    const cp = String(v.LineCodePage ?? 'UTF-8')
    out.push({
      source: 'putty',
      name,
      keyFile: v.PublicKeyFile ? String(v.PublicKeyFile) : undefined,
      host: {
        alias: name,
        protocol,
        host: hostName,
        port: Number(v.PortNumber ?? (protocol === 'telnet' ? 23 : 22)),
        username,
        termType: String(v.TerminalType ?? 'xterm-256color') === 'xterm' ? 'xterm-256color' : String(v.TerminalType ?? 'xterm-256color'),
        keepaliveSec: Number(v.PingIntervalSecs ?? v.PingInterval ?? 0) || 30,
        encoding: CODEPAGE[cp] ?? (/949|euc-kr/i.test(cp) ? 'cp949' : 'utf-8'),
        startupCommand: v.RemoteCommand ? String(v.RemoteCommand) : undefined,
        forwards,
        serial,
        authType: v.PublicKeyFile ? 'key' : 'password'
      }
    })
  }
  return out
}

/** Unix PuTTY (e.g. Homebrew on macOS) keeps one `Key=Value` file per session in ~/.putty/sessions. */
export function parsePuttySessionFiles(files: { name: string; text: string }[]): Map<string, Record<string, string | number>> {
  const map = new Map<string, Record<string, string | number>>()
  for (const f of files) {
    const v: Record<string, string | number> = {}
    for (const line of f.text.split(/\r?\n/)) {
      const i = line.indexOf('=')
      if (i > 0) v[line.slice(0, i)] = line.slice(i + 1)
    }
    map.set(`${PUTTY_KEY}\\${f.name}`, v)
  }
  return map
}

export async function scanPutty(): Promise<ImportCandidate[]> {
  if (process.platform === 'win32') return puttyToCandidates(parseRegOutput(await regQuery(PUTTY_KEY)))
  const dir = join(homedir(), '.putty', 'sessions')
  try {
    const names = await fs.readdir(dir)
    const files = await Promise.all(names.map(async (name) => ({ name, text: await fs.readFile(join(dir, name), 'utf8') })))
    return puttyToCandidates(parsePuttySessionFiles(files))
  } catch {
    return []
  }
}

export async function scanPuttyHostKeys(): Promise<{ hostPort: string; keyType: string }[]> {
  if (process.platform !== 'win32') return []
  const map = parseRegOutput(await regQuery('HKCU\\Software\\SimonTatham\\PuTTY\\SshHostKeys'))
  const out: { hostPort: string; keyType: string }[] = []
  for (const v of map.values()) for (const k of Object.keys(v)) {
    const m = k.match(/^([\w-]+)@(\d+):(.+)$/)
    if (m) out.push({ keyType: m[1], hostPort: `${m[3]}:${m[2]}` })
  }
  return out
}

/** "[bind:]port host:hostport" (LocalForward / RemoteForward 인자) */
function sshForward(type: 'L' | 'R', v: string): NonNullable<Host['forwards']>[number] | null {
  const m = v.trim().match(/^(?:(\[[^\]]+\]|[^\s:]+):)?(\d+)\s+(\[[^\]]+\]|[^\s:]+):(\d+)$/)
  if (!m) return null
  return { id: crypto.randomUUID(), type, bindHost: m[1]?.replace(/[[\]]/g, '') || '127.0.0.1', bindPort: +m[2], destHost: m[3].replace(/[[\]]/g, ''), destPort: +m[4] }
}

export function parseSshConfig(text: string): ImportCandidate[] {
  const out: ImportCandidate[] = []
  const jumps: (string | undefined)[] = []
  let cur: { names: string[]; o: Record<string, string>; fw: NonNullable<Host['forwards']> } | null = null
  const flush = (): void => {
    if (!cur) return
    for (const n of cur.names) {
      if (/[*?!]/.test(n)) continue
      jumps.push(cur.o.proxyjump && cur.o.proxyjump !== 'none' ? cur.o.proxyjump.split(',')[0].trim() : undefined)
      out.push({
        source: 'ssh-config',
        name: n,
        keyFile: cur.o.identityfile?.replace(/^~/, homedir()),
        host: {
          alias: n,
          protocol: 'ssh',
          host: cur.o.hostname || n,
          port: Number(cur.o.port || 22),
          username: cur.o.user || '',
          authType: cur.o.identityfile ? 'key' : 'password',
          keepaliveSec: Number(cur.o.serveraliveinterval) || undefined,
          forwards: cur.fw.map((f) => ({ ...f, id: crypto.randomUUID() })),
          notes: cur.o.proxyjump ? `ProxyJump ${cur.o.proxyjump}` : undefined
        }
      })
    }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const m = line.match(/^(\S+)\s*=?\s*(.*)$/)
    if (!m) continue
    const k = m[1].toLowerCase()
    const v = m[2].replace(/^"(.*)"$/, '$1')
    if (k === 'host') {
      flush()
      cur = { names: v.split(/\s+/), o: {}, fw: [] }
    } else if (k === 'match') {
      flush()
      cur = null
    } else if (cur && (k === 'localforward' || k === 'remoteforward')) {
      const f = sshForward(k === 'localforward' ? 'L' : 'R', v)
      if (f) cur.fw.push(f)
    } else if (cur && !(k in cur.o)) cur.o[k] = v
  }
  flush()
  // ProxyJump: 같은 파일의 Host 별칭이면 그 HostName, 아니면 user@host:port 의 host
  out.forEach((c, i) => {
    const j = jumps[i]
    if (!j) return
    c.jumpVia = out.find((x) => x.name === j)?.host.host ?? j.replace(/^[^@]*@/, '').replace(/:\d+$/, '')
  })
  return out
}

export async function scanSshConfig(): Promise<ImportCandidate[]> {
  try {
    return parseSshConfig(await fs.readFile(join(homedir(), '.ssh', 'config'), 'utf8'))
  } catch {
    return []
  }
}
