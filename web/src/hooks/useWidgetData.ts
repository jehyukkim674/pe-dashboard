import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CommandResult, WidgetDataSource } from '../types';
import { usePollControl } from './pollControl';

export function useWidgetData(dataSource?: WidgetDataSource) {
  const [result, setResult] = useState<CommandResult>();
  const [lastGood, setLastGood] = useState<CommandResult>(); // 실패 시에도 직전 정상 데이터를 보여주기 위함
  const [updatedAt, setUpdatedAt] = useState<number>(); // 마지막 시도 시각
  const [lastGoodAt, setLastGoodAt] = useState<number>(); // 마지막 성공 시각 (신선도 판정용)
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const { paused, nonce } = usePollControl();
  const key = JSON.stringify(dataSource ?? null);

  const pausedRef = useRef(paused);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!dataSource) return;
    let alive = true;
    let failures = 0;
    const isNewSource = prevKeyRef.current !== key;
    prevKeyRef.current = key;

    // setTimeout 체인: 이전 호출이 끝난 뒤에만 다음을 예약하므로 겹침이 없고,
    // 연속 실패 시 백오프로 간격을 늘린다. 탭이 가려졌거나(document.hidden)
    // 전역 일시정지(pausedRef) 상태면 예약하지 않는다.
    const schedule = () => {
      if (!alive || !dataSource.refreshSec || document.hidden || pausedRef.current) return;
      const delaySec = backoffDelaySec(dataSource.refreshSec, failures);
      timerRef.current = setTimeout(() => void load(true), delaySec * 1000);
    };

    const load = async (isBackground: boolean) => {
      if (!isBackground) setLoading(true);
      try {
        const r = await api.widgetData(dataSource);
        failures = r.ok ? 0 : failures + 1;
        if (alive) {
          setResult(r);
          if (r.ok) {
            setLastGood(r);
            setLastGoodAt(Date.now());
          }
          setUpdatedAt(Date.now());
        }
      } catch (e) {
        failures++;
        if (alive) {
          setResult({
            ok: false, exitCode: null, stdout: '', stderr: '', error: (e as Error).message,
          });
          setUpdatedAt(Date.now());
        }
      } finally {
        if (alive && !isBackground) setLoading(false);
        schedule();
      }
    };
    // 탭이 가려지면 대기 중 타이머를 멈추고, 다시 보이면 즉시 1회 새로고침 후 재개
    const onVisibility = () => {
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = undefined;
      } else if (dataSource.refreshSec && !pausedRef.current) {
        void load(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // 새 소스/최초 마운트는 스피너와 함께, 전역 새로고침(nonce)·수동(reloadTick) 재실행은 백그라운드로
    void load(!isNewSource);
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadTick, nonce]);

  // 전역 일시정지 토글: 켜면 대기 타이머 중단, 끄면 즉시 재개(effect 재실행 유도)
  const didMountRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (paused) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = undefined;
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReloadTick((t) => t + 1);
    }
  }, [paused]);

  // 수동 새로고침: effect를 재실행해 즉시 로드하고 폴링 타이머도 리셋한다
  const reload = () => setReloadTick((t) => t + 1);

  return { result, lastGood, loading, reload, updatedAt, lastGoodAt };
}

// 연속 실패 시 지수 백오프: 기본 주기 × 2^실패횟수, 최대 5분.
// 실패하는 명령(로그아웃된 argocd 등)을 의미 없이 계속 두드리지 않는다.
export function backoffDelaySec(baseSec: number, failures: number): number {
  if (failures === 0) return baseSec;
  return Math.min(baseSec * 2 ** Math.min(failures, 10), 300);
}

// 상대 시각 표시용 현재 시각. intervalMs마다 리렌더를 유발한다.
export function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function relativeTime(from: number, now: number): string {
  const sec = Math.max(0, Math.round((now - from) / 1000));
  if (sec < 10) return '방금';
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}시간 전`;
  return `${Math.floor(sec / 86_400)}일 전`;
}
