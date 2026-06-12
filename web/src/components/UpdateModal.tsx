import { useEffect, useState } from 'react';
import { Button, Modal, Progress, Typography, message } from 'antd';
import type { UpdateCheckPayload } from '../electron';

interface Props {
  manualCheckCount: number; // App의 '업데이트 확인' 버튼 클릭마다 증가
}

export function sanitizeNotes(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

export default function UpdateModal({ manualCheckCount }: Props) {
  const [update, setUpdate] = useState<UpdateCheckPayload>();
  const [percent, setPercent] = useState<number>();
  const [checking, setChecking] = useState(false);

  const check = async (manual: boolean) => {
    if (checking) return;
    const updater = window.appUpdater;
    if (!updater) {
      if (manual) void message.info('데스크톱 앱에서만 업데이트를 지원합니다');
      return;
    }
    setChecking(true);
    try {
      const result = await updater.check();
      if (result.kind === 'available') setUpdate(result);
      else if (manual && result.kind === 'latest') {
        void message.success(`최신 버전입니다 (v${result.currentVersion})`);
      } else if (manual && result.kind === 'error') {
        void message.error(`업데이트 확인 실패: ${result.message}`);
      }
      // 자동 체크의 latest/error는 조용히 무시 (스펙)
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void check(false), 5000); // 시작 5초 후 자동 체크
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (manualCheckCount > 0) void check(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualCheckCount]);

  const install = async () => {
    const updater = window.appUpdater;
    if (!updater) return;
    setPercent(0);
    const off = updater.onProgress((value) => setPercent(value));
    try {
      await updater.install(); // 100% 도달 후 앱이 스스로 재시작
    } catch (e) {
      setPercent(undefined);
      void message.error(`업데이트 실패: ${(e as Error).message}`);
    } finally {
      off();
    }
  };

  const downloading = percent !== undefined;
  return (
    <Modal
      title={`새 버전 v${update?.version ?? ''} (현재 v${update?.currentVersion ?? ''})`}
      open={update !== undefined}
      onCancel={() => !downloading && setUpdate(undefined)}
      closable={!downloading}
      mask={{ closable: false }}
      footer={
        downloading ? null : [
          <Button key="later" onClick={() => setUpdate(undefined)}>나중에</Button>,
          <Button key="go" type="primary" onClick={() => void install()}>업데이트</Button>,
        ]
      }
    >
      {update?.notes && (
        <Typography>
          {/* GitHub 릴리스 노트는 HTML로 내려온다. 우리 저장소 릴리스만 표시하지만
              방어적으로 script/이벤트 핸들러를 제거하고 렌더링한다. */}
          <div dangerouslySetInnerHTML={{ __html: sanitizeNotes(update.notes) }} />
        </Typography>
      )}
      {downloading && (
        <Progress percent={percent} status={percent !== undefined && percent < 100 ? 'active' : 'success'} />
      )}
    </Modal>
  );
}
