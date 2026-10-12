import type {
  SerializedEffectStyle,
  SerializedFigma,
  SerializedShadowLayer,
  SerializedTextStyle,
  SerializedValue,
  SerializedVariable,
} from './types';

function toValue(raw: unknown): SerializedValue {
  if (raw && typeof raw === 'object' && (raw as any).type === 'VARIABLE_ALIAS') {
    return { kind: 'ALIAS', id: (raw as any).id };
  }
  if (raw && typeof raw === 'object' && 'color' in raw && 'opacity' in raw) {
    const c = raw as { color: unknown; opacity: unknown };
    return { kind: 'COMPOSED_COLOR', color: toValue(c.color), opacity: toValue(c.opacity) };
  }
  if (raw && typeof raw === 'object' && 'r' in (raw as any)) {
    const c = raw as { r: number; g: number; b: number; a?: number };
    return { kind: 'COLOR', r: c.r, g: c.g, b: c.b, a: c.a ?? 1 };
  }
  if (typeof raw === 'number') return { kind: 'FLOAT', value: raw };
  if (typeof raw === 'boolean') return { kind: 'BOOLEAN', value: raw };
  return { kind: 'STRING', value: String(raw) };
}

const TYPO_PROPS = ['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing'] as const;
const SHADOW_PROPS = ['color', 'offsetX', 'offsetY', 'radius', 'spread'] as const;

export async function extractFigma(): Promise<SerializedFigma> {
  const colls = await figma.variables.getLocalVariableCollectionsAsync();
  const vars = await figma.variables.getLocalVariablesAsync();
  const styles = await figma.getLocalTextStylesAsync();

  const collections = colls.map((c) => ({
    id: c.id,
    name: c.name,
    modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
  }));

  const variables: SerializedVariable[] = vars.map((v) => {
    const valuesByMode: Record<string, SerializedValue> = {};
    for (const [modeId, raw] of Object.entries(v.valuesByMode)) {
      valuesByMode[modeId] = toValue(raw);
    }
    return {
      id: v.id,
      name: v.name,
      collectionId: v.variableCollectionId,
      resolvedType: v.resolvedType as SerializedVariable['resolvedType'],
      valuesByMode,
      scopes: v.scopes as string[],
      hiddenFromPublishing: v.hiddenFromPublishing,
    };
  });

  const textStyles: SerializedTextStyle[] = styles.map((s) => {
    const bound: SerializedTextStyle['boundVariables'] = {};
    const raw = (s.boundVariables ?? {}) as Record<string, { id: string }>;
    for (const prop of TYPO_PROPS) {
      if (raw[prop]?.id) bound[prop] = raw[prop].id;
    }
    const lh = s.lineHeight as { unit: 'PIXELS' | 'PERCENT' | 'AUTO'; value?: number };
    const ls = s.letterSpacing as { unit: 'PIXELS' | 'PERCENT'; value: number };
    return {
      name: s.name,
      boundVariables: bound,
      values: {
        fontFamily: s.fontName.family,
        fontStyle: s.fontName.style,
        fontSize: s.fontSize as number,
        lineHeight: lh.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: lh.unit, value: lh.value },
        letterSpacing: { unit: ls.unit, value: ls.value },
        textDecoration: s.textDecoration as SerializedTextStyle['values']['textDecoration'],
      },
    };
  });

  const effectStylesRaw = await figma.getLocalEffectStylesAsync();
  const paintStyles = await figma.getLocalPaintStylesAsync();
  const gridStyles = await figma.getLocalGridStylesAsync();
  const skippedEffects: Record<string, number> = {};

  const effectStyles: SerializedEffectStyle[] = effectStylesRaw.map((s) => {
    const shadows: SerializedShadowLayer[] = [];
    const otherEffects: string[] = [];
    for (const e of s.effects) {
      if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
        const raw = ((e as { boundVariables?: unknown }).boundVariables ?? {}) as Record<string, { id: string }>;
        const bound: SerializedShadowLayer['boundVariables'] = {};
        for (const prop of SHADOW_PROPS) if (raw[prop]?.id) bound[prop] = raw[prop].id;
        shadows.push({
          inset: e.type === 'INNER_SHADOW',
          visible: e.visible,
          color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a },
          offsetX: e.offset.x,
          offsetY: e.offset.y,
          blur: e.radius,
          spread: e.spread ?? 0,
          boundVariables: bound,
        });
      } else {
        otherEffects.push(e.type);
        skippedEffects[e.type] = (skippedEffects[e.type] ?? 0) + 1;
      }
    }
    return { name: s.name, shadows, otherEffects };
  });

  return {
    collections,
    variables,
    textStyles,
    effectStyles,
    skipped: { paintStyles: paintStyles.length, gridStyles: gridStyles.length, effects: skippedEffects },
  };
}
