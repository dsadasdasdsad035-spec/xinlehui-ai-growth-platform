/**
 * 两次生成的对比（[第三步 US-107b] / F-REVIEW-MODEL-01 的「对比」半边）。
 *
 * 场景：老师看到正文不对，生成中换一个模型（二次确认「将重新生成，当前正文会被替换」），
 * 或直接点「重新生成」。新一次生成产生**新的轨迹**，并通过 `parentTraceId` 关联上一次 ——
 * 面板据此把两次放在一起对比：**模型 / 耗时 / 推理**（验收点名的三样），另附正文字数与 tokens。
 *
 * 四条硬约定：
 *  1. **零依赖纯函数**：只 import 同层的 data 模块（轨迹 / 模型目录），不碰 DOM / 网络 /
 *     时钟，可以直接用 Node 跑断言。同样的输入永远得到逐字段相同的产物。
 *  2. **对比的「上一次」是收束后的轨迹**（`normalizeReviewTrace` 认得出才算数）：被中止的那一条
 *     同样收束（`status: aborted`），所以「生成中换模型」的父轨迹也有完整的模型 / 耗时 / 推理读数，
 *     不需要在界面上现编。生成中的本次用流式读数（耗时 / 推理 / 正文）拼一个对照侧。
 *  3. **不做并排 diff**（PRD 开放问题 Q9 的口径）：对比是一张「指标 / 上一次 / 本次 / 差值」的表，
 *     推理只给字数、共同前缀长度与两段开头片段 —— 不并排铺两份长文本。
 *  4. **小账本也是纯函数**（`archiveReviewTraces` / `findArchivedTrace`）：已收束轨迹在**内存**里留
 *     最近 8 条（与「轨迹只驻留内存、归档才落盘」同一条隐私口径，绝不写 localStorage）。
 */

import { REVIEW_MODEL_SOURCE_LABELS } from './reviewModels';
import { REVIEW_TRACE_STATUS, REVIEW_TRACE_STATUS_LABELS, normalizeReviewTrace, reviewTraceSecondsText } from './reviewTrace';

/** 对比区标题（面板与导出/断言读同一份）。 */
export const REVIEW_COMPARE_TITLE = '与上一次对比';

/** 内存小账本的条数上限（只够对比用；落盘留档另有 `REVIEW_TRACE_LIMIT`）。 */
export const REVIEW_COMPARE_ARCHIVE_LIMIT = 8;

/** 推理开头片段的长度（不做并排 diff：各给一段开头，说明两条思路从哪儿开始分岔）。 */
export const REVIEW_COMPARE_EXCERPT_CHARS = 60;

/**
 * 对比的行定义 —— **顺序即界面顺序**，`kind` 决定差值文案的口径：
 *  - `text`：值本身可比（模型 / 来源 / 状态），差值写「相同 / 不同」；
 *  - `duration`：毫秒，差值写「快 X / 慢 X / 相同」；
 *  - `count`：计数，差值写「多 N / 少 N / 相同」（`unit` 是单位：字 / tokens）。
 */
export const REVIEW_COMPARE_ROWS = [
  { key: 'model', label: '模型', kind: 'text' },
  { key: 'modelSource', label: '模型来源', kind: 'text' },
  { key: 'status', label: '状态', kind: 'text' },
  { key: 'totalMs', label: '总耗时', kind: 'duration' },
  { key: 'firstTokenMs', label: '首字延迟', kind: 'duration' },
  { key: 'thinkingMs', label: '思考耗时', kind: 'duration' },
  { key: 'reasoningChars', label: '推理字数', kind: 'count', unit: '字' },
  { key: 'outputChars', label: '正文字数', kind: 'count', unit: '字' },
  { key: 'totalTokens', label: '合计 tokens', kind: 'count', unit: 'tokens' }
];

const text = (value) => (value === null || value === undefined ? '' : String(value).trim());

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** 空值统一显示成「—」（两侧都没有这个读数时，表格里不出现空白格）。 */
const dash = (value) => (value === '' || value === null || value === undefined ? '—' : value);

// ---------------------------------------------------------------------------
// 内存小账本：已收束轨迹（生成期只驻留内存，不写 localStorage）
// ---------------------------------------------------------------------------

/** 追加一条已收束轨迹（新的在前、按 traceId 去重、上限 `REVIEW_COMPARE_ARCHIVE_LIMIT`）。 */
export function archiveReviewTraces(list, trace) {
  const kept = Array.isArray(list) ? list.filter(Boolean) : [];
  const item = normalizeReviewTrace(trace);
  if (!item) return kept;
  const rest = kept.filter((entry) => text(entry.traceId) !== item.traceId);
  return [item, ...rest].slice(0, REVIEW_COMPARE_ARCHIVE_LIMIT);
}

/** 账本里按 traceId 取一条（取不到返回 null：父轨迹可能落在账本之外，不编造）。 */
export function findArchivedTrace(list, traceId) {
  const id = text(traceId);
  if (!id) return null;
  return (Array.isArray(list) ? list : []).find((entry) => text(entry?.traceId) === id) || null;
}

// ---------------------------------------------------------------------------
// 差值文案（耗时 / 计数 / 文本三种口径）
// ---------------------------------------------------------------------------

/** 耗时差值：`快 2.3 秒` / `慢 1.2 秒` / `相同`；任一侧缺读数返回空串。 */
export function reviewCompareDurationDelta(parentMs, currentMs) {
  const a = num(parentMs);
  const b = num(currentMs);
  if (a === null || b === null) return '';
  if (a === b) return '相同';
  return `${b > a ? '慢' : '快'} ${reviewTraceSecondsText(Math.abs(b - a))}`;
}

/** 计数差值：`多 32 字` / `少 12 字` / `相同`；单位默认「字」，tokens 传 `unit: 'tokens'`。 */
export function reviewCompareCountDelta(parentCount, currentCount, unit = '字') {
  const a = num(parentCount);
  const b = num(currentCount);
  if (a === null || b === null) return '';
  if (a === b) return '相同';
  return `${b > a ? '多' : '少'} ${Math.abs(b - a)} ${unit}`.trim();
}

/** 文本差值：两边都空给空串；一样写「相同」，不一样写「不同」（模型的「换没换」看这一列）。 */
export function reviewCompareTextDelta(parentValue, currentValue) {
  const a = text(parentValue);
  const b = text(currentValue);
  if (!a && !b) return '';
  return a === b ? '相同' : '不同';
}

// ---------------------------------------------------------------------------
// 推理对照（字数 + 共同前缀 + 两段开头，不做并排 diff）
// ---------------------------------------------------------------------------

const excerpt = (value) => {
  const flat = text(value).replace(/\s+/g, ' ');
  if (flat.length <= REVIEW_COMPARE_EXCERPT_CHARS) return flat;
  return `${flat.slice(0, REVIEW_COMPARE_EXCERPT_CHARS)}…`;
};

/**
 * 两次推理的对照：字数、是否逐字符相同、共同前缀长度与分岔位置，另各给一段开头片段。
 * 输入是推理原文（可能为空串 —— 中止得早确实什么都没收到，如实写「没有推理增量」）。
 */
export function reviewReasoningCompare(parentReasoning, currentReasoning) {
  const a = text(parentReasoning);
  const b = text(currentReasoning);
  const limit = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < limit && a[prefix] === b[prefix]) prefix += 1;
  const identical = a === b;
  const chars = `上一次 ${a.length} 字 · 本次 ${b.length} 字`;
  const textLine = !a && !b
    ? '两次都没有收到推理增量'
    : identical
      ? `两次推理逐字符一致（${a.length} 字）`
      : prefix === 0
        ? `两次推理从第 1 个字起就不同（${chars}）`
        : `两次推理前 ${prefix} 字一致，从第 ${prefix + 1} 字开始不同（${chars}）`;
  return {
    parentChars: a.length,
    currentChars: b.length,
    identical,
    commonPrefixChars: prefix,
    // 第一次不同的位置（0 基）；完全一致时为 null。
    divergeAt: identical ? null : prefix,
    parentExcerpt: excerpt(a),
    currentExcerpt: excerpt(b),
    text: textLine
  };
}

// ---------------------------------------------------------------------------
// 两次生成的整体对比
// ---------------------------------------------------------------------------

/**
 * 把一条轨迹（或生成中的流式读数）摊成对比用的指标。
 * 生成中的那一侧**没有**用量与首字 / 思考读数（还没收束）—— 留 `null`，界面上写「—」，
 * 不拿 0 冒充「已发生」。
 */
const metricsOf = (trace) => {
  const item = trace && typeof trace === 'object' ? trace : {};
  const reasoning = typeof item.reasoning === 'string' ? item.reasoning : '';
  const output = item.output && typeof item.output === 'object' ? item.output : {};
  return {
    model: text(item.model),
    modelSource: text(item.modelSource),
    status: text(item.status),
    totalMs: num(item.timing?.totalMs),
    firstTokenMs: num(item.timing?.firstTokenMs),
    thinkingMs: num(item.timing?.thinkingMs),
    reasoningChars: reasoning.length,
    outputChars: typeof output.raw === 'string' ? output.raw.length : 0,
    totalTokens: num(item.usage?.totalTokens),
    reasoning
  };
};

/** 生成中的本次：模型与来源取**正在跑的那一次**的选择（调用方从 resolve 结果里给）。 */
const runningMetrics = (live, { model = '', modelSource = '' } = {}) => {
  const source = live && typeof live === 'object' ? live : {};
  return {
    model: text(model),
    modelSource: text(modelSource),
    status: REVIEW_TRACE_STATUS.running,
    totalMs: num(source.elapsedMs),
    firstTokenMs: null,
    thinkingMs: null,
    reasoningChars: typeof source.reasoning === 'string' ? source.reasoning.length : 0,
    outputChars: typeof source.content === 'string' ? source.content.length : 0,
    totalTokens: null,
    reasoning: typeof source.reasoning === 'string' ? source.reasoning : ''
  };
};

const valueOf = (metrics, def) => metrics ? metrics[def.key] : null;

/** 一行对比：两次的显示值 + 差值文案 + 「变没变」。 */
function buildCompareRow(def, parent, current) {
  const rawParent = valueOf(parent, def);
  const rawCurrent = valueOf(current, def);
  const format = (metrics, raw) => {
    if (!metrics) return '—';
    if (def.key === 'modelSource') return dash(REVIEW_MODEL_SOURCE_LABELS[text(raw)] || text(raw));
    if (def.key === 'status') return dash(REVIEW_TRACE_STATUS_LABELS[text(raw)] || text(raw));
    if (def.kind === 'duration') return raw === null ? '—' : reviewTraceSecondsText(raw);
    if (def.kind === 'count') return raw === null ? '—' : `${raw}`;
    return dash(text(raw));
  };
  const deltaText = !current ? ''
    : def.kind === 'duration' ? reviewCompareDurationDelta(rawParent, rawCurrent)
      : def.kind === 'count' ? reviewCompareCountDelta(rawParent, rawCurrent, def.unit)
        : reviewCompareTextDelta(rawParent, rawCurrent);
  return {
    key: def.key,
    label: def.label,
    kind: def.kind,
    parentValue: rawParent === undefined ? null : rawParent,
    currentValue: rawCurrent === undefined ? null : rawCurrent,
    parentText: format(parent, rawParent),
    currentText: current ? format(current, rawCurrent) : '生成中',
    deltaText,
    changed: Boolean(current) && text(rawParent) !== text(rawCurrent) && (rawParent !== null || rawCurrent !== null)
  };
}

/**
 * 两次生成的对比 —— 面板「与上一次对比」区块的**唯一数据入口**。
 *
 * 参数：
 *  - `parent`：上一次的收束轨迹（本模块只认 `parentTraceId` 指到的那一条；认不出就返回 `null`，
 *    界面据此**不渲染**对比区 —— 还没换过模型 / 没重新生成过时不该出现一块空表）。
 *  - `current`：本次的收束轨迹（可为 `null`：生成中还没收束）。
 *  - `live`：生成中的流式读数（`elapsedMs` / `reasoning` / `content`），`current` 为空时用它拼对照侧。
 *  - `model` / `modelSource`：本次生成真正用出去的那个模型与来源（生成中那一行的模型读数）。
 *
 * 返回 `{ available, parentTraceId, currentTraceId, title, note, rows, reasoning, modelChanged,
 * summaryText, live }`。
 */
export function reviewTraceCompare({ parent = null, current = null, live = null, model = '', modelSource = '' } = {}) {
  const parentTrace = normalizeReviewTrace(parent);
  if (!parentTrace) return null;
  const currentTrace = normalizeReviewTrace(current);
  const parentSide = metricsOf(parentTrace);
  const currentSide = currentTrace ? metricsOf(currentTrace) : runningMetrics(live, { model, modelSource });
  const rows = REVIEW_COMPARE_ROWS.map((def) => buildCompareRow(def, parentSide, currentSide));
  const reasoning = reviewReasoningCompare(parentSide.reasoning, currentSide.reasoning);
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  const modelText = byKey.model.changed
    ? `模型 ${byKey.model.parentText} → ${byKey.model.currentText}`
    : `模型 ${byKey.model.parentText}（未换）`;
  // 差值算不出来时：本次还在跑就写「待本次收束」（收束后就有），否则如实写「—」。
  const pending = currentTrace ? '—' : '待本次收束';
  const parts = [
    modelText,
    `耗时 ${byKey.totalMs.deltaText || pending}`,
    `推理 ${byKey.reasoningChars.deltaText || pending}`
  ];
  const currentLabel = currentTrace ? `${currentTrace.traceId}（${REVIEW_TRACE_STATUS_LABELS[currentTrace.status] || currentTrace.status}）` : '生成中';
  return {
    available: true,
    title: REVIEW_COMPARE_TITLE,
    parentTraceId: parentTrace.traceId,
    parentStatus: parentTrace.status,
    parentStatusLabel: REVIEW_TRACE_STATUS_LABELS[parentTrace.status] || parentTrace.status,
    currentTraceId: currentTrace ? currentTrace.traceId : '',
    currentStatus: currentTrace ? currentTrace.status : REVIEW_TRACE_STATUS.running,
    live: !currentTrace,
    modelChanged: byKey.model.changed,
    note: `同一位学员、同一份素材的两次生成：上一次 ${parentTrace.traceId}（${REVIEW_TRACE_STATUS_LABELS[parentTrace.status] || parentTrace.status}）→ 本次 ${currentLabel}。新轨迹通过 parentTraceId 关联上一次。`,
    rows,
    reasoning,
    summaryText: parts.join(' · ')
  };
}
