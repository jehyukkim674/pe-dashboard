import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest globals를 안 쓰므로 testing-library 자동 cleanup이 동작하지 않는다 — 직접 등록
afterEach(cleanup);

// antd가 jsdom에 없는 브라우저 API를 사용하므로 최소한으로 채운다
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
