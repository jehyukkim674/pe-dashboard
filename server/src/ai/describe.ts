// 도구 호출을 채팅 액션 칩에 표시할 한국어 한 줄 요약으로 변환한다.
export function describeToolCall(name: string, input: unknown): string {
  const i = input as Record<string, unknown>;
  switch (name) {
    case 'create_dashboard': return `대시보드 '${String(i['name'])}' 생성`;
    case 'delete_dashboard': return `대시보드 삭제 (${String(i['id'])})`;
    case 'add_widget': return `위젯 '${String((i['widget'] as Record<string, unknown>)?.['title'])}' 추가`;
    case 'update_widget': return `위젯 수정 (${String(i['widgetId'])})`;
    case 'remove_widget': return `위젯 삭제 (${String(i['widgetId'])})`;
    case 'register_command': return `명령 '${String(i['id'])}' 등록 요청`;
    case 'run_command_preview': return `명령 미리 실행 (${String(i['commandId'])})`;
    default: return name;
  }
}
