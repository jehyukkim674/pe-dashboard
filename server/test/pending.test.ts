import { describe, it, expect } from 'vitest';
import { PendingCommands } from '../src/commands/pending.js';

const template = { id: 'c1', description: 'd', argv: ['echo', 'x'], params: [] };

describe('PendingCommands', () => {
  it('add/peek/get/take 흐름', () => {
    const p = new PendingCommands();
    const id = p.add(template);
    expect(p.peek(id)?.id).toBe('c1');
    expect(p.get(id)?.template.id).toBe('c1');
    expect(p.attach(id, [{ op: 'x' }])).toBe(true);
    expect(p.get(id)?.deferred).toHaveLength(1);
    expect(p.take(id)?.template.id).toBe('c1');
    expect(p.get(id)).toBeUndefined(); // 소비됨
  });

  it('TTL이 지난 오래된 항목은 새 항목 추가 시 정리된다', async () => {
    const p = new PendingCommands(10); // 10ms TTL
    const old = p.add(template);
    await new Promise((r) => setTimeout(r, 20));
    const fresh = p.add({ ...template, id: 'c2' });
    // 오래된 항목은 prune되고 새 항목만 남는다
    expect(p.get(old)).toBeUndefined();
    expect(p.get(fresh)?.template.id).toBe('c2');
  });
});
