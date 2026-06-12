import type { CommandTemplate } from '../types.js';

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'confirm_request'; pendingId: string; command: CommandTemplate; warning?: string }
  | { type: 'error'; message: string };

// 사용자가 현재 보고 있는 화면 정보. AI가 화면의 위젯 데이터를 근거로 답하게 한다.
export interface ChatContext {
  dashboardId?: string;
}

// AI 백엔드 추상화: CLI 어댑터(기본)와 API 어댑터(ChatService)가 구현한다.
export interface ChatAdapter {
  chat(
    sessionId: string,
    userMessage: string,
    emit: (e: ChatEvent) => void,
    context?: ChatContext,
  ): Promise<void>;
}
