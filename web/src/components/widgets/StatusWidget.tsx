import type { CommandResult } from '../../types';

interface Display {
  labelPath?: string; // 타일 라벨로 쓸 JSON 경로 (예: metadata.name)
  statePath?: string; // 상태 값 경로 (예: status.sync.status)
  okValues?: string;  // 정상으로 간주할 값들 (쉼표 구분, 예: Synced,Healthy)
}

function getPath(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    obj,
  );
}

// JSON 배열을 초록/빨강 상태 타일 그리드로 표시 (ArgoCD 앱 상태 등 모니터링용)
export default function StatusWidget({ result, display }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
}) {
  const d = (display ?? {}) as Display;
  const rows = Array.isArray(result?.json) ? (result.json as unknown[]) : [];
  if (!d.labelPath || !d.statePath) return <div>상태 그리드 설정(labelPath/statePath)이 필요합니다</div>;
  if (rows.length === 0) return <div>데이터 없음</div>;

  const okSet = new Set(
    (d.okValues ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean),
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {rows.map((row, i) => {
        const label = String(getPath(row, d.labelPath!) ?? `#${i + 1}`);
        const state = String(getPath(row, d.statePath!) ?? '?');
        const ok = okSet.size === 0 ? false : okSet.has(state.toLowerCase());
        return (
          <div
            key={`${label}-${i}`}
            title={`${label}: ${state}`}
            style={{
              padding: '6px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.3,
              color: '#fff', background: ok ? '#52c41a' : '#ff4d4f',
              maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {label}
            <span style={{ opacity: 0.85, marginLeft: 6 }}>{state}</span>
          </div>
        );
      })}
    </div>
  );
}
