export function contentsUrl(owner: string, repo: string, path: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}

// btoa는 UTF-8 직접 처리 못 함 → encodeURIComponent 경유로 안전 인코딩.
function toBase64(str: string): string {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    ),
  );
}

// 커밋 작성자로 쓸 고정 주소. 비개발자는 GitHub 계정이 없어 이름만 받는다.
// GitHub 계정의 이메일과 겹치면 그 사람으로 연결되므로 아무 계정과도 안 묶일 회사 noreply 주소를 쓴다.
export const AUTHOR_EMAIL = 'design-token-export@noreply.huray.net';

type PutBody = {
  message: string;
  content: string;
  branch: string;
  sha?: string;
  author?: { name: string; email: string };
};

// author: 실제 작업자 이름(선택). 주면 커밋 작성자가 그 이름, 올린 사람(committer)은 PAT 주인 그대로.
export function buildPutBody(opts: {
  json: unknown;
  message: string;
  branch: string;
  sha?: string;
  author?: string;
}): PutBody {
  const content = toBase64(JSON.stringify(opts.json, null, 2));
  const body: PutBody = {
    message: opts.message,
    content,
    branch: opts.branch,
  };
  if (opts.sha) body.sha = opts.sha;
  if (opts.author) body.author = { name: opts.author, email: AUTHOR_EMAIL };
  return body;
}
