import { describe, it, expect } from 'vitest';
import { extractJson } from '../src/ai/streamingJson.js';

describe('extractJson', () => {
  it('순수 JSON 객체를 파싱한다', () => {
    expect(extractJson('{"reply":"hi","operations":[]}')).toEqual({ reply: 'hi', operations: [] });
  });

  it('코드펜스로 감싼 JSON을 파싱한다', () => {
    expect(extractJson('```json\n{"reply":"x"}\n```')).toEqual({ reply: 'x' });
  });

  it('유효한 JSON 뒤에 } 를 포함한 설명 문장이 붙어도 객체만 파싱한다', () => {
    // 이전 lastIndexOf('}') 방식은 뒤의 '}' 때문에 파싱에 실패해 대화 턴이 통째로 버려졌다
    const text = '{"reply":"완료"} 참고: 함수 foo() {}는 무시하세요.';
    expect(extractJson(text)).toEqual({ reply: '완료' });
  });

  it('앞에 잡설과 { 가 섞여 있어도 실제 객체를 찾아낸다', () => {
    const text = '설명: 아래 {블록}을 보세요.\n{"reply":"ok","operations":[]}';
    expect(extractJson(text)).toEqual({ reply: 'ok', operations: [] });
  });

  it('문자열 안의 중괄호를 오해하지 않는다', () => {
    expect(extractJson('{"reply":"a } b { c"}')).toEqual({ reply: 'a } b { c' });
  });

  it('JSON이 없으면 예외', () => {
    expect(() => extractJson('그냥 텍스트')).toThrow(/JSON/);
  });
});
