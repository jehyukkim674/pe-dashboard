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

// 코드펜스(```json ... ```)나 앞뒤 잡설이 섞여 있어도 JSON 객체를 찾아 파싱한다.
// 잡설에 '{'가 섞인 경우를 대비해, 각 '{' 후보 위치에서 마지막 '}'까지 파싱을 시도한다.
export function extractJson(text: string): ParsedResponse {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const end = candidate.lastIndexOf('}');
  let start = candidate.indexOf('{');
  while (start >= 0 && start < end) {
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as ParsedResponse;
    } catch {
      start = candidate.indexOf('{', start + 1);
    }
  }
  throw new Error('JSON 객체를 찾지 못했습니다');
}
