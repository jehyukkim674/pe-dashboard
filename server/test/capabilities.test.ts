import { describe, it, expect } from 'vitest';
import { CAPABILITIES, MUTATING_CAPABILITIES, describeCapability, buildOperationExamples } from '../src/ai/capabilities.js';

describe('capability catalog (single source)', () => {
  it('each entry definition name matches the entry name', () => {
    for (const c of CAPABILITIES) {
      expect(c.definition.name).toBe(c.name);
    }
  });

  it('marks exactly the mutating capabilities, excludes read-only ones', () => {
    // 변경성 = 조회 전용 모드에서 숨기고 차단할 능력
    expect([...MUTATING_CAPABILITIES].sort()).toEqual(
      ['add_widget', 'create_dashboard', 'delete_dashboard', 'register_command', 'remove_widget', 'set_alert', 'update_widget'],
    );
    expect(MUTATING_CAPABILITIES.has('list_dashboards')).toBe(false);
    expect(MUTATING_CAPABILITIES.has('list_commands')).toBe(false);
    expect(MUTATING_CAPABILITIES.has('run_command_preview')).toBe(false);
  });

  it('describes tool calls as korean chips, falling back to the name', () => {
    expect(describeCapability('create_dashboard', { name: '배포' })).toBe("대시보드 '배포' 생성");
    expect(describeCapability('add_widget', { widget: { title: '실패 수' } })).toBe("위젯 '실패 수' 추가");
    expect(describeCapability('register_command', { id: 'k_ctx' })).toBe("명령 'k_ctx' 등록 요청");
    expect(describeCapability('run_command_preview', { commandId: 'gh_run_list' })).toBe('명령 미리 실행 (gh_run_list)');
    // 별도 요약이 없는 능력·미등록 이름은 이름 그대로
    expect(describeCapability('list_dashboards', {})).toBe('list_dashboards');
    expect(describeCapability('unknown_tool', {})).toBe('unknown_tool');
  });

  // 골든 스냅샷: 프롬프트로 가는 operations 예시가 기존 하드코딩 텍스트와 byte-identical임을 잠근다.
  // 이 배열이 바뀌면 모델 입력이 바뀐 것이므로 의도적 변경일 때만 갱신할 것.
  it('buildOperationExamples가 기존 프롬프트 operations 줄을 정확히 재현한다', () => {
    expect(buildOperationExamples()).toEqual([
      '  {"op":"create_dashboard","name":"이름"},',
      '  {"op":"delete_dashboard","id":"대시보드ID"},',
      '  {"op":"add_widget","dashboardId":"대시보드ID 또는 $last","widget":{"type":"stat|table|chart|log|text|status","title":"제목","layout":{"x":0,"y":0,"w":3,"h":2},"dataSource":{"kind":"cli","commandId":"명령ID","params":{},"refreshSec":30},"display":{}}},',
      '  {"op":"update_widget","dashboardId":"...","widgetId":"...","patch":{}},',
      '  {"op":"remove_widget","dashboardId":"...","widgetId":"..."},',
      '  {"op":"set_alert","dashboardId":"...","widgetId":"...","alert":{"on":"fail"|"contains","pattern":"포함문자열"}},',
      '  {"op":"register_command","id":"...","description":"...","argv":["cmd","{param}"],"params":["param"]}',
    ]);
  });
});
