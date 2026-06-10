import { Card } from 'antd';
import type { Widget } from '../types';

export default function WidgetCard({ widget, onRemove }: { widget: Widget; onRemove: () => void }) {
  void onRemove; // TODO(Task 11): 실제 렌더러로 교체 시 삭제 버튼에 연결
  return <Card size="small" title={widget.title} style={{ height: '100%' }} />;
}
