import { create } from 'zustand'
import {
  applyUITheme,
  getStoredUITheme,
  applyThemeWithoutTransitions,
  postUserTheme,
  setUIThemeStateSetter,
  UI_THEME_STORAGE_KEY,
  type UITheme,
} from '@/lib/uiTheme'

/**
 * Who asked for the change - this decides persistence (the action does it):
 * - "user": an explicit choice (settings page); always written, even if the
 *   state already equals it (a stale tab must still publish the choice).
 * - "document": applied programmatically; written only on a change.
 * - "remote": followed from another document; never written.
 */
export type ThemeSource = 'user' | 'document' | 'remote'

interface UIThemeState {
  uiTheme: UITheme
  setUITheme: (theme: UITheme, opts?: { source?: ThemeSource }) => void
  toggleUITheme: () => void
}

function persistTheme(theme: UITheme, source: ThemeSource, changed: boolean) {
  if (source === 'remote') return
  if (source === 'user' || changed) localStorage.setItem(UI_THEME_STORAGE_KEY, theme)
  if (source === 'user') postUserTheme(theme)
}

export const useUIThemeStore = create<UIThemeState>((set, get) => {
  const initial = getStoredUITheme()
  applyUITheme(initial)
  return {
    uiTheme: initial,
    setUITheme: (theme, opts) => {
      const source = opts?.source ?? 'document'
      const prev = get().uiTheme
      set({ uiTheme: theme })
      persistTheme(theme, source, theme !== prev)
    },
    toggleUITheme: () => {
      const next = get().uiTheme === 'light' ? 'dark' : 'light'
      set({ uiTheme: next })
      persistTheme(next, 'user', true)
    },
  }
})

useUIThemeStore.subscribe((state, prev) => {
  if (state.uiTheme !== prev.uiTheme) {
    applyThemeWithoutTransitions(state.uiTheme)
  } else {
    applyUITheme(state.uiTheme)
  }
})

// Remote themes (see installUIThemeStorageSync) follow without persisting.
setUIThemeStateSetter((theme) => useUIThemeStore.getState().setUITheme(theme, { source: 'remote' }))
