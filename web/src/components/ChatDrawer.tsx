import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Select, Space, Tag, Typography, message as antdMessage } from 'antd';
import { CheckOutlined, CloseOutlined, SendOutlined, ToolOutlined } from '@ant-design/icons';
import { api, streamChat } from '../api';
import type { ChatEvent, CommandTemplate } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onDashboardsChanged: () => void;
  dashboardId?: string; // 현재 화면에 보이는 대시보드 — AI 응답의 데이터 근거
}

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; summary: string }
  | { kind: 'confirm'; pendingId: string; command: CommandTemplate; warning?: string; resolved?: 'ok' | 'no' }
  | { kind: 'error'; text: string };

const SESSION_ID = `s-${Date.now()}`;

// claude CLI --model 별칭. '' = CLI 기본 모델
const MODEL_OPTIONS = [
  { value: '', label: '기본 모델' },
  { value: 'haiku', label: 'haiku (빠름)' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'opus', label: 'opus (정밀)' },
];

export default function ChatDrawer({ open, onClose, onDashboardsChanged, dashboardId }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>(); // 진행 단계 ('화면 데이터 수집 중…' 등)
  const [model, setModel] = useState(() => localStorage.getItem('pe-chat-model') ?? '');

  const changeModel = (value: string) => {
    setModel(value);
    localStorage.setItem('pe-chat-model', value);
  };
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const push = (item: Item) => {
    setItems((prev) => [...prev, item]);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    push({ kind: 'user', text });
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    try {
      await streamChat(SESSION_ID, text, (e: ChatEvent) => {
        if (e.type === 'status') setStage(e.stage);
        if (e.type === 'text') {
          setStage(undefined);
          push({ kind: 'assistant', text: e.text });
        }
        if (e.type === 'tool') {
          push({ kind: 'tool', summary: e.summary });
          onDashboardsChanged(); // 도구 실행마다 메인 대시보드 실시간 갱신
        }
        if (e.type === 'confirm_request') {
          push({ kind: 'confirm', pendingId: e.pendingId, command: e.command, warning: e.warning });
        }
        if (e.type === 'error') push({ kind: 'error', text: e.message });
      }, { signal: ac.signal, dashboardId, model });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        push({ kind: 'error', text: (e as Error).message });
      }
    } finally {
      setBusy(false);
      setStage(undefined);
    }
  };

  const resolveConfirm = async (pendingId: string, accept: boolean) => {
    try {
      let appliedNote = '';
      if (accept) {
        const result = await api.confirmCommand(pendingId);
        if (result.applied > 0) {
          appliedNote = ` — 보류됐던 위젯 작업 ${result.applied}개 적용됨`;
          onDashboardsChanged();
        }
        for (const err of result.errors) void antdMessage.error(err);
      } else {
        await api.rejectCommand(pendingId);
      }
      setItems((prev) =>
        prev.map((it) =>
          it.kind === 'confirm' && it.pendingId === pendingId
            ? { ...it, resolved: accept ? 'ok' : 'no' }
            : it,
        ),
      );
      void antdMessage.success(accept ? `명령이 등록되었습니다${appliedNote}` : '등록을 거절했습니다');
    } catch (e) {
      void antdMessage.error((e as Error).message);
    }
  };

  return (
    <Drawer
      title="AI 채팅" placement="right" size={420} open={open} onClose={onClose}
      extra={
        <Select
          size="small" style={{ width: 130 }} value={model}
          options={MODEL_OPTIONS} onChange={changeModel} title="응답 모델"
        />
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'auto', paddingBottom: 12 }}>
          {items.length === 0 && (
            <Typography.Paragraph type="secondary">
              예: "배포 현황 대시보드 만들고 argocd 앱 목록 테이블 넣어줘"
            </Typography.Paragraph>
          )}
          {items.map((item, i) => {
            switch (item.kind) {
              case 'user':
                return (
                  <p key={i} style={{ textAlign: 'right' }}>
                    <Tag color="blue" style={{ whiteSpace: 'pre-wrap' }}>{item.text}</Tag>
                  </p>
                );
              case 'assistant':
                return (
                  <Typography.Paragraph key={i} style={{ whiteSpace: 'pre-wrap' }}>
                    {item.text}
                  </Typography.Paragraph>
                );
              case 'tool':
                return (
                  <p key={i}>
                    <Tag icon={<ToolOutlined />} color="green">{item.summary}</Tag>
                  </p>
                );
              case 'confirm':
                return (
                  <Alert
                    key={i} type={item.warning ? 'warning' : 'info'} showIcon
                    message={`명령 등록 요청: ${item.command.id}`}
                    description={
                      <>
                        <code>{item.command.argv.join(' ')}</code>
                        {item.warning && (
                          <Typography.Paragraph type="warning" style={{ marginTop: 8, marginBottom: 0 }}>
                            ⚠️ {item.warning}. 정말 등록할까요?
                          </Typography.Paragraph>
                        )}
                        <div style={{ marginTop: 8 }}>
                          {item.resolved ? (
                            <Tag>{item.resolved === 'ok' ? '등록됨' : '거절됨'}</Tag>
                          ) : (
                            <Space>
                              <Button
                                size="small" type="primary" icon={<CheckOutlined />}
                                onClick={() => void resolveConfirm(item.pendingId, true)}
                              >
                                승인
                              </Button>
                              <Button
                                size="small" icon={<CloseOutlined />}
                                onClick={() => void resolveConfirm(item.pendingId, false)}
                              >
                                거절
                              </Button>
                            </Space>
                          )}
                        </div>
                      </>
                    }
                    style={{ marginBottom: 8 }}
                  />
                );
              case 'error':
                return <Alert key={i} type="error" message={item.text} style={{ marginBottom: 8 }} />;
            }
          })}
          {busy && stage && (
            <Typography.Text type="secondary" italic style={{ fontSize: 12 }}>
              {stage}
            </Typography.Text>
          )}
          <div ref={bottomRef} />
        </div>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder={busy ? 'AI 작업 중…' : '말로 대시보드를 만들어보세요'}
            value={input} disabled={busy}
            onChange={(e) => setInput(e.target.value)} onPressEnter={() => void send()}
          />
          <Button type="primary" icon={<SendOutlined />} loading={busy} onClick={() => void send()} />
        </Space.Compact>
      </div>
    </Drawer>
  );
}
