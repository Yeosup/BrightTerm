import { useEffect } from 'react'
import { useApp } from './state'
import { api } from './api'
import { wireData, applySettingsToAll, getEntry, refocusTerminal } from './terms'
import { panes, findPane, neighbour } from './layout'
import { actionOf, modKey, type Action } from './platform'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { RightPanel, PreviewDialog } from './components/RightPanel'
import { StatusBar } from './components/StatusBar'
import { LockScreen } from './components/LockScreen'
import { HostEditor, GroupEditor } from './components/HostEditor'
import { QuickConnect } from './components/QuickConnect'
import { SettingsDialog } from './components/SettingsDialog'
import { ImportDialog } from './components/ImportDialog'
import { UiRequestDialog } from './components/UiRequestDialog'
import { ContextMenu, Toasts, ConfirmDialog, PromptDialog } from './components/ui'

function useGlobalWiring(): void {
  useEffect(() => {
    wireData()
    const offs = [
      api.on.state((info) => {
        useApp.setState((s) => (s.sessions[info.id] ? { sessions: { ...s.sessions, [info.id]: info } } : {}))
        if (info.state === 'connected' && useApp.getState().focusedSession()?.id === info.id) refocusTerminal()
      }),
      api.on.request((r) => useApp.setState((s) => ({ requests: [...s.requests, r] }))),
      api.on.transfer((t) => useApp.setState((s) => ({ transfers: { ...s.transfers, [t.id]: t } }))),
      api.on.vault(async () => {
        useApp.setState({ vault: await api.vault.status() })
        useApp.getState().refreshCreds()
      }),
      api.on.storeChanged(() => useApp.getState().reloadStore()),
      api.on.toast((t) => useApp.getState().toast(t.kind, t.text))
    ]
    return () => offs.forEach((f) => f())
  }, [])
}

/** Run an app command; shared by the keyboard handler and the macOS menu bar. */
export function runAction(a: Action): boolean {
  const st = useApp.getState()
  if (!st.vault.unlocked && st.vault.initialized) return false
  if (st.dialog && st.dialog.kind !== 'quick' && a !== 'fullscreen') return false
  const tab = st.tabs.find((t) => t.id === st.activeTab)
  const fp = tab ? findPane(tab.root, tab.focused) : undefined
  switch (a) {
    case 'quick': useApp.setState({ dialog: st.dialog?.kind === 'quick' ? null : { kind: 'quick' } }); break
    case 'quickOpen': useApp.setState({ dialog: { kind: 'quick' } }); break
    case 'localTerm': if (st.dialog?.kind === 'quick') useApp.setState({ dialog: null }); st.openAdhoc({ host: '', protocol: 'local' }); break
    case 'closePane': if (fp) st.closePane(fp.id); break
    case 'splitRight': st.duplicatePane('row'); break
    case 'splitDown': st.duplicatePane('col'); break
    case 'zoom': if (tab && fp && panes(tab.root).length > 1) st.updateTab(tab.id, { zoomed: tab.zoomed ? null : fp.id }); break
    case 'find': if (fp) window.dispatchEvent(new CustomEvent('bt:find', { detail: fp.sessionId })); break
    case 'sftp': useApp.setState({ rightPanel: st.rightPanel === 'sftp' ? null : 'sftp' }); break
    case 'broadcast': if (tab && panes(tab.root).length > 1) { st.updateTab(tab.id, { broadcast: !tab.broadcast }); st.toast('info', tab.broadcast ? '동시 입력 꺼짐' : '동시 입력 켜짐 — 이 탭의 모든 패널에 입력됩니다') } break
    case 'sidebar': useApp.setState({ sidebar: !st.sidebar }); break
    case 'moveTabLeft':
    case 'moveTabRight': {
      const i = st.tabs.findIndex((t) => t.id === st.activeTab)
      const j = a === 'moveTabLeft' ? i - 1 : i + 1
      if (i >= 0 && j >= 0 && j < st.tabs.length) st.moveTab(i, j)
      break
    }
    case 'nextTab':
    case 'prevTab': {
      const i = st.tabs.findIndex((t) => t.id === st.activeTab)
      if (st.tabs.length) st.setActiveTab(st.tabs[(i + (a === 'prevTab' ? -1 : 1) + st.tabs.length) % st.tabs.length].id)
      break
    }
    case 'paneLeft': case 'paneRight': case 'paneUp': case 'paneDown':
      if (tab && fp) {
        const n = neighbour(panes(tab.root).map((p) => p.id), fp.id, a.slice(4).toLowerCase() as 'left' | 'right' | 'up' | 'down')
        if (n) st.focusPane(tab.id, n)
      }
      break
    case 'fontUp': st.setSettings({ fontSize: Math.min(32, st.settings.fontSize + 1) }); break
    case 'fontDown': st.setSettings({ fontSize: Math.max(8, st.settings.fontSize - 1) }); break
    case 'fontReset': st.setSettings({ fontSize: 14 }); break
    case 'settings': useApp.setState({ dialog: { kind: 'settings' } }); break
    case 'import': useApp.setState({ dialog: { kind: 'import' } }); break
    case 'fullscreen': api.app.toggleFullScreen(); break
    default: {
      const n = /^tab([1-9])$/.exec(a)
      if (!n) return false
      const t = n[1] === '9' ? st.tabs[st.tabs.length - 1] : st.tabs[+n[1] - 1]
      if (t) st.setActiveTab(t.id)
    }
  }
  return true
}

function useShortcuts(): void {
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const a = actionOf(e)
      if (a && runAction(a)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', h)
    const offMenu = api.on.menu((a) => runAction(a as Action))
    const wheel = (e: WheelEvent): void => {
      // ctrlKey is also what a trackpad pinch reports on macOS
      if (!e.ctrlKey && !modKey(e)) return
      const st = useApp.getState()
      if (!(e.target as HTMLElement)?.closest?.('.pane-body')) return
      e.preventDefault()
      st.setSettings({ fontSize: Math.max(8, Math.min(32, st.settings.fontSize + (e.deltaY < 0 ? 1 : -1))) })
    }
    window.addEventListener('wheel', wheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', h)
      window.removeEventListener('wheel', wheel)
      offMenu()
    }
  }, [])
}

export default function App(): JSX.Element {
  const loaded = useApp((s) => s.loaded)
  const vault = useApp((s) => s.vault)
  const settings = useApp((s) => s.settings)
  const sidebar = useApp((s) => s.sidebar)
  const dialog = useApp((s) => s.dialog)
  const tabsCount = useApp((s) => s.tabs.length)
  useGlobalWiring()
  useShortcuts()

  useEffect(() => { useApp.getState().init() }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    const cs = getComputedStyle(document.documentElement)
    api.app.titlebar(cs.getPropertyValue('--bg').trim() || '#0f1115', cs.getPropertyValue('--text-2').trim() || '#c9d1d9')
  }, [settings.theme])

  useEffect(() => { applySettingsToAll(settings) }, [settings.fontFamily, settings.fontSize, settings.lineHeight, settings.cursorStyle, settings.cursorBlink, settings.scrollback, settings.terminalTheme])

  // try OS auto-unlock at startup (Windows DPAPI / macOS Keychain + Touch ID)
  useEffect(() => {
    if (loaded && vault.initialized && !vault.unlocked && vault.osUnlockEnabled && tabsCount === 0) {
      api.vault.unlockOs().then(async (ok) => { if (ok) useApp.setState({ vault: await api.vault.status() }) })
    }
  }, [loaded])

  // first run: offer PuTTY / ssh config import
  useEffect(() => {
    if (!loaded || !vault.unlocked) return
    const st = useApp.getState()
    let asked = false
    try { asked = localStorage.getItem('bt.importOffered') === '1' } catch { /* */ }
    if (st.hosts.length === 0 && !asked) {
      try { localStorage.setItem('bt.importOffered', '1') } catch { /* */ }
      api.importer.scan().then((c) => { if (c.length) useApp.setState({ dialog: { kind: 'import' } }) })
    }
  }, [loaded, vault.unlocked])

  // focus terminal again after dialogs close
  useEffect(() => {
    if (dialog) return
    refocusTerminal()
  }, [dialog])

  if (!loaded) return <div className="app" />
  const locked = !vault.unlocked

  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        {sidebar && <Sidebar />}
        <main className="main">
          <Workspace />
        </main>
        <RightPanel />
      </div>
      <StatusBar />
      {dialog?.kind === 'host' && <HostEditor host={dialog.host} groupId={dialog.groupId} />}
      {dialog?.kind === 'group' && <GroupEditor group={dialog.group} parentId={dialog.parentId} />}
      {dialog?.kind === 'quick' && <QuickConnect />}
      {dialog?.kind === 'settings' && <SettingsDialog section={dialog.section} />}
      {dialog?.kind === 'import' && <ImportDialog />}
      {dialog?.kind === 'preview' && <PreviewDialog sessionId={dialog.sessionId} path={dialog.path} />}
      <UiRequestDialog />
      <ConfirmDialog />
      <PromptDialog />
      <ContextMenu />
      <Toasts />
      {locked && <LockScreen overlay={tabsCount > 0} />}
    </div>
  )
}
