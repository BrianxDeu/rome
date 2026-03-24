import { create } from "zustand";
import type { PublicUser } from "@rome/shared";

interface AuthState {
  token: string | null;
  user: PublicUser | null;
  setAuth: (token: string, user: PublicUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("rome_token"),
  user: (() => {
    const raw = localStorage.getItem("rome_user");
    return raw ? JSON.parse(raw) : null;
  })(),
  setAuth: (token, user) => {
    localStorage.setItem("rome_token", token);
    localStorage.setItem("rome_user", JSON.stringify(user));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem("rome_token");
    localStorage.removeItem("rome_user");
    set({ token: null, user: null });
  },
}));
