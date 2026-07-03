// 신뢰 경계 안(우리 릴리스 노트, 로컬 AI 응답)의 HTML을 렌더링하기 전 방어적으로
// 스크립트·이벤트 핸들러를 제거한다.
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    // 이벤트 핸들러 제거. HTML은 속성 구분자로 공백뿐 아니라 '/'도 허용하므로
    // (<img/onerror=alert(1)>) 선행 문자를 [\s/]로 넓혀 우회를 막는다.
    .replace(/[\s/]on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}
