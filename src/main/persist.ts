import type { Host } from '@shared/types'

/**
 * 세션 유지(tmux). 접속 뒤 셸에 한 줄을 입력해 tmux 세션에 붙는다 — 세션이 없으면 만들고
 * (마우스 스크롤 켜기·상태 줄 끄기, 자동 실행 명령은 그 안에서), 있으면 그대로 다시 붙는다.
 * 창을 닫거나 앱을 꺼도 tmux 세션과 안의 프로그램(Claude Code 등)은 계속 돈다.
 * tmux 가 없으면 안내를 찍고 자동 실행 명령만 평소처럼 실행한다.
 * 셸 문법은 POSIX(sh·bash·zsh). tmux 쪽은 sh -c 로 감싸 사용자 셸과 무관하게 돈다.
 */

const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

const slug = (s: string | undefined): string =>
  (s ?? '').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

export function tmuxName(h: Host): string {
  const cwdBase = h.local?.cwd?.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  const base = slug(h.persistName) || slug(h.alias) || slug(cwdBase) || h.id.slice(0, 8)
  return h.persistName?.trim() ? base : `bt-${base}`
}

/** Windows 로컬(PowerShell·cmd)에는 tmux 가 없다 — WSL 셸일 때만 */
export function persistSupported(h: Host): boolean {
  if (!h.persist) return false
  if (h.protocol === 'ssh') return true
  if (h.protocol !== 'local') return false
  if (process.platform !== 'win32') return true
  return /(^|[\\/])wsl(\.exe)?$/i.test(h.local?.shell?.trim() ?? '')
}

/** 접속 직후 셸에 입력할 한 줄 — 세션 유지가 아니면 자동 실행 명령 그대로 */
export function startupLine(h: Host): string | undefined {
  const startup = h.startupCommand?.trim() || undefined
  if (!persistSupported(h)) return startup
  const n = tmuxName(h)
  const t = q(`=${n}`)
  const create = [
    `tmux new-session -d -s ${q(n)} -c "$PWD"`,
    `tmux set-option -t ${q(n)} mouse on >/dev/null`,
    `tmux set-option -t ${q(n)} status off >/dev/null`,
    ...(startup ? [`tmux send-keys -t ${q(n)} -l ${q(startup)}`, `tmux send-keys -t ${q(n)} Enter`] : [])
  ].join(' && ')
  const inner = `tmux has-session -t ${t} 2>/dev/null || { ${create}; }; TMUX= exec tmux attach-session -t ${t}`
  const missing = `echo 'BrightTerm: tmux 가 없어 세션 유지를 쓰지 않습니다 (설치: macOS brew install tmux / Ubuntu sudo apt install tmux)'`
  return ` if command -v tmux >/dev/null 2>&1; then sh -c ${q(inner)}; else ${missing}${startup ? `; ${startup}` : ''}; fi`
}
