/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // react-draggable(react-grid-layout 의존)이 런타임에 process.env를 참조한다.
  // 브라우저에는 process가 없어 mousedown 시 ReferenceError로 드래그·리사이즈가 죽는다.
  define: { 'process.env': {} },
  build: {
    // 앱 코드는 ~100KB로 분리됐고 recharts는 lazy. 남는 큰 청크는 antd(~1MB) 단일 라이브러리뿐이라
    // 더 쪼갤 수 없다 — 그 크기를 한계로 잡아 거짓 경고를 끈다(antd가 사실상의 하한).
    chunkSizeWarningLimit: 1100,
    // 무거운 벤더(antd·grid)를 별도 청크로 분리 — 캐시 분리·초기 파싱 부담 분산.
    // recharts는 ChartWidget을 lazy import하므로 이미 자동으로 빠진다.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[/\\](antd|@ant-design|rc-[^/\\]+)[/\\]/.test(id)) return 'antd';
          if (/[/\\]react-(grid-layout|draggable|resizable)[/\\]/.test(id)) return 'grid';
          if (/[/\\](react|react-dom|scheduler)[/\\]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
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
