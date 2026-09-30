import type {
  AdhocTarget, Banner, ClipboardInfo, CredentialInput, CredentialMeta, CredentialSecret, ImportCandidate, SessionInfo, SftpEntry, StoreData, Transfer, UiRequest, VaultStatus
} from '@shared/types'

interface Bt {
  call<T>(ch: string, ...args: unknown[]): Promise<T>
  on(ch: string, cb: (...a: never[]) => void): () => void
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  respond(reqId: string, value: unknown): void
  pathForFile(f: File): string
  platform: string
}

declare global {
  interface Window { bt: Bt }
}

const bt = window.bt

export const api = {
  platform: bt.platform,
  write: bt.write,
  resize: bt.resize,
  respond: bt.respond,
  pathForFile: bt.pathForFile,
  on: {
    data: (cb: (id: string, data: string) => void) => bt.on('session:data', cb as never),
    state: (cb: (info: SessionInfo) => void) => bt.on('session:state', cb as never),
    request: (cb: (r: UiRequest) => void) => bt.on('ui:request', cb as never),
    transfer: (cb: (t: Transfer) => void) => bt.on('transfer:update', cb as never),
    vault: (cb: (unlocked: boolean) => void) => bt.on('vault:changed', cb as never),
    storeChanged: (cb: () => void) => bt.on('store:changed', cb as never),
    toast: (cb: (t: { kind: 'ok' | 'error' | 'info'; text: string }) => void) => bt.on('toast', cb as never),
    menu: (cb: (action: string) => void) => bt.on('menu:action', cb as never),
    ads: (cb: () => void) => bt.on('ads:changed', cb as never)
  },
  store: {
    get: () => bt.call<StoreData>('store:get'),
    patch: (p: Partial<StoreData>) => bt.call<void>('store:patch', p)
  },
  vault: {
    status: () => bt.call<VaultStatus>('vault:status'),
    setup: (pw: string) => bt.call<{ recoveryCode: string }>('vault:setup', pw),
    unlock: (pw: string) => bt.call<boolean>('vault:unlock', pw),
    unlockOs: () => bt.call<boolean>('vault:unlockOs'),
    recover: (code: string, pw: string) => bt.call<boolean>('vault:recover', code, pw),
    lock: () => bt.call<void>('vault:lock'),
    changePassword: (a: string, b: string) => bt.call<boolean>('vault:changePassword', a, b),
    setOsUnlock: (en: boolean) => bt.call<void>('vault:setOsUnlock', en)
  },
  cred: {
    list: () => bt.call<CredentialMeta[]>('cred:list'),
    get: (id: string) => bt.call<CredentialSecret | null>('cred:get', id),
    save: (c: CredentialInput) => bt.call<CredentialMeta>('cred:save', c),
    remove: (id: string) => bt.call<void>('cred:delete', id)
  },
  session: {
    open: (o: { hostId?: string; adhoc?: AdhocTarget; cols?: number; rows?: number }) => bt.call<SessionInfo>('session:open', o),
    close: (id: string) => bt.call<void>('session:close', id),
    reconnect: (id: string) => bt.call<void>('session:reconnect', id)
  },
  sftp: {
    home: (id: string) => bt.call<string>('sftp:home', id),
    list: (id: string, path: string) => bt.call<{ path: string; entries: SftpEntry[] }>('sftp:list', id, path),
    mkdir: (id: string, path: string) => bt.call<void>('sftp:mkdir', id, path),
    rename: (id: string, a: string, b: string) => bt.call<void>('sftp:rename', id, a, b),
    remove: (id: string, paths: string[]) => bt.call<void>('sftp:remove', id, paths),
    chmod: (id: string, path: string, mode: number) => bt.call<void>('sftp:chmod', id, path, mode),
    upload: (id: string, locals: string[], dir: string) => bt.call<string[]>('sftp:upload', id, locals, dir),
    uploadPick: (id: string, dir: string) => bt.call<string[]>('sftp:uploadPick', id, dir),
    download: (id: string, remotes: string[], localDir?: string) => bt.call<string | false>('sftp:download', id, remotes, localDir),
    preview: (id: string, path: string) => bt.call<{ kind: 'image' | 'text'; data: string } | null>('sftp:preview', id, path),
    edit: (id: string, path: string) => bt.call<string>('sftp:edit', id, path),
    uploadForPrompt: (id: string, src: { kind: 'clipboardImage' } | { kind: 'files'; paths: string[] } | { kind: 'buffer'; name: string; data: Uint8Array }) =>
      bt.call<string[]>('sftp:uploadForPrompt', id, src)
  },
  clip: {
    info: () => bt.call<ClipboardInfo>('clip:info'),
    hasImage: () => bt.call<boolean>('clip:hasImage'),
    writeText: (t: string) => bt.call<void>('clip:writeText', t),
    readText: () => bt.call<string>('clip:readText')
  },
  dialog: {
    readKeyFile: () => bt.call<{ path: string; text: string } | null>('dialog:readKeyFile'),
    chooseDir: () => bt.call<string | null>('dialog:chooseDir')
  },
  importer: {
    scan: () => bt.call<ImportCandidate[]>('import:scan'),
    scanAws: (profile?: string) => bt.call<ImportCandidate[]>('import:scanAws', profile),
    apply: (c: ImportCandidate[], group: string) => bt.call<{ hosts: number; keys: number; skipped: string[] }>('import:apply', c, group)
  },
  serial: { list: () => bt.call<{ path: string; label: string }[]>('serial:list') },
  local: {
    shells: () => bt.call<{ path: string; label: string }[]>('local:shells'),
    saveForPrompt: (src: { kind: 'clipboardImage' } | { kind: 'files'; paths: string[] } | { kind: 'buffer'; name: string; data: Uint8Array }) =>
      bt.call<string[]>('local:saveForPrompt', src)
  },
  backup: {
    export: () => bt.call<string | false>('backup:export'),
    import: () => bt.call<boolean>('backup:import')
  },
  app: {
    info: () => bt.call<{ version: string; platform: string; dataDir: string }>('app:info'),
    titlebar: (bg: string, fg: string) => bt.call<void>('app:titlebar', bg, fg),
    openLogs: () => bt.call<void>('app:openLogs'),
    openLegal: (kind: 'license' | 'notices' | 'chromium') => bt.call<void>('app:openLegal', kind),
    openExternal: (u: string) => bt.call<void>('app:openExternal', u),
    toggleFullScreen: () => bt.call<void>('app:toggleFullScreen'),
    openBanner: (u: string) => bt.call<void>('app:openBanner', u)
  },
  ads: {
    get: () => bt.call<(Omit<Banner, 'image'> & { image: string })[]>('ads:get')
  }
}
