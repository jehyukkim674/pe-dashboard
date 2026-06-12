import type { ChatEvent, CommandResult, CommandTemplate, Dashboard, WidgetDataSource } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  listDashboards: () => fetch('/api/dashboards').then((r) => json<Dashboard[]>(r)),
  getDashboard: (id: string) => fetch(`/api/dashboards/${id}`).then((r) => json<Dashboard>(r)),
  createDashboard: (name: string) =>
    fetch('/api/dashboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => json<Dashboard>(r)),
  saveDashboard: (dashboard: Dashboard) =>
    fetch(`/api/dashboards/${dashboard.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dashboard),
    }).then((r) => json<{ ok: boolean }>(r)),
  deleteDashboard: (id: string) =>
    fetch(`/api/dashboards/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),

  widgetData: (ds: WidgetDataSource) =>
    fetch('/api/widget-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ds),
    }).then((r) => json<CommandResult>(r)),

  listCommands: () => fetch('/api/commands').then((r) => json<CommandTemplate[]>(r)),

  confirmCommand: (pendingId: string) =>
    fetch(`/api/commands/pending/${pendingId}/confirm`, { method: 'POST' }).then((r) =>
      json<{ registered: string }>(r),
    ),
  rejectCommand: (pendingId: string) =>
    fetch(`/api/commands/pending/${pendingId}/reject`, { method: 'POST' }).then((r) =>
      json<{ rejected: boolean }>(r),
    ),
};

// POST 기반 SSE: fetch 스트림에서 'data: {...}\n\n' 청크를 파싱해 이벤트 콜백.
// signal로 진행 중인 스트림을 중단할 수 있다 (드로어 언마운트, 새 메시지 전송 시).
// dashboardId를 보내면 AI가 현재 화면 위젯 데이터를 근거로 답한다.
export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (e: ChatEvent) => void,
  opts: { signal?: AbortSignal; dashboardId?: string } = {},
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message, dashboardId: opts.dashboardId }),
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
