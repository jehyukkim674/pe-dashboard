import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import WidgetCard from '../src/components/WidgetCard';
import type { Widget } from '../src/types';

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
});
