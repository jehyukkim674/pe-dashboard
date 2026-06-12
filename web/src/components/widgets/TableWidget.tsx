import { Table } from 'antd';
import type { CommandResult } from '../../types';

function valueAt(row: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>(
    (acc, key) => (acc != null && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    row,
  );
}

// 컬럼 클릭 정렬: 양쪽 다 숫자면 수치 비교, 아니면 문자열 비교
function compare(a: Record<string, unknown>, b: Record<string, unknown>, key: string): number {
  const [va, vb] = [valueAt(a, key), valueAt(b, key)];
  const [na, nb] = [Number(va), Number(vb)];
  if (!Number.isNaN(na) && !Number.isNaN(nb) && va !== '' && vb !== '') return na - nb;
  return String(va ?? '').localeCompare(String(vb ?? ''));
}

export default function TableWidget({ result, display }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
}) {
  const rows = Array.isArray(result?.json) ? (result.json as Record<string, unknown>[]) : [];
  const rawCols = display?.columns;
  const columns: string[] =
    Array.isArray(rawCols) && rawCols.every((c) => typeof c === 'string')
      ? (rawCols as string[])
      : Object.keys(rows[0] ?? {});
  return (
    <Table
      size="small" pagination={false}
      rowKey={(_, i) => String(i)}
      dataSource={rows}
      columns={columns.map((key) => ({
        // antd v4+는 'a.b' 문자열로 중첩 필드를 찾지 않으므로 배열 경로로 변환
        title: key, dataIndex: key.split('.'), key,
        sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => compare(a, b, key),
        render: (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')),
      }))}
    />
  );
}
