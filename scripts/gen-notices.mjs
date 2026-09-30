// THIRD_PARTY_NOTICES.txt 생성 — 앱에 실제로 들어가는 제3자 구성요소의 저작권 고지·라이선스 전문.
// 대상: 메인 프로세스 의존성(dependencies 전이 포함) + 렌더러 번들에 들어가는 패키지(RENDERER) + Electron 런타임.
// 빌드 전에 실행한다(npm run notices). 의존성을 바꾸면 다시 생성해 커밋할 것.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const ROOT = process.cwd()
const RENDERER = ['react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search', '@xterm/addon-unicode11', '@xterm/addon-web-links', '@xterm/addon-webgl']

const seen = new Map() // dir -> pkg

function resolveDir(name, from) {
  let d = from
  for (;;) {
    const p = join(d, 'node_modules', name)
    if (existsSync(join(p, 'package.json'))) return p
    const up = dirname(d)
    if (up === d) return null
    d = up
  }
}

function walk(name, from, deep = true) {
  const dir = resolveDir(name, from)
  if (!dir || seen.has(dir)) return
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  seen.set(dir, pkg)
  if (!deep) return
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) walk(dep, dir)
}

const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
for (const d of [...Object.keys(root.dependencies), ...RENDERER]) walk(d, ROOT)
// electron 의 npm 의존성(@electron/get 등)은 설치 도구일 뿐 앱에 들어가지 않는다 — 런타임 고지만
walk('electron', ROOT, false)

function licenseText(dir) {
  const f = readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.|$|-mit)/i.test(n))
  return f ? readFileSync(join(dir, f), 'utf8').trim() : null
}

const entries = [...seen.entries()]
  .map(([dir, pkg]) => ({ dir, name: pkg.name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? pkg.licenses?.map?.((l) => l.type ?? l).join(' OR ') ?? '(package.json 표기 없음 — 아래 전문 참고)' }))
  .filter((e) => !['@types/', 'electron-'].some((p) => e.name.startsWith(p)) || e.name === 'electron')
  .sort((a, b) => a.name.localeCompare(b.name))

const out = [
  'BrightTerm — 제3자 구성요소 고지 (Third-Party Notices)',
  '',
  'BrightTerm 자체 코드의 이용조건은 LICENSE 를 보세요. 아래 구성요소에는 각각의 라이선스가 적용되며,',
  'BrightTerm 의 라이선스가 이 구성요소들의 권리를 바꾸지 않습니다.',
  'Electron 에 포함된 Chromium 및 그 구성요소의 고지는 함께 동봉한 LICENSES.chromium.html 에 있습니다.',
  '',
  `구성요소 ${entries.length}개`,
  ...entries.map((e) => `  - ${e.name} ${e.version} (${e.license})`),
  ''
]
const missing = []
for (const e of entries) {
  const text = licenseText(e.dir)
  if (!text) missing.push(e.name)
  out.push('='.repeat(78), `${e.name} ${e.version} — ${e.license}`, '='.repeat(78), text ?? `(라이선스 파일이 패키지에 없습니다. package.json 표기: ${e.license})`, '')
}
writeFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.txt'), out.join('\n'))
console.log(`THIRD_PARTY_NOTICES.txt: ${entries.length} packages${missing.length ? `, 라이선스 파일 없음: ${missing.join(', ')}` : ''}`)
const licenses = {}
for (const e of entries) licenses[e.license] = (licenses[e.license] ?? 0) + 1
console.log(licenses)
