/**
 * 点评推理轨迹 reviewTrace（[第三步 US-102] / F-REVIEW-TRACE-01）。
 *
 * 一次点评生成的全部关键信息结构化留档：模型与参数、加载清单、提示词、推理过程、
 * 输出原文、耗时与用量、状态与错误。后面的「本次点评详情面板」（US-103）、
 * 管理端生成日志（US-112）与两次生成的对比（US-107b）都读这一份结构。
 *
 * 四条硬约定：
 *  1. **字段是白名单构造**（`createReviewTrace` / `normalizeReviewTrace`）：结构上就装不下
 *     别的东西 —— 儿童素材像素、手机号这类内容不会被顺手写进轨迹。
 *  2. **图片只记引用与 hash**（`buildReviewTraceAttachment`）：附件条目里是
 *     「附件序号 + 文件 id + 内容 hash + 字节数」，**不存 base64**；
 *     `reviewTraceMediaViolations()` 是这条口径的守卫（断言与落盘前复核都读它）。
 *  3. **生成期只驻留内存，归档时才提交云端**：本模块提供本机镜像的读写
 *     （`loadReviewTraces` / `persistReviewTrace`），推送云端在 `services/reviewTraceApi.js`；
 *     调用方（`main.jsx`）在**归档那一刻**才提交，未归档的轨迹不落盘。
 *  4. **失败与中止同样留档**：`status` 为 `failed` / `aborted` 时 `error` 里带错误码与可读文案，
 *     `reasoning` / `output.raw` 保留中止前已经拿到的部分（不是丢掉）。
 *
 * 与 `data/auditLog.js` 同一套纪律：**零依赖纯函数 + 常量**，不 import 任何模块、不碰 DOM，
 * 可以直接用 Node 跑断言。
 */

/** 结构版本：轨迹字段变化时抬高它（旧轨迹按版本读出，不做半成品迁移）。 */
export const REVIEW_TRACE_VERSION = 1;

/** 本机镜像的键（与审计日志同口径：主键是裸数组，云端表另算）。 */
export const REVIEW_TRACE_STORAGE_KEY = 'xinlehui-review-traces-v1';

/** 本机镜像的上限：只留最近 200 条（更早的由云端表负责，本机不无限增长）。 */
export const REVIEW_TRACE_LIMIT = 200;

/** 任务枚举：目前只有「五维点评」一条产线。 */
export const REVIEW_TRACE_TASKS = {
  artworkReview: 'artwork-review'
};

export const REVIEW_TRACE_TASK_LABELS = {
  'artwork-review': '五维点评'
};

/**
 * 状态枚举：`running` 只在生成期出现（内存里的轨迹），落盘时必然是后三种之一。
 * PRD 点名的三种结局：成功 / 失败 / 老师中止。
 */
export const REVIEW_TRACE_STATUS = {
  running: 'running',
  success: 'success',
  failed: 'failed',
  aborted: 'aborted'
};

export const REVIEW_TRACE_STATUS_LABELS = {
  running: '生成中',
  success: '成功',
  failed: '失败',
  aborted: '已停止'
};

/** 轨迹字段清单（白名单；`REVIEW_TRACE_FIELDS` 之外的东西进不来）。 */
export const REVIEW_TRACE_FIELDS = [
  'version',
  'traceId',
  'parentTraceId',
  'task',
  'taskLabel',
  'studentId',
  'lessonId',
  'model',
  'timing',
  'usage',
  'loaded',
  'prompts',
  'reasoning',
  'output',
  'status',
  'statusLabel',
  'error',
  'createdAt',
  'archivedAt',
  'recordId'
];

/** timing 的字段清单（队列 / 开始 / 首字 / 思考结束 / 结束 五个时刻 + 三个时长）。 */
export const REVIEW_TRACE_TIMING_FIELDS = [
  'queuedAt',
  'startedAt',
  'firstTokenAt',
  'contentStartedAt',
  'settledAt',
  'queueMs',
  'firstTokenMs',
  'thinkingMs',
  'totalMs'
];

/** usage 的字段清单（PRD 点名的四项 tokens + 单次成本估算）。 */
export const REVIEW_TRACE_USAGE_FIELDS = ['promptTokens', 'completionTokens', 'reasoningTokens', 'totalTokens', 'cost'];

/**
 * 模型单价表（**单次成本估算的唯一真源**）：按每千 tokens 计价，reasoning tokens 按输出价计。
 * 原型阶段没有真实账单口径，这里的数字是「参考价」，`estimateReviewCost` 会如实标 `label`。
 */
export const REVIEW_MODEL_PRICES = {
  'glm-5.3-flash': { inputPer1k: 0.0015, outputPer1k: 0.006, currency: 'CNY', label: '参考价' }
};

/** 表里没有的模型用这份兜底价（`priced: false`，界面上说明是估值）。 */
export const REVIEW_MODEL_FALLBACK_PRICE = { inputPer1k: 0.002, outputPer1k: 0.008, currency: 'CNY', label: '估值（未登记单价）' };

/** 轨迹 id：随机唯一值（不做自然键派生 —— 同一秒的两次生成各留一条）。 */
export function makeReviewTraceId() {
  return `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const count = (value) => {
  const parsed = num(value);
  return parsed && parsed > 0 ? Math.round(parsed) : 0;
};

/**
 * 内容 hash：FNV-1a 32 位，8 位十六进制。
 * 对 `data:` 地址来说它就是图片内容的摘要（base64 正文就是全部内容）—— 轨迹里存它、
 * 不存正文，既能回答「这一次和上一次是不是同一张图」，又不把孩子的画面写进留档。
 */
export function reviewTraceContentHash(content) {
  const text = typeof content === 'string' ? content : '';
  if (!text) return '';
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** data URL / 文本的字节数（data URL 按 base64 段反推，普通文本按 UTF-8 长度计）。 */
export function reviewTraceByteLength(content) {
  const text = typeof content === 'string' ? content : '';
  if (!text) return 0;
  const comma = text.startsWith('data:') ? text.indexOf(',') : -1;
  if (comma < 0) return text.length;
  const body = text.slice(comma + 1);
  if (!/;base64/i.test(text.slice(0, comma))) return body.length;
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/**
 * 一个附件的轨迹条目：**只记引用与 hash**。
 * `content` 是真正发给模型的那份内容（data URL），函数只从它算出 `hash` 与 `bytes`，
 * 正文一个字都不进条目 —— 这是「图片像素不进入轨迹」的结构保证。
 */
export function buildReviewTraceAttachment({ kind = '', role = '', index = 0, fileId = '', name = '', mime = '', content = '' } = {}) {
  const text = typeof content === 'string' ? content : '';
  if (!text) return null;
  const header = text.startsWith('data:') ? text.slice(5, Math.max(text.indexOf(','), 0)) : '';
  return {
    index: Number.isFinite(Number(index)) && Number(index) > 0 ? Math.round(Number(index)) : 0,
    kind: str(kind),
    role: str(role),
    fileId: str(fileId),
    name: str(name),
    mime: str(mime) || header.split(';')[0],
    bytes: reviewTraceByteLength(text),
    hash: reviewTraceContentHash(text)
  };
}

/** 批量构造附件条目：空内容跳过，序号按最终顺序从 1 开始重排（与提示词里的「附件 N」对齐）。 */
export function buildReviewTraceAttachments(list = []) {
  const items = [];
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const item = buildReviewTraceAttachment(entry);
    if (item) items.push(item);
  });
  return items.map((item, position) => ({ ...item, index: position + 1 }));
}

/** usage 归一：认 OpenAI 风格的 snake_case（含 `completion_tokens_details.reasoning_tokens`）。 */
export function normalizeReviewTraceUsage(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const details = source.completion_tokens_details && typeof source.completion_tokens_details === 'object' ? source.completion_tokens_details : {};
  const promptTokens = count(source.prompt_tokens ?? source.promptTokens);
  const completionTokens = count(source.completion_tokens ?? source.completionTokens);
  const reasoningTokens = count(source.reasoning_tokens ?? source.reasoningTokens ?? details.reasoning_tokens);
  const totalTokens = count(source.total_tokens ?? source.totalTokens) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, reasoningTokens, totalTokens, cost: null };
}

/**
 * 单次成本估算：输入按输入价、输出 + reasoning 按输出价。
 * 返回 `{ amount, currency, model, priced, label }`；没有任何 token 时返回 `null`（不编造 0 元账单）。
 */
export function estimateReviewCost(usage, model = '') {
  const item = usage && typeof usage === 'object' ? usage : {};
  const promptTokens = count(item.promptTokens ?? item.prompt_tokens);
  const completionTokens = count(item.completionTokens ?? item.completion_tokens);
  const reasoningTokens = count(item.reasoningTokens ?? item.reasoning_tokens);
  if (!promptTokens && !completionTokens && !reasoningTokens) return null;
  const key = str(model);
  const price = REVIEW_MODEL_PRICES[key] || REVIEW_MODEL_FALLBACK_PRICE;
  const amount = (promptTokens / 1000) * price.inputPer1k + ((completionTokens + reasoningTokens) / 1000) * price.outputPer1k;
  return {
    amount: Math.round(amount * 1e6) / 1e6,
    currency: price.currency,
    model: key,
    priced: Boolean(REVIEW_MODEL_PRICES[key]),
    label: price.label
  };
}

const normalizeTiming = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const timing = {};
  REVIEW_TRACE_TIMING_FIELDS.forEach((key) => {
    timing[key] = REVIEW_TRACE_TIMING_FIELDS.indexOf(key) < 5 ? str(source[key]) : num(source[key]);
  });
  return timing;
};

const normalizeUsage = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const usage = normalizeReviewTraceUsage(source);
  const cost = source.cost && typeof source.cost === 'object' ? source.cost : null;
  usage.cost = cost
    ? {
        amount: num(cost.amount) || 0,
        currency: str(cost.currency) || REVIEW_MODEL_FALLBACK_PRICE.currency,
        model: str(cost.model),
        priced: Boolean(cost.priced),
        label: str(cost.label)
      }
    : null;
  return usage;
};

/**
 * 用量 + 成本估算：先把 tokens 归一，再按 `estimateReviewCost` 挂上单次成本
 * （已经带 `cost` 的旧记录保持原样，重算会覆盖不掉历史账单口径）。
 */
export function reviewTraceUsage(raw, model = '') {
  const usage = normalizeUsage(raw);
  if (!usage.cost) usage.cost = estimateReviewCost(usage, model);
  return usage;
}

const normalizeModules = (list) => (Array.isArray(list) ? list : []).map((module) => {
  const source = module && typeof module === 'object' ? module : {};
  const content = typeof source.content === 'string' ? source.content : '';
  return {
    id: str(source.id),
    title: str(source.title),
    content,
    version: str(source.version),
    source: str(source.source),
    chars: num(source.chars) ?? content.length,
    included: source.included === undefined ? Boolean(content.trim()) : Boolean(source.included)
  };
});

const normalizeAttachments = (list) => (Array.isArray(list) ? list : []).map((entry) => {
  const source = entry && typeof entry === 'object' ? entry : {};
  return {
    index: count(source.index),
    kind: str(source.kind),
    role: str(source.role),
    fileId: str(source.fileId),
    name: str(source.name),
    mime: str(source.mime),
    bytes: count(source.bytes),
    hash: str(source.hash)
  };
});

const normalizeError = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const code = str(raw.code);
  const message = str(raw.message);
  if (!code && !message) return null;
  return { code, message };
};

/**
 * 造一条轨迹（生成开始时调用）。**永不抛错**：缺字段补默认值。
 * `seed` 由调用方给「谁 / 哪节课 / 哪个任务 / 排队时刻」，其余由生成流程填。
 */
export function createReviewTrace(seed = {}) {
  const source = seed && typeof seed === 'object' ? seed : {};
  const task = str(source.task) || REVIEW_TRACE_TASKS.artworkReview;
  const now = str(source.now) || new Date().toISOString();
  const status = Object.values(REVIEW_TRACE_STATUS).includes(str(source.status)) ? str(source.status) : REVIEW_TRACE_STATUS.running;
  return {
    version: REVIEW_TRACE_VERSION,
    traceId: str(source.traceId) || makeReviewTraceId(),
    parentTraceId: str(source.parentTraceId),
    task,
    taskLabel: str(source.taskLabel) || REVIEW_TRACE_TASK_LABELS[task] || task,
    studentId: str(source.studentId),
    lessonId: str(source.lessonId),
    model: str(source.model),
    timing: normalizeTiming({ ...(source.timing || {}), queuedAt: (source.timing && source.timing.queuedAt) || str(source.queuedAt) || now }),
    usage: normalizeUsage(source.usage),
    loaded: { modules: normalizeModules(source.modules || (source.loaded && source.loaded.modules)) },
    prompts: {
      system: str(source.system || (source.prompts && source.prompts.system)),
      user: str(source.user || (source.prompts && source.prompts.user)),
      attachments: normalizeAttachments(source.attachments || (source.prompts && source.prompts.attachments))
    },
    reasoning: typeof source.reasoning === 'string' ? source.reasoning : '',
    output: { raw: str(source.outputRaw || (source.output && source.output.raw)) },
    status,
    statusLabel: REVIEW_TRACE_STATUS_LABELS[status] || status,
    error: normalizeError(source.error),
    createdAt: str(source.createdAt) || new Date().toISOString(),
    archivedAt: str(source.archivedAt),
    recordId: str(source.recordId)
  };
}

/** 容错读入：认不出的输入返回 `null`（不编造 id、不补任务、不补时间）。 */
export function normalizeReviewTrace(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  // task 必须**原样带着**：`createReviewTrace` 会给缺省任务兜底，
  // 读一条历史记录时不能把「它属于哪条产线」编出来。
  if (!str(raw.task)) return null;
  const trace = createReviewTrace({ ...raw, createdAt: raw.createdAt, now: raw.createdAt || raw.timing?.queuedAt });
  if (!trace.traceId) return null;
  trace.statusLabel = REVIEW_TRACE_STATUS_LABELS[trace.status] || trace.status;
  return trace;
}

/** 请求真正开始（排队结束）：算出排队时间。 */
export function startReviewTrace(trace, at) {
  const item = trace && typeof trace === 'object' ? trace : {};
  const startedAt = str(at) || new Date().toISOString();
  const queuedAt = item.timing?.queuedAt;
  const queueMs = queuedAt ? Math.max(0, new Date(startedAt).getTime() - new Date(queuedAt).getTime()) : null;
  return { ...item, timing: { ...(item.timing || {}), startedAt, queueMs } };
}

/** 首个 token 到达（首字延迟）：只记第一次。 */
export function markReviewTraceFirstToken(trace, at) {
  const item = trace;
  if (!item || item.timing?.firstTokenAt) return item;
  const firstTokenAt = str(at) || new Date().toISOString();
  const base = item.timing?.startedAt || item.timing?.queuedAt;
  const firstTokenMs = base ? Math.max(0, new Date(firstTokenAt).getTime() - new Date(base).getTime()) : null;
  return { ...item, timing: { ...(item.timing || {}), firstTokenAt, firstTokenMs } };
}

/** 正文开始（思考结束）：思考耗时 = 首字 → 正文之间的这段。只记第一次。 */
export function markReviewTraceContentStart(trace, at) {
  const item = trace;
  if (!item || item.timing?.contentStartedAt) return item;
  const contentStartedAt = str(at) || new Date().toISOString();
  const base = item.timing?.firstTokenAt || item.timing?.startedAt || item.timing?.queuedAt;
  const thinkingMs = base ? Math.max(0, new Date(contentStartedAt).getTime() - new Date(base).getTime()) : null;
  return { ...item, timing: { ...(item.timing || {}), contentStartedAt, thinkingMs } };
}

/**
 * 认不出的错误对象也留档：code / message 各取能取到的那一份。
 * 业务错误码优先（`error.code` / `error.error.code`）；异常本身没有业务码时用 `fallbackCode`
 * （解析失败 / 老师中止这两条路径自己带码），实在没有才回落 JS 异常名。
 */
export function reviewTraceErrorOf(error, message = '', fallbackCode = '') {
  const source = error && typeof error === 'object' ? error : {};
  const nested = source.error && typeof source.error === 'object' ? source.error : {};
  const own = str(source.code || nested.code);
  return {
    code: own || str(fallbackCode) || str(source.name),
    message: str(message || source.message || nested.message)
  };
}

/**
 * 收束一条轨迹（成功 / 失败 / 中止都走这里）：一次写全时长、用量、推理与输出原文。
 * `at` 缺省取当前时刻；`reasoning` / `outputRaw` 传「中止前已经拿到的那部分」。
 */
export function finishReviewTrace(trace, { status = REVIEW_TRACE_STATUS.success, at, error = null, reasoning, outputRaw, usage } = {}) {
  const item = trace && typeof trace === 'object' ? trace : {};
  const settledAt = str(at) || new Date().toISOString();
  const base = item.timing?.queuedAt;
  const totalMs = base ? Math.max(0, new Date(settledAt).getTime() - new Date(base).getTime()) : null;
  const nextStatus = Object.values(REVIEW_TRACE_STATUS).includes(str(status)) ? str(status) : REVIEW_TRACE_STATUS.failed;
  return {
    ...item,
    timing: { ...(item.timing || {}), settledAt, totalMs },
    usage: usage === undefined ? (item.usage || normalizeUsage(null)) : reviewTraceUsage(usage, item.model),
    reasoning: typeof reasoning === 'string' ? reasoning : (item.reasoning || ''),
    output: { raw: typeof outputRaw === 'string' ? outputRaw : (item.output?.raw || '') },
    status: nextStatus,
    statusLabel: REVIEW_TRACE_STATUS_LABELS[nextStatus] || nextStatus,
    error: nextStatus === REVIEW_TRACE_STATUS.success ? null : normalizeError(error) || item.error || null
  };
}

/** 状态文案（面板与 toast 共用）。 */
export function reviewTraceStatusText(trace) {
  const item = normalizeReviewTrace(trace);
  if (!item) return '';
  return REVIEW_TRACE_STATUS_LABELS[item.status] || item.status;
}

/** 毫秒 → 「12.3 秒」（不足 1 秒给毫秒，避免显示成 0.0 秒）。 */
export function reviewTraceSecondsText(ms) {
  const value = num(ms);
  if (value === null) return '';
  if (value < 1000) return `${Math.round(value)} 毫秒`;
  return `${(value / 1000).toFixed(1)} 秒`;
}

/** 一行摘要（归档回执与后续面板的折叠态共用；缺项跳过，不写空占位）。 */
export function reviewTraceSummary(trace) {
  const item = normalizeReviewTrace(trace);
  if (!item) return '';
  const parts = [];
  if (item.model) parts.push(`模型 ${item.model}`);
  if (item.timing.totalMs !== null) parts.push(`总耗时 ${reviewTraceSecondsText(item.timing.totalMs)}`);
  if (item.timing.firstTokenMs !== null) parts.push(`首字 ${reviewTraceSecondsText(item.timing.firstTokenMs)}`);
  if (item.reasoning) parts.push(`思考 ${item.reasoning.length} 字`);
  if (item.usage.totalTokens) parts.push(`${item.usage.totalTokens} tokens`);
  if (item.usage.cost) parts.push(`估算 ${item.usage.cost.currency} ${item.usage.cost.amount}`);
  return parts.join(' · ');
}

/**
 * 隐私守卫：扫描轨迹里有没有混进素材正文（`data:` URL / base64 / blob: 地址）。
 * 返回命中的 `{ path, value }` 列表；空数组 = 合格。
 * 断言与「落盘前复核」读同一份 —— 不用自己写正则。
 */
const MEDIA_TEXT = /(data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,|data:image\/|;\s*base64,|^blob:)/i;
export function reviewTraceMediaViolations(trace) {
  const found = [];
  const walk = (value, path) => {
    if (typeof value === 'string') {
      if (MEDIA_TEXT.test(value)) found.push({ path, value: `${value.slice(0, 32)}…` });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach((key) => {
        // 附件模型里「正文本体」的常见键名（dataUrl / base64 / content）：只有值真的
        // 长得像素材正文时才点名 —— 提示词模块的 `content` 是合法字段（US-101 的模块形状）。
        if (/^(dataUrl|base64|content)$/i.test(key) && typeof value[key] === 'string') {
          if (MEDIA_TEXT.test(value[key])) found.push({ path: `${path}.${key}`, value: `${String(value[key]).slice(0, 32)}…` });
          return;
        }
        walk(value[key], `${path}.${key}`);
      });
    }
  };
  walk(trace, 'trace');
  return found;
}

/** 落盘前复核：把混进素材正文的字符串清成空串，返回 `{ trace, violations }`（原文进 violations 供人查看）。 */
export function sanitizeReviewTrace(trace) {
  const violations = reviewTraceMediaViolations(trace);
  if (!violations.length) return { trace, violations };
  const blank = (value) => (typeof value === 'string' && MEDIA_TEXT.test(value) ? '' : value);
  const scrub = (value) => {
    if (typeof value === 'string') return blank(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      const next = {};
      Object.keys(value).forEach((key) => {
        if (/^(dataUrl|base64|content)$/i.test(key) && typeof value[key] === 'string') return;
        next[key] = scrub(value[key]);
      });
      return next;
    }
    return value;
  };
  return { trace: scrub(trace), violations };
}

/** 追加一条轨迹：新的在前，按 traceId 去重（同一条重复提交只留一条），上限 `REVIEW_TRACE_LIMIT`。 */
export function appendReviewTrace(traces, trace) {
  const list = Array.isArray(traces) ? traces.filter(Boolean) : [];
  const next = normalizeReviewTrace(trace);
  if (!next) return list;
  const rest = list.filter((item) => str(item.traceId) !== next.traceId);
  return [next, ...rest].slice(0, REVIEW_TRACE_LIMIT);
}

/** 合并两份轨迹（云端 + 本机镜像）：按 traceId 去重，按创建时间倒序。 */
export function mergeReviewTraces(remote, local) {
  const byId = new Map();
  [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])].forEach((item) => {
    const trace = normalizeReviewTrace(item);
    if (trace) byId.set(trace.traceId, trace);
  });
  return [...byId.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, REVIEW_TRACE_LIMIT);
}

/** 读本机镜像：坏数据安全降级成空列表（不抛错、不编造记录）。 */
export function loadReviewTraces() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  let parsed = null;
  try { parsed = JSON.parse(window.localStorage.getItem(REVIEW_TRACE_STORAGE_KEY)); } catch { parsed = null; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeReviewTrace).filter(Boolean).slice(0, REVIEW_TRACE_LIMIT);
}

/**
 * 写一条轨迹到本机镜像（**归档时才调用**：未归档的轨迹只驻留内存，不落盘）。
 * 落盘前过 `sanitizeReviewTrace`（素材正文一律清掉），返回真正写下去的那一条。
 */
export function persistReviewTrace(trace) {
  const { trace: safe } = sanitizeReviewTrace(trace);
  const item = normalizeReviewTrace(safe);
  if (!item) return null;
  if (typeof window !== 'undefined' && window.localStorage) {
    try { window.localStorage.setItem(REVIEW_TRACE_STORAGE_KEY, JSON.stringify(appendReviewTrace(loadReviewTraces(), item))); } catch { /* 配额满时不动本机镜像 */ }
  }
  return item;
}

/** 最近一条轨迹（本机镜像读取；管理端/面板用作「上一次生成」的对照）。 */
export function latestReviewTrace(traces) {
  const list = Array.isArray(traces) ? traces.map(normalizeReviewTrace).filter(Boolean) : [];
  if (!list.length) return null;
  return list.reduce((newest, item) => (String(item.createdAt) > String(newest.createdAt) ? item : newest), list[0]);
}
