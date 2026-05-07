// 「关于」弹窗的 open/close 状态。
// 跟 useSettingsStore.isSettingsModalOpen / useProfileStore.isProfileModalOpen
// 同款独立 store —— 让 SidebarLeft 的菜单项能直接 useAboutStore.openAboutModal()，
// 而不需要把所有 modal 状态塞到一个全局 store 里。

import { create } from "zustand";

interface AboutStoreState {
  isOpen: boolean;
  openAboutModal: () => void;
  closeAboutModal: () => void;
}

export const useAboutStore = create<AboutStoreState>((set) => ({
  isOpen: false,
  openAboutModal: () => set({ isOpen: true }),
  closeAboutModal: () => set({ isOpen: false }),
}));
