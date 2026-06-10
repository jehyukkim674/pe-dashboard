import type { CommandResult, WidgetDataSource } from '../types.js';

export interface DataSource {
  readonly kind: string;
  fetch(dataSource: WidgetDataSource): Promise<CommandResult>;
}

// 확장 포인트: PostgresSource, HttpSource 등을 register()로 추가
export class DataSourceRegistry {
  private readonly sources = new Map<string, DataSource>();

  register(source: DataSource): void {
    this.sources.set(source.kind, source);
  }

  get(kind: string): DataSource {
    const source = this.sources.get(kind);
    if (!source) throw new Error(`unsupported data source kind: ${kind}`);
    return source;
  }
}
