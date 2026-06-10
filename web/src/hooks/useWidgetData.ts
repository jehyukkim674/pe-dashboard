import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CommandResult, WidgetDataSource } from '../types';

export function useWidgetData(dataSource?: WidgetDataSource) {
  const [result, setResult] = useState<CommandResult>();
  const [loading, setLoading] = useState(false);
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
        if (alive) setResult(r);
      } catch (e) {
        if (alive) {
          setResult({
            ok: false, exitCode: null, stdout: '', stderr: '', error: (e as Error).message,
          });
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
  }, [key]);

  return { result, loading };
}
