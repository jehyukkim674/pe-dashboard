import { useMemo } from 'react';
import RGL from 'react-grid-layout';
import { api } from '../api';
import type { Dashboard } from '../types';
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
  const handleLayoutChange = async (next: RglItem[]) => {
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
    await api.saveDashboard({ ...dashboard, widgets });
    onChanged();
  };

  const removeWidget = async (widgetId: string) => {
    await api.saveDashboard({
      ...dashboard,
      widgets: dashboard.widgets.filter((w) => w.id !== widgetId),
    });
    onChanged();
  };

  return (
    <Grid
      layout={layout} cols={12} rowHeight={60} margin={[12, 12]}
      onDragStop={handleLayoutChange} onResizeStop={handleLayoutChange}
      draggableCancel=".widget-body"
    >
      {dashboard.widgets.map((widget) => (
        <div key={widget.id}>
          <WidgetCard widget={widget} onRemove={() => removeWidget(widget.id)} />
        </div>
      ))}
    </Grid>
  );
}
