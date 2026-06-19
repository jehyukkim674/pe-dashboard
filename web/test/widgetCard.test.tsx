import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import WidgetCard from '../src/components/WidgetCard';
import type { Widget } from '../src/types';
import * as apiModule from '../src/api';

const diagWidget: Widget = {
  id: 'w2',
  type: 'stat',
  title: '클러스터 상태',
  layout: { x: 0, y: 0, w: 4, h: 3 },
  dataSource: { kind: 'cli', commandId: 'cmd1', params: {} },
};

const textWidget: Widget = {
  id: 'w1',
  type: 'text',
  title: '메모',
  layout: { x: 0, y: 0, w: 4, h: 3 },
  display: { content: '오늘 배포 19시' },
};

describe('WidgetCard', () => {
  it('renders a text widget without a data source', () => {
    render(
      <WidgetCard
        widget={textWidget}
        onRemove={() => {}}
        onChangeRefresh={() => {}}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByText('메모')).toBeTruthy();
    expect(screen.getByText('오늘 배포 19시')).toBeTruthy();
    // 데이터 소스가 없으니 갱신 주기 select·새로고침은 없어야 한다
    expect(document.querySelector('.ant-select')).toBeNull();
    expect(document.querySelector('.anticon-reload')).toBeNull();
  });

  it('shows diagnosis label badge and hint when command fails with diagnosis', async () => {
    // api.widgetData를 모킹해 진단 정보가 포함된 실패 결과를 반환
    vi.spyOn(apiModule.api, 'widgetData').mockResolvedValue({
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Unauthorized',
      error: '재로그인이 필요합니다 — gh auth login / argocd login / kubeconfig 토큰 갱신',
      diagnosis: {
        category: 'auth_expired',
        label: '인증만료',
        hint: '재로그인이 필요합니다 — gh auth login / argocd login / kubeconfig 토큰 갱신',
      },
    });

    render(
      <WidgetCard
        widget={diagWidget}
        onRemove={() => {}}
        onChangeRefresh={() => {}}
        onEdit={() => {}}
        onDuplicate={() => {}}
      />,
    );

    // Alert 본문에 진단 배지('인증만료')와 조치 힌트가 표시되어야 한다
    expect(await screen.findByText('인증만료')).toBeTruthy();
    expect(screen.getByText(/재로그인이 필요합니다/)).toBeTruthy();

    vi.restoreAllMocks();
  });

  it('opens a fullscreen modal showing the widget content', () => {
    render(
      <WidgetCard
        widget={textWidget}
        onRemove={() => {}}
        onChangeRefresh={() => {}}
        onEdit={() => {}}
      />,
    );
    fireEvent.click(document.querySelector('.anticon-fullscreen')!);
    // 모달이 열리고 위젯 내용이 큰 화면에도 렌더된다 (제목 + 본문이 2곳)
    expect(document.querySelector('.ant-modal')).toBeTruthy();
    expect(screen.getAllByText('오늘 배포 19시').length).toBeGreaterThanOrEqual(2);
  });
});
