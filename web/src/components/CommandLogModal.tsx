import { useEffect, useState } from 'react';
import { Modal, Table, Tag, message } from 'antd';
import { api } from '../api';

interface LogEntry {
  ts: string;
  argv: string[];
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
}

// 서버 감사 로그(commands.jsonl) 뷰어 — 어떤 명령이 언제 실행됐는지 확인용
export default function CommandLogModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.commandLog()
      .then((rows) => setEntries(rows.reverse())) // 최신이 위로
      .catch((e) => void message.error(`실행 기록 조회 실패: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Modal title="명령 실행 기록 (최근 200개)" open onCancel={onClose} footer={null} width={760}>
      <Table<LogEntry>
        size="small" rowKey={(r) => r.ts + r.argv.join(' ')}
        dataSource={entries} loading={loading}
        pagination={{ pageSize: 15, showSizeChanger: false }}
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
            title: '결과', dataIndex: 'ok', width: 70,
            render: (ok: boolean) => <Tag color={ok ? 'green' : 'red'}>{ok ? '성공' : '실패'}</Tag>,
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
