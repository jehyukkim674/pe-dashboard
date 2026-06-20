import { describe, it, expect } from 'vitest';
import { CAPABILITIES, MUTATING_CAPABILITIES, describeCapability } from '../src/ai/capabilities.js';

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
});
