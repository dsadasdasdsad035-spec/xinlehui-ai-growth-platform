// 技能库 —— 独立的基础数据表，与「老师人设」分开维护。
// 人设页只做勾选：profile.skillKeys 存的是这里 skill_key 的引用列表。
//
// 本模块另持有「这次点评用了哪几项技能、没用上的又是为什么」的**唯一真源**（[第三步 US-104]）：
// `skillLoadout()` 同时产出三样东西 —— 加载清单的逐项行（含没加载的原因与原文片段）、
// 提示词里【已启用技能】段落的正文、以及计数。三处（清单 / 提示词 / 断言）都读它，
// **不允许任一处自己再算一遍**（各自算一遍一定会漂：一处按 enabled 过滤、另一处忘了）。
// 零依赖纯函数，可以直接 `node` 跑断言（见 prototype/AGENTS.md）。
const STORAGE_KEY = 'xinlehui-skill-library-v1';

export const seedSkillLibrary = [
  { id: 'skill-color-perception', name: '色彩感知观察', description: '只描述画面中真实可见的颜色关系，不推断孩子对颜色的主观感受。', category: '作品观察', enabled: true, sortOrder: 1 },
  { id: 'skill-composition', name: '构图发展评估', description: '判断主体位置、留白与大小关系，指出一个具体可调整的方向。', category: '作品观察', enabled: true, sortOrder: 2 },
  { id: 'skill-behavior', name: '正向行为描述', description: '用可观察行为替代性格评价，例如「停顿后重新回到画面」。', category: '行为观察', enabled: true, sortOrder: 3 },
  { id: 'skill-parent-talk', name: '家长沟通话术', description: '把专业观察转成家长今晚就能用的一句话提问。', category: '家长沟通', enabled: true, sortOrder: 4 },
  { id: 'skill-evidence-guard', name: '证据边界守卫', description: '证据不足的维度主动写明局限，绝不编造课堂细节。', category: '安全约束', enabled: true, sortOrder: 5 }
];

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

export function loadSkillLibrary() {
  if (typeof window === 'undefined') return seedSkillLibrary;
  const saved = safeParse(window.localStorage.getItem(STORAGE_KEY), null);
  if (!Array.isArray(saved) || !saved.length) return seedSkillLibrary;
  return saved;
}

export function persistSkillLibrary(skills) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(skills)); } catch { /* 配额满时静默降级 */ }
}

export function createEmptySkill() {
  return {
    id: `skill-${Date.now()}`,
    name: '新技能',
    description: '',
    category: '未分类',
    enabled: true,
    sortOrder: 90,
    source: 'manual'
  };
}

const slugify = (value) => String(value || '')
  .trim().toLowerCase()
  .replace(/[^a-z0-9一-龥]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'skill';

/** 上传的技能包 → 技能条目。SKILL.md 的正文会作为技能描述写进提示词。 */
export function skillFromPackage(pkg, existing = []) {
  const base = slugify(pkg.name);
  let id = `up-${base}`;
  let n = 2;
  while (existing.some(item => item.id === id)) id = `up-${base}-${n++}`;
  return {
    id,
    name: pkg.displayName || pkg.name || '未命名技能',
    description: (pkg.description || pkg.body || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    category: '导入技能',
    enabled: true,
    sortOrder: 90,
    source: 'upload',
    originRef: pkg.sourceName || '',
    version: pkg.version || '',
    author: pkg.author || '',
    license: pkg.license || '',
    packageFiles: pkg.files || [],
    auditLevel: pkg.audit?.level || 'safe'
  };
}

/** 本机发现 / 技能市场的条目 → 技能条目。originRef 用于避免重复导入。 */
export function skillFromIndexEntry(entry, kind = 'local') {
  const prefix = kind === 'market' ? 'mkt' : 'idx';
  return {
    id: `${prefix}-${slugify(entry.name)}`,
    name: entry.displayName || entry.name,
    description: (entry.description || entry.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    category: entry.category || '导入技能',
    enabled: true,
    sortOrder: 90,
    source: kind === 'market' ? 'market' : 'local',
    originRef: entry.name,
    version: entry.version || '',
    author: entry.author || '',
    license: entry.license || '',
    installs: Number(entry.installs) || 0,
    packageFiles: entry.fileList || [],
    auditLevel: 'safe'
  };
}

/**
 * 把人设里勾选的 skillKeys 解析成真正的技能条目。
 * 同时要求「技能库里该项是启用的」——库里停用后，人设上的勾选自动失效，
 * 这样基础数据的维护者能一键下掉某项技能，不必逐个改人设。
 */
export function resolveSkills(skillKeys = [], library = [], legacySkills = []) {
  const keys = Array.isArray(skillKeys) ? skillKeys : [];
  const byKey = keys.map(key => library.find(item => item.id === key)).filter(Boolean);
  if (byKey.length) return byKey.filter(item => item.enabled !== false);
  // 兼容旧数据：人设里曾经直接内嵌技能对象，这里按名称回落到技能库。
  const legacy = Array.isArray(legacySkills) ? legacySkills : [];
  const byName = legacy
    .filter(item => item && item.enabled !== false && item.name)
    .map(item => library.find(entry => entry.name === item.name) || {
      id: `legacy-${item.name}`, name: item.name, description: item.description || '', category: '未分类', enabled: true
    });
  return byName.filter(item => item.enabled !== false);
}

// ---------------------------------------------------------------------------
// 技能加载清单（[第三步 US-104] / F-REVIEW-SKILL-01）
// ---------------------------------------------------------------------------

/**
 * 没加载的原因有且只有三种（PRD US-104 原文），加上「已加载」这个空值。
 * `reasonKey` 是给断言与 DOM 用的稳定代码，`reason` 是给人看的中文 —— 面板与导出读同一份。
 */
export const SKILL_LOAD_REASON_KEYS = {
  included: 'included',
  notSelected: 'not-selected',
  disabled: 'disabled',
  missing: 'missing'
};

export const SKILL_LOAD_REASONS = {
  [SKILL_LOAD_REASON_KEYS.included]: '',
  [SKILL_LOAD_REASON_KEYS.notSelected]: '未被人设勾选',
  [SKILL_LOAD_REASON_KEYS.disabled]: '技能已在库中停用',
  [SKILL_LOAD_REASON_KEYS.missing]: '技能 id 在库中不存在'
};

/** 一项技能都没勾上时的明确文案（验收原文：不能是空白）。 */
export const SKILL_EMPTY_TEXT = '本次未启用任何技能';

/** 技能来源的显示名（与「技能库」页的来源徽标同一套词汇）。 */
export const SKILL_SOURCE_LABELS = {
  legacy: '人设内嵌（旧数据）',
  manual: '技能库（手工维护）',
  upload: '技能库（导入技能包）',
  local: '本机发现',
  market: '技能市场'
};

/** 技能来源：库里没有 source 字段的（种子 / 手工录入）一律说「技能库」。 */
export function skillSourceLabel(skill) {
  const source = String(skill?.source || '').trim();
  const label = SKILL_SOURCE_LABELS[source];
  return label || (source ? `技能库（${source}）` : '技能库');
}

/** 「版本或更新时间」（验收要求显示其一）：有版本写版本，没有版本写更新时间，都没有如实写「未标注」。 */
export function skillVersionText(skill) {
  const version = String(skill?.version || '').trim();
  if (version) return `v${version.replace(/^v/i, '')}`;
  const updatedAt = String(skill?.updatedAt || '').trim();
  if (updatedAt) return `更新于 ${updatedAt.slice(0, 10)}`;
  return '未标注';
}

/**
 * 一项技能进入提示词的那一行 —— **原文片段的唯一真源**。
 * 提示词里【已启用技能】段落的每一行就是它，面板里点开单项看到的也是同一份字符串
 * （`- 技能名：技能描述`，描述为空时只写技能名）。
 */
export function skillPromptLine(skill) {
  const name = skill?.name === undefined || skill?.name === null ? '' : String(skill.name);
  const description = skill?.description === undefined || skill?.description === null ? '' : String(skill.description);
  return `- ${name}${description ? `：${description}` : ''}`;
}

/**
 * 一项技能 → 加载清单里的一行（面板、导出、断言共用这一个构造器）。
 *
 * `chars` 是**技能描述**的字符数（与加载清单「技能 · N 项 · M 字」同一口径，只对已加载的求和）；
 * `lineChars` 是原文片段整行的字符数；没加载的行同样带上 `chars`/`lineChars`（那是技能自身的属性），
 * 但 `included` 为假、并写明 `reason`。
 */
export function skillLoadRow(skill, { reasonKey = SKILL_LOAD_REASON_KEYS.included } = {}) {
  const source = skill && typeof skill === 'object' ? skill : {};
  const key = Object.values(SKILL_LOAD_REASON_KEYS).includes(reasonKey) ? reasonKey : SKILL_LOAD_REASON_KEYS.included;
  const included = key === SKILL_LOAD_REASON_KEYS.included;
  const description = source.description === undefined || source.description === null ? '' : String(source.description);
  const name = source.name === undefined || source.name === null ? '' : String(source.name);
  const sourceKey = String(source.source || '').trim();
  const row = {
    id: String(source.id || name || ''),
    name: name || String(source.id || '未命名技能'),
    category: String(source.category || '').trim() || '未分类',
    source: sourceKey,
    sourceLabel: skillSourceLabel(source),
    version: String(source.version || '').trim(),
    updatedAt: String(source.updatedAt || '').trim(),
    description,
    chars: description.length,
    lineChars: skillPromptLine(source).length,
    excerpt: skillPromptLine(source),
    included,
    reasonKey: key,
    reason: SKILL_LOAD_REASONS[key]
  };
  row.versionText = skillVersionText(row);
  row.detail = [row.category, row.sourceLabel, row.versionText, `${row.chars} 字`].filter(Boolean).join(' · ');
  row.text = `${included ? '[已加载]' : '[未加载]'} ${row.name} · ${row.detail}${included ? '' : ` —— ${row.reason}`}`;
  return row;
}

/**
 * 这次点评用了哪几项技能、没用上的又是为什么 —— **唯一真源**。
 *
 * 输入就是提示词拼装处那三份数据（`profile.skillKeys` / `extra.skillLibrary` / `profile.skills`），
 * 返回 `{ rows, included, lines, content, counts }`：
 *  - `rows`：**全部技能**一条一行 —— 技能库里的每一项（含已停用的），加上人设勾了但库里没有的 id；
 *  - `included` / `lines`：真正进入提示词的技能与它们的原文行（跟 `resolveSkills()` 的结果一一对应）；
 *  - `content`：拼进 system 的【已启用技能】段落（一项都没有时是空串，调用方按「不出现这个模块」处理）；
 *  - `counts`：`{ total, library, included, disabled, notSelected, missing }`。
 *
 * 判定优先级：库中停用 > 未被人设勾选（库的维护动作更该被看见）。
 */
export function skillLoadout({ skillKeys = [], library = [], legacySkills = [] } = {}) {
  const keys = (Array.isArray(skillKeys) ? skillKeys : []).filter(key => key !== undefined && key !== null && String(key)).map(String);
  const list = (Array.isArray(library) ? library : []).filter(item => item && item.id);
  const included = resolveSkills(keys, list, legacySkills);
  const includedIds = new Set(included.map(item => item.id));
  const knownIds = new Set(list.map(item => item.id));
  const sorted = [...list].sort((a, b) => {
    const left = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 90;
    const right = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 90;
    return left - right || String(a.id).localeCompare(String(b.id));
  });
  const rows = sorted.map(skill => skillLoadRow(skill, {
    reasonKey: includedIds.has(skill.id)
      ? SKILL_LOAD_REASON_KEYS.included
      : (skill.enabled === false ? SKILL_LOAD_REASON_KEYS.disabled : SKILL_LOAD_REASON_KEYS.notSelected)
  }));
  // 人设勾了、技能库里却没有的 id：也要列出来并点名「技能 id 在库中不存在」。
  [...new Set(keys)].filter(key => !knownIds.has(key)).forEach(key => {
    rows.push(skillLoadRow({ id: key, name: key, category: '未分类', source: '' }, { reasonKey: SKILL_LOAD_REASON_KEYS.missing }));
  });
  // 旧数据：人设里内嵌的技能对象（按名称回落）。它们不在库里，但可能真的进了提示词 —— 清单必须对得上。
  included.filter(skill => !knownIds.has(skill.id)).forEach(skill => {
    rows.push(skillLoadRow({ ...skill, source: skill.source || 'legacy' }, { reasonKey: SKILL_LOAD_REASON_KEYS.included }));
  });
  const lines = included.map(skillPromptLine);
  return {
    rows,
    included,
    lines,
    content: lines.length ? `【已启用技能】\n${lines.join('\n')}` : '',
    counts: {
      total: rows.length,
      library: list.length,
      included: included.length,
      disabled: rows.filter(row => row.reasonKey === SKILL_LOAD_REASON_KEYS.disabled).length,
      notSelected: rows.filter(row => row.reasonKey === SKILL_LOAD_REASON_KEYS.notSelected).length,
      missing: rows.filter(row => row.reasonKey === SKILL_LOAD_REASON_KEYS.missing).length
    }
  };
}
