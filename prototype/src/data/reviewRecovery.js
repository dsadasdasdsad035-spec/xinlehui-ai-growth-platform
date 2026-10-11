// 第三步「五维点评」的归档强校验与生成失败后的恢复动作（[第三步 US-108b] / F-REVIEW-TRACE-07）。
//
// 两份产物，都是**零依赖纯函数**（只 import 同层的 data 模块，不碰 DOM / 网络，
// 可以直接用 Node 跑断言，见 prototype/AGENTS.md）：
//  1. `evaluateReviewArchiveGate(...)`：归档按钮的前置校验 —— **五个维度全部非空 + 本次生成轨迹成功**。
//     校验清单、被禁用时的具体原因、`go(4)` 与 `archiveRecord` 的拦截文案全部读它；
//     界面只渲染它的产物，**不要在组件里另写一份「为什么不能归档」的判断**（两处一定会漂）。
//  2. `reviewFailureStreakView(...)`：生成失败后的连续失败读数与「推荐健康状态最好的可用模型」文案。
//
// 「归档强校验」与「失败恢复」是同一条口径的两端：素材（作品 / 照片）与老师的手工输入
// （观察词、逐维改过的正文、老师补充观察）**永远不因为一次失败而丢**，被拦下的只有
// 「把没成功的生成交给家长」这一个动作（US-108a：正文只能来自大模型）。

import { REVIEW_DIMENSION_NAMES } from './reviewDetailPanel';
import { REVIEW_MODEL_POOL_ROUTE_ID, reviewModelHealthiest } from './reviewModels';
import { REVIEW_TRACE_STATUS } from './reviewTrace';

const text = (value) => String(value === null || value === undefined ? '' : value).trim();

// ---------------------------------------------------------------------------
// 归档强校验（五维非空 + 轨迹成功）
// ---------------------------------------------------------------------------

/** 校验清单的顺序真源：五维逐维 + 一条轨迹状态（验收原文「五个维度全部非空且轨迹状态为 success」）。 */
export const REVIEW_ARCHIVE_GATE_DIMENSIONS = REVIEW_DIMENSION_NAMES;

/** 全部通过时的一句话（面板上与断言读同一份）。 */
export const REVIEW_ARCHIVE_GATE_READY_TEXT = '五维内容完整、本次生成轨迹成功，可以归档给家长。';

/** 轨迹状态 → 「为什么还不能归档」的可读原因（读的是 `data/reviewTrace.js` 的状态枚举）。 */
export function reviewArchiveTraceReason(status) {
  const value = text(status);
  if (value === REVIEW_TRACE_STATUS.success) return '';
  if (value === REVIEW_TRACE_STATUS.running) return '本次生成还没有收束：请等模型生成结束（或先停止）再归档。';
  if (value === REVIEW_TRACE_STATUS.failed) return '本次生成失败了：请先重试或换一个模型重试，生成成功后才能归档。';
  if (value === REVIEW_TRACE_STATUS.aborted) return '本次生成被停止了：重新生成成功后才能归档。';
  return '本次点评还没有生成成功：点击「开始生成点评」，生成成功后才能归档。';
}

/**
 * 归档前的强校验（验收原文：五个维度全部非空且轨迹状态为 success，否则禁用并说明原因）。
 *
 * 返回 `{ ok, checks, blocking, reasonText, summary, headline, mode }`：
 *  - `checks`：逐项 `{ id, label, ok, reason }`（个人反馈 = 五维逐维 + 轨迹；班级反馈 = 已生成）；
 *  - `reasonText`：**第一条**没过的原因（按钮上的 `data-archive-block-reason` 与拦截 toast 读它）；
 *  - `summary`：逐条列全的原因（面板清单头部与需要完整原因的地方读它）；
 *  - `headline`：面板头部的一句话（通过时就是那句「可以归档」，没通过时给「还有几项」）。
 *
 * 班级反馈的正文来自课程目标模板（不是模型输出），它的五维就是「本次点评是否已生成」这一条；
 * 个人反馈必须逐维检查，并且要求本次生成轨迹是 `success`（失败 / 停止 / 生成中都不许归档）。
 */
export function evaluateReviewArchiveGate({ mode = '个人反馈', reviews = null, generated = false, traceStatus = '' } = {}) {
  const classMode = text(mode) === '班级反馈';
  const source = reviews && typeof reviews === 'object' ? reviews : {};
  const checks = classMode
    ? [{
      id: 'generated',
      label: '本次点评已生成',
      ok: generated === true,
      reason: '班级课程反馈需要先生成本次点评内容，生成成功后才能归档给家长。'
    }]
    : [
      ...REVIEW_ARCHIVE_GATE_DIMENSIONS.map((name) => ({
        id: `dimension:${name}`,
        label: `${name}已有内容`,
        ok: Boolean(text(source[name])),
        reason: `「${name}」还是空的：先生成点评，或在这一栏手动写下本次观察。`
      })),
      {
        id: 'trace',
        label: '本次生成轨迹成功',
        ok: text(traceStatus) === REVIEW_TRACE_STATUS.success,
        reason: reviewArchiveTraceReason(traceStatus)
      }
    ];
  const blocking = checks.filter((check) => !check.ok);
  const ok = blocking.length === 0;
  return {
    ok,
    mode: text(mode),
    checks,
    blocking,
    reasonText: ok ? '' : blocking[0].reason,
    summary: ok ? REVIEW_ARCHIVE_GATE_READY_TEXT : `还不能归档：${blocking.map((check) => check.reason).join('；')}`,
    headline: ok ? REVIEW_ARCHIVE_GATE_READY_TEXT : `还不能归档给家长：还有 ${blocking.length} 项没通过（见下方「归档前的校验清单」）。`
  };
}

// ---------------------------------------------------------------------------
// 失败态的三个动作
// ---------------------------------------------------------------------------

/**
 * 失败态的固定三动作（验收原文：重试、换模型重试、稍后再来）。
 * `id` 是界面的 `data-recovery-action`，`hint` 是动作说明（title），三个动作都**不清任何输入**。
 */
export const REVIEW_RECOVERY_ACTIONS = [
  { id: 'retry', label: '重试', hint: '用同一个模型再生成一次；素材、观察词与已经写下的补充观察都不会动。' },
  { id: 'switch-model', label: '换模型重试', hint: '自动改用健康状态最好的可用模型，立即重新生成。' },
  { id: 'later', label: '稍后再来', hint: '收起这条失败提示，保留素材、模型选择与全部填写内容；想继续时再点「开始生成点评」。' }
];

export const REVIEW_RECOVERY_ACTION_LABELS = Object.fromEntries(REVIEW_RECOVERY_ACTIONS.map((action) => [action.id, action.label]));

/** 「稍后再来」之后给老师的那句话：说明什么都没丢（验收原文「不丢失已填写的老师补充观察」）。 */
export const REVIEW_FAILURE_KEEP_NOTE = '素材、观察词与已填写的老师补充观察都还在这里。';

/** 失败面板顶部的那句兜底文案（`stream.message` 为空时用）。 */
export const REVIEW_FAILURE_TITLE_FALLBACK = '这一次生成没有成功。';

// ---------------------------------------------------------------------------
// 连续失败与「推荐健康状态最好的可用模型」
// ---------------------------------------------------------------------------

/** 连续失败到这个次数，就要提示「可能是模型服务波动」并推荐最健康的可用模型。 */
export const REVIEW_FAILURE_STREAK_LIMIT = 3;

/** 「服务波动」那句话的固定开头（断言与界面读同一份，避免两处各写一遍）。 */
export const REVIEW_FAILURE_STREAK_PREFIX = '可能是模型服务波动';

/**
 * 连续失败的提示视图（验收原文：连续失败 3 次时提示服务波动并推荐当前健康状态最好的可用模型）。
 *
 * `recommendation` 是 `reviewModelHealthiest()` 的产物（可能为 null = 一个可用模型都没有）；
 * `currentModelId` 是本次真正在用的模型（与推荐相同就如实说「当前已经在用最健康的那一个」，
 * 不要建议老师「换」成一个他已经选着的模型）。
 */
export function reviewFailureStreakView({ failures = 0, recommendation = null, currentModelId = '' } = {}) {
  const count = Math.max(0, Math.floor(Number(failures) || 0));
  const show = count >= REVIEW_FAILURE_STREAK_LIMIT;
  const rec = recommendation && recommendation.row ? recommendation : null;
  const same = Boolean(rec && text(rec.id) === text(currentModelId));
  const message = show ? `连续 ${count} 次生成失败，${REVIEW_FAILURE_STREAK_PREFIX}，不是你的素材或填写内容有问题。` : '';
  const recommendationText = !show ? ''
    : !rec
      ? '当前没有其它可用的点评模型，建议稍后再来，或联系机构管理员检查模型健康、授权与额度。'
      : same
        ? `当前已经在用可用模型里健康状态最好的「${rec.name}」，建议稍后再来，或联系机构管理员检查模型服务。`
        : `建议「换模型重试」：可用模型里健康状态最好的是「${rec.name}」（${rec.row.vendorText || '供应商未登记'}，近期 P95 ${rec.row.p95Text}）。`;
  return {
    show,
    count,
    limit: REVIEW_FAILURE_STREAK_LIMIT,
    message,
    recommendationText,
    recommendId: rec ? rec.id : '',
    recommendName: rec ? rec.name : '',
    same
  };
}

/**
 * 「换模型重试」的落点：**自动**选一个与当前不同的、健康状态最好的可用模型。
 *
 * 三条回落（都不抛错，界面按结果给可读文案）：
 *  ① 有别的可用模型 → 用其中健康状态最好的那个（排除当前这个）；
 *  ② 只剩当前这一个可用 → 改由模型池自动路由再试一次（至少换的是路由策略）；
 *  ③ 连一个可用模型都没有 → 返回 null（界面提示「稍后再来 / 联系管理员」）。
 */
export function reviewSwitchModelTarget(models, { orgId = '', currentModelId = '', currentChoice = '' } = {}) {
  const best = reviewModelHealthiest(models, { orgId, excludeId: currentModelId });
  const current = text(currentChoice) || REVIEW_MODEL_POOL_ROUTE_ID;
  if (best.row) {
    return {
      choice: best.row.id,
      row: best.row,
      viaPoolRoute: false,
      note: `已改用健康状态最好的可用模型「${best.name}」重新生成。`
    };
  }
  if (current !== REVIEW_MODEL_POOL_ROUTE_ID) {
    return {
      choice: REVIEW_MODEL_POOL_ROUTE_ID,
      row: null,
      viaPoolRoute: true,
      note: '当前只剩这一个可用模型，已改由模型池自动路由重试。'
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 错误文案（不暴露原始错误码）
// ---------------------------------------------------------------------------

/** 认不出可读说法时的兜底句子（不含任何错误码 / 状态码）。 */
export const REVIEW_FAILURE_FALLBACK_TEXT = '智能点评暂时不可用，请稍后重试。';

/**
 * 原始错误里**不允许**透给老师的那些形状（验收原文：不暴露原始错误码）：
 *  - `status code 504` / `HTTP 502` / 裸的 `[45]xx` 数字码；
 *  - 云端错误码（`gateway_timeout` / `request_invalid_parameter` 这类 snake_case / UPPER_SNAKE）；
 *  - `error code` / `errno` / `code:` 这类字段名。
 */
export const REVIEW_FAILURE_RAW_CODE_PATTERNS = [
  /status\s*code/i,
  /\bhttp\s*\/?\s*\d/i,
  /\b(4\d\d|5\d\d)\b/,
  /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/,
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/,
  /(err(or)?\s*code|errno|StatusCode|ECONN[A-Z]*)/i
];

/** 界面是中文的：一整句里连一个汉字都没有的英文堆栈 / SDK 原文同样算「不可读」。 */
export const REVIEW_FAILURE_CJK_PATTERN = /[\u4e00-\u9fff]/;

/** 一段文本里有没有原始错误码的形状（面板上要显示的文案过一次它）。 */
export function containsRawReviewErrorCode(value) {
  const raw = text(value);
  if (!raw) return false;
  if (!REVIEW_FAILURE_CJK_PATTERN.test(raw)) return true;
  return REVIEW_FAILURE_RAW_CODE_PATTERNS.some((pattern) => pattern.test(raw));
}

/**
 * 把任意错误文案收敛成**老师能看懂、且不含原始错误码**的一句话。
 * 可读的说法原样保留（`describeReviewError()` 产出的那些），认不出的（404 code、网关堆栈、
 * `status code 504` 这类）一律换成兜底句 —— 老师看到的是「模型服务暂时不可用」，
 * 而不是一串他无法处理的技术细节。
 */
export function readableReviewFailureText(raw, { fallback = REVIEW_FAILURE_FALLBACK_TEXT } = {}) {
  const value = text(raw);
  if (!value) return fallback;
  if (containsRawReviewErrorCode(value)) return fallback;
  return value;
}
