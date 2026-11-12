import { DEFAULT_SETTINGS, MAC_FONT_FAMILY } from '@shared/types'
import { isMac } from './platform'

const GENERIC = new Set(['monospace', 'sans-serif', 'serif', 'cursive', 'fantasy', 'system-ui', 'ui-monospace'])

// Common monospace fonts offered in the picker (only the installed ones are shown). Others can still be typed by name.
// (queryLocalFonts never resolves in Electron without a permission prompt, so the OS list is not used.)
const CANDIDATES = [
  'D2Coding', 'D2Coding ligature', 'NanumGothicCoding', '나눔고딕코딩', 'Sarasa Mono K', 'Noto Sans Mono CJK KR', 'Source Han Mono',
  'Cascadia Mono', 'Cascadia Code', 'Cascadia Mono PL', 'Cascadia Code PL', 'Consolas', 'Lucida Console', 'Courier New',
  'JetBrains Mono', 'Fira Code', 'Fira Mono', 'Source Code Pro', 'Hack', 'Iosevka', 'Roboto Mono', 'IBM Plex Mono', 'Ubuntu Mono',
  'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono', 'Inconsolata', 'Victor Mono', 'MesloLGS NF', 'Hack Nerd Font',
  'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'Menlo', 'Monaco', 'SF Mono', 'Andale Mono', 'PT Mono'
]

/** "'Cascadia Mono', D2Coding, monospace" → ['Cascadia Mono', 'D2Coding', 'monospace'] */
export function familyList(css: string): string[] {
  return css.split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '').trim()).filter(Boolean)
}

let ctx: CanvasRenderingContext2D | null = null
function width(font: string, text: string): number {
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx) return 0
  ctx.font = `40px ${font}`
  return ctx.measureText(text).width
}

const SAMPLE = 'mmmmmmmmmmlli 가나다WW'
/** Installed = rendering with it differs from at least one generic fallback (classic canvas probe; works on Windows/macOS/Linux) */
export function isInstalled(family: string): boolean {
  if (GENERIC.has(family.toLowerCase())) return true
  return ['monospace', 'sans-serif', 'serif'].some((base) => width(`"${family}", ${base}`, SAMPLE) !== width(base, SAMPLE))
}

function isMonospace(family: string): boolean {
  const f = `"${family}", monospace`
  return Math.abs(width(f, 'iiiiiiiiii') - width(f, 'WWWWWWWWWW')) < 0.5
}

/** Installed monospace families from CANDIDATES, sorted */
export function installedMonoFonts(): string[] {
  return CANDIDATES.filter((n) => isInstalled(n) && isMonospace(n)).sort((a, b) => a.localeCompare(b))
}

/** First family in the list that is actually installed (what the terminal will use for Latin text) */
export function effectiveFamily(css: string): string | null {
  return familyList(css).find((f) => isInstalled(f)) ?? null
}

/** Picked font first, then the platform default stack (keeps Korean fallback) */
export function withFallback(family: string): string {
  const base = isMac ? MAC_FONT_FAMILY : DEFAULT_SETTINGS.fontFamily
  const rest = familyList(base).filter((f) => f.toLowerCase() !== family.toLowerCase())
  const q = (f: string): string => (GENERIC.has(f.toLowerCase()) ? f : `'${f}'`)
  return [family, ...rest].map(q).join(', ')
}
