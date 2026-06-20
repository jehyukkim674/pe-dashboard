import type { ChatEvent, CommandResult, CommandTemplate, Dashboard, WidgetDataSource } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function get<T>(url: string): Promise<T> {
  return fetch(url).then((r) => json<T>(r));
}
// body 없는 POST(승인/거절 등)는 Content-Type을 붙이지 않는다 — 빈 본문 + application/json은 Fastify가 거부한다.
function post<T>(url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.headers = JSON_HEADERS;
    init.body = JSON.stringify(body);
  }
  return fetch(url, init).then((r) => json<T>(r));
}
function put<T>(url: string, body: unknown): Promise<T> {
  return fetch(url, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) }).then((r) => json<T>(r));
}
function del<T>(url: string): Promise<T> {
  return fetch(url, { method: 'DELETE' }).then((r) => json<T>(r));
}

export const api = {
  listDashboards: () => get<Dashboard[]>('/api/dashboards'),
  getDashboard: (id: string) => get<Dashboard>(`/api/dashboards/${id}`),
  createDashboard: (name: string) => post<Dashboard>('/api/dashboards', { name }),
  saveDashboard: (dashboard: Dashboard) => put<{ ok: boolean }>(`/api/dashboards/${dashboard.id}`, dashboard),
  deleteDashboard: (id: string) => del<{ ok: boolean }>(`/api/dashboards/${id}`),

  widgetData: (ds: WidgetDataSource) => post<CommandResult>('/api/widget-data', ds),

  listCommands: () => get<CommandTemplate[]>('/api/commands'),

  exportData: () => get<unknown>('/api/export'),
  pgProfiles: () => get<string[]>('/api/pg-profiles'),
  addPgProfile: (name: string, connString: string) =>
    post<{ added: string }>('/api/pg-profiles', { name, connString }),
  httpProfiles: () => get<string[]>('/api/http-profiles'),
  addHttpProfile: (name: string, headers: Record<string, string>) =>
    post<{ added: string }>('/api/http-profiles', { name, headers }),
  commandLog: (limit = 200) =>
    get<{ ts: string; argv: string[]; ok: boolean; exitCode: number | null; durationMs: number }[]>(
      `/api/command-log?limit=${limit}`,
    ),
  importData: (bundle: unknown) =>
    post<{ dashboards: number; commands: number; skipped: string[] }>('/api/import', bundle),

  clearChatSession: (sessionId: string) => del<{ ok: boolean }>(`/api/chat/session/${sessionId}`),

  confirmCommand: (pendingId: string) =>
    post<{ registered: string; applied: number; errors: string[] }>(`/api/commands/pending/${pendingId}/confirm`),
  rejectCommand: (pendingId: string) =>
    post<{ rejected: boolean }>(`/api/commands/pending/${pendingId}/reject`),
};

// POST 기반 SSE: fetch 스트림에서 'data: {...}\n\n' 청크를 파싱해 이벤트 콜백.
// signal로 진행 중인 스트림을 중단할 수 있다 (드로어 언마운트, 새 메시지 전송 시).
// dashboardId를 보내면 AI가 현재 화면 위젯 데이터를 근거로 답한다.
export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (e: ChatEvent) => void,
  opts: { signal?: AbortSignal; dashboardId?: string; model?: string } = {},
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId, message, dashboardId: opts.dashboardId, model: opts.model || undefined,
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`chat failed: ${res.status}`);
  if (!res.body) throw new Error('response body is null');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as ChatEvent);
        } catch {
          // 잘못된 프레임은 건너뛴다 — 스트림 전체를 죽이지 않는다
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
