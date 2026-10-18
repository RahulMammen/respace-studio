import { create } from "zustand";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
  action?: { label: string; run: () => void };
}

interface UIState {
  toasts: Toast[];
  toast: (text: string, tone?: Toast["tone"], action?: Toast["action"]) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useUI = create<UIState>((set, get) => ({
  toasts: [],
  toast: (text, tone = "info", action) => {
    const id = seq++;
    set({ toasts: [...get().toasts.slice(-2), { id, text, tone, action }] });
    setTimeout(() => get().dismiss(id), tone === "error" ? 7000 : 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, tone?: Toast["tone"], action?: Toast["action"]) =>
  useUI.getState().toast(text, tone, action);

const PREFS_KEY = "respace.prefs.v1";

export interface Prefs {
  lowQuality: boolean;
  onboardingDone: boolean;
  showWalkway: boolean;
  showDimensions: boolean;
}

const defaultPrefs: Prefs = { lowQuality: false, onboardingDone: false, showWalkway: true, showDimensions: true };

export function loadPrefs(): Prefs {
  try {
    return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return defaultPrefs;
  }
}

export const usePrefs = create<Prefs & { set: (p: Partial<Prefs>) => void }>((set) => ({
  ...loadPrefs(),
  set: (p) =>
    set((s) => {
      const next = { ...s, ...p };
      try {
        const { set: _drop, ...plain } = next as Prefs & { set?: unknown };
        void _drop;
        localStorage.setItem(PREFS_KEY, JSON.stringify(plain));
      } catch {
        /* storage unavailable: keep in memory */
      }
      return next;
    }),
}));
