// 本次点评详情面板（[第三步 US-103a] / F-REVIEW-TRACE-02）的折叠态与实时状态。
//
// 面板的三件事全部收在这一份零依赖纯模块里，**界面与验证脚本共用同一套口径**
// （不要在组件里另写一遍字符串拼接，否则「折叠态摘要」会在两处各长一个样）：
//  1. 折叠态那一行摘要：`已加载 agent.md v1 · 5 项技能 · 1 个记忆文件 · 观察词模板 v1 ·
//     模型 glm-5.3-flash · 已用时 12.3 秒`（加载了什么 + 用了哪个模型 + 花了多久）；
//  2. 生成中的实时状态：已用时、思考字数、正文进度（五维里已经落笔的维度数与正文字数）；
//  3. 正文进度解析：从流式半成品 JSON 里按维度读出「写到第几维、写了多少字」。
//
// 展开态的六个分区、导出文本与折叠态摘要读的是同一份数据口径（US-103b），
// 三个「格式」类文案不在这里另写一套：
//  - 素材体积（`860 KB` / `1.2 MB`）复用 `data/artworkExport.js` 的 `artworkExportSizeText`；
//  - 时长（`1.2 秒` / `860 毫秒`）与素材正文守卫复用 `data/reviewTrace.js` 的同名函数（轨迹的唯一真源）；
//  - 文件名（非法字符 / 课次日期）复用 `data/artworkExport.js`（与「保存图片」同一个文件名口径）。
// 本模块仍然不碰 DOM、不发请求，可以直接用 Node 跑断言（见 prototype/AGENTS.md）。
import { artworkExportDateText, artworkExportSizeText, sanitizeArtworkExportSegment } from './artworkExport';
import { reviewTraceMediaViolations, reviewTraceSecondsText } from './reviewTrace';
// 逐项技能清单（US-104）：技能行的构造器与「一项都没启用」的文案来自技能库那一份唯一真源，
// 面板与导出都渲染它的产物（`skillLoadout()` 的 rows），不在这里另写一套。
import { SKILL_EMPTY_TEXT, SKILL_LOAD_REASON_KEYS, skillLoadRow } from './skillLibrary';
// agent.md / 记忆文件清单（US-105）：行文案与版本口径同样来自那一份唯一真源
// （`agentFileLoadout()` 的 rows），面板、导出与断言读同一份。
import {
  AGENT_FILE_CHAR_LIMIT,
  AGENT_FILE_KIND_LABELS,
  AGENT_FILE_SCOPE_LABELS,
  agentFileSummaryText,
  agentFileVersionText
} from './agentFiles';

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
 * 逐项技能清单的归一（US-104）：`skills` 传**技能加载清单**（`skillLoadout()` 的产物，
 * 那次计算同时产出了提示词里的【已启用技能】段落）时用它的 `rows`；
 * 传已经解析好的技能数组（老调用方 / 断言夹具）时按「已加载」逐项构造。
 * 两种数组都可能出现，所以数组分支要**先认已有的 reasonKey / included**，不能一律当成已加载。
 */
export function reviewDetailSkillRows(skills) {
  const reasonOf = (skill) => skill.reasonKey
    || (skill.included === false ? SKILL_LOAD_REASON_KEYS.notSelected : SKILL_LOAD_REASON_KEYS.included);
  if (Array.isArray(skills)) {
    return skills.filter(Boolean).map((skill) => skillLoadRow(skill, { reasonKey: reasonOf(skill) }));
  }
  const rows = skills && typeof skills === 'object' && Array.isArray(skills.rows) ? skills.rows : [];
  return rows.filter(Boolean).map((row) => skillLoadRow(row, { reasonKey: reasonOf(row) }));
}

/**
 * agent.md / 记忆文件的逐项清单（US-105）：`agentFiles` 传 `agentFileLoadout()` 的产物时用它的 `rows`；
 * 传已经归一好的行数组（轨迹留档 / 断言夹具）时按同一形状读出。
 * 只有**已加载**的行写版本 / 字符数 / hash（与技能清单同一条纪律：没加载的数字与「没进去」矛盾）。
 */
export function reviewDetailAgentFileRows(agentFiles) {
  const rows = Array.isArray(agentFiles)
    ? agentFiles
    : (agentFiles && typeof agentFiles === 'object' && Array.isArray(agentFiles.rows) ? agentFiles.rows : []);
  return rows.filter(Boolean).map((entry) => {
    const source = entry && typeof entry === 'object' ? entry : {};
    const kind = str(source.kind);
    const included = Boolean(source.included);
    const chars = Math.max(0, num(source.chars));
    const includedChars = Math.max(0, num(source.includedChars));
    const truncated = Boolean(source.truncated);
    const kindLabel = str(source.kindLabel) || AGENT_FILE_KIND_LABELS[kind] || 'agent 文件';
    const scopeLabel = str(source.scopeLabel) || AGENT_FILE_SCOPE_LABELS[str(source.scope)] || '';
    const versionText = str(source.versionText) || agentFileVersionText(source);
    const hash = str(source.hash);
    const name = str(source.name) || str(source.fileId) || '未命名文件';
    const reason = str(source.reason);
    const detail = included
      ? [
        kindLabel,
        scopeLabel,
        versionText,
        truncated ? `${includedChars}/${chars} 字（截断）` : `${chars} 字`,
        hash ? `sha256 ${hash}` : ''
      ].filter(Boolean).join(' · ')
      : kindLabel;
    const truncatedText = truncated ? `；已按总上限截断在 ${Math.max(0, num(source.truncatedAt))} 字` : '';
    return {
      fileId: str(source.fileId || source.id),
      kind,
      kindLabel,
      scope: str(source.scope),
      scopeLabel,
      name,
      version: included ? str(source.version) : '',
      versionText,
      chars,
      includedChars,
      hash,
      included,
      truncated,
      truncatedAt: Math.max(0, num(source.truncatedAt)),
      reasonKey: str(source.reasonKey) || (included ? 'included' : ''),
      reason,
      // 正文只在已加载的行上（停用 / 超限的文件不进新轨迹，也不给面板正文）。
      body: included && typeof source.body === 'string' ? source.body : '',
      // 两段行内文案也在这里定好：面板不自己拼字符串（含嵌套模板字符串，JSX 里写会打断解析）。
      stateText: included ? `[已加载]${truncated ? ` 已按总上限截断在 ${Math.max(0, num(source.truncatedAt))} 字` : ''}` : `[未加载] ${reason}`,
      bodyNote: included
        ? `该文件进入提示词的正文（版本 ${versionText}${truncatedText}）：`
        : `未进入本次提示词：${reason}。停用或超限的正文不写进新轨迹，历史轨迹仍可用当时的留档复现。`,
      detail,
      text: `${included ? '[已加载]' : '[未加载]'} ${name}${detail ? ` · ${detail}` : ''}${!included && reason ? ` —— ${reason}` : ''}`
    };
  });
}

/**
 * 加载预算的读数（US-105）：文件总量上限、截断位置与「同样版本 → 同样提示词」的指纹。
 * 优先读 `agentFileLoadout()` 的 `summary`，没有时按同一份字段读（轨迹里的摘要是同一形状）。
 */
export function reviewDetailAgentFileSummary(agentFiles) {
  const source = agentFiles && typeof agentFiles === 'object' && !Array.isArray(agentFiles) ? agentFiles : {};
  const summary = source.summary && typeof source.summary === 'object' ? source.summary : source;
  const limit = num(summary.limit) ?? AGENT_FILE_CHAR_LIMIT;
  const truncated = Boolean(summary.truncated);
  const loadOrder = (Array.isArray(summary.loadOrder) ? summary.loadOrder : []).map((item) => str(item)).filter(Boolean);
  // 顺序文案优先用人类可读的标签（轨迹里的摘要是同一形状；只有 key 时回落 key）。
  const loadOrderLabels = (Array.isArray(summary.loadOrderLabels) ? summary.loadOrderLabels : []).map((item) => str(item)).filter(Boolean);
  return {
    loadOrder,
    loadOrderLabels: loadOrderLabels.length ? loadOrderLabels : loadOrder,
    limit,
    perLevel: num(summary.perLevel) ?? 0,
    chars: num(summary.chars) ?? 0,
    fullChars: num(summary.fullChars) ?? 0,
    includedFiles: num(summary.includedFiles) ?? 0,
    truncated,
    truncatedAt: num(summary.truncatedAt) ?? 0,
    droppedChars: num(summary.droppedChars) ?? 0,
    loadoutHash: str(summary.loadoutHash),
    versionSet: (Array.isArray(summary.versionSet) ? summary.versionSet : []).map((item) => str(item)).filter(Boolean),
    truncation: summary.truncation && typeof summary.truncation === 'object' ? summary.truncation : null,
    text: agentFileSummaryText(source.counts ? source : summary)
  };
}

/**
 * 折叠态摘要里的「加载了什么」：本次真正进入 system 提示词的东西。
 * 输入就是提示词拼装处用的那几份数据（模块清单来自 `buildPersonaPrompt().modules`）：
 *  - `modules` —— 提示词模块清单（观察词模板的 version / chars 从里面取）
 *  - `skills` —— **技能加载清单**（US-104：`skillLoadout()` 的产物；也接受已解析的技能数组）
 *  - `agentFiles` —— **agent 文件加载清单**（US-105：`agentFileLoadout()` 的产物；也接受行数组）：
 *    `agent_md` 与 `memory` 两项的计数 / 字符数 / 逐项清单都读它（只传 `memory` 字符串时走旧口径）
 *  - `memory` —— 长期记忆正文（旧口径的一位老师一段记忆；传了 `agentFiles` 就由记忆文件接管）
 *  - `keywordTerms` / `keywordGroups` —— 观察词模板的词条数与分组数
 * 返回 `{ items, counts, agentFiles }`：`items` 是全量清单（每项带 `included` 与没加载的原因，
 * US-103b 的加载清单直接渲染它；`skills` 与 `agent_md` / `memory` 三项另带逐项 `rows`），
 * `counts` 是面板与断言用的计数，`agentFiles` 是逐项行 + 预算读数的挂载点（导出与断言读它）。
 */
export function reviewDetailLoaded({ modules = [], skills = [], memory = '', agentFiles = null, keywordTerms = 0, keywordGroups = 0 } = {}) {
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
  const skillRows = reviewDetailSkillRows(skills);
  const includedSkills = skillRows.filter((row) => row.included);
  const agentFileRows = reviewDetailAgentFileRows(agentFiles);
  const agentMdRows = agentFileRows.filter((row) => row.kind === 'agent-md');
  const memoryRows = agentFileRows.filter((row) => row.kind === 'memory');
  const loadedAgentMd = agentMdRows.filter((row) => row.included);
  const loadedMemory = memoryRows.filter((row) => row.included);
  const legacyMemoryChars = str(memory).length;
  const memoryFiles = memoryRows.length ? loadedMemory.length : (legacyMemoryChars ? 1 : 0);
  const includedModules = moduleList.filter((module) => module.included).length;
  const items = [
    agentMdRows.length
      ? {
        key: 'agent_md',
        label: 'agent.md',
        kind: 'file',
        version: loadedAgentMd.length === 1 ? loadedAgentMd[0].versionText : (loadedAgentMd.length ? `${loadedAgentMd.length} 个文件` : ''),
        chars: loadedAgentMd.reduce((sum, row) => sum + row.includedChars, 0),
        count: loadedAgentMd.length,
        total: agentMdRows.length,
        included: loadedAgentMd.length > 0,
        reason: loadedAgentMd.length ? '' : '本次没有加载 agent.md',
        // 逐项文件行（US-105）：三层 agent.md 一条一行（含未加载原因）。
        rows: agentMdRows
      }
      : {
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
      count: includedSkills.length,
      total: skillRows.length,
      chars: includedSkills.reduce((sum, row) => sum + row.chars, 0),
      included: includedSkills.length > 0,
      reason: includedSkills.length ? '' : SKILL_EMPTY_TEXT,
      // 逐项技能行（US-104）：全部技能 + 是否加载 + 没加载的原因 + 进入提示词的原文片段。
      rows: skillRows
    },
    memoryRows.length
      ? {
        key: 'memory',
        label: '记忆文件',
        kind: 'files',
        count: loadedMemory.length,
        total: memoryRows.length,
        chars: loadedMemory.reduce((sum, row) => sum + row.includedChars, 0),
        included: loadedMemory.length > 0,
        // 候选里有、但一个都没加载上（全被停用 / 超限）：点名「没有可加载的」，不是空白。
        reason: loadedMemory.length ? '' : '本次没有可加载的记忆文件',
        // 逐项记忆文件行（US-105）：学员 > 班级 > 机构 一条一行（含未加载原因）。
        rows: memoryRows
      }
      : {
        key: 'memory',
        label: '记忆文件',
        kind: 'files',
        count: memoryFiles,
        chars: legacyMemoryChars,
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
      skills: includedSkills.length,
      skillTotal: skillRows.length,
      memoryFiles,
      memoryTotal: memoryRows.length,
      agentFiles: agentFileRows.length,
      agentMdFiles: loadedAgentMd.length,
      agentMdTotal: agentMdRows.length,
      keywordTerms: num(keywordTerms),
      keywordGroups: num(keywordGroups),
      chars: items.find((item) => item.key === 'modules')?.chars || 0
    },
    // agent 文件的逐项行 + 预算读数（US-105）：导出载荷、面板与断言读同一份。
    agentFiles: agentFileRows.length
      ? {
        rows: agentFileRows,
        summary: reviewDetailAgentFileSummary(agentFiles),
        note: agentFileSummaryText(agentFiles)
      }
      : { rows: [], summary: reviewDetailAgentFileSummary(null), note: '' }
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

// ---------------------------------------------------------------------------
// 展开态：六个分区（[第三步 US-103b] / FR-110）
// ---------------------------------------------------------------------------

/** 六个分区的键与标题 —— 界面顺序与导出文本顺序都读这一份（不要在组件里另写一遍）。 */
export const REVIEW_DETAIL_SECTIONS = [
  { key: 'reasoning', title: '推理过程' },
  { key: 'loaded', title: '加载清单' },
  { key: 'prompt', title: '提示词' },
  { key: 'model', title: '模型与参数' },
  { key: 'usage', title: '用量与耗时' },
  { key: 'output', title: '输出原文' }
];

export const REVIEW_DETAIL_SECTION_KEYS = REVIEW_DETAIL_SECTIONS.map((section) => section.key);

export function reviewDetailSectionTitle(key) {
  const found = REVIEW_DETAIL_SECTIONS.find((section) => section.key === str(key));
  return found ? found.title : '';
}

/**
 * 面板只属于**老师端第三步**（FR-114）：家长端与家长分享页不存在任何入口。
 * 界面在渲染前问这一份判据，验证脚本在家长端页面上问同一份 —— 两处不会各写一套 `if`。
 */
export const REVIEW_DETAIL_SURFACES = {
  teacherFlow: 'teacher-flow',
  parentPortal: 'parent-portal',
  parentShare: 'parent-share'
};

/** 允许出现面板的界面（只有老师端第三步）与角色（家长一律不允许）。 */
export const REVIEW_DETAIL_ALLOWED_SURFACES = [REVIEW_DETAIL_SURFACES.teacherFlow];
export const REVIEW_DETAIL_ALLOWED_ROLES = ['teacher', 'admin'];

export function reviewDetailSurfaceAllowed({ surface = '', role = 'teacher' } = {}) {
  if (!REVIEW_DETAIL_ALLOWED_SURFACES.includes(str(surface))) return false;
  return REVIEW_DETAIL_ALLOWED_ROLES.includes(str(role) || 'teacher');
}

const ATTACHMENT_KIND_LABELS = { artwork: '学员作品', photo: '课堂照片' };

/** 附件清单：**只描述引用**（序号 / 类型 / 文件名 / mime / 字节数 / hash），正文一个字都没有。 */
export function reviewDetailAttachmentRows(prompt = {}) {
  const list = prompt && Array.isArray(prompt.attachments) ? prompt.attachments : [];
  return list.map((entry, position) => {
    const source = entry && typeof entry === 'object' ? entry : {};
    const kind = str(source.kind);
    const kindLabel = ATTACHMENT_KIND_LABELS[kind] || '附件';
    const name = str(source.name) || '未命名文件';
    const mime = str(source.mime);
    const bytes = Math.max(0, num(source.bytes));
    const hash = str(source.hash);
    const index = num(source.index) || position + 1;
    const bytesText = bytes ? artworkExportSizeText(bytes) : '';
    return {
      index,
      kind,
      kindLabel,
      name,
      mime,
      bytes,
      bytesText,
      hash,
      text: [`附件 ${index}`, kindLabel, name, mime, bytesText, hash ? `hash ${hash}` : ''].filter(Boolean).join(' · ')
    };
  });
}

// 每项的「细节」列：标签已经单独一列渲染（导出文本里也紧接着），所以这里**不再重复标签**，
// 只写版本 / 条数 / 字符数这些小字。
const LOADED_DETAIL_BUILDERS = {
  file: (item) => [item.version, item.chars ? `${item.chars} 字` : ''].filter(Boolean).join(' · '),
  // 技能带 total 时写「已加载/全部」：`3/5 项`（US-104 的清单在下面逐项展开）。
  skills: (item) => [`${item.count}${item.total && item.total !== item.count ? `/${item.total}` : ''} 项`, item.chars ? `${item.chars} 字` : ''].filter(Boolean).join(' · '),
  files: (item) => [`${item.count} 个`, item.chars ? `${item.chars} 字` : ''].filter(Boolean).join(' · '),
  template: (item) => [
    item.version,
    item.groups ? `${item.groups} 组` : '',
    item.count ? `${item.count} 词` : '',
    item.chars ? `${item.chars} 字` : ''
  ].filter(Boolean).join(' · '),
  modules: (item) => [`${item.count}/${item.total} 项`, item.chars ? `${item.chars} 字` : ''].filter(Boolean).join(' · ')
};

/**
 * 加载清单的挂载点（`reviewDetailLoaded().items`）→ 界面上的一行。
 * 每行都写明 `[已加载] / [未加载]` 与没加载的原因，导出文本直接读 `text`。
 */
export function reviewDetailLoadedRows(loaded) {
  const items = loaded && Array.isArray(loaded.items) ? loaded.items : [];
  return items.map((entry) => {
    const source = entry && typeof entry === 'object' ? entry : {};
    const kind = str(source.kind);
    const label = str(source.label);
    const included = Boolean(source.included);
    const reason = str(source.reason);
    const detail = {
      ...source,
      label,
      count: num(source.count),
      total: num(source.total),
      groups: num(source.groups),
      chars: num(source.chars)
    };
    // 没加载的项不写版本 / 字符数（那些数字与「本次没进去」矛盾），只留一句「为什么没加载」。
    const detailText = included ? (LOADED_DETAIL_BUILDERS[kind] || (() => ''))(detail) : '';
    return {
      key: str(source.key),
      label,
      kind,
      detail: detailText,
      included,
      reason,
      text: `${included ? '[已加载]' : '[未加载]'} ${label}${detailText ? ` · ${detailText}` : ''}${!included && reason ? ` —— ${reason}` : ''}`
    };
  });
}

/** 加载清单里某一项（按 key 取）—— 面板、载荷与导出读同一份 `items`。 */
export function reviewDetailLoadedItem(loaded, key) {
  const items = loaded && Array.isArray(loaded.items) ? loaded.items : [];
  return items.find((item) => str(item?.key) === str(key)) || null;
}

/**
 * 「提示词模块」子清单：本次拼装的每一个模块（含**没进去**的那些，以及它们为什么没进去）。
 * 模块清单来自 `buildPersonaPrompt()`（US-101），这里只做展示口径的归一。
 */
export function reviewDetailModuleRows(prompt = {}) {
  const modules = prompt && Array.isArray(prompt.modules) ? prompt.modules : [];
  return modules.map((entry) => {
    const source = entry && typeof entry === 'object' ? entry : {};
    const id = str(source.id);
    const title = str(source.title) || id;
    const version = str(source.version);
    const from = str(source.source);
    const chars = Math.max(0, num(source.chars));
    const included = Boolean(source.included);
    return {
      id,
      title,
      version,
      source: from,
      chars,
      included,
      text: [`${included ? '[已加载]' : '[未加载]'} ${title}`, version, from, `${chars} 字`].filter(Boolean).join(' · ')
    };
  });
}

/** 参数的显示名（键名来自真正发给模型的那份参数表，`services/llmReview.js` 的 `REVIEW_MODEL_PARAMS`）。 */
export const REVIEW_DETAIL_PARAM_LABELS = {
  stream: '流式输出',
  response_format: '响应格式',
  stream_options: '流式用量统计',
  reasoning_effort: '推理强度',
  temperature: '温度'
};

/** 参数值 → 一行可读文本（布尔写「开/关」，对象按 `键 = 值` 展开，不做 JSON 嵌套）。 */
export function reviewDetailParamValue(value) {
  if (typeof value === 'boolean') return value ? '开' : '关';
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '—';
    return entries.map(([key, item]) => `${key} = ${typeof item === 'boolean' ? (item ? '开' : '关') : str(item)}`).join('、');
  }
  return str(value);
}

export function reviewDetailParamRows(params = {}) {
  const source = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  return Object.keys(source).map((key) => ({ key, label: REVIEW_DETAIL_PARAM_LABELS[key] || key, value: reviewDetailParamValue(source[key]) }));
}

/** 空值与 0 要分开：没有 token 计费时写「本次未返回」，不写「0」。 */
const nullableNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const TOKEN_ROW_DEFS = [
  ['promptTokens', '提示词 tokens'],
  ['completionTokens', '补全 tokens'],
  ['reasoningTokens', '其中推理 tokens'],
  ['totalTokens', '合计 tokens']
];

const TIMING_ROW_DEFS = [
  ['queueMs', '排队'],
  ['firstTokenMs', '首字延迟'],
  ['thinkingMs', '思考耗时'],
  ['totalMs', '总耗时']
];

/**
 * 用量与耗时：四项 tokens + 单次成本估算，四个时刻的三项独立时长（PRD FR-104/FR-105）。
 * 没有 token 时如实写「本次未返回」，不编造 0；时长走 `reviewTraceSecondsText`（与轨迹文案同一份）。
 */
export function reviewDetailUsageRows(usage = {}, timing = {}) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const t = timing && typeof timing === 'object' ? timing : {};
  const tokens = TOKEN_ROW_DEFS.map(([key, label]) => {
    const value = nullableNumber(u[key]);
    const valueText = value === null ? '本次未返回' : String(value);
    return { key, label, value, valueText, text: `${label}：${valueText}` };
  });
  const timingRows = TIMING_ROW_DEFS.map(([key, label]) => {
    const value = nullableNumber(t[key]);
    const valueText = value === null ? '—' : reviewTraceSecondsText(value);
    return { key, label, value, valueText, text: `${label}：${valueText}` };
  });
  const cost = u.cost && typeof u.cost === 'object'
    ? { amount: nullableNumber(u.cost.amount) ?? 0, currency: str(u.cost.currency), model: str(u.cost.model), priced: Boolean(u.cost.priced), label: str(u.cost.label) }
    : null;
  const costText = cost ? `${cost.currency} ${cost.amount}${cost.label ? `（${cost.label}）` : ''}` : '';
  return {
    tokens,
    timing: timingRows,
    cost,
    costText,
    hasTokens: tokens.some((row) => row.value !== null),
    hasTiming: timingRows.some((row) => row.value !== null)
  };
}

/** 输出原文的解析状态（FR-106 的「原样保存、便于排查」）：只看能不能解析，不改动原文。 */
export function reviewDetailOutputParse(raw) {
  const text = str(raw).trim();
  if (!text) return { ok: null, message: '' };
  const stripped = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  try {
    JSON.parse(stripped);
    return { ok: true, message: '原文可解析为 JSON' };
  } catch (error) {
    return { ok: false, message: `原文不是合法 JSON（解析失败：${error.message}），已原样保留便于排查` };
  }
}

/** 导出载荷的版本：分区结构变化时抬高它（导出的 JSON 自带这一行）。 */
export const REVIEW_DETAIL_VERSION = 1;

/**
 * 面板的**唯一数据入口**：把界面上的六类输入（流式增量 / 加载清单 / 提示词 / 轨迹 / 模型参数 / 上下文）
 * 归一成一份 `payload`。六个分区、Markdown、JSON 导出与「复制全部」都读它 —— 界面不再自己拼文案，
 * 于是「界面上看到什么」与「导出里有什么」永远一致（浏览器断言与 Node 断言读同一份）。
 */
export function reviewDetailPayload(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const phase = str(source.phase) || REVIEW_DETAIL_PHASES.done;
  const prompt = source.prompt && typeof source.prompt === 'object' ? source.prompt : {};
  const system = str(prompt.system);
  const user = str(prompt.user);
  const reasoning = str(source.reasoning);
  const output = str(source.output);
  const loadedRows = reviewDetailLoadedRows(source.loaded);
  const moduleRows = reviewDetailModuleRows(prompt);
  // 逐项技能清单（US-104）：来自 `reviewDetailLoaded()` 的那一份（`skillLoadout()` 的唯一产物）。
  const skillRows = reviewDetailSkillRows(reviewDetailLoadedItem(source.loaded, 'skills')?.rows || []);
  const skillsIncluded = skillRows.filter((row) => row.included).length;
  // 逐项 agent 文件清单（US-105）：三层 agent.md + 学员 / 班级 / 机构记忆（含未加载原因与正文）。
  const agentFileRows = reviewDetailAgentFileRows(source.loaded?.agentFiles);
  const agentFileIncludedRows = agentFileRows.filter((row) => row.included);
  const agentFileSummary = reviewDetailAgentFileSummary(source.loaded?.agentFiles);
  const attachments = reviewDetailAttachmentRows(prompt);
  const params = reviewDetailParamRows(source.params);
  const usage = reviewDetailUsageRows(source.usage, source.timing);
  const payload = {
    version: REVIEW_DETAIL_VERSION,
    exportedAt: str(source.exportedAt) || new Date().toISOString(),
    meta: {
      title: '本次点评详情',
      taskLabel: str(source.taskLabel) || '五维点评',
      student: str(source.student),
      lesson: str(source.lessonDate),
      status: reviewDetailPhaseLabel(phase),
      phase,
      model: str(source.model),
      traceId: str(source.traceId),
      requests: num(source.requests),
      error: str(source.message) ? { message: str(source.message) } : null
    },
    sections: [
      {
        key: 'reasoning',
        title: reviewDetailSectionTitle('reasoning'),
        chars: reasoning.length,
        text: reasoning || reviewDetailReasoningPlaceholder(phase),
        empty: !reasoning
      },
      {
        key: 'loaded',
        title: reviewDetailSectionTitle('loaded'),
        rows: loadedRows,
        modules: moduleRows,
        // 逐项技能清单（US-104）：全部技能 + 是否加载 + 没加载的原因 + 进入提示词的原文片段。
        skills: skillRows,
        skillsIncluded,
        skillsTotal: skillRows.length,
        skillsEmpty: skillsIncluded === 0,
        skillsNote: skillsIncluded === 0 ? SKILL_EMPTY_TEXT : '',
        // 逐项 agent 文件清单（US-105）：加载顺序 / 生效范围 / 上限 / 截断位置 + 每个文件的正文。
        agentFiles: agentFileRows,
        agentFilesIncluded: agentFileIncludedRows.length,
        agentFilesTotal: agentFileRows.length,
        agentFilesNote: agentFileRows.length
          ? `加载顺序：${agentFileSummary.loadOrderLabels.join(' → ')}；${agentFileSummary.text}`
          : '',
        agentFilesSummary: agentFileSummary,
        included: loadedRows.filter((row) => row.included).length,
        total: loadedRows.length,
        modulesIncluded: moduleRows.filter((row) => row.included).length,
        modulesTotal: moduleRows.length
      },
      {
        key: 'prompt',
        title: reviewDetailSectionTitle('prompt'),
        system,
        user,
        systemChars: system.length,
        userChars: user.length,
        attachments
      },
      {
        key: 'model',
        title: reviewDetailSectionTitle('model'),
        model: str(source.model),
        params
      },
      {
        key: 'usage',
        title: reviewDetailSectionTitle('usage'),
        tokens: usage.tokens,
        timing: usage.timing,
        cost: usage.cost,
        costText: usage.costText,
        hasTokens: usage.hasTokens,
        hasTiming: usage.hasTiming,
        // 生成中与「这次没有用量」是两种口径：前者等下就有，后者如实说明没有。
        note: usage.hasTokens || usage.hasTiming
          ? ''
          : (phase === REVIEW_DETAIL_PHASES.running ? '生成中：四项 tokens 与三段耗时会在模型收束后写齐。' : '本次没有拿到用量数据（模型未返回 usage）。')
      },
      {
        key: 'output',
        title: reviewDetailSectionTitle('output'),
        chars: output.length,
        text: output,
        parse: reviewDetailOutputParse(output),
        empty: !output
      }
    ],
    // 隐私：导出里**不允许**出现素材正文（data URL / base64 / blob:）。
    // 判据用轨迹的同一条守卫（`reviewTraceMediaViolations`），落盘与断言读同一份。
    mediaSafe: true,
    mediaViolations: []
  };
  const violations = reviewTraceMediaViolations(payload);
  payload.mediaSafe = violations.length === 0;
  payload.mediaViolations = violations.map((item) => item.path);
  return payload;
}

/** 代码块围栏：正文里已经有三个反引号时自动加长，避免导出文本被自己的内容截断。 */
function reviewDetailFence(text) {
  const runs = str(text).match(/`+/g) || [];
  const size = Math.max(3, ...runs.map((run) => run.length + 1));
  const fence = '`'.repeat(size);
  return `${fence}\n${str(text)}\n${fence}`;
}

/** 六个分区的 Markdown 文本（「复制全部」与「导出 Markdown」用同一份 —— 复制到什么就导出什么）。 */
export function reviewDetailMarkdown(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const meta = source.meta && typeof source.meta === 'object' ? source.meta : {};
  const lines = [`# ${meta.title || '本次点评详情'}（${meta.taskLabel || '五维点评'}）`, ''];
  const metaRows = [
    ['学员', meta.student],
    ['课次日期', meta.lesson],
    ['状态', meta.status],
    ['模型', meta.model],
    ['轨迹 id', meta.traceId],
    ['导出时间', source.exportedAt]
  ];
  metaRows.filter(([, value]) => str(value)).forEach(([label, value]) => lines.push(`- ${label}：${value}`));
  if (meta.error?.message) lines.push(`- 错误：${meta.error.message}`);
  lines.push('');

  const sections = Array.isArray(source.sections) ? source.sections : [];
  sections.forEach((section) => {
    const key = str(section?.key);
    lines.push(`## ${section?.title || reviewDetailSectionTitle(key)}`, '');
    if (key === 'reasoning') {
      lines.push(reviewDetailFence(section.text || '（本次没有推理增量）'), '');
    } else if (key === 'loaded') {
      (section.rows || []).forEach((row) => lines.push(`- ${row.text}`));
      const agentFileRows = Array.isArray(section.agentFiles) ? section.agentFiles : [];
      if (agentFileRows.length) {
        const included = section.agentFilesIncluded ?? agentFileRows.filter((row) => row.included).length;
        lines.push('', `### agent.md 与记忆文件（${included}/${section.agentFilesTotal ?? agentFileRows.length} 个已加载）`, '');
        if (section.agentFilesNote) lines.push(`- ${section.agentFilesNote}`);
        // 逐项：谁加载了、什么版本、多少字、内容 hash；未加载的写明原因。
        agentFileRows.forEach((row) => lines.push(`- ${row.text}`));
        const bodyRows = agentFileRows.filter((row) => row.included && row.body);
        if (bodyRows.length) {
          lines.push('', '#### 进入提示词的正文（替换变量后，逐文件）', '');
          bodyRows.forEach((row) => {
            lines.push(`##### ${row.name}（${row.versionText}${row.truncated ? `，截断在 ${row.truncatedAt} 字` : ''}）`, '', reviewDetailFence(row.body), '');
          });
        }
      }
      const skillRows = Array.isArray(section.skills) ? section.skills : [];
      if (skillRows.length) {
        const included = section.skillsIncluded ?? skillRows.filter((row) => row.included).length;
        lines.push('', `### 技能清单（${included}/${section.skillsTotal ?? skillRows.length} 项已加载）`, '');
        if (section.skillsNote) lines.push(`- ${section.skillsNote}`);
        skillRows.forEach((row) => lines.push(`- ${row.text}`));
      }
      const modules = section.modules || [];
      if (modules.length) {
        lines.push('', `### 提示词模块（${section.modulesIncluded ?? modules.filter((row) => row.included).length}/${section.modulesTotal ?? modules.length} 项）`, '');
        modules.forEach((row) => lines.push(`- ${row.text}`));
      }
      lines.push('');
    } else if (key === 'prompt') {
      lines.push(`### system（${section.systemChars || 0} 字）`, '', reviewDetailFence(section.system || '（空）'), '');
      lines.push(`### user（${section.userChars || 0} 字）`, '', reviewDetailFence(section.user || '（空）'), '');
      const attachments = section.attachments || [];
      lines.push(`### 附件（${attachments.length} 个，只记引用与 hash，不含图片正文）`, '');
      attachments.forEach((row) => lines.push(`- ${row.text}`));
      lines.push('');
    } else if (key === 'model') {
      if (section.model) lines.push(`- 模型：${section.model}`);
      (section.params || []).forEach((row) => lines.push(`- ${row.label}：${row.value}`));
      lines.push('');
    } else if (key === 'usage') {
      (section.tokens || []).forEach((row) => lines.push(`- ${row.text}`));
      (section.timing || []).forEach((row) => lines.push(`- ${row.text}`));
      lines.push(`- 估算成本：${section.costText || '本次未产生可估算的用量'}`);
      lines.push('');
    } else if (key === 'output') {
      lines.push(reviewDetailFence(section.text || '（本次没有输出原文）'), '');
      if (section.parse?.message) lines.push(`- ${section.parse.message}`);
      lines.push('');
    } else {
      lines.push('');
    }
  });

  lines.push('---', '');
  lines.push(`- 素材正文：${source.mediaSafe === false ? '检测到疑似素材正文，请勿直接外发' : '不含（导出内容只有提示词、推理、输出与素材引用 / hash）'}`);
  return `${lines.join('\n').trim()}\n`;
}

/** JSON 导出文本（缩进两格，便于直接看）。 */
export function reviewDetailJsonText(payload) {
  return `${JSON.stringify(payload && typeof payload === 'object' ? payload : {}, null, 2)}\n`;
}

/** 导出格式表：`导出 JSON / Markdown` 两个动作的唯一真源（扩展名与 mime 都从这里取）。 */
export const REVIEW_DETAIL_EXPORT_FORMATS = {
  markdown: { id: 'markdown', label: 'Markdown', extension: 'md', mimeType: 'text/markdown;charset=utf-8' },
  json: { id: 'json', label: 'JSON', extension: 'json', mimeType: 'application/json;charset=utf-8' }
};

export function reviewDetailExportFormat(id) {
  const key = str(id);
  return REVIEW_DETAIL_EXPORT_FORMATS[key] || REVIEW_DETAIL_EXPORT_FORMATS.markdown;
}

export function reviewDetailExportText(payload, format) {
  return reviewDetailExportFormat(format).id === 'json' ? reviewDetailJsonText(payload) : reviewDetailMarkdown(payload);
}

/** 导出文件名前缀（与「保存图片」同一条文件名纪律：去掉空格与非法字符，空片段不拼接）。 */
export const REVIEW_DETAIL_FILENAME_PREFIX = '点评详情';

export function reviewDetailExportFilename({ student = '', lessonDate = '', format = 'markdown' } = {}) {
  const entry = reviewDetailExportFormat(format);
  const segments = [student, artworkExportDateText(lessonDate)].map(sanitizeArtworkExportSegment).filter(Boolean);
  if (!segments.length) segments.push('课次');
  return `${[REVIEW_DETAIL_FILENAME_PREFIX, ...segments].join('_')}.${entry.extension}`;
}
