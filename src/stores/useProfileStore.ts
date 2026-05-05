// 个人档案 —— 用户基本信息，独立于"应用设置 / LLM 配置"。
// 包含字段：
//   - nickname：希望团长（凉宫春日）怎样称呼你；后端 LLM 系统提示用作个性化
//   - gender：male / female / other / undisclosed
//   - age：18-/18-25/26-35/36-45/46+；用枚举不存具体年龄保护隐私
//   - mbti：4 字符 MBTI 类型 ENFP/INTJ/...，"unknown" 表示未填
//
// 这些字段当前主要靠 nickname 真正影响 LLM 输出（system prompt 拼接）；
// 其他字段先持久化备用，未来可让凉宫春日按性格类型调语气。

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Gender = "male" | "female" | "other" | "undisclosed";
export type AgeBand = "under18" | "18-25" | "26-35" | "36-45" | "46plus" | "undisclosed";

/// 16 种标准 MBTI + "unknown"。下拉选项用这个穷举。
export const MBTI_TYPES = [
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP",
] as const;
export type MbtiType = typeof MBTI_TYPES[number] | "unknown";

interface ProfileState {
  nickname: string;
  gender: Gender;
  ageBand: AgeBand;
  mbti: MbtiType;
  /// 自我介绍（多行文本）
  bio: string;
  /// Modal 开合
  isProfileModalOpen: boolean;

  setNickname: (v: string) => void;
  setGender: (v: Gender) => void;
  setAgeBand: (v: AgeBand) => void;
  setMbti: (v: MbtiType) => void;
  setBio: (v: string) => void;
  openProfileModal: () => void;
  closeProfileModal: () => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      nickname: "",
      gender: "undisclosed",
      ageBand: "undisclosed",
      mbti: "unknown",
      bio: "",
      isProfileModalOpen: false,

      setNickname: (nickname) => set({ nickname }),
      setGender: (gender) => set({ gender }),
      setAgeBand: (ageBand) => set({ ageBand }),
      setMbti: (mbti) => set({ mbti }),
      setBio: (bio) => set({ bio }),
      openProfileModal: () => set({ isProfileModalOpen: true }),
      closeProfileModal: () => set({ isProfileModalOpen: false }),
    }),
    {
      name: "agent-profile-storage",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        ({
          nickname: state.nickname,
          gender: state.gender,
          ageBand: state.ageBand,
          mbti: state.mbti,
          bio: state.bio,
        }) as ProfileState,
      // 旧版本 nickname 在 useSettingsStore 里。第一次 rehydrate 时如果 profile
      // 自身 nickname 为空，从老 settings 存储里读一份过来做迁移（不动 settings
      // 那边以保留兼容；后续再做清理）。
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!state.nickname.trim()) {
          try {
            const raw = localStorage.getItem("agent-settings-storage");
            if (raw) {
              const parsed = JSON.parse(raw) as { state?: { nickname?: string } };
              const legacy = parsed.state?.nickname;
              if (legacy && legacy.trim()) state.nickname = legacy;
            }
          } catch {
            /* localStorage 解析失败：忽略 */
          }
        }
      },
    },
  ),
);
