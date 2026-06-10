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
    const load = async () => {
      setLoading(true);
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
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = dataSource.refreshSec
      ? setInterval(load, dataSource.refreshSec * 1000)
      : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { result, loading };
}
