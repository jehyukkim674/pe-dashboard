import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TableWidget from '../src/components/widgets/TableWidget';
import type { CommandResult } from '../src/types';

const result: CommandResult = {
  ok: true, exitCode: 0, stdout: '', stderr: '',
  json: [
    { name: 'argo-workflow', status: 'Synced' },
    { name: 'api-server', status: 'OutOfSync' },
    { name: 'web-front', status: 'Synced' },
  ],
};

describe('TableWidget', () => {
  it('search input filters rows across columns (case-insensitive)', () => {
    render(<TableWidget result={result} />);
    expect(screen.getByText('argo-workflow')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('검색'), { target: { value: 'OUTOF' } });
    expect(screen.queryByText('argo-workflow')).toBeNull();
    expect(screen.getByText('api-server')).toBeTruthy();

    // 검색어를 지우면 전체 행 복귀
    fireEvent.change(screen.getByPlaceholderText('검색'), { target: { value: '' } });
    expect(screen.getByText('argo-workflow')).toBeTruthy();
  });

  it('shows a column filter menu for low-cardinality columns', () => {
    const { container } = render(<TableWidget result={result} />);
    // status 컬럼(Synced/OutOfSync 2종)에는 필터 트리거가 생긴다
    expect(container.querySelector('.ant-table-filter-trigger')).toBeTruthy();
  });

  it('applies saved column widths from display.columnWidths', () => {
    const { container } = render(
      <TableWidget result={result} display={{ columnWidths: { name: 200, status: 90 } }} />,
    );
    const cols = container.querySelectorAll('colgroup col');
    expect(Array.from(cols).map((c) => (c as HTMLElement).style.width)).toContain('200px');
  });

  it('renders status words as colored tags', () => {
    const { container } = render(<TableWidget result={result} />);
    const tags = Array.from(container.querySelectorAll('.ant-tag')).map((t) => t.textContent);
    expect(tags).toContain('Synced');
    expect(tags).toContain('OutOfSync');
  });

  it('shows displayed/total counter while searching', () => {
    render(<TableWidget result={result} />);
    fireEvent.change(screen.getByPlaceholderText('검색'), { target: { value: 'outof' } });
    expect(screen.getByText('3건 중 1건 표시')).toBeTruthy();
  });

  it('hides columns listed in display.hiddenColumns', () => {
    render(<TableWidget result={result} display={{ hiddenColumns: ['status'] }} />);
    expect(screen.queryByText('status')).toBeNull();
    expect(screen.getByText('name')).toBeTruthy();
  });

  it('applies persisted column filters from display.columnFilters', () => {
    render(<TableWidget result={result} display={{ columnFilters: { status: ['Synced'] } }} />);
    expect(screen.getByText('argo-workflow')).toBeTruthy();
    expect(screen.queryByText('api-server')).toBeNull();
  });

  it('opens row detail modal on row click', () => {
    render(<TableWidget result={result} />);
    fireEvent.click(screen.getByText('api-server'));
    expect(screen.getByText('행 상세')).toBeTruthy();
  });

  it('reorders columns by header drag and drop', () => {
    const onDisplayChange = vi.fn();
    const { container } = render(
      <TableWidget result={result} display={{}} onDisplayChange={onDisplayChange} />,
    );
    const ths = container.querySelectorAll('thead th');
    // name 헤더를 status 헤더 위에 떨어뜨리면 순서가 [status, name]이 된다
    const data: Record<string, string> = {};
    const dataTransfer = {
      setData: (t: string, v: string) => { data[t] = v; },
      getData: (t: string) => data[t] ?? '',
      effectAllowed: '',
    };
    fireEvent.dragStart(ths[0], { dataTransfer });
    fireEvent.drop(ths[1], { dataTransfer });
    expect(onDisplayChange).toHaveBeenCalledTimes(1);
    expect(onDisplayChange.mock.calls[0][0].columnOrder).toEqual(['status', 'name']);
  });

  it('persists resized widths via onDisplayChange on drag end', () => {
    const onDisplayChange = vi.fn();
    const { container } = render(
      <TableWidget result={result} display={{}} onDisplayChange={onDisplayChange} />,
    );
    // 첫 번째 헤더(name)의 리사이즈 핸들을 30px 드래그
    const handle = container.querySelector('th span[style*="col-resize"]');
    expect(handle).toBeTruthy();
    fireEvent.mouseDown(handle as Element, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 130 });
    fireEvent.mouseUp(document, { clientX: 130 });

    expect(onDisplayChange).toHaveBeenCalledTimes(1);
    const saved = onDisplayChange.mock.calls[0][0] as { columnWidths: Record<string, number> };
    // jsdom은 offsetWidth가 0이라 기본 120 스냅샷에서 +30
    expect(saved.columnWidths.name).toBe(150);
    expect(saved.columnWidths.status).toBe(120);
  });
});
