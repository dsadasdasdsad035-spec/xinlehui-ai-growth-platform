// 点评模型目录与「这次用哪个视觉模型」（[第三步 US-107a] / F-REVIEW-MODEL-01）。
//
// 这一份是模型选择器的**唯一真源**：选项行（名称 / 供应商 / 版本 / 能力标签 / 单价 /
// 近期 P95 耗时 / 健康状态）、不可选原因（健康检查失败 / 未授权 / 额度不足）、
// 「由模型池自动路由」的命中规则、老师的个人默认、以及轨迹里的来源标注（`pool-route`）
// 全部来自这里。界面只渲染它的产物 —— **不要在组件里另写一套过滤或排序**
// （一处按 visionEnabled 过滤、另一处忘了，就会出现「列表里有它、选不了它」）。
//
// 两条硬约定：
//  1. **零依赖纯函数**（只 import 同层的 data 模块的单价表），不碰 DOM / 网络，
//     可以直接用 Node 跑断言（见 prototype/AGENTS.md）。
//  2. **可选性判据只有一个函数**（`reviewModelAvailability`）：选择器置灰、开始生成前的
//     拦截、断言读的都是它；「可选」的定义是「视觉理解已启用 + 机构已授权点评 + 健康 + 额度足」。
//
// 目录的读法：云端 `provider_models` 表为真源，本机镜像（STORAGE_KEY）兜底 —— 与
// 技能库 / 装裱模板同一套；表还没建时（云表尚未创建）本地种子照常可用。

import { REVIEW_MODEL_PRICES } from './reviewTrace';

/** 模型目录的本机镜像键（沿用「主键是裸数组」的老口径）。 */
const STORAGE_KEY = 'xinlehui-review-models-v1';

/** 老师个人默认模型的本机镜像键（一条 map：老师键 → 模型 id，'' = 由模型池自动路由）。 */
const DEFAULT_KEY = 'xinlehui-review-model-default-v1';

/**
 * 默认点评模型（实测可用的视觉模型）。
 * **与 `services/llmReview.js` 的 `REVIEW_MODEL` 同源**：那边就是从这个常量导出的，
 * 每千 tokens 单价在 `data/reviewTrace.js` 的 `REVIEW_MODEL_PRICES` 里。
 */
export const REVIEW_MODEL_DEFAULT_ID = 'glm-5.3-flash';

/** 「由模型池自动路由」在选择器里的伪 id（不是真实模型 id，不会被发给云端）。 */
export const REVIEW_MODEL_POOL_ROUTE_ID = 'pool-route';

/**
 * 轨迹里的来源标注（US-107a 第 5 条：由模型池自动路由时标注来源为 `pool-route`）。
 * 老师的明确选择标 `teacher-pick`；历史轨迹没有这个字段，读出来是空串（不编造来源）。
 */
export const REVIEW_MODEL_SOURCES = {
  teacherPick: 'teacher-pick',
  poolRoute: 'pool-route'
};

export const REVIEW_MODEL_SOURCE_LABELS = {
  [REVIEW_MODEL_SOURCES.teacherPick]: '老师指定',
  [REVIEW_MODEL_SOURCES.poolRoute]: '模型池自动路由'
};

/** 健康状态（近期健康检查的结论）。 */
export const REVIEW_MODEL_HEALTH = {
  ok: 'ok',
  failed: 'failed'
};

export const REVIEW_MODEL_HEALTH_LABELS = {
  [REVIEW_MODEL_HEALTH.ok]: '健康',
  [REVIEW_MODEL_HEALTH.failed]: '健康检查失败'
};

/**
 * 可选性判据的枚举（界面置灰的原因文案读 `REVIEW_MODEL_REASON_LABELS`）。
 * 顺序即判定优先级：先看它是不是视觉模型，再看授权（机构根本没授权点评的模型，
 * 健康与额度都不必再提），然后是健康，最后是额度。
 */
export const REVIEW_MODEL_REASONS = {
  ok: 'ok',
  vision: 'vision-disabled',
  auth: 'unauthorized',
  health: 'health-failed',
  quota: 'quota-exceeded'
};

export const REVIEW_MODEL_REASON_LABELS = {
  [REVIEW_MODEL_REASONS.ok]: '可用',
  [REVIEW_MODEL_REASONS.vision]: '视觉理解能力未启用',
  [REVIEW_MODEL_REASONS.auth]: '机构未授权该模型用于点评',
  [REVIEW_MODEL_REASONS.health]: '健康检查失败',
  [REVIEW_MODEL_REASONS.quota]: '额度不足'
};

/** 选择器上的固定说明（验收原文：「只列出视觉理解能力已启用…」）。 */
export const REVIEW_MODEL_PICKER_NOTE = '只列出视觉理解能力已启用的模型；机构未授权、健康检查失败或额度不足的会置灰并说明原因。';
/** 一个可用模型都没有时的可读文案（开始生成会被拦下）。 */
export const REVIEW_MODEL_EMPTY_TEXT = '当前没有可用的点评模型，请联系机构管理员检查模型健康、授权与额度。';
/** 池路由选项的说明。 */
export const REVIEW_MODEL_POOL_ROUTE_NOTE = '按模型池优先级与健康状态自动挑一个可用模型，适合课前不想挑模型的场景。';

/**
 * 生成中换模型的提示与二次确认（[第三步 US-107b]）。
 * 生成中换模型是**允许**的（老师可能看到正文不对就想换一个），但必须二次确认 ——
 * 它会中止当前生成、用新模型重新生成，当前正文会被替换。文案的唯一真源在这里：
 * 确认条、断言与按钮都读它，不要在组件里另写一份（验收原文点名了下面这句话）。
 */
export const REVIEW_MODEL_RUNNING_NOTE = '生成中可以换模型：选另一个会先请你确认（将重新生成，当前正文会被替换），确认后立即重启生成。';
export const REVIEW_MODEL_SWITCH_CONFIRM_ACTION = '确认切换并重新生成';
export const REVIEW_MODEL_SWITCH_CANCEL_ACTION = '继续当前生成';

/** 二次确认的正文（含验收原话「将重新生成，当前正文会被替换」）。 */
export function reviewModelSwitchConfirmText({ fromName = '', toName = '' } = {}) {
  const to = text(toName) || '所选模型';
  const from = text(fromName);
  return `${from ? `当前正在用「${from}」生成；切换到「${to}」` : `切换到「${to}」`}将重新生成，当前正文会被替换。确认后立即重启生成，新轨迹会关联上一次，可在「本次点评详情」里对比两次的模型、耗时与推理。`;
}

/**
 * 种子模型目录（原型阶段的平台侧配置）。
 * 覆盖验收点名的三种不可用原因各一条：
 *  - `glm-4.6v` 健康检查失败（实测调用返回 request_invalid_parameter）；
 *  - `doubao-seed-1.6-vision` 机构未授权点评；
 *  - `gpt-5-vision` 额度不足。
 * 另有 `glm-text-max`（视觉理解未启用）用来说明「不列出的那一类」。
 * `p95Ms` 是平台健康检查给出的近 7 天 P95（样本数 `p95Samples`）。
 */
export const seedReviewModels = [
  {
    id: 'glm-5.3-flash',
    name: 'GLM 5.3 视觉 Flash',
    provider: '智谱 AI',
    version: '5.3-flash',
    capabilities: ['视觉理解', '五维点评', '流式输出'],
    visionEnabled: true,
    reviewEnabled: true,
    orgId: '',
    health: REVIEW_MODEL_HEALTH.ok,
    healthNote: '近 7 天健康检查全部通过',
    p95Ms: 19800,
    p95Samples: 128,
    quotaRemaining: 860,
    quotaTotal: 1000,
    poolPriority: 1,
    sortOrder: 1
  },
  {
    id: 'glm-4.6v',
    name: 'GLM 4.6V',
    provider: '智谱 AI',
    version: '4.6v',
    capabilities: ['视觉理解', '五维点评'],
    visionEnabled: true,
    reviewEnabled: true,
    orgId: '',
    health: REVIEW_MODEL_HEALTH.failed,
    healthNote: '调用返回 request_invalid_parameter，暂不可用',
    p95Ms: null,
    p95Samples: 0,
    quotaRemaining: 480,
    quotaTotal: 1000,
    poolPriority: 4,
    sortOrder: 2
  },
  {
    id: 'qwen3-vl-plus',
    name: '通义千问 VL Plus',
    provider: '阿里云百炼',
    version: 'qwen3-vl-plus',
    capabilities: ['视觉理解', '五维点评', '长上下文'],
    visionEnabled: true,
    reviewEnabled: true,
    orgId: '',
    health: REVIEW_MODEL_HEALTH.ok,
    healthNote: '近 7 天健康检查全部通过',
    p95Ms: 26400,
    p95Samples: 96,
    quotaRemaining: 1200,
    quotaTotal: 1500,
    poolPriority: 2,
    sortOrder: 3
  },
  {
    id: 'doubao-seed-1.6-vision',
    name: '豆包 Seed 1.6 视觉',
    provider: '火山引擎',
    version: '1.6-vision',
    capabilities: ['视觉理解', '五维点评'],
    visionEnabled: true,
    reviewEnabled: false,
    orgId: '',
    health: REVIEW_MODEL_HEALTH.ok,
    healthNote: '近 7 天健康检查全部通过',
    p95Ms: 15200,
    p95Samples: 74,
    quotaRemaining: 640,
    quotaTotal: 1000,
    poolPriority: 5,
    sortOrder: 4
  },
  {
    id: 'gpt-5-vision',
    name: 'GPT-5 Vision',
    provider: 'OpenAI 兼容',
    version: '2026-08',
    capabilities: ['视觉理解', '五维点评'],
    visionEnabled: true,
    reviewEnabled: true,
    orgId: '',
    health: REVIEW_MODEL_HEALTH.ok,
    healthNote: '近 7 天健康检查全部通过',
    p95Ms: 21500,
    p95Samples: 41,
    quotaRemaining: 0,
    quotaTotal: 800,
    poolPriority: 3,
    sortOrder: 5
  },
  {
    id: 'glm-text-max',
    name: 'GLM 文本 Max',
    provider: '智谱 AI',
    version: 'text-max',
    capabilities: ['文本生成'],
    visionEnabled: false,
    reviewEnabled: false,
    orgId: '',
    health: REVIEW_MODEL_HEALTH.ok,
    healthNote: '近 7 天健康检查全部通过',
    p95Ms: 6800,
    p95Samples: 210,
    quotaRemaining: 2000,
    quotaTotal: 2000,
    poolPriority: 9,
    sortOrder: 6
  }
];

const text = (value) => String(value === null || value === undefined ? '' : value).trim();

const nullableNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const positiveNumber = (value) => {
  const parsed = nullableNumber(value);
  return parsed !== null && parsed > 0 ? parsed : 0;
};

const bool = (value) => value === true;

/** 归一化一条模型目录记录：缺字段补默认、认不出的健康状态按失败处理（fail-safe，永不抛错）。 */
export function normalizeReviewModel(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = text(source.id || source.modelId || source.model);
  const health = text(source.health) === REVIEW_MODEL_HEALTH.ok ? REVIEW_MODEL_HEALTH.ok : REVIEW_MODEL_HEALTH.failed;
  const capabilities = (Array.isArray(source.capabilities) ? source.capabilities : [])
    .map((item) => text(item))
    .filter(Boolean);
  return {
    id,
    name: text(source.name) || id || '未命名模型',
    provider: text(source.provider),
    version: text(source.version),
    capabilities,
    // 视觉理解能力是否启用：显式写了 `capabilities` 就按标签认，否则看 `visionEnabled`。
    visionEnabled: source.visionEnabled === undefined
      ? capabilities.includes('视觉理解')
      : bool(source.visionEnabled),
    reviewEnabled: bool(source.reviewEnabled),
    orgId: text(source.orgId),
    health,
    healthNote: text(source.healthNote),
    p95Ms: nullableNumber(source.p95Ms),
    p95Samples: positiveNumber(source.p95Samples),
    quotaRemaining: nullableNumber(source.quotaRemaining) ?? 0,
    quotaTotal: nullableNumber(source.quotaTotal) ?? 0,
    poolPriority: nullableNumber(source.poolPriority) ?? 99,
    sortOrder: nullableNumber(source.sortOrder) ?? 99,
    // 单价：目录里没写就用成本估算表（`REVIEW_MODEL_PRICES`）的那一份 —— 同一模型两个价会让人不信。
    price: normalizePrice(source.price) || normalizePrice(REVIEW_MODEL_PRICES[id])
  };
}

const normalizePrice = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : null;
  if (!source) return null;
  const inputPer1k = nullableNumber(source.inputPer1k);
  const outputPer1k = nullableNumber(source.outputPer1k);
  if (inputPer1k === null && outputPer1k === null) return null;
  return { inputPer1k: inputPer1k ?? 0, outputPer1k: outputPer1k ?? 0, currency: text(source.currency) || 'CNY' };
};

/** 读取模型目录：本机镜像为空 / 读坏时回落种子（与技能库同口径）。 */
export function loadReviewModels() {
  const seed = seedReviewModels.map(normalizeReviewModel);
  if (typeof window === 'undefined') return seed;
  let parsed = null;
  try { parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'); } catch { parsed = null; }
  if (!Array.isArray(parsed) || !parsed.length) return seed;
  const list = parsed.map(normalizeReviewModel).filter((item) => item.id);
  return list.length ? list : seed;
}

/** 落盘模型目录（管理端维护模型池时写它；本故事只读也不影响）。 */
export function persistReviewModels(models) {
  if (typeof window === 'undefined') return;
  const list = (Array.isArray(models) ? models : []).map(normalizeReviewModel).filter((item) => item.id);
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* 配额满时静默降级 */ }
}

// ---------------------------------------------------------------------------
// 单价 / 耗时 / 能力标签的展示口径（界面与断言读同一份，不要在 JSX 里再拼一遍）
// ---------------------------------------------------------------------------

/** 单价的展示文本：`¥0.0015 / 1K 输入 · ¥0.006 / 1K 输出`；没有单价返回空串。 */
export function reviewModelPriceText(model) {
  const price = normalizeReviewModel(model).price;
  if (!price) return '';
  return `${formatMoney(price.currency, price.inputPer1k)} / 1K 输入 · ${formatMoney(price.currency, price.outputPer1k)} / 1K 输出`;
}

function formatMoney(currency, value) {
  const symbol = currency === 'CNY' ? '¥' : `${currency} `;
  const trimmed = Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `${symbol}${trimmed || '0'}`;
}

/** 近期 P95 耗时的展示文本：`约 19.8 秒` / `暂无样本`。 */
export function reviewModelP95Text(ms) {
  const value = nullableNumber(ms);
  if (value === null) return '暂无样本';
  if (value < 1000) return `约 ${Math.round(value)} 毫秒`;
  return `约 ${(value / 1000).toFixed(1)} 秒`;
}

/** 能力标签的展示文本（顿号连接）。 */
export function reviewModelCapabilityText(model) {
  return normalizeReviewModel(model).capabilities.join(' · ');
}

/** 版本行：`供应商 · 版本`，缺项跳过。 */
export function reviewModelVendorText(model) {
  const item = normalizeReviewModel(model);
  return [item.provider, item.version].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// 可选性判定（选择器与「开始生成」拦截的唯一判据）
// ---------------------------------------------------------------------------

/**
 * 一个模型在**本机构**下的可选性。返回 `{ selectable, reasonKey, reasonText }`：
 *  - 视觉理解未启用 → 不进选择器（`reviewModelOptions` 直接把它排除在 rows 之外）；
 *  - 机构未授权点评（`reviewEnabled` 为假，或 `orgId` 非空且与本机构不一致）→ 置灰「未授权」；
 *  - 健康检查失败 → 置灰「健康检查失败」；
 *  - 额度耗尽（`quotaRemaining <= 0`）→ 置灰「额度不足」。
 * 判定顺序固定（`REVIEW_MODEL_REASONS` 的键序），同一模型只报**第一个**原因。
 */
export function reviewModelAvailability(model, { orgId = '' } = {}) {
  const item = normalizeReviewModel(model);
  const org = text(orgId);
  const reason = !item.visionEnabled ? REVIEW_MODEL_REASONS.vision
    : !item.reviewEnabled || (item.orgId && item.orgId !== org) ? REVIEW_MODEL_REASONS.auth
      : item.health === REVIEW_MODEL_HEALTH.failed ? REVIEW_MODEL_REASONS.health
        : item.quotaRemaining <= 0 ? REVIEW_MODEL_REASONS.quota
          : REVIEW_MODEL_REASONS.ok;
  return {
    selectable: reason === REVIEW_MODEL_REASONS.ok,
    reasonKey: reason,
    reasonText: reason === REVIEW_MODEL_REASONS.ok ? '' : REVIEW_MODEL_REASON_LABELS[reason] || reason
  };
}

/**
 * 选择器的选项行（**只含视觉理解已启用的模型**）+ 计数与说明。
 * 返回：
 *  - `rows`：可渲染的行（含 `selectable` / `reasonKey` / `reasonText` 与全部展示字段）；
 *  - `selectable`：可选的子集（「只列出视觉理解已启用 + 机构已授权 + 健康 + 额度足」）；
 *  - `excluded`：因**视觉理解未启用**而不列出的模型（界面在脚注里说明有几个、为什么）；
 *  - `note`：顶部固定说明；`summaryText`：`可选 2 个 · 另有 2 个不可用`。
 */
export function reviewModelOptions(models, { orgId = '' } = {}) {
  const list = (Array.isArray(models) ? models : []).map(normalizeReviewModel).filter((item) => item.id);
  const sorted = [...list].sort((a, b) => (a.sortOrder - b.sortOrder) || a.id.localeCompare(b.id));
  const rows = sorted.filter((item) => item.visionEnabled).map((item) => reviewModelOptionRow(item, { orgId }));
  const selectable = rows.filter((row) => row.selectable);
  const excluded = sorted.filter((item) => !item.visionEnabled).map((item) => ({
    id: item.id,
    name: item.name,
    reasonKey: REVIEW_MODEL_REASONS.vision,
    reasonText: REVIEW_MODEL_REASON_LABELS[REVIEW_MODEL_REASONS.vision]
  }));
  const unavailable = rows.length - selectable.length;
  return {
    rows,
    selectable,
    excluded,
    note: REVIEW_MODEL_PICKER_NOTE,
    summaryText: `可选 ${selectable.length} 个${unavailable ? ` · ${unavailable} 个暂不可用（见原因）` : ''}${excluded.length ? ` · 另有 ${excluded.length} 个未列出` : ''}`,
    emptyText: selectable.length ? '' : REVIEW_MODEL_EMPTY_TEXT
  };
}

/** 一行选项的展示数据（含判据结果）。界面只渲染它，不再自己判断。 */
export function reviewModelOptionRow(model, { orgId = '' } = {}) {
  const item = normalizeReviewModel(model);
  const availability = reviewModelAvailability(item, { orgId });
  return {
    id: item.id,
    name: item.name,
    provider: item.provider,
    version: item.version,
    capabilities: item.capabilities,
    capabilityText: reviewModelCapabilityText(item),
    vendorText: reviewModelVendorText(item),
    priceText: reviewModelPriceText(item),
    p95Ms: item.p95Ms,
    p95Text: reviewModelP95Text(item.p95Ms),
    p95Samples: item.p95Samples,
    health: item.health,
    healthLabel: REVIEW_MODEL_HEALTH_LABELS[item.health] || item.health,
    healthNote: item.healthNote,
    quotaRemaining: item.quotaRemaining,
    quotaTotal: item.quotaTotal,
    quotaText: formatQuotaText(item),
    // 池路由的命中顺序（行里必须带着它，否则 `reviewModelPoolRouteRow` 排序时读不到）。
    poolPriority: item.poolPriority,
    sortOrder: item.sortOrder,
    selectable: availability.selectable,
    reasonKey: availability.reasonKey,
    reasonText: availability.reasonText
  };
}

function formatQuotaText(model) {
  if (!model.quotaTotal) return `剩余额度 ${model.quotaRemaining}`;
  return `剩余额度 ${model.quotaRemaining} / ${model.quotaTotal}`;
}

/**
 * 「由模型池自动路由」那一行：伪 id 是 `pool-route`。
 * 池里一个可用模型都没有时这一行同样置灰（原因取第一个不可用模型的原因）。
 */
export function reviewModelPoolRouteRow(models, { orgId = '' } = {}) {
  const options = reviewModelOptions(models, { orgId });
  const hit = poolRouteHit(options);
  return {
    id: REVIEW_MODEL_POOL_ROUTE_ID,
    name: '由模型池自动路由',
    provider: '平台模型池',
    version: '',
    capabilities: [],
    capabilityText: '',
    vendorText: '平台模型池',
    priceText: hit ? reviewModelPriceText(hit) : '',
    p95Ms: hit ? hit.p95Ms : null,
    p95Text: hit ? hit.p95Text : '暂无样本',
    p95Samples: hit ? hit.p95Samples : 0,
    health: hit ? hit.health : REVIEW_MODEL_HEALTH.failed,
    healthLabel: hit ? hit.healthLabel : REVIEW_MODEL_HEALTH_LABELS[REVIEW_MODEL_HEALTH.failed],
    healthNote: REVIEW_MODEL_POOL_ROUTE_NOTE,
    quotaRemaining: hit ? hit.quotaRemaining : 0,
    quotaTotal: hit ? hit.quotaTotal : 0,
    quotaText: hit ? hit.quotaText : '',
    selectable: Boolean(hit),
    reasonKey: hit ? REVIEW_MODEL_REASONS.ok : (options.rows[0]?.reasonKey || REVIEW_MODEL_REASONS.health),
    reasonText: hit ? '' : '模型池当前没有可用模型',
    hitModelId: hit ? hit.id : '',
    hitName: hit ? hit.name : ''
  };
}

/** 池路由的命中规则：**可选的**模型里按 `poolPriority` 升序（同优先级按 sortOrder / id）。 */
function poolRouteHit(options) {
  return [...options.selectable].sort(comparePool)[0] || null;
}

function comparePool(a, b) {
  const pa = nullableNumber(a.poolPriority) ?? 99;
  const pb = nullableNumber(b.poolPriority) ?? 99;
  if (pa !== pb) return pa - pb;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * 本次点评到底用哪个模型 —— 选择器的事实在这一处结算（界面、请求、轨迹读同一份）。
 * `selection` 是老师的选择：`''` / `pool-route` = 由模型池自动路由，其余按模型 id 认。
 * 老师选的模型**当前不可用**时（例如健康检查刚失败）回落到池路由，并把回落原因说清楚 ——
 * 不静默换模型，也不拿一个不可用的 id 去发请求。
 */
export function reviewModelResolve(models, { selection = '', orgId = '' } = {}) {
  const options = reviewModelOptions(models, { orgId });
  const pool = reviewModelPoolRouteRow(models, { orgId });
  const picked = text(selection);
  const wantPool = !picked || picked === REVIEW_MODEL_POOL_ROUTE_ID;
  if (wantPool) {
    return {
      ok: Boolean(pool.selectable),
      choice: REVIEW_MODEL_POOL_ROUTE_ID,
      modelId: pool.hitModelId,
      source: REVIEW_MODEL_SOURCES.poolRoute,
      sourceLabel: REVIEW_MODEL_SOURCE_LABELS[REVIEW_MODEL_SOURCES.poolRoute],
      row: options.rows.find((row) => row.id === pool.hitModelId) || null,
      poolRow: pool,
      options,
      fallbackFrom: '',
      reasonText: pool.selectable ? '' : pool.reasonText,
      note: pool.selectable
        ? `本次由模型池自动路由：命中 ${pool.hitName}（优先级最高且可用）`
        : REVIEW_MODEL_EMPTY_TEXT
    };
  }
  const row = options.rows.find((item) => item.id === picked) || null;
  if (row && row.selectable) {
    return {
      ok: true,
      choice: row.id,
      modelId: row.id,
      source: REVIEW_MODEL_SOURCES.teacherPick,
      sourceLabel: REVIEW_MODEL_SOURCE_LABELS[REVIEW_MODEL_SOURCES.teacherPick],
      row,
      poolRow: pool,
      options,
      fallbackFrom: '',
      reasonText: '',
      note: `本次使用 ${row.name}（${row.vendorText || '供应商未登记'}）· 老师指定`
    };
  }
  const fallbackReason = row ? row.reasonText : '该模型不在可选目录里';
  return {
    ok: Boolean(pool.selectable),
    choice: REVIEW_MODEL_POOL_ROUTE_ID,
    modelId: pool.hitModelId,
    source: REVIEW_MODEL_SOURCES.poolRoute,
    sourceLabel: REVIEW_MODEL_SOURCE_LABELS[REVIEW_MODEL_SOURCES.poolRoute],
    row: options.rows.find((item) => item.id === pool.hitModelId) || null,
    poolRow: pool,
    options,
    fallbackFrom: picked,
    reasonText: fallbackReason,
    note: pool.selectable
      ? `老师上次选用的「${picked}」当前不可用（${fallbackReason}），已回落到模型池自动路由：命中 ${pool.hitName}`
      : REVIEW_MODEL_EMPTY_TEXT
  };
}

// ---------------------------------------------------------------------------
// 「健康状态最好的可用模型」（US-108b 的失败恢复推荐）
// ---------------------------------------------------------------------------

/**
 * 健康状态排序（只在**可选**模型之间比，越靠前越健康）：
 *  ① 健康状态（`ok` 优先 —— 可选已经要求健康通过，这一步是给脏数据兜底）；
 *  ② 近期 P95 耗时（越短越好；没有样本的排最后 —— 「未知」不该冒充「最快」）；
 *  ③ 池优先级 → 排序号 → id（确定性：同样的目录永远给同一个推荐）。
 */
function compareModelHealth(a, b) {
  const ha = a.health === REVIEW_MODEL_HEALTH.ok ? 0 : 1;
  const hb = b.health === REVIEW_MODEL_HEALTH.ok ? 0 : 1;
  if (ha !== hb) return ha - hb;
  const pa = nullableNumber(a.p95Ms) ?? Number.POSITIVE_INFINITY;
  const pb = nullableNumber(b.p95Ms) ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  const qa = nullableNumber(a.poolPriority) ?? 99;
  const qb = nullableNumber(b.poolPriority) ?? 99;
  if (qa !== qb) return qa - qb;
  const sa = nullableNumber(a.sortOrder) ?? 99;
  const sb = nullableNumber(b.sortOrder) ?? 99;
  if (sa !== sb) return sa - sb;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * 当前**健康状态最好的可用模型**（连续失败 3 次时的推荐，见 `data/reviewRecovery.js`）。
 *
 * 返回 `{ row, ranked, alternatives, ok, id, name, text, healthText }`：
 *  - `ranked`：全部可选模型按健康状态的排序（面板 / 断言可以看排序依据）；
 *  - `alternatives`：把 `excludeId`（通常 = 本次失败的模型）去掉之后的排序结果；
 *  - `row`：推荐的那一条（没有可用模型时为 null）；`text` / `healthText` 是可直接渲染的读数。
 *
 * 不要把 `excludeId` 理解成「不许推荐它」：只在**有别的可用模型**时才让位给次优的，
 * 一个可用模型都没有时 `row` 就是 null（界面按「稍后再来 / 联系管理员」处理）。
 */
export function reviewModelHealthiest(models, { orgId = '', excludeId = '' } = {}) {
  const options = reviewModelOptions(models, { orgId });
  const ranked = [...options.selectable].sort(compareModelHealth);
  const excluded = text(excludeId);
  const alternatives = excluded ? ranked.filter((row) => row.id !== excluded) : [...ranked];
  const row = alternatives[0] || null;
  return {
    ok: Boolean(row),
    row,
    ranked,
    alternatives,
    id: row ? row.id : '',
    name: row ? row.name : '',
    text: row ? `${row.name}（${row.vendorText || '供应商未登记'}）` : '',
    healthText: row ? `健康状态：${row.healthLabel} · 近期 P95 ${row.p95Text}` : ''
  };
}

// ---------------------------------------------------------------------------
// 老师的个人默认（「下次进入默认选中」）
// ---------------------------------------------------------------------------

const cleanTeacherKey = (value) => text(value);

/** 归一化一份默认 map（老师键 → 模型 id；'' = 由模型池自动路由）。永不抛错。 */
export function normalizeReviewModelDefaults(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const next = {};
  Object.keys(source).forEach((key) => {
    const teacher = cleanTeacherKey(key);
    if (!teacher) return;
    next[teacher] = text(source[key]);
  });
  return next;
}

/** 某位老师的个人默认（没记过返回空串 = 由模型池自动路由）。 */
export function reviewModelDefaultId(defaults, teacherKey) {
  const map = normalizeReviewModelDefaults(defaults);
  const key = cleanTeacherKey(teacherKey);
  if (!key) return '';
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : '';
}

/**
 * 写一位老师的个人默认，返回新的 map。
 * 由模型池自动路由会**显式存空串**（不是删条目）：老师选过「自动路由」也是一次选择，
 * 下次进入要能默认选中它（两者行为一致，但语义上要能区分「选过」与「没选过」）。
 */
export function withReviewModelDefault(defaults, teacherKey, modelId) {
  const map = normalizeReviewModelDefaults(defaults);
  const key = cleanTeacherKey(teacherKey);
  if (!key) return map;
  return { ...map, [key]: text(modelId) };
}

export function loadReviewModelDefaults() {
  if (typeof window === 'undefined') return {};
  let parsed = null;
  try { parsed = JSON.parse(window.localStorage.getItem(DEFAULT_KEY) || 'null'); } catch { parsed = null; }
  return normalizeReviewModelDefaults(parsed);
}

export function persistReviewModelDefaults(defaults) {
  if (typeof window === 'undefined') return;
  const map = normalizeReviewModelDefaults(defaults);
  try { window.localStorage.setItem(DEFAULT_KEY, JSON.stringify(map)); } catch { /* 配额满时静默降级 */ }
}
