/**
 * 管理端「Agent 指令与记忆」的领域规则（[第三步 US-106a] / F-REVIEW-PROMPT-02）。
 *
 * 页面上能做的每一件事（新建 / 保存 / 启停 / 复制为副本 / 回滚 / 对比 / 分组）
 * 都在这里定形状，页面只负责渲染与调用 —— 于是「版本怎么自增、快照记什么、回滚算哪一版」
 * 只有一个答案，Node 断言与浏览器断言读同一份纯函数。
 *
 * 与 `data/agentFiles.js` 的分工（两个模块都零依赖，可以直接 Node 跑断言）：
 *   - `agentFiles.js` = **读**：加载顺序 / 生效范围匹配 / 每层上限 / 8000 字预算 / 变量替换 / normalize；
 *   - 本模块 = **写**：版本自增、版本快照、变更历史、分组、复制、回滚、行级对比、合并方向。
 *
 * 三条硬约定：
 *  1. **每一次写入都是一版**：「新建」写 v1，「保存」在旧版本上 +1，「启停」「复制为副本」「回滚」
 *     同样 version 自增并留档。理由：停用一份 agent.md 与改它的正文**同样影响下一次点评**，
 *     所以轨迹里的版本指纹要能区分「停用前 / 停用后」。页面里严禁手写 `version` / `versions` /
 *     `history` / `updatedBy`，唯一写入口是 `stampAgentFileVersion()`。
 *  2. **快照带正文**（`versions[].content`）：所以「回滚到任一历史版本」不需要别的来源，
 *     `chars` / `hash` 由正文现算 —— 正文是唯一真源，不信任存下来的数字。
 *  3. **回滚产生新版本，永不改写历史**：回滚到 v3 的结果是「v3 的正文 + 新的版本号」，
 *     历史里 v3..vN 一条不少（US-053 对观察词模板是同一条口径）。
 */

import {
  AGENT_FILE_CHAR_LIMIT,
  AGENT_FILE_HISTORY_LIMIT,
  AGENT_FILE_KINDS,
  AGENT_FILE_KIND_LABELS,
  AGENT_FILE_LOAD_ORDER,
  AGENT_FILE_SCOPES,
  AGENT_FILE_SCOPE_LABELS,
  AGENT_FILE_VARIABLES,
  AGENT_FILE_VERSIONS_LIMIT,
  agentFileHash,
  createEmptyAgentFile,
  normalizeAgentFile
} from './agentFiles';

export { AGENT_FILE_VERSIONS_LIMIT, AGENT_FILE_HISTORY_LIMIT };

/** 管理端版本的统一读入口（= agentFiles 的 normalize，本模块只给它一个更短的名字）。 */
export const normalizeAgentFileRecord = normalizeAgentFile;

/** 页面上可编辑的字段（白名单）：版本 / 快照 / 历史 / 时间戳都不在其中，它们由写入口维护。 */
export const AGENT_FILE_EDITABLE_FIELDS = ['name', 'kind', 'scope', 'scopeRef', 'sortOrder', 'content'];

export const AGENT_FILE_FIELD_LABELS = {
  name: '名称',
  kind: '类型',
  scope: '生效范围',
  scopeRef: '范围对象',
  sortOrder: '排序',
  content: '正文',
  enabled: '启停'
};

/** 稳定的动作代码（进快照与断言）与给人看的中文（进变更历史与界面）。 */
export const AGENT_FILE_ACTION_KEYS = {
  initial: 'initial',
  create: 'create',
  save: 'save',
  enable: 'enable',
  disable: 'disable',
  copy: 'copy',
  rollback: 'rollback'
};

export const AGENT_FILE_ACTION_LABELS = {
  [AGENT_FILE_ACTION_KEYS.initial]: '初始版本',
  [AGENT_FILE_ACTION_KEYS.create]: '新建',
  [AGENT_FILE_ACTION_KEYS.save]: '保存',
  [AGENT_FILE_ACTION_KEYS.enable]: '启用',
  [AGENT_FILE_ACTION_KEYS.disable]: '停用',
  [AGENT_FILE_ACTION_KEYS.copy]: '复制为副本',
  [AGENT_FILE_ACTION_KEYS.rollback]: '回滚'
};

/** 两种类型各自的合法生效范围（与加载顺序一一对应：认不出的组合根本不会被加载）。 */
export const AGENT_FILE_SCOPES_BY_KIND = {
  [AGENT_FILE_KINDS.agentMd]: [AGENT_FILE_SCOPES.platform, AGENT_FILE_SCOPES.org, AGENT_FILE_SCOPES.teacher],
  [AGENT_FILE_KINDS.memory]: [AGENT_FILE_SCOPES.student, AGENT_FILE_SCOPES.class, AGENT_FILE_SCOPES.org]
};

/** 生效范围的一句话说明（编辑区与列表分组都用它，不要在各处重写）。 */
export const AGENT_FILE_SCOPE_HINTS = {
  [AGENT_FILE_SCOPES.platform]: '平台级：所有机构都加载（范围对象留空）',
  [AGENT_FILE_SCOPES.org]: '机构级：范围对象命中本机构时加载（填机构 id 或机构名；留空 = 本层通用）',
  [AGENT_FILE_SCOPES.teacher]: '老师级：范围对象命中老师时加载（填老师 id 或姓名；留空 = 本层通用）',
  [AGENT_FILE_SCOPES.student]: '学员级：范围对象命中学员时加载（填 student-姓名 或直接填姓名；留空 = 本层通用）',
  [AGENT_FILE_SCOPES.class]: '班级级：范围对象命中班级时加载（填班级 id 或班级名；留空 = 本层通用）'
};

/** 类型的一句话说明：这份正文最后落在 system 的哪一段。 */
export const AGENT_FILE_KIND_HINTS = {
  [AGENT_FILE_KINDS.agentMd]: 'agent.md：三层依次拼进 system 的【agent.md】段落（平台 → 机构 → 老师）',
  [AGENT_FILE_KINDS.memory]: '记忆文件：拼进 system 的【长期记忆】段落（学员 > 班级 > 机构）'
};

export const AGENT_FILE_SCOPE_REF_HINT = '范围对象留空 = 该层级的通用文件（这一层任何课次都加载）。';
export const AGENT_FILE_EMPTY_NOTE = '正文为空：不会进入提示词（加载清单里会标「文件正文为空」）。';
export const AGENT_FILE_BUDGET_NOTE = `agent.md 与记忆文件的正文总量上限是 ${AGENT_FILE_CHAR_LIMIT} 字，超出时按加载顺序从后往前截断（加载清单里标明截断位置）。`;
export const AGENT_FILE_DELETE_NOTE = '删除后不再进入新生成的点评；已经归档的历史轨迹用当时留档的正文复现，不受影响。';
export const AGENT_FILE_RESTORE_NOTE = '每保存一次都会新增一版，历史版本都保留 —— 随时可以对比或回滚。';
export const AGENT_FILE_SAVE_NOTE = '保存即生效：老师端下一次生成点评时用新的正文与版本号（版本号会写进推理轨迹）。';

// ---------------------------------------------------------------------------
// 版本号：只认 `v<整数>`（种子数据里就是 v1 / v2 / v3 这种写法）
// ---------------------------------------------------------------------------

/** `v3` → 3；认不出的（空串 / 脏数据）当 0（= 还没有落过盘的新草稿）。 */
export function parseAgentFileVersion(version) {
  const text = String(version === null || version === undefined ? '' : version).trim().replace(/^v/i, '');
  if (!/^\d+$/.test(text)) return 0;
  return Number(text);
}

/** 数字 → `v<n>`（0 → `v0`，只出现在「新建但还没保存」的草稿上）。 */
export function formatAgentFileVersion(value) {
  const number = Number(value);
  return `v${Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0}`;
}

/** 下一版：`v3` → `v4`；脏数据从 v0 起算。 */
export function nextAgentFileVersion(version) {
  return formatAgentFileVersion(parseAgentFileVersion(version) + 1);
}

/** 新建用的草稿记录：v0 + 空的版本与历史（**第一次保存**时才会写成 v1 并留「新建」一条）。 */
export function createAgentFileDraft(input = {}) {
  return normalizeAgentFileRecord({ ...createEmptyAgentFile(input), version: 'v0', versions: [], history: [], updatedAt: '' });
}

/** 类型 / 范围是否是一对能生效的组合（认不出的组合不会被任何一步加载）。 */
export function isAgentFileScopeValid(kind, scope) {
  const list = AGENT_FILE_SCOPES_BY_KIND[kind] || [];
  return list.includes(scope);
}

/** 换类型时把范围收敛到该类型的第一个合法值（否则文件会落在「不会被加载」的组合上）。 */
export function normalizeAgentFileScopeForKind(kind, scope) {
  const list = AGENT_FILE_SCOPES_BY_KIND[kind] || [AGENT_FILE_SCOPES.platform];
  return list.includes(scope) ? scope : list[0];
}

// ---------------------------------------------------------------------------
// 版本快照与变更历史：唯一的写入口 stampAgentFileVersion()
// ---------------------------------------------------------------------------

/** 时间显示：`2026-10-11 21:30`（认不出的时间返回空串，不编造）。 */
export function agentFileTimeText(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (input) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 一版的可读文案：`2026-10-11 21:30 · 平台管理员 · 保存（改动：正文）`。 */
export function agentFileVersionText(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const head = [agentFileTimeText(source.at), String(source.by || '')].filter(Boolean).join(' · ');
  const action = AGENT_FILE_ACTION_LABELS[source.action] || String(source.action || AGENT_FILE_ACTION_LABELS[AGENT_FILE_ACTION_KEYS.initial]);
  const tail = [action, source.note ? `（${source.note}）` : ''].join('');
  return head ? `${head} · ${tail}` : tail;
}

/** 记录的「最后变更」文案：`平台管理员 · 2026-10-11 21:30`；没有记录返回空串。 */
export function agentFileUpdateText(record) {
  const item = normalizeAgentFileRecord(record);
  return [item.updatedBy, agentFileTimeText(item.updatedAt)].filter(Boolean).join(' · ');
}

/** 两次保存之间「改了什么」→ 可读清单（详情写进历史，别在页面里再比一遍）。 */
export function agentFileFieldChanges(before, after) {
  const previous = before && typeof before === 'object' ? before : {};
  const next = after && typeof after === 'object' ? after : {};
  const changes = [];
  AGENT_FILE_EDITABLE_FIELDS.forEach((key) => {
    if (key === 'sortOrder') {
      if (Number(previous.sortOrder ?? 90) !== Number(next.sortOrder ?? 90)) changes.push(AGENT_FILE_FIELD_LABELS[key]);
      return;
    }
    if (String(previous[key] ?? '') !== String(next[key] ?? '')) changes.push(AGENT_FILE_FIELD_LABELS[key]);
  });
  return changes;
}

/**
 * 记一版：**版本 / 快照 / 变更历史 / updatedBy / updatedAt 的唯一写入口**。
 * 传入的记录必须已经带上「这次要落盘的 version 与 content」；本函数只负责
 * ① 把这一版写成快照（同一版本号已存在时覆盖它，避免种子合成的占位重复）
 * ② 追加一条变更历史 ③ 更新最后变更人与时间。
 */
export function stampAgentFileVersion(record, { by = '', at = 0, action = '', note = '' } = {}) {
  const item = normalizeAgentFileRecord(record);
  const timestamp = Number.isFinite(Number(at)) && Number(at) > 0 ? Number(at) : Date.now();
  const iso = new Date(timestamp).toISOString();
  const version = formatAgentFileVersion(parseAgentFileVersion(item.version));
  const entry = {
    version,
    content: item.content,
    chars: item.content.length,
    hash: agentFileHash(item.content),
    enabled: item.enabled !== false,
    at: iso,
    by: String(by || '').trim(),
    action: String(action || '').trim() || AGENT_FILE_ACTION_KEYS.save,
    note: String(note || '').trim()
  };
  const number = parseAgentFileVersion(version);
  const kept = item.versions.filter((snapshot) => parseAgentFileVersion(snapshot.version) !== number);
  return {
    ...item,
    version,
    updatedBy: entry.by,
    updatedAt: iso,
    versions: [...kept, entry].slice(-AGENT_FILE_VERSIONS_LIMIT),
    history: [...item.history, {
      at: iso,
      by: entry.by,
      action: AGENT_FILE_ACTION_LABELS[entry.action] || entry.action,
      detail: entry.note
    }].slice(-AGENT_FILE_HISTORY_LIMIT)
  };
}

/**
 * 版本列表（升序）。种子里没有 `versions`（US-105 的数据早于本故事），
 * 这里按当前正文补一份**当前版本**的快照 —— 于是「查看 / 对比 / 回滚」对老数据同样可用，
 * 且补出来的快照只描述事实（正文 + 版本号 + 已有的 updatedAt），不编造别的版本。
 *
 * 还没保存过的新草稿（`v0`）**不补**：它一版都没有，界面据空数组显示「保存后才有版本历史」。
 */
export function agentFileVersions(record) {
  const item = normalizeAgentFileRecord(record);
  const list = item.versions.slice();
  const current = parseAgentFileVersion(item.version);
  if (current > 0 && !list.some((snapshot) => parseAgentFileVersion(snapshot.version) === current)) {
    list.push({
      version: formatAgentFileVersion(current),
      content: item.content,
      chars: item.content.length,
      hash: agentFileHash(item.content),
      enabled: item.enabled !== false,
      at: item.updatedAt,
      by: item.updatedBy,
      action: AGENT_FILE_ACTION_KEYS.initial,
      note: ''
    });
  }
  return list.sort((left, right) => parseAgentFileVersion(left.version) - parseAgentFileVersion(right.version));
}

/** 版本历史的行（最新在前，界面与断言读同一份）：当前版带 `isCurrent`。 */
export function agentFileVersionRows(record) {
  const item = normalizeAgentFileRecord(record);
  const current = parseAgentFileVersion(item.version);
  return agentFileVersions(item).slice().reverse().map((snapshot) => {
    const number = parseAgentFileVersion(snapshot.version);
    return {
      ...snapshot,
      number,
      versionLabel: formatAgentFileVersion(number),
      actionLabel: AGENT_FILE_ACTION_LABELS[snapshot.action] || snapshot.action || AGENT_FILE_ACTION_LABELS[AGENT_FILE_ACTION_KEYS.initial],
      isCurrent: number === current,
      timeText: agentFileTimeText(snapshot.at),
      changeText: agentFileVersionText(snapshot),
      charsText: `${snapshot.chars} 字`,
      hashText: `sha256 ${snapshot.hash}`,
      enabledText: snapshot.enabled ? '启用中' : '已停用'
    };
  });
}

// ---------------------------------------------------------------------------
// 四个写入动作：新建 / 保存 / 启停 / 复制为副本 / 回滚
// ---------------------------------------------------------------------------

/**
 * 保存：把草稿字段并进记录，**version 自增**，并留一版快照与一条变更历史。
 *
 * `record` 必须是**上一次落盘的那一条**（不是已经改过的草稿）——「改动：…」的清单就是拿它
 * 与 `patch` 比出来的；传草稿进来会永远得到「正文未改动」（本故事在浏览器验证里真踩到）。
 * 第一次保存（老版本里还没有任何快照与历史）写成 v1 并标「新建」；
 * 之后每次保存都 +1，改动清单写进历史（正文没动也照增版本 —— US-106a 的验收原文是「每保存一次 version 自增」）。
 */
export function saveAgentFileRecord(record, patch = {}, { by = '', at = 0 } = {}) {
  const before = normalizeAgentFileRecord(record);
  const merged = { ...before };
  AGENT_FILE_EDITABLE_FIELDS.forEach((key) => { if (patch[key] !== undefined) merged[key] = patch[key]; });
  merged.enabled = patch.enabled === undefined ? before.enabled : patch.enabled !== false;
  const next = normalizeAgentFileRecord(merged);
  next.scope = normalizeAgentFileScopeForKind(next.kind, next.scope);
  const first = !before.versions.length && !before.history.length;
  const changes = agentFileFieldChanges(before, next);
  const bumped = { ...next, version: first ? 'v1' : nextAgentFileVersion(before.version) };
  return stampAgentFileVersion(bumped, {
    by,
    at,
    action: first ? AGENT_FILE_ACTION_KEYS.create : AGENT_FILE_ACTION_KEYS.save,
    note: first ? '' : (changes.length ? `改动：${changes.join('、')}` : '正文未改动')
  });
}

/** 启停：一次写入（版本自增），因为「停用」与「改正文」同样影响下一次点评。 */
export function setAgentFileEnabledRecord(record, enabled, { by = '', at = 0 } = {}) {
  const before = normalizeAgentFileRecord(record);
  const next = enabled !== false;
  if (next === (before.enabled !== false)) return before; // 没有变化：一个字段都不动
  const bumped = { ...before, enabled: next, version: nextAgentFileVersion(before.version) };
  return stampAgentFileVersion(bumped, {
    by,
    at,
    action: next ? AGENT_FILE_ACTION_KEYS.enable : AGENT_FILE_ACTION_KEYS.disable,
    note: next ? '从停用改为启用' : '从启用改为停用'
  });
}

/** 复制为副本：新 id + 新名称（自动去重）+ v1，来源写进历史。 */
export function duplicateAgentFileRecord(record, { existing = [], by = '', at = 0 } = {}) {
  const source = normalizeAgentFileRecord(record);
  const base = String(source.name || AGENT_FILE_KIND_LABELS[source.kind] || '未命名文件').replace(/（副本(?: \d+)?）$/, '').trim();
  const list = Array.isArray(existing) ? existing.map(normalizeAgentFileRecord) : [];
  let name = `${base}（副本）`;
  let index = 2;
  while (list.some((item) => item.name === name)) { name = `${base}（副本 ${index}）`; index += 1; }
  const draft = createAgentFileDraft({
    kind: source.kind,
    scope: source.scope,
    scopeRef: source.scopeRef,
    name,
    sortOrder: source.sortOrder,
    enabled: source.enabled,
    content: source.content
  });
  const bumped = { ...draft, version: 'v1' };
  return stampAgentFileVersion(bumped, {
    by,
    at,
    action: AGENT_FILE_ACTION_KEYS.copy,
    note: `来源：${source.name} ${formatAgentFileVersion(parseAgentFileVersion(source.version))}`
  });
}

/**
 * 回滚到任一历史版本：**产生新版本**（版本号继续 +1），正文与启停状态取自那一版快照，
 * 历史里一条都不删（US-053 同口径）。认不出的版本号 → 原样返回，一个字段都不动。
 */
export function rollbackAgentFileRecord(record, targetVersion, { by = '', at = 0 } = {}) {
  const source = normalizeAgentFileRecord(record);
  const number = parseAgentFileVersion(targetVersion);
  const target = agentFileVersions(source).find((snapshot) => parseAgentFileVersion(snapshot.version) === number);
  if (!target) return source;
  const bumped = {
    ...source,
    content: target.content,
    enabled: target.enabled !== false,
    version: nextAgentFileVersion(source.version)
  };
  return stampAgentFileVersion(bumped, {
    by,
    at,
    action: AGENT_FILE_ACTION_KEYS.rollback,
    note: `回滚到 ${formatAgentFileVersion(number)}`
  });
}

// ---------------------------------------------------------------------------
// 分组：左列表按「类型 × 生效范围」分组（平台/机构/老师 agent.md 与 学员/班级/机构记忆）
// ---------------------------------------------------------------------------

/** 分组的显示名：`平台 agent.md` / `学员记忆`。 */
export function agentFileGroupLabel(kind, scope) {
  const scopeLabel = AGENT_FILE_SCOPE_LABELS[scope] || scope;
  return kind === AGENT_FILE_KINDS.memory ? `${scopeLabel}记忆` : `${scopeLabel} agent.md`;
}

/** 六个分组（顺序 = 加载顺序，去掉不加载文件的「技能 / 观察词 / 写作要求」三步）。 */
export const AGENT_FILE_GROUP_DEFS = AGENT_FILE_LOAD_ORDER
  .filter((step) => step.kind !== 'prompt')
  .map((step, index) => ({
    key: `${step.kind}:${step.scope}`,
    kind: step.kind,
    scope: step.scope,
    label: agentFileGroupLabel(step.kind, step.scope),
    stepLabel: step.label,
    order: index + 1,
    kindHint: AGENT_FILE_KIND_HINTS[step.kind] || '',
    scopeHint: AGENT_FILE_SCOPE_HINTS[step.scope] || ''
  }));

export const AGENT_FILE_GROUP_KEYS = AGENT_FILE_GROUP_DEFS.map((def) => def.key);

/** 「认不出的组合」的兜底分组：不会被任何一步加载，但必须看得见（否则既改不了也删不掉）。 */
export const AGENT_FILE_OTHER_GROUP = {
  key: 'other',
  kind: '',
  scope: '',
  label: '其他生效范围',
  stepLabel: '不参与加载',
  order: 0,
  kindHint: '这一对「类型 × 生效范围」不在加载顺序里：文件可以保留，但不会进入任何一次点评。',
  scopeHint: '把它改成 类型与范围能生效的组合（agent.md：平台/机构/老师；记忆文件：学员/班级/机构）。'
};

export function agentFileGroupKey(record) {
  const item = normalizeAgentFileRecord(record);
  return `${item.kind}:${item.scope}`;
}

/** 组内排序：排序号 → 名称 → id（同样的输入永远同样的顺序）。 */
export function compareAgentFileRecords(left, right) {
  const a = normalizeAgentFileRecord(left);
  const b = normalizeAgentFileRecord(right);
  return (Number(a.sortOrder) || 90) - (Number(b.sortOrder) || 90)
    || String(a.name).localeCompare(String(b.name))
    || String(a.id).localeCompare(String(b.id));
}

/** 全部分组（**包含空组**：界面要一直能看到六个层级的入口，与照片分组同一条纪律）。 */
export function groupAgentFiles(files = []) {
  const records = (Array.isArray(files) ? files : []).map(normalizeAgentFileRecord).filter((item) => item.id).sort(compareAgentFileRecords);
  const groups = AGENT_FILE_GROUP_DEFS.map((def) => ({ ...def, files: records.filter((item) => agentFileGroupKey(item) === def.key) }));
  const known = new Set(AGENT_FILE_GROUP_KEYS);
  const other = records.filter((item) => !known.has(agentFileGroupKey(item)));
  if (other.length) groups.push({ ...AGENT_FILE_OTHER_GROUP, files: other });
  return groups;
}

/** 列表一行的读数：`v4 · 320 字`；停用另标（列表行很窄，这里的时间取短格式，完整信息在编辑区）。 */
export function agentFileListMeta(record) {
  const item = normalizeAgentFileRecord(record);
  const versionText = parseAgentFileVersion(item.version) > 0 ? formatAgentFileVersion(parseAgentFileVersion(item.version)) : '未保存';
  const stamp = agentFileTimeText(item.updatedAt);
  return {
    versionText,
    enabledText: item.enabled !== false ? '启用中' : '已停用',
    scopeText: item.scopeRef || '本层通用',
    charsText: `${item.content.length} 字`,
    updatedShortText: stamp ? stamp.slice(5) : '',
    updatedText: agentFileUpdateText(item)
  };
}

/** 加载顺序的一句话摘要（页面顶部说明「这一页改的东西什么时候被加载」）。 */
export function agentFileOrderText() {
  return AGENT_FILE_LOAD_ORDER.map((step) => step.label).join(' → ');
}

// ---------------------------------------------------------------------------
// 章节对比（行级 diff）与引用计数
// ---------------------------------------------------------------------------

/**
 * 两份正文的行级对比（LCS）。返回
 *  `{ lines: [{ type: 'same' | 'add' | 'remove', text, beforeNo, afterNo }], stats: { added, removed, unchanged, changed } }`。
 * 超长正文（> 2000 行 × 条目）退化为「掐掉公共前后缀 + 中间整体替换」，避免 O(n×m) 把页面卡住 ——
 * 界面只需说明「哪里不一样」，不需要最省的 diff。
 */
export function agentFileDiff(before, after) {
  const beforeLines = (before === null || before === undefined ? '' : String(before)).split('\n');
  const afterLines = (after === null || after === undefined ? '' : String(after)).split('\n');
  const lines = [];
  const push = (type, text, beforeNo, afterNo) => lines.push({ type, text, beforeNo, afterNo });
  if (beforeLines.length * afterLines.length > 250000) {
    let head = 0;
    while (head < beforeLines.length && head < afterLines.length && beforeLines[head] === afterLines[head]) head += 1;
    let tail = 0;
    while (tail < beforeLines.length - head && tail < afterLines.length - head
      && beforeLines[beforeLines.length - 1 - tail] === afterLines[afterLines.length - 1 - tail]) tail += 1;
    for (let index = 0; index < head; index += 1) push('same', beforeLines[index], index + 1, index + 1);
    for (let index = head; index < beforeLines.length - tail; index += 1) push('remove', beforeLines[index], index + 1, 0);
    for (let index = head; index < afterLines.length - tail; index += 1) push('add', afterLines[index], 0, index + 1);
    // 公共后缀：两份的编号都已经定下来，直接按「前一份的行号 + 长度差」推后一份的行号。
    const offset = afterLines.length - beforeLines.length;
    for (let index = beforeLines.length - tail; index < beforeLines.length; index += 1) push('same', beforeLines[index], index + 1, index + 1 + offset);
  } else {
    const rows = beforeLines.length;
    const cols = afterLines.length;
    const table = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let col = cols - 1; col >= 0; col -= 1) {
        table[row][col] = beforeLines[row] === afterLines[col]
          ? table[row + 1][col + 1] + 1
          : Math.max(table[row + 1][col], table[row][col + 1]);
      }
    }
    let row = 0;
    let col = 0;
    while (row < rows && col < cols) {
      if (beforeLines[row] === afterLines[col]) { push('same', beforeLines[row], row + 1, col + 1); row += 1; col += 1; continue; }
      if (table[row + 1][col] >= table[row][col + 1]) { push('remove', beforeLines[row], row + 1, 0); row += 1; }
      else { push('add', afterLines[col], 0, col + 1); col += 1; }
    }
    while (row < rows) { push('remove', beforeLines[row], row + 1, 0); row += 1; }
    while (col < cols) { push('add', afterLines[col], 0, col + 1); col += 1; }
  }
  const stats = {
    added: lines.filter((line) => line.type === 'add').length,
    removed: lines.filter((line) => line.type === 'remove').length,
    unchanged: lines.filter((line) => line.type === 'same').length
  };
  return { lines, stats: { ...stats, changed: stats.added > 0 || stats.removed > 0 } };
}

/** 对比结论文案（面板读它，不要在 JSX 里拼）。 */
export function agentFileDiffText(stats) {
  const source = stats && typeof stats === 'object' ? stats : {};
  if (!source.changed) return '两份正文逐行一致';
  return `新增 ${source.added || 0} 行 · 删除 ${source.removed || 0} 行 · 相同 ${source.unchanged || 0} 行`;
}

/**
 * 引用范围：有多少条**历史轨迹**引用过这一份文件（删除前的提示读它）。
 * 轨迹里只有真正进过提示词的文件（`loaded.files[].fileId`），所以这个数就是「影响面」。
 */
export function agentFileTraceReferences(fileId, traces = []) {
  const key = String(fileId || '');
  if (!key) return { count: 0, latestAt: '' };
  const hits = (Array.isArray(traces) ? traces : [])
    .filter((trace) => Array.isArray(trace?.loaded?.files) && trace.loaded.files.some((file) => String(file?.fileId || file?.id || '') === key));
  const latestAt = hits.map((trace) => String(trace?.createdAt || '')).filter(Boolean).sort().pop() || '';
  return { count: hits.length, latestAt };
}

/** 引用范围的提示文案（删除确认里读它）。 */
export function agentFileReferenceText(reference) {
  const source = reference && typeof reference === 'object' ? reference : {};
  if (!source.count) return '还没有历史轨迹引用过它。';
  const timeText = agentFileTimeText(source.latestAt);
  return `有 ${source.count} 条历史轨迹引用过它${timeText ? `（最近 ${timeText}）` : ''}。`;
}

// ---------------------------------------------------------------------------
// 生效范围候选项（编辑器的 datalist：宁可让老师挑，也不要手打 id 打错）
// ---------------------------------------------------------------------------

/**
 * 范围对象的候选项。接受现成的名单（页面从 `data/studentManagement.js` 与本地课程 / 人设读），
 * 本函数不读任何数据源 —— 纯函数才好断言。
 */
export function agentFileScopeOptions(scope, { orgId = '', orgName = '', teachers = [], students = [], classes = [] } = {}) {
  const toOption = (value, label) => ({ value: String(value || ''), label: String(label || value || '') });
  switch (scope) {
    case AGENT_FILE_SCOPES.org:
      return [toOption(orgId, `${orgName || orgId}（本机构）`)].filter((option) => option.value);
    case AGENT_FILE_SCOPES.teacher:
      return teachers.map((item) => toOption(item?.id || item?.name, item?.name || item?.id)).filter((option) => option.value);
    case AGENT_FILE_SCOPES.student:
      return students.map((item) => toOption(item?.studentId || (item?.name ? `student-${item.name}` : ''), `${item?.name || ''}（student-${item?.name || ''}）`)).filter((option) => option.value);
    case AGENT_FILE_SCOPES.class:
      return classes.map((item) => toOption(item?.id || item?.name, item?.name || item?.id)).filter((option) => option.value);
    default:
      return [];
  }
}

/** 变量按钮清单（编辑器插入占位符用，与 agentFiles 的四个变量同一份）。 */
export function agentFileVariableButtons() {
  return AGENT_FILE_VARIABLES.map((name) => ({ name, token: `{${name}}` }));
}

/**
 * 合并方向：**本机镜像优先**。理由与装裱模板（US-011b）同一条教训 ——
 * 云端 `agent_files` 表可能缺 `versions` / `history` / `updated_by` 列，带新列的整条写入会被
 * PostgREST 拒掉，改动只在本机落地；读取时若让云端顶掉本机，刚保存的版本历史马上就没了。
 * 云端只补「本机没有的 id」（多设备 / 直接改库）。
 */
export function mergeAgentFiles(remote = [], local = []) {
  const byId = new Map();
  (Array.isArray(remote) ? remote : []).forEach((item) => {
    const record = normalizeAgentFileRecord(item);
    if (record.id) byId.set(record.id, record);
  });
  (Array.isArray(local) ? local : []).forEach((item) => {
    const record = normalizeAgentFileRecord(item);
    if (record.id) byId.set(record.id, record);
  });
  return [...byId.values()].sort(compareAgentFileRecords);
}
