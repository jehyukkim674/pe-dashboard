import { useEffect, useRef, useState } from 'react';
import { Button, Input, Tooltip } from 'antd';
import { SearchOutlined, VerticalAlignBottomOutlined } from '@ant-design/icons';
import type { CommandResult } from '../../types';

// 검색어와 일치하는 부분을 형광 표시 (대소문자 무시)
function highlight(line: string, q: string): React.ReactNode {
  if (!q) return line;
  const lower = line.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (let idx = lower.indexOf(q, from); idx !== -1; idx = lower.indexOf(q, from)) {
    parts.push(line.slice(from, idx));
    parts.push(
      <mark key={idx} style={{ background: '#fadb14', color: '#000', padding: 0 }}>
        {line.slice(idx, idx + q.length)}
      </mark>,
    );
    from = idx + q.length;
  }
  parts.push(line.slice(from));
  return parts;
}

export default function LogWidget({ result }: { result?: CommandResult }) {
  const text = result ? result.stdout || result.stderr || '(출력 없음)' : '';
  const ref = useRef<HTMLPreElement>(null);
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(true); // 맨 아래 고정 (새 내용이 오면 하단으로)

  // grep처럼 일치하는 줄만 남기고, 줄 안의 일치 부분은 하이라이트
  const q = search.trim().toLowerCase();
  const lines = text.split('\n');
  const matched = q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines;

  // 고정이 켜져 있어도 사용자가 위로 스크롤해 읽는 중이면 방해하지 않는다
  useEffect(() => {
    const el = ref.current;
    if (!el || !follow) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [text, follow]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Input
          size="small" allowClear value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="검색" prefix={<SearchOutlined style={{ color: 'rgba(128,128,128,0.6)' }} />}
          style={{ maxWidth: 220 }}
        />
        {q !== '' && (
          <span style={{ fontSize: 11, color: 'rgba(128,128,128,0.85)', whiteSpace: 'nowrap' }}>
            {matched.length}줄
          </span>
        )}
        <Tooltip title="맨 아래 고정">
          <Button
            size="small" type={follow ? 'primary' : 'text'} icon={<VerticalAlignBottomOutlined />}
            onClick={() => setFollow((f) => !f)}
            style={{ marginLeft: 'auto' }}
          />
        </Tooltip>
      </div>
      <pre
        ref={ref}
        style={{
          margin: 0, flex: 1, minHeight: 0, overflow: 'auto', fontSize: 12, lineHeight: 1.55,
          fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
          background: '#1e1e1e', color: '#d4d4d4', padding: '8px 10px', borderRadius: 6,
        }}
      >
        {matched.map((line, i) => (
          <div key={i}>{highlight(line, q)}</div>
        ))}
      </pre>
    </div>
  );
}
