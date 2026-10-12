import { describe, it, expect, vi } from 'vitest';
import { extractFigma } from '../src/extract';

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
        },
      ]),
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
    };

    const out = await extractFigma();
    expect(out.variables[0].valuesByMode.m1).toEqual({
      kind: 'COMPOSED_COLOR',
      color: { kind: 'ALIAS', id: 'v1' },
      opacity: { kind: 'FLOAT', value: 30 },
    });
  });
});
