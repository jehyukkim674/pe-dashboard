import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Card, Modal, Popconfirm, Select, Skeleton, Spin, Tooltip, message } from 'antd';
import {
  CopyOutlined, DeleteOutlined, EditOutlined, ExpandOutlined, FullscreenOutlined, ReloadOutlined,
} from '@ant-design/icons';
import type { Widget } from '../types';
import { relativeTime, useNow, useWidgetData } from '../hooks/useWidgetData';
import WidgetEditModal, { type WidgetDraft } from './WidgetEditModal';
import StatWidget from './widgets/StatWidget';
import TableWidget from './widgets/TableWidget';
import LogWidget from './widgets/LogWidget';
import TextWidget from './widgets/TextWidget';
// recharts는 무겁고 차트 위젯에서만 쓰므로 지연 로드 — 차트가 없으면 번들에서 빠진다
const ChartWidget = lazy(() => import('./widgets/ChartWidget'));
import StatusWidget from './widgets/StatusWidget';

// 자동 갱신 주기 선택지. value 0 = 자동 갱신 없음(수동만)
// 알림 권한 거부 안내는 세션당 1회만
let notifiedPermissionDenied = false;
function warnNotificationDenied(): void {
  if (notifiedPermissionDenied) return;
  notifiedPermissionDenied = true;
  void message.warning(
    '조건이 충족됐지만 macOS 알림 권한이 꺼져 있습니다. 시스템 설정 → 알림에서 PE Dashboard를 허용하세요.',
    6,
  );
}

const REFRESH_OPTIONS = [
  { value: 0, label: '수동' },
  { value: 10, label: '10초' },
  { value: 20, label: '20초' },
  { value: 30, label: '30초' },
  { value: 60, label: '1분' },
  { value: 300, label: '5분' },
];

export default function WidgetCard({ widget, onRemove, onChangeRefresh, onEdit, onDuplicate, onChangeDisplay, highlight }: {
  widget: Widget;
  onRemove: () => void;
  onChangeRefresh: (refreshSec?: number) => void;
  onEdit: (draft: WidgetDraft) => void;
  onDuplicate: () => void;
  onChangeDisplay?: (display: Record<string, unknown>) => void;
  highlight?: boolean;
}) {
  const { result, lastGood, loading, reload, updatedAt, lastGoodAt } = useWidgetData(widget.dataSource);
  const [editOpen, setEditOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const now = useNow();

  // 신선도: 명령이 계속 실패해 직전 정상 데이터를 보여줄 때, 그 데이터가 얼마나 오래됐는지.
  // 갱신 주기의 3배(최소 2분)를 넘으면 '오래됨'으로 보고 본문을 흐리게 + 경고를 띄운다.
  const refreshSecVal = widget.dataSource?.refreshSec ?? 0;
  const staleThresholdMs = Math.max((refreshSecVal || 30) * 3, 120) * 1000;
  const staleAgeMs = result?.ok === false && lastGoodAt ? now - lastGoodAt : 0;
  const isStale = staleAgeMs > staleThresholdMs;

  // AI가 설정한 비표준 주기(예: 15초)도 select에 그대로 보이게 동적 옵션 추가
  const refreshSec = widget.dataSource?.refreshSec ?? 0;
  const refreshOptions = REFRESH_OPTIONS.some((o) => o.value === refreshSec)
    ? REFRESH_OPTIONS
    : [...REFRESH_OPTIONS, { value: refreshSec, label: `${refreshSec}초` }]
        .sort((a, b) => a.value - b.value);

  // 조건 알림: 조건이 '불충족→충족'으로 바뀌는 순간에만 1회 발송 (폴링마다 반복 금지)
  const alertedRef = useRef(false);
  useEffect(() => {
    const rule = widget.alert;
    if (!rule || !result || typeof Notification === 'undefined') return;
    const matched = rule.on === 'fail'
      ? !result.ok
      : !!rule.pattern && (result.stdout + result.stderr).includes(rule.pattern);
    if (matched && !alertedRef.current) {
      if (Notification.permission === 'default') void Notification.requestPermission();
      if (Notification.permission === 'denied') {
        warnNotificationDenied();
      } else {
        new Notification(`PE Dashboard — ${widget.title}`, {
          body: rule.on === 'fail'
            ? (result.error ?? '명령이 실패했습니다')
            : `출력에 "${rule.pattern}" 가 포함되었습니다`,
        });
      }
    }
    alertedRef.current = matched;
  }, [result, widget.alert, widget.title]);

  // 실패해도 직전 정상 데이터를 계속 보여주고, 에러는 상단의 컴팩트 배너로 알린다
  const shown = result?.ok === false && lastGood ? lastGood : result;
  const errorBanner = result?.error && (
    <div
      title={result.stderr || result.error}
      style={{
        flexShrink: 0, fontSize: 11, color: '#fff', background: '#ff4d4f',
        borderRadius: 4, padding: '2px 8px', marginBottom: 6,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
    >
      {result.diagnosis ? `${result.diagnosis.label} · ${result.error}` : result.error}
    </div>
  );

  const body = (() => {
    if (widget.type === 'text') return <TextWidget display={widget.display} />;
    if (loading && !shown) return <Skeleton active title={false} paragraph={{ rows: 3 }} />;
    if (shown?.error && !lastGood) {
      return (
        <Alert
          type="warning"
          showIcon
          message={shown.diagnosis?.label ?? '실패'}
          description={
            <div style={{ fontSize: 12 }}>
              <div>{shown.error}</div>
              {shown.stderr && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', color: '#888' }}>원문 보기</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '4px 0 0', fontSize: 11 }}>
                    {shown.stderr.slice(0, 1000)}
                  </pre>
                </details>
              )}
            </div>
          }
        />
      );
    }
    switch (widget.type) {
      case 'stat': return <StatWidget result={shown} display={widget.display} widgetId={widget.id} updatedAt={updatedAt} />;
      case 'table': return <TableWidget result={shown} display={widget.display} onDisplayChange={onChangeDisplay} />;
      case 'chart': return (
        <Suspense fallback={<Skeleton active title={false} paragraph={{ rows: 3 }} />}>
          <ChartWidget result={shown} display={widget.display} />
        </Suspense>
      );
      case 'log': return <LogWidget result={shown} />;
      case 'status': return <StatusWidget result={shown} display={widget.display} />;
    }
  })();

  return (
    <Card
      size="small"
      className={highlight ? 'widget-new' : undefined}
      title={widget.alert ? `🔔 ${widget.title}` : widget.title}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      styles={{ body: { flex: 1, overflow: 'hidden' } }}
      extra={
        // widget-actions: 그리드 드래그(draggableCancel)에서 제외해 클릭이 동작하게 한다
        <span className="widget-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {/* 평소엔 갱신 시각만 보이고 나머지 액션은 카드에 마우스를 올렸을 때 표시 */}
          <span className="hover-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {widget.dataSource && (
              <Select
                size="small" style={{ width: 72 }}
                value={refreshSec}
                options={refreshOptions}
                onChange={(sec) => onChangeRefresh(sec === 0 ? undefined : sec)}
                title="자동 갱신 주기"
              />
            )}
            {!loading && widget.dataSource && (
              <Tooltip title="지금 새로고침">
                <ReloadOutlined onClick={reload} style={{ cursor: 'pointer' }} />
              </Tooltip>
            )}
            {widget.dataSource && (
              <Tooltip title="원본 데이터 보기">
                <ExpandOutlined onClick={() => setRawOpen(true)} style={{ cursor: 'pointer' }} />
              </Tooltip>
            )}
            <Tooltip title="전체화면으로 보기">
              <FullscreenOutlined onClick={() => setFullscreen(true)} style={{ cursor: 'pointer' }} />
            </Tooltip>
            <Tooltip title="위젯 편집">
              <EditOutlined onClick={() => setEditOpen(true)} style={{ cursor: 'pointer' }} />
            </Tooltip>
            <Tooltip title="복제">
              <CopyOutlined onClick={onDuplicate} style={{ cursor: 'pointer' }} />
            </Tooltip>
            <Popconfirm title="위젯을 삭제할까요?" onConfirm={onRemove} okText="삭제" cancelText="취소">
              <DeleteOutlined style={{ cursor: 'pointer' }} />
            </Popconfirm>
          </span>
          {loading && <Spin size="small" />}
          {widget.dataSource && updatedAt && (
            <Tooltip title="마지막 갱신 시각">
              <span style={{ fontSize: 11, color: 'rgba(128,128,128,0.85)', fontVariantNumeric: 'tabular-nums' }}>
                {new Date(updatedAt).toTimeString().slice(0, 8)}
              </span>
            </Tooltip>
          )}
        </span>
      }
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {lastGood && errorBanner}
        {isStale && (
          <div
            style={{
              flexShrink: 0, fontSize: 11, color: '#fff', background: '#faad14',
              borderRadius: 4, padding: '2px 8px', marginBottom: 6,
            }}
          >
            ⚠ 오래된 데이터 — 마지막 정상 {lastGoodAt && relativeTime(lastGoodAt, now)}
          </div>
        )}
        {/* 오래된 데이터는 흐리게 처리해 '지금 값'이 아님을 한눈에 알린다 */}
        <div
          className="widget-body"
          style={{ flex: 1, minHeight: 0, overflow: 'auto', opacity: isStale ? 0.5 : 1 }}
        >
          {body}
        </div>
        {widget.dataSource && updatedAt && (
          <div
            style={{
              flexShrink: 0, fontSize: 11, textAlign: 'right', paddingTop: 2,
              color: result?.ok === false ? '#ff4d4f' : 'rgba(128,128,128,0.65)',
            }}
          >
            {result?.ok === false ? '실패' : '정상'} · {relativeTime(updatedAt, now)} 갱신
          </div>
        )}
      </div>
      {editOpen && (
        <WidgetEditModal widget={widget} onClose={() => setEditOpen(false)} onSave={onEdit} />
      )}
      {fullscreen && (
        <Modal
          title={widget.title} open onCancel={() => setFullscreen(false)}
          footer={null} width="92vw" centered
          styles={{ body: { height: '80vh', overflow: 'auto' } }}
        >
          {/* 카드와 같은 라이브 데이터를 큰 화면으로 — 넓은 테이블·차트 확인용 */}
          <div style={{ height: '100%' }}>{body}</div>
        </Modal>
      )}
      {rawOpen && (
        <Modal
          title={`원본 데이터 — ${widget.title}`} open onCancel={() => setRawOpen(false)}
          footer={null} width={720}
        >
          <pre style={{ maxHeight: '60vh', overflow: 'auto', fontSize: 12, margin: 0 }}>
            {shown?.json !== undefined
              ? JSON.stringify(shown.json, null, 2)
              : (shown?.stdout || shown?.stderr || '(데이터 없음)')}
          </pre>
        </Modal>
      )}
    </Card>
  );
}
