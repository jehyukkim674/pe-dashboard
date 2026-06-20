import type { WidgetType } from '../../types';

export interface WidgetTypeDescriptor {
  kind: WidgetType;
  label: string; // 편집 모달의 타입 선택 라벨
  defaultSize: { w: number; h: number }; // 12컬럼 그리드, 1행 = 60px
}

// 위젯 타입의 단일 출처: 종류·라벨·기본 크기. 편집 모달의 선택지(WIDGET_TYPE_OPTIONS)와
// 그리드의 기본 크기(DEFAULT_WIDGET_SIZE)가 여기서 파생된다 — 따로 나열하다 어긋나던 것을 막는다.
// 배열 순서 = 모달에 보이는 순서.
// (렌더러 매핑은 타입마다 prop 시그니처가 달라 WidgetCard에 그대로 둔다 — 의도된 다형성.)
export const WIDGET_TYPES: WidgetTypeDescriptor[] = [
  { kind: 'stat', label: 'Stat (숫자 하나)', defaultSize: { w: 3, h: 2 } },
  { kind: 'table', label: 'Table (표)', defaultSize: { w: 6, h: 5 } },
  { kind: 'chart', label: 'Chart (차트)', defaultSize: { w: 6, h: 5 } },
  { kind: 'log', label: 'Log (텍스트 출력)', defaultSize: { w: 6, h: 5 } },
  { kind: 'status', label: 'Status (상태 타일 그리드)', defaultSize: { w: 6, h: 4 } },
  { kind: 'text', label: 'Text (메모)', defaultSize: { w: 4, h: 3 } },
];

export const WIDGET_TYPE_OPTIONS: { value: WidgetType; label: string }[] =
  WIDGET_TYPES.map((t) => ({ value: t.kind, label: t.label }));

export const DEFAULT_WIDGET_SIZE = Object.fromEntries(
  WIDGET_TYPES.map((t) => [t.kind, t.defaultSize]),
) as Record<WidgetType, { w: number; h: number }>;

// 타입별 display 옵션 shape — 렌더러와 편집 모달이 공유하는 표시 설정의 단일 정의.
// (display는 AI도 채울 수 있는 느슨한 JSON이라 모든 필드가 optional.)
export interface StatDisplay { metric?: 'count' | 'path'; path?: string; suffix?: string; }
export interface StatusDisplay { labelPath?: string; statePath?: string; okValues?: string; }
export interface ChartDisplay { xKey?: string; yKey?: string | string[]; chartType?: 'line' | 'bar'; }
