// 个人档案弹窗：nickname / 性别 / 年龄段 / MBTI 等基本信息。
//
// 当前唯一会真正影响 LLM 输出的是 nickname（拼到后端 system prompt）；
// 其他字段先持久化备用，未来可让凉宫春日按用户性格调整语气。
//
// 保存时同步 nickname 给后端 update_llm_settings —— 跟 SettingsModal 的
// 保存路径一致，避免下次启动 App.tsx 同步前 nickname 跟后端不同步。

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import {
  MBTI_TYPES,
  useProfileStore,
  type AgeBand,
  type Gender,
  type MbtiType,
} from "../../stores/useProfileStore";
import { useSettingsStore } from "../../stores/useSettingsStore";

const inputCls =
  "rounded-lg border border-black/5 bg-white/50 px-3 py-2 text-sm text-zinc-800 outline-none transition-all focus:border-sky-400/50 focus:bg-white/80 focus:ring-2 focus:ring-sky-400/15 dark:border-white/5 dark:bg-slate-800/50 dark:text-zinc-100 dark:focus:border-sky-400/40 dark:focus:bg-slate-800/70 dark:focus:ring-sky-400/10";

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "undisclosed", label: "不愿透露" },
  { value: "female", label: "女" },
  { value: "male", label: "男" },
  { value: "other", label: "其他" },
];

const AGE_OPTIONS: { value: AgeBand; label: string }[] = [
  { value: "undisclosed", label: "不愿透露" },
  { value: "under18", label: "18 岁以下" },
  { value: "18-25", label: "18 – 25" },
  { value: "26-35", label: "26 – 35" },
  { value: "36-45", label: "36 – 45" },
  { value: "46plus", label: "46 岁及以上" },
];

export function ProfileModal(): JSX.Element {
  const isOpen = useProfileStore((s) => s.isProfileModalOpen);
  const close = useProfileStore((s) => s.closeProfileModal);

  const nickname = useProfileStore((s) => s.nickname);
  const gender = useProfileStore((s) => s.gender);
  const ageBand = useProfileStore((s) => s.ageBand);
  const mbti = useProfileStore((s) => s.mbti);
  const bio = useProfileStore((s) => s.bio);

  const setNickname = useProfileStore((s) => s.setNickname);
  const setGender = useProfileStore((s) => s.setGender);
  const setAgeBand = useProfileStore((s) => s.setAgeBand);
  const setMbti = useProfileStore((s) => s.setMbti);
  const setBio = useProfileStore((s) => s.setBio);

  // 同步给后端 LLM system prompt 时还需要这些
  const apiBaseUrl = useSettingsStore((s) => s.apiBaseUrl);
  const apiKey = useSettingsStore((s) => s.apiKey);
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const provider = useSettingsStore((s) => s.provider);
  const model = useSettingsStore((s) => s.model);
  const thinking = useSettingsStore((s) => s.thinking);
  const translateInput = useSettingsStore((s) => s.translateInput);

  const [localNickname, setLocalNickname] = React.useState(nickname);
  const [localGender, setLocalGender] = React.useState<Gender>(gender);
  const [localAgeBand, setLocalAgeBand] = React.useState<AgeBand>(ageBand);
  const [localMbti, setLocalMbti] = React.useState<MbtiType>(mbti);
  const [localBio, setLocalBio] = React.useState(bio);

  React.useEffect(() => {
    if (isOpen) {
      setLocalNickname(nickname);
      setLocalGender(gender);
      setLocalAgeBand(ageBand);
      setLocalMbti(mbti);
      setLocalBio(bio);
    }
  }, [isOpen, nickname, gender, ageBand, mbti, bio]);

  const handleSave = async (): Promise<void> => {
    setNickname(localNickname);
    setGender(localGender);
    setAgeBand(localAgeBand);
    setMbti(localMbti);
    setBio(localBio);
    // nickname 影响后端 LLM system prompt，立即同步一次（其他字段当前不影响后端）
    try {
      await invoke("update_llm_settings", {
        baseUrl: apiBaseUrl,
        apiKey,
        nickname: localNickname,
        systemPrompt,
        provider,
        model,
        thinking,
        translateInput,
      });
    } catch (e) {
      console.error("Failed to sync profile nickname to Rust", e);
    }
    close();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <React.Fragment>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-black/30 backdrop-blur-sm"
            onClick={close}
          />

          <div className="fixed inset-0 z-[210] flex items-center justify-center pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="pointer-events-auto flex max-h-[85vh] w-[92%] max-w-md flex-col rounded-2xl border border-white/60 bg-white/70 shadow-[0_20px_60px_rgba(0,0,0,0.12)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-800/60 dark:shadow-none"
            >
              <div className="flex items-center justify-between border-b border-black/5 px-6 py-4 dark:border-white/5">
                <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">个人档案</h2>
              </div>

              <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    希望团长怎样称呼你？
                  </label>
                  <input
                    type="text"
                    value={localNickname}
                    onChange={(e) => setLocalNickname(e.target.value)}
                    placeholder="例如：部员 / 阿虚"
                    className={inputCls}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">性别</label>
                    <select
                      value={localGender}
                      onChange={(e) => setLocalGender(e.target.value as Gender)}
                      className={inputCls}
                    >
                      {GENDER_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">年龄段</label>
                    <select
                      value={localAgeBand}
                      onChange={(e) => setLocalAgeBand(e.target.value as AgeBand)}
                      className={inputCls}
                    >
                      {AGE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">MBTI</label>
                  <select
                    value={localMbti}
                    onChange={(e) => setLocalMbti(e.target.value as MbtiType)}
                    className={inputCls}
                  >
                    <option value="unknown">未填 / 不清楚</option>
                    {MBTI_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                    自我介绍
                  </label>
                  <textarea
                    value={localBio}
                    onChange={(e) => setLocalBio(e.target.value)}
                    placeholder="兴趣 / 职业 / 习惯，想让团长知道的都可以填……"
                    className={`${inputCls} h-28 resize-y`}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-black/5 px-6 py-3 dark:border-white/5">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg px-4 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  className="rounded-lg bg-sky-500 px-4 py-1.5 text-sm font-semibold text-white shadow-md shadow-sky-400/25 transition-colors hover:bg-sky-600"
                >
                  保存
                </button>
              </div>
            </motion.div>
          </div>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
}
