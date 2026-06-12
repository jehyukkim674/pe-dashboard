/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // react-draggable(react-grid-layout 의존)이 런타임에 process.env를 참조한다.
  // 브라우저에는 process가 없어 mousedown 시 ReferenceError로 드래그·리사이즈가 죽는다.
  define: { 'process.env': {} },
  server: {
    port: 5173,
    // dev 서버는 15174 (패키징 앱 5174와 분리 — 동시 실행해도 데이터가 섞이지 않음)
    proxy: { '/api': 'http://localhost:15174' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
