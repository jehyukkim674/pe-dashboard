import { useEffect, useRef } from 'react';
import type { CommandResult } from '../../types';

export default function LogWidget({ result }: { result?: CommandResult }) {
  const text = result ? result.stdout || result.stderr || '(출력 없음)' : '';
  const ref = useRef<HTMLPreElement>(null);

  // 새 내용이 오면 하단 자동 스크롤 — 단, 사용자가 위로 스크롤해 읽는 중이면 방해하지 않는다
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <pre
      ref={ref}
      style={{
        margin: 0, height: '100%', overflow: 'auto', fontSize: 12, lineHeight: 1.55,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        background: '#1e1e1e', color: '#d4d4d4', padding: '8px 10px', borderRadius: 6,
      }}
    >
      {text}
    </pre>
  );
}
