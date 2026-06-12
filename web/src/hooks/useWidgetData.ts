import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CommandResult, WidgetDataSource } from '../types';

export function useWidgetData(dataSource?: WidgetDataSource) {
  const [result, setResult] = useState<CommandResult>();
  const [lastGood, setLastGood] = useState<CommandResult>(); // 실패 시에도 직전 정상 데이터를 보여주기 위함
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const key = JSON.stringify(dataSource ?? null);

  useEffect(() => {
    if (!dataSource) return;
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // setTimeout 체인: 이전 호출이 끝난 뒤에만 다음을 예약하므로 겹침이 없고,
    // 연속 실패 시 백오프로 간격을 늘릴 수 있다 (수동 새로고침은 reloadTick으로 리셋)
    const schedule = () => {
      if (!alive || !dataSource.refreshSec) return;
      const delaySec = backoffDelaySec(dataSource.refreshSec, failures);
      timer = setTimeout(() => void load(true), delaySec * 1000);
    };

    const load = async (isBackground: boolean) => {
      if (!isBackground) setLoading(true);
      try {
        const r = await api.widgetData(dataSource);
        failures = r.ok ? 0 : failures + 1;
        if (alive) {
          setResult(r);
          if (r.ok) setLastGood(r);
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
    void load(false);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadTick]);

  // 수동 새로고침: effect를 재실행해 즉시 로드하고 폴링 타이머도 리셋한다
  const reload = () => setReloadTick((t) => t + 1);

  return { result, lastGood, loading, reload, updatedAt };
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
  return `${Math.floor(sec / 3600)}시간 전`;
}
