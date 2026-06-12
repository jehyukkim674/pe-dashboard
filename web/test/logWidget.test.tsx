import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LogWidget from '../src/components/widgets/LogWidget';
import type { CommandResult } from '../src/types';

const result: CommandResult = {
  ok: true, exitCode: 0, stderr: '',
  stdout: 'alpha first line\nbeta second line\ngamma third line',
};

describe('LogWidget', () => {
  it('filters lines by search and highlights matches', () => {
    const { container } = render(<LogWidget result={result} />);
    expect(container.querySelector('pre')?.textContent).toContain('alpha first line');

    fireEvent.change(screen.getByPlaceholderText('검색'), { target: { value: 'BETA' } });
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('beta second line');
    expect(pre?.textContent).not.toContain('alpha');
    // 일치 부분 하이라이트 + 매치 줄 수 표시
    expect(container.querySelector('mark')?.textContent).toBe('beta');
    expect(screen.getByText('1줄')).toBeTruthy();
  });

  it('has a follow-bottom toggle button (default on)', () => {
    const { container } = render(<LogWidget result={result} />);
    const btn = () => container.querySelector('button.ant-btn');
    expect(btn()?.className).toContain('ant-btn-primary');
    fireEvent.click(btn() as Element);
    expect(btn()?.className).not.toContain('ant-btn-primary');
  });
});
