import { parseRegOutput, puttyToCandidates, parseSshConfig } from './.imp.mjs'
const out = `
HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Default%20Settings
    Present    REG_DWORD    0x1

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\prod-web01
    Present    REG_DWORD    0x1
    HostName    REG_SZ    admin@10.0.0.11
    PortNumber    REG_DWORD    0x8ae
    Protocol    REG_SZ    ssh
    PublicKeyFile    REG_SZ    C:\\keys\\web.ppk
    PortForwardings    REG_SZ    L8080=localhost:80,R9000=127.0.0.1:22,D1080
    LineCodePage    REG_SZ    CP949
    TerminalType    REG_SZ    xterm

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\PLC%20%EA%B2%8C%EC%9D%B4%ED%8A%B8
    Protocol    REG_SZ    serial
    SerialLine    REG_SZ    COM3
    SerialSpeed    REG_DWORD    0x1c200
    SerialParity    REG_DWORD    0x2
    SerialStopHalfbits    REG_DWORD    0x2
    SerialFlowControl    REG_DWORD    0x0
`
const c = puttyToCandidates(parseRegOutput(out))
console.log(JSON.stringify(c.map(x => ({ n: x.name, h: x.host.host, p: x.host.port, u: x.host.username, enc: x.host.encoding, fw: x.host.forwards?.map(f => `${f.type}${f.bindPort}->${f.destHost}:${f.destPort}`), serial: x.host.serial && `${x.host.serial.path}@${x.host.serial.baudRate}/${x.host.serial.parity}`, key: x.keyFile })), null, 1))
const s = parseSshConfig(`Host *\n  ServerAliveInterval 30\nHost bastion db1\n  HostName 1.2.3.4\n  User ubuntu\n  Port 2200\n  IdentityFile ~/.ssh/id_ed25519\n`)
console.log(s.map(x => `${x.name} ${x.host.username}@${x.host.host}:${x.host.port} key=${!!x.keyFile}`))
// Unix PuTTY (~/.putty/sessions): one Key=Value file per session, numbers in decimal
import { parsePuttySessionFiles } from './.imp.mjs'
const u = puttyToCandidates(parsePuttySessionFiles([
  { name: 'stg-api%20mac', text: 'HostName=deploy@10.0.0.21\nPortNumber=2200\nProtocol=ssh\nPublicKeyFile=/Users/me/.ssh/api.ppk\nLineCodePage=UTF-8\n' },
  { name: 'usb-console', text: 'Protocol=serial\nSerialLine=/dev/cu.usbserial-110\nSerialSpeed=115200\nSerialParity=0\n' }
]))
console.log(u.map(x => `${x.name} ${x.host.username}@${x.host.host}:${x.host.port} ${x.host.serial ? x.host.serial.path + '@' + x.host.serial.baudRate : ''} key=${x.keyFile ?? ''}`))
// ssh config: LocalForward / RemoteForward / ProxyJump
const t = parseSshConfig(`Host web-cockpit\n  HostName 10.0.0.30\n  User admin\n  LocalForward 9090 127.0.0.1:9090\n  RemoteForward 0.0.0.0:8022 localhost:22\nHost bast\n  HostName 1.2.3.4\nHost inner\n  HostName 10.0.0.5\n  ProxyJump bast\n`)
console.log(t.map(x => `${x.name} fw=${(x.host.forwards ?? []).map(f => `${f.type}${f.bindHost}:${f.bindPort}->${f.destHost}:${f.destPort}`).join(',')} jump=${x.jumpVia ?? '-'}`))
