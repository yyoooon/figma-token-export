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

## 검증

```bash
npm test
```

출력한 `tokens.json`은 DTCG 포맷이므로, 소비처의 CSS 변환 스크립트(`tokensToCss` 류)가
읽어 `theme.css` 등을 만든다. **정답 기준 = "CSS 변환이 잘 되는가"** (Token Studio JSON과 똑같을 필요 없음).

테스트(`test/acceptance.test.ts`)는 그 위에 얹은 **회귀 가드**다:

- `test/fixtures/figma-raw.json` = Figma에서 1회 Export해 캡처한 raw 데이터. (없으면 skip)
- `test/fixtures/expected-tokens.json` = 검증된 시점의 `transform(figma-raw)` 출력(baseline).
- 테스트는 `transform(figma-raw) === baseline` 으로 **출력이 바뀌지 않았는지**만 본다.

Figma 토큰이 바뀌면 두 fixture를 다시 캡처해 갱신한다.

## 범위 밖 (YAGNI)

JSON→Figma 역방향, `$themes` 관리 UI.
