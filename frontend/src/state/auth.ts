import { create } from "zustand";
import { api, setCsrf } from "../api/client";

export interface User {
  id: string;
  email: string;
  display_name: string;
}

interface AuthState {
  user: User | null;
  ready: boolean;
  allowRegistration: boolean;
  load: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

type AuthPayload = { user: User; csrf_token: string };

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  allowRegistration: true,
  load: async () => {
    try {
      const cfg = await api<{ allow_registration: boolean }>("/api/auth/config");
      set({ allowRegistration: cfg.allow_registration });
    } catch {
      /* server unreachable: shown on the sign-in page */
    }
    try {
      const me = await api<AuthPayload>("/api/auth/me");
      setCsrf(me.csrf_token);
      set({ user: me.user, ready: true });
    } catch {
      set({ user: null, ready: true });
    }
  },
  login: async (email, password) => {
    const r = await api<AuthPayload>("/api/auth/login", { method: "POST", json: { email, password } });
    setCsrf(r.csrf_token);
    set({ user: r.user });
  },
  register: async (email, password, display_name) => {
    const r = await api<AuthPayload>("/api/auth/register", { method: "POST", json: { email, password, display_name } });
    setCsrf(r.csrf_token);
    set({ user: r.user });
  },
  logout: async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setCsrf("");
      set({ user: null });
    }
  },
}));
