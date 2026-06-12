import { useEffect, useMemo, useState } from 'react';
import { Form, Input, Modal, Select, Typography, message } from 'antd';
import { api } from '../api';
import type { CommandTemplate, WidgetDataSource } from '../types';

interface Props {
  dataSource: WidgetDataSource;
  onClose: () => void;
  onSave: (ds: WidgetDataSource) => void;
}

// 위젯이 실제 실행하는 CLI 명령(argv)을 보여주고, 명령 템플릿·파라미터를 수정한다.
// 열릴 때마다 새로 마운트되므로(WidgetCard에서 조건부 렌더) 상태는 props로 초기화한다.
export default function WidgetSourceModal({ dataSource, onClose, onSave }: Props) {
  const [templates, setTemplates] = useState<CommandTemplate[]>([]);
  const [commandId, setCommandId] = useState(dataSource.commandId);
  const [params, setParams] = useState<Record<string, string>>(dataSource.params);

  useEffect(() => {
    api.listCommands()
      .then(setTemplates)
      .catch((e) => void message.error(`명령 목록 조회 실패: ${(e as Error).message}`));
  }, []);

  const template = templates.find((t) => t.id === commandId);

  // 파라미터를 치환한, 실제로 실행될 명령줄 미리보기
  const resolved = useMemo(() => {
    if (!template) return '';
    return template.argv
      .map((part) => part.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`))
      .join(' ');
  }, [template, params]);

  const save = () => {
    if (!template) return;
    const missing = template.params.filter((p) => !params[p]?.trim());
    if (missing.length > 0) {
      void message.warning(`파라미터를 입력하세요: ${missing.join(', ')}`);
      return;
    }
    // 선택된 템플릿이 선언한 파라미터만 저장한다 (템플릿 변경 시 잔여 값 제거)
    const next: Record<string, string> = {};
    for (const p of template.params) next[p] = params[p].trim();
    onSave({ ...dataSource, commandId, params: next });
    onClose();
  };

  return (
    <Modal
      title="실행 명령 보기·수정" open onOk={save} onCancel={onClose}
      okText="저장" cancelText="취소" width={560}
    >
      <Form layout="vertical">
        <Form.Item label="명령 템플릿">
          <Select
            value={commandId}
            onChange={(id) => setCommandId(id)}
            options={templates.map((t) => ({
              value: t.id,
              label: `${t.id} — ${t.description}`,
            }))}
            showSearch optionFilterProp="label"
          />
        </Form.Item>
        {template?.params.map((p) => (
          <Form.Item key={p} label={`파라미터: ${p}`}>
            <Input
              value={params[p] ?? ''}
              onChange={(e) => setParams((prev) => ({ ...prev, [p]: e.target.value }))}
              placeholder={`{${p}} 값`}
            />
          </Form.Item>
        ))}
        <Form.Item label="실제 실행되는 명령">
          <Typography.Paragraph
            code copyable
            style={{ marginBottom: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {resolved || '(템플릿 로딩 중…)'}
          </Typography.Paragraph>
        </Form.Item>
      </Form>
    </Modal>
  );
}
