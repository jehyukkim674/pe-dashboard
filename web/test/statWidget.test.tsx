import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import StatWidget from '../src/components/widgets/StatWidget';
import type { CommandResult } from '../src/types';

function countResult(n: number): CommandResult {
  return { ok: true, exitCode: 0, stdout: '', stderr: '', json: Array.from({ length: n }) };
}

describe('StatWidget sparkline/trend persistence', () => {
  beforeEach(() => localStorage.clear());

  it('records numeric values per poll into localStorage keyed by widget id', () => {
    const { rerender } = render(
      <StatWidget result={countResult(3)} display={{ metric: 'count' }} widgetId="w1" updatedAt={1000} />,
    );
    rerender(<StatWidget result={countResult(5)} display={{ metric: 'count' }} widgetId="w1" updatedAt={2000} />);

    const series = JSON.parse(localStorage.getItem('pe-spark-w1') ?? '[]') as { t: number; v: number }[];
    expect(series.map((p) => p.v)).toEqual([3, 5]);
  });

  it('does not double-record the same poll tick', () => {
    const { rerender } = render(
      <StatWidget result={countResult(3)} display={{ metric: 'count' }} widgetId="w2" updatedAt={1000} />,
    );
    // 같은 updatedAt으로 다시 렌더(부모 리렌더) — 점이 늘어나면 안 된다
    rerender(<StatWidget result={countResult(3)} display={{ metric: 'count' }} widgetId="w2" updatedAt={1000} />);

    const series = JSON.parse(localStorage.getItem('pe-spark-w2') ?? '[]') as unknown[];
    expect(series).toHaveLength(1);
  });

  it('restores prior series from localStorage on remount (survives reload)', () => {
    localStorage.setItem('pe-spark-w3', JSON.stringify([{ t: 1, v: 10 }, { t: 2, v: 7 }]));
    const { container } = render(
      <StatWidget result={countResult(7)} display={{ metric: 'count' }} widgetId="w3" updatedAt={2} />,
    );
    // 직전 두 점(10→7)으로 추세(-3) 화살표가 즉시 보여야 한다
    expect(container.querySelector('.anticon-arrow-down')).toBeTruthy();
    expect(container.querySelector('svg polyline')).toBeTruthy();
  });

  it('renders nothing trend-related without a widget id (backward compatible)', () => {
    const { container } = render(<StatWidget result={countResult(3)} display={{ metric: 'count' }} />);
    expect(container.querySelector('svg polyline')).toBeNull();
  });

  it('비유한값(Infinity)은 수치로 기록하지 않는다(스파크라인 오염 방지)', () => {
    const infResult: CommandResult = { ok: true, exitCode: 0, stdout: 'Infinity', stderr: '' };
    render(<StatWidget result={infResult} display={{}} widgetId="w-inf" updatedAt={1000} />);
    const series = JSON.parse(localStorage.getItem('pe-spark-w-inf') ?? '[]') as unknown[];
    expect(series).toHaveLength(0);
  });
});
