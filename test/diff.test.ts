import { describe, it, expect } from 'vitest';
import { flattenTokens, diffTokens, formatPrBody } from '../src/diff';

const leaf = (v: unknown) => ({ $type: 'color', $value: v });

describe('flattenTokens', () => {
  it('세트/경로로 평탄화하고 $-키는 건너뛴다', () => {
    const json = {
      'Primitive/Light': { Color: { Red: { '500': leaf('#f00') } } },
      $themes: [],
      $metadata: { tokenSetOrder: ['Primitive/Light'] },
    };
    expect(flattenTokens(json)).toEqual({ 'Primitive/Light/Color/Red/500': '#f00' });
  });
});

describe('diffTokens', () => {
  const oldJson = {
    'Primitive/Light': {
      Color: { Red: { '500': leaf('#e62b34') }, Gone: { x: leaf('#000') } },
    },
  };
  const newJson = {
    'Primitive/Light': {
      Color: { Red: { '500': leaf('#f23d29') }, New: { y: leaf('#fff') } },
    },
  };

  it('changed/added/removed 를 분류한다', () => {
    const d = diffTokens(oldJson, newJson);
    expect(d.changed).toEqual([
      { path: 'Primitive/Light/Color/Red/500', from: '#e62b34', to: '#f23d29' },
    ]);
    expect(d.added).toEqual([{ path: 'Primitive/Light/Color/New/y', value: '#fff' }]);
    expect(d.removed).toEqual([{ path: 'Primitive/Light/Color/Gone/x', value: '#000' }]);
  });

  it('이전 파일이 비면 전부 added', () => {
    const d = diffTokens({}, newJson);
    expect(d.added.length).toBe(2);
    expect(d.changed.length).toBe(0);
    expect(d.removed.length).toBe(0);
  });
});

describe('formatPrBody', () => {
  it('변경 없으면 한 줄', () => {
    expect(formatPrBody({ added: [], removed: [], changed: [], metaChanged: false }, 'foo')).toContain('변경 없음');
  });

  it('요약 카운트와 변경 내역을 담는다', () => {
    const body = formatPrBody(
      { added: [], removed: [], changed: [{ path: 'A/b', from: '#000', to: '#fff' }], metaChanged: false },
      'front-care-hub',
    );
    expect(body).toContain('front-care-hub');
    expect(body).toContain('변경 1 · 추가 0 · 삭제 0');
    expect(body).toContain('`A/b`: `#000` → `#fff`');
  });
});

describe('diffTokens — 값 외 변경(형식·용도) 감지', () => {
  const base = { 'P/M': { A: { $type: 'color', $value: '#000' } } };

  it('값은 같고 용도·출처 메타만 달라도 metaChanged', () => {
    const next = {
      $extensions: { 'com.huray.token-export': { formatVersion: 2 } },
      'P/M': { A: { $type: 'color', $value: '#000', $extensions: { 'com.huray.token-export': { source: 'variable', scopes: ['TEXT_FILL'] } } } },
    };
    const d = diffTokens(base, next);
    expect(d.changed).toEqual([]);
    expect(d.metaChanged).toBe(true);
    expect(formatPrBody(d, 'p')).not.toContain('변경 없음');
  });

  it('$type 만 달라도 metaChanged', () => {
    const d = diffTokens(base, { 'P/M': { A: { $type: 'string', $value: '#000' } } });
    expect(d.metaChanged).toBe(true);
  });

  it('완전히 같으면 metaChanged=false', () => {
    expect(diffTokens(base, base).metaChanged).toBe(false);
  });
});
