import { pushTokens } from './push';

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const setStatus = (s: string): void => {
  (document.getElementById('status') as HTMLElement).textContent = s;
};
const post = (type: string, extra: Record<string, unknown> = {}) =>
  parent.postMessage({ pluginMessage: { type, ...extra } }, '*');

// branch/path 는 project 에서 파생하므로 저장 대상이 아니다.
// pat 은 편의상 저장하지만 clientStorage 평문 — 공유 PC 주의.
const SETTING_IDS = ['owner', 'repo', 'project', 'author', 'pat'] as const;
// 최근 입력값을 자동완성으로 보여줄 필드 — PAT는 비밀번호라 제외.
const HISTORY_IDS = ['owner', 'repo', 'project', 'author'] as const;
const HISTORY_MAX = 5;
// 필드별 최근 입력값(최신순·중복 제거·최대 5개). settings 안에 함께 저장된다.
let history: Record<string, string[]> = { owner: [], repo: [], project: [], author: [] };
// export 결과를 어디로 보낼지 — 다운로드(Export 버튼) vs 푸시(Push 버튼).
let pendingIntent: 'download' | 'push' | 'raw' = 'download';

// 현재 입력값을 해당 필드 히스토리 맨 앞에 넣는다(중복 제거·상한 적용).
function pushHistory(id: string, value: string): void {
  const v = value.trim();
  if (!v) return;
  history[id] = [v, ...(history[id] ?? []).filter((x) => x !== v)].slice(0, HISTORY_MAX);
}
// 검색창식 자동완성: 포커스하면 최근값 전체, 타이핑하면 부분일치 필터링.
function attachAutocomplete(id: string, onSelect?: () => void): void {
  const input = $(id);
  const menu = document.getElementById(`${id}-menu`) as HTMLElement;
  let active = -1;
  // 포커스 직후엔 전체 이력, 사용자가 타이핑하면 입력값으로 필터링(검색창식).
  let showAll = false;

  const matches = (): string[] => {
    const all = history[id] ?? [];
    if (showAll) return all;
    const q = input.value.trim().toLowerCase();
    return q ? all.filter((v) => v.toLowerCase().includes(q)) : all;
  };
  const close = (): void => {
    menu.classList.remove('open');
    active = -1;
  };
  const choose = (v: string): void => {
    input.value = v;
    close();
    onSelect?.();
  };
  const render = (): void => {
    const list = matches();
    if (!list.length) return close();
    menu.innerHTML = '';
    list.forEach((v, i) => {
      const el = document.createElement('div');
      el.className = 'ac-item' + (i === active ? ' active' : '');
      el.textContent = v;
      // mousedown: input blur 보다 먼저 실행돼야 선택이 먹는다.
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(v);
      });
      menu.appendChild(el);
    });
    menu.classList.add('open');
  };

  input.addEventListener('focus', () => {
    showAll = true;
    render();
  });
  input.addEventListener('input', () => {
    showAll = false;
    active = -1;
    render();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (!menu.classList.contains('open')) return;
    const list = matches();
    if (e.key === 'ArrowDown') {
      active = Math.min(active + 1, list.length - 1);
      render();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = Math.max(active - 1, 0);
      render();
      e.preventDefault();
    } else if (e.key === 'Enter' && active >= 0) {
      choose(list[active]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      close();
    }
  });
}

// YYYYMMDD (하루 1 브랜치 — 같은 날 재푸시는 같은 브랜치를 재사용·갱신)
function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// Figma 파일 이름 → 프로젝트/branch/path 에 안전한 형태(공백→하이픈, git 금지문자 제거).
function slugifyProject(name: string): string {
  return name.trim().replace(/\s+/g, '-').replace(/[/\\~^:?*[\]]/g, '');
}

// project → branch/path 파생: {project}/tokens.json.
function deriveBranch(project: string): string {
  return project ? `fix/${project}-token-${dateStamp()}` : '';
}
function derivePath(project: string): string {
  return project ? `${project}/tokens.json` : 'tokens.json';
}
// 사용자가 branch/path 를 직접 수정하면 그 값을 유지하고 자동 파생을 멈춘다.
const dirty = { branch: false, path: false };
function refreshDerived(): void {
  const project = $('project').value.trim();
  if (!dirty.branch) $('branch').value = deriveBranch(project);
  if (!dirty.path) $('path').value = derivePath(project);
}

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function saveSettings() {
  for (const id of HISTORY_IDS) pushHistory(id, $(id).value);
  const settings: Record<string, unknown> = { history };
  for (const k of SETTING_IDS) settings[k] = $(k).value;
  post('save-settings', { settings });
}

// 설정 복원
post('load-settings');

// owner/repo/project 최근값 자동완성 (project 선택 시 branch/path 파생 갱신)
attachAutocomplete('owner');
attachAutocomplete('repo');
attachAutocomplete('project', refreshDerived);
attachAutocomplete('author');

// 프로젝트 이름 입력 시 branch/path 자동 채움
$('project').addEventListener('input', refreshDerived);
// 현재 Figma 파일 이름을 프로젝트 이름으로 다시 가져오기 (파일 이동 후 수동 갱신)
document.getElementById('pull-filename')?.addEventListener('click', () => post('get-filename'));
// branch/path 직접 수정 감지 → 이후 자동 파생 중단
$('branch').addEventListener('input', () => {
  dirty.branch = true;
});
$('path').addEventListener('input', () => {
  dirty.path = true;
});

document.getElementById('export')?.addEventListener('click', () => {
  pendingIntent = 'download';
  saveSettings();
  post('export');
});

// 원본(추출 직후 데이터) 내려받기 — 시험용 고정 파일을 피그마 MCP 없이 갱신하는 수단.
document.getElementById('export-raw')?.addEventListener('click', () => {
  pendingIntent = 'raw';
  post('export');
});

// 숨긴 겹 알림 — 피그마에서 꺼 둔 효과·색·격자 겹은 토큰에 넣지 않으므로 개수를 보여 준다.
function skippedNotice(tokens: unknown): string {
  const meta = (tokens as { $extensions?: Record<string, { hiddenLayers?: number }> })?.$extensions?.[
    'com.huray.token-export'
  ];
  return meta?.hiddenLayers ? ` · 숨긴 겹 ${meta.hiddenLayers}개 제외` : '';
}

// Push = 즉석에서 토큰 추출(다운로드 X) → 브랜치 생성 → PUT → PR.
document.getElementById('push')?.addEventListener('click', () => {
  if (!$('project').value.trim()) return setStatus('프로젝트 이름을 입력하세요');
  if (!$('pat').value) return setStatus('GitHub PAT를 입력하세요');
  pendingIntent = 'push';
  setStatus('토큰 추출 중…');
  post('export'); // 결과는 result 핸들러에서 doPush 로 흘러간다(파일 다운로드 없음)
});

// GitHub 흐름은 push.ts(테스트되는 순수 로직)에 있다. 여기선 DOM 값 읽어 넘기고 결과만 표시.
async function doPush(tokens: unknown): Promise<void> {
  refreshDerived(); // 푸시 시점 시각으로 branch 타임스탬프 갱신
  saveSettings();
  const res = await pushTokens(
    {
      owner: $('owner').value,
      repo: $('repo').value,
      project: $('project').value.trim(),
      branch: $('branch').value,
      path: $('path').value,
      pat: $('pat').value,
      tokens,
      author: $('author').value,
    },
    { fetch, onStatus: setStatus },
  );
  setStatus(res.message + skippedNotice(tokens));
  if (res.prUrl) window.open(res.prUrl, '_blank');
}

onmessage = (e: MessageEvent) => {
  const msg = e.data.pluginMessage;
  if (msg?.type === 'settings') {
    for (const k of SETTING_IDS) if (msg.settings[k]) $(k).value = msg.settings[k];
    if (msg.settings.history) history = { owner: [], repo: [], project: [], author: [], ...msg.settings.history };
    // 프로젝트 이름은 열려있는 파일 이름으로 항상 덮어씀.
    if (msg.fileName) $('project').value = slugifyProject(msg.fileName);
    refreshDerived();
  }
  // "파일명 가져오기" 버튼 응답 — 현재 파일 이름으로 프로젝트 갱신.
  if (msg?.type === 'filename' && msg.fileName) {
    $('project').value = slugifyProject(msg.fileName);
    refreshDerived();
  }
  if (msg?.type === 'result') {
    if (pendingIntent === 'raw') {
      download('figma-raw.json', msg.raw);
      setStatus('figma-raw.json 다운로드됨');
    } else if (pendingIntent === 'push') {
      void doPush(msg.tokens);
    } else {
      download('tokens.json', msg.tokens);
      setStatus(`tokens.json 다운로드됨${skippedNotice(msg.tokens)}`);
    }
  }
  // 추출·변환 실패(code.ts에서 전달) — 이미 사람이 읽을 문구로 옴.
  if (msg?.type === 'error') {
    setStatus(msg.message);
  }
};
