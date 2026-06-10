// Electron preload(contextBridge)가 노출하는 API. 브라우저 단독 실행 시 undefined.
export interface UpdateCheckPayload {
  kind: 'available' | 'latest' | 'error';
  currentVersion?: string;
  version?: string;
  notes?: string;
  message?: string;
}

declare global {
  interface Window {
    appUpdater?: {
      check: () => Promise<UpdateCheckPayload>;
      install: () => Promise<void>;
      onProgress: (cb: (percent: number) => void) => () => void;
    };
  }
}

export {};
