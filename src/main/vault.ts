import { randomBytes, scryptSync, createCipheriv, createDecipheriv, randomUUID } from 'crypto'
import { safeStorage, systemPreferences, BrowserWindow } from 'electron'
import { join } from 'path'
import { dataDir, readJson, writeJsonAtomicSync } from './store'
import type { CredentialInput, CredentialMeta, CredentialSecret, VaultStatus } from '@shared/types'

/*
 * Key hierarchy
 *   master password --scrypt(N=2^17,r=8,p=1)--> KEK --AES-256-GCM--> vault key (random 256 bit)
 *   recovery code   --scrypt-->                  RK  --AES-256-GCM--> vault key
 *   (optional) OS keychain (safeStorage: DPAPI on Windows, Keychain on macOS) --> vault key
 *              on macOS gated by Touch ID when the Mac has it
 *   vault key --AES-256-GCM--> each credential secret
 * Changing the master password only re-wraps the vault key.
 */

interface Enc { iv: string; tag: string; ct: string }
interface Kdf { alg: 'scrypt'; N: number; r: number; p: number; salt: string }
interface VaultItem extends Enc { id: string; name: string; kind: 'password' | 'key'; username?: string; updatedAt: number }
interface VaultFile {
  version: 1
  kdf: Kdf
  wrapped: Enc
  recoveryKdf?: Kdf
  recoveryWrapped?: Enc
  osWrapped?: string
  items: VaultItem[]
}

const SCRYPT = { N: 1 << 17, r: 8, p: 1 }

function derive(secret: string, kdf: Kdf): Buffer {
  return scryptSync(secret.normalize('NFKC'), Buffer.from(kdf.salt, 'base64'), 32, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 512 * 1024 * 1024
  })
}

function newKdf(): Kdf {
  return { alg: 'scrypt', ...SCRYPT, salt: randomBytes(16).toString('base64') }
}

function seal(key: Buffer, plain: Buffer, aad?: string): Enc {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  if (aad) c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plain), c.final()])
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }
}

function open(key: Buffer, e: Enc, aad?: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'))
  if (aad) d.setAAD(Buffer.from(aad))
  d.setAuthTag(Buffer.from(e.tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(e.ct, 'base64')), d.final()])
}

function recoveryCode(): string {
  // 24 chars base32, grouped 4-4-4-4-4-4
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const b = randomBytes(24)
  let s = ''
  for (let i = 0; i < 24; i++) s += alphabet[b[i] % alphabet.length]
  return s.match(/.{4}/g)!.join('-')
}

class Vault {
  private file = ''
  private v: VaultFile | null = null
  private key: Buffer | null = null
  onLockChange: (unlocked: boolean) => void = () => {}

  init(): void {
    this.file = join(dataDir(), 'vault.json')
    this.v = readJson<VaultFile>(this.file)
  }

  status(): VaultStatus {
    return {
      initialized: !!this.v,
      unlocked: !!this.key,
      osUnlockAvailable: safeStorage.isEncryptionAvailable(),
      osUnlockEnabled: !!this.v?.osWrapped,
      osUnlockKind: process.platform === 'darwin' ? (systemPreferences.canPromptTouchID() ? 'touchid' : 'keychain') : 'windows'
    }
  }

  private save(): void {
    if (this.v) writeJsonAtomicSync(this.file, this.v)
  }

  setup(password: string): { recoveryCode: string } {
    if (this.v) throw new Error('이미 볼트가 설정되어 있습니다')
    if (password.length < 8) throw new Error('마스터 비밀번호는 8자 이상이어야 합니다')
    const vk = randomBytes(32)
    const kdf = newKdf()
    const rc = recoveryCode()
    const rkdf = newKdf()
    this.v = {
      version: 1,
      kdf,
      wrapped: seal(derive(password, kdf), vk, 'vault-key'),
      recoveryKdf: rkdf,
      recoveryWrapped: seal(derive(rc.replace(/-/g, ''), rkdf), vk, 'vault-key'),
      items: []
    }
    this.key = vk
    this.save()
    // no onLockChange here: the lock screen must stay up to show the recovery code
    return { recoveryCode: rc }
  }

  unlock(password: string): boolean {
    if (!this.v) return false
    try {
      this.key = open(derive(password, this.v.kdf), this.v.wrapped, 'vault-key')
      this.onLockChange(true)
      return true
    } catch {
      return false
    }
  }

  async tryOsUnlock(win?: BrowserWindow | null): Promise<boolean> {
    if (!this.v?.osWrapped || !safeStorage.isEncryptionAvailable()) return false
    if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
      try {
        if (win && !win.isFocused()) win.focus()
        await systemPreferences.promptTouchID('BrightTerm 볼트 잠금 해제')
      } catch {
        return false // cancelled or failed – the master password still works
      }
    }
    try {
      const hex = safeStorage.decryptString(Buffer.from(this.v.osWrapped, 'base64'))
      this.key = Buffer.from(hex, 'hex')
      // verify key by unwrapping an item (or accept if no items)
      if (this.v.items[0]) open(this.key, this.v.items[0], this.v.items[0].id)
      this.onLockChange(true)
      return true
    } catch {
      this.key = null
      return false
    }
  }

  setOsUnlock(enabled: boolean): void {
    this.requireKey()
    if (!this.v) return
    if (enabled && safeStorage.isEncryptionAvailable()) {
      this.v.osWrapped = safeStorage.encryptString(this.key!.toString('hex')).toString('base64')
    } else {
      delete this.v.osWrapped
    }
    this.save()
  }

  resetWithRecovery(code: string, newPassword: string): boolean {
    if (!this.v?.recoveryKdf || !this.v.recoveryWrapped) return false
    try {
      const vk = open(derive(code.replace(/[-\s]/g, '').toUpperCase(), this.v.recoveryKdf), this.v.recoveryWrapped, 'vault-key')
      const kdf = newKdf()
      this.v.kdf = kdf
      this.v.wrapped = seal(derive(newPassword, kdf), vk, 'vault-key')
      this.key = vk
      this.save()
      this.onLockChange(true)
      return true
    } catch {
      return false
    }
  }

  changePassword(oldPw: string, newPw: string): boolean {
    if (!this.v) return false
    try {
      const vk = open(derive(oldPw, this.v.kdf), this.v.wrapped, 'vault-key')
      const kdf = newKdf()
      this.v.kdf = kdf
      this.v.wrapped = seal(derive(newPw, kdf), vk, 'vault-key')
      this.save()
      return true
    } catch {
      return false
    }
  }

  lock(): void {
    if (this.key) this.key.fill(0)
    this.key = null
    this.onLockChange(false)
  }

  isUnlocked(): boolean {
    return !!this.key
  }

  private requireKey(): void {
    if (!this.key) throw new Error('볼트가 잠겨 있습니다')
  }

  list(): CredentialMeta[] {
    return (this.v?.items ?? []).map(({ id, name, kind, username, updatedAt }) => ({ id, name, kind, username, updatedAt }))
  }

  get(id: string): CredentialSecret | null {
    this.requireKey()
    const it = this.v?.items.find((x) => x.id === id)
    if (!it) return null
    return JSON.parse(open(this.key!, it, it.id).toString('utf8'))
  }

  save_(input: CredentialInput): CredentialMeta {
    this.requireKey()
    if (!this.v) throw new Error('볼트 없음')
    const id = input.id || randomUUID()
    const prev = input.id ? this.get(input.id) : null
    const secret: CredentialSecret = {
      username: input.username ?? prev?.username,
      password: input.password ?? prev?.password,
      privateKey: input.privateKey ?? prev?.privateKey,
      passphrase: input.passphrase ?? prev?.passphrase
    }
    const enc = seal(this.key!, Buffer.from(JSON.stringify(secret), 'utf8'), id)
    const item: VaultItem = { id, name: input.name, kind: input.kind, username: secret.username, updatedAt: Date.now(), ...enc }
    this.v.items = [...this.v.items.filter((x) => x.id !== id), item]
    this.save()
    const { name, kind, username, updatedAt } = item
    return { id, name, kind, username, updatedAt }
  }

  remove(id: string): void {
    if (!this.v) return
    this.v.items = this.v.items.filter((x) => x.id !== id)
    this.save()
  }

  exportRaw(): VaultFile | null {
    return this.v
  }

  importRaw(v: VaultFile): void {
    // an OS-wrapped key only opens on the machine (and OS) that made it – e.g. a Windows backup on a Mac
    const { osWrapped: _drop, ...rest } = v
    this.v = rest
    this.key = null
    this.save()
    this.onLockChange(false)
  }
}

export const vault = new Vault()
export type { VaultFile }
