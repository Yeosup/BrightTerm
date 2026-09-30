import { EventEmitter } from 'events'
import { createRequire } from 'module'
import { app } from 'electron'
import { existsSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { IPty } from 'node-pty'

type NodePty = typeof import('node-pty')
let ptyModule: NodePty | null = null

/**
 * Windows 패키지 앱에서는 app.asar.unpacked 에서 직접 불러온다. node-pty 의 콘솔 워커는
 * __dirname 기준 경로로 Worker 를 띄우는데, app.asar 경로로 잡히면 워커 파일을 못 찾는다.
 * macOS 는 반대로 평소대로 불러야 한다 — node-pty 가 spawn-helper 경로의 'app.asar' 를
 * 'app.asar.unpacked' 로 바꾸는데, 이미 unpacked 경로면 '.unpacked.unpacked' 가 되어 posix_spawnp 가 실패한다.
 */
function loadPty(): NodePty {
  if (ptyModule) return ptyModule
  const id = app.isPackaged && isWin ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty') : 'node-pty'
  ptyModule = createRequire(__filename)(id) as NodePty
  return ptyModule
}
import type { LocalOptions } from '@shared/types'
import type { Transport } from './types'

const isWin = process.platform === 'win32'

/** 셸 목록 — 설정 화면의 선택지. 첫 항목이 기본값 */
export function listShells(): { path: string; label: string }[] {
  if (isWin) {
    const sys = join(process.env.SystemRoot || 'C:\\Windows', 'System32')
    const out = [
      { path: 'powershell.exe', label: 'Windows PowerShell' },
      { path: 'cmd.exe', label: '명령 프롬프트 (cmd)' }
    ]
    const pwsh = (process.env.PATH || '').split(';').map((d) => join(d, 'pwsh.exe')).find((p) => existsSync(p))
    if (pwsh) out.splice(1, 0, { path: 'pwsh.exe', label: 'PowerShell 7' })
    if (existsSync(join(sys, 'wsl.exe'))) out.push({ path: 'wsl.exe', label: 'WSL (Linux)' })
    return out
  }
  const def = defaultShell()
  let listed: string[] = []
  try {
    listed = readFileSync('/etc/shells', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/') && existsSync(l))
  } catch { /* */ }
  return [def, ...listed.filter((p) => p !== def)].map((p) => ({ path: p, label: p.split('/').pop()! }))
}

/** tmux 가 있는지 — Finder 로 켠 앱은 PATH 가 짧아서 흔한 설치 위치도 본다 */
export function hasTmux(): boolean {
  if (isWin) return false
  const dirs = [...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/home/linuxbrew/.linuxbrew/bin']
  return dirs.some((d) => d && existsSync(join(d, 'tmux')))
}

function defaultShell(): string {
  if (isWin) return 'powershell.exe'
  return process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/zsh'
}

export function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') || p.startsWith('~\\') ? join(homedir(), p.slice(2)) : p
}

function argsFor(shell: string): string[] {
  const name = shell.split(/[\\/]/).pop()!.toLowerCase()
  if (isWin) return /^(powershell|pwsh)(\.exe)?$/.test(name) ? ['-NoLogo'] : []
  // 로그인 셸 — Finder 에서 켠 앱은 PATH 가 짧아서 /etc/zprofile(path_helper) 등을 읽혀야 brew·node 가 잡힌다
  return /^(bash|zsh|fish|sh|ksh|tcsh|csh)$/.test(name) ? ['-l'] : []
}

function shellEnv(termType: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('ELECTRON_')) env[k] = v
  env.TERM = termType || 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'BrightTerm'
  env.TERM_PROGRAM_VERSION = app.getVersion()
  // Finder·Dock 으로 켜면 LANG 이 비어 한글이 깨진다 — macOS 터미널처럼 채운다
  if (!isWin && !env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = app.getLocale().startsWith('ko') ? 'ko_KR.UTF-8' : 'en_US.UTF-8'
  return env
}

/** 이 PC 의 셸을 가상 터미널(pty)로 띄운다. 입출력은 UTF-8 */
export class LocalTransport extends EventEmitter implements Transport {
  private pty: IPty | null = null
  private closing = false
  /** 시작 폴더가 없어서 홈으로 바꿨을 때 안내용 */
  cwdFallback = false

  constructor(private opts: LocalOptions, private termType: string) {
    super()
  }

  async start(cols: number, rows: number): Promise<void> {
    // node-pty 는 네이티브 모듈 — 로컬 터미널을 쓸 때만 불러온다
    const pty = loadPty()
    const shell = this.opts.shell?.trim() || defaultShell()
    let cwd = expandHome(this.opts.cwd?.trim() || '~')
    try {
      if (!statSync(cwd).isDirectory()) throw new Error()
    } catch {
      this.cwdFallback = !!this.opts.cwd?.trim()
      cwd = homedir()
    }
    this.pty = pty.spawn(shell, argsFor(shell), {
      name: this.termType || 'xterm-256color',
      cols: Math.max(2, cols),
      rows: Math.max(2, rows),
      cwd,
      env: shellEnv(this.termType)
    })
    this.pty.onData((d) => this.emit('data', Buffer.from(d, 'utf8')))
    this.pty.onExit(({ exitCode }) => {
      this.pty = null
      this.emit('close', this.closing ? undefined : `셸이 종료되었습니다${exitCode ? ` (코드 ${exitCode})` : ''}`)
    })
  }

  write(data: Buffer): void {
    this.pty?.write(data.toString('utf8'))
  }

  resize(cols: number, rows: number): void {
    if (cols > 1 && rows > 1) {
      try { this.pty?.resize(cols, rows) } catch { /* 이미 종료 */ }
    }
  }

  close(): void {
    this.closing = true
    try { this.pty?.kill() } catch { /* */ }
    this.pty = null
  }
}
