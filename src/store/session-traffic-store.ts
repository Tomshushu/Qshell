import { create } from "zustand";

export interface SessionTrafficStats {
  rxBytes: number;
  txBytes: number;
  rxRate: number;
  txRate: number;
  updatedAt: number;
}

interface SessionTrafficState {
  trafficBySession: Record<string, SessionTrafficStats>;
  activeSessionByTab: Record<string, string>;
  setTabActiveSession: (tabId: string, sessionId?: string) => void;
  updateTraffic: (
    sessionId: string,
    rxBytes: number,
    txBytes: number,
    now?: number,
  ) => void;
  decayStaleTraffic: (now?: number, maxAgeMs?: number) => void;
  clearSessionTraffic: (sessionId: string) => void;
  reset: () => void;
}

const ZERO_TRAFFIC: SessionTrafficStats = {
  rxBytes: 0,
  txBytes: 0,
  rxRate: 0,
  txRate: 0,
  updatedAt: 0,
};

/**
 * 运行期全协议终端流量遥测状态（仅内存态，不持久化）。
 * 由后端 `session:traffic` 事件每 500ms 驱动，供 StatusBar 轻量呈现。
 */
export const useSessionTrafficStore = create<SessionTrafficState>((set) => ({
  trafficBySession: {},
  activeSessionByTab: {},

  setTabActiveSession: (tabId, sessionId) => {
    if (!tabId) return;
    set((state) => {
      if (!sessionId) {
        if (!(tabId in state.activeSessionByTab)) return state;
        const next = { ...state.activeSessionByTab };
        delete next[tabId];
        return { activeSessionByTab: next };
      }
      if (state.activeSessionByTab[tabId] === sessionId) return state;
      return {
        activeSessionByTab: {
          ...state.activeSessionByTab,
          [tabId]: sessionId,
        },
      };
    });
  },

  updateTraffic: (sessionId, rxBytes, txBytes, now = Date.now()) => {
    if (!sessionId) return;
    set((state) => {
      const prev = state.trafficBySession[sessionId];
      if (!prev) {
        return {
          trafficBySession: {
            ...state.trafficBySession,
            [sessionId]: {
              rxBytes: Math.max(0, rxBytes),
              txBytes: Math.max(0, txBytes),
              rxRate: 0,
              txRate: 0,
              updatedAt: now,
            },
          },
        };
      }
      const elapsedSec = Math.max((now - prev.updatedAt) / 1000, 0.25);
      const rxDelta = Math.max(0, rxBytes - prev.rxBytes);
      const txDelta = Math.max(0, txBytes - prev.txBytes);
      return {
        trafficBySession: {
          ...state.trafficBySession,
          [sessionId]: {
            rxBytes: Math.max(0, rxBytes),
            txBytes: Math.max(0, txBytes),
            rxRate: rxDelta / elapsedSec,
            txRate: txDelta / elapsedSec,
            updatedAt: now,
          },
        },
      };
    });
  },

  decayStaleTraffic: (now = Date.now(), maxAgeMs = 1500) => {
    set((state) => {
      let changed = false;
      const next: Record<string, SessionTrafficStats> = {
        ...state.trafficBySession,
      };
      for (const [sid, entry] of Object.entries(state.trafficBySession)) {
        if (
          (entry.rxRate > 0 || entry.txRate > 0) &&
          now - entry.updatedAt > maxAgeMs
        ) {
          next[sid] = { ...entry, rxRate: 0, txRate: 0 };
          changed = true;
        }
      }
      return changed ? { trafficBySession: next } : state;
    });
  },

  clearSessionTraffic: (sessionId) => {
    if (!sessionId) return;
    set((state) => {
      if (!(sessionId in state.trafficBySession)) return state;
      const next = { ...state.trafficBySession };
      delete next[sessionId];
      return { trafficBySession: next };
    });
  },

  reset: () => set({ trafficBySession: {}, activeSessionByTab: {} }),
}));

export function getEmptySessionTraffic(): SessionTrafficStats {
  return ZERO_TRAFFIC;
}
