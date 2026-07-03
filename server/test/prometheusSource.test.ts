import { describe, it, expect } from 'vitest';
import { shapePrometheus } from '../src/datasources/prometheusSource.js';

describe('shapePrometheus', () => {
  it('instant 쿼리 result를 라벨+value 행으로 평탄화한다', () => {
    const json = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          { metric: { job: 'api', instance: 'a:9090' }, value: [1700000000, '3.5'] },
          { metric: { job: 'web' }, value: [1700000000, '10'] },
        ],
      },
    };
    expect(shapePrometheus(json)).toEqual([
      { job: 'api', instance: 'a:9090', timestamp: 1700000000, value: 3.5 },
      { job: 'web', timestamp: 1700000000, value: 10 },
    ]);
  });

  it('range 쿼리(values)는 마지막 값을 대표로 쓴다', () => {
    const json = {
      data: { result: [{ metric: { job: 'x' }, values: [[1, '1'], [2, '2'], [3, '9']] }] },
    };
    expect(shapePrometheus(json)).toEqual([{ job: 'x', timestamp: 3, value: 9 }]);
  });

  it('숫자가 아닌 값은 원문 유지, result 없으면 빈 배열', () => {
    expect(shapePrometheus({ data: { result: [{ metric: {}, value: [1, 'NaN'] }] } }))
      .toEqual([{ timestamp: 1, value: 'NaN' }]);
    expect(shapePrometheus({ status: 'error' })).toEqual([]);
    expect(shapePrometheus(null)).toEqual([]);
  });
});
