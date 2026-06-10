import { Drawer } from 'antd';

interface Props {
  open: boolean;
  onClose: () => void;
  onDashboardsChanged: () => void;
}

export default function ChatDrawer({ open, onClose }: Props) {
  return <Drawer title="AI 채팅" open={open} onClose={onClose} width={420} />;
}
