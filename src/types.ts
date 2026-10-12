// Figma 변수의 모드별 값. ALIAS는 다른 변수를 가리킨다(id).
export type SerializedValue =
  | { kind: 'COLOR'; r: number; g: number; b: number; a: number } // 0–1 float
  | { kind: 'FLOAT'; value: number }
  | { kind: 'STRING'; value: string }
  | { kind: 'BOOLEAN'; value: boolean }
  | { kind: 'ALIAS'; id: string } // 대상 변수 id
  // 묶음 색: 색·투명도 중 하나 이상이 별칭. opacity 는 퍼센트(30 = 30%).
  | { kind: 'COMPOSED_COLOR'; color: SerializedValue; opacity: SerializedValue };

export interface SerializedVariable {
  id: string;
  name: string; // Figma 변수명, '/' 구분. 예: 'Color/White Opacity/950'
  collectionId: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  valuesByMode: Record<string, SerializedValue>; // modeId -> value
  scopes: string[]; // com.figma.scopes 원본. 예: ['TEXT_FILL']
  hiddenFromPublishing: boolean; // com.figma.hiddenFromPublishing
}

export interface SerializedMode {
  modeId: string;
  name: string; // 'Light', 'Mode 1'
}

export interface SerializedCollection {
  id: string;
  name: string; // 'Primitive', 'Semantic', 'Effect', 'Scheme'
  modes: SerializedMode[];
}

export interface SerializedTextStyleValues {
  fontFamily: string;
  fontStyle: string; // 'Bold', 'SemiBold' — 굵기 미연결 시 숫자로 바꿀 근거
  fontSize: number;
  lineHeight: { unit: 'PIXELS' | 'PERCENT' | 'AUTO'; value?: number };
  letterSpacing: { unit: 'PIXELS' | 'PERCENT'; value: number };
  textDecoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
}

// 타이포 텍스트 스타일. 연결된 속성은 변수 id, 모든 속성의 실제 값은 values 에.
// (자간 % 처럼 피그마 변수로 못 만드는 값은 스타일에만 있다 — values 가 그 출처)
export interface SerializedTextStyle {
  name: string; // 'Body/M/Bold'
  boundVariables: Partial<
    Record<
      'fontFamily' | 'fontWeight' | 'fontSize' | 'lineHeight' | 'letterSpacing',
      string // 변수 id
    >
  >;
  values: SerializedTextStyleValues;
}

export interface SerializedShadowLayer {
  inset: boolean;
  visible: boolean;
  color: { r: number; g: number; b: number; a: number };
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  boundVariables: Partial<Record<'color' | 'offsetX' | 'offsetY' | 'radius' | 'spread', string>>;
}

// 이펙트 스타일. 그림자 겹만 토큰이 된다 — 흐림 등 그 밖의 효과는 종류 이름만 남겨 개수를 알린다.
export interface SerializedEffectStyle {
  name: string; // 'Elevation/Xsmall'
  shadows: SerializedShadowLayer[];
  otherEffects: string[]; // ['LAYER_BLUR']
}

export interface SerializedFigma {
  collections: SerializedCollection[];
  variables: SerializedVariable[];
  textStyles: SerializedTextStyle[];
  effectStyles: SerializedEffectStyle[];
  // 내보내지 않는 것 — 조용히 버리지 않고 개수를 알린다.
  skipped: { paintStyles: number; gridStyles: number; effects: Record<string, number> };
}

// ── 출력(tokens.json) 쪽 ──
// $type/$value만 남긴 깔끔한 형태. Token Studio 메타($extensions/$themes/$metadata)는 안 붙인다.
export type TokenLeaf = {
  $type: string;
  $value: unknown;
};
export interface TokenTree {
  [key: string]: TokenTree | TokenLeaf;
}
export interface TokensJson {
  [setName: string]: TokenTree;
}
