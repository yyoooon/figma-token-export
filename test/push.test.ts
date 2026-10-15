import { describe, it, expect } from 'vitest';
import { pushTokens } from '../src/push';
import { AUTHOR_EMAIL } from '../src/github';

// ── 가짜 GitHub API (mock fetch) ──
// 실제 서버 대신, "이 엔드포인트엔 이 응답" 을 미리 짜두고 주입한다.

function resp(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const b64 = (s: string) => btoa(s); // ASCII JSON만 인코딩 — push.ts의 decodeB64와 왕복

// URL+메서드 → 논리적 엔드포인트 이름
function classify(url: string, method: string): string {
  if (method === 'GET' && /\/repos\/[^/]+\/[^/]+$/.test(url)) return 'repo';
  if (method === 'GET' && url.includes('/contents/') && url.includes('?ref=')) return 'getFile';
  if (method === 'GET' && url.includes('/git/ref/heads/')) return 'baseRef';
  if (method === 'POST' && url.endsWith('/git/refs')) return 'createBranch';
  if (method === 'PATCH' && url.includes('/git/refs/heads/')) return 'resetBranch';
  if (method === 'PUT' && url.includes('/contents/')) return 'putFile';
  if (method === 'POST' && url.endsWith('/pulls')) return 'createPr';
  if (method === 'GET' && url.includes('/pulls?')) return 'listPr';
  return 'unknown';
}

const TOKENS = { base: { color: { $type: 'color', $value: '#ffffff' } } };

// 정상 흐름 기본 응답 — 기존 파일은 빈 {} 라 TOKENS 와 다르므로 변경으로 잡힌다.
function happy(): Record<string, Response> {
  return {
    repo: resp(200, { default_branch: 'main' }),
    getFile: resp(200, { sha: 'oldsha', content: b64('{}') }),
    baseRef: resp(200, { object: { sha: 'basesha' } }),
    createBranch: resp(201, {}),
    putFile: resp(200, {}),
    createPr: resp(201, { number: 12, html_url: 'https://github.com/o/r/pull/12' }),
  };
}

// 응답 맵(또는 throw)으로 가짜 fetch 생성. calls 로 호출 이력 확인.
function makeFetch(routes: Record<string, Response> | 'throw') {
  const calls: string[] = [];
  const bodies: Record<string, any> = {}; // 엔드포인트별 마지막 요청 본문(JSON)
  const fn = (async (url: unknown, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push(classify(String(url), method));
    if (init.body) bodies[classify(String(url), method)] = JSON.parse(String(init.body));
    if (routes === 'throw') throw new Error('network down');
    const key = classify(String(url), method);
    const r = routes[key];
    if (!r) throw new Error(`no mock for ${method} ${url} (=${key})`);
    return r;
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls, bodies });
}

const cfg = {
  owner: 'o',
  repo: 'r',
  project: 'base',
  branch: 'fix/base-token-20260702',
  path: 'base/tokens.json',
  pat: 'ghp_x',
  tokens: TOKENS,
};

describe('pushTokens — 케이스별 사람이 읽는 결과', () => {
  it('빈 추출이면 네트워크를 안 부르고 안내만 한다', async () => {
    const fetch = makeFetch(happy());
    const res = await pushTokens({ ...cfg, tokens: {} }, { fetch });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('내보낼 변수');
    expect(fetch.calls.length).toBe(0);
  });

  it('PAT가 틀리면(401) PAT 안내를 준다', async () => {
    const fetch = makeFetch({ ...happy(), repo: resp(401) });
    const res = await pushTokens(cfg, { fetch });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('PAT');
  });

  it('저장소 이름이 틀리면(404) 저장소 안내를 준다', async () => {
    const fetch = makeFetch({ ...happy(), repo: resp(404) });
    const res = await pushTokens(cfg, { fetch });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('저장소를 찾지');
  });

  it('변경이 없으면 푸시하지 않고 안내한다', async () => {
    const same = { ...happy(), getFile: resp(200, { sha: 's', content: b64(JSON.stringify(TOKENS)) }) };
    const fetch = makeFetch(same);
    const res = await pushTokens(cfg, { fetch });
    expect(res.message).toContain('변경 없음');
    expect(res.prUrl).toBeUndefined();
    expect(fetch.calls).not.toContain('putFile');
  });

  it('정상 흐름이면 PR을 만들고 URL을 돌려준다', async () => {
    const fetch = makeFetch(happy());
    const res = await pushTokens(cfg, { fetch });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('PR #12');
    expect(res.prUrl).toBe('https://github.com/o/r/pull/12');
  });

  it('브랜치가 이미 있으면(422) 리셋 후 계속 진행한다', async () => {
    const fetch = makeFetch({ ...happy(), createBranch: resp(422), resetBranch: resp(200) });
    const res = await pushTokens(cfg, { fetch });
    expect(res.ok).toBe(true);
    expect(fetch.calls).toContain('resetBranch');
    expect(res.prUrl).toBe('https://github.com/o/r/pull/12');
  });

  it('그 브랜치로 이미 PR이 있으면(422) 기존 PR을 안내한다', async () => {
    const fetch = makeFetch({
      ...happy(),
      createPr: resp(422),
      listPr: resp(200, [{ number: 7, html_url: 'https://github.com/o/r/pull/7' }]),
    });
    const res = await pushTokens(cfg, { fetch });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('기존 PR #7');
    expect(res.prUrl).toBe('https://github.com/o/r/pull/7');
  });

  it('푸시 권한이 없으면(403) 권한 안내를 준다', async () => {
    const fetch = makeFetch({ ...happy(), putFile: resp(403) });
    const res = await pushTokens(cfg, { fetch });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('권한이 없어요');
  });

  it('네트워크가 끊기면 연결 안내를 준다', async () => {
    const fetch = makeFetch('throw');
    const res = await pushTokens(cfg, { fetch });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('인터넷 연결');
  });
});

describe('pushTokens — 작성자 이름(선택)', () => {
  it('이름을 넣으면 커밋 작성자와 PR 본문 맨 위에 남는다', async () => {
    const fetch = makeFetch(happy());
    await pushTokens({ ...cfg, author: '홍길동' }, { fetch });
    expect(fetch.bodies.putFile.author).toEqual({ name: '홍길동', email: AUTHOR_EMAIL });
    expect(fetch.bodies.createPr.body.startsWith('### 👤 작성자: 홍길동\n\n')).toBe(true);
  });

  it('앞뒤 공백은 지운다', async () => {
    const fetch = makeFetch(happy());
    await pushTokens({ ...cfg, author: '  홍길동 ' }, { fetch });
    expect(fetch.bodies.putFile.author.name).toBe('홍길동');
  });

  it('비워 두면 지금처럼 PAT 주인만 남는다(작성자 줄 없음)', async () => {
    for (const author of [undefined, '', '   ']) {
      const fetch = makeFetch(happy());
      await pushTokens({ ...cfg, author }, { fetch });
      expect('author' in fetch.bodies.putFile).toBe(false);
      expect(fetch.bodies.createPr.body).not.toContain('작성자');
    }
  });
});
