// 외부 명령(execFile) 동시 실행 상한. 위젯이 많으면 폴링 시점에 수십 개 프로세스가 한꺼번에
// 스폰돼 시스템이 출렁인다(fork 폭주). 전역 세마포어로 동시 실행 수를 제한하고 나머지는 큐에 대기.
// ResultCache가 '같은 argv'를 합치므로, 이 리미터는 서로 다른 명령들의 동시 실행 수를 제어한다.
export class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    // 슬롯이 없으면 대기. release가 슬롯을 '넘겨주면'(active 유지) 깨어난다 → 초과 실행 없음.
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next(); // 슬롯을 대기자에게 그대로 이양 (active를 줄이지 않음)
    } else {
      this.active--;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}

// 전역 기본 리미터. PE_MAX_CONCURRENT_COMMANDS로 조정(기본 8). runArgv가 이걸 통과한다.
const configured = Number(process.env.PE_MAX_CONCURRENT_COMMANDS);
const MAX_CONCURRENT = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 8;
export const commandLimiter = new Limiter(MAX_CONCURRENT);
