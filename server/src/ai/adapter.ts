import type { CommandTemplate } from '../types.js';

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'confirm_request'; pendingId: string; command: CommandTemplate }
  | { type: 'error'; message: string };

// AI 백엔드 추상화: CLI 어댑터(기본)와 API 어댑터(ChatService)가 구현한다.
export interface ChatAdapter {
  chat(sessionId: string, userMessage: string, emit: (e: ChatEvent) => void): Promise<void>;
}
