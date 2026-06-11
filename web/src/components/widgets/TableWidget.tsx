import { Table } from 'antd';
import type { CommandResult } from '../../types';

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
        render: (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')),
      }))}
    />
  );
}
