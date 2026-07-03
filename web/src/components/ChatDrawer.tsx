import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Select, Space, Tag, Tooltip, Typography, message as antdMessage } from 'antd';
import {
  CheckOutlined, ClearOutlined, CloseOutlined, CopyOutlined, RedoOutlined, SendOutlined,
  StopOutlined, ToolOutlined,
} from '@ant-design/icons';
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
  injectedPrompt?: string; // 외부(예: 'AI 분석' 버튼)에서 주입한 프롬프트 — 열리면 자동 전송
  onInjectedConsumed?: () => void; // 주입 프롬프트를 보낸 뒤 부모가 비우도록 알림
}

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; streaming?: boolean }
  | { kind: 'tool'; summary: string }
  | { kind: 'confirm'; pendingId: string; command: CommandTemplate; warning?: string; resolved?: 'ok' | 'no' }
  | { kind: 'error'; text: string };

// 세션 id와 대화 내역을 localStorage에 보존해 앱 재시작 후에도 이어 보이게 한다.
// 대화 초기화 시 새 id를 발급해 서버의 세션 기억과도 확실히 분리한다.
const SESSION_KEY = 'pe-chat-session';
const HISTORY_KEY = 'pe-chat-history';
const HISTORY_MAX = 100;

function loadSessionId(): string {
  const saved = localStorage.getItem(SESSION_KEY) ?? `s-${Date.now()}`;
  localStorage.setItem(SESSION_KEY, saved);
  return saved;
}

// 빈 대화일 때 보여주는 추천 프롬프트 (클릭하면 입력창에 채워짐)
const SUGGESTIONS = [
  '배포 현황 대시보드 만들고 argocd 앱 목록 테이블 넣어줘',
  '지금 보고 있는 대시보드에서 비정상인 항목 있어?',
  '이 대시보드에 전체 개수 stat 위젯 추가해줘',
  '위젯들 보기 좋게 재배치해줘',
];

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

export default function ChatDrawer({
  open, onClose, onDashboardsChanged, dashboardId, injectedPrompt, onInjectedConsumed,
}: Props) {
  const [sessionId, setSessionId] = useState(loadSessionId);
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

  // items 내용이 바뀔 때마다(스트리밍 증분 포함) 하단으로 따라간다
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-HISTORY_MAX)));
  }, [items]);

  // 진짜 초기화: 화면 내역 + 서버 세션 기억을 함께 비우고 새 세션 id로 시작한다
  const clearHistory = () => {
    abortRef.current?.abort();
    setItems([]);
    localStorage.removeItem(HISTORY_KEY);
    api.clearChatSession(sessionId).catch((e) => console.error('세션 초기화 실패', e));
    const next = `s-${Date.now()}`;
    localStorage.setItem(SESSION_KEY, next);
    setSessionId(next);
    void antdMessage.success('대화를 초기화했습니다 (AI 기억 포함)');
  };

  // 응답 생성 중단 (서버가 claude 프로세스도 함께 종료한다)
  const stop = () => abortRef.current?.abort();

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || busy) return;
    setInput('');
    push({ kind: 'user', text });
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    try {
      await streamChat(sessionId, text, (e: ChatEvent) => {
        if (e.type === 'status') setStage(e.stage);
        if (e.type === 'text_delta') {
          // 스트리밍 조각: 진행 중인 assistant 버블에 이어 붙이고, 없으면 새로 만든다
          setStage(undefined);
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last?.kind === 'assistant' && last.streaming) {
              return [...prev.slice(0, -1), { ...last, text: last.text + e.text }];
            }
            return [...prev, { kind: 'assistant', text: e.text, streaming: true }];
          });
        }
        if (e.type === 'text') {
          // 최종 권위 응답: 진행 중 버블이 있으면 그 내용을 교체하며 스트리밍 종료, 없으면 새 버블
          setStage(undefined);
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last?.kind === 'assistant' && last.streaming) {
              return [...prev.slice(0, -1), { kind: 'assistant', text: e.text }];
            }
            return [...prev, { kind: 'assistant', text: e.text }];
          });
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

  // 외부에서 주입된 프롬프트('AI 분석' 등)를 한 번 자동 전송한다 (중복 전송 방지).
  // 부모는 소비 후 injectedPrompt를 undefined로 비운다 — 이때 ref도 리셋해야
  // 같은 문구('AI 분석'은 항상 동일 상수)로 다시 눌러도 전송된다.
  const injectedRef = useRef(false);
  useEffect(() => {
    if (!injectedPrompt) {
      injectedRef.current = false; // 소비 완료 — 다음 주입을 받을 수 있게 리셋
      return;
    }
    if (busy || injectedRef.current) return;
    injectedRef.current = true;
    void send(injectedPrompt);
    onInjectedConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedPrompt, busy]);

  // 마지막 사용자 메시지를 다시 보낸다 (에러 후 재시도)
  const retryLast = () => {
    const lastUser = [...items].reverse().find((it) => it.kind === 'user');
    if (lastUser && lastUser.kind === 'user') void send(lastUser.text);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => void antdMessage.success('복사했습니다'))
      .catch((e) => {
        console.error('클립보드 복사 실패', e);
        void antdMessage.error('복사에 실패했습니다');
      });
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
          <Tooltip title="대화 초기화 (AI 기억 포함)">
            <Button size="small" type="text" icon={<ClearOutlined />} onClick={clearHistory} />
          </Tooltip>
        </Space>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'auto', paddingBottom: 12 }}>
          {items.length === 0 && (
            <>
              <Typography.Paragraph type="secondary">이렇게 시작해보세요:</Typography.Paragraph>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s} size="small" block
                    style={{ whiteSpace: 'normal', height: 'auto', textAlign: 'left' }}
                    onClick={() => setInput(s)}
                  >
                    {s}
                  </Button>
                ))}
              </Space>
            </>
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
                  <div key={i} className="chat-msg">
                    <span
                      className="chat-bubble chat-assistant"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
                    />
                    <Tooltip title="답변 복사">
                      <CopyOutlined className="chat-copy" onClick={() => copyText(item.text)} />
                    </Tooltip>
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
                return (
                  <Alert
                    key={i} type="error" message={item.text} style={{ marginBottom: 8 }}
                    // 마지막 메시지가 에러일 때만 재시도 제공 (옛 에러에 붙으면 혼란)
                    action={i === items.length - 1 && !busy ? (
                      <Button size="small" icon={<RedoOutlined />} onClick={retryLast}>
                        다시 시도
                      </Button>
                    ) : undefined}
                  />
                );
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
          <Input.TextArea
            placeholder={busy ? 'AI 작업 중…' : '말로 대시보드를 만들어보세요 (Shift+Enter 줄바꿈, ↑ 이전 입력)'}
            value={input} disabled={busy}
            autoSize={{ minRows: 1, maxRows: 5 }}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // 입력이 비어 있을 때 ↑ 로 마지막 보낸 메시지를 다시 불러온다
              if (e.key === 'ArrowUp' && input === '') {
                const lastUser = [...items].reverse().find((it) => it.kind === 'user');
                if (lastUser && lastUser.kind === 'user') {
                  e.preventDefault();
                  setInput(lastUser.text);
                }
              }
            }}
            onPressEnter={(e) => {
              // 한글 IME 조합 확정용 Enter(isComposing)는 전송하지 않는다 —
              // 조합 중 Enter로 글자를 확정하려던 것이 메시지 전송으로 오작동하는 것을 막는다.
              if (e.nativeEvent.isComposing) return;
              if (!e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <Tooltip title="응답 중단">
              <Button danger icon={<StopOutlined />} onClick={stop} />
            </Tooltip>
          ) : (
            <Button type="primary" icon={<SendOutlined />} onClick={() => void send()} />
          )}
        </Space.Compact>
      </div>
    </Drawer>
  );
}
