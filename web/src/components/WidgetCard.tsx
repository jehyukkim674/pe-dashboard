import { Card } from 'antd';
import type { Widget } from '../types';

export default function WidgetCard({ widget, onRemove }: { widget: Widget; onRemove: () => void }) {
  void onRemove;
  return <Card size="small" title={widget.title} style={{ height: '100%' }} />;
}
