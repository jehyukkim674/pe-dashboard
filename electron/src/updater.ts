import type { BrowserWindow } from 'electron';

export type UpdateCheck =
  | { kind: 'available'; currentVersion: string; version: string; notes: string }
  | { kind: 'latest'; currentVersion: string }
  | { kind: 'error'; message: string };

export async function checkUpdateStatus(): Promise<UpdateCheck> {
  return { kind: 'error', message: '업데이터 미구현 (D5)' };
}

export async function startInstall(_win: BrowserWindow): Promise<void> {}
