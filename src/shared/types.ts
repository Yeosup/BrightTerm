// Shared types between main / preload / renderer

export type Env = 'prod' | 'stage' | 'dev' | 'device' | 'none'
export type Protocol = 'ssh' | 'telnet' | 'serial'
export type AuthType = 'password' | 'key' | 'agent' | 'ask'

export interface Group {
  id: string
  parentId: string | null
  name: string
  color?: string
  env?: Env
  collapsed?: boolean
  sort: number
}

export interface PortForward {
  id: string
  type: 'L' | 'R'
  bindHost: string
  bindPort: number
  destHost: string
  destPort: number
}

export interface SerialOptions {
  path: string
  baudRate: number
  dataBits: 5 | 6 | 7 | 8
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space'
  stopBits: 1 | 1.5 | 2
  flowControl: 'none' | 'rtscts' | 'xonxoff'
  enterSends: 'CR' | 'LF' | 'CRLF'
  localEcho: boolean
}

export interface Host {
  id: string
  groupId: string | null
  alias: string
  protocol: Protocol
  host: string
  port: number
  username: string
  authType: AuthType
  credentialId?: string | null
  jumpHostId?: string | null
  color?: string
  env?: Env
  tags: string[]
  encoding: 'utf-8' | 'euc-kr' | 'cp949' | 'shift_jis' | 'latin1'
  termType: string
  startupCommand?: string
  keepaliveSec: number
  forwards: PortForward[]
  serial?: SerialOptions
  notes?: string
  favorite?: boolean
  lastUsedAt?: number
  sort: number
}

export interface Snippet {
  id: string
  name: string
  body: string
  sendEnter: boolean
}

export interface KnownHost {
  hostPort: string // host:port
  keyType: string
  fingerprint: string // SHA256:base64
  addedAt: number
}

export interface Settings {
  theme: 'dark' | 'light'
  terminalTheme: string
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorStyle: 'block' | 'bar' | 'underline'
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  rightClickPaste: boolean
  ctrlVPaste: boolean
  confirmMultilinePaste: boolean
  guardDangerousOnProd: boolean
  dangerousPatterns: string[]
  autoReconnect: boolean
  autoLockMinutes: number
  uploadDir: string
  uploadCleanupDays: number
  insertPathQuote: boolean
  sessionLog: boolean
  bell: boolean
  sidebarWidth: number
  rightPanelWidth: number
}

export interface StoreData {
  version: number
  groups: Group[]
  hosts: Host[]
  snippets: Snippet[]
  knownHosts: KnownHost[]
  settings: Settings
}

export interface CredentialMeta {
  id: string
  name: string
  kind: 'password' | 'key'
  username?: string
  updatedAt: number
}

export interface CredentialSecret {
  username?: string
  password?: string
  privateKey?: string
  passphrase?: string
}

export interface CredentialInput extends CredentialSecret {
  id?: string
  name: string
  kind: 'password' | 'key'
}

export interface VaultStatus {
  initialized: boolean
  unlocked: boolean
  osUnlockAvailable: boolean
  osUnlockEnabled: boolean
  osUnlockKind?: 'windows' | 'touchid' | 'keychain'
}

export type SessionState = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error'

export interface SessionInfo {
  id: string
  hostId: string | null
  title: string
  protocol: Protocol
  target: string // user@host:port or COM3@115200
  color?: string
  env?: Env
  state: SessionState
  connectedAt?: number
  message?: string
  canSftp: boolean
}

export interface AdhocTarget {
  host: string
  port?: number
  username?: string
  protocol?: Protocol
}

export interface SftpEntry {
  name: string
  path: string
  isDir: boolean
  isLink: boolean
  size: number
  mtime: number
  mode: number
  perm: string
}

export interface Transfer {
  id: string
  sessionId: string
  name: string
  direction: 'up' | 'down'
  bytes: number
  total: number
  state: 'queued' | 'running' | 'done' | 'error' | 'canceled'
  error?: string
  remotePath: string
  localPath?: string
}

export type UiRequest =
  | { reqId: string; kind: 'hostkey'; sessionTitle: string; hostPort: string; keyType: string; fingerprint: string; changed: boolean; oldFingerprint?: string }
  | { reqId: string; kind: 'password'; sessionTitle: string; prompt: string; username: string; allowSave: boolean; failed?: boolean }
  | { reqId: string; kind: 'keyboard'; sessionTitle: string; name: string; instructions: string; prompts: { prompt: string; echo: boolean }[] }
  | { reqId: string; kind: 'passphrase'; sessionTitle: string }
  | { reqId: string; kind: 'username'; sessionTitle: string }

export interface ImportCandidate {
  source: 'putty' | 'ssh-config' | 'aws'
  name: string
  host: Partial<Host>
  keyFile?: string
  /** 점프 호스트의 주소 — 같이 가져오는 후보나 이미 있는 서버 중 host 가 같은 것으로 잇는다 */
  jumpVia?: string
  note?: string
}

export interface ClipboardInfo {
  type: 'image' | 'files' | 'text' | 'empty'
  text?: string
  files?: string[]
  imageSize?: { width: number; height: number }
}

export const MAC_FONT_FAMILY = "Menlo, 'D2Coding', 'Apple SD Gothic Neo', monospace"

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  terminalTheme: 'BrightTerm Dark',
  fontFamily: "'Cascadia Mono', 'D2Coding', Consolas, 'Malgun Gothic', monospace",
  fontSize: 14,
  lineHeight: 1.15,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: true,
  rightClickPaste: true,
  ctrlVPaste: true,
  confirmMultilinePaste: true,
  guardDangerousOnProd: true,
  dangerousPatterns: ['rm\\s+-[a-zA-Z]*r[a-zA-Z]*f', 'rm\\s+-[a-zA-Z]*f[a-zA-Z]*r', '\\breboot\\b', '\\bshutdown\\b', '\\bhalt\\b', '\\bpoweroff\\b', 'mkfs', 'dd\\s+if=', '\\bDROP\\s+(TABLE|DATABASE)\\b', '\\bTRUNCATE\\b', 'systemctl\\s+(stop|restart)'],
  autoReconnect: true,
  autoLockMinutes: 15,
  uploadDir: '~/.brightterm/uploads',
  uploadCleanupDays: 7,
  insertPathQuote: true,
  sessionLog: false,
  bell: false,
  sidebarWidth: 260,
  rightPanelWidth: 340
}

export const ENV_COLORS: Record<Env, string> = {
  prod: '#ef4444',
  stage: '#f59e0b',
  dev: '#22c55e',
  device: '#3b82f6',
  none: '#64748b'
}

export const ENV_LABELS: Record<Env, string> = {
  prod: '운영',
  stage: '스테이징',
  dev: '개발',
  device: '장비',
  none: '일반'
}

export const PALETTE = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#64748b']

// ---------- banners (광고) ----------

export type BannerSlot = 'welcome' | 'sidebar'

/** 원격 피드의 배너 한 건. image 는 https URL(메인이 받아 data: URL 로 바꿔 넘긴다), link 는 https 만. */
export interface Banner {
  id: string
  slot: BannerSlot
  image: string
  link: string
  alt: string
  /** 같은 슬롯 안 노출 비중 (기본 1) */
  weight?: number
  /** ISO 날짜. 이 기간 밖이면 숨긴다 */
  start?: string
  end?: string
}
