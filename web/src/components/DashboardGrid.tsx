import { useMemo, useState } from 'react';
import { Button, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import RGL, { WidthProvider } from 'react-grid-layout/legacy';
import { api } from '../api';
import type { Dashboard, Widget, WidgetType } from '../types';
import WidgetCard from './WidgetCard';
import WidgetEditModal, { type WidgetDraft } from './WidgetEditModal';

// 타입별 기본 크기 (12컬럼 그리드, 1행 = 60px)
const DEFAULT_SIZE: Record<WidgetType, { w: number; h: number }> = {
  stat: { w: 3, h: 2 },
  table: { w: 6, h: 5 },
  chart: { w: 6, h: 5 },
  log: { w: 6, h: 5 },
  text: { w: 4, h: 3 },
};

// react-grid-layout v2: 기존 v1 API(draggableCancel 등)는 /legacy 진입점이 제공한다.
// 새 GridLayout API에는 draggableCancel이 없어 액션 클릭 보호를 위해 legacy를 쓴다.
const Grid = WidthProvider(RGL);

// Layout type inlined to avoid relying on UMD ambient namespace access.
type RglItem = { i: string; x: number; y: number; w: number; h: number };

interface Props {
  dashboard: Dashboard;
  onChanged: () => void;
}

export default function DashboardGrid({ dashboard, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const layout = useMemo<RglItem[]>(
    () => dashboard.widgets.map((w) => ({ i: w.id, ...w.layout })),
    [dashboard],
  );

  // 드래그/리사이즈 종료 시 대시보드 전체 저장 (수동 편집)
  // 알려진 경쟁 조건: AI 채팅이 동시에 위젯을 추가하면 이 전체-저장이 그 변경을 덮어쓸 수 있다
  // (로컬 단일 사용자 도구라 허용; refresh가 직후 상태를 재동기화).
  const handleLayoutChange = (next: readonly RglItem[]) => {
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

  // 편집: id·layout은 유지하고 나머지를 드래프트로 교체 (dataSource/alert 제거도 반영)
  const editWidget = (widgetId: string, draft: WidgetDraft) => {
    const widgets = dashboard.widgets.map((w) =>
      w.id === widgetId ? { id: w.id, layout: w.layout, ...draft } : w,
    );
    api.saveDashboard({ ...dashboard, widgets })
      .then(() => onChanged())
      .catch((e) => void message.error(`위젯 수정 실패: ${(e as Error).message}`));
  };

  // 12컬럼 그리드에서 기존 위젯과 겹치지 않는 가장 위쪽 빈 자리를 찾는다 (없으면 맨 아래)
  const findFreePosition = (w: number, h: number): { x: number; y: number } => {
    const occupied = dashboard.widgets.map((wg) => wg.layout);
    const bottom = Math.max(0, ...occupied.map((l) => l.y + l.h));
    for (let y = 0; y <= bottom; y++) {
      for (let x = 0; x + w <= 12; x++) {
        const collides = occupied.some(
          (l) => x < l.x + l.w && l.x < x + w && y < l.y + l.h && l.y < y + h,
        );
        if (!collides) return { x, y };
      }
    }
    return { x: 0, y: bottom };
  };

  const duplicateWidget = (widgetId: string) => {
    const source = dashboard.widgets.find((w) => w.id === widgetId);
    if (!source) return;
    const copy: Widget = {
      ...source,
      id: crypto.randomUUID(),
      title: `${source.title} (복사)`,
      layout: { ...findFreePosition(source.layout.w, source.layout.h), w: source.layout.w, h: source.layout.h },
    };
    api.saveDashboard({ ...dashboard, widgets: [...dashboard.widgets, copy] })
      .then(() => onChanged())
      .catch((e) => void message.error(`위젯 복제 실패: ${(e as Error).message}`));
  };

  const addWidget = (draft: WidgetDraft) => {
    const size = DEFAULT_SIZE[draft.type];
    const widget: Widget = {
      id: crypto.randomUUID(),
      layout: { ...findFreePosition(size.w, size.h), ...size },
      ...draft,
    };
    api.saveDashboard({ ...dashboard, widgets: [...dashboard.widgets, widget] })
      .then(() => onChanged())
      .catch((e) => void message.error(`위젯 추가 실패: ${(e as Error).message}`));
  };

  return (
    <>
      <div style={{ marginBottom: 4, textAlign: 'right' }}>
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          위젯 추가
        </Button>
      </div>
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
              onEdit={(draft) => editWidget(widget.id, draft)}
              onDuplicate={() => duplicateWidget(widget.id)}
            />
          </div>
        ))}
      </Grid>
      {adding && <WidgetEditModal onClose={() => setAdding(false)} onSave={addWidget} />}
    </>
  );
}
