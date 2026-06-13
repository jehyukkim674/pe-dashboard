import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UpdateModal from '../src/components/UpdateModal';

afterEach(() => {
  delete (window as { appUpdater?: unknown }).appUpdater;
});

function mockUpdater(over: Partial<Record<string, unknown>> = {}) {
  const updater = {
    check: vi.fn().mockResolvedValue({
      kind: 'available', currentVersion: '0.17.0', version: '0.18.0', notes: '<p>새 기능</p>',
    }),
    install: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn(),
    onProgress: vi.fn().mockReturnValue(() => {}),
    ...over,
  };
  (window as { appUpdater?: unknown }).appUpdater = updater;
  return updater;
}

describe('UpdateModal restart flow', () => {
  it('shows a restart button after download completes and calls restart()', async () => {
    const updater = mockUpdater();
    render(<UpdateModal manualCheckCount={1} />);

    // 업데이트 가능 모달이 뜨고 '업데이트' 버튼이 보인다
    const goBtn = await screen.findByText('업데이트');
    fireEvent.click(goBtn);

    // 다운로드(install) 완료 후 '지금 재시작' 버튼이 나타난다
    const restartBtn = await screen.findByText('지금 재시작');
    expect(updater.install).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/다운로드 완료/)).toBeTruthy();

    fireEvent.click(restartBtn);
    expect(updater.restart).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error and hides progress if install fails', async () => {
    mockUpdater({ install: vi.fn().mockRejectedValue(new Error('네트워크 끊김')) });
    render(<UpdateModal manualCheckCount={1} />);
    fireEvent.click(await screen.findByText('업데이트'));

    // 실패 시 '지금 재시작'은 나타나지 않고 '업데이트' 버튼이 유지된다
    await waitFor(() => expect(screen.queryByText('지금 재시작')).toBeNull());
    expect(screen.getByText('업데이트')).toBeTruthy();
  });
});
