import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, message } from 'antd';
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import RGL, { WidthProvider } from 'react-grid-layout/legacy';
import { api } from '../api';
import type { Dashboard, Widget } from '../types';
import WidgetCard from './WidgetCard';
import WidgetEditModal, { type WidgetDraft } from './WidgetEditModal';
import { DEFAULT_WIDGET_SIZE } from './widgets/widgetTypes';

// react-grid-layout v2: 기존 v1 API(draggableCancel 등)는 /legacy 진입점이 제공한다.
// 새 GridLayout API에는 draggableCancel이 없어 액션 클릭 보호를 위해 legacy를 쓴다.
const Grid = WidthProvider(RGL);

// Layout type inlined to avoid relying on UMD ambient namespace access.
type RglItem = { i: string; x: number; y: number; w: number; h: number };

interface Props {
  dashboard: Dashboard;
  onChanged: () => void;
  onAnalyze?: () => void; // 'AI 분석' — 채팅으로 현재 대시보드 진단 요청
}

export default function DashboardGrid({ dashboard, onChanged, onAnalyze }: Props) {
  const [adding, setAdding] = useState(false);
  const [highlightId, setHighlightId] = useState<string>();

  const flashHighlight = (id: string) => {
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? undefined : cur)), 2500);
  };

  // 각 편집의 기준이 되는 최신 위젯 목록. dashboard prop은 저장 후 refresh가 끝나야 갱신되므로,
  // 그 사이 두 번째 편집이 stale한 prop을 기준으로 계산하면 첫 편집을 조용히 되돌린다.
  // 저장 시 낙관적으로 ref를 갱신해 연속 편집이 항상 최신 상태 위에 쌓이게 한다.
  const widgetsRef = useRef(dashboard.widgets);
  useEffect(() => { widgetsRef.current = dashboard.widgets; }, [dashboard]);

  // 위젯 변경을 대시보드 전체 저장으로 영속화하는 공통 경로 (저장→재동기화→실패 시 에러 토스트).
  const saveWidgets = (widgets: Widget[], failMsg: string, afterSave?: () => void) => {
    widgetsRef.current = widgets; // 낙관적 갱신: 다음 편집이 이 결과를 기준으로 하게 한다
    return api.saveDashboard({ ...dashboard, widgets })
      .then(() => { onChanged(); afterSave?.(); })
      .catch((e) => void message.error(`${failMsg}: ${(e as Error).message}`));
  };
  const layout = useMemo<RglItem[]>(
    () => dashboard.widgets.map((w) => ({ i: w.id, ...w.layout })),
    [dashboard],
  );

  // 드래그/리사이즈 종료 시 대시보드 전체 저장 (수동 편집)
  // 알려진 경쟁 조건: AI 채팅이 동시에 위젯을 추가하면 이 전체-저장이 그 변경을 덮어쓸 수 있다
  // (로컬 단일 사용자 도구라 허용; refresh가 직후 상태를 재동기화).
  const handleLayoutChange = (next: readonly RglItem[]) => {
    const base = widgetsRef.current;
    const moved = next.some((item) => {
      const w = base.find((x) => x.id === item.i);
      return w && (w.layout.x !== item.x || w.layout.y !== item.y ||
        w.layout.w !== item.w || w.layout.h !== item.h);
    });
    if (!moved) return;
    const widgets = base.map((w) => {
      const item = next.find((x) => x.i === w.id);
      return item ? { ...w, layout: { x: item.x, y: item.y, w: item.w, h: item.h } } : w;
    });
    void saveWidgets(widgets, '레이아웃 저장 실패');
  };

  const removeWidget = (widgetId: string) => {
    void saveWidgets(widgetsRef.current.filter((w) => w.id !== widgetId), '위젯 삭제 실패');
  };

  const changeRefresh = (widgetId: string, refreshSec?: number) => {
    const widgets = widgetsRef.current.map((w) =>
      w.id === widgetId && w.dataSource
        ? { ...w, dataSource: { ...w.dataSource, refreshSec } }
        : w,
    );
    void saveWidgets(widgets, '갱신 주기 변경 실패');
  };

  // 위젯 내부 상호작용(컬럼 폭 조절 등)으로 바뀐 display만 저장
  const changeDisplay = (widgetId: string, display: Record<string, unknown>) => {
    const widgets = widgetsRef.current.map((w) => (w.id === widgetId ? { ...w, display } : w));
    void saveWidgets(widgets, '표시 설정 저장 실패');
  };

  // 편집: id·layout은 유지하고 나머지를 드래프트로 교체 (dataSource/alert 제거도 반영)
  const editWidget = (widgetId: string, draft: WidgetDraft) => {
    const widgets = widgetsRef.current.map((w) =>
      w.id === widgetId ? { id: w.id, layout: w.layout, ...draft } : w,
    );
    void saveWidgets(widgets, '위젯 수정 실패');
  };

  // 12컬럼 그리드에서 기존 위젯과 겹치지 않는 가장 위쪽 빈 자리를 찾는다 (없으면 맨 아래)
  const findFreePosition = (w: number, h: number): { x: number; y: number } => {
    const occupied = widgetsRef.current.map((wg) => wg.layout);
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
    const source = widgetsRef.current.find((w) => w.id === widgetId);
    if (!source) return;
    const copy: Widget = {
      ...source,
      id: crypto.randomUUID(),
      title: `${source.title} (복사)`,
      layout: { ...findFreePosition(source.layout.w, source.layout.h), w: source.layout.w, h: source.layout.h },
    };
    void saveWidgets([...widgetsRef.current, copy], '위젯 복제 실패', () => flashHighlight(copy.id));
  };

  const addWidget = (draft: WidgetDraft) => {
    const size = DEFAULT_WIDGET_SIZE[draft.type];
    const widget: Widget = {
      id: crypto.randomUUID(),
      layout: { ...findFreePosition(size.w, size.h), ...size },
      ...draft,
    };
    void saveWidgets([...widgetsRef.current, widget], '위젯 추가 실패', () => flashHighlight(widget.id));
  };

  return (
    <>
      <div className="dash-toolbar" style={{ marginBottom: 4, textAlign: 'right' }}>
        {onAnalyze && dashboard.widgets.length > 0 && (
          <Button
            size="small" type="text" icon={<ThunderboltOutlined />}
            onClick={onAnalyze} style={{ marginRight: 4 }}
          >
            AI 분석
          </Button>
        )}
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
              onChangeDisplay={(display) => changeDisplay(widget.id, display)}
              highlight={widget.id === highlightId}
            />
          </div>
        ))}
      </Grid>
      {adding && <WidgetEditModal onClose={() => setAdding(false)} onSave={addWidget} />}
    </>
  );
}
