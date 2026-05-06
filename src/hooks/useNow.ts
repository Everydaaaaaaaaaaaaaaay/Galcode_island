import { useEffect, useState } from "react";

/// 周期性触发组件重渲染，让基于"当前时间"的衍生展示（"刚刚" / "N 分钟前"）保持新鲜。
/// React 不会自己感知墙上时钟流逝；不订阅这个 hook 的组件渲染一次后就把 Date.now()
/// 烧死在 JSX 里了。
///
/// 默认 30 秒：项目卡 / 历史卡的精度是分钟（"刚刚" / "X 分钟前" / "X 小时前"），30s 一刷
/// 让"刚刚 → 1 分钟前"过渡及时；CPU 几乎为零。窗口被隐藏（document.hidden）时停定时器，
/// 回到前台时立刻刷一次再续上，避免"上次更新留在 30 秒前"的尴尬。
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let timerId: number | undefined;
    const tick = (): void => setNow(Date.now());
    const start = (): void => {
      tick();
      timerId = window.setInterval(tick, intervalMs);
    };
    const stop = (): void => {
      if (timerId !== undefined) {
        window.clearInterval(timerId);
        timerId = undefined;
      }
    };
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [intervalMs]);

  return now;
}
