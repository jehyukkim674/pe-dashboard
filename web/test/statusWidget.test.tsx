import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import StatusWidget from '../src/components/widgets/StatusWidget';
import type { CommandResult } from '../src/types';

function rows(data: unknown[]): CommandResult {
  return { ok: true, exitCode: 0, stdout: '', stderr: '', json: data };
}

// 배경색을 rgb로 비교하기 위한 헬퍼 (jsdom은 hex를 rgb로 정규화한다)
const RED = 'rgb(255, 77, 79)';
const GREEN = 'rgb(82, 196, 26)';
const GRAY = 'rgb(140, 140, 140)';

describe('StatusWidget okValues 판정', () => {
  const display = { labelPath: 'name', statePath: 'status', okValues: 'Healthy,Synced' };

  it('okValues가 설정되면 정상은 초록, 나머지는 빨강', () => {
    const { container } = render(
      <StatusWidget
        result={rows([{ name: 'a', status: 'Healthy' }, { name: 'b', status: 'Degraded' }])}
        display={display}
      />,
    );
    const tiles = container.querySelectorAll('div[title]');
    expect((tiles[0] as HTMLElement).style.background).toBe(GREEN);
    expect((tiles[1] as HTMLElement).style.background).toBe(RED);
  });

  it('okValues 미설정이면 전부 빨강이 아니라 중립(회색)으로 표시한다', () => {
    // 이전에는 okValues가 비면 모든 타일이 빨강 = 거짓 전체장애 신호였다
    const { container } = render(
      <StatusWidget
        result={rows([{ name: 'a', status: 'Healthy' }, { name: 'b', status: 'Running' }])}
        display={{ labelPath: 'name', statePath: 'status' }}
      />,
    );
    const tiles = container.querySelectorAll('div[title]');
    expect(tiles).toHaveLength(2);
    for (const t of tiles) {
      expect((t as HTMLElement).style.background).toBe(GRAY);
    }
  });
});
