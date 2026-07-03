import { describe, it, expect } from 'vitest';
import { csvCell } from '../src/components/widgets/TableWidget';

describe('csvCell', () => {
  it('일반 값은 그대로', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell('123')).toBe('123');
  });
  it('쉼표·따옴표·줄바꿈은 따옴표로 감싸고 내부 따옴표는 2배', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });
  it('=,+,-,@ 로 시작하는 수식 인젝션 값은 앞에 \' 를 붙여 무력화', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+1+2')).toBe("'+1+2");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });
  it('수식 문자로 시작하면서 쉼표도 포함하면 무력화 후 따옴표로 감싼다', () => {
    expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`);
  });
});
