import { useSyncExternalStore } from 'react';

// 모든 위젯 폴링을 한 곳에서 제어하는 전역 스토어.
// - paused: 켜면 위젯들이 자동 새로고침 예약을 멈춘다 (TV·배터리 절약, 디버깅)
// - nonce: refreshAll()이 올리면 모든 위젯이 즉시 1회 새로고침한다 (일시정지 중에도 1회)
interface PollState {
  paused: boolean;
  nonce: number;
}

let state: PollState = { paused: false, nonce: 0 };
const listeners = new Set<() => void>();

function set(patch: Partial<PollState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const pollControl = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): PollState {
    return state;
  },
  togglePause(): void {
    set({ paused: !state.paused });
  },
  refreshAll(): void {
    set({ nonce: state.nonce + 1 });
  },
};

export function usePollControl(): PollState {
  return useSyncExternalStore(pollControl.subscribe, pollControl.getSnapshot, pollControl.getSnapshot);
}
