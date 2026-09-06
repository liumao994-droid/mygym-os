import { create } from 'zustand'
import { getAppState, setAppState } from '@/db/db'

export type Unit = 'kg' | 'lb'
export type ThemeMode = 'dark' | 'light' | 'system'

export interface Settings {
  unit: Unit
  theme: ThemeMode
  remindersEnabled: boolean
  nickname: string
}

interface SettingsStore extends Settings {
  hydrated: boolean
  hydrate: () => Promise<void>
  setUnit: (u: Unit) => Promise<void>
  setTheme: (t: ThemeMode) => Promise<void>
  setReminders: (on: boolean) => Promise<void>
  setNickname: (n: string) => Promise<void>
}

export const useSettings = create<SettingsStore>((set) => ({
  unit: 'kg',
  theme: 'dark',
  remindersEnabled: true,
  nickname: '',
  hydrated: false,
  hydrate: async () => {
    const [unit, theme, remindersEnabled, nickname] = await Promise.all([
      getAppState<Unit>('unit', 'kg'),
      getAppState<ThemeMode>('theme', 'dark'),
      getAppState<boolean>('remindersEnabled', true),
      getAppState<string>('nickname', ''),
    ])
    set({ unit, theme, remindersEnabled, nickname, hydrated: true })
    applyTheme(theme)
  },
  setUnit: async (unit) => {
    set({ unit })
    await setAppState('unit', unit)
  },
  setTheme: async (theme) => {
    set({ theme })
    await setAppState('theme', theme)
    applyTheme(theme)
  },
  setReminders: async (remindersEnabled) => {
    set({ remindersEnabled })
    await setAppState('remindersEnabled', remindersEnabled)
  },
  setNickname: async (nickname) => {
    set({ nickname })
    await setAppState('nickname', nickname)
  },
}))

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
  const light = mode === 'light' || (mode === 'system' && prefersLight)
  root.classList.toggle('light', light)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', light ? '#f5efea' : '#081331')
}

/* ---------------- Toast ---------------- */

export interface Toast {
  id: number
  text: string
  kind?: 'ok' | 'error' | 'info'
}

interface ToastStore {
  toasts: Toast[]
  push: (text: string, kind?: Toast['kind']) => void
  remove: (id: number) => void
}

let toastSeq = 1

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (text, kind = 'info') => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2600)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function toast(text: string, kind?: Toast['kind']) {
  useToasts.getState().push(text, kind)
}
