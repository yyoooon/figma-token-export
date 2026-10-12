import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { transform } from '../src/transform';

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const META = 'com.huray.token-export';

// 형식 2에서 새로 붙은 것(메타·textDecoration·그림자 묶음)을 걷어 형식 1과 비교할 수 있게 한다.
function stripV2(root: any): any {
  const { ['Styles/Default']: _shadows, ...rest } = root;
  return strip(rest);
}
function strip(node: any): any {
  if (Array.isArray(node) || node == null || typeof node !== 'object') return node;
  const out: any = {};
  for (const [k, val] of Object.entries(node)) {
    if (k === '$extensions') continue;
    out[k] = strip(val);
  }
  if (out.$type === 'typography') delete out.$value.textDecoration;
  return out;
}

describe('합격 — v0.2', () => {
  const out = transform(load('v0.2.figma-raw.json'));

  it('그림자 3개가 스타일 이름으로 (안쪽 그림자는 Inner Shadow — 의도된 이름 변경)', () => {
    expect(Object.keys((out as any)['Styles/Default']).sort()).toEqual(['Button hover', 'Elevate', 'Inner Shadow']);
  });

  it('메타·밑줄·그림자 묶음을 걷으면 허브 v0.2(형식 1)와 같다', () => {
    expect(stripV2(out)).toEqual(load('hub-v0.2.tokens.json'));
  });

  it('출력 고정본과 같다', () => {
    expect(out).toEqual(load('v0.2.tokens.json'));
  });
});

describe('합격 — v0.3', () => {
  const out = transform(load('v0.3.figma-raw.json')) as any;

  it('텍스트 스타일 33개가 전부 타이포 토큰이 된다', () => {
    expect(out.$extensions[META].counts.typography).toBe(33);
  });

  it('Body/M/Bold 와 Body/M/Regular 가 공존하고 자간 -1%', () => {
    const body = out['Component/Mode 1'].Body.M;
    expect(Object.keys(body).sort()).toEqual(['Bold', 'Medium', 'Regular', 'Semibold']);
    expect(body.Bold.$value.letterSpacing).toBe('-1%');
    expect(body.Bold.$value.fontWeight).toBe('{Typography.Weight.Bold}');
  });

  it('그림자 5단계 (Elevation)', () => {
    expect(out.$extensions[META].counts.shadow).toBe(5);
    expect(Object.keys(out['Styles/Default'].Elevation)).toHaveLength(5);
  });

  it('모든 변수 잎에 scopes 가 있다', () => {
    const leaves: any[] = [];
    const walk = (n: any) => {
      for (const [k, v] of Object.entries(n)) {
        if (k.startsWith('$')) continue;
        if ((v as any).$value !== undefined) leaves.push(v);
        else walk(v);
      }
    };
    for (const [k, set] of Object.entries(out)) if (!k.startsWith('$')) walk(set);
    const vars = leaves.filter((l) => l.$extensions[META].source === 'variable');
    expect(vars.length).toBeGreaterThan(0);
    expect(vars.every((l) => Array.isArray(l.$extensions[META].scopes))).toBe(true);
  });

  it('출력 고정본과 같다', () => {
    expect(out).toEqual(load('v0.3.tokens.json'));
  });
});
