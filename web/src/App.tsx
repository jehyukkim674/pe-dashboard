import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Layout, Menu, Modal, Typography, FloatButton } from 'antd';
import { CommentOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from './api';
import type { Dashboard } from './types';
import DashboardGrid from './components/DashboardGrid';
import ChatDrawer from './components/ChatDrawer';

export default function App() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [chatOpen, setChatOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async (selectId?: string) => {
    const list = await api.listDashboards();
    setDashboards(list);
    setSelectedId((prev) => {
      const target = selectId ?? prev;
      return list.some((d) => d.id === target) ? target : list[0]?.id;
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const selected = dashboards.find((d) => d.id === selectedId);

  const createDashboard = async () => {
    if (!newName.trim()) return;
    const d = await api.createDashboard(newName.trim());
    setCreating(false);
    setNewName('');
    await refresh(d.id);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="light" width={220}>
        <Typography.Title level={4} style={{ padding: '16px 16px 0' }}>
          PE Dashboard
        </Typography.Title>
        <Menu
          mode="inline"
          selectedKeys={selectedId ? [selectedId] : []}
          items={dashboards.map((d) => ({ key: d.id, label: d.name }))}
          onClick={(e) => setSelectedId(e.key)}
        />
        <Button
          type="dashed" icon={<PlusOutlined />} block
          style={{ width: 'calc(100% - 32px)', margin: 16 }}
          onClick={() => setCreating(true)}
        >
          새 대시보드
        </Button>
      </Layout.Sider>

      <Layout.Content style={{ padding: 16, background: '#f5f5f5' }}>
        {selected ? (
          <DashboardGrid dashboard={selected} onChanged={() => refresh()} />
        ) : (
          <Empty description="대시보드가 없습니다. 채팅으로 '배포 대시보드 만들어줘'라고 말해보세요." />
        )}
      </Layout.Content>

      <FloatButton
        icon={<CommentOutlined />} type="primary"
        tooltip="AI 채팅" onClick={() => setChatOpen(true)}
      />
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} onDashboardsChanged={refresh} />

      <Modal
        title="새 대시보드" open={creating} onOk={createDashboard}
        onCancel={() => setCreating(false)} okText="만들기" cancelText="취소"
      >
        <Input
          placeholder="이름 (예: 배포 현황)" value={newName} autoFocus
          onChange={(e) => setNewName(e.target.value)} onPressEnter={createDashboard}
        />
      </Modal>
    </Layout>
  );
}
