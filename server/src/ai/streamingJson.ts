import type { Operation } from './operations.js';

// claude CLI 응답 파싱(스트리밍 진행형 + 최종) 전용 순수 함수 모음.
// claudeCliAdapter에서 분리해 어댑터는 오케스트레이션에, 여기는 파싱에 집중한다.

export interface InspectRequest { tool?: string; input?: unknown }

export interface ParsedResponse {
  reply?: string;
  operations?: Operation[];
  inspect?: InspectRequest[];
}

// 스트리밍 중인 모델 출력(완성 전 JSON 문자열)에서 지금까지의 reply 값만 언이스케이프해 뽑는다.
// 표시 전용 — operations는 최종 완성 텍스트를 extractJson으로 파싱해 적용하므로 여기 정확성은 무관.
export function extractReplyText(partial: string): string {
  const s = partial.replace(/^\s*```(?:json)?\s*/i, '');
  const m = /"reply"\s*:\s*"/.exec(s);
  if (!m) return '';
  let out = '';
  for (let i = m.index + m[0].length; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') break; // reply 문자열의 끝
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    if (i + 1 >= s.length) break; // 백슬래시가 마지막 — 미완성 이스케이프, 다음 청크를 기다린다
    const next = s[i + 1];
    const simple: Record<string, string> = {
      n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f',
    };
    if (next === 'u') {
      const hex = s.slice(i + 2, i + 6);
      if (hex.length < 4) break; // 미완성 \uXXXX
      out += /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : next;
      i += /^[0-9a-fA-F]{4}$/.test(hex) ? 5 : 1;
    } else {
      out += simple[next] ?? next;
      i += 1;
    }
  }
  return out;
}

// 문자열/이스케이프를 고려해 open 위치의 '{'와 짝이 맞는 '}'의 인덱스를 찾는다. 없으면 -1.
function matchingBrace(s: string, open: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// 코드펜스(```json ... ```)나 앞뒤 잡설이 섞여 있어도 JSON 객체를 찾아 파싱한다.
// 각 '{' 후보에서 '괄호 균형이 맞는' 닫는 '}'를 찾아 그 범위만 파싱한다 —
// 유효한 JSON 뒤에 '}'가 포함된 설명 문장이 붙어도(lastIndexOf('}') 방식이 실패하던 케이스)
// 객체 본문만 정확히 잘라내 파싱한다.
export function extractJson(text: string): ParsedResponse {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  let start = candidate.indexOf('{');
  while (start >= 0) {
    const end = matchingBrace(candidate, start);
    if (end >= 0) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as ParsedResponse;
      } catch {
        // 이 '{'로 시작하는 범위는 JSON이 아니었다 — 다음 후보로
      }
    }
    start = candidate.indexOf('{', start + 1);
  }
  throw new Error('JSON 객체를 찾지 못했습니다');
}
