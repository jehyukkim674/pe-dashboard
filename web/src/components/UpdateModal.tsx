import { useEffect, useState } from 'react';
import { Button, Modal, Progress, Typography, message } from 'antd';
import type { UpdateCheckPayload } from '../electron';

interface Props {
  manualCheckCount: number; // App의 '업데이트 확인' 버튼 클릭마다 증가
}

export default function UpdateModal({ manualCheckCount }: Props) {
  const [update, setUpdate] = useState<UpdateCheckPayload>();
  const [percent, setPercent] = useState<number>();

  const check = async (manual: boolean) => {
    const updater = window.appUpdater;
    if (!updater) {
      if (manual) void message.info('데스크톱 앱에서만 업데이트를 지원합니다');
      return;
    }
    const result = await updater.check();
    if (result.kind === 'available') setUpdate(result);
    else if (manual && result.kind === 'latest') {
      void message.success(`최신 버전입니다 (v${result.currentVersion})`);
    } else if (manual && result.kind === 'error') {
      void message.error(`업데이트 확인 실패: ${result.message}`);
    }
    // 자동 체크의 latest/error는 조용히 무시 (스펙)
  };

  useEffect(() => {
    const timer = setTimeout(() => void check(false), 5000); // 시작 5초 후 자동 체크
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (manualCheckCount > 0) void check(true);
  }, [manualCheckCount]);

  const install = async () => {
    const updater = window.appUpdater;
    if (!updater) return;
    setPercent(0);
    const off = updater.onProgress((value) => setPercent(value));
    try {
      await updater.install(); // 100% 도달 후 앱이 스스로 재시작
    } catch (e) {
      off();
      setPercent(undefined);
      void message.error(`업데이트 실패: ${(e as Error).message}`);
    }
  };

  const downloading = percent !== undefined;
  return (
    <Modal
      title={`새 버전 v${update?.version ?? ''} (현재 v${update?.currentVersion ?? ''})`}
      open={update !== undefined}
      onCancel={() => !downloading && setUpdate(undefined)}
      closable={!downloading}
      maskClosable={false}
      footer={
        downloading ? null : [
          <Button key="later" onClick={() => setUpdate(undefined)}>나중에</Button>,
          <Button key="go" type="primary" onClick={() => void install()}>업데이트</Button>,
        ]
      }
    >
      {update?.notes && (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{update.notes}</Typography.Paragraph>
      )}
      {downloading && (
        <Progress percent={percent} status={percent !== undefined && percent < 100 ? 'active' : 'success'} />
      )}
    </Modal>
  );
}
