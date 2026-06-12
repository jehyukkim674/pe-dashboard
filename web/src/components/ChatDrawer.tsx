import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Select, Space, Tag, Tooltip, Typography, message as antdMessage } from 'antd';
import { CheckOutlined, ClearOutlined, CloseOutlined, SendOutlined, ToolOutlined } from '@ant-design/icons';
import { marked } from 'marked';
import { api, streamChat } from '../api';
import { sanitizeHtml } from '../utils/sanitize';
import type { ChatEvent, CommandTemplate } from '../types';

// AI 응답을 마크다운(목록·코드·강조)으로 렌더링한다. 로컬 AI 응답이지만 방어적으로 정화.
function renderMarkdown(text: string): string {
  return sanitizeHtml(marked.parse(text, { async: false, breaks: true }));
}

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

// 세션 id와 대화 내역을 localStorage에 보존해 앱 재시작 후에도 이어 보이게 한다
const SESSION_ID = (() => {
  const saved = localStorage.getItem('pe-chat-session') ?? `s-${Date.now()}`;
  localStorage.setItem('pe-chat-session', saved);
  return saved;
})();
const HISTORY_KEY = 'pe-chat-history';
const HISTORY_MAX = 100;

function loadHistory(): Item[] {
  try {
    const items = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as Item[];
    // 재시작하면 서버의 승인 대기 목록은 사라지므로, 미해결 승인 카드는 만료 처리
    return items.map((it) =>
      it.kind === 'confirm' && !it.resolved ? { ...it, resolved: 'no' as const } : it,
    );
  } catch {
    return [];
  }
}

// claude CLI --model 별칭. '' = CLI 기본 모델
const MODEL_OPTIONS = [
  { value: '', label: '기본 모델' },
  { value: 'haiku', label: 'haiku (빠름)' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'opus', label: 'opus (정밀)' },
];

export default function ChatDrawer({ open, onClose, onDashboardsChanged, dashboardId }: Props) {
  const [items, setItems] = useState<Item[]>(loadHistory);
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

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-HISTORY_MAX)));
  }, [items]);

  const clearHistory = () => {
    setItems([]);
    localStorage.removeItem(HISTORY_KEY);
  };

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
        <Space>
          <Select
            size="small" style={{ width: 130 }} value={model}
            options={MODEL_OPTIONS} onChange={changeModel} title="응답 모델"
          />
          <Tooltip title="대화 지우기">
            <Button size="small" type="text" icon={<ClearOutlined />} onClick={clearHistory} />
          </Tooltip>
        </Space>
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
                  <div key={i} style={{ textAlign: 'right' }}>
                    <span className="chat-bubble chat-user">{item.text}</span>
                  </div>
                );
              case 'assistant':
                return (
                  <div key={i}>
                    <span
                      className="chat-bubble chat-assistant"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
                    />
                  </div>
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
