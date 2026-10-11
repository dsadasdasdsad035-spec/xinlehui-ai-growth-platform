import { cloud } from '../cloud';
// 技能加载清单（US-104）：提示词里的【已启用技能】段落与详情面板的逐项技能清单
// 都读 `skillLoadout()` 的产物 —— 同一份计算，不允许两处各自过滤一遍。
import { skillLoadout } from '../data/skillLibrary';
// 维度名与顺序的唯一真源（详情面板的正文进度、写作要求与输出格式共用这一份）。
import { REVIEW_DIMENSION_NAMES } from '../data/reviewDetailPanel';
// 错误文案的收敛口径（US-108b：不向老师暴露原始错误码）——「可读文案」的唯一真源在 data 层。
import { readableReviewFailureText } from '../data/reviewRecovery';
// 提示词模块化（US-101）：system 提示词由有名字、有版本、有来源的模块拼成，
// 「加载了哪些提示词」的展示与轨迹留档都读模块清单（模块名/顺序的唯一真源在 data 层）。
import { composePromptModules, PROMPT_MODULE_IDS, PROMPT_MODULE_ORDER_FALLBACK } from '../data/promptModules';
// 推理轨迹（US-102）：一次生成的全部关键信息（模型/耗时/用量/加载清单/提示词/推理/输出原文/状态）。
// 采集在**内存里**完成，提交云端由调用方在归档那一刻做（`services/reviewTraceApi.js`）。
import {
  REVIEW_TRACE_STATUS,
  buildReviewTraceAttachments,
  createReviewTrace,
  finishReviewTrace,
  markReviewTraceContentStart,
  markReviewTraceFirstToken,
  reviewTraceErrorOf,
  startReviewTrace
} from '../data/reviewTrace';

import { REVIEW_MODEL_DEFAULT_ID, REVIEW_MODEL_SOURCES } from '../data/reviewModels';

/**
 * 云端流式点评：把人设 + 技能库 + 大模型记忆拼进 system 提示词，
 * 把作品/照片作为 image_url 传给视觉模型。
 *
 * 两个硬约束（均已实测确认）：
 *  1. stream 必须为 true —— 非流式会被 SDK 直接拒绝（request_stream_required）。
 *  2. messages[0] 必须是 system，否则调用失败。
 *
 * glm-5.3-flash 是实测可用的视觉模型；目录里的 glm-4.6v 虽然列出但调用返回
 * request_invalid_parameter，不要回退到它（US-107a 起它在模型目录里被标成「健康检查失败」）。
 */
export const REVIEW_MODEL = REVIEW_MODEL_DEFAULT_ID;

// 实测三档（同一提示词 + 同一张作品图）：
//   不设置      约 60s，思考链很长，稳定
//   'low'      约 19s，JSON 稳定解析 ← 采用
//   'minimal'  约 8s，但出现 JSON 截断导致解析失败，不可靠
// 因此固定为 'low'：既把等待压到 20 秒内，又保留可展示的思考增量。
export const REVIEW_REASONING_EFFORT = 'low';

/**
 * 真正发给模型的参数表 —— **唯一真源**：调用点用它、详情面板「模型与参数」分区也读它
 * （US-103b 的验收是「面板上看到的就是实际用的」，两处各写一份一定会漂）。
 * 改这里就等于改真实请求参数，不要在面板里另抄一份。
 */
export const REVIEW_MODEL_PARAMS = {
  stream: true,
  response_format: { type: 'json_object' },
  stream_options: { include_usage: true },
  reasoning_effort: REVIEW_REASONING_EFFORT,
  temperature: 0.4
};

const FALLBACK_SYSTEM = '你是一位儿童美术教育的成长观察者。只依据画面中真实可见的证据作答，证据不足时明确写出局限。';

// 维度名与顺序的唯一真源在 `data/reviewDetailPanel.js` 的 REVIEW_DIMENSION_NAMES
// （详情面板的正文进度按同一份键名统计，两处各写一套一定会漂移）；这里只补每维的写作说明。
const DIMENSION_INSTRUCTIONS = {
  美术能力: '80-150 字：只写画面里能指认的色彩、构图、造型或材料使用，先给一个具体优势，再给一个下一节课可以试的方向。',
  上课状态: '60-120 字：只写可观察到的投入、停顿后是否回到画面、是否主动补充细节。没有素材支撑就写明局限。',
  行为能力: '60-120 字：描述任务理解、表达、协作或整理等可观察行为，不给孩子贴标签。',
  内在状态: '60-120 字：仅记录本次课堂中可观察到的表达与变化，明确声明不作心理诊断。',
  家长建议: '80-150 字：给出 1-3 条与本次观察有关、家长今晚就能尝试的具体行动，最好包含一句可以直接照着说的问话。'
};

const DIMENSION_SPEC = REVIEW_DIMENSION_NAMES.map((name) => [name, DIMENSION_INSTRUCTIONS[name]]);

/** 写作要求里的五维说明：兜底分支与老师人设分支共用同一份文本。 */
const dimensionLines = () => DIMENSION_SPEC.map(([key, value]) => `- ${key}：${value}`).join('\n');

/**
 * 观察词候选模块（US-109）：正文永远是 `【<口径>候选清单】\n<候选正文>`。
 * `extra.keywordTemplate` 传 `data/reviewKeywordTemplates.js` 的 `keywordTemplateLoadout()` 产物时，
 * 模块的 `version` / `source` 跟着生效模板走（轨迹留档因此能复现「这一次用的是哪一版模板」）；
 * 不传时与改造前逐字符 / 逐字段一致（字符串正文 → 目录里的默认 `v1` / `观察词模板`）。
 */
function keywordCandidateModule(extra, scope) {
  const candidates = extra.keywordCandidates;
  if (!candidates) return undefined;
  const content = `【${scope}候选清单】\n${candidates}`;
  const template = extra.keywordTemplate && typeof extra.keywordTemplate === 'object' ? extra.keywordTemplate : null;
  if (!template) return content;
  const source = template.source === 'builtin'
    ? '内置兜底词表（模板未连通）'
    : `观察词模板 · ${template.name || '未命名模板'}`;
  return { content, version: template.versionText || '', source };
}

/** 兜底分支（没有老师人设）的模块内容：正文与拼装顺序都保持改造前的样子。 */
function fallbackModuleContents(extra, scope) {
  return {
    base_role: FALLBACK_SYSTEM,
    writing_rules: dimensionLines(),
    keyword_candidates: keywordCandidateModule(extra, scope),
    keyword_rules: extra.keywordCandidates ? `【${scope}选择要求】\n选 3-6 个画面里真的能被指出来的词，必须逐字复制候选清单里的词。` : undefined,
    output_format: `【输出格式】\n只输出 JSON：{"evidence":[...],"keywords":[...],"reviews":{"美术能力":"...","上课状态":"...","行为能力":"...","内在状态":"...","家长建议":"..."}}`
  };
}

/** 老师人设分支的模块内容：每段正文都是「原样进入 system 提示词」的那一段。 */
function personaModuleContents(profile, extra, scope) {
  // 技能来自独立的技能库：人设只持有被勾选的 id，真正的描述从库里取。
  // 库里停用某项后，这里会自动过滤掉，无需回头改每一份人设。
  // `skillLoadout()` 同时产出「逐项技能清单」（面板 US-104 直接渲染它的 rows）与
  // 【已启用技能】段落正文 —— 清单与提示词来自同一次计算。
  const loadout = extra.skillLoadout || skillLoadout({
    skillKeys: profile.skillKeys,
    library: extra.skillLibrary || [],
    legacySkills: profile.skills
  });
  // agent.md 与记忆文件（US-105）：加载规则（顺序 / 生效范围 / 每层上限 / 8000 字符预算 /
  // 变量替换）全在 `data/agentFiles.js` 的 `agentFileLoadout()` 里，这里只把它的两段正文接上：
  // agent.md 三层 → `agent_md` 模块，记忆文件（学员 > 班级 > 机构）→ `memory` 模块。
  // 传了 `agentFiles` 就以它为准（记忆文件库是新的记忆载体）；本次一个记忆文件都没加载到
  // 才回落到 `profile.memory`，没传 `agentFiles` 时沿用 `extra.agentMd` 与 `profile.memory`
  // （老调用方 / 回归夹具逐字符不变）。
  const agentFiles = extra.agentFiles && typeof extra.agentFiles === 'object' ? extra.agentFiles : null;
  const agentMdBody = agentFiles ? String(agentFiles.agentMdContent || '') : String(extra.agentMd || '');
  const memoryBody = agentFiles
    ? (String(agentFiles.memoryContent || '') || String(profile.memory || ''))
    : String(profile.memory || '');
  const identity = [profile.name, profile.roleLabel, profile.campus].filter(Boolean).join(' · ');
  return {
    identity: `你是${identity || '一位美术老师'}${profile.years ? `，教龄 ${profile.years} 年` : ''}。`,
    beliefs: profile.beliefs ? `【教学信念】\n${profile.beliefs}` : undefined,
    tone: profile.tone ? `【说话风格】\n${profile.tone}` : undefined,
    boundaries: profile.boundaries ? `【安全与伦理边界】\n${profile.boundaries}` : undefined,
    agent_md: agentMdBody.trim() ? `【agent.md】\n${agentMdBody}` : undefined,
    skills: loadout.content || undefined,
    memory: memoryBody.trim() ? `【长期记忆（本班本阶段，点评时必须结合并回访）】\n${memoryBody}` : undefined,
    task: `【本次任务】\n先看清上传的作品与素材里真实存在什么，再生成五维点评草稿，供老师审阅后编辑发布。`,
    // 观察词由模型自己挑：老师不勾选时也要能选出贴合画面的词。
    // 候选清单与前端面板共用同一份**观察词模板**（US-109 起由
    // `data/reviewKeywordTemplates.js` 解析，模板之外没有的词不会出现在候选里），
    // 所以这里必须强调「逐字来自候选」，否则前端认不出模型自造的同义词。
    keyword_candidates: keywordCandidateModule(extra, scope),
    writing_rules: `【写作要求】\n${dimensionLines()}\n- 只使用图片与老师观察中真实可见的证据，不要虚构课堂细节。\n- 证据不足的维度必须明确写出「本次证据不足」，而不是编造。\n- 若长期记忆中提到的回访点（例如上一次给出的练习建议）在本次素材里无法判断，要说明无法判断。`,
    keyword_rules: extra.keywordCandidates ? `【${scope}选择要求】\n- 看完作品后再选词，只选画面或素材里真的能被指出来的，不要按「好看」堆词。\n- 选 3-6 个，覆盖不同分组（例如画面主题 + 色彩感受 + 线条笔触），不要全挤在同一组。\n- 必须**逐字复制**候选清单里的词，不要改写、不要造同义词。候选中没有合适的就少选几个。\n- keywords 数组里**只写词本身**，不要带分组名、不要写成「色彩感受：暖色调」、不要带括号解释。` : undefined,
    output_format: `【输出格式】\n只输出一个 JSON 对象，不要 Markdown、不要代码块、不要任何解释文字。结构：\n{"evidence":["可核验的观察依据 1","可核验的观察依据 2"],"keywords":["${scope}"],"reviews":{"美术能力":"...","上课状态":"...","行为能力":"...","内在状态":"...","家长建议":"..."}}\n其中 keywords 是数组，元素必须逐字来自【${scope}候选清单】。`,
    subject: extra.subject ? `【本次课题】${extra.subject}` : undefined
  };
}

/**
 * 组装 system 提示词：返回 `{ system, modules }`。
 * `modules` 是本次拼装的模块清单（每项含 id / title / content / version / source / chars），
 * 没进入本次提示词的模块补在数组尾部（included:false）—— 界面据此说明「为什么没加载」。
 * 同样的输入永远得到逐字符相同的 system 字符串与逐字段相同的模块清单。
 *
 * `extra.skillLoadout` 可注入 `data/skillLibrary.js` 的 `skillLoadout()` 产物
 * （US-104：详情面板把同一份产物同时用于【已启用技能】段落与逐项技能清单）——
 * 不传时本函数按同一份输入自己算一次，结果逐字符相同。
 *
 * `extra.agentFiles` 可注入 `data/agentFiles.js` 的 `agentFileLoadout()` 产物
 * （US-105：三层 agent.md 进 `agent_md`、记忆文件进 `memory`，加载顺序 / 生效范围 /
 * 8000 字符预算 / 变量替换都在那一份里算好）。传了就以它为准；本次一个记忆文件都没有时，
 * `memory` 模块回落到 `profile.memory`。不传时行为与改造前逐字符一致
 * （`extra.agentMd` 仍是 `agent_md` 模块的旧入口）。
 */
export function buildPersonaPrompt(profile, extra = {}) {
  const scope = extra.keywordScope || '作品观察词';
  if (!profile) return composePromptModules(fallbackModuleContents(extra, scope), PROMPT_MODULE_ORDER_FALLBACK);
  return composePromptModules(personaModuleContents(profile, extra, scope), PROMPT_MODULE_IDS);
}

/** 向后兼容入口：只要 system 字符串（拼接结果与模块化改造前逐字符一致）。 */
export function buildPersonaSystemPrompt(profile, extra = {}) {
  return buildPersonaPrompt(profile, extra).system;
}

/**
 * 本次请求的提示词与附件清单 —— **纯函数、且与真正发出去的那一份同源**。
 *
 * 返回 `{ system, user, modules, attachments }`：
 *  - `system` / `modules`：`buildPersonaPrompt()` 的产物（模块清单就是「加载了什么」）；
 *  - `user`：user 消息里的**纯文本部分**（图片以 data URL 单独作为 content 项，绝不进这里的字符串）；
 *  - `attachments`：附件的**引用与 hash**（`buildReviewTraceAttachments`，不含图片正文）。
 *
 * 详情面板（US-103b 的「提示词」分区）与 `streamArtworkReview` 都调它：面板上看到的就是实际发出去的，
 * 且导出内容里不可能有素材正文（这是隐私口径的结构保证）。
 */
export function buildReviewPromptBundle({
  profile,
  skillLibrary,
  subject,
  studentName,
  keywords,
  teacherObservation,
  artworkDataUrl,
  photoDataUrl,
  keywordCandidates,
  keywordScope,
  // 生效的观察词模板（US-109）：给了就让 `keyword_candidates` 模块带上模板的版本与来源，
  // 面板与轨迹留档因此能说明「这一次用的是哪一版模板」。
  keywordTemplate,
  agentMd,
  agentFiles,
  images
} = {}) {
  const prompt = buildPersonaPrompt(profile, { subject, skillLibrary, keywordCandidates, keywordScope, keywordTemplate, agentMd, agentFiles });
  const userContent = buildUserContent({ subject, studentName, keywords, teacherObservation, artworkDataUrl, photoDataUrl });
  const media = images && typeof images === 'object' ? images : {};
  const attachments = buildReviewTraceAttachments([
    { kind: 'artwork', role: '主要美术能力依据', fileId: media.artwork?.id, name: media.artwork?.name, mime: media.artwork?.mime, content: artworkDataUrl },
    { kind: 'photo', role: '课堂观察素材', fileId: media.photo?.id, name: media.photo?.name, mime: media.photo?.mime, content: photoDataUrl }
  ]);
  return {
    system: prompt.system,
    modules: prompt.modules,
    user: String(userContent[0]?.text || ''),
    attachments
  };
}

function buildUserContent({ subject, studentName, keywords = [], teacherObservation = '', artworkDataUrl, photoDataUrl }) {
  const lines = [
    `学员：${studentName || '未指定'}`,
    `课题：${subject || '通用美术'}`,
    `老师补充观察：${teacherObservation || '未提供'}`,
    // 老师可能一个词都没勾（现在默认由模型自己识别），此时要求模型自行判断并选词。
    `老师已勾选的观察关键词：${keywords.length ? keywords.join('、') : '老师未勾选，请你根据画面自行识别并在 keywords 里给出'}`
  ];
  if (artworkDataUrl) lines.push('附件 1：学员作品原作，请以它作为主要美术能力依据。');
  if (photoDataUrl) lines.push('附件 2：课堂照片，仅可用于观察课堂状态与行为，不要用于美术能力判断。');
  if (!artworkDataUrl) lines.push('注意：本次没有收到作品图片，美术能力维度必须写明证据不足。');

  const content = [{ type: 'text', text: lines.join('\n') }];
  if (artworkDataUrl) content.push({ type: 'image_url', image_url: { url: artworkDataUrl } });
  if (photoDataUrl) content.push({ type: 'image_url', image_url: { url: photoDataUrl } });
  return content;
}

/** 去掉 ```json 包裹等常见噪声后再解析。 */
export function parseReviewJson(raw) {  const text = String(raw || '').trim();
  if (!text) throw new Error('模型没有返回内容。');
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(candidate);
  const reviews = parsed?.reviews;
  if (!reviews || typeof reviews !== 'object') throw new Error('模型返回的点评结构不完整。');
  const normalized = {};
  for (const [key] of DIMENSION_SPEC) {
    if (typeof reviews[key] === 'string' && reviews[key].trim()) normalized[key] = reviews[key].trim();
  }
  if (!Object.keys(normalized).length) throw new Error('模型返回的点评内容为空。');
  // 字段名容错：json_object 模式没有 schema 约束，模型偶尔会把 keywords 写成别的名字。
  // 允许为空（候选中确实没有合适的），但不允许是非数组。
  const rawKeywords = parsed.keywords ?? parsed.keyword ?? parsed.observation_keywords
    ?? parsed.observationKeywords ?? parsed.观察词 ?? parsed.作品观察词 ?? [];
  const keywords = Array.isArray(rawKeywords)
    ? rawKeywords.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
  return {
    reviews: normalized,
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter(Boolean).map(String) : [],
    keywords
  };
}

/**
 * 流式过程中把半成品 JSON 转成可读中文，用于「逐字显示」。
 * 只保留长度足够的字符串值，并剔除字段名本身，所以读起来就是正在写下的点评。
 */
const JSON_KEY_WORDS = new RegExp(`^(${REVIEW_DIMENSION_NAMES.join('|')}|evidence|keywords|reviews|summary)$`);
export function readableFromRawJson(raw) {
  const matches = String(raw || '').match(/"(?:[^"\\]|\\.)*"/g) || [];
  const pieces = [];
  for (const token of matches) {
    const value = token.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (JSON_KEY_WORDS.test(value)) continue;
    if (value.length > 6) pieces.push(value);
  }
  return pieces.join('\n\n');
}

/**
 * 流式生成点评。
 * @param {object} options
 * @param {object} options.profile 老师人设（含 skills / memory）
 * @param {string} [options.keywordCandidates] 观察词候选清单（逐行分组），由 reviewKeywords.js 生成
 * @param {string} [options.keywordScope] 候选词的口径名称，默认「作品观察词」
 * @param {(full:string, chunk:string)=>void} [options.onReasoning] 思考链增量
 * @param {(full:string, chunk:string)=>void} [options.onContent] 正文增量
 * @param {string} [options.model] 本次用哪个视觉模型（US-107a：老师指定或模型池路由命中的 id）；
 *   缺省沿用 `REVIEW_MODEL`（老调用方一字不变）。
 * @param {string} [options.modelSource] 模型来源标注（'teacher-pick' / 'pool-route'，US-107a 第 5 条）：
 *   原样写进轨迹的 `modelSource`；不传就是空串（不编造来源）。
 * @param {object} [options.trace] 轨迹种子（谁 / 哪节课 / 上一代轨迹 / 附件引用），缺省也能生成
 * @param {(trace:object)=>void} [options.onTrace] 轨迹收束回调：成功 / 失败 / 中止都恰好调一次
 * @returns {Promise<{reviews:object,evidence:string[],keywords:string[],reasoning:string,usage:object|null,raw:string,trace:object}>}
 */
export async function streamArtworkReview({ profile, skillLibrary, subject, studentName, keywords, teacherObservation, artworkDataUrl, photoDataUrl, keywordCandidates, keywordScope, keywordTemplate, agentMd, agentFiles, model, modelSource, onReasoning, onContent, signal, trace: traceSeed, onTrace }) {
  // 模型与来源：老师的选择（或模型池路由的结果）由调用方给，缺省回落实测可用的默认模型。
  const requestModel = String(model || '').trim() || REVIEW_MODEL;
  const requestModelSource = String(modelSource || '').trim();
  // US-101 起 system 由模块拼成；这里同时拿到模块清单（轨迹的「加载了哪些提示词」）。
  // 提示词与附件清单走 `buildReviewPromptBundle` —— 详情面板（US-103b）读的是同一份产物。
  const images = traceSeed?.images || {};
  const bundle = buildReviewPromptBundle({
    profile,
    skillLibrary,
    subject,
    studentName,
    keywords,
    teacherObservation,
    artworkDataUrl,
    photoDataUrl,
    keywordCandidates,
    keywordScope,
    keywordTemplate,
    agentMd,
    agentFiles,
    images
  });
  const prompt = { system: bundle.system, modules: bundle.modules };
  const userContent = buildUserContent({ subject, studentName, keywords, teacherObservation, artworkDataUrl, photoDataUrl });
  const attachments = bundle.attachments;
  // 轨迹：**只驻留内存**（调用方拿到 `onTrace` 的结果之后才可能在归档时提交云端）。
  // 图片只进 attachments 的「引用 + hash」（`buildReviewTraceAttachments`），正文一个字都不进轨迹。
  // agent.md 与记忆文件（US-105）只把**逐文件行与预算摘要**写进轨迹（行里有正文，供审计复现）；
  // 调用方给了 `agentFiles` 就用它的产物，否则沿用轨迹种子里带的那一份（两条路径同一形状）。
  let trace = createReviewTrace({
    ...(traceSeed && typeof traceSeed === 'object' ? traceSeed : {}),
    model: requestModel,
    // 来源标注（US-107a）：由模型池自动路由时是 'pool-route'，老师在选择器里点的是 'teacher-pick'。
    modelSource: requestModelSource,
    system: prompt.system,
    user: String(userContent[0]?.text || ''),
    modules: prompt.modules,
    files: (agentFiles && agentFiles.files) || (traceSeed && traceSeed.files) || undefined,
    agentFiles: (agentFiles && agentFiles.summary) || (traceSeed && traceSeed.agentFiles) || undefined,
    attachments
  });

  let content = '';
  let reasoning = '';
  let usage = null;

  // 排队结束（请求真正开始）：此后到首字之间就是「首字延迟」，到收束就是「总耗时」。
  trace = startReviewTrace(trace);
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model: requestModel,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: userContent }
      ],
      // 参数表是唯一真源：详情面板「模型与参数」分区读的也是这一份（改了这里就等于改了真实请求）。
      ...REVIEW_MODEL_PARAMS,
      signal
    })) {
      const at = new Date().toISOString();
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.reasoning_content) {
        trace = markReviewTraceFirstToken(trace, at);
        reasoning += delta.reasoning_content;
        onReasoning?.(reasoning, delta.reasoning_content);
      }
      if (delta?.content) {
        trace = markReviewTraceFirstToken(trace, at);
        trace = markReviewTraceContentStart(trace, at);
        content += delta.content;
        onContent?.(content, delta.content);
      }
      if (chunk.usage) usage = chunk.usage;
    }
  } catch (error) {
    // 失败或老师中止同样留档：推理增量与已拿到的正文原样保存，状态写 failed / aborted。
    const aborted = Boolean(signal?.aborted) || error?.name === 'AbortError';
    const settled = finishReviewTrace(trace, {
      status: aborted ? REVIEW_TRACE_STATUS.aborted : REVIEW_TRACE_STATUS.failed,
      reasoning,
      outputRaw: content,
      usage: usage || undefined,
      error: reviewTraceErrorOf(error, describeReviewError(error), aborted ? 'aborted' : 'stream-error')
    });
    onTrace?.(settled);
    throw error;
  }

  let parsed = null;
  try {
    parsed = parseReviewJson(content);
  } catch (error) {
    // 流正常结束但模型输出解析不了：同样是「失败留档」，错误码点明是输出不合法，
    // 文案用可读的说明（原始 SyntaxError 的英文信息对老师没有意义）。
    const settled = finishReviewTrace(trace, {
      status: REVIEW_TRACE_STATUS.failed,
      reasoning,
      outputRaw: content,
      usage: usage || undefined,
      error: reviewTraceErrorOf(error, '模型返回的内容不是合法 JSON，无法解析，请重试。', 'invalid-output')
    });
    onTrace?.(settled);
    throw error;
  }

  const settled = finishReviewTrace(trace, { status: REVIEW_TRACE_STATUS.success, reasoning, outputRaw: content, usage: usage || undefined });
  onTrace?.(settled);
  return { ...parsed, reasoning, usage, raw: content, trace: settled };
}

/**
 * 把云端错误码翻译成老师能看懂的话（US-108b：**不向老师暴露原始错误码**）。
 *
 * 认得出的错误码走固定文案；认不出的（没有 code、只有 SDK 原文）过一次
 * `readableReviewFailureText()`：`status code 504`、`gateway_timeout`、整句英文堆栈
 * 这类都换成兜底句 —— 老师看到的是「模型服务暂时不可用」，不是一串他无法处理的技术细节。
 */
export function describeReviewError(error) {
  const code = String(error?.error?.code || error?.code || '');
  if (code.startsWith('auth_')) return '云服务凭据校验失败，请刷新页面后重试。';
  if (code.startsWith('quota_')) return '调用额度已用尽，请稍后重试或联系管理员。';
  if (code.startsWith('request_')) return '请求参数不被模型接受，请换一个模型或减少素材后重试。';
  if (code.startsWith('gateway_') || code.startsWith('model_')) return '模型服务暂时不可用，请稍后重新生成。';
  return readableReviewFailureText(error?.message);
}
