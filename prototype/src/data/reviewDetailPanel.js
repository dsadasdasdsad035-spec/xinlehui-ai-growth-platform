// 本次点评详情面板（[第三步 US-103a] / F-REVIEW-TRACE-02）的折叠态与实时状态。
//
// 面板的三件事全部收在这一份零依赖纯模块里，**界面与验证脚本共用同一套口径**
// （不要在组件里另写一遍字符串拼接，否则「折叠态摘要」会在两处各长一个样）：
//  1. 折叠态那一行摘要：`已加载 agent.md v1 · 5 项技能 · 1 个记忆文件 · 观察词模板 v1 ·
//     模型 glm-5.3-flash · 已用时 12.3 秒`（加载了什么 + 用了哪个模型 + 花了多久）；
//  2. 生成中的实时状态：已用时、思考字数、正文进度（五维里已经落笔的维度数与正文字数）；
//  3. 正文进度解析：从流式半成品 JSON 里按维度读出「写到第几维、写了多少字」。
//
// 零依赖（不 import 任何模块、不碰 DOM），可以直接用 Node 跑断言（见 prototype/AGENTS.md）。

/** 面板阶段（与 `main.jsx` 的 `reviewStream.phase`、`reviewTrace` 的状态同一套词汇）。 */
export const REVIEW_DETAIL_PHASES = {
  idle: 'idle',
  running: 'running',
  done: 'done',
  error: 'error',
  stopped: 'stopped'
};

export const REVIEW_DETAIL_PHASE_LABELS = {
  idle: '待生成',
  running: '生成中',
  done: '已生成',
  error: '生成失败',
  stopped: '已停止'
};

/**
 * 五个维度的名字 —— **唯一真源**。
 * `services/llmReview.js` 的维度清单（提示词里的写作要求与输出格式、解析用的键序）
 * 与面板的正文进度都读这一份：模型写下的键名换了，进度统计必须跟着换，不能各算一套。
 */
export const REVIEW_DIMENSION_NAMES = ['美术能力', '上课状态', '行为能力', '内在状态', '家长建议'];

/** 每维的目标字数（提示词里写的是 60-150 字）：进度条按「每维最多计满一格」推进。 */
export const REVIEW_DIMENSION_TARGET_CHARS = 110;

export function reviewDetailPhaseLabel(phase) {
  return REVIEW_DETAIL_PHASE_LABELS[phase] || REVIEW_DETAIL_PHASE_LABELS.idle;
}

export function reviewDetailToggleLabel(open) {
  return open ? '收起' : '展开';
}

const str = (value) => (value === null || value === undefined ? '' : String(value));
const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const clamp01 = (value) => Math.min(1, Math.max(0, num(value)));

/** 毫秒 → 「12.3 秒」：折叠态摘要与实时状态都用这一种写法。 */
export function reviewDetailElapsedText(ms) {
  return `${(Math.max(0, num(ms)) / 1000).toFixed(1)} 秒`;
}

/**
 * 正文进度：从流式半成品 JSON 里按维度读出「写到第几维、写了多少字」。
 * 维度键已经出现但字符串还没闭合时（流中）同样算「已落笔」，字数是已经收到的部分。
 * 返回 `{ total, done, complete, chars, ratio, dimensions }`：
 *  - `done` = 已经落笔的维度数（含正在写的那一维），面板上就是 `2/5 维`；
 *  - `complete` = 已闭合的维度数；
 *  - `ratio` = 进度条用的 0~1：写完的维度各占满一格，正在写的那一维按字数补到不足一格，
 *    因此「5/5 维」与「进度条满格」永远同时成立（写作中途也是单调不减）。
 */
const closedValuePattern = (name) => new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
const openValuePattern = (name) => new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)$`);

export function reviewContentProgress(raw, dimensions = REVIEW_DIMENSION_NAMES) {
  const text = str(raw);
  const names = Array.isArray(dimensions) && dimensions.length ? dimensions : REVIEW_DIMENSION_NAMES;
  const list = names.map((name) => {
    const closed = text.match(closedValuePattern(name));
    const open = closed ? null : text.match(openValuePattern(name));
    const value = closed ? closed[1] : open ? open[1] : '';
    return { name, chars: value.length, started: Boolean(closed || open), complete: Boolean(closed) };
  });
  const done = list.filter((item) => item.started).length;
  const complete = list.filter((item) => item.complete).length;
  const chars = list.reduce((sum, item) => sum + item.chars, 0);
  const writing = list.find((item) => item.started && !item.complete) || null;
  const tail = writing ? Math.min(1, writing.chars / REVIEW_DIMENSION_TARGET_CHARS) : 0;
  return {
    total: names.length,
    done,
    complete,
    chars,
    ratio: names.length ? Math.min(1, (complete + tail) / names.length) : 0,
    dimensions: list
  };
}

/**
 * 折叠态摘要里的「加载了什么」：本次真正进入 system 提示词的东西。
 * 输入就是提示词拼装处用的那几份数据（模块清单来自 `buildPersonaPrompt().modules`）：
 *  - `modules` —— 提示词模块清单（agent.md 与观察词模板的 version / chars 从里面取）
 *  - `skills` —— 已启用技能（`resolveSkills()` 的结果）
 *  - `memory` —— 长期记忆正文（当前一位老师是一段记忆，US-105 起是文件列表）
 *  - `keywordTerms` / `keywordGroups` —— 观察词模板的词条数与分组数
 * 返回 `{ items, counts }`：`items` 是全量清单（每项带 `included` 与没加载的原因，
 * US-103b 的加载清单直接渲染它），`counts` 是面板与断言用的计数。
 */
export function reviewDetailLoaded({ modules = [], skills = [], memory = '', keywordTerms = 0, keywordGroups = 0 } = {}) {
  const moduleList = (Array.isArray(modules) ? modules : []).map((module) => {
    const source = module && typeof module === 'object' ? module : {};
    const content = str(source.content);
    return {
      id: str(source.id),
      title: str(source.title),
      version: str(source.version),
      source: str(source.source),
      chars: num(source.chars) || content.length,
      included: source.included === undefined ? Boolean(content.trim()) : Boolean(source.included)
    };
  });
  const agentModule = moduleList.find((module) => module.id === 'agent_md') || null;
  const keywordModule = moduleList.find((module) => module.id === 'keyword_candidates') || null;
  const skillList = (Array.isArray(skills) ? skills : []).filter(Boolean);
  const memoryFiles = str(memory).trim() ? 1 : 0;
  const includedModules = moduleList.filter((module) => module.included).length;
  const items = [
    {
      key: 'agent_md',
      label: 'agent.md',
      kind: 'file',
      version: agentModule?.version || '',
      chars: agentModule?.chars || 0,
      included: Boolean(agentModule?.included),
      reason: agentModule?.included ? '' : '本次没有加载 agent.md'
    },
    {
      key: 'skills',
      label: '技能',
      kind: 'skills',
      count: skillList.length,
      chars: skillList.reduce((sum, skill) => sum + str(skill.description).length, 0),
      included: skillList.length > 0,
      reason: skillList.length ? '' : '本次未启用任何技能'
    },
    {
      key: 'memory',
      label: '记忆文件',
      kind: 'files',
      count: memoryFiles,
      chars: str(memory).length,
      included: memoryFiles > 0,
      reason: memoryFiles ? '' : '本次没有可加载的长期记忆'
    },
    {
      key: 'keyword_template',
      label: '观察词模板',
      kind: 'template',
      version: keywordModule?.version || '',
      chars: keywordModule?.chars || 0,
      count: num(keywordTerms),
      groups: num(keywordGroups),
      included: Boolean(keywordModule?.included),
      reason: keywordModule?.included ? '' : '本次没有加载观察词候选清单'
    },
    {
      key: 'modules',
      label: '提示词模块',
      kind: 'modules',
      count: includedModules,
      total: moduleList.length,
      chars: moduleList.filter((module) => module.included).reduce((sum, module) => sum + module.chars, 0),
      included: includedModules > 0,
      reason: includedModules ? '' : '本次没有拼装任何提示词模块'
    }
  ];
  return {
    items,
    counts: {
      modules: moduleList.length,
      includedModules,
      skills: skillList.length,
      memoryFiles,
      keywordTerms: num(keywordTerms),
      keywordGroups: num(keywordGroups),
      chars: items.find((item) => item.key === 'modules')?.chars || 0
    }
  };
}

/**
 * 摘要里的「加载了什么」段（只写真正加载了的项；一项都没有时返回空数组）。
 * 例：`['agent.md v1', '5 项技能', '1 个记忆文件', '观察词模板 v1']`。
 * 提示词模块总数不进摘要（14 项太长），它只出现在展开后的加载清单里。
 */
export function reviewDetailLoadedSegments(loaded) {
  const items = loaded && Array.isArray(loaded.items) ? loaded.items : [];
  const segments = [];
  items.forEach((item) => {
    if (!item?.included) return;
    if (item.kind === 'file') segments.push(`${item.label}${item.version ? ` ${item.version}` : ''}`);
    else if (item.kind === 'skills') segments.push(`${item.count} 项技能`);
    else if (item.kind === 'files') segments.push(`${item.count} 个记忆文件`);
    else if (item.kind === 'template') segments.push(`${item.label}${item.version ? ` ${item.version}` : ''}`);
  });
  return segments;
}

/** 摘要里的「加载了什么」整段文本（含「已加载」前缀）。 */
export function reviewDetailLoadedText(loaded) {
  const segments = reviewDetailLoadedSegments(loaded);
  return segments.length ? `已加载 ${segments.join(' · ')}` : '';
}

/**
 * 折叠态那一行摘要 —— 面板唯一的一行文本。
 *  - 生成中：`已用时 12.3 秒 · 思考 480 字 · 正文 2/5 维 · 312 字`
 *  - 已生成：`共 19.8 秒 · 思考 1200 字 · 正文 5/5 维 · 620 字`
 *  - 失败 / 停止：保留已用时与增量读数，另接失败原因 / 停止文案
 * 前面两段固定是「加载了什么」与「模型」，与 PRD 的示例口径一致。
 */
export function reviewDetailSummary({ loaded = null, model = '', phase = REVIEW_DETAIL_PHASES.idle, elapsedMs = 0, reasoningChars = 0, content = '', message = '' } = {}) {
  const running = phase === REVIEW_DETAIL_PHASES.running;
  const progress = reviewContentProgress(content);
  const chunks = [];
  const loadedText = reviewDetailLoadedText(loaded);
  if (loadedText) chunks.push(loadedText);
  if (model) chunks.push(`模型 ${model}`);
  if (running) chunks.push(`已用时 ${reviewDetailElapsedText(elapsedMs)}`);
  else if (phase !== REVIEW_DETAIL_PHASES.idle) chunks.push(`共 ${reviewDetailElapsedText(elapsedMs)}`);
  const reasoningCount = Math.max(0, num(reasoningChars));
  if (reasoningCount || running) chunks.push(`思考 ${reasoningCount} 字`);
  if (progress.done || progress.chars || running) chunks.push(`正文 ${progress.done}/${progress.total} 维 · ${progress.chars} 字`);
  if (phase === REVIEW_DETAIL_PHASES.error && message) chunks.push(`生成失败：${message}`);
  if (phase === REVIEW_DETAIL_PHASES.stopped) chunks.push(message || '已停止生成');
  return chunks.join(' · ');
}

/** 展开态「推理过程」为空时的占位文案（生成中与生成后两种口径）。 */
export function reviewDetailReasoningPlaceholder(phase) {
  if (phase === REVIEW_DETAIL_PHASES.running) return '模型正在读出画面与素材，思考增量会逐字出现在这里…';
  if (phase === REVIEW_DETAIL_PHASES.error) return '生成失败前没有收到推理增量。';
  if (phase === REVIEW_DETAIL_PHASES.stopped) return '老师停止生成前没有收到推理增量。';
  return '本次生成没有返回推理增量。';
}
