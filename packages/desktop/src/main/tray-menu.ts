export type TrayMenuState = {
  /** Whether any app window is currently visible. */
  windowVisible: boolean
  /** Whether the updater is enabled for this build. */
  updaterEnabled: boolean
}

export type TrayMenuActions = {
  showWindow: () => void
  hideWindow: () => void
  newSession: () => void
  checkForUpdates: () => void
  quit: () => void
}

export type TrayMenuLabels = {
  show: string
  hide: string
  newSession: string
  checkForUpdates: string
  quit: string
}

export type TrayMenuItem =
  | { id: "visibility"; label: string; enabled: true; onPick: () => void }
  | { id: "newSession"; label: string; enabled: true; onPick: () => void }
  | { id: "checkForUpdates"; label: string; enabled: boolean; onPick: () => void }
  | { type: "separator" }
  | { id: "quit"; label: string; enabled: true; onPick: () => void }

// Pure so the tray stays unit-testable without electron. The first item flips
// between hide/show based on window visibility, mirroring tray conventions.
export function buildTrayMenu(state: TrayMenuState, labels: TrayMenuLabels, actions: TrayMenuActions): TrayMenuItem[] {
  return [
    state.windowVisible
      ? { id: "visibility", label: labels.hide, enabled: true, onPick: actions.hideWindow }
      : { id: "visibility", label: labels.show, enabled: true, onPick: actions.showWindow },
    { id: "newSession", label: labels.newSession, enabled: true, onPick: actions.newSession },
    {
      id: "checkForUpdates",
      label: labels.checkForUpdates,
      enabled: state.updaterEnabled,
      onPick: actions.checkForUpdates,
    },
    { type: "separator" },
    { id: "quit", label: labels.quit, enabled: true, onPick: actions.quit },
  ]
}
