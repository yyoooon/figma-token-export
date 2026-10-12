import type {
  SerializedCollection,
  SerializedFigma,
  SerializedPaint,
  SerializedTextStyle,
  SerializedValue,
  SerializedVariable,
  TokenLeaf,
  TokenTree,
  TokensJson,
} from './types';

// ── 헬퍼 (Task 3) ──

export function figmaNameToPath(name: string): string[] {
  return name.split('/');
}

function channel(v: number): string {
  // 0–1 float → 2자리 소문자 hex.
  return Math.round(v * 255)
    .toString(16)
    .padStart(2, '0');
}

export function rgbaToHex(c: { r: number; g: number; b: number; a: number }): string {
  const hex = `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
  return c.a >= 1 ? hex : `${hex}${channel(c.a)}`;
}

export function varNameToRef(name: string): string {
  return `{${name.split('/').join('.')}}`;
}

// ── 변수 → 세트 트리 (Task 4) ──

// 변수 id → 변수명 (별칭 복원용)
export function nameById(figma: SerializedFigma): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of figma.variables) m.set(v.id, v.name);
  return m;
}

// scope로 DTCG $type 판정. scopes는 출력엔 안 넣고 판정에만 쓴다.
const NUMBER_SCOPES = new Set(['OPACITY', 'FONT_WEIGHT']);

export function dtcgTypeOf(
  v: SerializedVariable,
): 'color' | 'dimension' | 'number' | 'fontFamily' | 'string' {
  switch (v.resolvedType) {
    case 'COLOR':
      return 'color';
    case 'FLOAT':
      return v.scopes.some((s) => NUMBER_SCOPES.has(s)) ? 'number' : 'dimension';
    case 'STRING':
      return v.scopes.includes('FONT_FAMILY') ? 'fontFamily' : 'string';
    case 'BOOLEAN':
      return 'string';
  }
}

// 변수 id → 변수 (별칭 타입 해석용)
export function varsById(figma: SerializedFigma): Map<string, SerializedVariable> {
  const m = new Map<string, SerializedVariable>();
  for (const v of figma.variables) m.set(v.id, v);
  return m;
}

function missingTargetError(v: SerializedVariable): Error {
  return new Error(
    `'${v.name}' 변수가 지금 없는 다른 변수를 가리키고 있어요. 연결된 변수가 삭제됐거나 다른 라이브러리에 있는지 확인해 주세요.`,
  );
}

// 별칭을 끝까지 따라가 실제 값을 얻는다(묶음 색 풀이용).
// 대상 컬렉션에 같은 모드가 없으면 그 컬렉션의 첫(기본) 모드 값을 쓴다.
function resolveAlias(
  v: SerializedVariable,
  value: SerializedValue,
  modeId: string,
  vars: Map<string, SerializedVariable>,
  collById: Map<string, SerializedCollection>,
): SerializedValue {
  let cur = value;
  let mode = modeId;
  while (cur.kind === 'ALIAS') {
    const target = vars.get(cur.id);
    if (!target) throw missingTargetError(v);
    const modes = collById.get(target.collectionId)?.modes ?? [];
    if (!modes.some((m) => m.modeId === mode)) mode = modes[0]?.modeId;
    cur = target.valuesByMode[mode];
    if (!cur) throw missingTargetError(v);
  }
  return cur;
}

function leafFor(
  v: SerializedVariable,
  value: SerializedValue,
  vars: Map<string, SerializedVariable>,
  resolve: (value: SerializedValue) => SerializedValue,
): TokenLeaf {
  switch (value.kind) {
    case 'COMPOSED_COLOR': {
      // 실제 색 × 투명도(퍼센트) → #rrggbbaa. 예: 검정 · 30% → #0000004d
      const color = resolve(value.color);
      const opacity = resolve(value.opacity);
      if (color.kind !== 'COLOR' || opacity.kind !== 'FLOAT')
        throw new Error(`'${v.name}' 변수의 색 또는 투명도를 해석하지 못했어요.`);
      return { $type: 'color', $value: rgbaToHex({ ...color, a: color.a * (opacity.value / 100) }) };
    }
    case 'COLOR':
      return { $type: 'color', $value: rgbaToHex(value) };
    case 'ALIAS': {
      const target = vars.get(value.id);
      if (!target) throw missingTargetError(v);
      return { $type: dtcgTypeOf(target), $value: varNameToRef(target.name) };
    }
    case 'FLOAT':
      return dtcgTypeOf(v) === 'dimension'
        ? { $type: 'dimension', $value: `${value.value}px` }
        : { $type: 'number', $value: value.value };
    case 'STRING':
      return { $type: dtcgTypeOf(v), $value: value.value };
    case 'BOOLEAN':
      return { $type: 'string', $value: String(value.value) };
  }
}

// 겹치면 멈춘다 — 조용히 덮어쓰면 v0.3 처럼 33개가 14개로 줄어도 아무도 모른다.
export function insertLeaf(tree: TokenTree, path: string[], leaf: TokenLeaf, label: string): void {
  let node = tree;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = node[key];
    if (next && '$value' in next)
      throw new Error(`'${label}' 경로 '${path.slice(0, i + 1).join('/')}'에 이미 토큰이 있어요. 이름이 겹치지 않게 바꿔 주세요.`);
    if (!next) node[key] = {};
    node = node[key] as TokenTree;
  }
  const last = path[path.length - 1];
  if (last in node) throw new Error(`'${label}' 경로 '${path.join('/')}'가 다른 토큰과 겹쳐요. 이름이 겹치지 않게 바꿔 주세요.`);
  node[last] = leaf;
}

export function buildVariableSets(figma: SerializedFigma): Record<string, TokenTree> {
  const vars = varsById(figma);
  const collById = new Map(figma.collections.map((c) => [c.id, c]));
  const sets: Record<string, TokenTree> = {};

  for (const v of figma.variables) {
    const coll = collById.get(v.collectionId);
    if (!coll) continue;
    for (const mode of coll.modes) {
      const setName = `${coll.name}/${mode.name}`;
      const value = v.valuesByMode[mode.modeId];
      if (value == null) continue;
      sets[setName] = sets[setName] ?? {};
      const resolve = (x: SerializedValue) => resolveAlias(v, x, mode.modeId, vars, collById);
      const leaf = leafFor(v, value, vars, resolve);
      const meta = { source: 'variable', scopes: v.scopes, ...(v.hiddenFromPublishing ? { hiddenFromPublishing: true } : {}) };
      insertLeaf(sets[setName], figmaNameToPath(v.name), { ...leaf, $extensions: { [META]: meta } }, v.name);
    }
  }
  return sets;
}

// ── 합성 타이포 ──

const META = 'com.huray.token-export';

// 피그마 글꼴 스타일 이름 → CSS 굵기. 굵기가 변수에 연결 안 된 스타일에서만 쓴다.
const WEIGHT_BY_STYLE: Record<string, number> = {
  Thin: 100,
  ExtraLight: 200,
  'Extra Light': 200,
  Light: 300,
  Regular: 400,
  Medium: 500,
  SemiBold: 600,
  'Semi Bold': 600,
  Bold: 700,
  ExtraBold: 800,
  'Extra Bold': 800,
  Black: 900,
};

const round = (n: number) => Number(n.toFixed(4));

const DECORATION: Record<string, string> = { NONE: 'none', UNDERLINE: 'underline', STRIKETHROUGH: 'line-through' };

type TypoProp = 'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing';
const TYPO_PROPS: TypoProp[] = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'];

// 변수에 연결 안 된 속성 → 스타일의 실제 값(단위 포함 문자열).
function literalOf(prop: TypoProp, style: SerializedTextStyle): string {
  const v = style.values;
  switch (prop) {
    case 'fontFamily':
      return v.fontFamily;
    case 'fontSize':
      return `${round(v.fontSize)}px`;
    case 'fontWeight': {
      // 표준 이름이면 숫자, 모르는 이름이면 그대로 — 판단은 프로젝트 변환기 몫.
      const w = WEIGHT_BY_STYLE[v.fontStyle];
      return w == null ? v.fontStyle : String(w);
    }
    case 'lineHeight':
      if (v.lineHeight.unit === 'AUTO') return 'normal';
      return `${round(v.lineHeight.value ?? 0)}${v.lineHeight.unit === 'PIXELS' ? 'px' : '%'}`;
    case 'letterSpacing':
      return `${round(v.letterSpacing.value)}${v.letterSpacing.unit === 'PIXELS' ? 'px' : '%'}`;
  }
}

export function typographyValue(style: SerializedTextStyle, names: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const prop of TYPO_PROPS) {
    const id = style.boundVariables[prop];
    if (id) {
      const target = names.get(id);
      if (!target)
        throw new Error(`'${style.name}' 텍스트 스타일이 지금 없는 변수를 사용하고 있어요. 연결된 변수를 확인해 주세요.`);
      out[prop] = varNameToRef(target);
    } else {
      out[prop] = literalOf(prop, style);
    }
  }
  out.textDecoration = DECORATION[style.values.textDecoration] ?? 'none';
  return out;
}

// 스타일 하나 = 토큰 하나. 이름 전체가 경로다(Body/M/Bold). 트리에 넣는 건 호출자가 한다(겹침 검사).
export function buildTypographyTokens(figma: SerializedFigma): { path: string[]; leaf: TokenLeaf }[] {
  const names = nameById(figma);
  return figma.textStyles.map((style) => ({
    path: figmaNameToPath(style.name),
    leaf: { $type: 'typography', $value: typographyValue(style, names), $extensions: { [META]: { source: 'textStyle' } } },
  }));
}

// ── 이펙트·색·격자 스타일 ──
// 스타일은 여러 값이 한 세트라 피그마 변수 하나에 못 담는다 → 스타일이 정본.
// 내보내기는 판단하지 않는다: 보이는 겹은 전부, 처음 보는 종류는 이름만이라도 싣는다.

type StyleToken = { path: string[]; leaf: TokenLeaf };
type Built = { tokens: StyleToken[]; hidden: number };

function refOf(names: Map<string, string>, kind: string, style: string, id: string): string {
  const target = names.get(id);
  if (!target) throw new Error(`'${style}' ${kind}이 지금 없는 변수를 사용하고 있어요. 연결된 변수를 확인해 주세요.`);
  return varNameToRef(target);
}

const SHADOW_FIELDS = [
  ['offsetX', 'offsetX'],
  ['offsetY', 'offsetY'],
  ['blur', 'radius'],
  ['spread', 'spread'],
] as const; // [출력 필드, 피그마 boundVariables 키]

const BLUR_TYPE: Record<string, string> = { LAYER_BLUR: 'layerBlur', BACKGROUND_BLUR: 'backgroundBlur' };

export function buildEffectTokens(figma: SerializedFigma): Built {
  const names = nameById(figma);
  const tokens: StyleToken[] = [];
  let hidden = 0;
  for (const style of figma.effectStyles) {
    const ref = (id: string) => refOf(names, '이펙트 스타일', style.name, id);
    const shadows = style.shadows.filter((l) => l.visible);
    const blurs = style.blurs.filter((b) => b.visible);
    hidden += style.shadows.length - shadows.length + style.blurs.length - blurs.length;
    const shadowValue = shadows.map((l) => {
      const layer: Record<string, string | boolean> = {
        color: l.boundVariables.color ? ref(l.boundVariables.color) : rgbaToHex(l.color),
      };
      for (const [field, key] of SHADOW_FIELDS) {
        const id = l.boundVariables[key];
        layer[field] = id ? ref(id) : `${round(l[field])}px`;
      }
      layer.inset = l.inset;
      return layer;
    });
    const meta = { [META]: { source: 'effectStyle' } };
    if (!shadows.length && !blurs.length && !style.others.length) continue;
    if (!blurs.length && !style.others.length) {
      tokens.push({ path: figmaNameToPath(style.name), leaf: { $type: 'shadow', $value: shadowValue, $extensions: meta } });
      continue;
    }
    // 그림자 외 효과가 섞이면 효과 목록 그대로.
    const $value = [
      ...shadowValue.map(({ inset, ...rest }) => ({ type: inset ? 'innerShadow' : 'dropShadow', ...rest })),
      ...blurs.map((b) => ({ type: BLUR_TYPE[b.type], radius: b.boundRadius ? ref(b.boundRadius) : `${round(b.radius)}px` })),
      ...style.others.map((type) => ({ type })),
    ];
    tokens.push({ path: figmaNameToPath(style.name), leaf: { $type: 'effect', $value, $extensions: meta } });
  }
  return { tokens, hidden };
}

function gradientValue(
  g: Extract<SerializedPaint, { kind: 'GRADIENT' }>,
  ref: (id: string) => string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { type: g.gradientType.toLowerCase() };
  if (g.gradientType === 'LINEAR') {
    out.angle = round((Math.atan2(g.transform[0][1], g.transform[0][0]) * 180) / Math.PI);
  }
  out.stops = g.stops.map((st) => ({ color: st.boundColor ? ref(st.boundColor) : rgbaToHex(st.color), position: round(st.position) }));
  if (g.opacity < 1) out.opacity = round(g.opacity);
  return out;
}

export function buildPaintTokens(figma: SerializedFigma): Built {
  const names = nameById(figma);
  const tokens: StyleToken[] = [];
  let hidden = 0;
  for (const style of figma.paintStyles) {
    const ref = (id: string) => refOf(names, '색 스타일', style.name, id);
    const paints = style.paints.filter((p) => p.visible);
    hidden += style.paints.length - paints.length;
    if (!paints.length) continue;
    const meta = { [META]: { source: 'colorStyle' } };
    const solid = (p: Extract<SerializedPaint, { kind: 'SOLID' }>) =>
      p.boundColor && p.opacity >= 1 ? ref(p.boundColor) : rgbaToHex({ ...p.color, a: p.opacity });
    let leaf: TokenLeaf;
    if (paints.length === 1 && paints[0].kind === 'SOLID') {
      leaf = { $type: 'color', $value: solid(paints[0]), $extensions: meta };
    } else if (paints.length === 1 && paints[0].kind === 'GRADIENT') {
      leaf = { $type: 'gradient', $value: gradientValue(paints[0], ref), $extensions: meta };
    } else {
      const $value = paints.map((p) => {
        if (p.kind === 'SOLID') return { type: 'solid', color: solid(p) };
        if (p.kind === 'GRADIENT') return { type: 'gradient', ...gradientValue(p, ref) };
        if (p.kind === 'IMAGE') return { type: 'image', imageHash: p.imageHash, scaleMode: p.scaleMode };
        return { type: p.type };
      });
      leaf = { $type: 'paint', $value, $extensions: meta };
    }
    tokens.push({ path: figmaNameToPath(style.name), leaf });
  }
  return { tokens, hidden };
}

export function buildGridTokens(figma: SerializedFigma): Built {
  const tokens: StyleToken[] = [];
  let hidden = 0;
  for (const style of figma.gridStyles) {
    const grids = style.grids.filter((g) => g.visible !== false);
    hidden += style.grids.length - grids.length;
    if (!grids.length) continue;
    const $value = grids.map(({ visible: _v, color, ...rest }) => ({
      ...rest,
      ...(color ? { color: rgbaToHex(color as { r: number; g: number; b: number; a: number }) } : {}),
    }));
    tokens.push({ path: figmaNameToPath(style.name), leaf: { $type: 'grid', $value, $extensions: { [META]: { source: 'gridStyle' } } } });
  }
  return { tokens, hidden };
}

// ── 전체 조립 ──

// 스타일 묶음 이름 — '/' 가 없어 '<컬렉션>/<모드>' 로 오해되지 않는다.
const STYLE_SETS = { text: 'Text Styles', effect: 'Effect Styles', paint: 'Color Styles', grid: 'Grid Styles' };

export function transform(figma: SerializedFigma): TokensJson {
  const sets = buildVariableSets(figma);

  const put = (setName: string, list: StyleToken[]) => {
    for (const t of list) {
      sets[setName] = sets[setName] ?? {};
      insertLeaf(sets[setName], t.path, t.leaf, t.path.join('/'));
    }
  };
  put(STYLE_SETS.text, buildTypographyTokens(figma));
  const effects = buildEffectTokens(figma);
  const paints = buildPaintTokens(figma);
  const grids = buildGridTokens(figma);
  put(STYLE_SETS.effect, effects.tokens);
  put(STYLE_SETS.paint, paints.tokens);
  put(STYLE_SETS.grid, grids.tokens);

  const counts: Record<string, number> = {};
  const count = (node: TokenTree) => {
    for (const val of Object.values(node)) {
      if ('$value' in val) {
        const type = (val as TokenLeaf).$type;
        counts[type] = (counts[type] ?? 0) + 1;
      } else count(val as TokenTree);
    }
  };
  for (const tree of Object.values(sets)) count(tree);

  const hiddenLayers = effects.hidden + paints.hidden + grids.hidden;
  return { $extensions: { [META]: { formatVersion: 2, counts, hiddenLayers } }, ...sets };
}
