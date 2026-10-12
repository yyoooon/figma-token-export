# DTCG 토큰 포맷 전환 — 설계

- 날짜: 2026-07-01
- 레포: `figma-token-export` (플러그인)
- 연관: token-sync 스킬(변환·검증 정본), 토큰 저장소(허브)

## 아키텍처 결정 (확정: A안)

**플러그인은 DTCG `tokens.json`만 생성·푸시한다. 변환(CSS/Android/iOS)과 검증은 소비처의 Claude 스킬(web=token-sync)이 담당한다.**

이유(실무 표준 = 관심사 분리):
- 디자인 툴(플러그인) = **export**(플랫폼 중립 토큰). 빌드 도구 = **transform**.
- 변환을 플러그인에 넣으면 web만 특별대우(모바일은 자체 파이프라인) → 비대칭·역할 중복.
- 변환 규칙 수정은 코드 레포(token-sync)에서. 플러그인 재배포 불필요.
- token-sync가 이미 "Style Dictionary 자리"(변환+검증+대화형 수정)를 수행 중.

```
Figma → 플러그인 → tokens.json(DTCG) → 허브(토큰 저장소)
                                          ↓
   web:    "토큰 가져와줘" → token-sync 스킬 [fetch→변환→검증→수정→theme.css 반영→PR]
   mobile: 허브 tokens.json → 자체 파이프라인 → Android/iOS   (범위 밖)
```

## 목표

1. 플러그인이 뽑는 `tokens.json`을 **DTCG 표준**으로 바꿔 **프론트·모바일 공용 원본**으로 쓴다.

## 비목표 (범위 밖)

- 플러그인에서 CSS/Android/iOS 생성·다운로드 — 각 소비처 스킬이 변환.
- theme.css 허브 푸시 — token-sync가 로컬 생성하므로 불필요.
- JSON → Figma 역방향, `$themes` 관리.

## 현재 상태

- 직전 작업으로 `$extensions`/`$themes`/`$metadata`(Token Studio 메타)는 **이미 제거**됨.
- 현재 `$type`가 비표준: 크기가 `number`(단위 없음), 폰트명이 `text`, alias가 무조건 `color`.
- `extract.ts`가 각 변수 `scopes`를 **이미 캡처**(현재 transform은 미사용).

## DTCG 포맷 스펙

### 타입 매핑 (scope 기반 — 출력엔 scope 안 넣음)

| resolvedType | scope | `$type` | `$value` |
|---|---|---|---|
| COLOR | (모두) | `color` | `#rrggbb`/`#rrggbbaa` |
| FLOAT | `OPACITY`, `FONT_WEIGHT` | `number` | 숫자 그대로 |
| FLOAT | 그 외 (`CORNER_RADIUS`·`GAP`·`FONT_SIZE`·`LINE_HEIGHT`·`LETTER_SPACING`·`STROKE_FLOAT`·`EFFECT_FLOAT`·미지) | `dimension` | `"{n}px"` 문자열 |
| STRING | `FONT_FAMILY` | `fontFamily` | 문자열 |
| STRING | 그 외 | `string` | 문자열 |
| BOOLEAN | (모두) | `string` | 문자열화 (현재 fixture 없음) |

### 별칭(alias)

- ref = 대상 **전체 경로**: `"{Color.White Opacity.950}"` (기존 `varNameToRef` 유지).
- alias 리프 `$type` = **대상 변수 타입**으로 해석 (현재 무조건 color → 수정).

### 타이포 (composite)

DTCG `typography` 합성, **표준 5필드만**: `fontFamily`·`fontSize`·`fontWeight`·`lineHeight`·`letterSpacing`.
- Token Studio 합성 필드(`paragraphSpacing`·`paragraphIndent`·`textCase`·`textDecoration`) 제거.
- 밑줄은 이름 접미사(`-underline`)로 소비처가 파생(현행 유지).

### 최종 예시

```json
{
  "Primitive/Light": {
    "Color":  { "Gray": { "50": { "$type": "color", "$value": "#f9fafb" } } },
    "Radius": { "16": { "$type": "dimension", "$value": "16px" } },
    "Opacity":{ "50": { "$type": "number", "$value": 0.5 } },
    "Display":{ "lg-bold": { "$type": "typography", "$value": { /* 표준 5필드 */ } } }
  },
  "Scheme/Light": {
    "Text": { "White": { "Rest": { "$type": "color", "$value": "{Color.White Opacity.950}" } } }
  }
}
```

## 컴포넌트 (이번 범위 = 플러그인만)

| 파일 | 변경 |
|---|---|
| `src/extract.ts` | 변경 없음 (scopes 캡처 유지) |
| `src/types.ts` | `TokenLeaf.$type` DTCG 값 문서화 (구조 동일) |
| `src/transform.ts` | scope→DTCG 타입 판정, dimension px 문자열, alias 타입 해석, 타이포 5필드 |
| `test/transform.test.ts` | DTCG 기대값 갱신 |
| `test/fixtures/expected-tokens.json` | DTCG baseline 재생성 |

## 회귀 기준 (불변)

**"theme.css 변환이 잘 되는가"** — DTCG 전환 후에도 token-sync가 만드는 theme.css가 동일해야 한다.
단, token-sync가 DTCG 입력을 읽으려면 아래 후속 작업 필요.

## 후속 작업 (별도 계획 — 이번 범위 밖)

1. **[fe-toolkit] token-sync `transform.mjs` DTCG 대응** — dimension `"16px"` 파싱 등. (플러그인 DTCG 배포 전/직후 협응 필수. 안 하면 web theme.css 깨짐)
2. **[fe-toolkit] token-sync 검증 어휘 확장** — 현재 border-width·shadow 토큰 제거를 못 잡음(`extractTokens`에 추출 규칙 없음). `--border-width-*`·`--shadow-*` 추출 추가.

## 리스크

1. **협응 타이밍** — 플러그인이 DTCG로 푸시하는데 token-sync가 아직 옛 포맷만 읽으면 web 빌드 깨짐 → 후속 1을 같이 배포.
2. **플랫폼 간 일관성** — web·mobile이 각자 변환 → 이 DTCG 스펙 문서를 공유 기준으로, 각 변환기를 같은 입력으로 테스트.
