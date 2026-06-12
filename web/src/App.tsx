import { useCallback, useEffect, useState } from 'react';
import { Button, ConfigProvider, Empty, Input, Layout, Menu, message, Modal, Popconfirm, Typography, FloatButton, theme as antdTheme } from 'antd';
import {
  BulbOutlined, CommentOutlined, DeleteOutlined, EditOutlined, FullscreenOutlined,
  FullscreenExitOutlined, PlusOutlined, SyncOutlined,
} from '@ant-design/icons';
import { api } from './api';
import type { Dashboard } from './types';
import DashboardGrid from './components/DashboardGrid';
import ChatDrawer from './components/ChatDrawer';
import UpdateModal from './components/UpdateModal';

export default function App() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [chatOpen, setChatOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const [submitting, setSubmitting] = useState(false);
  const [updateCheckCount, setUpdateCheckCount] = useState(0);
  const [dark, setDark] = useState(() => localStorage.getItem('pe-dark') === '1');
  const [tvMode, setTvMode] = useState(false);

  const toggleDark = () => {
    setDark((d) => {
      localStorage.setItem('pe-dark', d ? '0' : '1');
      return !d;
    });
  };

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
    void refresh().catch((e) => void message.error(`목록 조회 실패: ${(e as Error).message}`));
  }, [refresh]);

  const selected = dashboards.find((d) => d.id === selectedId);

  const createDashboard = async () => {
    if (!newName.trim() || submitting) return;
    setSubmitting(true);
    try {
      const d = await api.createDashboard(newName.trim());
      setCreating(false);
      setNewName('');
      await refresh(d.id);
    } catch (e) {
      void message.error(`대시보드 생성 실패: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const renameDashboard = async () => {
    if (!renaming?.name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const target = dashboards.find((d) => d.id === renaming.id);
      if (target) await api.saveDashboard({ ...target, name: renaming.name.trim() });
      setRenaming(undefined);
      await refresh(renaming.id);
    } catch (e) {
      void message.error(`이름 변경 실패: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteDashboard = async (id: string) => {
    try {
      await api.deleteDashboard(id);
      await refresh();
    } catch (e) {
      void message.error(`대시보드 삭제 실패: ${(e as Error).message}`);
    }
  };

  return (
    <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}>
    <Layout style={{ minHeight: '100vh' }}>
      {!tvMode && (
      <Layout.Sider theme="light" width={220}>
        <Typography.Title level={4} style={{ padding: '16px 16px 0' }}>
          PE Dashboard
        </Typography.Title>
        <Menu
          mode="inline"
          selectedKeys={selectedId ? [selectedId] : []}
          items={dashboards.map((d) => ({
            key: d.id,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                {/* 액션 클릭이 메뉴 선택으로 번지지 않게 막는다 */}
                <span
                  onClick={(e) => e.stopPropagation()}
                  style={{ flexShrink: 0, marginLeft: 8, opacity: 0.55 }}
                >
                  <EditOutlined
                    title="이름 변경"
                    onClick={() => setRenaming({ id: d.id, name: d.name })}
                    style={{ marginRight: 8 }}
                  />
                  <Popconfirm
                    title={`'${d.name}' 대시보드를 삭제할까요?`}
                    description="위젯도 함께 삭제됩니다."
                    onConfirm={() => void deleteDashboard(d.id)}
                    okText="삭제" cancelText="취소"
                  >
                    <DeleteOutlined title="삭제" />
                  </Popconfirm>
                </span>
              </div>
            ),
          }))}
          onClick={(e) => setSelectedId(e.key)}
        />
        <Button
          type="dashed" icon={<PlusOutlined />} block
          style={{ width: 'calc(100% - 32px)', margin: 16 }}
          onClick={() => setCreating(true)}
        >
          새 대시보드
        </Button>
        <Button
          type="text" icon={<SyncOutlined />} block
          style={{ width: 'calc(100% - 32px)', margin: '0 16px' }}
          onClick={() => setUpdateCheckCount((c) => c + 1)}
        >
          업데이트 확인
        </Button>
        <Button
          type="text" icon={<BulbOutlined />} block
          style={{ width: 'calc(100% - 32px)', margin: '8px 16px 0' }}
          onClick={toggleDark}
        >
          {dark ? '라이트 모드' : '다크 모드'}
        </Button>
        <Button
          type="text" icon={<FullscreenOutlined />} block
          style={{ width: 'calc(100% - 32px)', margin: '8px 16px 0' }}
          onClick={() => setTvMode(true)}
        >
          TV 모드
        </Button>
      </Layout.Sider>
      )}

      <Layout.Content style={{ padding: 16, background: dark ? '#101010' : '#f5f5f5' }}>
        {selected ? (
          <DashboardGrid dashboard={selected} onChanged={() => refresh()} />
        ) : (
          <Empty description="대시보드가 없습니다. 채팅으로 '배포 대시보드 만들어줘'라고 말해보세요." />
        )}
      </Layout.Content>

      <FloatButton.Group>
        {tvMode && (
          <FloatButton
            icon={<FullscreenExitOutlined />} tooltip="TV 모드 종료"
            onClick={() => setTvMode(false)}
          />
        )}
        <FloatButton
          icon={<CommentOutlined />} type="primary"
          tooltip="AI 채팅" onClick={() => setChatOpen(true)}
        />
      </FloatButton.Group>
      <ChatDrawer
        open={chatOpen} onClose={() => setChatOpen(false)}
        onDashboardsChanged={refresh} dashboardId={selectedId}
      />
      <UpdateModal manualCheckCount={updateCheckCount} />

      <Modal
        title="새 대시보드" open={creating} onOk={createDashboard}
        onCancel={() => setCreating(false)} okText="만들기" cancelText="취소"
        confirmLoading={submitting}
      >
        <Input
          placeholder="이름 (예: 배포 현황)" value={newName} autoFocus
          onChange={(e) => setNewName(e.target.value)} onPressEnter={createDashboard}
        />
      </Modal>

      <Modal
        title="대시보드 이름 변경" open={!!renaming} onOk={renameDashboard}
        onCancel={() => setRenaming(undefined)} okText="변경" cancelText="취소"
        confirmLoading={submitting}
      >
        <Input
          value={renaming?.name ?? ''} autoFocus
          onChange={(e) => setRenaming((prev) => prev && { ...prev, name: e.target.value })}
          onPressEnter={renameDashboard}
        />
      </Modal>
    </Layout>
    </ConfigProvider>
  );
}
