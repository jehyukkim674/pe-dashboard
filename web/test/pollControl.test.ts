import { describe, it, expect, beforeEach } from 'vitest';
import { pollControl } from '../src/hooks/pollControl';

describe('pollControl', () => {
  beforeEach(() => {
    // 다른 테스트 영향 제거: paused는 false로, nonce는 그대로(단조 증가만 검증)
    if (pollControl.getSnapshot().paused) pollControl.togglePause();
  });

  it('togglePause flips paused and notifies subscribers', () => {
    let calls = 0;
    const unsub = pollControl.subscribe(() => { calls += 1; });
    expect(pollControl.getSnapshot().paused).toBe(false);
    pollControl.togglePause();
    expect(pollControl.getSnapshot().paused).toBe(true);
    expect(calls).toBe(1);
    pollControl.togglePause();
    expect(pollControl.getSnapshot().paused).toBe(false);
    expect(calls).toBe(2);
    unsub();
  });

  it('refreshAll increments nonce and notifies once', () => {
    let calls = 0;
    const unsub = pollControl.subscribe(() => { calls += 1; });
    const before = pollControl.getSnapshot().nonce;
    pollControl.refreshAll();
    expect(pollControl.getSnapshot().nonce).toBe(before + 1);
    expect(calls).toBe(1);
    unsub();
  });

  it('getSnapshot returns a stable reference until state changes', () => {
    const a = pollControl.getSnapshot();
    expect(pollControl.getSnapshot()).toBe(a);
    pollControl.refreshAll();
    expect(pollControl.getSnapshot()).not.toBe(a);
  });
});
