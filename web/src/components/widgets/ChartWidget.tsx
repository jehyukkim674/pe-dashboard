import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { theme } from 'antd';
import type { CommandResult } from '../../types';

interface Display { xKey?: string; yKey?: string | string[]; chartType?: 'line' | 'bar'; }

// 여러 시리즈를 구분할 색 팔레트
const PALETTE = ['#1677ff', '#52c41a', '#faad14', '#eb2f96', '#13c2c2', '#722ed1', '#fa541c'];

// 축 눈금 숫자를 짧게 (1234 → 1.2k, 3.4M …). 숫자가 아니면 그대로.
export function formatTick(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v ?? '');
  const abs = Math.abs(v);
  const trim = (n: number, suffix: string) => `${n.toFixed(1).replace(/\.0$/, '')}${suffix}`;
  if (abs >= 1e9) return trim(v / 1e9, 'B');
  if (abs >= 1e6) return trim(v / 1e6, 'M');
  if (abs >= 1e3) return trim(v / 1e3, 'k');
  return String(v);
}

// yKey는 단일 문자열·쉼표 구분 문자열·배열 모두 허용 (멀티 시리즈)
export function parseYKeys(yKey?: string | string[]): string[] {
  if (Array.isArray(yKey)) return yKey.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim());
  return (yKey ?? '').split(',').map((k) => k.trim()).filter(Boolean);
}

export default function ChartWidget({ result, display }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
}) {
  const { token } = theme.useToken();
  const d = (display ?? {}) as Display;
  const data = Array.isArray(result?.json) ? (result.json as Record<string, unknown>[]) : [];
  const yKeys = parseYKeys(d.yKey);
  if (!d.xKey || yKeys.length === 0) return <div>차트 설정(xKey/yKey)이 필요합니다</div>;

  // 다크/라이트 테마 토큰을 따라 축·격자·툴팁 색을 맞춘다 (기존엔 항상 다크 툴팁이었음)
  const tickStyle = { fill: token.colorTextSecondary, fontSize: 11 };
  const tooltipStyle = {
    background: token.colorBgElevated, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 6,
  };
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke={token.colorBorderSecondary} />
      <XAxis dataKey={d.xKey} tick={tickStyle} />
      <YAxis tick={tickStyle} tickFormatter={formatTick} width={44} />
      <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: token.colorText }} formatter={(v) => formatTick(v)} />
      {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
    </>
  );

  const chart = d.chartType === 'bar' ? (
    <BarChart data={data}>
      {axes}
      {yKeys.map((k, i) => <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} />)}
    </BarChart>
  ) : (
    <LineChart data={data}>
      {axes}
      {yKeys.map((k, i) => <Line key={k} dataKey={k} stroke={PALETTE[i % PALETTE.length]} dot={false} />)}
    </LineChart>
  );
  return <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>;
}
