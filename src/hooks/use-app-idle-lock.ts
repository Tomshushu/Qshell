import { useEffect, useRef } from "react";
import { useAppStore } from "@/store";

/**
 * 空闲无操作自动锁屏 Hook（Termius 风格）
 * 当开启应用锁且配置了空闲时间时，定时监测用户物理交互，超时自动锁定整个客户端
 */
export function useAppIdleLock() {
  const lastActivityRef = useRef<number>(Date.now());

  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
    };

    // 监听用户常见活动事件（使用 passive 模式以保障性能）
    const events = ["mousedown", "keydown", "wheel", "touchstart", "pointerdown"];
    events.forEach((evt) => {
      window.addEventListener(evt, handleActivity, { passive: true });
    });

    // 节流监听 mousemove，每 2 秒最多刷新一次
    let lastMoveTime = 0;
    const handleMouseMove = () => {
      const now = Date.now();
      if (now - lastMoveTime > 2000) {
        lastMoveTime = now;
        lastActivityRef.current = now;
      }
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    // 定时器检测是否超时（每 5 秒轮询一次）
    const interval = setInterval(() => {
      const {
        appLockEnabled,
        appLockPasswordHash,
        appLockIdleMinutes,
        isAppLocked,
        lockApp,
      } = useAppStore.getState();

      if (
        !appLockEnabled ||
        !appLockPasswordHash ||
        appLockIdleMinutes <= 0 ||
        isAppLocked
      ) {
        return;
      }

      const idleMs = Date.now() - lastActivityRef.current;
      const timeoutMs = appLockIdleMinutes * 60 * 1000;

      if (idleMs >= timeoutMs) {
        lockApp();
      }
    }, 5000);

    return () => {
      events.forEach((evt) => {
        window.removeEventListener(evt, handleActivity);
      });
      window.removeEventListener("mousemove", handleMouseMove);
      clearInterval(interval);
    };
  }, []);
}
