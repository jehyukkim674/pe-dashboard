import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Dashboard, Widget, WidgetType } from './types.js';
import { writeJsonAtomic } from './jsonFile.js';

const WIDGET_TYPES: readonly WidgetType[] = ['stat', 'table', 'chart', 'log', 'text', 'status'];

// PUT /api/dashboards/:id 로 들어오는 본문을 저장 전에 검증한다.
// 스키마에 맞지 않는 본문이 그대로 저장되면 이후 list()/get() 파싱과 UI 렌더가 깨지므로
// 여기서 걸러 400으로 돌려보낸다. 성공 시 저장 가능한 Dashboard(id 제외)를 반환한다.
export function validateDashboardInput(body: unknown): Omit<Dashboard, 'id'> {
  if (!body || typeof body !== 'object') throw new Error('본문이 객체가 아닙니다');
  const b = body as Record<string, unknown>;
  if (typeof b.name !== 'string') throw new Error('name은 문자열이어야 합니다');
  if (!Array.isArray(b.widgets)) throw new Error('widgets는 배열이어야 합니다');
  const widgets = b.widgets.map((w, i) => validateWidget(w, i));
  return { name: b.name, widgets };
}

function validateWidget(w: unknown, index: number): Widget {
  if (!w || typeof w !== 'object') throw new Error(`widgets[${index}]가 객체가 아닙니다`);
  const x = w as Record<string, unknown>;
  if (typeof x.id !== 'string') throw new Error(`widgets[${index}].id가 없습니다`);
  if (typeof x.type !== 'string' || !WIDGET_TYPES.includes(x.type as WidgetType)) {
    throw new Error(`widgets[${index}].type이 올바르지 않습니다: ${String(x.type)}`);
  }
  if (typeof x.title !== 'string') throw new Error(`widgets[${index}].title이 없습니다`);
  const l = x.layout as Record<string, unknown> | undefined;
  if (!l || ['x', 'y', 'w', 'h'].some((k) => typeof l[k] !== 'number')) {
    throw new Error(`widgets[${index}].layout이 올바르지 않습니다`);
  }
  return x as unknown as Widget;
}

export class DashboardStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`invalid dashboard id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<Dashboard[]> {
    const files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.json'));
    const settled = await Promise.allSettled(
      files.map(async (f) =>
        JSON.parse(await fs.readFile(path.join(this.dir, f), 'utf8')) as Dashboard,
      ),
    );
    const dashboards = settled
      .filter((r): r is PromiseFulfilledResult<Dashboard> => r.status === 'fulfilled')
      .map((r) => r.value);
    // name이 문자열이 아닌 손상된 파일이 하나라도 있으면 localeCompare가 던져
    // 목록 전체(/api/dashboards·export·AI list_dashboards)가 죽는다 — 문자열로 강제해 방어한다.
    return dashboards.sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));
  }

  async get(id: string): Promise<Dashboard | undefined> {
    try {
      return JSON.parse(await fs.readFile(this.filePath(id), 'utf8')) as Dashboard;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }

  async create(name: string): Promise<Dashboard> {
    const dashboard: Dashboard = { id: randomUUID(), name, widgets: [] };
    await this.write(dashboard);
    return dashboard;
  }

  async save(dashboard: Dashboard): Promise<void> {
    await this.write(dashboard);
  }

  async delete(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.filePath(id));
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }

  async addWidget(dashboardId: string, widget: Omit<Widget, 'id'>): Promise<Widget> {
    const dashboard = await this.mustGet(dashboardId);
    const created: Widget = { ...widget, id: randomUUID() };
    dashboard.widgets.push(created);
    await this.write(dashboard);
    return created;
  }

  async updateWidget(
    dashboardId: string,
    widgetId: string,
    patch: Partial<Omit<Widget, 'id'>>,
  ): Promise<Widget> {
    const dashboard = await this.mustGet(dashboardId);
    const index = dashboard.widgets.findIndex((w) => w.id === widgetId);
    if (index < 0) throw new Error(`widget not found: ${widgetId}`);
    const current = dashboard.widgets[index];
    const display = mergeTablePrefs(current, patch);
    dashboard.widgets[index] = {
      ...current, ...patch, ...(display && { display }), id: widgetId,
    };
    await this.write(dashboard);
    return dashboard.widgets[index];
  }

  async removeWidget(dashboardId: string, widgetId: string): Promise<void> {
    const dashboard = await this.mustGet(dashboardId);
    const before = dashboard.widgets.length;
    dashboard.widgets = dashboard.widgets.filter((w) => w.id !== widgetId);
    if (dashboard.widgets.length === before) throw new Error(`widget not found: ${widgetId}`);
    await this.write(dashboard);
  }

  private async mustGet(id: string): Promise<Dashboard> {
    const dashboard = await this.get(id);
    if (!dashboard) throw new Error(`dashboard not found: ${id}`);
    return dashboard;
  }

  private async write(dashboard: Dashboard): Promise<void> {
    await writeJsonAtomic(this.filePath(dashboard.id), dashboard);
  }
}

// 테이블 위젯의 사용자 개인화 설정 키 (web/src/components/widgets/tableFormat.ts와 동일 목록).
// AI의 update_widget이 display를 패치할 때 명시하지 않은 개인화 설정이 날아가지 않게 보존한다.
const TABLE_PREF_KEYS = ['columnWidths', 'columnFilters', 'columnSort', 'hiddenColumns', 'columnOrder'];

function mergeTablePrefs(
  current: Widget,
  patch: Partial<Omit<Widget, 'id'>>,
): Record<string, unknown> | undefined {
  if (!patch.display || !current.display) return patch.display;
  if ((patch.type ?? current.type) !== 'table') return patch.display;
  const merged = { ...patch.display };
  for (const key of TABLE_PREF_KEYS) {
    if (!(key in merged) && key in current.display) merged[key] = current.display[key];
  }
  return merged;
}
