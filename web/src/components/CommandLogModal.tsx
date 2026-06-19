import { useEffect, useMemo, useState } from 'react';
import { Modal, Table, Tag, Space, Switch, message } from 'antd';
import { api } from '../api';
import { CATEGORY_LABELS, summarizeFailures, type LogEntry } from './commandLog';

// 서버 감사 로그(commands.jsonl) 뷰어 — 어떤 명령이 언제 실행됐고 왜 실패했는지 확인용
export default function CommandLogModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failOnly, setFailOnly] = useState(false);
  const [catFilter, setCatFilter] = useState<string | undefined>();

  useEffect(() => {
    api.commandLog()
      .then((rows) => setEntries((rows as LogEntry[]).reverse())) // 최신이 위로
      .catch((e) => void message.error(`실행 기록 조회 실패: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, []);

  const summary = useMemo(() => summarizeFailures(entries), [entries]);
  const shown = useMemo(
    () => entries.filter((e) =>
      (!failOnly || !e.ok) && (!catFilter || (e.category ?? 'unknown') === catFilter)),
    [entries, failOnly, catFilter],
  );

  return (
    <Modal title="명령 실행 기록 (최근 200개)" open onCancel={onClose} footer={null} width={820}>
      <Space style={{ marginBottom: 8 }} wrap>
        <span>
          <Switch size="small" checked={failOnly} onChange={setFailOnly} /> 실패만
        </span>
        {summary.map((s) => (
          <Tag
            key={s.category}
            color={catFilter === s.category ? 'red' : 'default'}
            style={{ cursor: 'pointer' }}
            onClick={() => setCatFilter(catFilter === s.category ? undefined : s.category)}
          >
            {s.label} {s.count}
          </Tag>
        ))}
      </Space>
      <Table<LogEntry>
        size="small" rowKey={(r) => r.ts + r.argv.join(' ')}
        dataSource={shown} loading={loading}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        expandable={{
          rowExpandable: (r) => !!r.stderr,
          expandedRowRender: (r) => (
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontSize: 11 }}>
              {r.stderr}
            </pre>
          ),
        }}
        columns={[
          {
            title: '시각', dataIndex: 'ts', width: 90,
            render: (ts: string) => new Date(ts).toTimeString().slice(0, 8),
          },
          {
            title: '명령', dataIndex: 'argv',
            render: (argv: string[]) => (
              <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{argv.join(' ').slice(0, 120)}</code>
            ),
          },
          {
            title: '결과', dataIndex: 'ok', width: 110,
            render: (ok: boolean, r) =>
              ok
                ? <Tag color="green">성공</Tag>
                : <Tag color="red">{r.category ? CATEGORY_LABELS[r.category] : '실패'}</Tag>,
          },
          {
            title: '소요', dataIndex: 'durationMs', width: 80,
            render: (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${ms}ms`),
          },
        ]}
      />
    </Modal>
  );
}
