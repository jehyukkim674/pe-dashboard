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
  const text =
    typeof value === 'object' && value !== null
      ? JSON.stringify(value).slice(0, 30)
      : String(value ?? '—');
  // 숫자 하나가 주인공인 위젯 — 카드 중앙에 크게
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Statistic
        value={text}
        suffix={d.suffix}
        valueStyle={{ fontSize: 34, fontWeight: 600, lineHeight: 1.1 }}
      />
    </div>
  );
}
