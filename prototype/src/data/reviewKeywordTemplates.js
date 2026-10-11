// 作品观察词模板（[第三步 US-109] / F-REVIEW-KW-01 / FR-139 ~ FR-143）。
//
// 老师端第三步的观察词面板与提示词候选清单**共用同一份模板**（FR-139）：
// 「面板渲染哪几个分组」「提示词里给模型哪些候选词」「模型返回后按什么校验」（模板之外的词一律丢弃，FR-143）
// 三处都读这一份的 `keywordTemplateLoadout()` 产物 —— 不要在组件或服务里各自再过滤一遍
// （一处按 enabled 过滤、另一处忘了，就会出现「面板上没有、提示词里却有」的幽灵词）。
//
// 四条硬约定：
//  1. **零依赖纯函数**（只 import 同层的 data 模块：内置词表与归一化规则都在 `reviewKeywords.js`），
//     不碰 DOM、不发请求，可以直接用 Node 跑断言（见 prototype/AGENTS.md）。
//  2. **平台默认模板 v1 = 首次上线导入**：`PLATFORM_DEFAULT_KEYWORD_TEMPLATES` 由现有的
//     `PERSONAL_KEYWORD_CATEGORIES`（8 组 48 词）/ `CLASS_KEYWORD_CATEGORIES`（6 组 36 词）
//     **构造**而来，所以「导入结果与现有词表逐字一致」是结构性成立的
//     （`keywordTemplateVerbatimIssues()` 是这条承诺的守卫，断言直接调它）。
//  3. **匹配口径唯一**：`resolveReviewKeywordTemplate()` 是「这次用哪一套」的唯一真源
//     （先按模式筛 → 再按课程类型 / 年龄段匹配 → 多套命中取优先级最高 → 全都没命中用默认模板）。
//  4. **降级必须可见**（FR-142）：模板取不到时回落到内置兜底词表，并带上 `noteText`
//     （验收原文「当前使用内置兜底词表（模板未连通）」）；只读到本机模板镜像（云端不通）时
//     同样有一条明示，不静默降级。

import {
  CLASS_KEYWORD_CATEGORIES,
  PERSONAL_KEYWORD_CATEGORIES,
  keywordCandidatesPrompt,
  normalizeKeywordText,
  orderFromOptions,
  pickSupportedFromOptions
} from './reviewKeywords';

/** 模板结构版本：模板字段变化时抬高它（旧模板按版本读出，不做半成品迁移）。 */
export const REVIEW_KEYWORD_TEMPLATE_VERSION = 1;

/** 本机镜像的键（沿用「主键是裸数组」的老口径；云端表另算）。 */
export const REVIEW_KEYWORD_TEMPLATE_STORAGE_KEY = 'xinlehui-review-keyword-templates-v1';

/** 云端表名（PRD「建议新增云表」：单表 + JSON 分组）。 */
export const REVIEW_KEYWORD_TEMPLATE_TABLE = 'review_keyword_templates';

/** 适用模式 —— 与老师端第一步的反馈模式同一套词汇（**不要**另造 personal/class 枚举）。 */
export const KEYWORD_TEMPLATE_MODES = {
  personal: '个人反馈',
  class: '班级反馈'
};

export const KEYWORD_TEMPLATE_MODE_LIST = [KEYWORD_TEMPLATE_MODES.personal, KEYWORD_TEMPLATE_MODES.class];

export function normalizeKeywordTemplateMode(value) {
  const text = String(value ?? '').trim();
  return KEYWORD_TEMPLATE_MODE_LIST.includes(text) ? text : KEYWORD_TEMPLATE_MODES.personal;
}

/** 归属层：`orgId` 为空串 = 平台层（全机构可用），否则是本机构模板。 */
export const KEYWORD_TEMPLATE_PLATFORM_ORG = '';

export const DEFAULT_KEYWORD_TEMPLATE_SORT_ORDER = 90;

/** 平台默认模板的固定键（首次上线导入用；管理端删改的是记录本身，不复活）。 */
export const PLATFORM_KEYWORD_TEMPLATE_KEYS = {
  [KEYWORD_TEMPLATE_MODES.personal]: 'platform-keywords-personal',
  [KEYWORD_TEMPLATE_MODES.class]: 'platform-keywords-class'
};

/** 解析结果的状态枚举（面板徽标、折叠态说明与断言读同一份）。 */
export const KEYWORD_TEMPLATE_STATUS = {
  matched: 'matched',
  default: 'default',
  fallback: 'fallback'
};

export const KEYWORD_TEMPLATE_STATUS_LABELS = {
  [KEYWORD_TEMPLATE_STATUS.matched]: '已按课程匹配到模板',
  [KEYWORD_TEMPLATE_STATUS.default]: '使用默认模板',
  [KEYWORD_TEMPLATE_STATUS.fallback]: '使用内置兜底词表'
};

/** 降级说明的两种 kind（界面用 `data-keyword-template-note` 标注）。 */
export const KEYWORD_TEMPLATE_NOTE_KINDS = {
  builtin: 'builtin',
  mirror: 'mirror'
};

/**
 * 模板取不到时的明示文案（验收原文点名了这一句，「模板未连通」六个字必须逐字在）。
 * 内置兜底词表 = `reviewKeywords.js` 的历史词表，与平台默认模板 v1 逐字相同，
 * 但它**不是**机构当前维护的那一份，所以必须让老师看见。
 */
export const KEYWORD_TEMPLATE_FALLBACK_TEXT = '当前使用内置兜底词表（模板未连通），词表口径可能与机构配置不一致，改动需等模板服务连通后同步。';

/** 只读到本机模板镜像（云端不通）时的明示文案：用的是哪一套要说清楚，同样不静默。 */
export function keywordTemplateMirrorText({ name = '', versionText = '' } = {}) {
  const label = [String(name || '').trim() || '本机模板', String(versionText || '').trim()].filter(Boolean).join(' ');
  return `未连上机构模板服务，当前使用本机模板镜像「${label}」，词表改动会在连通后同步。`;
}

/** 一个模式都没有可用模板时的原因（面板与断言读它）。 */
export const KEYWORD_TEMPLATE_EMPTY_REASON = '当前模式下一套可用模板都没有';

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

const toList = (value) => (Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value]));

/** 归一化后的比较键（大小写、空白、全角空格都不算差异）。 */
const norm = (value) => str(value).replace(/\s/g, '').toLowerCase();

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * 模板内容版本：正整数（1、'1'、'v1' 都读成 1）。
 * 「保存时 version 自增」是管理端（US-110）的口径，这里只负责容错读入与显示。
 */
export function normalizeKeywordTemplateVersion(value) {
  if (value === undefined || value === null || value === '') return 1;
  const text = String(value).trim().replace(/^v/i, '');
  const parsed = Math.trunc(Number(text));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** `v1` / `v2` ……（面板、折叠态摘要与轨迹的模块版本都读这一种写法）。 */
export function keywordTemplateVersionText(value) {
  return `v${normalizeKeywordTemplateVersion(value)}`;
}

/** 词条：接受字符串或 `{ term, enabled, sortOrder, note }`（管理端维护时用对象形态）。 */
export function normalizeKeywordTemplateTerm(raw, index = 0) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { term: raw };
  const term = str(source.term ?? source.name ?? source.label);
  if (!term) return null;
  const sortOrder = num(source.sortOrder ?? source.sort_order);
  return {
    term,
    enabled: source.enabled !== false,
    sortOrder: sortOrder === null ? (index + 1) * 10 : sortOrder,
    note: str(source.note)
  };
}

/** 分组：接受 `{ name, terms }`（terms 为字符串数组或词条对象数组）。 */
export function normalizeKeywordTemplateGroup(raw, index = 0) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = str(source.name ?? source.group ?? source.title);
  if (!name) return null;
  const terms = toList(source.terms ?? source.keywords ?? source.items)
    .map((term, position) => normalizeKeywordTemplateTerm(term, position))
    .filter(Boolean);
  const sortOrder = num(source.sortOrder ?? source.sort_order);
  return {
    name,
    // 空分组保留（管理端刚建出来还没加词条时不丢），渲染时由 keywordTemplateGroups() 过滤。
    terms,
    enabled: source.enabled !== false,
    sortOrder: sortOrder === null ? (index + 1) * 10 : sortOrder
  };
}

/**
 * 分组归一：**数组与「分组名 → 词数组」的对象两种写法都认**。
 * 内置词表（`PERSONAL_KEYWORD_CATEGORIES` 等）就是对象写法，管理端表单给的是数组写法
 * —— 导入与读库共用这一处，不要在两边各写一遍转换。
 */
export function normalizeKeywordTemplateGroups(raw) {
  const entries = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' ? Object.entries(raw).map(([name, terms]) => ({ name, terms })) : []);
  return entries.map((entry, index) => normalizeKeywordTemplateGroup(entry, index)).filter(Boolean);
}

/**
 * 容错读入一个模板。**永不抛错**：缺字段补默认值，认不出的模式按「个人反馈」读。
 * `id` 与 `templateKey` 是同一个值（应用内叫 templateKey，云列叫 template_key）。
 */
export function normalizeKeywordTemplate(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const templateKey = str(source.templateKey ?? source.template_key ?? source.id);
  const groups = normalizeKeywordTemplateGroups(source.groups ?? source.categories);
  return {
    version: REVIEW_KEYWORD_TEMPLATE_VERSION,
    templateKey,
    name: str(source.name) || '未命名观察词模板',
    mode: normalizeKeywordTemplateMode(source.mode),
    // 适用课程类型：空数组 = 不限（任何课程都能用）。字符串也认（管理端只填一个时）。
    courseTypes: toList(source.courseTypes ?? source.course_types).map((item) => str(item)).filter(Boolean),
    // 适用年龄段：空串 = 不限。
    ageRange: str(source.ageRange ?? source.age_range),
    groups,
    enabled: source.enabled !== false,
    isDefault: source.isDefault === true || source.is_default === true,
    templateVersion: normalizeKeywordTemplateVersion(source.templateVersion ?? source.version),
    sortOrder: num(source.sortOrder ?? source.sort_order) ?? DEFAULT_KEYWORD_TEMPLATE_SORT_ORDER,
    orgId: str(source.orgId ?? source.org_id),
    updatedBy: str(source.updatedBy ?? source.updated_by),
    updatedAt: str(source.updatedAt ?? source.updated_at),
    legacy: source.legacy && typeof source.legacy === 'object' ? source.legacy : undefined
  };
}

export function normalizeKeywordTemplates(list) {
  return (Array.isArray(list) ? list : []).map(normalizeKeywordTemplate).filter((item) => item.templateKey);
}

/** 由分组表（对象或数组）造一个模板 —— 首次上线的导入与「另存为新模板」都走这一处。 */
export function keywordTemplateFromCategories(categories, input = {}) {
  return normalizeKeywordTemplate({
    groups: normalizeKeywordTemplateGroups(categories),
    ...input
  });
}

/**
 * 平台默认模板 v1 —— **首次上线导入的产物**。
 * 与 `PERSONAL_KEYWORD_CATEGORIES`（8 组 48 词）/ `CLASS_KEYWORD_CATEGORIES`（6 组 36 词）
 * 由同一个构造器生成，因此逐字一致；`keywordTemplateVerbatimIssues()` 是这条承诺的守卫。
 */
export const PLATFORM_DEFAULT_KEYWORD_TEMPLATES = [
  keywordTemplateFromCategories(PERSONAL_KEYWORD_CATEGORIES, {
    templateKey: PLATFORM_KEYWORD_TEMPLATE_KEYS[KEYWORD_TEMPLATE_MODES.personal],
    name: '平台默认 · 作品观察词',
    mode: KEYWORD_TEMPLATE_MODES.personal,
    isDefault: true,
    sortOrder: 10,
    orgId: KEYWORD_TEMPLATE_PLATFORM_ORG,
    updatedBy: '平台默认（首次上线导入）'
  }),
  keywordTemplateFromCategories(CLASS_KEYWORD_CATEGORIES, {
    templateKey: PLATFORM_KEYWORD_TEMPLATE_KEYS[KEYWORD_TEMPLATE_MODES.class],
    name: '平台默认 · 班级课程观察关键词',
    mode: KEYWORD_TEMPLATE_MODES.class,
    isDefault: true,
    sortOrder: 20,
    orgId: KEYWORD_TEMPLATE_PLATFORM_ORG,
    updatedBy: '平台默认（首次上线导入）'
  })
];

export function platformKeywordTemplateFor(mode) {
  const wanted = normalizeKeywordTemplateMode(mode);
  return PLATFORM_DEFAULT_KEYWORD_TEMPLATES.find((template) => template.mode === wanted) || PLATFORM_DEFAULT_KEYWORD_TEMPLATES[0];
}

/**
 * 首次上线导入的守卫（FR-140）：把平台默认模板与内置词表**逐字**比一遍，
 * 返回差异清单（空数组 = 逐字一致）。断言直接调它，不要另写一份比较逻辑。
 */
export function keywordTemplateVerbatimIssues(templates = PLATFORM_DEFAULT_KEYWORD_TEMPLATES) {
  const issues = [];
  const builtin = {
    [KEYWORD_TEMPLATE_MODES.personal]: PERSONAL_KEYWORD_CATEGORIES,
    [KEYWORD_TEMPLATE_MODES.class]: CLASS_KEYWORD_CATEGORIES
  };
  KEYWORD_TEMPLATE_MODE_LIST.forEach((mode) => {
    const template = (Array.isArray(templates) ? templates : []).find((item) => item.mode === mode && item.isDefault)
      || (Array.isArray(templates) ? templates : []).find((item) => item.mode === mode);
    if (!template) { issues.push(`缺少 ${mode} 的平台默认模板`); return; }
    const expected = normalizeKeywordTemplateGroups(builtin[mode]);
    const actual = template.groups;
    if (expected.length !== actual.length) { issues.push(`${mode} 分组数 ${actual.length} ≠ 内置 ${expected.length}`); }
    expected.forEach((group, index) => {
      const got = actual[index];
      if (!got) { issues.push(`${mode} 缺少分组「${group.name}」`); return; }
      if (got.name !== group.name) issues.push(`${mode} 第 ${index + 1} 组名 ${got.name} ≠ ${group.name}`);
      const expectedTerms = group.terms.map((term) => term.term);
      const actualTerms = got.terms.map((term) => term.term);
      if (expectedTerms.join('|') !== actualTerms.join('|')) {
        issues.push(`${mode}「${group.name}」词条不一致：${actualTerms.join('/')} ≠ ${expectedTerms.join('/')}`);
      }
    });
  });
  return issues;
}

/** 模板内容指纹（断言与缓存键用；分组与词条的**顺序**也算进指纹）。 */
export function keywordTemplateFingerprint(template) {
  const item = template && typeof template === 'object' ? template : {};
  return `${item.templateKey || ''}#v${normalizeKeywordTemplateVersion(item.templateVersion)}#${keywordTemplateTerms(item).join('|')}`;
}

const bySortOrder = (left, right) => (left.sortOrder - right.sortOrder) || (left.index - right.index);

/**
 * 模板的**生效分组**：只保留启用的分组与启用的词条，按 `sortOrder` 升序
 * （分组 / 词条的排序由管理端维护，面板展示顺序与它一致 —— FR-109 第 7 条）。
 */
export function keywordTemplateGroups(template) {
  const item = template && typeof template === 'object' ? template : {};
  const groups = normalizeKeywordTemplateGroups(item.groups);
  return groups
    .map((group, index) => ({ ...group, index }))
    .filter((group) => group.enabled)
    .sort(bySortOrder)
    .map((group) => ({
      name: group.name,
      terms: group.terms
        .map((term, index) => ({ ...term, index }))
        .filter((term) => term.enabled && term.term)
        .sort(bySortOrder)
        .map((term) => term.term)
    }))
    .filter((group) => group.terms.length);
}

/** `{ 分组名: [词…] }`（面板按分组渲染；对象的键顺序就是模板顺序）。 */
export function keywordTemplateGroupMap(template) {
  const map = {};
  keywordTemplateGroups(template).forEach((group) => { map[group.name] = group.terms; });
  return map;
}

/** 平铺的全部生效词条（校验模型返回值、计词条数都用它）。 */
export function keywordTemplateTerms(template) {
  return keywordTemplateGroups(template).flatMap((group) => group.terms);
}

export function keywordTemplateCounts(template) {
  const groups = keywordTemplateGroups(template);
  return { groups: groups.length, terms: groups.reduce((sum, group) => sum + group.terms.length, 0) };
}

/** 模板是否可用（启用 + 至少一条生效词条）—— 「一套可用模板都没有」的判据只有这一处。 */
export function keywordTemplateUsable(template) {
  if (!template || template.enabled === false) return false;
  return keywordTemplateTerms(template).length > 0;
}

/** 提示词里的候选清单正文（与内置词表同一格式：`分组：词 / 词 / …`）。 */
export function keywordTemplateCandidatesPrompt(template) {
  const groups = keywordTemplateGroups(template);
  if (!groups.length) return '';
  return groups.map((group) => `${group.name}：${group.terms.join(' / ')}`).join('\n');
}

/**
 * 课程类型匹配：模板没配 = 不限（`constrained: false`）；配了就要求命中其中之一。
 * 命中口径放宽到「相等或互相包含」—— 课程库里存的是「国画」「创意绘画」，而界面上的
 * 课程类型可能是「国画（6-18岁）」，逐字相等会让绑定永远匹配不上。
 */
export function courseTypeMatch(templateCourseTypes, currentCourseTypes) {
  const wanted = toList(templateCourseTypes).map(norm).filter(Boolean);
  if (!wanted.length) return { constrained: false, matched: false };
  const current = toList(currentCourseTypes).map(norm).filter(Boolean);
  if (!current.length) return { constrained: true, matched: false };
  const matched = current.some((item) => wanted.some((want) => item === want || item.includes(want) || want.includes(item)));
  return { constrained: true, matched };
}

/**
 * 年龄段解析：`6-9岁` → `{ min: 6, max: 9 }`、`7岁` → `{ min: 7, max: 7 }`、认不出 → `null`。
 */
export function ageRangeBounds(value) {
  const numbers = String(value ?? '').match(/\d+(\.\d+)?/g);
  if (!numbers || !numbers.length) return null;
  const list = numbers.map(Number).filter((item) => Number.isFinite(item));
  if (!list.length) return null;
  return { min: Math.min(...list), max: Math.max(...list) };
}

/** 年龄段匹配：空 = 不限；两边都能解析出区间时按区间重叠判，否则退回字符串包含。 */
export function ageRangeMatch(templateAgeRange, currentAgeRange) {
  const wanted = str(templateAgeRange);
  if (!wanted) return { constrained: false, matched: false };
  const current = str(currentAgeRange);
  if (!current) return { constrained: true, matched: false };
  if (norm(current) === norm(wanted)) return { constrained: true, matched: true };
  const left = ageRangeBounds(wanted);
  const right = ageRangeBounds(current);
  if (left && right) return { constrained: true, matched: left.min <= right.max && right.min <= left.max };
  return { constrained: true, matched: norm(current).includes(norm(wanted)) || norm(wanted).includes(norm(current)) };
}

/**
 * 一套模板对当前上下文的匹配度：
 *  - `eligible` —— 模式相同、启用、且每一条**已经配置的**约束都命中（没配的约束不拦）；
 *  - `score` —— 约束命中数（课程类型 2 分、年龄段 1 分）：分高的更「贴身」，优先命中；
 *  - `matchedBy` —— 命中的依据（面板上写「为什么默认选中它」）。
 */
export function keywordTemplateMatch(template, context = {}) {
  const item = template && typeof template === 'object' ? template : {};
  const mode = normalizeKeywordTemplateMode(context.mode);
  const matchedBy = [];
  if (item.mode !== mode) return { eligible: false, score: 0, matchedBy, reason: `适用模式是「${item.mode}」` };
  if (item.enabled === false) return { eligible: false, score: 0, matchedBy, reason: '模板已停用' };
  if (!keywordTemplateUsable(item)) return { eligible: false, score: 0, matchedBy, reason: '模板没有可用词条' };
  const course = courseTypeMatch(item.courseTypes, context.courseTypes);
  if (course.constrained && !course.matched) return { eligible: false, score: 0, matchedBy, reason: `适用课程类型是「${item.courseTypes.join(' / ')}」` };
  const age = ageRangeMatch(item.ageRange, context.ageRange);
  if (age.constrained && !age.matched) return { eligible: false, score: 0, matchedBy, reason: `适用年龄段是「${item.ageRange}」` };
  if (course.matched) matchedBy.push(`课程类型匹配（${item.courseTypes.join(' / ')}）`);
  if (age.matched) matchedBy.push(`年龄段匹配（${item.ageRange}）`);
  return { eligible: true, score: (course.matched ? 2 : 0) + (age.matched ? 1 : 0), matchedBy, reason: '' };
}

const byPriority = (left, right) => (right.score - left.score)
  || (left.template.sortOrder - right.template.sortOrder)
  || String(left.template.templateKey).localeCompare(String(right.template.templateKey));

/**
 * 「这次用哪一套」—— **唯一真源**（FR-141）。
 *  1. 先按模式筛出候选（启用 + 有词条 + 约束都命中）；
 *  2. 命中了课程 / 年龄段的（score > 0）按优先级取第一套 → `matched`；
 *  3. 一套都没命中 → 用该模式的默认模板（`isDefault`）→ `default`；
 *     没有标默认的 → 用排序最靠前的一套，并把这件事写进 `reasonText`（不静默）；
 *  4. 一套可用模板都没有 → `{ template: null, status: 'fallback' }`，由调用方回落到内置兜底词表。
 */
export function resolveReviewKeywordTemplate(templates, context = {}) {
  const list = normalizeKeywordTemplates(templates);
  const mode = normalizeKeywordTemplateMode(context.mode);
  const evaluated = list.map((template) => ({ template, ...keywordTemplateMatch(template, context) }));
  const eligible = evaluated.filter((item) => item.eligible);
  const specific = eligible.filter((item) => item.score > 0).sort(byPriority);
  if (specific.length) {
    const winner = specific[0];
    return {
      template: winner.template,
      status: KEYWORD_TEMPLATE_STATUS.matched,
      score: winner.score,
      matchedBy: winner.matchedBy,
      candidates: eligible.map((item) => item.template.templateKey),
      reasonText: ''
    };
  }
  const defaults = eligible.filter((item) => item.template.isDefault).sort(byPriority);
  if (defaults.length) {
    const winner = defaults[0];
    return {
      template: winner.template,
      status: KEYWORD_TEMPLATE_STATUS.default,
      score: 0,
      matchedBy: ['默认模板'],
      candidates: eligible.map((item) => item.template.templateKey),
      reasonText: ''
    };
  }
  const ordered = eligible.sort((left, right) => (left.template.sortOrder - right.template.sortOrder)
    || String(left.template.templateKey).localeCompare(String(right.template.templateKey)));
  if (ordered.length) {
    const winner = ordered[0];
    return {
      template: winner.template,
      status: KEYWORD_TEMPLATE_STATUS.default,
      score: 0,
      matchedBy: ['未命中也未标默认，改用排序第一的一套'],
      candidates: ordered.map((item) => item.template.templateKey),
      reasonText: `${mode}没有标记默认模板，已改用排序第一的「${winner.template.name}」。`,
      fallbackFrom: evaluated.filter((item) => !item.eligible).map((item) => ({ templateKey: item.template.templateKey, reason: item.reason }))
    };
  }
  return {
    template: null,
    status: KEYWORD_TEMPLATE_STATUS.fallback,
    score: 0,
    matchedBy: [],
    candidates: [],
    reasonText: `${KEYWORD_TEMPLATE_EMPTY_REASON}，已回落到内置兜底词表。`,
    fallbackFrom: evaluated.map((item) => ({ templateKey: item.template.templateKey, reason: item.reason }))
  };
}

/**
 * 老师端**唯一入口**：把「模板列表 + 本次上下文（模式 / 课程 / 年龄）+ 云端读取状态」
 * 变成面板、提示词与校验三处都能直接用的一份产物。
 *
 * 返回：
 *  - `template`（可能为 null = 使用内置兜底词表）；
 *  - `groups`（数组，含渲染顺序）/ `groupMap`（对象，喂面板）/ `terms`（平铺，喂校验）/ `prompt`（喂提示词）；
 *  - `source`（`template` | `builtin`）、`status`、`matchedBy`、`reasonText`；
 *  - `noteText` / `noteKind`（`builtin` = 内置兜底词表、`mirror` = 本机模板镜像、空 = 无需提示）。
 *    **不得静默降级**：`source === 'builtin'` 或 `remoteFailed` 时 `noteText` 一定非空。
 */
export function keywordTemplateLoadout({ templates = [], mode = '', courseTypes = [], ageRange = '', remoteFailed = false } = {}) {
  const resolved = resolveReviewKeywordTemplate(templates, { mode, courseTypes, ageRange });
  const template = resolved.template;
  const normalizedMode = normalizeKeywordTemplateMode(mode);
  if (!template) {
    // 回落到内置兜底词表：分组 / 词条 / 候选清单全部走内置那一份（与平台默认模板 v1 逐字相同）。
    const categories = normalizedMode === KEYWORD_TEMPLATE_MODES.class ? CLASS_KEYWORD_CATEGORIES : PERSONAL_KEYWORD_CATEGORIES;
    const groups = normalizeKeywordTemplateGroups(categories).map((group) => ({
      name: group.name,
      terms: group.terms.filter((term) => term.enabled).map((term) => term.term)
    }));
    return {
      status: KEYWORD_TEMPLATE_STATUS.fallback,
      statusLabel: KEYWORD_TEMPLATE_STATUS_LABELS[KEYWORD_TEMPLATE_STATUS.fallback],
      source: 'builtin',
      template: null,
      templateKey: '',
      name: `${normalizedMode}内置兜底词表`,
      versionText: '',
      groups,
      groupMap: Object.fromEntries(groups.map((group) => [group.name, group.terms])),
      terms: groups.flatMap((group) => group.terms),
      counts: { groups: groups.length, terms: groups.reduce((sum, group) => sum + group.terms.length, 0) },
      prompt: keywordCandidatesPrompt(normalizedMode),
      matchedBy: [],
      reasonText: resolved.reasonText,
      noteKind: KEYWORD_TEMPLATE_NOTE_KINDS.builtin,
      noteText: KEYWORD_TEMPLATE_FALLBACK_TEXT
    };
  }
  const groups = keywordTemplateGroups(template);
  const counts = keywordTemplateCounts(template);
  const versionText = keywordTemplateVersionText(template.templateVersion);
  return {
    status: resolved.status,
    statusLabel: KEYWORD_TEMPLATE_STATUS_LABELS[resolved.status],
    source: 'template',
    template,
    templateKey: template.templateKey,
    name: template.name,
    versionText,
    groups,
    groupMap: Object.fromEntries(groups.map((group) => [group.name, group.terms])),
    terms: groups.flatMap((group) => group.terms),
    counts,
    prompt: keywordTemplateCandidatesPrompt(template),
    matchedBy: resolved.matchedBy,
    reasonText: resolved.reasonText,
    // 云端不通但本机有模板镜像：用的是哪一套要说清楚（验收原文点名了「不得静默降级」）。
    noteKind: remoteFailed ? KEYWORD_TEMPLATE_NOTE_KINDS.mirror : '',
    noteText: remoteFailed ? keywordTemplateMirrorText({ name: template.name, versionText }) : ''
  };
}

/** 模型返回的词按**这一次用的模板**校验：模板之外的词一律丢弃（FR-143）。 */
export function pickTemplateKeywords(list, loadout) {
  const options = loadout && Array.isArray(loadout.terms) ? loadout.terms : [];
  return pickSupportedFromOptions(list, options);
}

/** 按模板顺序重排（面板上的勾选顺序与模板 sortOrder 一致）。 */
export function orderTemplateKeywords(list, loadout) {
  const options = loadout && Array.isArray(loadout.terms) ? loadout.terms : [];
  return orderFromOptions(list, options);
}

/**
 * 读取合并：**本机镜像优先**（与装裱模板 / agent 文件同一条纪律）。
 * 云端 `review_keyword_templates` 表还没建出来，带新列的写入会被 PostgREST 整条拒掉，
 * 所以模板的改动目前只在本机镜像里真正落地；云端只补「本机没有的 templateKey」。
 */
export function mergeReviewKeywordTemplates(remote = [], local = []) {
  const localList = normalizeKeywordTemplates(local);
  const known = new Set(localList.map((item) => item.templateKey));
  const extra = normalizeKeywordTemplates(remote).filter((item) => !known.has(item.templateKey));
  return [...localList, ...extra];
}

/** 模板列表里有没有这条（按 templateKey）。 */
export function findKeywordTemplate(templates, templateKey) {
  const key = str(templateKey);
  return normalizeKeywordTemplates(templates).find((item) => item.templateKey === key) || null;
}

/** 新建一套空模板（管理端 US-110 用；本故事只提供构造器）。 */
export function createEmptyKeywordTemplate(input = {}) {
  const mode = normalizeKeywordTemplateMode(input.mode);
  return normalizeKeywordTemplate({
    templateKey: `kw-template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: '新的观察词模板',
    mode,
    groups: [{ name: '画面主题', terms: [] }],
    ...input
  });
}

/** 模板适用范围的说明文案（面板与断言共用；空 = 不限）。 */
export function keywordTemplateScopeText(template) {
  const item = normalizeKeywordTemplate(template);
  const parts = [`适用模式：${item.mode}`];
  parts.push(item.courseTypes.length ? `课程类型：${item.courseTypes.join(' / ')}` : '课程类型：不限');
  parts.push(item.ageRange ? `年龄段：${item.ageRange}` : '年龄段：不限');
  return parts.join(' · ');
}

/** 归一化词条文本（US-110 的「同模板内归一化后重复」判据复用内置词表的同一条规则）。 */
export { normalizeKeywordText };

/** 本机兜底：本地为空（首次上线）或读坏时返回平台默认模板 v1（与技能库 / 课程库同一条读取口径）。 */
export function loadReviewKeywordTemplates() {
  if (typeof window === 'undefined' || !window.localStorage) return PLATFORM_DEFAULT_KEYWORD_TEMPLATES;
  let parsed = null;
  try { parsed = JSON.parse(window.localStorage.getItem(REVIEW_KEYWORD_TEMPLATE_STORAGE_KEY) || 'null'); } catch { parsed = null; }
  if (!Array.isArray(parsed) || !parsed.length) return PLATFORM_DEFAULT_KEYWORD_TEMPLATES;
  const list = normalizeKeywordTemplates(parsed);
  return list.length ? list : PLATFORM_DEFAULT_KEYWORD_TEMPLATES;
}

/**
 * 本机镜像里有没有存过模板 —— 「首次上线」的判据（从没存过 = 需要把平台默认模板 v1 导入一次）。
 * 页面在**第一次渲染**就问它（落盘 effect 一跑镜像就非空了，读晚了永远得不到 true）。
 */
export function reviewKeywordTemplateMirrorStored() {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try { return Array.isArray(JSON.parse(window.localStorage.getItem(REVIEW_KEYWORD_TEMPLATE_STORAGE_KEY) || 'null')); } catch { return false; }
}

export function persistReviewKeywordTemplates(templates) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const list = normalizeKeywordTemplates(templates);
  try { window.localStorage.setItem(REVIEW_KEYWORD_TEMPLATE_STORAGE_KEY, JSON.stringify(list)); } catch { /* 配额满时静默降级 */ }
}
