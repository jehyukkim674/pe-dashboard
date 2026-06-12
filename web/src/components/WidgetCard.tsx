import { useEffect, useRef, useState } from 'react';
import { Alert, Card, Popconfirm, Select, Spin, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Widget } from '../types';
import { relativeTime, useNow, useWidgetData } from '../hooks/useWidgetData';
import WidgetEditModal, { type WidgetDraft } from './WidgetEditModal';
import StatWidget from './widgets/StatWidget';
import TableWidget from './widgets/TableWidget';
import ChartWidget from './widgets/ChartWidget';
import LogWidget from './widgets/LogWidget';
import TextWidget from './widgets/TextWidget';

// 자동 갱신 주기 선택지. value 0 = 자동 갱신 없음(수동만)
const REFRESH_OPTIONS = [
  { value: 0, label: '수동' },
  { value: 10, label: '10초' },
  { value: 20, label: '20초' },
  { value: 30, label: '30초' },
  { value: 60, label: '1분' },
  { value: 300, label: '5분' },
];

export default function WidgetCard({ widget, onRemove, onChangeRefresh, onEdit }: {
  widget: Widget;
  onRemove: () => void;
  onChangeRefresh: (refreshSec?: number) => void;
  onEdit: (draft: WidgetDraft) => void;
}) {
  const { result, loading, reload, updatedAt } = useWidgetData(widget.dataSource);
  const [editOpen, setEditOpen] = useState(false);
  const now = useNow();

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
      if (Notification.permission !== 'denied') {
        new Notification(`PE Dashboard — ${widget.title}`, {
          body: rule.on === 'fail'
            ? (result.error ?? '명령이 실패했습니다')
            : `출력에 "${rule.pattern}" 가 포함되었습니다`,
        });
      }
    }
    alertedRef.current = matched;
  }, [result, widget.alert, widget.title]);

  const body = (() => {
    if (widget.type === 'text') return <TextWidget display={widget.display} />;
    if (result?.error) {
      return <Alert type="warning" showIcon message={result.error} style={{ fontSize: 12 }} />;
    }
    switch (widget.type) {
      case 'stat': return <StatWidget result={result} display={widget.display} />;
      case 'table': return <TableWidget result={result} display={widget.display} />;
      case 'chart': return <ChartWidget result={result} display={widget.display} />;
      case 'log': return <LogWidget result={result} />;
    }
  })();

  return (
    <Card
      size="small" title={widget.title}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      styles={{ body: { flex: 1, overflow: 'hidden' } }}
      extra={
        // widget-actions: 그리드 드래그(draggableCancel)에서 제외해 클릭이 동작하게 한다
        <span className="widget-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {widget.dataSource && (
            <Select
              size="small" style={{ width: 72 }}
              value={widget.dataSource.refreshSec ?? 0}
              options={REFRESH_OPTIONS}
              onChange={(sec) => onChangeRefresh(sec === 0 ? undefined : sec)}
              title="자동 갱신 주기"
            />
          )}
          {widget.dataSource && updatedAt && (
            <Tooltip title="마지막 갱신 시각">
              <span style={{ fontSize: 11, color: 'rgba(128,128,128,0.85)', fontVariantNumeric: 'tabular-nums' }}>
                {new Date(updatedAt).toTimeString().slice(0, 8)}
              </span>
            </Tooltip>
          )}
          {loading && <Spin size="small" />}
          {!loading && widget.dataSource && (
            <Tooltip title="지금 새로고침">
              <ReloadOutlined onClick={reload} style={{ cursor: 'pointer' }} />
            </Tooltip>
          )}
          <Tooltip title="위젯 편집">
            <EditOutlined onClick={() => setEditOpen(true)} style={{ cursor: 'pointer' }} />
          </Tooltip>
          <Popconfirm title="위젯을 삭제할까요?" onConfirm={onRemove} okText="삭제" cancelText="취소">
            <DeleteOutlined style={{ cursor: 'pointer' }} />
          </Popconfirm>
        </span>
      }
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="widget-body" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{body}</div>
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
    </Card>
  );
}
