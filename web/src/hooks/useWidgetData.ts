import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CommandResult, WidgetDataSource } from '../types';

export function useWidgetData(dataSource?: WidgetDataSource) {
  const [result, setResult] = useState<CommandResult>();
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const key = JSON.stringify(dataSource ?? null);

  useEffect(() => {
    if (!dataSource) return;
    let alive = true;
    let inFlight = false;
    const load = async (isBackground: boolean) => {
      if (inFlight) return; // 이전 호출이 끝나기 전 새 폴링 금지 (느린 명령 시 결과 역전 방지)
      inFlight = true;
      if (!isBackground) setLoading(true);
      try {
        const r = await api.widgetData(dataSource);
        if (alive) {
          setResult(r);
          setUpdatedAt(Date.now());
        }
      } catch (e) {
        if (alive) {
          setResult({
            ok: false, exitCode: null, stdout: '', stderr: '', error: (e as Error).message,
          });
          setUpdatedAt(Date.now());
        }
      } finally {
        inFlight = false;
        if (alive && !isBackground) setLoading(false);
      }
    };
    void load(false);
    const timer = dataSource.refreshSec
      ? setInterval(() => void load(true), dataSource.refreshSec * 1000)
      : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadTick]);

  // 수동 새로고침: effect를 재실행해 즉시 로드하고 폴링 타이머도 리셋한다
  const reload = () => setReloadTick((t) => t + 1);

  return { result, loading, reload, updatedAt };
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
  return `${Math.floor(sec / 3600)}시간 전`;
}
