import { useEffect, useState } from 'react';
import { Statistic } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import type { CommandResult } from '../../types';

interface Display { metric?: 'count' | 'path'; path?: string; suffix?: string; }

// 추세선에 보관하는 최근 수치 개수 (위젯당 localStorage ~1KB)
const MAX_POINTS = 40;

interface Point { t: number; v: number; }

function resolvePath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    obj,
  );
}

function loadSeries(key: string): Point[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '[]') as Point[];
    return Array.isArray(arr) ? arr.filter((p) => typeof p?.v === 'number') : [];
  } catch {
    return [];
  }
}

// 최근 수치 추이를 작은 SVG 꺾은선으로. 카드 폭에 맞춰 가로로 늘어난다(stroke는 일정 두께 유지).
// 색은 기존 추세 화살표와 같은 규칙(증가=빨강 — 실패/장애 카운트가 늘면 나쁨 가정).
function Sparkline({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const lastN = points.length - 1;
  const path = points.map((p, i) => `${i},${(100 - ((p.v - min) / span) * 100).toFixed(2)}`).join(' ');
  const rising = vals[vals.length - 1] >= vals[0];
  return (
    <svg
      viewBox={`0 0 ${lastN} 100`} preserveAspectRatio="none"
      style={{ width: '100%', maxWidth: 180, height: 28, marginTop: 4 }}
    >
      <polyline
        points={path} fill="none" strokeWidth={1.5}
        stroke={rising ? '#cf1322' : '#3f8600'} vectorEffect="non-scaling-stroke"
        strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  );
}

export default function StatWidget({ result, display, widgetId, updatedAt }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
  widgetId?: string; // 추세 저장 키 (없으면 추세/스파크라인 비활성)
  updatedAt?: number; // 폴링 시각 — 같은 값이라도 1회당 1점 기록하기 위함
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
  const num = Number(text);
  const isNum = text !== '' && !Number.isNaN(num);

  // 폴링마다 수치를 링버퍼에 누적·영구 저장 (리로드해도 추세 유지).
  // 마지막 점의 폴링 시각(updatedAt)으로 중복을 막아, 리로드 직후 같은 틱을 또 기록하지 않는다.
  const storeKey = widgetId ? `pe-spark-${widgetId}` : undefined;
  const [series, setSeries] = useState<Point[]>(() => (storeKey ? loadSeries(storeKey) : []));
  useEffect(() => {
    if (!storeKey || !isNum || updatedAt == null) return;
    // 외부 폴링 신호(updatedAt)를 추세 상태에 누적하는 동기화 — 같은 틱이면 prev 그대로라 재렌더 없음
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeries((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.t === updatedAt) return prev;
      return [...prev, { t: updatedAt, v: num }].slice(-MAX_POINTS);
    });
  }, [storeKey, isNum, num, updatedAt]);
  useEffect(() => {
    if (!storeKey || series.length === 0) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify(series));
    } catch (e) {
      console.error('추세 저장 실패', e);
    }
  }, [storeKey, series]);

  const delta =
    series.length >= 2 ? series[series.length - 1].v - series[series.length - 2].v : undefined;

  // 숫자 하나가 주인공인 위젯 — 카드 중앙에 크게
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <Statistic
        value={text}
        suffix={d.suffix}
        valueStyle={{ fontSize: 34, fontWeight: 600, lineHeight: 1.1 }}
      />
      {delta !== undefined && delta !== 0 && (
        <span style={{ fontSize: 12, color: delta > 0 ? '#cf1322' : '#3f8600' }}>
          {delta > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(delta)}
        </span>
      )}
      <Sparkline points={series} />
    </div>
  );
}
