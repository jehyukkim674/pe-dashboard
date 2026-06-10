import { Alert, Card, Popconfirm, Spin } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Widget } from '../types';
import { useWidgetData } from '../hooks/useWidgetData';
import StatWidget from './widgets/StatWidget';
import TableWidget from './widgets/TableWidget';
import ChartWidget from './widgets/ChartWidget';
import LogWidget from './widgets/LogWidget';
import TextWidget from './widgets/TextWidget';

export default function WidgetCard({ widget, onRemove }: {
  widget: Widget;
  onRemove: () => void;
}) {
  const { result, loading } = useWidgetData(widget.dataSource);

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
        <span>
          {loading && <Spin size="small" style={{ marginRight: 8 }} />}
          {!loading && widget.dataSource && <ReloadOutlined style={{ marginRight: 8, opacity: 0.4 }} />}
          <Popconfirm title="위젯을 삭제할까요?" onConfirm={onRemove} okText="삭제" cancelText="취소">
            <DeleteOutlined />
          </Popconfirm>
        </span>
      }
    >
      <div className="widget-body" style={{ height: '100%', overflow: 'auto' }}>{body}</div>
    </Card>
  );
}
