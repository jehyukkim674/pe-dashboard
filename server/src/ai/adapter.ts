import type { CommandTemplate } from '../types.js';

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; stage: string } // 진행 단계 안내 (다음 이벤트가 오면 대체)
  | { type: 'tool'; name: string; summary: string }
  | { type: 'confirm_request'; pendingId: string; command: CommandTemplate; warning?: string }
  | { type: 'error'; message: string };

// 사용자가 현재 보고 있는 화면 정보. AI가 화면의 위젯 데이터를 근거로 답하게 한다.
export interface ChatContext {
  dashboardId?: string;
  model?: string; // claude CLI --model (haiku|sonnet|opus). 미지정 시 CLI 기본값
  signal?: AbortSignal; // 클라이언트가 끊으면 진행 중인 claude 실행을 중단한다
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
