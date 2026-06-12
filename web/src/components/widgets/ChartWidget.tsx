import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CommandResult } from '../../types';

interface Display { xKey?: string; yKey?: string; chartType?: 'line' | 'bar'; }

export default function ChartWidget({ result, display }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
}) {
  const d = (display ?? {}) as Display;
  const data = Array.isArray(result?.json) ? (result.json as Record<string, unknown>[]) : [];
  if (!d.xKey || !d.yKey) return <div>차트 설정(xKey/yKey)이 필요합니다</div>;

  const chart = d.chartType === 'bar' ? (
    <BarChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.25)" />
      <XAxis dataKey={d.xKey} tick={{ fill: 'rgba(128,128,128,0.9)', fontSize: 11 }} /><YAxis tick={{ fill: 'rgba(128,128,128,0.9)', fontSize: 11 }} /><Tooltip />
      <Bar dataKey={d.yKey} fill="#1677ff" />
    </BarChart>
  ) : (
    <LineChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.25)" />
      <XAxis dataKey={d.xKey} tick={{ fill: 'rgba(128,128,128,0.9)', fontSize: 11 }} /><YAxis tick={{ fill: 'rgba(128,128,128,0.9)', fontSize: 11 }} /><Tooltip />
      <Line dataKey={d.yKey} stroke="#1677ff" dot={false} />
    </LineChart>
  );
  return <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>;
}
