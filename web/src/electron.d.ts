// Electron preload(contextBridge)가 노출하는 API. 브라우저 단독 실행 시 undefined.
export interface UpdateCheckPayload {
  kind: 'available' | 'latest' | 'error';
  currentVersion?: string;
  version?: string;
  notes?: string;
  message?: string;
  canAutoInstall?: boolean; // false면 서명 안 된 빌드 — 자동 설치 불가, 수동 다운로드 안내
}

declare global {
  interface Window {
    appUpdater?: {
      check: () => Promise<UpdateCheckPayload>;
      install: () => Promise<void>;
      restart: () => Promise<void>;
      openReleasePage: () => Promise<void>;
      onProgress: (cb: (percent: number) => void) => () => void;
    };
  }
}

export {};
