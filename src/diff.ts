// tokens.json(세트 트리) 두 개를 비교해 PR 본문용 변경 목록을 만든다.
// 순수 함수 — 네트워크/DOM 의존 없음.

// { "Set/Path/.../Leaf": value } 로 평탄화. $-키(메타)와 비객체는 건너뛴다.
export function flattenTokens(json: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$') || v == null || typeof v !== 'object') continue;
      const path = prefix ? `${prefix}/${k}` : k;
      if ('$value' in (v as Record<string, unknown>)) out[path] = (v as { $value: unknown }).$value;
      else walk(v as Record<string, unknown>, path);
    }
  };
  for (const [setName, tree] of Object.entries(json)) {
    if (setName.startsWith('$') || !tree || typeof tree !== 'object') continue;
    walk(tree as Record<string, unknown>, setName);
  }
  return out;
}

export interface TokenDiff {
  added: { path: string; value: unknown }[];
  removed: { path: string; value: unknown }[];
  changed: { path: string; from: unknown; to: unknown }[];
  // 값은 그대로인데 $type·$extensions(용도·출처·개수표)가 바뀜 — 변환기가 이 메타로 판단하므로 푸시해야 한다.
  metaChanged: boolean;
}

// { "Set/Path": { $type, $extensions } } — 값 외 정보만 모은다(+ 루트 메타).
function flattenMeta(json: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { $root: (json as { $extensions?: unknown }).$extensions ?? null };
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$') || v == null || typeof v !== 'object') continue;
      const path = `${prefix}/${k}`;
      const leaf = v as { $value?: unknown; $type?: unknown; $extensions?: unknown };
      if ('$value' in leaf) out[path] = { $type: leaf.$type, $extensions: leaf.$extensions ?? null };
      else walk(v as Record<string, unknown>, path);
    }
  };
  for (const [setName, tree] of Object.entries(json)) {
    if (setName.startsWith('$') || !tree || typeof tree !== 'object') continue;
    walk(tree as Record<string, unknown>, setName);
  }
  return out;
}

export function diffTokens(
  oldJson: Record<string, unknown>,
  newJson: Record<string, unknown>,
): TokenDiff {
  const a = flattenTokens(oldJson);
  const b = flattenTokens(newJson);
  const eq = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const diff: TokenDiff = {
    added: [],
    removed: [],
    changed: [],
    metaChanged: !eq(flattenMeta(oldJson), flattenMeta(newJson)),
  };
  for (const k of Object.keys(b)) {
    if (!(k in a)) diff.added.push({ path: k, value: b[k] });
    else if (!eq(a[k], b[k])) diff.changed.push({ path: k, from: a[k], to: b[k] });
  }
  for (const k of Object.keys(a)) {
    if (!(k in b)) diff.removed.push({ path: k, value: a[k] });
  }
  return diff;
}

const MAX_ROWS = 80; // 본문에 바로 보이는 미리보기 줄 수
const MAX_DETAILS = 2000; // 접기 안에 넣을 최대 줄 수 (GitHub PR 본문 65536자 제한 대비)

function fmt(v: unknown): string {
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// 추가/삭제 항목: 값이 복합 객체(타이포 등)면 하위 키를 들여쓴 목록으로, 아니면 인라인.
function renderValue(path: string, value: unknown): string {
  if (!isObj(value)) return `- \`${path}\`: \`${fmt(value)}\``;
  const sub = Object.entries(value)
    .map(([k, val]) => `  - ${k}: \`${fmt(val)}\``)
    .join('\n');
  return `- \`${path}\`:\n${sub}`;
}

// 변경 항목: 둘 다 복합 객체면 실제로 달라진 하위 키만, 아니면 from → to.
function renderChange(path: string, from: unknown, to: unknown): string {
  if (!isObj(from) || !isObj(to)) return `- \`${path}\`: \`${fmt(from)}\` → \`${fmt(to)}\``;
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])];
  const sub = keys
    .filter((k) => JSON.stringify(from[k]) !== JSON.stringify(to[k]))
    .map((k) => `  - ${k}: \`${fmt(from[k])}\` → \`${fmt(to[k])}\``)
    .join('\n');
  return `- \`${path}\`:\n${sub}`;
}

// 미리보기(MAX_ROWS)까지는 바로 노출, 나머지는 <details> 접기로 감싼다(GitHub 네이티브 더보기).
function section(title: string, lines: string[]): string {
  if (!lines.length) return '';
  const head = `\n### ${title} (${lines.length})\n`;
  const shown = lines.slice(0, MAX_ROWS);
  const rest = lines.slice(MAX_ROWS);
  if (!rest.length) return `${head}${shown.join('\n')}\n`;

  const detailRows = rest.slice(0, MAX_DETAILS);
  const hidden = rest.length - detailRows.length;
  const hiddenNote = hidden > 0 ? `\n- …외 ${hidden}개(전체는 tokens.json 참조)` : '';
  // </summary> 뒤 빈 줄이 있어야 GitHub이 접힌 목록을 마크다운으로 렌더한다.
  const details = `\n\n<details>\n<summary>나머지 ${rest.length}개 보기</summary>\n\n${detailRows.join('\n')}${hiddenNote}\n\n</details>\n`;
  return `${head}${shown.join('\n')}${details}`;
}

export function formatPrBody(diff: TokenDiff, project: string): string {
  const { added, removed, changed } = diff;
  if (!added.length && !removed.length && !changed.length) {
    return diff.metaChanged
      ? `\`${project}\` 토큰 값은 그대로, 형식·용도 정보(\$type·\$extensions)만 바뀜.`
      : `\`${project}\` 토큰 변경 없음 (이전과 동일).`;
  }
  const head = `## 토큰 변경 요약 — \`${project}\`\n\n변경 ${changed.length} · 추가 ${added.length} · 삭제 ${removed.length}\n`;
  return [
    head,
    section('변경', changed.map((d) => renderChange(d.path, d.from, d.to))),
    section('추가', added.map((d) => renderValue(d.path, d.value))),
    section('삭제', removed.map((d) => renderValue(d.path, d.value))),
    '\n— Design Token Export 플러그인 자동 생성',
  ].join('');
}
