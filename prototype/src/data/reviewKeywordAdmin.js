/**
 * 管理端「作品观察词模板」的领域规则（[第三步 US-110a] / F-REVIEW-KW-01）。
 *
 * 页面上能做的每一件事（新建 / 保存 / 启停 / 排序 / 删除 / 加改组与词条）
 * 都在这里定形状，页面只负责渲染与调用 —— 于是「版本怎么自增、谁写的、什么算重复词、
 * 草稿与落库记录差在哪」只有一个答案，Node 断言与浏览器断言读同一份纯函数。
 *
 * 与 `data/reviewKeywordTemplates.js` 的分工（两个模块都零依赖，可以直接 Node 跑断言）：
 *   - `reviewKeywordTemplates.js` = **读**：容错 normalize / 老师端匹配（resolveReviewKeywordTemplate）
 *     / 面板与提示词产物（keywordTemplateLoadout）/ 本机镜像；
 *   - 本模块 = **写**：草稿形状、校验（重复词等）、版本自增与快照、分组词条的增删改排序、列表排序。
 * `reviewKeywords.js` 的 `normalizeKeywordText()` 是「归一化后重复」的唯一判据，这里不再写第二份。
 *
 * 三条硬约定：
 *  1. **每一次写入都是一版**：新建第一次保存 = v1，之后每保存一次 +1；启停同样 +1
 *     （停用一套模板与改它的词条同样影响老师端命中，所以版本指纹要能区分「停用前 / 停用后」）。
 *     页面里严禁手写 `templateVersion` / `versions` / `history` / `updatedBy` / `updatedAt`，
 *     唯一写入口是 `stampKeywordTemplateVersion()`。
 *  2. **草稿是表单友好形状**（`groups[].terms[].term` 允许是空串 = 正在输入的那一行），
 *     落库前一律过 `normalizeKeywordTemplate`：空词条与没有组名的分组**不会**进库
 *     （所以保存前必须把它们拦下来并说清楚，别让老师以为存进去了）。
 *  3. **归一化后重复的词阻止保存**（验收点名的判据）：跨分组也算重复 —— 老师端把它们
 *     渲染成两个勾不分的候选词，模型按名字挑一个、老师却以为是两个意思。
 */

import {
  DEFAULT_KEYWORD_TEMPLATE_SORT_ORDER,
  KEYWORD_TEMPLATE_MODE_LIST,
  KEYWORD_TEMPLATE_PLATFORM_ORG,
  createEmptyKeywordTemplate,
  keywordTemplateCounts,
  keywordTemplateScopeText,
  keywordTemplateVersionText,
  normalizeKeywordTemplate,
  normalizeKeywordTemplateGroups,
  normalizeKeywordTemplateMode,
  normalizeKeywordTemplateVersion,
  normalizeKeywordText
} from './reviewKeywordTemplates';

/** 管理端版本的统一读入口（= reviewKeywordTemplates 的 normalize，本模块只给它一个更短的名字）。 */
export const normalizeKeywordTemplateRecord = normalizeKeywordTemplate;

/** 页面上可编辑的字段（白名单）：版本 / 快照 / 历史 / 时间戳由写入口维护，不在其中。 */
export const KEYWORD_TEMPLATE_EDITABLE_FIELDS = ['name', 'mode', 'courseTypes', 'ageRange', 'isDefault', 'sortOrder', 'groups'];

export const KEYWORD_TEMPLATE_FIELD_LABELS = {
  name: '模板名',
  mode: '适用模式',
  courseTypes: '适用课程类型',
  ageRange: '适用年龄段',
  isDefault: '默认模板',
  sortOrder: '排序',
  groups: '分组与词条',
  enabled: '启停'
};

/** 稳定的动作代码（进快照与断言）与给人看的中文（进变更历史与界面）。 */
export const KEYWORD_TEMPLATE_ACTION_KEYS = {
  initial: 'initial',
  create: 'create',
  save: 'save',
  enable: 'enable',
  disable: 'disable',
  copy: 'copy',
  rollback: 'rollback',
  import: 'import'
};

export const KEYWORD_TEMPLATE_ACTION_LABELS = {
  [KEYWORD_TEMPLATE_ACTION_KEYS.initial]: '初始版本',
  [KEYWORD_TEMPLATE_ACTION_KEYS.create]: '新建',
  [KEYWORD_TEMPLATE_ACTION_KEYS.save]: '保存',
  [KEYWORD_TEMPLATE_ACTION_KEYS.enable]: '启用',
  [KEYWORD_TEMPLATE_ACTION_KEYS.disable]: '停用',
  [KEYWORD_TEMPLATE_ACTION_KEYS.copy]: '复制为派生模板',
  [KEYWORD_TEMPLATE_ACTION_KEYS.rollback]: '回滚',
  [KEYWORD_TEMPLATE_ACTION_KEYS.import]: '导入'
};

/** 快照与变更历史的保留条数（够回看近几十次改动即可，本机镜像不无限膨胀）。 */
export const KEYWORD_TEMPLATE_VERSIONS_LIMIT = 20;
export const KEYWORD_TEMPLATE_HISTORY_LIMIT = 50;

/** 一个分组最多多少个词条（与面板宽度无关的硬上限，防止一次性糊进去几百条）。 */
export const KEYWORD_TEMPLATE_TERMS_PER_GROUP_LIMIT = 40;

/** 页面顶部的解析口径说明（老师端怎么选到这一套 —— 验收「按课程类型设定」的上下文）。 */
export const KEYWORD_TEMPLATE_RESOLVE_NOTE = '老师端按顺序选模板：先按反馈模式筛（个人 / 班级），再按适用课程类型与年龄段匹配，多套命中取排序最靠前的一套；都没命中时用该模式的默认模板。';

export const KEYWORD_TEMPLATE_SAVE_NOTE = '保存即生效：老师端下一次生成点评时就用这一套（版本号会写进推理轨迹的模块来源）。';
export const KEYWORD_TEMPLATE_EMPTY_NOTE = '一套模板至少要有一个启用的词条才会被老师端选中；停用的分组与词条不进面板、也不进提示词候选。';
export const KEYWORD_TEMPLATE_DELETE_NOTE = '删除后老师端不再有这一套（已归档的历史点评不受影响：轨迹里留的是当时用的模板版本与词条）。';
export const KEYWORD_TEMPLATE_ORDER_NOTE = '按住左侧的手柄拖到同模式另一套模板上即换位，松手立刻生效（顺序不增版本：它不改词条内容，但决定老师端「多套命中取哪一套」）。';
export const KEYWORD_TEMPLATE_COPY_NOTE = '复制为派生模板：新模板拿到新的 templateKey 与 v1，分组 / 词条 / 适用范围照抄，来源写进变更历史 —— 常用来按画种派生（把「派生课程类型」填成国画，这一套就只在国画课上被命中）。';
export const KEYWORD_TEMPLATE_ROLLBACK_NOTE = '回滚到任一历史版本：把那一版的分组与配置写成「新的」版本（版本号继续 +1），历史版本一条不删。';
export const KEYWORD_TEMPLATE_EXPORT_NOTE = '导出的 JSON 是全部模板（含分组、词条、适用范围、版本与变更历史），可以直接导入回来。';
export const KEYWORD_TEMPLATE_IMPORT_NOTE = '导入按 templateKey 合并：本机没有的直接加入，内容有变化的自增一版，内容一致的原样跳过（把刚导出的文件再导入一次不会白白多出版本）。';

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

const toList = (value) => (Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value]));

/** 排序号：认不出的用默认值（与读侧同一个默认）。 */
export function normalizeKeywordTemplateSortOrder(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_KEYWORD_TEMPLATE_SORT_ORDER;
}

/** 模板的排序号（列表里改「排序」读它）。 */
export function keywordTemplateSortOrder(record) {
  return normalizeKeywordTemplateSortOrder(record?.sortOrder);
}

/** 数字 → `v<n>`（草稿还没保存时也写 v1，界面上另有「尚未保存」的标记）。 */
export function formatKeywordTemplateVersion(value) {
  return keywordTemplateVersionText(value);
}

// ---------------------------------------------------------------------------
// 读取与列表：排序 / 行读数 / 时间文案
// ---------------------------------------------------------------------------

const modeIndex = (mode) => {
  const index = KEYWORD_TEMPLATE_MODE_LIST.indexOf(normalizeKeywordTemplateMode(mode));
  return index < 0 ? KEYWORD_TEMPLATE_MODE_LIST.length : index;
};

/** 列表顺序：模式（个人 → 班级）→ 排序号 → 模板名 → id。 */
export function compareKeywordTemplates(left, right) {
  const a = normalizeKeywordTemplateRecord(left);
  const b = normalizeKeywordTemplateRecord(right);
  return modeIndex(a.mode) - modeIndex(b.mode)
    || keywordTemplateSortOrder(a) - keywordTemplateSortOrder(b)
    || String(a.name).localeCompare(String(b.name))
    || String(a.templateKey).localeCompare(String(b.templateKey));
}

export function sortKeywordTemplates(list = []) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeKeywordTemplateRecord)
    .filter((item) => item.templateKey)
    .sort(compareKeywordTemplates);
}

/** 时间显示：`2026-10-11 21:30`（认不出的时间返回空串，不编造）。 */
export function keywordTemplateTimeText(value) {
  const text = str(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (input) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 落过盘没有 —— 「未保存」只属于页面里刚建出来、还没写过的那一条。
 * 判据是**写入口留下的痕**（操作人 / 时间 / 快照 / 历史），不靠 `templateVersion`：
 * 首次上线导入的平台默认模板没有 updatedAt，但有 updatedBy。
 */
export function keywordTemplateSaved(record) {
  const item = normalizeKeywordTemplateRecord(record);
  return Boolean(item.updatedBy || item.updatedAt || item.versions.length || item.history.length);
}

/** 「最后变更」文案：`平台管理员 · 2026-10-11 21:30`；首次上线导入这类只留了操作人的就只写操作人。 */
export function keywordTemplateUpdateText(record) {
  const item = normalizeKeywordTemplateRecord(record);
  return [item.updatedBy, keywordTemplateTimeText(item.updatedAt)].filter(Boolean).join(' · ');
}

/** 列表一行与编辑区头部的读数（版本 / 启停 / 默认 / 规模 / 最后变更 / 适用范围）。 */
export function keywordTemplateListMeta(record) {
  const item = normalizeKeywordTemplateRecord(record);
  const counts = keywordTemplateCounts(item);
  const saved = keywordTemplateSaved(item);
  return {
    saved,
    versionText: saved ? formatKeywordTemplateVersion(item.templateVersion) : '未保存',
    modeText: item.mode,
    enabledText: item.enabled !== false ? '启用中' : '已停用',
    defaultText: item.isDefault ? '默认模板' : '',
    countsText: `${counts.groups} 组 ${counts.terms} 词`,
    counts,
    scopeText: keywordTemplateScopeText(item),
    updatedText: keywordTemplateUpdateText(item),
    updatedShortText: keywordTemplateTimeText(item.updatedAt).slice(5)
  };
}

// ---------------------------------------------------------------------------
// 草稿：表单友好形状（组的顺序 = 数组顺序，词条允许空串）
// ---------------------------------------------------------------------------

/**
 * 落库记录 → 编辑器草稿。
 * 分组按 `sortOrder` 排好并**重排成数组顺序**（此后顺序只有一个来源：数组位置），
 * 词条同理 —— 于是「上移 / 下移 / 删除」都是普通的数组操作，不存在两处顺序打架。
 */
export function keywordTemplateDraftFrom(record) {
  const item = normalizeKeywordTemplateRecord(record);
  return {
    ...item,
    groups: keywordTemplateEditGroups(item)
  };
}

/**
 * 编辑用的分组视图：**保留**停用项、**空组名**与**空词条**。
 *
 * 注意这里**不能**走 `normalizeKeywordTemplateGroups()`：读侧把那三种都当脏数据丢掉
 * （无名分组直接返回 null、空词条直接返回 null）—— 编辑态要是也丢，老师刚加的
 * 「空行准备输入」与「无名分组」会在下一次操作时凭空消失，保存前的校验也就永远不触发。
 * 读侧仍然照旧：落库一律过 `normalizeKeywordTemplate()`，空的一律不会进库。
 */
export function keywordTemplateEditGroups(record) {
  const raw = record && typeof record === 'object' ? (Array.isArray(record) ? record : (record.groups ?? record.categories ?? record)) : [];
  const entries = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' ? Object.entries(raw).map(([name, terms]) => ({ name, terms })) : []);
  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry, index) => ({
      entry: {
        name: str(entry.name ?? entry.group ?? entry.title),
        enabled: entry.enabled !== false,
        sortOrder: normalizeKeywordTemplateSortOrder(entry.sortOrder ?? entry.sort_order),
        terms: toList(entry.terms ?? entry.keywords ?? entry.items)
          .filter((term) => term !== null && term !== undefined && typeof term !== 'function')
          .map((term, position) => {
            const source = term && typeof term === 'object' && !Array.isArray(term) ? term : { term };
            return {
              term: str(source.term ?? source.name ?? source.label),
              enabled: source.enabled !== false,
              sortOrder: normalizeKeywordTemplateSortOrder(source.sortOrder ?? source.sort_order ?? (position + 1) * 10)
            };
          })
      },
      index
    }))
    .sort((left, right) => (left.entry.sortOrder - right.entry.sortOrder) || (left.index - right.index))
    .map(({ entry }, groupIndex) => ({
      name: entry.name,
      enabled: entry.enabled !== false,
      sortOrder: (groupIndex + 1) * 10,
      terms: entry.terms
        .map((term, index) => ({ term, index }))
        .sort((left, right) => (left.term.sortOrder - right.term.sortOrder) || (left.index - right.index))
        .map(({ term }, termIndex) => ({
          term: term.term,
          enabled: term.enabled !== false,
          sortOrder: (termIndex + 1) * 10
        }))
    }));
}

/**
 * 新建草稿：`templateKey` 现在就定下来（云端 upsert 的冲突键），
 * 但**不带任何落库痕迹**（`updatedBy` / `updatedAt` / 快照 / 历史都是空的），所以界面显示「尚未保存」。
 */
export function createKeywordTemplateDraft(input = {}) {
  const record = createEmptyKeywordTemplate({
    name: '新的观察词模板',
    orgId: KEYWORD_TEMPLATE_PLATFORM_ORG,
    groups: [{ name: '画面主题', terms: [] }],
    ...input
  });
  return keywordTemplateDraftFrom(normalizeKeywordTemplateRecord({
    ...record,
    updatedBy: '',
    updatedAt: '',
    versions: [],
    history: []
  }));
}

// ---------------------------------------------------------------------------
// 校验：重复词 / 空组名 / 空词条 —— 保存闸门与界面提示读同一份
// ---------------------------------------------------------------------------

/**
 * 归一化后重复的词条（**跨分组**也算）：返回**后出现的那一条**（先出现的算「正主」）。
 * 判据复用 `reviewKeywords.js` 的 `normalizeKeywordText()` —— 全角空格、标点、前缀都不算差异。
 */
export function keywordTemplateDuplicateTerms(draft) {
  const groups = keywordTemplateEditGroups(draft);
  const seen = new Map();
  const rows = [];
  groups.forEach((group, groupIndex) => {
    group.terms.forEach((term, termIndex) => {
      const key = normalizeKeywordText(term.term);
      if (!key) return;
      if (seen.has(key)) {
        const first = seen.get(key);
        rows.push({
          key,
          term: term.term,
          groupIndex,
          groupName: group.name,
          termIndex,
          // 后出现的那一条 = 重复行；先出现的那一条在 `keywordTemplateDuplicateIndex` 里被标 `isFirst`。
          isFirst: false,
          firstGroupIndex: first.groupIndex,
          firstGroupName: first.groupName,
          firstTermIndex: first.termIndex,
          firstTerm: first.term,
          text: `第 ${groupIndex + 1} 组「${group.name}」的「${term.term}」与第 ${first.groupIndex + 1} 组「${first.groupName}」的「${first.term}」归一化后重复`
        });
        return;
      }
      seen.set(key, { groupIndex, groupName: group.name, termIndex, term: term.term });
    });
  });
  return rows;
}

/** 界面标红用的查找表：`组序号:词序号` → 重复行。 */
export function keywordTemplateDuplicateIndex(draft) {
  const map = new Map();
  keywordTemplateDuplicateTerms(draft).forEach((row) => {
    map.set(`${row.groupIndex}:${row.termIndex}`, row);
    map.set(`${row.firstGroupIndex}:${row.firstTermIndex}`, { ...row, isFirst: true });
  });
  return map;
}

/** 空词条（正在输入的那一行）：保存时会被丢掉，所以先提示「有 N 个空词条不会保存」。 */
export function keywordTemplateBlankTermRows(draft) {
  const rows = [];
  keywordTemplateEditGroups(draft).forEach((group, groupIndex) => {
    group.terms.forEach((term, termIndex) => {
      if (!str(term.term)) rows.push({ groupIndex, groupName: group.name, termIndex, text: `第 ${groupIndex + 1} 组「${group.name}」第 ${termIndex + 1} 个词是空的` });
    });
  });
  return rows;
}

/** 没有组名的分组：同样会在落库时被丢掉（normalize 认不出无名分组），所以也要拦。 */
export function keywordTemplateBlankGroupRows(draft) {
  return keywordTemplateEditGroups(draft)
    .map((group, groupIndex) => ({ groupIndex, name: group.name }))
    .filter((row) => !str(row.name))
    .map((row) => ({ groupIndex: row.groupIndex, text: `第 ${row.groupIndex + 1} 组还没有组名` }));
}

/**
 * 保存闸门：能保存返回空串，否则返回**可读的一句话**（验收原文「提示并阻止保存」）。
 * 顺序：模板名 → 空组名 → 重复词（空词条不拦，只提示：它就是「还没写完的那一行」）。
 */
export function keywordTemplateSaveIssue(draft) {
  if (!draft) return '没有正在编辑的模板。';
  if (!str(draft.name)) return '请先填写模板名：老师端面板与推理轨迹里都靠它认这一套词表。';
  const blankGroups = keywordTemplateBlankGroupRows(draft);
  if (blankGroups.length) {
    const where = blankGroups.length === 1 ? blankGroups[0].text.replace('还没有组名', '').trim() : `${blankGroups.length} 个分组`;
    return `${where}没有组名：没有组名的分组不会进库，请先补上或删掉它。`;
  }
  const duplicates = keywordTemplateDuplicateTerms(draft);
  if (duplicates.length) {
    const head = duplicates.slice(0, 2).map((row) => row.text).join('；');
    return `同一套模板里有归一化后重复的词（${duplicates.length} 处）：${head}${duplicates.length > 2 ? ' …' : ''}。归一化会去掉空格与标点，重复的词在面板上老师分不出来，请先合并或改名。`;
  }
  return '';
}

/**
 * 保存闸门（**唯一判据**，页面按钮的禁用与 save() 的前置拦截都读它）：
 * `{ ok, issue, warnings }` —— `ok === false` 时一个字段都不许写。
 * 这一层不许在页面里重写一遍 `if (!name) …`（那两处一定会漂移，`evaluateReviewArchiveGate` 同款纪律）。
 */
export function keywordTemplateSaveGate(draft) {
  const issue = keywordTemplateSaveIssue(draft);
  return { ok: !issue, issue, warnings: keywordTemplateWarnings(draft) };
}

/** 不阻断保存的提醒（空词条 / 没有可用词条 / 词条过多）。 */
export function keywordTemplateWarnings(draft) {
  const list = [];
  const blank = keywordTemplateBlankTermRows(draft);
  if (blank.length) list.push(`${blank.length} 个空词条不会保存（${blank[0].text}${blank.length > 1 ? ' …' : ''}）。`);
  const groups = keywordTemplateEditGroups(draft);
  const usableTerms = groups
    .filter((group) => group.enabled)
    .flatMap((group) => group.terms.filter((term) => term.enabled && str(term.term)));
  if (!usableTerms.length) list.push('这套模板还没有可用的词条（启用的分组 + 启用的词条），老师端不会选中它。');
  const tooMany = groups
    .map((group, groupIndex) => ({ group, groupIndex }))
    .filter(({ group }) => group.terms.length > KEYWORD_TEMPLATE_TERMS_PER_GROUP_LIMIT);
  if (tooMany.length) list.push(`第 ${tooMany[0].groupIndex + 1} 组「${tooMany[0].group.name}」有 ${tooMany[0].group.terms.length} 个词条，超过 ${KEYWORD_TEMPLATE_TERMS_PER_GROUP_LIMIT} 个。`);
  return list;
}

// ---------------------------------------------------------------------------
// 分组与词条的两级维护（全部是纯数组操作，顺序 = 数组顺序）
// ---------------------------------------------------------------------------

/** 把草稿的 groups 换成新的分组数组（其余字段一个字不动）。 */
function withGroups(draft, groups) {
  const item = normalizeKeywordTemplateRecord(draft);
  return { ...draft, groups };
}

/** 重排 sortOrder（每次改动后调一次，落库前分组 / 词条的 sortOrder 永远是 10、20、30…）。 */
export function resequenceKeywordGroups(groups = []) {
  return (Array.isArray(groups) ? groups : []).map((group, groupIndex) => ({
    ...group,
    sortOrder: (groupIndex + 1) * 10,
    terms: (Array.isArray(group.terms) ? group.terms : []).map((term, termIndex) => ({
      ...term,
      sortOrder: (termIndex + 1) * 10
    }))
  }));
}

/** 新增分组：默认名「分组 N」可以直接改（不写死业务词，免得教研忘了改）。 */
export function keywordGroupAdd(draft, name = '') {
  const groups = keywordTemplateEditGroups(draft);
  const nextName = str(name) || `分组 ${groups.length + 1}`;
  return withGroups(draft, resequenceKeywordGroups([...groups, { name: nextName, enabled: true, terms: [] }]));
}

export function keywordGroupRename(draft, groupIndex, name) {
  const groups = keywordTemplateEditGroups(draft).map((group, index) => (index === groupIndex ? { ...group, name: String(name ?? '') } : group));
  return withGroups(draft, resequenceKeywordGroups(groups));
}

export function keywordGroupSetEnabled(draft, groupIndex, enabled) {
  const groups = keywordTemplateEditGroups(draft).map((group, index) => (index === groupIndex ? { ...group, enabled: enabled !== false } : group));
  return withGroups(draft, resequenceKeywordGroups(groups));
}

export function keywordGroupRemove(draft, groupIndex) {
  const groups = keywordTemplateEditGroups(draft).filter((group, index) => index !== groupIndex);
  return withGroups(draft, resequenceKeywordGroups(groups));
}

/** 分组上下移动：与邻居**交换数组位置**（顺序只有一个来源，所以画面上看到的就是老师端看到的）。 */
export function keywordGroupMove(draft, groupIndex, delta) {
  const groups = keywordTemplateEditGroups(draft);
  const step = Number(delta) > 0 ? 1 : Number(delta) < 0 ? -1 : 0;
  const target = groupIndex + step;
  if (!step || groupIndex < 0 || groupIndex >= groups.length || target < 0 || target >= groups.length) return withGroups(draft, resequenceKeywordGroups(groups));
  const moved = [...groups];
  const [item] = moved.splice(groupIndex, 1);
  moved.splice(target, 0, item);
  return withGroups(draft, resequenceKeywordGroups(moved));
}

export function keywordTermAdd(draft, groupIndex, term = '') {
  const groups = keywordTemplateEditGroups(draft).map((group, index) => (index === groupIndex
    ? { ...group, terms: [...group.terms, { term: String(term ?? ''), enabled: true }] }
    : group));
  return withGroups(draft, resequenceKeywordGroups(groups));
}

export function keywordTermSet(draft, groupIndex, termIndex, term) {
  const groups = keywordTemplateEditGroups(draft).map((group, index) => (index === groupIndex
    ? { ...group, terms: group.terms.map((item, position) => (position === termIndex ? { ...item, term: String(term ?? '') } : item)) }
    : group));
  return withGroups(draft, resequenceKeywordGroups(groups));
}

export function keywordTermSetEnabled(draft, groupIndex, termIndex, enabled) {
  const groups = keywordTemplateEditGroups(draft).map((group, index) => (index === groupIndex
    ? { ...group, terms: group.terms.map((item, position) => (position === termIndex ? { ...item, enabled: enabled !== false } : item)) }
    : group));
  return withGroups(draft, resequenceKeywordGroups(groups));
}

export function keywordTermRemove(draft, groupIndex, termIndex) {
  const groups = keywordTemplateEditGroups(draft).map((group, index) => (index === groupIndex
    ? { ...group, terms: group.terms.filter((item, position) => position !== termIndex) }
    : group));
  return withGroups(draft, resequenceKeywordGroups(groups));
}

export function keywordTermMove(draft, groupIndex, termIndex, delta) {
  const groups = keywordTemplateEditGroups(draft).map((group, index) => {
    if (index !== groupIndex) return group;
    const step = Number(delta) > 0 ? 1 : Number(delta) < 0 ? -1 : 0;
    const target = termIndex + step;
    if (!step || termIndex < 0 || termIndex >= group.terms.length || target < 0 || target >= group.terms.length) return group;
    const moved = [...group.terms];
    const [item] = moved.splice(termIndex, 1);
    moved.splice(target, 0, item);
    return { ...group, terms: moved };
  });
  return withGroups(draft, resequenceKeywordGroups(groups));
}

/** 整组词条批量替换（AI 补充是 US-111；这里先给「一行一个词」的批量录入用）。 */
export function keywordTermAddMany(draft, groupIndex, text = '') {
  const terms = String(text ?? '').split(/[\n,，、;；]+/).map((item) => str(item)).filter(Boolean);
  if (!terms.length) return draft;
  const groups = keywordTemplateEditGroups(draft).map((group, index) => (index === groupIndex
    ? { ...group, terms: [...group.terms, ...terms.map((term) => ({ term, enabled: true }))] }
    : group));
  return withGroups(draft, resequenceKeywordGroups(groups));
}

/** 适用课程类型：加一个（去重、忽略空串）。 */
export function keywordTemplateCourseAdd(draft, value) {
  const next = str(value);
  if (!next) return draft;
  const list = toList(draft?.courseTypes).map((item) => str(item)).filter(Boolean);
  if (list.some((item) => item === next)) return draft;
  return { ...draft, courseTypes: [...list, next] };
}

export function keywordTemplateCourseRemove(draft, value) {
  const target = str(value);
  return { ...draft, courseTypes: toList(draft?.courseTypes).map((item) => str(item)).filter((item) => item && item !== target) };
}

/**
 * 课程类型候选项：课程库里的课程名（启用中的在前）+ 当前草稿已经填过、以及库里没了的那些
 * （绝不能因为课程被改名就把已配置的类型从界面上抹掉）。
 */
export function keywordTemplateCourseOptions(courses = [], draft) {
  const library = (Array.isArray(courses) ? courses : [])
    .map((course) => ({ name: str(course?.name), enabled: course?.enabled !== false }))
    .filter((course) => course.name);
  const chosen = toList(draft?.courseTypes).map((item) => str(item)).filter(Boolean);
  const names = [];
  const push = (name) => { if (name && !names.includes(name)) names.push(name); };
  library.filter((course) => course.enabled).forEach((course) => push(course.name));
  chosen.filter((name) => !names.includes(name)).forEach(push);
  library.filter((course) => !course.enabled).forEach((course) => push(course.name));
  return names;
}

// ---------------------------------------------------------------------------
// 版本快照、变更历史与三个写入动作：保存 / 启停 / 排序
// ---------------------------------------------------------------------------

const bySortOrder = (left, right) => (left.sortOrder - right.sortOrder) || (left.index - right.index);

/** 变更清单：拿**上一次落盘的那一条**与这次要写的内容比（页面不许自己比一遍）。 */
export function keywordTemplateFieldChanges(before, after) {
  const previous = before ? normalizeKeywordTemplateRecord(before) : null;
  const next = normalizeKeywordTemplateRecord(after);
  const changes = [];
  if (!previous) return ['内容'];
  KEYWORD_TEMPLATE_EDITABLE_FIELDS.forEach((key) => {
    if (key === 'groups') {
      // 两边都取**编辑视图**再比：记录的 groups 带 note 之类的读侧字段，直接比会对不上，
      // 于是「什么都没动也报改动：分组与词条」。
      const beforeText = JSON.stringify(keywordTemplateEditGroups(previous));
      const afterText = JSON.stringify(keywordTemplateEditGroups(next));
      if (beforeText !== afterText) changes.push(KEYWORD_TEMPLATE_FIELD_LABELS.groups);
      return;
    }
    if (key === 'courseTypes') {
      if (previous.courseTypes.join(' / ') !== next.courseTypes.join(' / ')) changes.push(KEYWORD_TEMPLATE_FIELD_LABELS.courseTypes);
      return;
    }
    if (key === 'sortOrder') {
      if (keywordTemplateSortOrder(previous) !== keywordTemplateSortOrder(next)) changes.push(KEYWORD_TEMPLATE_FIELD_LABELS.sortOrder);
      return;
    }
    if (key === 'isDefault') {
      if (previous.isDefault !== next.isDefault) changes.push(KEYWORD_TEMPLATE_FIELD_LABELS.isDefault);
      return;
    }
    if (String(previous[key] ?? '') !== String(next[key] ?? '')) changes.push(KEYWORD_TEMPLATE_FIELD_LABELS[key]);
  });
  return changes;
}

/**
 * 草稿改过没有 —— 与保存时的改动清单**同一口径**（两边都取编辑视图逐字段比）。
 * 分组 / 词条的顺序也算改动：顺序会改老师端面板上的展示顺序。
 */
export function keywordTemplateDirty(base, draft) {
  if (!base || !draft) return false;
  const before = normalizeKeywordTemplateRecord(base);
  const current = draft;
  if (str(current.name) !== before.name) return true;
  if (normalizeKeywordTemplateMode(current.mode) !== before.mode) return true;
  if (str(current.ageRange) !== before.ageRange) return true;
  if ((current.isDefault === true) !== before.isDefault) return true;
  if ((current.enabled !== false) !== (before.enabled !== false)) return true;
  if (keywordTemplateSortOrder(current) !== keywordTemplateSortOrder(before)) return true;
  const courseText = (value) => toList(value).map((item) => str(item)).filter(Boolean).slice().sort().join('|');
  if (courseText(current.courseTypes) !== courseText(before.courseTypes)) return true;
  return JSON.stringify(keywordTemplateEditGroups(current)) !== JSON.stringify(keywordTemplateEditGroups(before));
}

/** 一条快照 / 历史的可读文案：`2026-10-11 21:30 · 平台管理员 · 保存（改动：分组与词条）`。 */
export function keywordTemplateVersionEntryText(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const head = [keywordTemplateTimeText(source.at), str(source.by)].filter(Boolean).join(' · ');
  const action = KEYWORD_TEMPLATE_ACTION_LABELS[source.action] || str(source.action) || KEYWORD_TEMPLATE_ACTION_LABELS[KEYWORD_TEMPLATE_ACTION_KEYS.initial];
  const tail = `${action}${source.note ? `（${source.note}）` : ''}`;
  return head ? `${head} · ${tail}` : tail;
}

/**
 * 记一版：**版本号 / 快照 / 变更历史 / updatedBy / updatedAt 的唯一写入口**。
 * 传入的记录必须已经带好「这次要落盘的内容」；本函数只负责
 * ① 把这一版写成快照（同一版本号已存在时覆盖它，避免种子合成的占位重复）
 * ② 追加一条变更历史 ③ 更新最后变更人与时间。
 */
export function stampKeywordTemplateVersion(record, { by = '', at = 0, action = '', note = '' } = {}) {
  const item = normalizeKeywordTemplateRecord(record);
  const timestamp = Number.isFinite(Number(at)) && Number(at) > 0 ? Number(at) : Date.now();
  const iso = new Date(timestamp).toISOString();
  const version = normalizeKeywordTemplateVersion(item.templateVersion);
  const snapshot = {
    version,
    name: item.name,
    mode: item.mode,
    courseTypes: item.courseTypes,
    ageRange: item.ageRange,
    isDefault: item.isDefault,
    groups: keywordTemplateEditGroups(item),
    enabled: item.enabled !== false,
    at: iso,
    by: str(by),
    action: str(action) || KEYWORD_TEMPLATE_ACTION_KEYS.save,
    note: str(note)
  };
  const kept = item.versions.filter((entry) => normalizeKeywordTemplateVersion(entry.version) !== version);
  return normalizeKeywordTemplateRecord({
    ...item,
    templateVersion: version,
    updatedBy: snapshot.by,
    updatedAt: iso,
    versions: [...kept, snapshot].slice(-KEYWORD_TEMPLATE_VERSIONS_LIMIT),
    history: [...item.history, {
      at: iso,
      by: snapshot.by,
      action: KEYWORD_TEMPLATE_ACTION_LABELS[snapshot.action] || snapshot.action,
      detail: snapshot.note
    }].slice(-KEYWORD_TEMPLATE_HISTORY_LIMIT)
  });
}

/** 版本列表（升序）。老记录（US-109 的种子）没有快照，就按当前内容补一份**当前版本**的快照。 */
export function keywordTemplateVersions(record) {
  const item = normalizeKeywordTemplateRecord(record);
  const list = item.versions.slice();
  const current = normalizeKeywordTemplateVersion(item.templateVersion);
  const has = list.some((entry) => normalizeKeywordTemplateVersion(entry.version) === current);
  if (!has && keywordTemplateSaved(item)) {
    list.push({
      version: current,
      name: item.name,
      mode: item.mode,
      courseTypes: item.courseTypes,
      ageRange: item.ageRange,
      isDefault: item.isDefault,
      groups: keywordTemplateEditGroups(item),
      enabled: item.enabled !== false,
      at: item.updatedAt,
      by: item.updatedBy,
      action: KEYWORD_TEMPLATE_ACTION_KEYS.initial,
      note: ''
    });
  }
  return list.slice().sort((left, right) => normalizeKeywordTemplateVersion(left.version) - normalizeKeywordTemplateVersion(right.version));
}

/** 版本历史的行（最新在前，界面与断言读同一份）：当前版带 `isCurrent`。 */
export function keywordTemplateVersionRows(record) {
  const item = normalizeKeywordTemplateRecord(record);
  const current = normalizeKeywordTemplateVersion(item.templateVersion);
  return keywordTemplateVersions(item).slice().reverse().map((entry) => {
    const version = normalizeKeywordTemplateVersion(entry.version);
    const counts = keywordTemplateCounts({ groups: entry.groups });
    return {
      ...entry,
      version,
      versionLabel: formatKeywordTemplateVersion(version),
      actionLabel: KEYWORD_TEMPLATE_ACTION_LABELS[entry.action] || entry.action || KEYWORD_TEMPLATE_ACTION_LABELS[KEYWORD_TEMPLATE_ACTION_KEYS.initial],
      isCurrent: version === current,
      timeText: keywordTemplateTimeText(entry.at),
      changeText: keywordTemplateVersionEntryText(entry),
      countsText: `${counts.groups} 组 ${counts.terms} 词`,
      enabledText: entry.enabled !== false ? '启用中' : '已停用'
    };
  });
}

/**
 * 保存：把草稿内容并进记录，**version 自增**，并留一版快照与一条变更历史。
 * `base` 必须是**上一次落盘的那一条**（新模板传 null）——「改动：…」的清单就是拿它与草稿比出来的。
 * 第一次保存 = v1 并标「新建」；之后每次 +1（内容没动也照增版本 —— 验收原文是「保存时 version 自增」）。
 * 落库前过 `normalizeKeywordTemplate`：空词条与无名分组在这里被丢掉
 * —— **调用方必须先过 `keywordTemplateSaveGate(draft)`**（重复词 / 无名分组在那里被拦下），
 * 本函数只负责「写一版」，不做闸门判断。
 */
export function saveKeywordTemplateRecord(base, draft, { by = '', at = 0 } = {}) {
  const before = base ? normalizeKeywordTemplateRecord(base) : null;
  const source = draft && typeof draft === 'object' ? draft : {};
  const merged = normalizeKeywordTemplateRecord({
    templateKey: str(source.templateKey) || (before ? before.templateKey : ''),
    name: str(source.name),
    mode: normalizeKeywordTemplateMode(source.mode),
    courseTypes: toList(source.courseTypes).map((item) => str(item)).filter(Boolean),
    ageRange: str(source.ageRange),
    isDefault: source.isDefault === true,
    sortOrder: normalizeKeywordTemplateSortOrder(source.sortOrder),
    groups: keywordTemplateEditGroups(source),
    enabled: source.enabled !== false,
    templateVersion: before ? before.templateVersion : 1,
    orgId: before ? before.orgId : str(source.orgId ?? KEYWORD_TEMPLATE_PLATFORM_ORG),
    updatedBy: before ? before.updatedBy : '',
    updatedAt: before ? before.updatedAt : '',
    versions: before ? before.versions : [],
    history: before ? before.history : [],
    legacy: before ? before.legacy : undefined
  });
  const first = !before || !keywordTemplateSaved(before);
  const changes = first ? [] : keywordTemplateFieldChanges(before, merged);
  const bumped = { ...merged, templateVersion: first ? 1 : normalizeKeywordTemplateVersion(before.templateVersion) + 1 };
  return stampKeywordTemplateVersion(bumped, {
    by,
    at,
    action: first ? KEYWORD_TEMPLATE_ACTION_KEYS.create : KEYWORD_TEMPLATE_ACTION_KEYS.save,
    note: first ? '' : (changes.length ? `改动：${changes.join('、')}` : '内容未改动')
  });
}

/** 启停：一次写入（版本自增），因为「停用」与「改词条」同样影响老师端命中。 */
export function setKeywordTemplateEnabledRecord(record, enabled, { by = '', at = 0 } = {}) {
  const before = normalizeKeywordTemplateRecord(record);
  const next = enabled !== false;
  if (next === (before.enabled !== false)) return before; // 没有变化：一个字段都不动
  const bumped = { ...before, enabled: next, templateVersion: normalizeKeywordTemplateVersion(before.templateVersion) + 1 };
  return stampKeywordTemplateVersion(bumped, {
    by,
    at,
    action: next ? KEYWORD_TEMPLATE_ACTION_KEYS.enable : KEYWORD_TEMPLATE_ACTION_KEYS.disable,
    note: next ? '从停用改为启用' : '从启用改为停用'
  });
}

/**
 * 同一模式只能有一套默认模板：把 target 标成默认，并把同模式其它模板的标记清掉。
 * 被清标记的那些**不**增版本（它们是库级属性变化，与 `moveFramingPreset` 里重排序号同一口径）；
 * target 自己由「保存」那一版写进 `isDefault`，这里再兜一次，保证调用之后列表自洽。
 */
export function applyKeywordTemplateDefault(list = [], templateKey = '') {
  const key = str(templateKey);
  const records = (Array.isArray(list) ? list : []).map(normalizeKeywordTemplateRecord);
  const target = records.find((item) => item.templateKey === key);
  if (!target) return records;
  return records.map((item) => {
    if (item.templateKey === key) return item.isDefault === true ? item : { ...item, isDefault: true };
    if (item.mode !== target.mode) return item;
    if (item.isDefault !== true) return item;
    return { ...item, isDefault: false };
  });
}

/**
 * 把某个模式的一组模板按新顺序重排 sortOrder（10、20、30…），其余模式的模板一个不碰。
 * 返回的列表**就是新顺序**（按新的 sortOrder 排好）：调用方 setState 之后左列表直接对得上，
 * 不要指望调用方再排一次。
 */
function applyKeywordTemplateOrder(ordered, peers) {
  const positions = new Map(peers.map((entry, position) => [entry.templateKey, (position + 1) * 10]));
  return sortKeywordTemplates(ordered.map((entry) => {
    if (!positions.has(entry.templateKey)) return entry;
    const sortOrder = positions.get(entry.templateKey);
    return keywordTemplateSortOrder(entry) === sortOrder ? entry : { ...entry, sortOrder };
  }));
}

/**
 * 上下移动一套模板：与同模式的邻居交换位置，然后按位次重排 sortOrder（10、20、30…）。
 * 与 `moveFramingPreset` 同一条纪律：**移动的是排序，不改内容**，所以不增版本号
 * （被挪动位置的那几套只改 sortOrder，快照与历史不动）。
 */
export function moveKeywordTemplate(list = [], templateKey = '', delta = 0) {
  const ordered = sortKeywordTemplates(list);
  const key = str(templateKey);
  const record = ordered.find((item) => item.templateKey === key);
  if (!record) return ordered;
  const peers = ordered.filter((item) => item.mode === record.mode);
  const index = peers.findIndex((item) => item.templateKey === key);
  const step = Number(delta) > 0 ? 1 : Number(delta) < 0 ? -1 : 0;
  const target = index + step;
  if (!step || index < 0 || target < 0 || target >= peers.length) return ordered;
  const movedPeers = [...peers];
  const [item] = movedPeers.splice(index, 1);
  movedPeers.splice(target, 0, item);
  return applyKeywordTemplateOrder(ordered, movedPeers);
}

/**
 * 拖拽排序（US-110b）：把 `templateKey` 拖到 `targetKey` 现在占的位置上，然后重排序号。
 *
 * 与 `moveKeywordTemplate` 同一口径：**只动顺序、不增版本**（内容一个字不变），
 * 但改动会落本机镜像并推云端 —— 老师端按 `sortOrder` 解析「多套命中取哪一套」，
 * 所以顺序改了老师端立刻按新顺序解析（验收原文「保存后老师端顺序立即生效」）。
 *
 * 三条边界：① 跨模式拖拽不生效（顺序只在同模式内比较）；② 拖到自己身上 = 空操作；
 * ③ 找不到任意一端时原样返回（返回的是排好序的列表，不是入参原对象）。
 */
export function moveKeywordTemplateTo(list = [], templateKey = '', targetKey = '') {
  const ordered = sortKeywordTemplates(list);
  const key = str(templateKey);
  const target = str(targetKey);
  if (!key || !target || key === target) return ordered;
  const record = ordered.find((item) => item.templateKey === key);
  if (!record) return ordered;
  const peers = ordered.filter((item) => item.mode === record.mode);
  const from = peers.findIndex((item) => item.templateKey === key);
  const to = peers.findIndex((item) => item.templateKey === target);
  if (from < 0 || to < 0 || from === to) return ordered;
  const movedPeers = [...peers];
  const [item] = movedPeers.splice(from, 1);
  movedPeers.splice(to, 0, item);
  return applyKeywordTemplateOrder(ordered, movedPeers);
}

/** 两次排序之间有没有真的变化（拖拽 / 上下移动后判断「顺序已更新」还是「本来就在那儿」）。 */
export function keywordTemplateOrderText(list = []) {
  return sortKeywordTemplates(list).map((item) => `${item.templateKey}:${keywordTemplateSortOrder(item)}`).join('|');
}

// ---------------------------------------------------------------------------
// 复制为派生模板 / 回滚 / 导出导入 JSON（US-110b）
// ---------------------------------------------------------------------------

/** 重名就去重：`X` → `X 2` → `X 3` …（管理员在复制表单里手写的名字被占用时才动它）。 */
export function uniqueKeywordTemplateName(name, existing = []) {
  const base = str(name) || '未命名观察词模板';
  const taken = new Set((Array.isArray(existing) ? existing : []).map((item) => str(item)));
  if (!taken.has(base)) return base;
  let index = 2;
  let candidate = `${base} ${index}`;
  while (taken.has(candidate)) { index += 1; candidate = `${base} ${index}`; }
  return candidate;
}

/** 同一个画种派生多套时名字不能撞：`国画 · 观察词` → `国画 · 观察词（副本）` → `（副本 2）` → …（与 agent 文件的副本命名同一口径） */
export function copyKeywordTemplateName(name, existing = []) {
  const base = str(name).replace(/（副本(?:\s*\d+)?）\s*$/, '').trim() || '未命名观察词模板';
  const taken = new Set((Array.isArray(existing) ? existing : []).map((item) => str(item)));
  let candidate = `${base}（副本）`;
  let index = 2;
  while (taken.has(candidate)) { candidate = `${base}（副本 ${index}）`; index += 1; }
  return candidate;
}

/** 「派生课程类型」输入框 → 课程类型数组（逗号 / 顿号 / 分号 / 换行都能分隔）。 */
export function parseKeywordTemplateCourseTypes(value) {
  return String(value ?? '').split(/[\n,，、;；]+/).map((item) => str(item)).filter(Boolean);
}

/**
 * 复制为派生模板：新 templateKey + 新名字 + v1，
 * 分组 / 词条 / 适用范围照抄，来源与（可选的）派生课程类型写进变更历史。
 *
 * 名字口径（两处共用同一个去重函数）：**手写的名字原样用**（只有撞名才补 ` 2`）；
 * 没给名字才派生 `源模板名（副本）`。副本**永远不是默认模板**
 * （同一模式只留一套默认，交给「设为默认」去改），并排在同模式最后（不插队改变老师端命中顺序）。
 */
export function duplicateKeywordTemplateRecord(record, { existing = [], by = '', at = 0, name = '', courseTypes = null } = {}) {
  const source = normalizeKeywordTemplateRecord(record);
  const list = (Array.isArray(existing) ? existing : []).map(normalizeKeywordTemplateRecord);
  const peers = list.filter((item) => item.mode === source.mode);
  const maxOrder = peers.reduce((max, item) => Math.max(max, keywordTemplateSortOrder(item)), 0);
  const names = list.map((item) => item.name);
  const given = str(name);
  const nextCourseTypes = courseTypes === null
    ? source.courseTypes
    : parseKeywordTemplateCourseTypes(courseTypes);
  const draft = createKeywordTemplateDraft({
    mode: source.mode,
    name: given ? uniqueKeywordTemplateName(given, names) : copyKeywordTemplateName(source.name, names),
    courseTypes: nextCourseTypes,
    ageRange: source.ageRange,
    groups: keywordTemplateEditGroups(source),
    orgId: source.orgId,
    isDefault: false,
    sortOrder: maxOrder + 10
  });
  const derived = courseTypes === null ? '' : `，派生课程类型：${nextCourseTypes.join(' / ') || '不限'}`;
  return stampKeywordTemplateVersion({ ...draft, templateVersion: 1 }, {
    by,
    at,
    action: KEYWORD_TEMPLATE_ACTION_KEYS.copy,
    note: `来源：${source.name} ${formatKeywordTemplateVersion(source.templateVersion)}${derived}`
  });
}

/**
 * 回滚到任一历史版本：**产生新版本**（版本号继续 +1），分组与配置取自那一版快照，
 * `versions` 里一条都不删（与 `rollbackAgentFileRecord` 同一口径，验收原文「回滚本身产生新版本且不覆盖历史」）。
 * 认不出的版本号、或目标就是当前版本 → 原样返回，一个字段都不动。
 */
export function rollbackKeywordTemplateRecord(record, targetVersion, { by = '', at = 0 } = {}) {
  const source = normalizeKeywordTemplateRecord(record);
  const number = normalizeKeywordTemplateVersion(targetVersion);
  const current = normalizeKeywordTemplateVersion(source.templateVersion);
  const target = keywordTemplateVersions(source).find((entry) => normalizeKeywordTemplateVersion(entry.version) === number);
  if (!target || number === current) return source;
  const restored = normalizeKeywordTemplateRecord({
    ...source,
    name: target.name || source.name,
    mode: target.mode,
    courseTypes: target.courseTypes,
    ageRange: target.ageRange,
    isDefault: target.isDefault,
    enabled: target.enabled !== false,
    groups: keywordTemplateEditGroups({ groups: target.groups }),
    templateVersion: current + 1
  });
  return stampKeywordTemplateVersion(restored, {
    by,
    at,
    action: KEYWORD_TEMPLATE_ACTION_KEYS.rollback,
    note: `回滚到 ${formatKeywordTemplateVersion(number)}`
  });
}

/** 导出文件的外层标识：导入时据此认出「这是观察词模板的导出文件」。 */
export const KEYWORD_TEMPLATE_EXPORT_TYPE = 'xinlehui-review-keyword-templates';
export const KEYWORD_TEMPLATE_EXPORT_VERSION = 1;

/** 导出封套（纯数据）：`templates` 是归一化后的整份模板记录（含版本与变更历史）。 */
export function buildKeywordTemplateExport(list = [], { at = 0, by = '' } = {}) {
  const records = sortKeywordTemplates(list);
  const timestamp = Number.isFinite(Number(at)) && Number(at) > 0 ? Number(at) : Date.now();
  return {
    type: KEYWORD_TEMPLATE_EXPORT_TYPE,
    version: KEYWORD_TEMPLATE_EXPORT_VERSION,
    exportedAt: new Date(timestamp).toISOString(),
    exportedBy: str(by),
    count: records.length,
    templates: records
  };
}

export function keywordTemplateExportText(payload) {
  return JSON.stringify(payload, null, 2);
}

/** 导出文件名：`观察词模板-20261011.json`（日期取自封套，取不到就用当下）。 */
export function keywordTemplateExportFilename(payload) {
  const text = str(payload?.exportedAt);
  const parsed = text ? new Date(text) : null;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `观察词模板-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`;
}

/**
 * 解析导入文件（**永不抛错**）：认得出就给出待导入的模板，认不出就给一句可读的拒绝原因。
 * 兼容三种写法：本模块导出的封套、裸数组、`{ templates: [...] }`。
 */
export function parseKeywordTemplateImport(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { ok: false, payload: null, templates: [], issues: ['文件是空的'], message: '导入文件是空的，未做任何改动。' };
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (error) {
    return { ok: false, payload: null, templates: [], issues: [String(error?.message || error)], message: '这个文件不是合法的 JSON，未做任何改动。' };
  }
  const payload = Array.isArray(parsed)
    ? { type: KEYWORD_TEMPLATE_EXPORT_TYPE, version: KEYWORD_TEMPLATE_EXPORT_VERSION, exportedAt: '', templates: parsed }
    : (parsed && typeof parsed === 'object' ? parsed : null);
  if (!payload) return { ok: false, payload: null, templates: [], issues: ['顶层不是对象'], message: '导入文件的顶层既不是对象也不是数组，未做任何改动。' };
  const type = str(payload.type);
  if (type && type !== KEYWORD_TEMPLATE_EXPORT_TYPE) {
    return { ok: false, payload, templates: [], issues: [`type=${type}`], message: `这份文件是「${type}」的导出结果，不是观察词模板。` };
  }
  const entries = Array.isArray(payload.templates) ? payload.templates : [];
  const templates = entries.map(normalizeKeywordTemplateRecord).filter((item) => item.templateKey);
  const missing = entries.length - templates.length;
  const issues = missing > 0 ? [`有 ${missing} 条记录没有 templateKey，已跳过`] : [];
  if (!templates.length) {
    return { ok: false, payload, templates: [], issues, message: '文件里没有带 templateKey 的模板，未做任何改动。' };
  }
  const exportedText = keywordTemplateTimeText(payload.exportedAt);
  return {
    ok: true,
    payload,
    templates,
    issues,
    message: `读到 ${templates.length} 套模板${exportedText ? `（导出于 ${exportedText}）` : ''}${issues.length ? ` · ${issues.join('；')}` : ''}。`
  };
}

/**
 * 导入时判断「文件里这一条与本机那一套的内容一致吗」：一致就跳过 ——
 * 把刚导出的文件再导一次不该让每一套都白白多出一版（内容一个字都没变）。
 * 比的口径与保存时的改动清单一致（名称 / 模式 / 适用范围 / 启停 / 默认 / 分组与词条）。
 */
export function keywordTemplateImportUnchanged(record, incoming) {
  const local = normalizeKeywordTemplateRecord(record);
  const next = normalizeKeywordTemplateRecord({ ...incoming, templateKey: local.templateKey });
  if (str(local.name) !== str(next.name)) return false;
  if (local.mode !== next.mode) return false;
  if (str(local.ageRange) !== str(next.ageRange)) return false;
  if ((local.enabled !== false) !== (next.enabled !== false)) return false;
  if (local.isDefault !== next.isDefault) return false;
  if (local.courseTypes.join(' / ') !== next.courseTypes.join(' / ')) return false;
  return JSON.stringify(keywordTemplateEditGroups(local)) === JSON.stringify(keywordTemplateEditGroups(next));
}

/**
 * 把导入的模板并进现有列表（**导入 = 一次写入**，所以也记一版）：
 *  - 本机已有同一 `templateKey` 且内容有变化 → 用文件里的内容更新并 `+1` 一版（本地版本谱系与历史都留着）；
 *  - 本机已有同一 `templateKey` 且内容一致 → **原样跳过**（不白白多出版本，导入是幂等的）；
 *  - 本机没有 → 直接加入（沿用文件里的版本与历史，再补一条「导入」记录）。
 * 导入的默认模板会把同模式原来的默认标记清掉（同一模式只留一套默认，与 `applyKeywordTemplateDefault` 同口径）。
 */
export function mergeKeywordTemplateImport(current = [], incoming = [], { by = '', at = 0, source = '' } = {}) {
  let records = sortKeywordTemplates(current);
  const added = [];
  const updated = [];
  const unchanged = [];
  const note = `从 JSON 导入${str(source) ? `（${str(source)}）` : ''}`;
  (Array.isArray(incoming) ? incoming : []).map(normalizeKeywordTemplateRecord).filter((item) => item.templateKey).forEach((item) => {
    const index = records.findIndex((record) => record.templateKey === item.templateKey);
    if (index < 0) {
      const record = stampKeywordTemplateVersion(normalizeKeywordTemplateRecord({
        ...item,
        updatedBy: '',
        updatedAt: ''
      }), { by, at, action: KEYWORD_TEMPLATE_ACTION_KEYS.import, note });
      records = [...records, record];
      added.push(record);
      return;
    }
    const before = records[index];
    if (keywordTemplateImportUnchanged(before, item)) { unchanged.push(before); return; }
    const merged = normalizeKeywordTemplateRecord({
      ...before,
      name: item.name,
      mode: item.mode,
      courseTypes: item.courseTypes,
      ageRange: item.ageRange,
      isDefault: item.isDefault,
      groups: item.groups,
      enabled: item.enabled !== false,
      templateVersion: normalizeKeywordTemplateVersion(before.templateVersion) + 1
    });
    const record = stampKeywordTemplateVersion(merged, { by, at, action: KEYWORD_TEMPLATE_ACTION_KEYS.import, note });
    records = records.map((entry, position) => (position === index ? record : entry));
    updated.push(record);
  });
  [...added, ...updated].filter((item) => item.isDefault).forEach((item) => {
    records = applyKeywordTemplateDefault(records, item.templateKey);
  });
  const list = sortKeywordTemplates(records);
  const head = `导入完成：新增 ${added.length} 套，更新 ${updated.length} 套`;
  const tail = unchanged.length ? `，跳过 ${unchanged.length} 套（内容一致）` : '';
  const empty = added.length + updated.length + unchanged.length ? '' : '（文件里没有可用的模板）';
  const reportText = `${head}${tail}${empty}。`;
  return { list, added, updated, unchanged, reportText };
}

/** 删除一套模板（返回新列表；调用方负责推云端并提示）。 */
export function removeKeywordTemplate(list = [], templateKey = '') {
  const key = str(templateKey);
  return sortKeywordTemplates(list).filter((item) => item.templateKey !== key);
}
