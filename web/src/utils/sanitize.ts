// 신뢰 경계 안(우리 릴리스 노트, 로컬 AI 응답)의 HTML을 렌더링하기 전 방어적으로
// 스크립트·이벤트 핸들러를 제거한다.
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}
