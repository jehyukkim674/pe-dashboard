import { randomUUID } from 'node:crypto';
import type { CommandTemplate } from '../types.js';

// register_command는 사용자 확인 버튼을 거쳐야 실제 등록된다 (스펙 보안 요구).
export class PendingCommands {
  private readonly map = new Map<string, CommandTemplate>();

  add(template: CommandTemplate): string {
    const id = randomUUID();
    this.map.set(id, template);
    return id;
  }

  peek(id: string): CommandTemplate | undefined {
    return this.map.get(id);
  }

  take(id: string): CommandTemplate | undefined {
    const template = this.map.get(id);
    this.map.delete(id);
    return template;
  }
}
