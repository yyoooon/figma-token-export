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

// 타이포 텍스트 스타일. 각 속성은 바인딩된 변수 id(있으면) — transform이 ref로 복원.
export interface SerializedTextStyle {
  name: string; // 'Display/lg-bold'
  boundVariables: Partial<
    Record<
      'fontFamily' | 'fontWeight' | 'fontSize' | 'lineHeight' | 'letterSpacing',
      string // 변수 id
    >
  >;
}

// 그림자(이펙트)는 'Effect' 변수 컬렉션의 변수로 들어오므로 별도 타입이 필요 없다.

export interface SerializedFigma {
  collections: SerializedCollection[];
  variables: SerializedVariable[];
  textStyles: SerializedTextStyle[];
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
