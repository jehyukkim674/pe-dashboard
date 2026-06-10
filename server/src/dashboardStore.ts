import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Dashboard, Widget } from './types.js';

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
    return dashboards.sort((a, b) => a.name.localeCompare(b.name));
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
    dashboard.widgets[index] = { ...dashboard.widgets[index], ...patch, id: widgetId };
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

  // 원자적 쓰기: temp 파일에 쓴 뒤 rename
  private async write(dashboard: Dashboard): Promise<void> {
    const target = this.filePath(dashboard.id);
    const tmp = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(dashboard, null, 2));
    await fs.rename(tmp, target);
  }
}
