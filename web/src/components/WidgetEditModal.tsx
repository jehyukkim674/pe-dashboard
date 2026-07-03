import { useEffect, useMemo, useState } from 'react';
import { Form, Input, Modal, Select, Typography, message } from 'antd';
import { api } from '../api';
import type { CommandTemplate, Widget, WidgetAlert, WidgetType } from '../types';
import { TABLE_PREF_KEYS } from './widgets/tableFormat';
import { WIDGET_TYPE_OPTIONS } from './widgets/widgetTypes';

// 저장 대상: id/layout은 그리드가 관리하므로 제외
export type WidgetDraft = Omit<Widget, 'id' | 'layout'>;

interface Props {
  widget?: Widget; // 있으면 편집, 없으면 새 위젯
  onClose: () => void;
  onSave: (draft: WidgetDraft) => void;
}

// 위젯이 실행할 데이터 소스(CLI 명령/HTTP)와 표시 옵션을 한 곳에서 편집한다.
// 열릴 때마다 새로 마운트되므로(부모에서 조건부 렌더) 상태는 props로 초기화한다.
export default function WidgetEditModal({ widget, onClose, onSave }: Props) {
  const ds = widget?.dataSource;
  const display = (widget?.display ?? {}) as Record<string, string>;

  const [templates, setTemplates] = useState<CommandTemplate[]>([]);
  const [title, setTitle] = useState(widget?.title ?? '');
  const [type, setType] = useState<WidgetType>(widget?.type ?? 'table');
  const [sourceKind, setSourceKind] = useState<'cli' | 'http' | 'postgres' | 'ssh'>(ds?.kind ?? 'cli');
  const [sshNames, setSshNames] = useState<string[]>([]);
  const [sshProfile, setSshProfile] = useState(ds?.sshProfile ?? '');
  const [newSshProfile, setNewSshProfile] = useState<{ name: string; host: string; user: string; port: string }>();
  const [pgNames, setPgNames] = useState<string[]>([]);
  const [pgProfile, setPgProfile] = useState(ds?.profile ?? '');
  const [pgQuery, setPgQuery] = useState(ds?.query ?? '');
  const [newProfile, setNewProfile] = useState<{ name: string; connString: string }>();
  const [commandId, setCommandId] = useState(ds?.commandId ?? '');
  const [params, setParams] = useState<Record<string, string>>(ds?.params ?? {});
  const [url, setUrl] = useState(ds?.url ?? '');
  const [httpProfile, setHttpProfile] = useState(ds?.httpProfile ?? '');
  const [httpNames, setHttpNames] = useState<string[]>([]);
  const [newHttpProfile, setNewHttpProfile] = useState<{ name: string; headersText: string }>();
  // display 옵션 (타입별로 저장 시 필요한 것만 추려서 보존)
  const [statMetric, setStatMetric] = useState(display.metric ?? 'count');
  const [statPath, setStatPath] = useState(display.path ?? '');
  const [statSuffix, setStatSuffix] = useState(display.suffix ?? '');
  const [tableColumns, setTableColumns] = useState(
    Array.isArray(widget?.display?.columns) ? (widget.display.columns as string[]).join(', ') : '',
  );
  const [statusLabelPath, setStatusLabelPath] = useState(display.labelPath ?? '');
  const [statusStatePath, setStatusStatePath] = useState(display.statePath ?? '');
  const [statusOkValues, setStatusOkValues] = useState(display.okValues ?? '');
  const [chartXKey, setChartXKey] = useState(display.xKey ?? '');
  const [chartYKey, setChartYKey] = useState(display.yKey ?? '');
  const [chartType, setChartType] = useState(display.chartType ?? 'line');
  const [textContent, setTextContent] = useState(display.content ?? '');
  // 중첩 배열({items:[...]}) 응답에서 행 배열의 점 경로. 비우면 자동 감지(items/data/results/rows/list)
  const [rowsPath, setRowsPath] = useState(display.rowsPath ?? '');
  // 조건 알림
  const [alertOn, setAlertOn] = useState<'none' | WidgetAlert['on']>(widget?.alert?.on ?? 'none');
  const [alertPattern, setAlertPattern] = useState(widget?.alert?.pattern ?? '');

  useEffect(() => {
    api.listCommands()
      .then(setTemplates)
      .catch((e) => void message.error(`명령 목록 조회 실패: ${(e as Error).message}`));
    api.pgProfiles().then(setPgNames).catch(() => {});
    api.httpProfiles().then(setHttpNames).catch(() => {});
    api.sshProfiles().then(setSshNames).catch(() => {});
  }, []);

  const addSshProfile = async () => {
    if (!newSshProfile?.name.trim() || !newSshProfile.host.trim()) {
      return void message.warning('이름과 host를 입력하세요');
    }
    const portNum = newSshProfile.port.trim() ? Number(newSshProfile.port.trim()) : undefined;
    try {
      await api.addSshProfile(
        newSshProfile.name.trim(), newSshProfile.host.trim(),
        newSshProfile.user.trim() || undefined, portNum,
      );
      setSshNames(await api.sshProfiles());
      setSshProfile(newSshProfile.name.trim());
      setNewSshProfile(undefined);
    } catch (e) {
      void message.error((e as Error).message);
    }
  };

  // 헤더 텍스트("Authorization: Bearer xxx" 줄마다)를 Record로 파싱
  const parseHeaders = (text: string): Record<string, string> => {
    const headers: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key && value) headers[key] = value;
    }
    return headers;
  };

  const addHttpProfile = async () => {
    if (!newHttpProfile?.name.trim()) return;
    const headers = parseHeaders(newHttpProfile.headersText);
    if (Object.keys(headers).length === 0) return void message.warning('헤더를 "이름: 값" 형식으로 한 줄 이상 입력하세요');
    try {
      await api.addHttpProfile(newHttpProfile.name.trim(), headers);
      setHttpNames(await api.httpProfiles());
      setHttpProfile(newHttpProfile.name.trim());
      setNewHttpProfile(undefined);
    } catch (e) {
      void message.error((e as Error).message);
    }
  };

  const addProfile = async () => {
    if (!newProfile?.name.trim() || !newProfile.connString.trim()) return;
    try {
      await api.addPgProfile(newProfile.name.trim(), newProfile.connString.trim());
      setPgNames(await api.pgProfiles());
      setPgProfile(newProfile.name.trim());
      setNewProfile(undefined);
    } catch (e) {
      void message.error((e as Error).message);
    }
  };

  const template = templates.find((t) => t.id === commandId);

  const resolved = useMemo(() => {
    if (!template) return '';
    return template.argv
      .map((part) => part.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? `{${name}}`))
      .join(' ');
  }, [template, params]);

  // Postgres 쿼리의 {name} 플레이스홀더 → 위젯 파라미터 입력으로 (CLI와 동일 방식, 서버에서 $N 바인딩)
  const pgParamNames = useMemo(
    () => [...new Set([...pgQuery.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))],
    [pgQuery],
  );

  // CLI·SSH가 공유하는 '명령 템플릿 + 파라미터' 입력 블록 (SSH는 이 명령을 원격에서 실행)
  const commandBlock = (
    <>
      <Form.Item label="명령 템플릿" required>
        <Select
          value={commandId || undefined} onChange={setCommandId}
          placeholder="명령 선택"
          options={templates.map((t) => ({ value: t.id, label: `${t.id} — ${t.description}` }))}
          showSearch optionFilterProp="label"
        />
      </Form.Item>
      {template?.params.map((p) => (
        <Form.Item key={p} label={`파라미터: ${p}`} required>
          <Input
            value={params[p] ?? ''}
            onChange={(e) => setParams((prev) => ({ ...prev, [p]: e.target.value }))}
            placeholder={`{${p}} 값`}
          />
        </Form.Item>
      ))}
      {resolved && (
        <Form.Item label="실제 실행되는 명령">
          <Typography.Paragraph
            code copyable
            style={{ marginBottom: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {resolved}
          </Typography.Paragraph>
        </Form.Item>
      )}
    </>
  );

  const buildDisplay = (): Record<string, unknown> | undefined => {
    const rp = rowsPath.trim() ? { rowsPath: rowsPath.trim() } : {};
    switch (type) {
      case 'stat':
        return { metric: statMetric, ...(statMetric === 'path' && { path: statPath }), suffix: statSuffix, ...rp };
      case 'table': {
        const columns = tableColumns.split(',').map((c) => c.trim()).filter(Boolean);
        // 폭·필터·정렬·숨김 등 사용자 설정은 편집 모달을 거쳐도 유지한다
        const prefs: Record<string, unknown> = {};
        if (widget?.type === 'table') {
          for (const key of TABLE_PREF_KEYS) {
            if (widget.display?.[key] != null) prefs[key] = widget.display[key];
          }
        }
        return { ...(columns.length > 0 && { columns }), ...prefs, ...rp };
      }
      case 'chart':
        return { xKey: chartXKey, yKey: chartYKey, chartType, ...rp };
      case 'status':
        return { labelPath: statusLabelPath, statePath: statusStatePath, okValues: statusOkValues, ...rp };
      case 'text':
        return { content: textContent };
      default:
        return {};
    }
  };

  const save = () => {
    if (!title.trim()) return void message.warning('제목을 입력하세요');
    const draft: WidgetDraft = { type, title: title.trim(), display: buildDisplay() };

    if (type !== 'text') {
      if (sourceKind === 'cli' || sourceKind === 'ssh') {
        if (sourceKind === 'ssh' && !sshProfile) return void message.warning('SSH 프로필을 선택하세요');
        if (!template) return void message.warning('명령 템플릿을 선택하세요');
        const missing = template.params.filter((p) => !params[p]?.trim());
        if (missing.length > 0) return void message.warning(`파라미터를 입력하세요: ${missing.join(', ')}`);
        const next: Record<string, string> = {};
        for (const p of template.params) next[p] = params[p].trim();
        draft.dataSource = sourceKind === 'ssh'
          ? { kind: 'ssh', commandId, params: next, sshProfile, refreshSec: ds?.refreshSec }
          : { kind: 'cli', commandId, params: next, refreshSec: ds?.refreshSec };
      } else if (sourceKind === 'http') {
        if (!/^https?:\/\//.test(url.trim())) return void message.warning('http(s):// URL을 입력하세요');
        draft.dataSource = {
          kind: 'http', commandId: '', params: {}, url: url.trim(),
          ...(httpProfile && { httpProfile }), refreshSec: ds?.refreshSec,
        };
      } else {
        if (!pgProfile) return void message.warning('Postgres 프로필을 선택하세요');
        if (!/^\s*(select|with)\b/i.test(pgQuery)) return void message.warning('SELECT/WITH 쿼리만 가능합니다');
        const missing = pgParamNames.filter((p) => !params[p]?.trim());
        if (missing.length > 0) return void message.warning(`파라미터를 입력하세요: ${missing.join(', ')}`);
        const pgParams: Record<string, string> = {};
        for (const p of pgParamNames) pgParams[p] = params[p].trim();
        draft.dataSource = {
          kind: 'postgres', commandId: '', params: pgParams,
          profile: pgProfile, query: pgQuery.trim(), refreshSec: ds?.refreshSec,
        };
      }
    }

    if (alertOn !== 'none') {
      if (alertOn === 'contains' && !alertPattern.trim()) {
        return void message.warning('알림 조건 문자열을 입력하세요');
      }
      draft.alert = { on: alertOn, ...(alertOn === 'contains' && { pattern: alertPattern.trim() }) };
    }

    onSave(draft);
    onClose();
  };

  return (
    <Modal
      title={widget ? '위젯 편집' : '위젯 추가'} open onOk={save} onCancel={onClose}
      okText="저장" cancelText="취소" width={600}
    >
      <Form layout="vertical">
        <Form.Item label="제목" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 최근 커밋" />
        </Form.Item>
        <Form.Item label="타입">
          <Select value={type} onChange={setType} options={WIDGET_TYPE_OPTIONS} />
        </Form.Item>

        {type !== 'text' && (
          <>
            <Form.Item label="데이터 소스">
              <Select
                value={sourceKind} onChange={setSourceKind}
                options={[
                  { value: 'cli', label: 'CLI 명령' },
                  { value: 'ssh', label: 'SSH 원격 명령' },
                  { value: 'http', label: 'HTTP(JSON API)' },
                  { value: 'postgres', label: 'Postgres (SELECT)' },
                ]}
              />
            </Form.Item>
            {sourceKind === 'cli' ? (
              commandBlock
            ) : sourceKind === 'ssh' ? (
              <>
                <Form.Item label="SSH 프로필" required>
                  <Select
                    value={sshProfile || undefined} onChange={setSshProfile} placeholder="프로필 선택"
                    options={sshNames.map((n) => ({ value: n, label: n }))}
                    popupRender={(menu) => (
                      <>
                        {menu}
                        <div style={{ padding: 6 }}>
                          <a onClick={() => setNewSshProfile({ name: '', host: '', user: '', port: '' })}>+ 새 프로필 등록</a>
                        </div>
                      </>
                    )}
                  />
                </Form.Item>
                {newSshProfile && (
                  <Form.Item label="새 SSH 프로필 (키·설정은 ~/.ssh 사용)">
                    <Input
                      value={newSshProfile.name} placeholder="이름 (예: bastion)"
                      onChange={(e) => setNewSshProfile({ ...newSshProfile, name: e.target.value })}
                      style={{ marginBottom: 6 }}
                    />
                    <Input
                      value={newSshProfile.host} placeholder="host (예: 10.0.0.5 또는 bastion.example.com)"
                      onChange={(e) => setNewSshProfile({ ...newSshProfile, host: e.target.value })}
                      style={{ marginBottom: 6 }}
                    />
                    <Input
                      value={newSshProfile.user} placeholder="user (선택)"
                      onChange={(e) => setNewSshProfile({ ...newSshProfile, user: e.target.value })}
                      style={{ marginBottom: 6 }}
                    />
                    <Input
                      value={newSshProfile.port} placeholder="port (선택, 기본 22)"
                      onChange={(e) => setNewSshProfile({ ...newSshProfile, port: e.target.value })}
                      style={{ marginBottom: 6 }}
                    />
                    <a onClick={() => void addSshProfile()}>등록</a>
                  </Form.Item>
                )}
                {commandBlock}
              </>
            ) : sourceKind === 'http' ? (
              <>
                <Form.Item label="URL" required>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/status" />
                </Form.Item>
                <Form.Item label="인증 프로필 (선택 — 헤더 값은 서버에만 저장)">
                  <Select
                    value={httpProfile || undefined} onChange={setHttpProfile} placeholder="없음 (익명 GET)"
                    allowClear options={httpNames.map((n) => ({ value: n, label: n }))}
                    popupRender={(menu) => (
                      <>
                        {menu}
                        <div style={{ padding: 6 }}>
                          <a onClick={() => setNewHttpProfile({ name: '', headersText: '' })}>+ 새 프로필 등록</a>
                        </div>
                      </>
                    )}
                  />
                </Form.Item>
                {newHttpProfile && (
                  <Form.Item label="새 인증 프로필 (헤더는 줄마다 '이름: 값')">
                    <Input
                      value={newHttpProfile.name} placeholder="이름 (예: internal-api)"
                      onChange={(e) => setNewHttpProfile({ ...newHttpProfile, name: e.target.value })}
                      style={{ marginBottom: 6 }}
                    />
                    <Input.TextArea
                      value={newHttpProfile.headersText} rows={2}
                      placeholder={'Authorization: Bearer xxxxx\nX-Api-Key: yyyyy'}
                      onChange={(e) => setNewHttpProfile({ ...newHttpProfile, headersText: e.target.value })}
                      style={{ marginBottom: 6 }}
                    />
                    <a onClick={() => void addHttpProfile()}>등록</a>
                  </Form.Item>
                )}
              </>
            ) : (
              <>
                <Form.Item label="연결 프로필" required>
                  <Select
                    value={pgProfile || undefined} onChange={setPgProfile} placeholder="프로필 선택"
                    options={pgNames.map((n) => ({ value: n, label: n }))}
                    popupRender={(menu) => (
                      <>
                        {menu}
                        <div style={{ padding: 6 }}>
                          <a onClick={() => setNewProfile({ name: '', connString: '' })}>+ 새 프로필 등록</a>
                        </div>
                      </>
                    )}
                  />
                </Form.Item>
                {newProfile && (
                  <Form.Item label="새 프로필 (연결 문자열은 서버에만 저장됨)">
                    <Input
                      value={newProfile.name} placeholder="이름 (예: local)"
                      onChange={(e) => setNewProfile({ ...newProfile, name: e.target.value })}
                      style={{ marginBottom: 6 }}
                    />
                    <Input.Password
                      value={newProfile.connString} placeholder="postgres://user:pass@host:5432/db"
                      onChange={(e) => setNewProfile({ ...newProfile, connString: e.target.value })}
                      onPressEnter={() => void addProfile()}
                      style={{ marginBottom: 6 }}
                    />
                    <a onClick={() => void addProfile()}>등록</a>
                  </Form.Item>
                )}
                <Form.Item label="SELECT 쿼리 (파라미터는 {이름}, 값은 $N으로 안전 바인딩)" required>
                  <Input.TextArea
                    rows={3} value={pgQuery} onChange={(e) => setPgQuery(e.target.value)}
                    placeholder="SELECT status, count(*) FROM jobs WHERE env = {env} GROUP BY status"
                  />
                </Form.Item>
                {pgParamNames.map((p) => (
                  <Form.Item key={p} label={`파라미터: ${p}`} required>
                    <Input
                      value={params[p] ?? ''}
                      onChange={(e) => setParams((prev) => ({ ...prev, [p]: e.target.value }))}
                      placeholder={`{${p}} 값`}
                    />
                  </Form.Item>
                ))}
              </>
            )}
          </>
        )}

        {['stat', 'table', 'chart', 'status'].includes(type) && (
          <Form.Item label="행 경로 (선택 — 응답이 중첩 배열일 때. 비우면 items/data/results 자동 감지)">
            <Input value={rowsPath} onChange={(e) => setRowsPath(e.target.value)} placeholder="예: items (kubectl -o json)" />
          </Form.Item>
        )}
        {type === 'stat' && (
          <>
            <Form.Item label="표시 값">
              <Select
                value={statMetric} onChange={setStatMetric}
                options={[
                  { value: 'count', label: '배열 길이 (count)' },
                  { value: 'path', label: 'JSON 경로 값 (path)' },
                ]}
              />
            </Form.Item>
            {statMetric === 'path' && (
              <Form.Item label="JSON 경로">
                <Input value={statPath} onChange={(e) => setStatPath(e.target.value)} placeholder="예: items.0.status" />
              </Form.Item>
            )}
            <Form.Item label="접미사">
              <Input value={statSuffix} onChange={(e) => setStatSuffix(e.target.value)} placeholder="예: 건" />
            </Form.Item>
          </>
        )}
        {type === 'table' && (
          <Form.Item label="컬럼 (쉼표 구분, 비우면 자동)">
            <Input value={tableColumns} onChange={(e) => setTableColumns(e.target.value)} placeholder="예: name, status, createdAt" />
          </Form.Item>
        )}
        {type === 'chart' && (
          <>
            <Form.Item label="X축 키" required>
              <Input value={chartXKey} onChange={(e) => setChartXKey(e.target.value)} placeholder="예: date" />
            </Form.Item>
            <Form.Item label="Y축 키 (쉼표로 여러 개 = 멀티 시리즈)" required>
              <Input value={chartYKey} onChange={(e) => setChartYKey(e.target.value)} placeholder="예: count 또는 success, failure" />
            </Form.Item>
            <Form.Item label="차트 종류">
              <Select
                value={chartType} onChange={setChartType}
                options={[{ value: 'line', label: '라인' }, { value: 'bar', label: '바' }]}
              />
            </Form.Item>
          </>
        )}
        {type === 'status' && (
          <>
            <Form.Item label="라벨 경로 (JSON)" required>
              <Input
                value={statusLabelPath} onChange={(e) => setStatusLabelPath(e.target.value)}
                placeholder="예: metadata.name"
              />
            </Form.Item>
            <Form.Item label="상태 값 경로 (JSON)" required>
              <Input
                value={statusStatePath} onChange={(e) => setStatusStatePath(e.target.value)}
                placeholder="예: status.sync.status"
              />
            </Form.Item>
            <Form.Item label="정상 값 (쉼표 구분 — 이 값이면 초록)">
              <Input
                value={statusOkValues} onChange={(e) => setStatusOkValues(e.target.value)}
                placeholder="예: Synced, Healthy"
              />
            </Form.Item>
          </>
        )}
        {type === 'text' && (
          <Form.Item label="내용">
            <Input.TextArea rows={4} value={textContent} onChange={(e) => setTextContent(e.target.value)} />
          </Form.Item>
        )}

        {type !== 'text' && (
          <>
            <Form.Item label="알림">
              <Select
                value={alertOn} onChange={setAlertOn}
                options={[
                  { value: 'none', label: '끄기' },
                  { value: 'fail', label: '명령 실패 시 알림' },
                  { value: 'contains', label: '출력에 문자열 포함 시 알림' },
                ]}
              />
            </Form.Item>
            {alertOn === 'contains' && (
              <Form.Item label="포함 문자열" required>
                <Input value={alertPattern} onChange={(e) => setAlertPattern(e.target.value)} placeholder="예: failure" />
              </Form.Item>
            )}
          </>
        )}
      </Form>
    </Modal>
  );
}
