import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ImportCandidate } from '@shared/types'

/**
 * AWS EC2 → 서버 후보. aws CLI(이미 설정된 자격 증명)를 그대로 쓴다.
 * 공인 IP 가 없는 인스턴스는 같은 VPC 의 공인 IP 인스턴스(이름에 bastion 이 있으면 우선)를 점프 호스트로 잇는다.
 */

// Finder 에서 띄운 앱은 PATH 가 /usr/bin:/bin 뿐이라 Homebrew/공식 설치 경로를 직접 찾는다
const AWS_PATHS = ['/opt/homebrew/bin/aws', '/usr/local/bin/aws', '/usr/bin/aws']

function awsBin(): string {
  return AWS_PATHS.find((p) => existsSync(p)) ?? 'aws'
}

function aws(args: string[], profile?: string): Promise<unknown> {
  return new Promise((res, rej) => {
    const a = [...args, '--output', 'json', ...(profile ? ['--profile', profile] : [])]
    execFile(awsBin(), a, { maxBuffer: 64 * 1024 * 1024, timeout: 60000, windowsHide: true }, (err, out, errOut) => {
      if (err) return rej(new Error((errOut || err.message).trim().split('\n').pop() || 'aws CLI 실행 실패'))
      try { res(JSON.parse(out)) } catch { rej(new Error('aws CLI 출력 해석 실패')) }
    })
  })
}

interface Ec2 {
  InstanceId: string
  ImageId: string
  State: { Name: string }
  PublicIpAddress?: string
  PrivateIpAddress?: string
  KeyName?: string
  VpcId?: string
  Platform?: string
  Tags?: { Key: string; Value: string }[]
}

/** AMI 이름으로 기본 로그인 계정을 고른다. */
export function userForImage(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('ubuntu')) return 'ubuntu'
  if (n.includes('debian')) return 'admin'
  if (n.includes('centos')) return 'centos'
  if (n.includes('rocky')) return 'rocky'
  if (n.includes('fedora')) return 'fedora'
  return 'ec2-user' // Amazon Linux, RHEL 등
}

export function findKeyFile(keyName?: string): string | undefined {
  if (!keyName) return undefined
  const dirs = [join(homedir(), '.ssh'), join(homedir(), 'Downloads'), join(homedir(), '.aws')]
  for (const d of dirs) for (const ext of ['.pem', '']) {
    const p = join(d, keyName + ext)
    if (existsSync(p)) return p
  }
  return undefined
}

export function ec2ToCandidates(region: string, instances: Ec2[], imageNames: Record<string, string>): ImportCandidate[] {
  const live = instances.filter((i) => i.State.Name === 'running' || i.State.Name === 'stopped')
  const name = (i: Ec2): string => i.Tags?.find((t) => t.Key === 'Name')?.Value || i.InstanceId
  // 같은 VPC 를 여러 서비스가 나눠 쓰면(shop-app 옆에 blog-bastion) 이름 앞부분이 같은 배스천이 맞다
  const stem = (n: string): string => n.toLowerCase().replace(/[-_ ]?(app|api|web|was|server|bastion|jump|배스천)\d*$/, '')
  const bastionOf = (target: Ec2): Ec2 | undefined => {
    const pub = live.filter((i) => i.VpcId === target.VpcId && i.PublicIpAddress && i.Platform !== 'windows')
    const isB = (i: Ec2): boolean => /bastion|jump|배스천/i.test(name(i))
    const same = (i: Ec2): boolean => stem(name(i)) === stem(name(target))
    return pub.find((i) => same(i) && isB(i)) ?? pub.find(same) ?? pub.find(isB) ?? pub[0]
  }
  const out: ImportCandidate[] = []
  for (const i of live) {
    if (i.Platform === 'windows') continue
    const jump = i.PublicIpAddress ? undefined : bastionOf(i)
    const addr = i.PublicIpAddress ?? i.PrivateIpAddress
    if (!addr) continue
    const keyFile = findKeyFile(i.KeyName)
    out.push({
      source: 'aws',
      name: name(i),
      keyFile,
      jumpVia: jump?.PublicIpAddress,
      note: [region, i.State.Name === 'stopped' ? '중지됨' : '', i.KeyName && !keyFile ? `키 파일 없음: ${i.KeyName}.pem` : ''].filter(Boolean).join(' · '),
      host: {
        alias: name(i),
        protocol: 'ssh',
        host: addr,
        port: 22,
        username: userForImage(imageNames[i.ImageId] ?? ''),
        authType: 'key',
        keepaliveSec: 30,
        notes: `AWS ${region} ${i.InstanceId}${i.KeyName ? ` (키: ${i.KeyName})` : ''}`
      }
    })
  }
  return out
}

export async function scanAws(profile?: string): Promise<ImportCandidate[]> {
  const regions = ((await aws(['ec2', 'describe-regions', '--query', 'Regions[].RegionName'], profile)) as string[]) ?? []
  const per = await Promise.all(regions.map(async (region) => {
    try {
      const r = (await aws(['ec2', 'describe-instances', '--region', region, '--query', 'Reservations[].Instances[]'], profile)) as Ec2[]
      if (!r.length) return []
      const ids = [...new Set(r.map((i) => i.ImageId))]
      const imageNames: Record<string, string> = {}
      // 한 번에 묻되, 등록 해제된 AMI 가 섞여 전체가 실패하면 하나씩 다시 묻는다
      const names = async (list: string[]): Promise<void> => {
        const imgs = (await aws(['ec2', 'describe-images', '--region', region, '--image-ids', ...list, '--query', 'Images[].[ImageId,Name]'], profile)) as [string, string][]
        for (const [id, n] of imgs) imageNames[id] = n ?? ''
      }
      await names(ids).catch(() => Promise.all(ids.map((id) => names([id]).catch(() => undefined))))
      return ec2ToCandidates(region, r, imageNames)
    } catch {
      return [] // 비활성 리전 등
    }
  }))
  return per.flat()
}
