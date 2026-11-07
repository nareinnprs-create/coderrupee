import { CLOSE_TO_TRAY_ENABLED_KEY } from "./store-keys"

type SettingStore = {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

// Mirrors the pinch-zoom setting: an electron-store read where anything but a
// stored `true` means the default, which is that closing the window quits.
export function createCloseToTraySetting(store: SettingStore) {
  return {
    get: () => store.get(CLOSE_TO_TRAY_ENABLED_KEY) === true,
    set: (enabled: boolean) => store.set(CLOSE_TO_TRAY_ENABLED_KEY, enabled),
  }
}
