import { useMemo } from 'react';
import { message } from 'antd';
import RGL from 'react-grid-layout';
import { api } from '../api';
import type { Dashboard, WidgetDataSource } from '../types';
import WidgetCard from './WidgetCard';

// @types/react-grid-layout uses `export = ReactGridLayout` (CJS-style).
// With moduleResolution:bundler the default import gives the class+namespace object;
// WidthProvider is a namespace member that's also a runtime property.
const Grid = RGL.WidthProvider(RGL);

// Layout type inlined to avoid relying on UMD ambient namespace access.
type RglItem = { i: string; x: number; y: number; w: number; h: number };

interface Props {
  dashboard: Dashboard;
  onChanged: () => void;
}

export default function DashboardGrid({ dashboard, onChanged }: Props) {
  const layout = useMemo<RglItem[]>(
    () => dashboard.widgets.map((w) => ({ i: w.id, ...w.layout })),
    [dashboard],
  );

  // 드래그/리사이즈 종료 시 대시보드 전체 저장 (수동 편집)
  // 알려진 경쟁 조건: AI 채팅이 동시에 위젯을 추가하면 이 전체-저장이 그 변경을 덮어쓸 수 있다
  // (로컬 단일 사용자 도구라 허용; refresh가 직후 상태를 재동기화).
  const handleLayoutChange = (next: RglItem[]) => {
    const moved = next.some((item) => {
      const w = dashboard.widgets.find((x) => x.id === item.i);
      return w && (w.layout.x !== item.x || w.layout.y !== item.y ||
        w.layout.w !== item.w || w.layout.h !== item.h);
    });
    if (!moved) return;
    const widgets = dashboard.widgets.map((w) => {
      const item = next.find((x) => x.i === w.id);
      return item ? { ...w, layout: { x: item.x, y: item.y, w: item.w, h: item.h } } : w;
    });
    api.saveDashboard({ ...dashboard, widgets })
      .then(() => onChanged())
      .catch((e) => void message.error(`레이아웃 저장 실패: ${(e as Error).message}`));
  };

  const removeWidget = (widgetId: string) => {
    api.saveDashboard({
      ...dashboard,
      widgets: dashboard.widgets.filter((w) => w.id !== widgetId),
    })
      .then(() => onChanged())
      .catch((e) => void message.error(`위젯 삭제 실패: ${(e as Error).message}`));
  };

  const changeRefresh = (widgetId: string, refreshSec?: number) => {
    const widgets = dashboard.widgets.map((w) =>
      w.id === widgetId && w.dataSource
        ? { ...w, dataSource: { ...w.dataSource, refreshSec } }
        : w,
    );
    api.saveDashboard({ ...dashboard, widgets })
      .then(() => onChanged())
      .catch((e) => void message.error(`갱신 주기 변경 실패: ${(e as Error).message}`));
  };

  const changeDataSource = (widgetId: string, dataSource: WidgetDataSource) => {
    const widgets = dashboard.widgets.map((w) =>
      w.id === widgetId ? { ...w, dataSource } : w,
    );
    api.saveDashboard({ ...dashboard, widgets })
      .then(() => onChanged())
      .catch((e) => void message.error(`실행 명령 변경 실패: ${(e as Error).message}`));
  };

  return (
    <Grid
      layout={layout} cols={12} rowHeight={60} margin={[12, 12]}
      onDragStop={handleLayoutChange} onResizeStop={handleLayoutChange}
      draggableCancel=".widget-body,.widget-actions,.ant-select-dropdown,.ant-popover"
    >
      {dashboard.widgets.map((widget) => (
        <div key={widget.id}>
          <WidgetCard
            widget={widget}
            onRemove={() => removeWidget(widget.id)}
            onChangeRefresh={(sec) => changeRefresh(widget.id, sec)}
            onChangeDataSource={(ds) => changeDataSource(widget.id, ds)}
          />
        </div>
      ))}
    </Grid>
  );
}
