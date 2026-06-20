import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Dropdown, Input, Modal, Popover, Table, Tag, Tooltip, message } from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, DownloadOutlined, SearchOutlined, SettingOutlined,
} from '@ant-design/icons';
import type { TableProps } from 'antd';
import type { CommandResult } from '../../types';
import { relativeTime, useNow } from '../../hooks/useWidgetData';
import type { TablePrefs } from './tableFormat';
import {
  cellText, compare, orderColumns, parseIsoTimestamp, readTablePrefs, statusColor, TABLE_PREF_KEYS, valueAt,
} from './tableFormat';
import { asRows } from '../../utils/commandResult';

// 고유값이 적은 컬럼만 필터 메뉴 제공 (해시·이름처럼 전부 제각각이면 검색이 낫다)
const MAX_FILTER_OPTIONS = 50;
const MIN_COLUMN_WIDTH = 60;
// 이 행 수를 넘으면 가상 스크롤로 전환 (전 행 DOM 렌더 회피)
const VIRTUAL_THRESHOLD = 100;
const VIRTUAL_COL_WIDTH = 160; // 가상 모드에서 폭 미지정 컬럼의 기본 폭

// 커스텀 헤더 th: 오른쪽 가장자리 드래그로 폭 조절 + 헤더 자체 드래그로 컬럼 순서 이동.
// 폭 조절 핸들은 mousedown preventDefault로 드래그 이동·정렬 클릭과 분리된다.
interface ResizableThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  onResizeStart?: (e: React.MouseEvent) => void;
  colKey?: string;
  onReorder?: (srcKey: string, dstKey: string) => void;
}

function ResizableTh({ onResizeStart, colKey, onReorder, style, children, ...rest }: ResizableThProps) {
  const dragProps: React.ThHTMLAttributes<HTMLTableCellElement> =
    colKey && onReorder
      ? {
          draggable: true,
          onDragStart: (e) => {
            e.dataTransfer.setData('text/plain', colKey);
            e.dataTransfer.effectAllowed = 'move';
          },
          onDragOver: (e) => e.preventDefault(),
          onDrop: (e) => {
            e.preventDefault();
            const src = e.dataTransfer.getData('text/plain');
            if (src) onReorder(src, colKey);
          },
        }
      : {};
  return (
    <th {...rest} {...dragProps} style={{ ...style, position: 'relative' }}>
      {children}
      {onResizeStart && (
        <span
          onMouseDown={onResizeStart}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 8,
            cursor: 'col-resize', zIndex: 1, userSelect: 'none',
          }}
        />
      )}
    </th>
  );
}

// 셀 값 렌더: 상태 단어는 색 태그, ISO 타임스탬프는 상대 시각(호버에 원본), 객체는 JSON
function renderCell(v: unknown, now: number) {
  const text = cellText(v);
  const color = statusColor(text);
  if (color) return <Tag color={color} style={{ marginInlineEnd: 0 }}>{text}</Tag>;
  const ts = parseIsoTimestamp(text);
  if (ts != null) return <span title={text}>{relativeTime(ts, now)}</span>;
  return text;
}

function computeFilterOptions(rows: Record<string, unknown>[], key: string) {
  const values = [...new Set(rows.map((row) => cellText(valueAt(row, key))))].sort();
  if (values.length < 2 || values.length > MAX_FILTER_OPTIONS) return undefined;
  return values.map((v) => ({ text: v === '' ? '(빈 값)' : v, value: v }));
}

// CSV 셀 이스케이프: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표는 2배
function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function TableWidget({ result, display, onDisplayChange }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
  onDisplayChange?: (display: Record<string, unknown>) => void;
}) {
  const rows = useMemo(() => asRows(result), [result]);
  const rawCols = display?.columns;
  const baseColumns = useMemo<string[]>(
    () =>
      Array.isArray(rawCols) && rawCols.every((c) => typeof c === 'string')
        ? (rawCols as string[])
        : Object.keys(rows[0] ?? {}),
    [rawCols, rows],
  );

  const [search, setSearch] = useState('');
  const [detailRow, setDetailRow] = useState<Record<string, unknown>>();
  // 사용자 설정(폭·필터·정렬·숨김·순서): 저장값으로 시작하고 변경 즉시 로컬 반영 + display로 저장
  const [prefs, setPrefs] = useState<TablePrefs>(() => readTablePrefs(display));
  const wrapRef = useRef<HTMLDivElement>(null);
  const now = useNow(30_000);

  const persist = (next: TablePrefs) => {
    if (!onDisplayChange) return;
    const d: Record<string, unknown> = { ...display };
    for (const key of TABLE_PREF_KEYS) delete d[key];
    if (Object.keys(next.widths).length > 0) d.columnWidths = next.widths;
    if (Object.keys(next.filters).length > 0) d.columnFilters = next.filters;
    if (next.sort) d.columnSort = next.sort;
    if (next.hidden.length > 0) d.hiddenColumns = next.hidden;
    if (next.order?.length) d.columnOrder = next.order;
    onDisplayChange(d);
  };
  const update = (patch: Partial<TablePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    persist(next);
  };

  const orderedColumns = useMemo(
    () => orderColumns(baseColumns, prefs.order),
    [baseColumns, prefs.order],
  );
  const columns = useMemo(
    () => orderedColumns.filter((c) => !prefs.hidden.includes(c)),
    [orderedColumns, prefs.hidden],
  );
  // 필터 후보는 검색·정렬과 무관하므로 행/컬럼이 바뀔 때만 다시 계산 (검색 입력 시 렉 방지)
  const filterOptionsByKey = useMemo(
    () => new Map(columns.map((key) => [key, computeFilterOptions(rows, key)] as const)),
    [columns, rows],
  );

  const startResize = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 처음 조절하는 순간 모든 컬럼의 현재 렌더 폭을 스냅샷해서 나머지가 출렁이지 않게 고정
    const base = { ...prefs.widths };
    if (columns.some((c) => base[c] == null)) {
      const ths = wrapRef.current?.querySelectorAll<HTMLElement>('thead th') ?? [];
      columns.forEach((c, i) => { base[c] ??= ths[i]?.offsetWidth || 120; });
    }
    const startX = e.clientX;
    const startW = base[key];
    const clamp = (w: number) => Math.max(MIN_COLUMN_WIDTH, w);
    const widthsAt = (clientX: number) => ({ ...base, [key]: clamp(startW + clientX - startX) });
    const onMove = (ev: MouseEvent) => setPrefs((cur) => ({ ...cur, widths: widthsAt(ev.clientX) }));
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      update({ widths: widthsAt(ev.clientX) });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const matchesFilter = (row: Record<string, unknown>, key: string, value: unknown) =>
    cellText(valueAt(row, key)) === value;

  // 상단 검색: 보이는 컬럼 중 하나라도 검색어를 포함하는 행만 (대소문자 무시)
  const q = search.trim().toLowerCase();
  const searchedRows = useMemo(
    () =>
      q
        ? rows.filter((row) => columns.some((key) => cellText(valueAt(row, key)).toLowerCase().includes(q)))
        : rows,
    [rows, columns, q],
  );

  // 실제 테이블에 적용되는 필터만(숨김·옵션소멸 컬럼 제외) — antd 동작과 일치시켜 카운터/내보내기에 사용
  const activeFilters = useMemo(
    () => Object.entries(prefs.filters).filter(([key]) => filterOptionsByKey.get(key) != null),
    [prefs.filters, filterOptionsByKey],
  );
  // 화면에 실제 보이는 행(검색+필터+정렬) — 카운터와 CSV/복사 내보내기가 공유
  const displayedRows = useMemo(() => {
    const filtered = searchedRows.filter((row) =>
      activeFilters.every(([key, values]) => values.some((v) => matchesFilter(row, key, v))),
    );
    if (!prefs.sort) return filtered;
    const { key, order } = prefs.sort;
    const dir = order === 'ascend' ? 1 : -1;
    return [...filtered].sort((a, b) => dir * compare(a, b, key));
  }, [searchedRows, activeFilters, prefs.sort]);

  // 필터·정렬 변경을 display에 저장해 다시 열어도 유지한다
  const handleTableChange: TableProps<Record<string, unknown>>['onChange'] = (_p, filters, sorter) => {
    const nextFilters: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(filters)) {
      if (Array.isArray(values) && values.length > 0) nextFilters[key] = values.map(String);
    }
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const sort = single?.order && single.columnKey != null
      ? { key: String(single.columnKey), order: single.order }
      : undefined;
    update({ filters: nextFilters, sort });
  };

  const toggleHidden = (key: string, visible: boolean) => {
    const hidden = visible ? prefs.hidden.filter((c) => c !== key) : [...prefs.hidden, key];
    // 전부 숨기면 테이블이 비어버리므로 마지막 한 개는 남긴다
    if (hidden.length >= orderedColumns.length) return;
    update({ hidden });
  };

  const moveColumn = (key: string, dir: -1 | 1) => {
    const order = [...orderedColumns];
    const i = order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    update({ order });
  };

  // 헤더 드래그앤드롭: 끌어온 컬럼을 떨어뜨린 컬럼 자리에 삽입
  const reorderColumn = (srcKey: string, dstKey: string) => {
    if (srcKey === dstKey) return;
    const order = [...orderedColumns];
    const from = order.indexOf(srcKey);
    const to = order.indexOf(dstKey);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, ...order.splice(from, 1));
    update({ order });
  };

  // 현재 화면 행을 구분자 텍스트로 (보이는 컬럼·순서 유지)
  const exportCsv = () => {
    const lines = [
      columns.map(csvCell).join(','),
      ...displayedRows.map((row) => columns.map((key) => csvCell(cellText(valueAt(row, key)))).join(',')),
    ];
    // Excel이 한글을 UTF-8로 읽도록 BOM(\uFEFF) 추가
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `table-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyTsv = () => {
    const text = [
      columns.join('\t'),
      ...displayedRows.map((row) => columns.map((key) => cellText(valueAt(row, key)).replace(/\t/g, ' ')).join('\t')),
    ].join('\n');
    navigator.clipboard.writeText(text)
      .then(() => void message.success(`${displayedRows.length}행 복사됨`))
      .catch((e) => {
        console.error('클립보드 복사 실패', e);
        void message.error('복사에 실패했습니다');
      });
  };

  const columnSettings = (
    <div style={{ maxHeight: 280, overflow: 'auto' }}>
      {orderedColumns.map((key, i) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Checkbox
            checked={!prefs.hidden.includes(key)}
            onChange={(e) => toggleHidden(key, e.target.checked)}
            style={{ flex: 1, fontSize: 12 }}
          >
            {key}
          </Checkbox>
          <Button
            type="text" size="small" icon={<ArrowUpOutlined />} disabled={i === 0}
            onClick={() => moveColumn(key, -1)}
          />
          <Button
            type="text" size="small" icon={<ArrowDownOutlined />} disabled={i === orderedColumns.length - 1}
            onClick={() => moveColumn(key, 1)}
          />
        </div>
      ))}
    </div>
  );

  // 큰 테이블만 가상 스크롤: 스크롤 컨테이너(.widget-body) 높이를 재서 내부 스크롤 높이로 쓴다
  const big = displayedRows.length > VIRTUAL_THRESHOLD;
  const [viewH, setViewH] = useState(0);
  useEffect(() => {
    const el = wrapRef.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // ResizeObserver는 observe 직후 1회 콜백하므로 초기 측정도 여기서 처리된다
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 가상 모드에선 antd가 컬럼 폭을 요구하므로 미지정 컬럼에 기본 폭을 준다
  const colWidth = (key: string) => prefs.widths[key] ?? (big ? VIRTUAL_COL_WIDTH : undefined);
  const hasWidths = columns.some((c) => colWidth(c) != null);
  const totalWidth = hasWidths ? columns.reduce((sum, c) => sum + (colWidth(c) ?? 120), 0) : undefined;
  const virtual = big && viewH > 0;
  const scroll = virtual
    ? { y: Math.max(160, viewH - (rows.length > 0 ? 44 : 0)), x: totalWidth ?? columns.length * VIRTUAL_COL_WIDTH }
    : totalWidth != null ? { x: totalWidth } : undefined;

  return (
    <div ref={wrapRef}>
      {(rows.length > 0 || q !== '') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Input
            size="small" allowClear value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="검색" prefix={<SearchOutlined style={{ color: 'rgba(128,128,128,0.6)' }} />}
            style={{ maxWidth: 220 }}
          />
          <Popover content={columnSettings} title="컬럼 표시·순서" trigger="click" placement="bottomLeft">
            <Tooltip title="컬럼 설정">
              <Button size="small" type="text" icon={<SettingOutlined />} />
            </Tooltip>
          </Popover>
          <Dropdown
            menu={{
              items: [
                { key: 'csv', label: 'CSV 내보내기', onClick: exportCsv },
                { key: 'tsv', label: '클립보드 복사 (TSV)', onClick: copyTsv },
              ],
            }}
            trigger={['click']}
          >
            <Tooltip title="현재 표시 중인 행 내보내기">
              <Button size="small" type="text" icon={<DownloadOutlined />} />
            </Tooltip>
          </Dropdown>
          {displayedRows.length < rows.length && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(128,128,128,0.85)', whiteSpace: 'nowrap' }}>
              {rows.length}건 중 {displayedRows.length}건 표시
            </span>
          )}
        </div>
      )}
      <Table
        size="small" pagination={false}
        rowKey={(_, i) => String(i)}
        dataSource={searchedRows}
        virtual={virtual}
        tableLayout={hasWidths ? 'fixed' : undefined}
        scroll={scroll}
        components={{ header: { cell: ResizableTh } }}
        onChange={handleTableChange}
        onRow={(row) => ({
          onClick: () => {
            // 셀 텍스트를 드래그로 선택한 경우는 클릭으로 치지 않는다
            if (window.getSelection()?.toString()) return;
            setDetailRow(row);
          },
          style: { cursor: 'pointer' },
        })}
        columns={columns.map((key) => {
          const filters = filterOptionsByKey.get(key);
          return {
            // antd v4+는 'a.b' 문자열로 중첩 필드를 찾지 않으므로 배열 경로로 변환
            title: key, dataIndex: key.split('.'), key,
            width: colWidth(key),
            sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => compare(a, b, key),
            sortOrder: prefs.sort?.key === key ? prefs.sort.order : null,
            ...(filters && {
              filters,
              filterSearch: filters.length > 10,
              filteredValue: prefs.filters[key] ?? null,
              onFilter: (value: unknown, row: Record<string, unknown>) => matchesFilter(row, key, value),
            }),
            onHeaderCell: () => ({
              onResizeStart: startResize(key), colKey: key, onReorder: reorderColumn,
            }) as ResizableThProps,
            render: (v: unknown) => renderCell(v, now),
          };
        })}
      />
      {detailRow && (
        <Modal title="행 상세" open footer={null} width={640} onCancel={() => setDetailRow(undefined)}>
          <pre style={{ maxHeight: '60vh', overflow: 'auto', fontSize: 12, margin: 0 }}>
            {JSON.stringify(detailRow, null, 2)}
          </pre>
        </Modal>
      )}
    </div>
  );
}
