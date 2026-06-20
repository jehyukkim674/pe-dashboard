import { describe, it, expect } from 'vitest';
import {
  WIDGET_TYPES, WIDGET_TYPE_OPTIONS, DEFAULT_WIDGET_SIZE,
} from '../src/components/widgets/widgetTypes';

describe('widget type descriptors (single source)', () => {
  it('lists all six widget types in modal order', () => {
    expect(WIDGET_TYPE_OPTIONS.map((o) => o.value)).toEqual(
      ['stat', 'table', 'chart', 'log', 'status', 'text'],
    );
  });

  it('derives default sizes for every type', () => {
    expect(DEFAULT_WIDGET_SIZE.stat).toEqual({ w: 3, h: 2 });
    expect(DEFAULT_WIDGET_SIZE.table).toEqual({ w: 6, h: 5 });
    expect(DEFAULT_WIDGET_SIZE.status).toEqual({ w: 6, h: 4 });
    expect(DEFAULT_WIDGET_SIZE.text).toEqual({ w: 4, h: 3 });
    for (const t of WIDGET_TYPES) {
      expect(DEFAULT_WIDGET_SIZE[t.kind]).toEqual(t.defaultSize);
    }
  });

  it('keeps options and sizes in sync (same kinds)', () => {
    expect(WIDGET_TYPE_OPTIONS.map((o) => o.value).sort())
      .toEqual(Object.keys(DEFAULT_WIDGET_SIZE).sort());
  });
});
