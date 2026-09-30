// node-pty 1.1.0 prebuilds 의 spawn-helper 에 실행 권한이 빠져 있어 macOS 에서
// "posix_spawnp failed" 로 셸이 안 뜬다. 설치 직후 권한을 붙인다(Windows 에서는 할 일 없음).
import { chmodSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

const dir = join('node_modules', 'node-pty', 'prebuilds')
if (process.platform !== 'win32' && existsSync(dir)) {
  for (const d of readdirSync(dir)) {
    const f = join(dir, d, 'spawn-helper')
    if (existsSync(f)) chmodSync(f, 0o755)
  }
}
