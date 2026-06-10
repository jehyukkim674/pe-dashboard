import type { CommandResult } from '../../types';

export default function LogWidget({ result }: { result?: CommandResult }) {
  const text = result ? result.stdout || result.stderr || '(출력 없음)' : '';
  return (
    <pre style={{
      margin: 0, height: '100%', overflow: 'auto', fontSize: 12,
      background: '#1e1e1e', color: '#d4d4d4', padding: 8, borderRadius: 4,
    }}>
      {text}
    </pre>
  );
}
