import { randomUUID } from 'node:crypto';
import type { CommandTemplate } from '../types.js';

export interface PendingEntry {
  template: CommandTemplate;
  // 이 명령 등록을 전제로 한 후속 작업(위젯 추가 등). 승인 시 함께 적용된다.
  // 타입은 ai/operations.ts의 Operation이지만 계층 결합을 피해 unknown으로 둔다.
  deferred: unknown[];
}

// register_command는 사용자 확인 버튼을 거쳐야 실제 등록된다 (스펙 보안 요구).
export class PendingCommands {
  private readonly map = new Map<string, PendingEntry>();

  add(template: CommandTemplate): string {
    const id = randomUUID();
    this.map.set(id, { template, deferred: [] });
    return id;
  }

  peek(id: string): CommandTemplate | undefined {
    return this.map.get(id)?.template;
  }

  // 소비하지 않고 항목 전체를 본다. 승인 처리 중 register가 실패하면 되돌릴 수 있게
  // take() 전에 이걸로 조회한다.
  get(id: string): PendingEntry | undefined {
    return this.map.get(id);
  }

  // 승인 대기 명령에 후속 작업을 붙인다. 대기 항목이 없으면 false.
  attach(id: string, operations: unknown[]): boolean {
    const entry = this.map.get(id);
    if (!entry) return false;
    entry.deferred.push(...operations);
    return true;
  }

  take(id: string): PendingEntry | undefined {
    const entry = this.map.get(id);
    this.map.delete(id);
    return entry;
  }
}
