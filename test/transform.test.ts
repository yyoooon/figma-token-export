import { describe, it, expect } from 'vitest';
import {
  figmaNameToPath,
  rgbaToHex,
  varNameToRef,
  buildVariableSets,
  buildTypographyTokens,
  transform,
  dtcgTypeOf,
} from '../src/transform';
import type { SerializedFigma, SerializedVariable } from '../src/types';

describe('dtcgTypeOf — scope로 DTCG $type 판정', () => {
  const mk = (resolvedType: any, scopes: string[]): SerializedVariable =>
    ({ id: 'x', name: 'n', collectionId: 'c', resolvedType, valuesByMode: {}, scopes, hiddenFromPublishing: false });

  it('COLOR → color', () => expect(dtcgTypeOf(mk('COLOR', ['ALL_SCOPES']))).toBe('color'));
  it('FLOAT + CORNER_RADIUS → dimension', () => expect(dtcgTypeOf(mk('FLOAT', ['CORNER_RADIUS']))).toBe('dimension'));
  it('FLOAT + GAP → dimension', () => expect(dtcgTypeOf(mk('FLOAT', ['GAP']))).toBe('dimension'));
  it('FLOAT + FONT_SIZE → dimension', () => expect(dtcgTypeOf(mk('FLOAT', ['FONT_SIZE']))).toBe('dimension'));
  it('FLOAT + OPACITY → number', () => expect(dtcgTypeOf(mk('FLOAT', ['OPACITY']))).toBe('number'));
  it('FLOAT + FONT_WEIGHT → number', () => expect(dtcgTypeOf(mk('FLOAT', ['FONT_WEIGHT']))).toBe('number'));
  it('FLOAT + 미지 scope → dimension(기본)', () => expect(dtcgTypeOf(mk('FLOAT', ['???']))).toBe('dimension'));
  it('STRING + FONT_FAMILY → fontFamily', () => expect(dtcgTypeOf(mk('STRING', ['FONT_FAMILY']))).toBe('fontFamily'));
  it('STRING + TEXT_CONTENT → string', () => expect(dtcgTypeOf(mk('STRING', ['TEXT_CONTENT']))).toBe('string'));
  it('BOOLEAN → string', () => expect(dtcgTypeOf(mk('BOOLEAN', []))).toBe('string'));
});

// 테스트 fixture 빌더 — scopes/hidden 기본값 채움.
function fig(partial: Partial<SerializedFigma>): SerializedFigma {
  return {
    collections: [],
    variables: [],
    textStyles: [],
    effectStyles: [],
    skipped: { paintStyles: 0, gridStyles: 0, effects: {} },
    ...partial,
  };
}
function v(p: Partial<SerializedVariable> & Pick<SerializedVariable, 'id' | 'name' | 'collectionId' | 'resolvedType'>): SerializedVariable {
  return { valuesByMode: {}, scopes: ['ALL_SCOPES'], hiddenFromPublishing: false, ...p };
}

describe('figmaNameToPath', () => {
  it('splits on / and keeps spaces inside segments', () => {
    expect(figmaNameToPath('Color/White Opacity/950')).toEqual(['Color', 'White Opacity', '950']);
  });
});

describe('rgbaToHex', () => {
  it('opaque white → #ffffff (no alpha when a=1)', () => {
    expect(rgbaToHex({ r: 1, g: 1, b: 1, a: 1 })).toBe('#ffffff');
  });
  it('transparent white → #ffffff00', () => {
    expect(rgbaToHex({ r: 1, g: 1, b: 1, a: 0 })).toBe('#ffffff00');
  });
  it('white at 5% alpha → #ffffff0d', () => {
    expect(rgbaToHex({ r: 1, g: 1, b: 1, a: 0.05 })).toBe('#ffffff0d');
  });
});

describe('varNameToRef', () => {
  it('wraps name with / replaced by . in braces', () => {
    expect(varNameToRef('Color/White Opacity/950')).toBe('{Color.White Opacity.950}');
  });
  it('typography primitive ref', () => {
    expect(varNameToRef('fontSize/9')).toBe('{fontSize.9}');
  });
});

describe('buildVariableSets', () => {
  const base = fig({
    collections: [
      { id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Light' }] },
      { id: 'c2', name: 'Scheme', modes: [{ modeId: 'm2', name: 'Light' }] },
    ],
    variables: [
      v({
        id: 'v1',
        name: 'Color/White Opacity/950',
        collectionId: 'c1',
        resolvedType: 'COLOR',
        valuesByMode: { m1: { kind: 'COLOR', r: 1, g: 1, b: 1, a: 0.95 } },
        scopes: ['ALL_SCOPES'],
      }),
      v({
        id: 'v2',
        name: 'Text/White/Rest',
        collectionId: 'c2',
        resolvedType: 'COLOR',
        valuesByMode: { m2: { kind: 'ALIAS', id: 'v1' } },
        scopes: ['TEXT_FILL'],
      }),
      v({
        id: 'r1',
        name: 'Radius/16',
        collectionId: 'c1',
        resolvedType: 'FLOAT',
        valuesByMode: { m1: { kind: 'FLOAT', value: 16 } },
        scopes: ['CORNER_RADIUS'],
      }),
    ],
  });

  it('COLOR 리프 → color + hex', () => {
    const sets = buildVariableSets(base);
    expect((sets['Primitive/Light'] as any)['Color']['White Opacity']['950']).toEqual({
      $type: 'color',
      $value: '#fffffff2',
    });
  });

  it('FLOAT+CORNER_RADIUS → dimension + "16px"', () => {
    const sets = buildVariableSets(base);
    expect((sets['Primitive/Light'] as any)['Radius']['16']).toEqual({
      $type: 'dimension',
      $value: '16px',
    });
  });

  it('ALIAS → 대상(color) 타입 + 전체경로 ref', () => {
    const sets = buildVariableSets(base);
    expect((sets['Scheme/Light'] as any)['Text']['White']['Rest']).toEqual({
      $type: 'color',
      $value: '{Color.White Opacity.950}',
    });
  });
});

describe('buildTypographyTokens', () => {
  const figma = fig({
    collections: [{ id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Light' }] }],
    variables: [
      v({ id: 'fs9', name: 'fontSize/9', collectionId: 'c1', resolvedType: 'FLOAT' }),
      v({ id: 'lh', name: 'Typography/Light height/leading-11', collectionId: 'c1', resolvedType: 'FLOAT' }),
      v({ id: 'fw', name: 'fontWeights/pretendard-0', collectionId: 'c1', resolvedType: 'FLOAT' }),
      v({ id: 'ls', name: 'letterSpacing/0', collectionId: 'c1', resolvedType: 'FLOAT' }),
      v({ id: 'ff', name: 'Typography/Font/Sans-serif', collectionId: 'c1', resolvedType: 'STRING' }),
    ],
    textStyles: [
      {
        name: 'Display/lg-bold',
        boundVariables: { fontFamily: 'ff', fontWeight: 'fw', lineHeight: 'lh', fontSize: 'fs9', letterSpacing: 'ls' },
      },
    ],
  });

  it('builds composite typography token with 5 standard fields only', () => {
    const t = buildTypographyTokens(figma);
    expect((t as any)['Display']['lg-bold']).toEqual({
      $type: 'typography',
      $value: {
        fontFamily: '{Typography.Font.Sans-serif}',
        fontWeight: '{fontWeights.pretendard-0}',
        lineHeight: '{Typography.Light height.leading-11}',
        fontSize: '{fontSize.9}',
        letterSpacing: '{letterSpacing.0}',
      },
    });
  });
});

describe('buildVariableSets — Effect 컬렉션이 그림자 세트를 만든다', () => {
  it('Effect 변수 이름(Inner Shadow/Over contents/...)이 그대로 Effect/Mode 1 트리가 된다', () => {
    const figma = fig({
      collections: [
        { id: 'cP', name: 'Primitive', modes: [{ modeId: 'mp', name: 'Light' }] },
        { id: 'cE', name: 'Effect', modes: [{ modeId: 'me', name: 'Mode 1' }] },
      ],
      variables: [
        v({ id: 'white', name: 'Color/White Opacity/950', collectionId: 'cP', resolvedType: 'COLOR', valuesByMode: { mp: { kind: 'COLOR', r: 1, g: 1, b: 1, a: 1 } } }),
        v({ id: 'ic', name: 'Inner Shadow/Over contents/Color', collectionId: 'cE', resolvedType: 'COLOR', scopes: ['EFFECT_COLOR'], valuesByMode: { me: { kind: 'ALIAS', id: 'white' } } }),
        v({ id: 'ix', name: 'Inner Shadow/Over contents/X', collectionId: 'cE', resolvedType: 'FLOAT', scopes: ['EFFECT_FLOAT'], valuesByMode: { me: { kind: 'FLOAT', value: -8 } } }),
      ],
    });
    const sets = buildVariableSets(figma);
    const oc = (sets['Effect/Mode 1'] as any)['Inner Shadow']['Over contents'];
    expect(oc.Color).toEqual({
      $type: 'color',
      $value: '{Color.White Opacity.950}',
    });
    expect(oc.X).toEqual({
      $type: 'dimension',
      $value: '-8px',
    });
  });
});

// 이슈 #1 — 변수 참조 + 투명도로 만든 색은 실제 색으로 풀어 #rrggbbaa 로 적는다.
describe('buildVariableSets — 묶음 색(변수 참조 + 투명도)', () => {
  const prim = { id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Mode 1' }] };
  const sem = { id: 'c2', name: 'Semantic', modes: [{ modeId: 'm2', name: 'Mode 1' }] };
  const black = v({ id: 'black', name: 'Common/1000', collectionId: 'c1', resolvedType: 'COLOR', valuesByMode: { m1: { kind: 'COLOR', r: 0, g: 0, b: 0, a: 1 } } });
  const op30 = v({ id: 'op30', name: 'Opacity/30', collectionId: 'c1', resolvedType: 'FLOAT', scopes: ['OPACITY'], valuesByMode: { m1: { kind: 'FLOAT', value: 30 } } });
  const overlay = (value: any) =>
    v({ id: 'ov', name: 'Overlay/Normal', collectionId: 'c2', resolvedType: 'COLOR', valuesByMode: { m2: value } });
  const out = (value: any, extra: SerializedVariable[] = []) =>
    (buildVariableSets(fig({ collections: [prim, sem], variables: [black, op30, ...extra, overlay(value)] }))['Semantic/Mode 1'] as any)
      .Overlay.Normal;

  it('색 별칭 + 숫자 투명도(퍼센트) → #0000004d', () => {
    expect(out({ kind: 'COMPOSED_COLOR', color: { kind: 'ALIAS', id: 'black' }, opacity: { kind: 'FLOAT', value: 30 } }))
      .toEqual({ $type: 'color', $value: '#0000004d' });
  });

  it('색 별칭 + 투명도 별칭 → 둘 다 따라가서 #0000004d', () => {
    expect(out({ kind: 'COMPOSED_COLOR', color: { kind: 'ALIAS', id: 'black' }, opacity: { kind: 'ALIAS', id: 'op30' } }))
      .toEqual({ $type: 'color', $value: '#0000004d' });
  });

  it('원색 + 투명도 별칭 → 색 자체 알파에 곱한다', () => {
    expect(out({ kind: 'COMPOSED_COLOR', color: { kind: 'COLOR', r: 1, g: 1, b: 1, a: 0.5 }, opacity: { kind: 'ALIAS', id: 'op30' } }))
      .toEqual({ $type: 'color', $value: '#ffffff26' });
  });

  it('별칭이 여러 번 이어져도 끝까지 따라간다', () => {
    const mid = v({ id: 'mid', name: 'Color/Black', collectionId: 'c1', resolvedType: 'COLOR', valuesByMode: { m1: { kind: 'ALIAS', id: 'black' } } });
    expect(out({ kind: 'COMPOSED_COLOR', color: { kind: 'ALIAS', id: 'mid' }, opacity: { kind: 'FLOAT', value: 30 } }, [mid]))
      .toEqual({ $type: 'color', $value: '#0000004d' });
  });

  it('모드가 여러 개 — 같은 컬렉션 참조는 같은 모드, 다른 컬렉션은 기본(첫) 모드', () => {
    const theme = { id: 'c3', name: 'Theme', modes: [{ modeId: 'L', name: 'Light' }, { modeId: 'D', name: 'Dark' }] };
    const brand = { id: 'c4', name: 'Brand', modes: [{ modeId: 'A', name: 'A' }, { modeId: 'B', name: 'B' }] };
    const fg = v({ id: 'fg', name: 'Fg', collectionId: 'c3', resolvedType: 'COLOR', valuesByMode: { L: { kind: 'COLOR', r: 0, g: 0, b: 0, a: 1 }, D: { kind: 'COLOR', r: 1, g: 1, b: 1, a: 1 } } });
    const op = v({ id: 'op', name: 'Op', collectionId: 'c4', resolvedType: 'FLOAT', scopes: ['OPACITY'], valuesByMode: { A: { kind: 'FLOAT', value: 50 }, B: { kind: 'FLOAT', value: 10 } } });
    const dim = { kind: 'COMPOSED_COLOR', color: { kind: 'ALIAS', id: 'fg' }, opacity: { kind: 'ALIAS', id: 'op' } } as const;
    const scrim = v({ id: 'scrim', name: 'Scrim', collectionId: 'c3', resolvedType: 'COLOR', valuesByMode: { L: dim, D: dim } });
    const sets = buildVariableSets(fig({ collections: [theme, brand], variables: [fg, op, scrim] }));
    expect((sets['Theme/Light'] as any).Scrim.$value).toBe('#00000080');
    expect((sets['Theme/Dark'] as any).Scrim.$value).toBe('#ffffff80');
  });

  it('대상 변수가 없으면 참조한 변수 이름을 담아 throw', () => {
    expect(() => out({ kind: 'COMPOSED_COLOR', color: { kind: 'ALIAS', id: 'ghost' }, opacity: { kind: 'FLOAT', value: 30 } }))
      .toThrowError(/Overlay\/Normal/);
  });
});

describe('깨진 참조 — 에러에 이름을 담아 던진다', () => {
  it('별칭 대상이 없으면 참조한 변수 이름을 담아 throw', () => {
    const figma = fig({
      collections: [{ id: 'c1', name: 'Scheme', modes: [{ modeId: 'm1', name: 'Light' }] }],
      variables: [
        v({ id: 'v2', name: 'Text/White/Rest', collectionId: 'c1', resolvedType: 'COLOR', valuesByMode: { m1: { kind: 'ALIAS', id: 'ghost' } } }),
      ],
    });
    expect(() => buildVariableSets(figma)).toThrowError(/Text\/White\/Rest/);
  });

  it('텍스트 스타일이 없는 변수를 참조하면 스타일 이름을 담아 throw', () => {
    const figma = fig({
      collections: [{ id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Light' }] }],
      textStyles: [{ name: 'Display/lg-bold', boundVariables: { fontSize: 'ghost' } }],
    });
    expect(() => buildTypographyTokens(figma)).toThrowError(/Display\/lg-bold/);
  });
});

describe('transform (assembly)', () => {
  it('merges typography into the set holding its bound primitives (no Token Studio metadata)', () => {
    const figma = fig({
      collections: [{ id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Light' }] }],
      variables: [
        v({ id: 'fs9', name: 'fontSize/9', collectionId: 'c1', resolvedType: 'FLOAT', valuesByMode: { m1: { kind: 'FLOAT', value: 40 } } }),
        v({ id: 'fw', name: 'fontWeights/pretendard-0', collectionId: 'c1', resolvedType: 'FLOAT', valuesByMode: { m1: { kind: 'FLOAT', value: 700 } } }),
        v({ id: 'lh', name: 'leading/11', collectionId: 'c1', resolvedType: 'FLOAT', valuesByMode: { m1: { kind: 'FLOAT', value: 52 } } }),
        v({ id: 'ls', name: 'letterSpacing/0', collectionId: 'c1', resolvedType: 'FLOAT', valuesByMode: { m1: { kind: 'FLOAT', value: 0 } } }),
        v({ id: 'ff', name: 'Typography/Font/Sans-serif', collectionId: 'c1', resolvedType: 'STRING', valuesByMode: { m1: { kind: 'STRING', value: 'Pretendard' } } }),
      ],
      textStyles: [
        { name: 'Display/lg-bold', boundVariables: { fontFamily: 'ff', fontWeight: 'fw', lineHeight: 'lh', fontSize: 'fs9', letterSpacing: 'ls' } },
      ],
    });
    const out = transform(figma) as any;
    expect(out['Primitive/Light']['Display']['lg-bold'].$type).toBe('typography');
    expect(out['Primitive/Light']['fontSize']['9']).toMatchObject({ $type: 'dimension', $value: '40px' });
    expect(out['$themes']).toBeUndefined();
    expect(out['$metadata']).toBeUndefined();
  });
});
