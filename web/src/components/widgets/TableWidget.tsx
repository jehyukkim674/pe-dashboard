import { Table } from 'antd';
import type { CommandResult } from '../../types';

export default function TableWidget({ result, display }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
}) {
  const rows = Array.isArray(result?.json) ? (result.json as Record<string, unknown>[]) : [];
  const columns = (display?.columns as string[] | undefined) ?? Object.keys(rows[0] ?? {});
  return (
    <Table
      size="small" pagination={false}
      rowKey={(_, i) => String(i)}
      dataSource={rows}
      columns={columns.map((key) => ({
        title: key, dataIndex: key, key,
        render: (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')),
      }))}
    />
  );
}
