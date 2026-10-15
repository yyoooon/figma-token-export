# figma-token-export

Figma 변수·스타일 → `tokens.json` 내보내기 플러그인 (Token Studio export 대체).
변경 후 다시 뽑으면 파일을 통째로 재생성하므로 orphan(옛 이름 잔재)이 남지 않는다.

## 빌드

```bash
nvm use 20
npm install
npm run build   # dist/code.js, dist/ui.html 생성
```

## Figma에 등록

Figma 데스크톱 앱 → Plugins → Development → **Import plugin from manifest** → 이 폴더의 `manifest.json` 선택.
코드를 고치면 `npm run build` 후 플러그인을 다시 실행하면 된다.

디자인 모드와 **Dev Mode 양쪽에서 실행된다** (`editorType: ["figma", "dev"]`).
Dev Mode는 문서 읽기 전용이지만, 이 플러그인은 변수·스타일을 읽기만 하므로 동작에 차이가 없다.
Dev Mode에서는 Inspect 패널 하단 **Plugins** 메뉴에서 실행.

## 사용

토큰이 정의된 Figma 파일을 연 상태에서 플러그인 실행:

- **Export tokens.json** → `tokens.json` 다운로드. (`figma-raw.json`은 아래 디버그 버튼으로 별도 다운로드)
- **Push to GitHub** → 즉석에서 토큰을 추출(다운로드 없음)하고 대상 저장소에 PR을 만든다.
  - `owner`/`repo`에 토큰을 올릴 GitHub 저장소를 입력한다.
  - **프로젝트 이름**을 넣으면 branch·path가 자동 생성된다 (둘 다 직접 수정 가능):
    - path = `{project}/tokens.json`
    - branch = `fix/{project}-token-{YYYYMMDD}` (하루 1 브랜치)
  - 흐름: base를 main 최신에 맞춤(없으면 생성·있으면 force-reset) → path에 PUT → PR 생성.
    - **변경 없으면** 브랜치·PR 안 만들고 종료.
    - 같은 날 재푸시: 같은 브랜치를 main 기준으로 리셋 후 갱신 → **열린 PR이 있으면 그 PR 갱신**, 머지돼서 없으면 새 PR.
    - 커밋·PR 제목: 순수 추가면 `[추가] {project} 토큰 추가`, 수정·삭제가 섞이면 `[수정] {project} 토큰 갱신`
    - PR 본문: 저장소의 이전 `tokens.json`과 비교한 **변경/추가/삭제 목록** 자동 첨부.
  - PAT는 필드 옆 **🔗 PAT 발급받기** 링크에서 발급(`repo` 권한).
  - owner/repo/프로젝트 이름/PAT 모두 `figma.clientStorage`에 로컬 저장돼 다음 실행 때 복원된다.
    (PAT는 평문 저장 — **공유 PC 주의**.)

## 내보내는 형식 (형식 2)

**어떤 피그마든 모든 변수·스타일을 그대로** 내보낸다. 무엇을 CSS 로 쓸지는 각 프로젝트의 변환기가 정한다(이 플러그인은 판단하지 않는다).

| 피그마 | 묶음(최상위 키) | `$type` |
|---|---|---|
| 변수 (모든 컬렉션·**모든 모드**) | `<컬렉션>/<모드>` | color · dimension · number · fontFamily · string |
| 텍스트 스타일 | `Text Styles` | typography (`fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textDecoration`) |
| 이펙트 스타일 — 그림자만 | `Effect Styles` | shadow (`[{ color, offsetX, offsetY, blur, spread, inset }]`) |
| 이펙트 스타일 — 흐림 등 섞임 | `Effect Styles` | effect (`[{ type: dropShadow\|innerShadow\|layerBlur\|backgroundBlur, … }]`) |
| 색 스타일 — 단색 하나 / 그라디언트 하나 / 그 밖 | `Color Styles` | color / gradient (`{ type, transform, stops }` — transform 은 피그마 gradientTransform 그대로) / paint (`[…]`) |
| 레이아웃 가이드 스타일 | `Grid Styles` | grid (`[{ pattern, count, sectionSize, gutterSize, offset, alignment, color }]`) |

- **값**: 변수에 연결된 값 → 별칭 `{A.B.C}`, 연결 안 된 값 → 스타일의 실제 값(단위 포함 `"16px"`·`"-1%"`·`"normal"`, 색 hex).
- **메타** `$extensions["com.huray.token-export"]`
  - 잎: `source`(variable · textStyle · effectStyle · colorStyle · gridStyle), 변수면 `scopes`(피그마 용도 그대로)·`hiddenFromPublishing`
  - 루트: `formatVersion: 2`, `counts`(종류별 개수), `hiddenLayers`(피그마에서 숨겨 둬 뺀 겹 수)
- **멈추는 경우는 하나**: 같은 묶음 안에 같은 경로가 두 번 → 하나가 다른 하나를 덮어쓰지 않도록 이유와 함께 멈춘다.

## 검증

```bash
npm test
```

`test/acceptance.test.ts` = 실제 피그마 파일 두 개(Huray DS v0.2·v0.3)로 만든 합격 시험.

- `test/fixtures/v0.x.figma-raw.json` — 추출 원본(`extractFigma()` 결과). 받던 버튼은 v0.2·v0.3 저장 후 뺐다
- `test/fixtures/v0.x.tokens.json` — 그 원본의 출력 고정본
- `test/fixtures/hub-v0.2.tokens.json` — 허브의 v0.2 (형식 1) — 변수·타이포가 같은지 대조

피그마가 바뀌어 원본을 다시 받아야 하면, 뺀 버튼을 git 기록에서 잠시 되살려 받고 고정본을 갱신한다.

## 범위 밖 (YAGNI)

JSON→Figma 역방향, `$themes` 관리 UI.
