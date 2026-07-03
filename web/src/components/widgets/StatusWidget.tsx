import type { CommandResult } from '../../types';
import type { StatusDisplay } from './widgetTypes';
import { getPath } from '../../utils/json';
import { asRows } from '../../utils/commandResult';

// JSON 배열을 초록/빨강 상태 타일 그리드로 표시 (ArgoCD 앱 상태 등 모니터링용)
export default function StatusWidget({ result, display }: {
  result?: CommandResult;
  display?: Record<string, unknown>;
}) {
  const d = (display ?? {}) as StatusDisplay;
  const rows = asRows<unknown>(result, d.rowsPath);
  if (!d.labelPath || !d.statePath) return <div>상태 그리드 설정(labelPath/statePath)이 필요합니다</div>;
  if (rows.length === 0) return <div>데이터 없음</div>;

  const okSet = new Set(
    (d.okValues ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean),
  );
  // okValues가 설정되지 않았으면 정상/이상을 판정할 수 없다. 이때 모든 타일을 빨강으로
  // 칠하면 '전체 장애'라는 잘못된 신호가 되므로, 판정 불가는 중립(회색)으로 표시한다.
  const configured = okSet.size > 0;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {rows.map((row, i) => {
        const label = String(getPath(row, d.labelPath!) ?? `#${i + 1}`);
        const state = String(getPath(row, d.statePath!) ?? '?');
        const ok = okSet.has(state.toLowerCase());
        const background = !configured ? '#8c8c8c' : ok ? '#52c41a' : '#ff4d4f';
        return (
          <div
            key={`${label}-${i}`}
            title={configured ? `${label}: ${state}` : `${label}: ${state} (okValues 미설정 — 판정 불가)`}
            style={{
              padding: '6px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.3,
              color: '#fff', background,
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
