// 提示词模块目录（US-101 / F-REVIEW-PROMPT-01）
//
// system 提示词被拆成「有名字、有版本、有来源、有字符数」的段落：
// 「加载了哪些提示词」的展示（US-103 的提示词查看器）、轨迹留档（US-102 的 loaded.modules）
// 与拼接本身都读这一份。**模块名的唯一真源是 PROMPT_MODULE_DEFS**，
// 不要在 llmReview 或界面里另写一套模块名/顺序。
//
// 三条硬约定：
//  1. **目录顺序 = 老师人设分支的拼装顺序**（也等于「加载清单」的展示顺序）：
//     base_role → identity → beliefs → tone → boundaries → agent_md → skills → memory
//     → task → keyword_candidates → writing_rules → keyword_rules → output_format → subject。
//     它对应 US-105 的加载顺序（agent.md → 技能 → 记忆 → 观察词候选 → 写作与输出）。
//  2. **没有老师人设时的兜底分支沿用历史顺序**（PROMPT_MODULE_ORDER_FALLBACK）：
//     它是老调用方的逐字符兼容承诺（US-101 验收：改造前后 system 字符串逐字符一致），
//     不要为了「顺序统一」去改它。
//  3. **没进入本次提示词的模块也留在 modules 数组里**（`included: false`、`content: ''`），
//     排在参与拼接的模块之后 —— 界面才能说明「这个模块为什么没加载」；
//     拼装与字符数统计只取 `included` 的那些（`assemblePromptText`）。
//
// 零依赖纯模块（不 import 任何东西），可以直接 `node` 跑断言（见 prototype/AGENTS.md）。
// 改任何一个模块的正文都要**同时抬高它的 version**：轨迹留档靠版本复现「当时用的是哪一版」。

/** 目录里的模块顺序就是老师人设分支的拼装顺序（同一份，不要另开一个常量）。 */
export const PROMPT_MODULE_DEFS = [
  { id: 'base_role', title: '基础角色', source: '内置兜底', version: 'v1' },
  { id: 'identity', title: '身份', source: '老师人设', version: 'v1' },
  { id: 'beliefs', title: '教学信念', source: '老师人设', version: 'v1' },
  { id: 'tone', title: '说话风格', source: '老师人设', version: 'v1' },
  { id: 'boundaries', title: '安全与伦理边界', source: '老师人设', version: 'v1' },
  { id: 'agent_md', title: 'agent.md 指令', source: 'agent.md', version: 'v1' },
  { id: 'skills', title: '已启用技能', source: '技能库', version: 'v1' },
  { id: 'memory', title: '长期记忆', source: '老师人设', version: 'v1' },
  { id: 'task', title: '本次任务', source: '内置任务模板', version: 'v1' },
  { id: 'keyword_candidates', title: '观察词候选清单', source: '观察词模板', version: 'v1' },
  { id: 'writing_rules', title: '写作要求', source: '内置写作规则', version: 'v1' },
  { id: 'keyword_rules', title: '观察词选择要求', source: '内置选择规则', version: 'v1' },
  { id: 'output_format', title: '输出格式', source: '内置输出格式', version: 'v1' },
  { id: 'subject', title: '本次课题', source: '课次课题', version: 'v1' }
];

export const PROMPT_MODULE_IDS = PROMPT_MODULE_DEFS.map((def) => def.id);

/**
 * 兜底分支（没有老师人设）的拼装顺序 —— **历史顺序，别改**：
 * 旧实现先给基础角色与写作要求，再接观察词候选/选择要求，最后是输出格式。
 */
export const PROMPT_MODULE_ORDER_FALLBACK = ['base_role', 'writing_rules', 'keyword_candidates', 'keyword_rules', 'output_format'];

/** 模块之间的分隔符：与改造前 `parts.join('\n\n')` 逐字符一致。 */
export const PROMPT_MODULE_SEPARATOR = '\n\n';

export function promptModuleDef(id) {
  return PROMPT_MODULE_DEFS.find((def) => def.id === id) || null;
}

/** 字符数口径（唯一真源）：按 JS 字符串长度算，与界面展示的「字符数」一致。 */
export function promptModuleChars(content) {
  return String(content ?? '').length;
}

/**
 * 造一个模块。`id` 必须登记在 PROMPT_MODULE_DEFS 里（拼装顺序按目录走，
 * 未登记的 id 会让提示词悄悄少一段，所以这里直接报错而不是静默兜底）。
 * `content` 传对象时可覆盖 title / version / source —— agent.md 与记忆文件的版本由它们自己带（US-105）。
 */
export function createPromptModule(id, content = '', meta = {}) {
  const def = promptModuleDef(id);
  if (!def) throw new Error(`未登记的提示词模块：${id}`);
  const raw = content && typeof content === 'object' ? content : { content };
  const text = String(raw.content ?? '');
  return {
    id,
    title: raw.title || meta.title || def.title,
    content: text,
    version: raw.version || meta.version || def.version,
    source: raw.source || meta.source || def.source,
    chars: promptModuleChars(text),
    included: Boolean(text.trim())
  };
}

/**
 * 把「模块内容表」（id → 字符串或 { content, title, version, source }）按顺序拼成
 * `{ system, modules }`：参与拼接的模块按 `order` 排列，目录里其余模块补在数组尾部（included:false）。
 * 同样的输入永远得到逐字符相同的 system 字符串与逐字段相同的 modules 数组。
 */
export function composePromptModules(contents = {}, order = PROMPT_MODULE_IDS) {
  const included = [];
  const placed = new Set();
  for (const id of order) {
    if (contents[id] === undefined || contents[id] === null) continue;
    included.push(createPromptModule(id, contents[id]));
    placed.add(id);
  }
  const rest = PROMPT_MODULE_DEFS
    .filter((def) => !placed.has(def.id))
    .map((def) => createPromptModule(def.id, ''));
  const modules = [...included, ...rest];
  return { system: assemblePromptText(modules), modules };
}

/** 把 included 的模块按数组顺序拼回 system 字符串（跳过没进入提示词的模块）。 */
export function assemblePromptText(modules = []) {
  return (Array.isArray(modules) ? modules : [])
    .filter((item) => item && item.included)
    .map((item) => item.content)
    .join(PROMPT_MODULE_SEPARATOR);
}

/** 目录里有、但这份 modules 里没有的模块 id（验收用：模块 id 覆盖全部 14 个）。 */
export function promptModuleMissingIds(modules = []) {
  const seen = new Set((Array.isArray(modules) ? modules : []).map((item) => item?.id));
  return PROMPT_MODULE_IDS.filter((id) => !seen.has(id));
}

/** 折叠态摘要用的派生值：本次真正进入提示词的模块数，与 system 提示词的字符数（含模块之间的空行）。 */
export function promptModuleSummary(modules = []) {
  const list = (Array.isArray(modules) ? modules : []).filter((item) => item?.included);
  return {
    total: Array.isArray(modules) ? modules.length : 0,
    included: list.length,
    chars: assemblePromptText(modules).length,
    titles: list.map((item) => item.title)
  };
}
