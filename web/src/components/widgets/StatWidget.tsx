import { Statistic } from 'antd';
import type { CommandResult } from '../../types';

interface Display { metric?: 'count' | 'path'; path?: string; suffix?: string; }

function resolvePath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    obj,
  );
}

export default function StatWidget({ result, display }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
}) {
  const d = (display ?? {}) as Display;
  let value: unknown = '—';
  if (result?.json !== undefined) {
    if (d.metric === 'path' && d.path) value = resolvePath(result.json, d.path);
    else if (Array.isArray(result.json)) value = result.json.length;
    else value = JSON.stringify(result.json).slice(0, 30);
  } else if (result) {
    value = result.stdout.trim().split('\n')[0] || '—';
  }
  return <Statistic value={String(value ?? '—')} suffix={d.suffix} />;
}
