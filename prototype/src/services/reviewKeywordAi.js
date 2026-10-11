/**
 * 「用大模型补充观察词」的服务层（[第三步 US-111] / FR-147、FR-148）。
 *
 * **这是一条独立通道**：自己的提示词（`data/reviewKeywordAi.js` 的 `keywordAiPromptBundle`）、
 * 自己的参数表（下面这份 `KEYWORD_AI_PARAMS`）、自己的模型链（`keywordAiModelPlan`）。
 * 它**不 import** `services/llmReview.js` —— 第三步点评的人设 / 技能库 / 记忆文件 / 提示词模块
 * 一个字都进不来这里，点评提示词的改动也不会影响这条通道（验收原文「不复用点评的提示词」）。
 *
 * 三条硬约定：
 *  1. **返回信封而不是抛异常**（与 `generateFrameSpecV2` 同一口径）：云端不通 / 模型没吐 JSON
 *     只是 `ok: false` + 一句可读的话，草稿一个字不动、手工新增词条完全不受影响。
 *  2. **模型链逐个尝试，换档必须留痕**：默认链是「可用的文本通道模型 → 通用兜底模型」。
 *     模型级拒绝（本部署没开通这个模型，`request_invalid_parameter` 这类）才换下一档，
 *     并把每一次尝试写进 `attempts` 与 `fallbackNote`（回执上点名说明，不许静默替换）；
 *     网络 / 超时 / 未知错误**不**自动换档，交回界面让教研决定重试还是换模型。
 *  3. **提示词与原文都进信封**：`prompt`（本次请求的 system + user）与 `raw`（模型原始输出）
 *     给面板的折叠块与断言用 —— 「这条通道的提示词长什么样」不靠注释靠产物。
 */

import { cloud } from '../cloud';
import {
  KEYWORD_AI_CHANNEL,
  KEYWORD_AI_GROUP_FALLBACK,
  keywordAiErrorKind,
  keywordAiModelPlan,
  keywordAiPromptBundle,
  normalizeKeywordAiContext,
  parseKeywordAiOutput
} from '../data/reviewKeywordAi';

/**
 * 这条通道自己的参数表（**唯一真源**，与点评的 `REVIEW_MODEL_PARAMS` 是两份）：
 *  - `stream: true`：云端 SDK 只接受流式（非流式会被拒）；
 *  - `response_format: json_object`：只要一个 JSON；
 *  - `temperature` 比点评略高：想词要一点发散（点评要稳，这里是备选）。
 */
export const KEYWORD_AI_PARAMS = {
  stream: true,
  response_format: { type: 'json_object' },
  temperature: 0.6
};

/** 把云端错误码翻译成教研能看懂的话（不暴露原始英文堆栈）。 */
export function describeKeywordAiError(error) {
  const kind = keywordAiErrorKind(error);
  if (kind === 'auth') return '云服务凭据校验失败，请刷新页面后重试。';
  if (kind === 'network') return '模型服务暂时不可用（网络或超时），请稍后重试。';
  if (kind === 'model-unavailable') return '这个模型在本部署不可用（未开通或参数不被接受），换一个模型再试。';
  const message = String(error?.message || '').trim();
  return message && !/[a-z]{4,}\s[a-z]{4,}/i.test(message) && message.length <= 60
    ? message
    : '观察词生成失败：模型服务暂时不可用，请稍后重试或换一个模型。';
}

/** 单次调用：把这一档模型的输出收全（流式拼起来），**不解析**。 */
async function callKeywordAiModel({ model, prompt, signal }) {
  let text = '';
  let usage = null;
  for await (const chunk of cloud.llm.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ],
    ...KEYWORD_AI_PARAMS,
    signal
  })) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) text += delta.content;
    if (chunk.usage) usage = chunk.usage;
  }
  return { text, usage };
}

/**
 * 生成观察词候选。
 *
 * @param {object} options
 * @param {object} [options.context] 上下文（课程类型 / 年龄段 / 画种 / 目标分组 / 期望数量）
 * @param {string[]} [options.existingTerms] 模板里已有的词（交给模型避开，客户端仍会再判一次）
 * @param {object[]} [options.models] 模型目录（`data/reviewModels.js` 那份；缺省拿不到模型 → 直接失败并说明）
 * @param {string} [options.model] 明确指定的模型（换模型 = 钉住它，不再走默认链）
 * @param {string} [options.orgId] 当前机构（授权过滤）
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ok:boolean, model:string, requestedModel:string, fallbackNote:string,
 *   attempts:object[], candidates:object[], raw:string, issues:string[], message:string,
 *   prompt:object, plan:object, elapsedMs:number, usage:object|null, context:object}>}
 *   永远 resolve（不抛错）。
 */
export async function generateKeywordCandidates({
  context: rawContext = {},
  existingTerms = [],
  models = [],
  model = '',
  orgId = '',
  signal
} = {}) {
  const context = normalizeKeywordAiContext(rawContext);
  const plan = keywordAiModelPlan({ models, explicit: model, orgId });
  const prompt = keywordAiPromptBundle(context, { existingTerms, model: plan.defaultModel });
  const started = Date.now();
  const base = {
    model: plan.defaultModel,
    requestedModel: plan.defaultModel,
    fallbackNote: '',
    attempts: [],
    candidates: [],
    raw: '',
    issues: [],
    message: '',
    prompt,
    plan,
    context,
    elapsedMs: 0,
    usage: null
  };
  if (!plan.chain.length) {
    return {
      ...base,
      ok: false,
      model: '',
      requestedModel: '',
      message: plan.emptyText || '当前没有可用模型，请先到「模型供应商」检查健康与额度。',
      elapsedMs: Date.now() - started
    };
  }
  const attempts = [];
  let raw = '';
  let usage = null;
  let usedModel = plan.chain[0];
  for (let index = 0; index < plan.chain.length; index += 1) {
    const candidateModel = plan.chain[index];
    try {
      const result = await callKeywordAiModel({ model: candidateModel, prompt, signal });
      attempts.push({ model: candidateModel, ok: true, kind: 'ok', text: '' });
      raw = result.text;
      usage = result.usage;
      usedModel = candidateModel;
      break;
    } catch (error) {
      const kind = keywordAiErrorKind(error);
      attempts.push({ model: candidateModel, ok: false, kind, text: describeKeywordAiError(error) });
      const last = index === plan.chain.length - 1;
      // 只有在「这一档是模型本身不可用」且「后面还有档」时才换档；其余错误原样交回界面。
      if (kind !== 'model-unavailable' || last) {
        return {
          ...base,
          ok: false,
          model: candidateModel,
          requestedModel: plan.chain[0],
          attempts,
          message: `${describeKeywordAiError(error)}（模型 ${candidateModel}；手工新增词条不受影响。）`,
          elapsedMs: Date.now() - started
        };
      }
    }
  }
  const fellBack = attempts.length > 1 && attempts.slice(0, -1).some((item) => !item.ok);
  const fallbackNote = fellBack
    ? `文本通道模型 ${attempts[0].model} 在本部署不可用，已自动改用 ${usedModel}`
    : '';
  const parsed = parseKeywordAiOutput(raw, { groupFallback: context.targetGroup || KEYWORD_AI_GROUP_FALLBACK });
  const envelope = {
    ...base,
    ok: parsed.ok,
    model: usedModel,
    requestedModel: plan.chain[0],
    fallbackNote,
    attempts,
    candidates: parsed.candidates,
    raw,
    issues: parsed.issues,
    message: parsed.ok ? '' : parsed.message,
    elapsedMs: Date.now() - started,
    usage
  };
  return envelope;
}

/** 通道摘要（面板顶端那一行读数：这条通道是谁、走的哪条链）。 */
export function keywordAiChannelText(plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  return `${KEYWORD_AI_CHANNEL.label}（提示词 ${KEYWORD_AI_CHANNEL.promptId}）· 模型链 ${(source.chain || []).join(' → ') || '无可用模型'}`;
}
