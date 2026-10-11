/**
 * 管理端「用大模型补充观察词」的领域规则（[第三步 US-111] / F-REVIEW-KW-01 / FR-147、FR-148）。
 *
 * 教研不想一个字一个字想词，所以模型先给一批**候选**（建议分组 + 词条 + 一句推荐理由），
 * 教研在上面挑。本模块是这条链路的唯一真源，零依赖、可用 Node 直跑断言：
 *
 *  1. **独立通道**：`KEYWORD_AI_CHANNEL` 是一支**独立于点评的模型通道** —— 自己的提示词
 *     （`KEYWORD_AI_SYSTEM` / `keywordAiUserPrompt`，逐字符可断言）、自己的参数、自己的模型链
 *     （`keywordAiModelPlan`：优先文本通道模型，本部署没开通时明示回落到通用模型）。
 *     绝不 import `services/llmReview.js` 的提示词与模块拼装（那是第三步点评的路径）。
 *  2. **候选的判据只有一个函数**：`keywordCandidateRows()` 同时给出「模板内已存在 → 标灰跳过」
 *     「候选内重复 → 标灰跳过」「疑似同义 → 提示但由管理员决定」，页面只渲染它的产物。
 *     归一化判据复用 `reviewKeywords.js` 的 `normalizeKeywordText()`（与保存闸门同一套规则）。
 *  3. **采纳写草稿区**：`keywordCandidateAdopt()` 把选中的词并进草稿（分组不存在就建组），
 *     版本自增交给已有的保存闸门（`data/reviewKeywordAdmin.js` 的 `saveKeywordTemplateRecord`）。
 *     它只动草稿，不写库、不推云端 —— 验收原文「采纳写入草稿区，确认保存后模板 version 自增」。
 *  4. **每一步都留痕**：`keywordAiAuditDetail()` 产出三条审计日志的 detail 文案
 *     （谁、什么时候、候选了什么 / 采纳了哪些词 / 丢弃了哪些），动作键在 `data/auditLog.js`。
 *
 * 与 `reviewKeywordAdmin.js` 的分工：那边是**手写维护**（草稿形状 / 校验 / 版本 / 分组词条增删排序），
 * 这边是**模型补充**（候选 / 去重 / 同义 / 勾选 / 采纳），两边都只写草稿，落库仍走同一条保存路径。
 */

import { normalizeKeywordText } from './reviewKeywords';
import { KEYWORD_TEMPLATE_TERMS_PER_GROUP_LIMIT, keywordTemplateEditGroups, resequenceKeywordGroups } from './reviewKeywordAdmin';
import { REVIEW_MODEL_DEFAULT_ID, REVIEW_MODEL_HEALTH, normalizeReviewModel } from './reviewModels';

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

/** 独立通道的标识：提示词 id / 用途 / 界面口径说明（审计与回执都用它点名「这一次走的是哪条通道」）。 */
export const KEYWORD_AI_CHANNEL = {
  id: 'review-keyword-candidates',
  promptId: 'keyword-candidate-prompt-v1',
  label: '观察词补充通道',
  title: 'AI 补充观察词',
  purpose: '给教研生成观察词候选（建议分组 + 词条 + 一句推荐理由），由教研逐条决定采纳哪些。'
};

/** 与点评通道的边界说明（面板上一直摆着：这是验收原文「不复用点评的提示词」的界面落点）。 */
export const KEYWORD_AI_CHANNEL_NOTE = '这条通道有自己的提示词与模型链，不复用第三步点评的人设 / 技能 / 记忆拼装（点评提示词的任何改动都不会影响这里，反之亦然）。';
export const KEYWORD_AI_SCOPE_NOTE = 'AI 只负责提候选，**不会直接改词表**：候选默认全不选中，采纳后进草稿区，点「保存」才落库并让模板 version 自增。';

/** 期望数量：默认 10（验收原文「默认 8–12 个」），可填 4–20。 */
export const KEYWORD_AI_COUNT_DEFAULT = 10;
export const KEYWORD_AI_COUNT_MIN = 4;
export const KEYWORD_AI_COUNT_MAX = 20;
export const KEYWORD_AI_COUNT_HINT = '建议 8-12 个';

/** 一次最多接受多少条候选（提示词会要求 N 条，模型偶尔给多，这里兜一层）。 */
export const KEYWORD_AI_MAX_CANDIDATES = 24;

/** 候选没有给出可用分组名时的落点（永远不留空分组）。 */
export const KEYWORD_AI_GROUP_FALLBACK = 'AI 补充';

/** 「疑似同义」的判定阈值与说明（包含关系必提示；重合度用 Dice 系数，默认 0.6）。 */
export const KEYWORD_AI_SYNONYM_THRESHOLD = 0.6;
export const KEYWORD_AI_SYNONYM_NOTE = '疑似同义只是提醒（包含或高度重合），采纳与否由你决定；归一化后完全相同的词会被标灰跳过。';

/** 模型通道：文本能力标签 + 通道口径说明（回落到通用模型时必须点名，不许静默）。 */
export const KEYWORD_AI_TEXT_CAPABILITY = '文本生成';
export const KEYWORD_AI_MODEL_NOTE = '默认优先走文本通道模型；本部署没开通文本通道时会自动回落到通用模型，并在回执上点名说明了哪一档。';
export const KEYWORD_AI_MODEL_EMPTY_TEXT = '当前没有可用模型（健康检查失败或额度不足），先到「模型供应商」检查；手工新增词条不受影响。';

// ---------------------------------------------------------------------------
// 上下文与提示词（独立提示词：逐字符可断言，与点评提示词毫无交集）
// ---------------------------------------------------------------------------

/** 上下文可选项（验收点名的五项：课程类型 / 年龄段 / 画种 / 目标分组 / 期望数量）。 */
export const KEYWORD_AI_CONTEXT_FIELDS = ['courseType', 'ageRange', 'artForm', 'targetGroup', 'count'];

/** 期望数量归一化（认不出 / 越界一律收敛到区间内，永不抛错）。 */
export function normalizeKeywordAiCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return KEYWORD_AI_COUNT_DEFAULT;
  return Math.min(KEYWORD_AI_COUNT_MAX, Math.max(KEYWORD_AI_COUNT_MIN, Math.round(parsed)));
}

/** 上下文归一化：五项都收敛成字符串 / 数字，缺的写空串（提示词与回执读同一份）。 */
export function normalizeKeywordAiContext(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    courseType: str(source.courseType),
    ageRange: str(source.ageRange),
    artForm: str(source.artForm),
    targetGroup: str(source.targetGroup),
    count: normalizeKeywordAiCount(source.count)
  };
}

/** 上下文的一句话读数（回执 / 审计 / 面板上「这一次按什么生成的」都读它）。 */
export function keywordAiContextText(raw = {}) {
  const context = normalizeKeywordAiContext(raw);
  return [
    `课程类型 ${context.courseType || '未指定'}`,
    `年龄段 ${context.ageRange || '未指定'}`,
    `画种 ${context.artForm || '未指定'}`,
    `目标分组 ${context.targetGroup || '按模型建议'}`,
    `期望 ${context.count} 条`
  ].join(' · ');
}

/** 生成用的 system 提示词 —— 这条通道自己的，与点评的 system 没有任何共用段落。 */
export const KEYWORD_AI_SYSTEM = `你是儿童美术机构的教研助理，为「作品观察词模板」补充候选词条。

观察词是老师在点评里勾选、模型用来复述画面的短词（例如"暖色调""留白意境""线条流畅"）。

规则：
- 每个词条 2-6 个字，必须是**画面或课堂里能真实指出来的**东西，不写评价性套话（如"很棒""优秀"）。
- 分组名 2-6 个字，用机构已有的分组口径优先（例如"色彩感受""构图特点""线条笔触"）。
- 同一个词不要重复出现；也不要给出已有词条的近义词（包含关系或只差一两个字的写法）。
- 每条候选都要写一句推荐理由，说明"这个词在什么画面上能被指认"，不超过 30 字。
- 只输出一个 JSON 对象，不要 Markdown、不要代码块、不要任何解释文字。`;

/**
 * 生成用的 user 提示词（独立提示词的 user 段）：把上下文与**模板现有词**一起交给模型，
 * 让它主动避开重复与近义（客户端仍会再判一次 —— 模型有时不听）。
 */
export function keywordAiUserPrompt(raw = {}, { existingTerms = [] } = {}) {
  const context = normalizeKeywordAiContext(raw);
  const existing = (Array.isArray(existingTerms) ? existingTerms : [])
    .map((item) => str(item && typeof item === 'object' ? item.term : item))
    .filter(Boolean);
  const lines = [
    `请为下面这套观察词模板补充 ${context.count} 条候选词条。`,
    `课程类型：${context.courseType || '未指定'}；年龄段：${context.ageRange || '未指定'}；画种：${context.artForm || '未指定'}。`
  ];
  if (context.targetGroup) lines.push(`全部词条都放进分组「${context.targetGroup}」。`);
  else lines.push('分组由你按词的语义给出（不要所有词都塞进同一个分组）。');
  if (existing.length) {
    lines.push(`模板里已有的词（不要重复给出，也不要给出它们的近义词）：${existing.slice(0, 60).join('、')}${existing.length > 60 ? ' …' : ''}`);
  } else {
    lines.push('模板里还没有词，按上面的上下文从零开始给。');
  }
  lines.push('只输出一个 JSON 对象，结构：{"candidates":[{"group":"建议分组","term":"词条","reason":"一句推荐理由"}]}');
  return lines.join('\n');
}

/**
 * 本次请求的提示词（**纯函数**，与真正发出去的那一份同源）：`{ channelId, promptId, model?, system, user, chars }`。
 * 面板上的「本次提示词」折叠块、审计 detail 的字数、断言读的都是它。
 */
export function keywordAiPromptBundle(raw = {}, { existingTerms = [], model = '' } = {}) {
  const system = KEYWORD_AI_SYSTEM;
  const user = keywordAiUserPrompt(raw, { existingTerms });
  return {
    channelId: KEYWORD_AI_CHANNEL.id,
    promptId: KEYWORD_AI_CHANNEL.promptId,
    model: str(model),
    system,
    user,
    chars: system.length + user.length
  };
}

// ---------------------------------------------------------------------------
// 模型通道：优先文本模型，本部署没开通时明示回落（独立于点评的模型选择）
// ---------------------------------------------------------------------------

/** 一条模型在这一通道里的判定（与点评通道的 `reviewModelAvailability` 是两份口径，别混用）。 */
export function keywordAiModelRow(raw = {}, { orgId = '' } = {}) {
  const model = normalizeReviewModel(raw);
  const org = str(orgId);
  const textCapable = model.capabilities.includes(KEYWORD_AI_TEXT_CAPABILITY);
  const reason = model.orgId && model.orgId !== org ? 'unauthorized'
    : model.health === REVIEW_MODEL_HEALTH.failed ? 'health-failed'
      : model.quotaRemaining <= 0 ? 'quota-exceeded'
        : 'ok';
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    version: model.version,
    capabilities: model.capabilities,
    textCapable,
    channel: textCapable ? 'text' : 'general',
    sortOrder: model.sortOrder,
    available: reason === 'ok' && Boolean(model.id),
    reasonKey: reason,
    reasonText: reason === 'ok' ? '' : ({
      unauthorized: '机构未授权该模型',
      'health-failed': '健康检查失败',
      'quota-exceeded': '额度不足'
    })[reason],
    label: `${model.name}${textCapable ? '（文本通道）' : ''}`,
    modelText: [model.name, model.provider, model.version].filter(Boolean).join(' · ')
  };
}

/**
 * 通道的模型计划：
 *  - `rows`：目录里全部模型（含不可用的，置灰并写原因）；
 *  - `chain`：**默认链** —— 可用的文本通道模型（按排序）在前，通用兜底模型（`REVIEW_MODEL_DEFAULT_ID`）在后；
 *    服务层按链条逐个尝试，模型级拒绝（本部署没开通）就换下一档，并把这件事写进回执；
 *  - `explicit` 传了具体模型 id 就用它**单独**一条链（明确换模型 = 钉住它，不做静默替换）。
 */
export function keywordAiModelPlan({ models = [], explicit = '', orgId = '' } = {}) {
  const rows = (Array.isArray(models) ? models : [])
    .map((item) => keywordAiModelRow(item, { orgId }))
    .filter((row) => row.id)
    .sort((left, right) => (left.sortOrder - right.sortOrder) || left.id.localeCompare(right.id));
  const available = rows.filter((row) => row.available);
  const textModels = available.filter((row) => row.textCapable);
  const fallback = available.find((row) => row.id === REVIEW_MODEL_DEFAULT_ID) || null;
  const picked = str(explicit);
  const chain = picked
    ? [picked]
    : [...textModels.map((row) => row.id), ...(fallback && !textModels.some((row) => row.id === fallback.id) ? [fallback.id] : [])];
  const explicitRow = picked ? rows.find((row) => row.id === picked) : null;
  return {
    rows,
    available,
    textModels,
    fallback,
    chain,
    explicit: picked,
    defaultModel: str(chain[0]),
    explicitAvailable: explicitRow ? explicitRow.available : null,
    note: KEYWORD_AI_MODEL_NOTE,
    emptyText: available.length ? '' : KEYWORD_AI_MODEL_EMPTY_TEXT
  };
}

/**
 * 云端错误的分类：`model-unavailable` 是「这台机器/这个部署没开通这个模型」（换下一档有意义），
 * 其余（网络 / 超时 / 参数 / 未知）都不该继续换模型 —— 交回界面让管理员决定重试还是换模型。
 */
export function keywordAiErrorKind(error) {
  const code = String(error?.error?.code || error?.code || '');
  if (/request_invalid_parameter|model_not_found|invalid_model|unsupported_model/i.test(code)) return 'model-unavailable';
  if (/gateway_|timeout|network|econn|fetch failed|socket/i.test(code) || /timeout|network|fetch failed/i.test(String(error?.message || ''))) return 'network';
  if (/auth_|quota_/i.test(code)) return 'auth';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// 模型输出的解析与候选归一化（永不抛错）
// ---------------------------------------------------------------------------

const GROUP_PREFIX = /^[^：:]{1,10}[：:]\s*/;

/** 词条文本：剥掉「分组名：」前缀（模型有时会把分组名写进词条），再去掉首尾空白。 */
export function keywordCandidateTermText(value) {
  return str(value).replace(GROUP_PREFIX, '').trim();
}

/** 候选是否可用（词条非空）。 */
export function keywordCandidateUsable(candidate) {
  return Boolean(keywordCandidateTermText(candidate?.term));
}

/** 一条候选归一化：`{ group, term, reason }`（认不出的字段留空，不编造）。 */
export function normalizeKeywordCandidate(raw, { groupFallback = '' } = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { term: raw };
  const group = str(source.group ?? source.category ?? source.分组 ?? source.groupName ?? source.组名) || str(groupFallback);
  return {
    group,
    term: keywordCandidateTermText(source.term ?? source.word ?? source.keyword ?? source.词条 ?? source.name),
    reason: str(source.reason ?? source.why ?? source.推荐理由 ?? source.note ?? source.detail)
  };
}

/** 从模型返回的文本里掐出第一个括号配平的 JSON（字符串与转义要跳过，理由里可能带括号）。 */
export function extractKeywordAiJsonText(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, index + 1);
    }
  }
  return '';
}

/**
 * 解析模型输出（**永不抛错**）：认得出就给出候选数组，认不出给一句可读的原因。
 * 兼容：`{candidates:[…]}` / `{keywords:[…]}` / `{items:[…]}` / 裸数组 / 代码块包裹 / 词条是字符串。
 */
export function parseKeywordAiOutput(text, { groupFallback = '' } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, candidates: [], issues: ['模型没有返回内容'], message: '模型没有返回内容，请重试或换一个模型。' };
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonText = extractKeywordAiJsonText(cleaned);
    if (jsonText) {
      try { parsed = JSON.parse(jsonText); } catch { parsed = null; }
    }
  }
  if (!parsed) return { ok: false, candidates: [], issues: ['不是合法 JSON'], message: '模型返回的内容不是合法 JSON，无法解析，请重试或换一个模型。' };
  const entries = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed.candidates) ? parsed.candidates
      : (Array.isArray(parsed.keywords) ? parsed.keywords
        : (Array.isArray(parsed.items) ? parsed.items
          : (Array.isArray(parsed.list) ? parsed.list : null))));
  if (!entries) return { ok: false, candidates: [], issues: ['缺少 candidates 数组'], message: '模型返回的 JSON 里没有 candidates 数组，请重试或换一个模型。' };
  const candidates = entries
    .map((entry) => normalizeKeywordCandidate(entry, { groupFallback }))
    .filter((item) => keywordCandidateUsable(item))
    .slice(0, KEYWORD_AI_MAX_CANDIDATES);
  const dropped = entries.length - candidates.length;
  const issues = dropped > 0 ? [`有 ${dropped} 条没有词条文本，已跳过`] : [];
  if (!candidates.length) return { ok: false, candidates: [], issues, message: '模型返回的候选里没有可用的词条（都是空词），请重试或换一个模型。' };
  return { ok: true, candidates, issues, message: '' };
}

// ---------------------------------------------------------------------------
// 去重 / 疑似同义 / 勾选（页面只渲染这些产物）
// ---------------------------------------------------------------------------

const bigrams = (text) => (text.length < 2 ? [text] : Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));

/**
 * 两个词的相似度（归一化后）：`same`（完全一样）/ `contains`（一个是另一个的子串）/
 * `overlap`（字面重合度高，用 Dice 系数，能抓住「均衡构图 / 构图均衡」这类语序差异）。
 * 返回 `{ score, kind }`：`score` 0 表示不提示（阈值见 `KEYWORD_AI_SYNONYM_THRESHOLD`）。
 */
export function keywordSimilarity(left, right) {
  const a = normalizeKeywordText(left);
  const b = normalizeKeywordText(right);
  if (!a || !b) return { score: 0, kind: 'none' };
  if (a === b) return { score: 1, kind: 'same' };
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length >= 2 && long.includes(short)) return { score: 0.9, kind: 'contains' };
  const left2 = bigrams(a);
  const right2 = bigrams(b);
  const setRight = new Set(right2);
  const shared = left2.filter((item) => setRight.has(item)).length;
  const dice = (2 * shared) / (left2.length + right2.length);
  if (dice >= KEYWORD_AI_SYNONYM_THRESHOLD) return { score: Number(dice.toFixed(2)), kind: 'overlap' };
  return { score: 0, kind: 'none' };
}

/** 相似度的可读说明（面板上挂在候选行后面）。 */
export function keywordSimilarityText(term, match, kind) {
  const how = kind === 'contains' ? '包含关系' : '字面高度重合';
  return `疑似同义：与已有词「${match}」${how}`;
}

/**
 * 「疑似同义」提示：拿这个词去和**模板里已有的词**逐个比（也把本次候选里更早出现的词算进去，
 * 由调用方拼好列表传进来），返回最相似的那一条或 null。
 */
export function keywordSynonymHint(term, existing = []) {
  const target = keywordCandidateTermText(term);
  if (!target) return null;
  let best = null;
  (Array.isArray(existing) ? existing : []).forEach((item) => {
    const other = str(item && typeof item === 'object' ? item.term : item);
    if (!other) return;
    const { score, kind } = keywordSimilarity(target, other);
    if (kind === 'same' || score <= 0) return;
    if (!best || score > best.score) best = { term: other, group: str(item?.group), kind, score };
  });
  if (!best) return null;
  return { ...best, text: keywordSimilarityText(target, best.term, best.kind) };
}

/**
 * 候选行（**唯一判据**：勾选可用性、标灰原因、同义提示、行读数都读它）：
 *  - `blocked` 两种（模板内已有 / 候选内重复）—— 界面标灰、不可勾、采纳时跳过；
 *  - `synonym` 只提示不拦（验收原文「由管理员决定」）。
 */
export function keywordCandidateRows(candidates = [], { existing = [] } = {}) {
  const existingRows = (Array.isArray(existing) ? existing : [])
    .map((item) => ({ term: str(item && typeof item === 'object' ? item.term : item), group: str(item?.group) }))
    .filter((item) => item.term);
  const existingKeys = new Map();
  existingRows.forEach((item) => {
    const key = normalizeKeywordText(item.term);
    if (key && !existingKeys.has(key)) existingKeys.set(key, item);
  });
  const seen = new Map();
  return (Array.isArray(candidates) ? candidates : [])
    .map((raw, index) => {
      const candidate = normalizeKeywordCandidate(raw);
      const key = `c${index}`;
      const norm = normalizeKeywordText(candidate.term);
      const existingHit = norm ? existingKeys.get(norm) : null;
      const batchHit = norm ? seen.get(norm) : null;
      let blocked = '';
      let blockText = '';
      if (!candidate.term) { blocked = 'empty'; blockText = '这一条没有词条文本，已跳过。'; }
      else if (existingHit) {
        blocked = 'existing';
        blockText = `模板内已有这个词（${existingHit.group ? `第「${existingHit.group}」组` : '已有'}）：归一化后相同，已标灰跳过。`;
      } else if (batchHit) {
        blocked = 'duplicate';
        blockText = `候选里重复出现（与第 ${batchHit + 1} 条相同）：已标灰跳过。`;
      }
      if (norm && !seen.has(norm)) seen.set(norm, index);
      // 同义比对：模板已有词 + 本次候选里更早出现的词（去重后的那一份）。
      const compare = [...existingRows, ...(Array.isArray(candidates) ? candidates.slice(0, index) : []).map((item) => normalizeKeywordCandidate(item))]
        .map((item) => ({ term: item.term, group: item.group }))
        .filter((item) => item.term && normalizeKeywordText(item.term) !== norm);
      const synonym = blocked ? null : keywordSynonymHint(candidate.term, compare);
      return {
        key,
        index,
        group: str(candidate.group) || KEYWORD_AI_GROUP_FALLBACK,
        term: candidate.term,
        reason: candidate.reason,
        norm,
        blocked: Boolean(blocked),
        blockKind: blocked,
        blockText,
        synonym,
        synonymText: synonym ? synonym.text : ''
      };
    });
}

/** 候选的计数读数（面板徽标与断言读同一份）。 */
export function keywordCandidateCounts(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    selectable: list.filter((row) => !row.blocked).length,
    existing: list.filter((row) => row.blockKind === 'existing').length,
    duplicate: list.filter((row) => row.blockKind === 'duplicate').length,
    synonym: list.filter((row) => row.synonym).length
  };
}

/** 可勾选的候选键（全选 / 按分组批量勾选都只作用于它们）。 */
export function keywordCandidateSelectableKeys(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !row.blocked).map((row) => row.key);
}

/**
 * 勾选状态的纯函数操作：`selection` 是 `{ [候选键]: true }`。
 * 默认全不选中（空对象）—— 验收原文「候选默认全不选中」。
 */
export function selectKeywordCandidates(selection, keys = [], value = true) {
  const next = { ...(selection && typeof selection === 'object' ? selection : {}) };
  (Array.isArray(keys) ? keys : []).forEach((key) => {
    if (!key) return;
    if (value) next[key] = true;
    else delete next[key];
  });
  return next;
}

/** 被勾选的候选键（按候选顺序，采纳时按这个顺序写入）。 */
export function selectedKeywordCandidateKeys(rows = [], selection = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => !row.blocked && selection && selection[row.key])
    .map((row) => row.key);
}

/** 按分组聚合的候选（「按分组批量勾选」的读数：整组是否已全选 / 部分选中）。 */
export function keywordCandidateBuckets(rows = [], selection = {}) {
  const order = [];
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const name = row.group || KEYWORD_AI_GROUP_FALLBACK;
    if (!map.has(name)) { map.set(name, { group: name, rows: [] }); order.push(name); }
    map.get(name).rows.push(row);
  });
  return order.map((name) => {
    const bucket = map.get(name);
    const keys = keywordCandidateSelectableKeys(bucket.rows);
    const selectedKeys = selectedKeywordCandidateKeys(bucket.rows, selection);
    return {
      group: name,
      rows: bucket.rows,
      total: bucket.rows.length,
      selectable: keys.length,
      keys,
      selected: selectedKeys.length,
      allSelected: keys.length > 0 && selectedKeys.length === keys.length,
      blockedText: keys.length ? '' : '这一组都是模板内已有或候选内重复的词，已全部跳过。'
    };
  });
}

// ---------------------------------------------------------------------------
// 采纳：写进草稿区（分组不存在就建组）
// ---------------------------------------------------------------------------

/**
 * 采纳选中的候选 → 新的草稿（**只动 groups**，其余字段一个字不动）。
 *  - `targetGroup` 传了具体分组名时，全部词条都写进那个分组（分组不存在就建）；
 *    不传就按候选自己的建议分组落位（空分组名回落 `KEYWORD_AI_GROUP_FALLBACK`）；
 *  - 归一化后与草稿里已有词相同的（模板里已有 / 同一批里重复 / 选中了两条同义词）
 *    一律跳过并回报 —— 采纳永远不该把重复词写进闸门；
 *  - 每组的词条数不超过 `KEYWORD_TEMPLATE_TERMS_PER_GROUP_LIMIT`，超出的跳过并回报。
 * 返回 `{ draft, added, skipped, groupsCreated, reportText }`。
 */
export function keywordCandidateAdopt(draft, rows = [], selection = {}, { targetGroup = '' } = {}) {
  if (!draft) return { draft, added: [], skipped: [], groupsCreated: [], reportText: '没有正在编辑的模板，未做任何改动。' };
  const keys = selectedKeywordCandidateKeys(rows, selection);
  const picked = (Array.isArray(rows) ? rows : []).filter((row) => keys.includes(row.key));
  const target = str(targetGroup);
  let groups = keywordTemplateEditGroups(draft).map((group) => ({ ...group, terms: group.terms.map((term) => ({ ...term })) }));
  const added = [];
  const skipped = [];
  const groupsCreated = [];
  const keyOf = (name) => normalizeKeywordText(name);
  picked.forEach((row) => {
    const groupName = target || row.group || KEYWORD_AI_GROUP_FALLBACK;
    // 先按原样比组名；比不到再按归一化组名比（「色彩感受」与「色彩感受 」算同一组）。
    let index = groups.findIndex((group) => group.name === groupName);
    if (index < 0) index = groups.findIndex((group) => keyOf(group.name) === keyOf(groupName));
    if (index < 0) {
      groups.push({ name: groupName, enabled: true, sortOrder: (groups.length + 1) * 10, terms: [] });
      groupsCreated.push(groupName);
      index = groups.length - 1;
    }
    const group = groups[index];
    const norm = normalizeKeywordText(row.term);
    const clash = group.terms.some((term) => normalizeKeywordText(term.term) === norm)
      || groups.some((other, otherIndex) => otherIndex !== index && other.terms.some((term) => normalizeKeywordText(term.term) === norm));
    if (!row.term) { skipped.push({ term: row.term, group: groupName, reason: '词条为空' }); return; }
    if (clash) { skipped.push({ term: row.term, group: groupName, reason: '草稿里已有同一个词（归一化后相同）' }); return; }
    if (group.terms.length >= KEYWORD_TEMPLATE_TERMS_PER_GROUP_LIMIT) {
      skipped.push({ term: row.term, group: groupName, reason: `分组「${groupName}」已达上限 ${KEYWORD_TEMPLATE_TERMS_PER_GROUP_LIMIT} 个` });
      return;
    }
    group.terms.push({ term: row.term, enabled: true, sortOrder: (group.terms.length + 1) * 10 });
    added.push({ term: row.term, group: groupName });
  });
  const nextDraft = { ...draft, groups: resequenceKeywordGroups(groups) };
  const head = `已采纳 ${added.length} 条写进草稿${added.length ? `：${added.map((item) => item.term).join(' / ')}` : ''}`;
  const tail = skipped.length ? `；有 ${skipped.length} 条跳过（${skipped[0].term || '空词'}：${skipped[0].reason}${skipped.length > 1 ? ' …' : ''}）` : '';
  const created = groupsCreated.length ? `；新建分组 ${groupsCreated.join(' / ')}` : '';
  const reportText = added.length || skipped.length
    ? `${head}${created}${tail}。保存后模板 version 才会自增。`
    : '一条都没选中：先勾选要采纳的候选（候选默认全不选中）。';
  return { draft: nextDraft, added, skipped, groupsCreated, reportText };
}

/** 「丢弃候选」的读数（界面回执与审计 detail 共用）。 */
export function keywordCandidateDiscardText(rows = [], selection = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const selected = selectedKeywordCandidateKeys(list, selection).length;
  return `丢弃 ${list.length} 条候选（其中已勾选 ${selected} 条未采纳）`; 
}

// ---------------------------------------------------------------------------
// 审计留痕：候选 / 采纳 / 丢弃三条 detail 文案（动作键在 data/auditLog.js）
// ---------------------------------------------------------------------------

/** 候选生成的回执文案（面板回执 + 审计 detail 共用一份）。 */
export function keywordAiGenerateText({ model = '', count = 0, fallbackNote = '' } = {}) {
  return `模型 ${model || '未注明'} 生成 ${count} 条候选${fallbackNote ? `（${fallbackNote}）` : ''}`;
}

/** 列表截断：`a / b / c …等 N 个`（审计 detail 有 240 字上限，绝不静默截断）。 */
function listText(values = [], limit = 12) {
  const list = (Array.isArray(values) ? values : []).map((item) => str(item)).filter(Boolean);
  if (list.length <= limit) return list.join(' / ');
  return `${list.slice(0, limit).join(' / ')} …等 ${list.length} 个`;
}

/**
 * 三条审计日志的 detail（唯一真源：面板回执、审计列表与断言读同一份）。
 * `kind`：`generate`（谁什么时候按什么上下文要了多少候选、拿到几条、用的哪个模型）
 * / `adopt`（采纳了哪些词、进了哪个分组）/ `discard`（丢弃了多少条）。
 */
export function keywordAiAuditDetail(kind, payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (kind === 'generate') {
    const head = `${KEYWORD_AI_CHANNEL.label} · ${keywordAiContextText(source.context)}`;
    return `${head} → ${keywordAiGenerateText(source)}`;
  }
  if (kind === 'adopt') {
    const added = (Array.isArray(source.added) ? source.added : []).map((item) => item.term);
    const created = (Array.isArray(source.groupsCreated) ? source.groupsCreated : []).length
      ? `；新建分组 ${source.groupsCreated.join(' / ')}`
      : '';
    const skippedText = (Array.isArray(source.skipped) ? source.skipped : []).length
      ? `；跳过 ${source.skipped.length} 条（${source.skipped[0].term || '空词'}：${source.skipped[0].reason}）`
      : '';
    return `采纳 ${added.length} 个词：${listText(added)}${created}${skippedText}`;
  }
  if (kind === 'discard') {
    return keywordCandidateDiscardText(source.rows, source.selection);
  }
  return '';
}

/** 面板上「AI 补充留痕」一行的可读文案（时间 / 操作人 / 动作 / detail）。 */
export function keywordAiTrailRowText(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  return [str(source.at), str(source.actorName || source.actorId), str(source.actionLabel), str(source.detail)].filter(Boolean).join(' · ');
}
