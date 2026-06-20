import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// web/src/types.ts와 server/src/types.ts는 "수동 동기화" 컨벤션이다(CLAUDE.md).
// 이 가드는 두 파일이 공유해야 하는 도메인 타입이 어긋나면(한쪽만 수정) 실패시킨다.
// ChatEvent는 web이 'done'을 더 갖는 등 의도적으로 다르므로 범위에서 제외한다.

const here = path.dirname(fileURLToPath(import.meta.url));
const serverTypes = readFileSync(path.join(here, '../src/types.ts'), 'utf8');
const webTypes = readFileSync(path.join(here, '../../web/src/types.ts'), 'utf8');

// 양쪽이 글자까지 같아야 하는 도메인 타입들
const SHARED = [
  'WidgetType', 'WidgetLayout', 'WidgetDataSource', 'WidgetAlert', 'Widget',
  'Dashboard', 'CommandTemplate', 'DiagnosisCategory', 'Diagnosis', 'CommandResult',
];

// 주석을 먼저 제거한다 — 주석 안의 `}`(예: argv 예시 "{repo}")가 중괄호 매칭을 끊지 않도록.
function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, '');
}

function normalize(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

// 이름으로 interface 또는 type 별칭 선언 본문을 뽑는다. (이 도메인 타입들엔 중첩 중괄호가 없다.)
function declOf(src: string, name: string): string | undefined {
  const clean = stripComments(src);
  const iface = new RegExp(`export interface ${name}\\b\\s*\\{([^}]*)\\}`).exec(clean);
  if (iface) return normalize(iface[1]);
  const alias = new RegExp(`export type ${name}\\b\\s*=([^;]*);`).exec(clean);
  if (alias) return normalize(alias[1]);
  return undefined;
}

describe('web/server types.ts 수동 동기화 가드', () => {
  it.each(SHARED)('도메인 타입 "%s"이(가) 양쪽에서 동일하다', (name) => {
    const s = declOf(serverTypes, name);
    const w = declOf(webTypes, name);
    expect(s, `server/src/types.ts에 ${name} 선언이 없습니다`).toBeDefined();
    expect(w, `web/src/types.ts에 ${name} 선언이 없습니다`).toBeDefined();
    expect(w).toBe(s);
  });

  // 가드가 실제로 드리프트를 잡는지 자체 검증 (메커니즘이 무력화되지 않게)
  it('필드 타입이 다르면 드리프트로 검출한다', () => {
    const a = 'export interface X { a: string; }';
    const b = 'export interface X { a: number; }';
    expect(declOf(a, 'X')).not.toBe(declOf(b, 'X'));
  });
});
