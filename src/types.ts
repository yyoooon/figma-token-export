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

export interface SerializedBlur {
  type: 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  visible: boolean;
  radius: number;
  boundRadius?: string; // 변수 id
}

// 이펙트 스타일 — 그림자·흐림을 나눠 담고, 처음 보는 효과는 종류 이름만 남긴다(전부 내보낸다).
export interface SerializedEffectStyle {
  name: string; // 'Elevation/Xsmall'
  shadows: SerializedShadowLayer[];
  blurs: SerializedBlur[];
  others: string[]; // ['NOISE']
}

type RGB = { r: number; g: number; b: number };
type RGBA = RGB & { a: number };

export type SerializedPaint =
  | { kind: 'SOLID'; visible: boolean; color: RGB; opacity: number; boundColor?: string }
  | {
      kind: 'GRADIENT';
      gradientType: 'LINEAR' | 'RADIAL' | 'ANGULAR' | 'DIAMOND';
      visible: boolean;
      opacity: number;
      stops: { color: RGBA; position: number; boundColor?: string }[];
      transform: number[][];
    }
  | { kind: 'IMAGE'; visible: boolean; imageHash: string | null; scaleMode: string }
  | { kind: 'OTHER'; visible: boolean; type: string };

// 색(페인트) 스타일 — 단색·그라디언트·이미지 모두.
export interface SerializedPaintStyle {
  name: string;
  paints: SerializedPaint[];
}

// 레이아웃 가이드(격자) 스타일 — 피그마 값 그대로.
export interface SerializedGridStyle {
  name: string;
  grids: Record<string, unknown>[];
}

export interface SerializedFigma {
  collections: SerializedCollection[];
  variables: SerializedVariable[];
  textStyles: SerializedTextStyle[];
  effectStyles: SerializedEffectStyle[];
  paintStyles: SerializedPaintStyle[];
  gridStyles: SerializedGridStyle[];
}

// ── 출력(tokens.json) 쪽 ──
// $type/$value만 남긴 깔끔한 형태. Token Studio 메타($extensions/$themes/$metadata)는 안 붙인다.
export type TokenLeaf = {
  $type: string;
  $value: unknown;
  $extensions?: Record<string, unknown>;
};
export interface TokenTree {
  [key: string]: TokenTree | TokenLeaf;
}
export interface TokensJson {
  $extensions?: Record<string, unknown>;
  [setName: string]: TokenTree | Record<string, unknown> | undefined;
}
