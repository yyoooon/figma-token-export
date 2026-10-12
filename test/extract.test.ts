import { describe, it, expect, vi } from 'vitest';
import { extractFigma } from '../src/extract';

// 텍스트 외 스타일 API 목 — 없으면 빈 목록.
function noOtherStyles() {
  return {
    getLocalEffectStylesAsync: vi.fn().mockResolvedValue([]),
    getLocalPaintStylesAsync: vi.fn().mockResolvedValue([]),
    getLocalGridStylesAsync: vi.fn().mockResolvedValue([]),
  };
}

describe('extractFigma', () => {
  it('serializes collections, variables (alias+color+scopes), text styles', async () => {
    (globalThis as any).figma = {
      variables: {
        getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([
          { id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Light' }] },
        ]),
        getLocalVariablesAsync: vi.fn().mockResolvedValue([
          {
            id: 'v1',
            name: 'Color/White Opacity/950',
            variableCollectionId: 'c1',
            resolvedType: 'COLOR',
            valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 0.95 } },
            scopes: ['ALL_SCOPES'],
            hiddenFromPublishing: false,
          },
          {
            id: 'v2',
            name: 'Text/White/Rest',
            variableCollectionId: 'c1',
            resolvedType: 'COLOR',
            valuesByMode: { m1: { type: 'VARIABLE_ALIAS', id: 'v1' } },
            scopes: ['TEXT_FILL'],
            hiddenFromPublishing: false,
          },
        ]),
      },
      getLocalTextStylesAsync: vi.fn().mockResolvedValue([
        {
          name: 'Display/lg-bold',
          boundVariables: {
            fontSize: { type: 'VARIABLE_ALIAS', id: 'v1' },
            fontFamily: { type: 'VARIABLE_ALIAS', id: 'v2' },
          },
          fontName: { family: 'Pretendard', style: 'Bold' },
          fontSize: 36,
          lineHeight: { unit: 'PIXELS', value: 48 },
          letterSpacing: { unit: 'PIXELS', value: -0.2 },
          textDecoration: 'NONE',
        },
      ]),
      ...noOtherStyles(),
    };

    const out = await extractFigma();
    expect(out.collections[0]).toEqual({ id: 'c1', name: 'Primitive', modes: [{ modeId: 'm1', name: 'Light' }] });
    expect(out.variables[0].valuesByMode.m1).toEqual({ kind: 'COLOR', r: 1, g: 1, b: 1, a: 0.95 });
    expect(out.variables[0].scopes).toEqual(['ALL_SCOPES']);
    expect(out.variables[0].hiddenFromPublishing).toBe(false);
    expect(out.variables[1].valuesByMode.m1).toEqual({ kind: 'ALIAS', id: 'v1' });
    expect(out.textStyles[0].boundVariables).toEqual({ fontSize: 'v1', fontFamily: 'v2' });
  });

  it('묶음 색(변수 참조 + 투명도)을 COMPOSED_COLOR 로 직렬화한다 — "[object Object]" 금지', async () => {
    (globalThis as any).figma = {
      variables: {
        getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
        getLocalVariablesAsync: vi.fn().mockResolvedValue([
          {
            id: 'v3',
            name: 'Overlay/Normal',
            variableCollectionId: 'c1',
            resolvedType: 'COLOR',
            valuesByMode: { m1: { color: { type: 'VARIABLE_ALIAS', id: 'v1' }, opacity: 30 } },
            scopes: ['ALL_SCOPES'],
            hiddenFromPublishing: false,
          },
        ]),
      },
      getLocalTextStylesAsync: vi.fn().mockResolvedValue([]),
      ...noOtherStyles(),
    };

    const out = await extractFigma();
    expect(out.variables[0].valuesByMode.m1).toEqual({
      kind: 'COMPOSED_COLOR',
      color: { kind: 'ALIAS', id: 'v1' },
      opacity: { kind: 'FLOAT', value: 30 },
    });
  });

  it('텍스트 스타일의 실제 값(미연결 자간 포함)을 읽는다', async () => {
    (globalThis as any).figma = {
      variables: {
        getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
        getLocalVariablesAsync: vi.fn().mockResolvedValue([]),
      },
      getLocalTextStylesAsync: vi.fn().mockResolvedValue([
        {
          name: 'Body/M/Bold',
          boundVariables: { fontSize: { id: 'v9' } },
          fontName: { family: 'Pretendard', style: 'Bold' },
          fontSize: 16,
          lineHeight: { unit: 'PIXELS', value: 24 },
          letterSpacing: { unit: 'PERCENT', value: -1 },
          textDecoration: 'NONE',
        },
      ]),
      ...noOtherStyles(),
    };
    const out = await extractFigma();
    expect(out.textStyles[0]).toEqual({
      name: 'Body/M/Bold',
      boundVariables: { fontSize: 'v9' },
      values: {
        fontFamily: 'Pretendard',
        fontStyle: 'Bold',
        fontSize: 16,
        lineHeight: { unit: 'PIXELS', value: 24 },
        letterSpacing: { unit: 'PERCENT', value: -1 },
        textDecoration: 'NONE',
      },
    });
  });

  it('이펙트 스타일의 그림자 겹과 연결 변수, 건너뛸 스타일 개수를 읽는다', async () => {
    (globalThis as any).figma = {
      variables: {
        getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
        getLocalVariablesAsync: vi.fn().mockResolvedValue([]),
      },
      getLocalTextStylesAsync: vi.fn().mockResolvedValue([]),
      getLocalPaintStylesAsync: vi.fn().mockResolvedValue([{ name: 'Guide/Red' }, { name: 'Guide/Blue' }]),
      getLocalGridStylesAsync: vi.fn().mockResolvedValue([{ name: 'Icon drawing guide' }]),
      getLocalEffectStylesAsync: vi.fn().mockResolvedValue([
        {
          name: 'Elevation/Xsmall',
          effects: [
            {
              type: 'DROP_SHADOW',
              visible: true,
              color: { r: 0, g: 0, b: 0, a: 0.1 },
              offset: { x: 0, y: 1 },
              radius: 2,
              spread: 0,
              boundVariables: { color: { id: 'vc' } },
            },
            { type: 'LAYER_BLUR', visible: true, radius: 4 },
          ],
        },
      ]),
    };
    const out = await extractFigma();
    expect(out.effectStyles).toEqual([
      {
        name: 'Elevation/Xsmall',
        shadows: [
          {
            inset: false,
            visible: true,
            color: { r: 0, g: 0, b: 0, a: 0.1 },
            offsetX: 0,
            offsetY: 1,
            blur: 2,
            spread: 0,
            boundVariables: { color: 'vc' },
          },
        ],
        otherEffects: ['LAYER_BLUR'],
      },
    ]);
    expect(out.skipped).toEqual({ paintStyles: 2, gridStyles: 1, effects: { LAYER_BLUR: 1 } });
  });
});
