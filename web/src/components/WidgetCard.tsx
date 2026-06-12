import { useState } from 'react';
import { Alert, Card, Popconfirm, Select, Spin, Tooltip } from 'antd';
import { CodeOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Widget, WidgetDataSource } from '../types';
import { useWidgetData } from '../hooks/useWidgetData';
import WidgetSourceModal from './WidgetSourceModal';
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

export default function WidgetCard({ widget, onRemove, onChangeRefresh, onChangeDataSource }: {
  widget: Widget;
  onRemove: () => void;
  onChangeRefresh: (refreshSec?: number) => void;
  onChangeDataSource: (ds: WidgetDataSource) => void;
}) {
  const { result, loading, reload } = useWidgetData(widget.dataSource);
  const [sourceOpen, setSourceOpen] = useState(false);

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
          {loading && <Spin size="small" />}
          {!loading && widget.dataSource && (
            <Tooltip title="지금 새로고침">
              <ReloadOutlined onClick={reload} style={{ cursor: 'pointer' }} />
            </Tooltip>
          )}
          {widget.dataSource && (
            <Tooltip title="실행 명령 보기·수정">
              <CodeOutlined onClick={() => setSourceOpen(true)} style={{ cursor: 'pointer' }} />
            </Tooltip>
          )}
          <Popconfirm title="위젯을 삭제할까요?" onConfirm={onRemove} okText="삭제" cancelText="취소">
            <DeleteOutlined style={{ cursor: 'pointer' }} />
          </Popconfirm>
        </span>
      }
    >
      <div className="widget-body" style={{ height: '100%', overflow: 'auto' }}>{body}</div>
      {sourceOpen && widget.dataSource && (
        <WidgetSourceModal
          dataSource={widget.dataSource}
          onClose={() => setSourceOpen(false)}
          onSave={onChangeDataSource}
        />
      )}
    </Card>
  );
}
