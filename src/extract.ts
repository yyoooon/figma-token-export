import type {
  SerializedFigma,
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
    return { name: s.name, boundVariables: bound };
  });

  return { collections, variables, textStyles };
}
