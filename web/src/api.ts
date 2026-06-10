import type { ChatEvent, CommandResult, Dashboard, WidgetDataSource } from './types';

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

  confirmCommand: (pendingId: string) =>
    fetch(`/api/commands/pending/${pendingId}/confirm`, { method: 'POST' }).then((r) =>
      json<{ registered: string }>(r),
    ),
  rejectCommand: (pendingId: string) =>
    fetch(`/api/commands/pending/${pendingId}/reject`, { method: 'POST' }).then((r) =>
      json<{ rejected: boolean }>(r),
    ),
};

// POST 기반 SSE: fetch 스트림에서 'data: {...}\n\n' 청크를 파싱해 이벤트 콜백
export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)) as ChatEvent);
    }
  }
}
