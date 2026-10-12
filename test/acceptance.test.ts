import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { transform } from '../src/transform';

const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const META = 'com.huray.token-export';

const STYLE_SETS = ['Text Styles', 'Effect Styles', 'Color Styles', 'Grid Styles'];
const TYPO_GROUPS = ['Display', 'Headline', 'Title', 'Body', 'Caption'];

// 형식 2에서 새로 붙은 것(메타·textDecoration·스타일 묶음)을 걷어 형식 1과 비교할 수 있게 한다.
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
const without = (o: any, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

describe('합격 — v0.2', () => {
  const out = transform(load('v0.2.figma-raw.json')) as any;
  const hub = load('hub-v0.2.tokens.json');

  it('변수 묶음은 허브 v0.2 와 같다 (허브에 섞여 있던 타이포 그룹 제외)', () => {
    const hubVars = { ...hub, 'Primitive/Light': without(hub['Primitive/Light'], TYPO_GROUPS) };
    expect(strip(without(out, STYLE_SETS))).toEqual(hubVars);
  });

  it('Text Styles 22개는 허브 v0.2 의 타이포와 같다', () => {
    expect(strip(out['Text Styles'])).toEqual(Object.fromEntries(TYPO_GROUPS.map((g) => [g, hub['Primitive/Light'][g]])));
  });

  it('그림자 3 (안쪽 그림자는 Inner Shadow — 의도된 이름) · 색 스타일 2 · 격자 1', () => {
    expect(Object.keys(out['Effect Styles']).sort()).toEqual(['Button hover', 'Elevate', 'Inner Shadow']);
    expect(Object.keys(out['Color Styles'].Guide).sort()).toEqual(['Size', 'Value']);
    expect(out['Grid Styles']['Icon drawing guide'].$type).toBe('grid');
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
    const body = out['Text Styles'].Body.M;
    expect(Object.keys(body).sort()).toEqual(['Bold', 'Medium', 'Regular', 'Semibold']);
    expect(body.Bold.$value.letterSpacing).toBe('-1%');
    expect(body.Bold.$value.fontWeight).toBe('{Typography.Weight.Bold}');
  });

  it('그림자 5단계 (Elevation)', () => {
    expect(out.$extensions[META].counts.shadow).toBe(5);
    expect(Object.keys(out['Effect Styles'].Elevation)).toHaveLength(5);
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
