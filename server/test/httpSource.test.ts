import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { describeFetchError, fetchFollowingRedirects } from '../src/datasources/httpSource.js';

function listen(handler: http.RequestListener): Promise<{ port: number; close: () => void; server: http.Server }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ port, close: () => server.close(), server });
    });
  });
}

describe('describeFetchError', () => {
  it("'fetch failed'이면 e.cause의 실제 원인을 드러낸다", () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' });
    const out = describeFetchError('fetch failed', { cause });
    expect(out).toContain('ECONNREFUSED');
  });
  it('일반 메시지는 그대로 둔다', () => {
    expect(describeFetchError('HTTP 500', {})).toBe('HTTP 500');
  });
});

describe('fetchFollowingRedirects', () => {
  it('교차 출처 리다이렉트 대상에는 프로필 인증 헤더를 전달하지 않는다', async () => {
    let receivedByB: string | undefined = 'NOT_CALLED';
    const b = await listen((req, res) => {
      receivedByB = req.headers['x-api-key'] as string | undefined;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    // A는 다른 포트(=다른 origin)인 B로 리다이렉트한다
    const a = await listen((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${b.port}/final` });
      res.end();
    });

    try {
      const res = await fetchFollowingRedirects(
        `http://127.0.0.1:${a.port}/start`,
        { 'x-api-key': 'super-secret' },
        AbortSignal.timeout(5000),
      );
      expect(res.status).toBe(200);
      // B는 호출됐지만 비밀 헤더는 받지 않았어야 한다
      expect(receivedByB).toBeUndefined();
    } finally {
      a.close();
      b.close();
    }
  });

  it('같은 출처 리다이렉트에는 인증 헤더를 유지한다', async () => {
    let receivedKey: string | undefined;
    let hop = 0;
    const s = await listen((req, res) => {
      if (req.url === '/start') {
        hop++;
        res.writeHead(302, { location: '/next' }); // 같은 출처(상대 경로)
        res.end();
        return;
      }
      receivedKey = req.headers['x-api-key'] as string | undefined;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    try {
      await fetchFollowingRedirects(
        `http://127.0.0.1:${s.port}/start`,
        { 'x-api-key': 'keep-me' },
        AbortSignal.timeout(5000),
      );
      expect(hop).toBe(1);
      expect(receivedKey).toBe('keep-me');
    } finally {
      s.close();
    }
  });
});
