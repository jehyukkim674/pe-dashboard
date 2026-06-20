# ADR 0001: 대시보드 저장은 전체 덮어쓰기(last-write-wins)

- 상태: 채택 (2026-06-20)
- 관련: `web/src/components/DashboardGrid.tsx`, `server/src/routes/dashboards.ts`(PUT /api/dashboards/:id), `server/src/dashboardStore.ts`

## 맥락

웹의 레이아웃 드래그·위젯 편집은 대시보드 **전체**를 PUT으로 저장한다(last-write-wins).
같은 단일 사용자 세션이라도, AI 채팅이 비동기로 위젯을 추가/수정하는 동안 사용자가
레이아웃을 드래그하면 전체 저장이 AI의 변경을 덮어쓸 수 있다(`DashboardGrid`의 주석이 이미 자인).
현재는 도구 실행 직후 `refresh`가 상태를 재동기화하므로 실사용에서 충돌 확률이 낮다.

서버에는 이미 위젯 단위 변이 메서드(`addWidget`/`updateWidget`/`removeWidget`)와 테스트가
있으나, 웹은 이를 REST로 쓰지 않고 전체 PUT만 사용한다.

## 결정

당분간 **전체 덮어쓰기를 유지한다.** 이 앱은 로컬·단일 사용자·단일 인스턴스 잠금이며,
충돌 창이 좁고 `refresh`가 재동기화하므로 데이터 손실 위험이 낮다. 위젯 단위 동시성 제어를
지금 도입하는 비용(새 라우트·클라이언트 변경·회귀 위험, 특히 갓 릴리스된 v0.25.0 직후
GUI 스모크 없이)을 이득이 넘지 못한다.

이 결정은 "왜 위젯 단위 PATCH로 안 갔는가"를 기록해, 향후 아키텍처 리뷰가 같은 항목을
재발굴하지 않게 한다.

## 다시 검토할 신호

- 멀티 디바이스/동기화 도입
- AI가 더 길게·자주 비동기로 대시보드를 변경하게 됨
- 사용자가 실제 변경 유실을 보고함

## revisit 시 구현안 (요약)

1. **서버**: 위젯 단위 라우트 추가 —
   `POST/PATCH/DELETE /api/dashboards/:id/widgets[/:widgetId]`,
   `PATCH /api/dashboards/:id/layout`(여러 위젯 layout 일괄). 모두 기존 store 메서드로
   현재 저장본을 read-modify-write 하면 동시 변경이 **병합**된다.
2. **웹**: `DashboardGrid`의 `saveWidgets`(전체 저장)를 위 granular 호출로 교체.
   레이아웃 드래그만 layout 일괄 PATCH 사용.
3. **안전망**: 라우트 테스트 + 동시 변경 병합 검증, 그리고 패키징 앱 GUI 스모크 후 릴리스.
