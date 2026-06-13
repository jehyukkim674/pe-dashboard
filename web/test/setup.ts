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

// 이 jsdom 빌드의 localStorage는 메서드가 비어 있어(실브라우저엔 정상) 인메모리로 대체한다
if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') {
  const store = new Map<string, string>();
  const mock: Storage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true });
}
