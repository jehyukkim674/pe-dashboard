import type { FastifyInstance } from 'fastify';
import type { DashboardStore } from '../dashboardStore.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { CommandTemplate, Dashboard } from '../types.js';

interface ExportBundle {
  version: 1;
  exportedAt: string;
  dashboards: Dashboard[];
  commands: CommandTemplate[]; // 커스텀 명령만 (builtin 제외)
}

// 대시보드·커스텀 명령 백업/이동. 패키징 앱과 dev의 데이터 디렉터리가 달라
// 두 환경 간 대시보드를 옮길 때 사용한다 (가져오기는 id 기준 upsert/스킵).
export function exportImportRoutes(
  app: FastifyInstance,
  store: DashboardStore,
  commands: CommandRegistry,
): void {
  app.get('/api/export', async (): Promise<ExportBundle> => ({
    version: 1,
    exportedAt: new Date().toISOString(),
    dashboards: await store.list(),
    commands: commands.list().filter((t) => !t.builtin),
  }));

  app.post('/api/import', async (req, reply) => {
    const bundle = req.body as Partial<ExportBundle>;
    if (!Array.isArray(bundle?.dashboards) && !Array.isArray(bundle?.commands)) {
      return reply.code(400).send({ error: 'dashboards 또는 commands 배열이 필요합니다' });
    }

    // 명령 먼저 등록해야 대시보드 위젯의 commandId 검증이 통과한다.
    // 같은 id가 이미 있으면 건너뛴다 (기존 설정 보존). 위험 명령은 register가 거부.
    let importedCommands = 0;
    const skipped: string[] = [];
    for (const template of bundle.commands ?? []) {
      if (!template || typeof template.id !== 'string') {
        skipped.push('잘못된 명령 항목(무시됨)');
        continue;
      }
      if (commands.get(template.id)) continue;
      try {
        await commands.register({ ...template, builtin: false });
        importedCommands++;
      } catch (e) {
        skipped.push(`${template.id}: ${(e as Error).message}`);
      }
    }

    // 대시보드는 id 기준 덮어쓰기(upsert) — 같은 id를 다시 가져오면 최신 내용으로 갱신.
    // 항목 하나가 잘못돼도(잘못된 id 등) 전체 요청을 500으로 죽이지 않고 건너뛴다.
    let importedDashboards = 0;
    for (const dashboard of bundle.dashboards ?? []) {
      if (!dashboard?.id || !dashboard.name || !Array.isArray(dashboard.widgets)) continue;
      try {
        await store.save(dashboard);
        importedDashboards++;
      } catch (e) {
        skipped.push(`대시보드 ${dashboard.id}: ${(e as Error).message}`);
      }
    }

    return { dashboards: importedDashboards, commands: importedCommands, skipped };
  });
}
