// 局域网访问设置面板的本地状态。
//
// 后端通过 lan_get_state 返回完整的 LanStateInfo（含端口、URLs、设备列表、是否启用），
// 这里 store 仅作前端缓存：节流避免 SettingsModal 频繁拉；保存设置时先 invoke 修改后再
// refresh 回填。密码不放 store —— 只在 LanAccessPanel 内部 useState 暂存避免泄露。

import { create } from "zustand";
import { invoke } from "../lib/bridge";

export interface LanDeviceInfo {
  label: string;
  createdAt: number;
  expiresAt: number;
  tokenPreview: string;
}

export interface LanStateInfo {
  enabled: boolean;
  running: boolean;
  port: number;
  runningPort: number | null;
  hasPassword: boolean;
  urls: string[];
  interfaces: string[];
  devices: LanDeviceInfo[];
}

interface LanStore {
  state: LanStateInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setPassword: (password: string) => Promise<void>;
  clearPassword: () => Promise<void>;
  setPort: (port: number) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  revokeAll: () => Promise<void>;
}

export const useLanStore = create<LanStore>((set, get) => ({
  state: null,
  loading: false,
  error: null,

  refresh: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const s = await invoke<LanStateInfo>("lan_get_state");
      set({ state: s, error: null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  setPassword: async (password) => {
    set({ loading: true });
    try {
      const s = await invoke<LanStateInfo>("lan_set_password", { password });
      set({ state: s, error: null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  clearPassword: async () => {
    set({ loading: true });
    try {
      const s = await invoke<LanStateInfo>("lan_clear_password");
      set({ state: s, error: null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  setPort: async (port) => {
    set({ loading: true });
    try {
      const s = await invoke<LanStateInfo>("lan_set_port", { port });
      set({ state: s, error: null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  setEnabled: async (enabled) => {
    set({ loading: true });
    try {
      const s = await invoke<LanStateInfo>("lan_set_enabled", { enabled });
      set({ state: s, error: null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },

  revokeAll: async () => {
    set({ loading: true });
    try {
      const s = await invoke<LanStateInfo>("lan_revoke_all_devices");
      set({ state: s, error: null, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
      throw e;
    }
  },
}));
