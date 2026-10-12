import { describe, it, expect } from 'vitest';
import {
  figmaNameToPath,
  rgbaToHex,
  varNameToRef,
  buildVariableSets,
  buildTypographyTokens,
  buildEffectTokens,
  buildPaintTokens,
  buildGridTokens,
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
    paintStyles: [],
    gridStyles: [],
    ...partial,
  };
}
function v(p: Partial<SerializedVariable> & Pick<SerializedVariable, 'id' | 'name' | 'collectionId' | 'resolvedType'>): SerializedVariable {
  return { valuesByMode: {}, scopes: ['ALL_SCOPES'], hiddenFromPublishing: false, ...p };
}

// 텍스트 스타일 실제 값 기본(굵게 16/24, 자간 -1%).
const baseValues = {
  fontFamily: 'Pretendard',
  fontStyle: 'Bold',
  fontSize: 16,
  lineHeight: { unit: 'PIXELS' as const, value: 24 },
  letterSpacing: { unit: 'PERCENT' as const, value: -1 },
  textDecoration: 'NONE' as const,
};

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
    expect((sets['Primitive/Light'] as any)['Color']['White Opacity']['950']).toMatchObject({
      $type: 'color',
      $value: '#fffffff2',
    });
  });

  it('FLOAT+CORNER_RADIUS → dimension + "16px"', () => {
    const sets = buildVariableSets(base);
    expect((sets['Primitive/Light'] as any)['Radius']['16']).toMatchObject({
      $type: 'dimension',
      $value: '16px',
    });
  });

  it('ALIAS → 대상(color) 타입 + 전체경로 ref', () => {
    const sets = buildVariableSets(base);
    expect((sets['Scheme/Light'] as any)['Text']['White']['Rest']).toMatchObject({
      $type: 'color',
      $value: '{Color.White Opacity.950}',
    });
  });
});

describe('buildTypographyTokens — 형식 2', () => {
  const sizeVar = v({ id: 'vs', name: 'Typography/Size/Size-6', collectionId: 'c', resolvedType: 'FLOAT', scopes: ['FONT_SIZE'] });

  it('스타일 이름 전체를 경로로 쓴다 (Body/M/Bold 와 Body/M/Regular 공존)', () => {
    const out = buildTypographyTokens(
      fig({
        variables: [sizeVar],
        textStyles: [
          { name: 'Body/M/Bold', boundVariables: { fontSize: 'vs' }, values: baseValues },
          { name: 'Body/M/Regular', boundVariables: { fontSize: 'vs' }, values: { ...baseValues, fontStyle: 'Regular' } },
        ],
      }),
    );
    expect(out.map((t) => t.path.join('/'))).toEqual(['Body/M/Bold', 'Body/M/Regular']);
  });

  it('연결 값은 별칭, 미연결 값은 단위 붙은 실제 값', () => {
    const [t] = buildTypographyTokens(
      fig({ variables: [sizeVar], textStyles: [{ name: 'Body/M/Bold', boundVariables: { fontSize: 'vs' }, values: baseValues }] }),
    );
    expect(t.leaf).toEqual({
      $type: 'typography',
      $value: {
        fontFamily: 'Pretendard',
        fontSize: '{Typography.Size.Size-6}',
        fontWeight: '700',
        lineHeight: '24px',
        letterSpacing: '-1%',
        textDecoration: 'none',
      },
      $extensions: { 'com.huray.token-export': { source: 'textStyle' } },
    });
  });

  it('행간 AUTO → normal, PERCENT → %, 밑줄 → underline', () => {
    const [t] = buildTypographyTokens(
      fig({
        textStyles: [
          {
            name: 'Caption/lg-medium-underline',
            boundVariables: {},
            values: { ...baseValues, fontStyle: 'Medium', lineHeight: { unit: 'AUTO' }, textDecoration: 'UNDERLINE' },
          },
        ],
      }),
    );
    expect(t.leaf.$value).toMatchObject({ lineHeight: 'normal', fontWeight: '500', textDecoration: 'underline' });
    const [p] = buildTypographyTokens(
      fig({ textStyles: [{ name: 'A/B', boundVariables: {}, values: { ...baseValues, lineHeight: { unit: 'PERCENT', value: 150 } } }] }),
    );
    expect(p.leaf.$value).toMatchObject({ lineHeight: '150%' });
  });

  it('이름에 / 가 없어도 한 칸 경로로 내보낸다', () => {
    const [t] = buildTypographyTokens(fig({ textStyles: [{ name: 'Heading', boundVariables: {}, values: baseValues }] }));
    expect(t.path).toEqual(['Heading']);
  });

  it('소수 오차는 4자리로 정리한다 (-0.20000000298 → -0.2px)', () => {
    const [t] = buildTypographyTokens(
      fig({
        textStyles: [
          { name: 'A/B', boundVariables: {}, values: { ...baseValues, letterSpacing: { unit: 'PIXELS', value: -0.20000000298023224 } } },
        ],
      }),
    );
    expect(t.leaf.$value).toMatchObject({ letterSpacing: '-0.2px' });
  });
});

describe('buildEffectTokens', () => {
  const colorVar = v({ id: 'vc', name: 'Color/Black Opacity/100', collectionId: 'c', resolvedType: 'COLOR' });
  const layer = {
    inset: false,
    visible: true,
    color: { r: 0, g: 0, b: 0, a: 0.1 },
    offsetX: 0,
    offsetY: 4,
    blur: 16,
    spread: 0,
    boundVariables: {},
  };
  const eff = (name: string, p: Partial<{ shadows: any[]; blurs: any[]; others: string[] }>) => ({
    name,
    shadows: [],
    blurs: [],
    others: [],
    ...p,
  });

  it('그림자만 → shadow 배열, 연결 값은 별칭', () => {
    const { tokens } = buildEffectTokens(
      fig({ variables: [colorVar], effectStyles: [eff('Elevation/Xsmall', { shadows: [{ ...layer, boundVariables: { color: 'vc' } }] })] }),
    );
    expect(tokens[0].path).toEqual(['Elevation', 'Xsmall']);
    expect(tokens[0].leaf).toEqual({
      $type: 'shadow',
      $value: [{ color: '{Color.Black Opacity.100}', offsetX: '0px', offsetY: '4px', blur: '16px', spread: '0px', inset: false }],
      $extensions: { 'com.huray.token-export': { source: 'effectStyle' } },
    });
  });

  it('흐림·처음 보는 효과가 섞이면 effect 배열', () => {
    const { tokens } = buildEffectTokens(
      fig({
        effectStyles: [
          eff('Glass', { shadows: [{ ...layer, inset: true }], blurs: [{ type: 'BACKGROUND_BLUR', visible: true, radius: 8 }], others: ['NOISE'] }),
        ],
      }),
    );
    expect(tokens[0].leaf.$type).toBe('effect');
    expect(tokens[0].leaf.$value).toEqual([
      { type: 'innerShadow', color: '#0000001a', offsetX: '0px', offsetY: '4px', blur: '16px', spread: '0px' },
      { type: 'backgroundBlur', radius: '8px' },
      { type: 'NOISE' },
    ]);
  });

  it('숨긴 겹은 빼고 개수를 센다, 보이는 겹이 없으면 토큰 없음', () => {
    const r = buildEffectTokens(fig({ effectStyles: [eff('E', { shadows: [{ ...layer, visible: false }] })] }));
    expect(r.tokens).toEqual([]);
    expect(r.hidden).toBe(1);
  });

  it('연결 변수가 없으면 예외', () => {
    expect(() => buildEffectTokens(fig({ effectStyles: [eff('E', { shadows: [{ ...layer, boundVariables: { radius: 'nope' } }] })] }))).toThrow(/'E'/);
  });
});

describe('buildPaintTokens', () => {
  const white = v({ id: 'vw', name: 'Fill/Base', collectionId: 'c', resolvedType: 'COLOR' });
  const ps = (name: string, paints: any[]) => ({ name, paints });

  it('단색 하나 → color (연결이면 별칭, 아니면 불투명도 곱한 hex)', () => {
    const { tokens } = buildPaintTokens(
      fig({
        variables: [white],
        paintStyles: [
          ps('Guide/Base', [{ kind: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 }, opacity: 1, boundColor: 'vw' }]),
          ps('Guide/Red', [{ kind: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 0.5 }]),
        ],
      }),
    );
    expect(tokens.map((t) => t.leaf.$value)).toEqual(['{Fill.Base}', '#ff000080']);
    expect(tokens[0].leaf.$type).toBe('color');
  });

  it('그라디언트 하나 → gradient (선형은 각도)', () => {
    const { tokens } = buildPaintTokens(
      fig({
        variables: [white],
        paintStyles: [
          ps('Fade/Top', [
            {
              kind: 'GRADIENT',
              gradientType: 'LINEAR',
              visible: true,
              opacity: 1,
              stops: [
                { color: { r: 1, g: 1, b: 1, a: 1 }, position: 0, boundColor: 'vw' },
                { color: { r: 1, g: 1, b: 1, a: 0 }, position: 1 },
              ],
              transform: [
                [0, 1, 0],
                [-1, 0, 1],
              ],
            },
          ]),
        ],
      }),
    );
    expect(tokens[0].leaf).toMatchObject({
      $type: 'gradient',
      $value: { type: 'linear', angle: 90, stops: [{ color: '{Fill.Base}', position: 0 }, { color: '#ffffff00', position: 1 }] },
    });
  });

  it('이미지·여러 겹 → paint 배열', () => {
    const { tokens } = buildPaintTokens(fig({ paintStyles: [ps('Photo', [{ kind: 'IMAGE', visible: true, imageHash: 'abc', scaleMode: 'FILL' }])] }));
    expect(tokens[0].leaf).toMatchObject({ $type: 'paint', $value: [{ type: 'image', imageHash: 'abc', scaleMode: 'FILL' }] });
  });
});

describe('buildGridTokens', () => {
  it('연결된 값은 별칭으로 바꾸고 원본 boundVariables 는 남기지 않는다', () => {
    const gap = v({ id: 'vg', name: 'Spacing/100', collectionId: 'c', resolvedType: 'FLOAT', scopes: ['GAP'] });
    const { tokens } = buildGridTokens(
      fig({
        variables: [gap],
        gridStyles: [{ name: 'Columns', grids: [{ pattern: 'COLUMNS', count: 4, gutterSize: 8, visible: true, boundVariables: { gutterSize: { type: 'VARIABLE_ALIAS', id: 'vg' } } }] }],
      }),
    );
    expect(tokens[0].leaf.$value).toEqual([{ pattern: 'COLUMNS', count: 4, gutterSize: '{Spacing.100}' }]);
  });

  it('격자는 grid 배열, 색은 hex', () => {
    const { tokens } = buildGridTokens(
      fig({ gridStyles: [{ name: 'Icon drawing guide', grids: [{ pattern: 'GRID', sectionSize: 1, visible: true, color: { r: 1, g: 0, b: 0, a: 0.1 } }] }] }),
    );
    expect(tokens[0].leaf).toMatchObject({ $type: 'grid', $value: [{ pattern: 'GRID', sectionSize: 1, color: '#ff00001a' }] });
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
    expect(oc.Color).toMatchObject({
      $type: 'color',
      $value: '{Color.White Opacity.950}',
    });
    expect(oc.X).toMatchObject({
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
      .toMatchObject({ $type: 'color', $value: '#0000004d' });
  });

  it('색 별칭 + 투명도 별칭 → 둘 다 따라가서 #0000004d', () => {
    expect(out({ kind: 'COMPOSED_COLOR', color: { kind: 'ALIAS', id: 'black' }, opacity: { kind: 'ALIAS', id: 'op30' } }))
      .toMatchObject({ $type: 'color', $value: '#0000004d' });
  });

  it('원색 + 투명도 별칭 → 색 자체 알파에 곱한다', () => {
    expect(out({ kind: 'COMPOSED_COLOR', color: { kind: 'COLOR', r: 1, g: 1, b: 1, a: 0.5 }, opacity: { kind: 'ALIAS', id: 'op30' } }))
      .toMatchObject({ $type: 'color', $value: '#ffffff26' });
  });

  it('별칭이 여러 번 이어져도 끝까지 따라간다', () => {
    const mid = v({ id: 'mid', name: 'Color/Black', collectionId: 'c1', resolvedType: 'COLOR', valuesByMode: { m1: { kind: 'ALIAS', id: 'black' } } });
    expect(out({ kind: 'COMPOSED_COLOR', color: { kind: 'ALIAS', id: 'mid' }, opacity: { kind: 'FLOAT', value: 30 } }, [mid]))
      .toMatchObject({ $type: 'color', $value: '#0000004d' });
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
      textStyles: [{ name: 'Display/lg-bold', boundVariables: { fontSize: 'ghost' }, values: baseValues }],
    });
    expect(() => buildTypographyTokens(figma)).toThrowError(/Display\/lg-bold/);
  });
});

describe('범용 추출 — 묶음·메타·모드', () => {
  const coll = { id: 'c', name: 'Component', modes: [{ modeId: 'm', name: 'Mode 1' }] };
  const radius = v({
    id: 'r',
    name: 'Radius/250',
    collectionId: 'c',
    resolvedType: 'FLOAT',
    scopes: ['CORNER_RADIUS'],
    valuesByMode: { m: { kind: 'FLOAT', value: 20 } },
  });

  it('변수 잎에 source·scopes 를 싣는다', () => {
    const out = transform(fig({ collections: [coll], variables: [radius] }));
    expect((out['Component/Mode 1'] as any).Radius['250']).toEqual({
      $type: 'dimension',
      $value: '20px',
      $extensions: { 'com.huray.token-export': { source: 'variable', scopes: ['CORNER_RADIUS'] } },
    });
  });

  it('루트에 형식 버전·개수표·숨긴 겹 수', () => {
    const out = transform(
      fig({ collections: [coll], variables: [radius], textStyles: [{ name: 'Body/M/Bold', boundVariables: {}, values: baseValues }] }),
    );
    expect(out.$extensions).toEqual({
      'com.huray.token-export': { formatVersion: 2, counts: { dimension: 1, typography: 1 }, hiddenLayers: 0 },
    });
  });

  it('모드가 두 벌이면 둘 다 내보낸다 (멈추지 않음)', () => {
    const scheme = { id: 's', name: 'Scheme', modes: [{ modeId: 'l', name: 'Light' }, { modeId: 'd', name: 'Dark' }] };
    const fg = v({ id: 'fg', name: 'Fg', collectionId: 's', resolvedType: 'COLOR', valuesByMode: { l: { kind: 'COLOR', r: 0, g: 0, b: 0, a: 1 }, d: { kind: 'COLOR', r: 1, g: 1, b: 1, a: 1 } } });
    const out = transform(fig({ collections: [scheme], variables: [fg] })) as any;
    expect(out['Scheme/Light'].Fg.$value).toBe('#000000');
    expect(out['Scheme/Dark'].Fg.$value).toBe('#ffffff');
  });

  it('스타일은 종류별 묶음 — 같은 이름의 텍스트·색 스타일이 겹치지 않는다', () => {
    const out = transform(
      fig({
        textStyles: [{ name: 'Body/M', boundVariables: {}, values: baseValues }],
        paintStyles: [{ name: 'Body/M', paints: [{ kind: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0 }, opacity: 1 }] }],
        effectStyles: [{ name: 'Elevation/Xsmall', shadows: [{ inset: false, visible: true, color: { r: 0, g: 0, b: 0, a: 0.1 }, offsetX: 0, offsetY: 1, blur: 2, spread: 0, boundVariables: {} }], blurs: [], others: [] }],
        gridStyles: [{ name: 'Guide', grids: [{ pattern: 'GRID', sectionSize: 8, visible: true }] }],
      }),
    ) as any;
    expect(out['Text Styles'].Body.M.$type).toBe('typography');
    expect(out['Color Styles'].Body.M.$type).toBe('color');
    expect(out['Effect Styles'].Elevation.Xsmall.$type).toBe('shadow');
    expect(out['Grid Styles'].Guide.$type).toBe('grid');
  });

  it('같은 이름의 텍스트 스타일 두 개면 예외', () => {
    expect(() =>
      transform(
        fig({
          textStyles: [
            { name: 'Body/M', boundVariables: {}, values: baseValues },
            { name: 'Body/M', boundVariables: {}, values: baseValues },
          ],
        }),
      ),
    ).toThrow(/Body\/M/);
  });

  it('숨긴 겹은 루트 hiddenLayers 에 센다', () => {
    const hidden = { inset: false, visible: false, color: { r: 0, g: 0, b: 0, a: 0.1 }, offsetX: 0, offsetY: 1, blur: 2, spread: 0, boundVariables: {} };
    const out = transform(fig({ effectStyles: [{ name: 'E', shadows: [hidden], blurs: [], others: [] }] })) as any;
    expect(out['Effect Styles']).toBeUndefined();
    expect(out.$extensions['com.huray.token-export'].hiddenLayers).toBe(1);
  });

  it('굵기 미연결 + 모르는 글꼴 스타일 이름은 그대로 (멈추지 않음)', () => {
    const out = transform(
      fig({ textStyles: [{ name: 'A/B', boundVariables: {}, values: { ...baseValues, fontStyle: 'Condensed Bold' } }] }),
    ) as any;
    expect(out['Text Styles'].A.B.$value.fontWeight).toBe('Condensed Bold');
  });
});

describe('transform (assembly)', () => {
  it('typography goes to Text Styles; primitives stay in their set (no Token Studio metadata)', () => {
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
        { name: 'Display/lg-bold', boundVariables: { fontFamily: 'ff', fontWeight: 'fw', lineHeight: 'lh', fontSize: 'fs9', letterSpacing: 'ls' }, values: baseValues },
      ],
    });
    const out = transform(figma) as any;
    expect(out['Text Styles']['Display']['lg-bold'].$type).toBe('typography');
    expect(out['Primitive/Light']['fontSize']['9']).toMatchObject({ $type: 'dimension', $value: '40px' });
    expect(out['$themes']).toBeUndefined();
    expect(out['$metadata']).toBeUndefined();
  });
});
