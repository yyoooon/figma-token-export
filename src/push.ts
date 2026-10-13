import { buildPutBody, contentsUrl } from './github';
import { diffTokens, formatPrBody, type TokenDiff } from './diff';

// GitHub 푸시 오케스트레이션 — DOM/window 를 모른다(fetch 주입, 결과는 return).
// UI(ui.ts)는 값 읽어 넘기고 결과 메시지만 화면에 표시한다. → 가짜 fetch 로 전 케이스 테스트 가능.

export interface PushConfig {
  owner: string;
  repo: string;
  project: string;
  branch: string;
  path: string;
  pat: string;
  tokens: unknown;
}

export interface PushResult {
  ok: boolean; // 오류 없이 끝났는가 (성공 푸시 · 변경 없음 = true, 오류 = false)
  message: string; // 사용자에게 보여줄 안내 (이미 사람이 읽는 문구)
  prUrl?: string; // 있으면 UI가 브라우저로 연다
}

export interface PushDeps {
  fetch: typeof fetch;
  onStatus?: (s: string) => void; // 진행 상황(선택) — 테스트에선 생략
}

// diff 성격에 따라 커밋·PR 제목 구분: 순수 추가면 [추가], 수정·삭제가 섞이면 [수정].
export function commitTitle(project: string, diff: TokenDiff): string {
  const onlyAdded = diff.added.length > 0 && diff.changed.length === 0 && diff.removed.length === 0;
  return onlyAdded ? `[추가] ${project} 토큰 추가` : `[수정] ${project} 토큰 갱신`;
}

// GitHub 응답 상태코드 → 비개발자도 이해할 안내 문구.
export function githubError(status: number): string {
  if (status === 401)
    return 'GitHub 로그인 정보(PAT)가 만료됐거나 틀렸어요. GitHub에서 새 토큰을 만들어 다시 넣어 주세요.';
  if (status === 403)
    return '권한이 없어요. 이 토큰으로는 이 저장소에 올릴 수 없거나, 잠깐 요청이 너무 많았어요. 잠시 후 다시 시도해 주세요.';
  if (status === 404) return '저장소를 찾지 못했어요. Owner와 Repository 이름이 맞는지 확인해 주세요.';
  return `GitHub 요청이 실패했어요. (오류 코드 ${status}) 잠시 후 다시 시도해 주세요.`;
}

// GitHub Contents API content(개행 섞인 base64, UTF-8) → 문자열
function decodeB64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export async function pushTokens(cfg: PushConfig, deps: PushDeps): Promise<PushResult> {
  const { fetch, onStatus = () => {} } = deps;
  const { owner, repo, project, branch, path, pat, tokens } = cfg;

  // 추출 결과가 비면(로컬 변수·스타일 없음) 중단 — 안 막으면 허브 토큰을 지우는 PR이 생긴다.
  if (!tokens || typeof tokens !== 'object' || Object.keys(tokens).length === 0) {
    return {
      ok: false,
      message:
        '내보낼 변수나 텍스트 스타일이 없어요. 이 파일에 직접 만든 변수가 있는지 확인해 주세요. (다른 라이브러리에서 불러온 변수는 여기서 내보낼 수 없어요.)',
    };
  }

  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const url = contentsUrl(owner, repo, path);
  const headers = { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' };

  try {
    onStatus('기본 브랜치 확인 중…');
    const repoRes = await fetch(api, { headers });
    if (!repoRes.ok) return { ok: false, message: githubError(repoRes.status) };
    const base = (await repoRes.json()).default_branch;

    // base 의 기존 파일 → sha(덮어쓰기용) + 이전 내용(변경 비교용)
    onStatus('변경 비교 중…');
    const fileRes = await fetch(`${url}?ref=${base}`, { headers });
    let sha: string | undefined;
    let oldJson: Record<string, unknown> = {};
    if (fileRes.ok) {
      const f = await fileRes.json();
      sha = f.sha;
      try {
        oldJson = JSON.parse(decodeB64(f.content));
      } catch {
        oldJson = {};
      }
    }

    // 변경이 없으면 브랜치·PR 만들지 않고 일찍 종료 (빈 브랜치/빈 PR 방지)
    const diff = diffTokens(oldJson, tokens as Record<string, unknown>);
    if (!diff.added.length && !diff.changed.length && !diff.removed.length && !diff.metaChanged) {
      return { ok: true, message: '변경 없음 — 푸시하지 않음 (허브와 동일)' };
    }
    const message = commitTitle(project, diff); // 커밋·PR 제목 (추가/갱신 구분)
    const prBody = formatPrBody(diff, project);

    // 브랜치를 base 최신 커밋에 맞춘다.
    // - 없으면 생성, 있으면 force-reset(머지/방치된 옛 브랜치도 깨끗하게 다시 시작).
    const baseRef = await fetch(`${api}/git/ref/heads/${base}`, { headers });
    const baseSha = (await baseRef.json()).object.sha;
    const mkRef = await fetch(`${api}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
    if (mkRef.status === 422) {
      const reset = await fetch(`${api}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ sha: baseSha, force: true }),
      });
      if (!reset.ok) return { ok: false, message: githubError(reset.status) };
    } else if (!mkRef.ok) {
      return { ok: false, message: githubError(mkRef.status) };
    }

    onStatus('푸시 중…');
    const put = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(buildPutBody({ json: tokens, message, branch, sha })),
    });
    if (!put.ok) return { ok: false, message: githubError(put.status) };

    onStatus('PR 생성 중…');
    const prRes = await fetch(`${api}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: message, head: branch, base, body: prBody }),
    });
    if (prRes.ok) {
      const pr = await prRes.json();
      return {
        ok: true,
        message: `PR #${pr.number} 생성 완료 ✓ (브라우저에서 열림)`,
        prUrl: pr.html_url,
      };
    }
    // 422 = 그 브랜치로 이미 열린 PR 존재 → 방금 푸시로 그 PR이 갱신됨. 찾아서 안내.
    if (prRes.status === 422) {
      const list = await fetch(`${api}/pulls?head=${owner}:${branch}&state=open`, { headers });
      const open = list.ok ? await list.json() : [];
      if (open.length) {
        return {
          ok: true,
          message: `기존 PR #${open[0].number} 업데이트됨 ✓ (브라우저에서 열림)`,
          prUrl: open[0].html_url,
        };
      }
    }
    return {
      ok: false,
      message: `토큰은 올렸는데 변경 요청(PR) 만들기에 실패했어요. (오류 코드 ${prRes.status}) GitHub에서 직접 PR을 열어 주세요.`,
    };
  } catch (err) {
    console.error(err); // 원인은 콘솔에만 — 사용자에겐 쉬운 안내
    return { ok: false, message: '인터넷 연결에 문제가 있는 것 같아요. 연결을 확인하고 다시 시도해 주세요.' };
  }
}
