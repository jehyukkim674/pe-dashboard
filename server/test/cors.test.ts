import { describe, it, expect } from 'vitest';
import { isAllowedOrigin } from '../src/app.js';

describe('isAllowedOrigin (로컬 전용 CORS)', () => {
  it('origin 헤더가 없으면 허용 (동일 출처/비브라우저)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });
  it('localhost/127.0.0.1 출처는 포트와 무관하게 허용', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5174')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:15174')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:5174')).toBe(true);
  });
  it('외부 웹사이트 출처는 차단', () => {
    expect(isAllowedOrigin('https://evil.com')).toBe(false);
    expect(isAllowedOrigin('https://localhost.evil.com')).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1.evil.com')).toBe(false);
    expect(isAllowedOrigin('not-a-url')).toBe(false);
  });
});
