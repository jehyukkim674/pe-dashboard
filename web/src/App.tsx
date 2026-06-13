import { useCallback, useEffect, useState } from 'react';
import { Button, ConfigProvider, Empty, Input, Layout, Menu, message, Modal, Popconfirm, Space, Tooltip, Typography, FloatButton, theme as antdTheme } from 'antd';
import {
  BulbOutlined, CommentOutlined, CopyOutlined, DeleteOutlined, DownloadOutlined, EditOutlined,
  FullscreenOutlined, FullscreenExitOutlined, HistoryOutlined, PauseCircleOutlined,
  PlayCircleOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SyncOutlined, UploadOutlined,
} from '@ant-design/icons';
import { api } from './api';
import type { Dashboard } from './types';
import DashboardGrid from './components/DashboardGrid';
import ChatDrawer from './components/ChatDrawer';
import UpdateModal from './components/UpdateModal';
import CommandLogModal from './components/CommandLogModal';
import { pollControl, usePollControl } from './hooks/pollControl';

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
  const [tvRotate, setTvRotate] = useState(() => localStorage.getItem('pe-tv-rotate') === '1');
  const [logOpen, setLogOpen] = useState(false);
  const [dashSearch, setDashSearch] = useState('');
  const { paused } = usePollControl();
  const [siderWidth, setSiderWidth] = useState(() => {
    const saved = Number(localStorage.getItem('pe-sider-width'));
    return saved >= 160 && saved <= 420 ? saved : 220;
  });

  // 사이드바 오른쪽 가장자리를 드래그해 폭 조절 (160~420px, localStorage 유지)
  const startSiderResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = siderWidth;
    const clamp = (w: number) => Math.min(420, Math.max(160, w));
    const onMove = (ev: MouseEvent) => setSiderWidth(clamp(startW + ev.clientX - startX));
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem('pe-sider-width', String(clamp(startW + ev.clientX - startX)));
      window.dispatchEvent(new Event('resize')); // 그리드(WidthProvider) 재계산 유도
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

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

  // Cmd+K(맥)/Ctrl+K: AI 채팅 토글
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setChatOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // TV 모드 자동 순환: 켜져 있으면 20초마다 다음 대시보드로 (켬/끔은 localStorage 유지)
  const toggleTvRotate = () => {
    setTvRotate((r) => {
      localStorage.setItem('pe-tv-rotate', r ? '0' : '1');
      return !r;
    });
  };

  useEffect(() => {
    if (!tvMode || !tvRotate || dashboards.length < 2) return;
    const timer = setInterval(() => {
      setSelectedId((cur) => {
        const i = dashboards.findIndex((d) => d.id === cur);
        return dashboards[(i + 1) % dashboards.length].id;
      });
    }, 20_000);
    return () => clearInterval(timer);
  }, [tvMode, tvRotate, dashboards]);

  const selected = dashboards.find((d) => d.id === selectedId);
  const shownDashboards = dashSearch.trim()
    ? dashboards.filter((d) => d.name.toLowerCase().includes(dashSearch.trim().toLowerCase()))
    : dashboards;

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

  const duplicateDashboard = async (id: string) => {
    try {
      const source = dashboards.find((d) => d.id === id);
      if (!source) return;
      const created = await api.createDashboard(`${source.name} (복사)`);
      await api.saveDashboard({
        ...created,
        widgets: source.widgets.map((w) => ({ ...w, id: crypto.randomUUID() })),
      });
      await refresh(created.id);
    } catch (e) {
      void message.error(`대시보드 복제 실패: ${(e as Error).message}`);
    }
  };

  // 대시보드·커스텀 명령을 JSON 파일로 백업 (패키징 앱 ↔ dev 데이터 이동용)
  const exportData = async () => {
    try {
      const bundle = await api.exportData();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pe-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      void message.error(`내보내기 실패: ${(e as Error).message}`);
    }
  };

  const importData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const result = await api.importData(JSON.parse(await file.text()));
        void message.success(`가져오기 완료: 대시보드 ${result.dashboards}개, 명령 ${result.commands}개`);
        if (result.skipped.length > 0) {
          void message.warning(`건너뜀: ${result.skipped.join('; ')}`);
        }
        await refresh();
      } catch (e) {
        void message.error(`가져오기 실패: ${(e as Error).message}`);
      }
    };
    input.click();
  };

  return (
    <ConfigProvider theme={{ algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}>
    <Layout style={{ minHeight: '100vh' }}>
      {!tvMode && (
      <Layout.Sider
        theme="light" width={siderWidth}
        style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}
      >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
        <div
          onMouseDown={startSiderResize}
          title="드래그로 폭 조절"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 10 }}
        />
        <Typography.Title level={4} style={{ padding: '16px 16px 0' }}>
          PE Dashboard
        </Typography.Title>
        <Input
          size="small" allowClear value={dashSearch}
          onChange={(e) => setDashSearch(e.target.value)}
          placeholder="대시보드 검색" prefix={<SearchOutlined style={{ color: 'rgba(128,128,128,0.6)' }} />}
          style={{ width: 'calc(100% - 32px)', margin: '8px 16px 4px' }}
        />
        <Menu
          style={{ flex: 1, overflow: 'auto', borderInlineEnd: 'none' }}
          mode="inline"
          selectedKeys={selectedId ? [selectedId] : []}
          items={shownDashboards.map((d) => ({
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
                  <CopyOutlined
                    title="복제"
                    onClick={() => void duplicateDashboard(d.id)}
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
          style={{ width: 'calc(100% - 32px)', margin: '8px 16px' }}
          onClick={() => setCreating(true)}
        >
          새 대시보드
        </Button>
        {/* 보조 기능은 하단 아이콘 바로 압축 — 대시보드 목록이 주인공 */}
        <div
          style={{
            display: 'flex', justifyContent: 'space-around', padding: '6px 8px 10px',
            borderTop: '1px solid rgba(128,128,128,0.15)',
          }}
        >
          <Tooltip title="전체 새로고침">
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => pollControl.refreshAll()} />
          </Tooltip>
          <Tooltip title={paused ? '폴링 재개' : '전체 폴링 일시정지'}>
            <Button
              type="text" size="small"
              icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
              onClick={() => pollControl.togglePause()}
              style={paused ? { color: '#faad14' } : undefined}
            />
          </Tooltip>
          <Tooltip title="업데이트 확인">
            <Button type="text" size="small" icon={<SyncOutlined />} onClick={() => setUpdateCheckCount((c) => c + 1)} />
          </Tooltip>
          <Tooltip title={dark ? '라이트 모드' : '다크 모드'}>
            <Button type="text" size="small" icon={<BulbOutlined />} onClick={toggleDark} />
          </Tooltip>
          <Tooltip title="TV 모드">
            <Button type="text" size="small" icon={<FullscreenOutlined />} onClick={() => setTvMode(true)} />
          </Tooltip>
          <Tooltip title="내보내기">
            <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => void exportData()} />
          </Tooltip>
          <Tooltip title="가져오기">
            <Button type="text" size="small" icon={<UploadOutlined />} onClick={importData} />
          </Tooltip>
          <Tooltip title="실행 기록">
            <Button type="text" size="small" icon={<HistoryOutlined />} onClick={() => setLogOpen(true)} />
          </Tooltip>
        </div>
      </div>
      </Layout.Sider>
      )}

      <Layout.Content
        className={tvMode ? 'tv-mode' : undefined}
        style={{ padding: 16, background: dark ? '#101010' : '#f5f5f5' }}
      >
        {selected ? (
          <DashboardGrid dashboard={selected} onChanged={() => refresh()} />
        ) : (
          <Empty
            description="대시보드가 없습니다"
            style={{ marginTop: 120 }}
          >
            <Space>
              <Button icon={<PlusOutlined />} onClick={() => setCreating(true)}>새 대시보드</Button>
              <Button type="primary" icon={<CommentOutlined />} onClick={() => setChatOpen(true)}>
                AI에게 만들어달라기
              </Button>
            </Space>
          </Empty>
        )}
      </Layout.Content>

      <FloatButton.Group>
        {tvMode && (
          <>
            <FloatButton
              icon={tvRotate ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              tooltip={tvRotate ? '자동 순환 끄기' : '대시보드 자동 순환 (20초)'}
              onClick={toggleTvRotate}
            />
            <FloatButton
              icon={<FullscreenExitOutlined />} tooltip="TV 모드 종료"
              onClick={() => setTvMode(false)}
            />
          </>
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
      {logOpen && <CommandLogModal onClose={() => setLogOpen(false)} />}

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
