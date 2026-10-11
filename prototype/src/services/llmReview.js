import { cloud } from '../cloud';
import { resolveSkills } from '../data/skillLibrary';
// 提示词模块化（US-101）：system 提示词由有名字、有版本、有来源的模块拼成，
// 「加载了哪些提示词」的展示与轨迹留档都读模块清单（模块名/顺序的唯一真源在 data 层）。
import { composePromptModules, PROMPT_MODULE_IDS, PROMPT_MODULE_ORDER_FALLBACK } from '../data/promptModules';

// 云端流式点评：把人设 + 技能库 + 大模型记忆拼进 system 提示词，
// 把作品/照片作为 image_url 传给视觉模型。
//
// 两个硬约束（均已实测确认）：
//  1. stream 必须为 true —— 非流式会被 SDK 直接拒绝（request_stream_required）。
//  2. messages[0] 必须是 system，否则调用失败。
//
// glm-5.3-flash 是实测可用的视觉模型；目录里的 glm-4.6v 虽然列出但调用返回
// request_invalid_parameter，不要回退到它。
export const REVIEW_MODEL = 'glm-5.3-flash';

// 实测三档（同一提示词 + 同一张作品图）：
//   不设置      约 60s，思考链很长，稳定
//   'low'      约 19s，JSON 稳定解析 ← 采用
//   'minimal'  约 8s，但出现 JSON 截断导致解析失败，不可靠
// 因此固定为 'low'：既把等待压到 20 秒内，又保留可展示的思考增量。
export const REVIEW_REASONING_EFFORT = 'low';

const FALLBACK_SYSTEM = '你是一位儿童美术教育的成长观察者。只依据画面中真实可见的证据作答，证据不足时明确写出局限。';

const DIMENSION_SPEC = [
  ['美术能力', '80-150 字：只写画面里能指认的色彩、构图、造型或材料使用，先给一个具体优势，再给一个下一节课可以试的方向。'],
  ['上课状态', '60-120 字：只写可观察到的投入、停顿后是否回到画面、是否主动补充细节。没有素材支撑就写明局限。'],
  ['行为能力', '60-120 字：描述任务理解、表达、协作或整理等可观察行为，不给孩子贴标签。'],
  ['内在状态', '60-120 字：仅记录本次课堂中可观察到的表达与变化，明确声明不作心理诊断。'],
  ['家长建议', '80-150 字：给出 1-3 条与本次观察有关、家长今晚就能尝试的具体行动，最好包含一句可以直接照着说的问话。']
];

/** 写作要求里的五维说明：兜底分支与老师人设分支共用同一份文本。 */
const dimensionLines = () => DIMENSION_SPEC.map(([key, value]) => `- ${key}：${value}`).join('\n');

/** 兜底分支（没有老师人设）的模块内容：正文与拼装顺序都保持改造前的样子。 */
function fallbackModuleContents(extra, scope) {
  return {
    base_role: FALLBACK_SYSTEM,
    writing_rules: dimensionLines(),
    keyword_candidates: extra.keywordCandidates ? `【${scope}候选清单】\n${extra.keywordCandidates}` : undefined,
    keyword_rules: extra.keywordCandidates ? `【${scope}选择要求】\n选 3-6 个画面里真的能被指出来的词，必须逐字复制候选清单里的词。` : undefined,
    output_format: `【输出格式】\n只输出 JSON：{"evidence":[...],"keywords":[...],"reviews":{"美术能力":"...","上课状态":"...","行为能力":"...","内在状态":"...","家长建议":"..."}}`
  };
}

/** 老师人设分支的模块内容：每段正文都是「原样进入 system 提示词」的那一段。 */
function personaModuleContents(profile, extra, scope) {
  // 技能来自独立的技能库：人设只持有被勾选的 id，真正的描述从库里取。
  // 库里停用某项后，这里会自动过滤掉，无需回头改每一份人设。
  const skills = resolveSkills(profile.skillKeys, extra.skillLibrary || [], profile.skills);
  const identity = [profile.name, profile.roleLabel, profile.campus].filter(Boolean).join(' · ');
  return {
    identity: `你是${identity || '一位美术老师'}${profile.years ? `，教龄 ${profile.years} 年` : ''}。`,
    beliefs: profile.beliefs ? `【教学信念】\n${profile.beliefs}` : undefined,
    tone: profile.tone ? `【说话风格】\n${profile.tone}` : undefined,
    boundaries: profile.boundaries ? `【安全与伦理边界】\n${profile.boundaries}` : undefined,
    // agent.md 的加载规则与版本化属 US-105；本故事只提供入口（不传就完全不出现）。
    agent_md: extra.agentMd ? `【agent.md】\n${extra.agentMd}` : undefined,
    skills: skills.length ? `【已启用技能】\n${skills.map(skill => `- ${skill.name}${skill.description ? `：${skill.description}` : ''}`).join('\n')}` : undefined,
    memory: profile.memory ? `【长期记忆（本班本阶段，点评时必须结合并回访）】\n${profile.memory}` : undefined,
    task: `【本次任务】\n先看清上传的作品与素材里真实存在什么，再生成五维点评草稿，供老师审阅后编辑发布。`,
    // 观察词由模型自己挑：老师不勾选时也要能选出贴合画面的词。
    // 候选清单与前端面板共用同一份目录（src/data/reviewKeywords.js），
    // 所以这里必须强调「逐字来自候选」，否则前端认不出模型自造的同义词。
    keyword_candidates: extra.keywordCandidates ? `【${scope}候选清单】\n${extra.keywordCandidates}` : undefined,
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
const JSON_KEY_WORDS = /^(美术能力|上课状态|行为能力|内在状态|家长建议|evidence|keywords|reviews|summary)$/;
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
 * @returns {Promise<{reviews:object,evidence:string[],keywords:string[],reasoning:string,usage:object|null}>}
 */
export async function streamArtworkReview({ profile, skillLibrary, subject, studentName, keywords, teacherObservation, artworkDataUrl, photoDataUrl, keywordCandidates, keywordScope, onReasoning, onContent, signal }) {
  const messages = [
    { role: 'system', content: buildPersonaSystemPrompt(profile, { subject, skillLibrary, keywordCandidates, keywordScope }) },
    { role: 'user', content: buildUserContent({ subject, studentName, keywords, teacherObservation, artworkDataUrl, photoDataUrl }) }
  ];

  let content = '';
  let reasoning = '';
  let usage = null;

  for await (const chunk of cloud.llm.chat.completions.create({
    model: REVIEW_MODEL,
    messages,
    stream: true,
    response_format: { type: 'json_object' },
    stream_options: { include_usage: true },
    reasoning_effort: REVIEW_REASONING_EFFORT,
    temperature: 0.4,
    signal
  })) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.reasoning_content) {
      reasoning += delta.reasoning_content;
      onReasoning?.(reasoning, delta.reasoning_content);
    }
    if (delta?.content) {
      content += delta.content;
      onContent?.(content, delta.content);
    }
    if (chunk.usage) usage = chunk.usage;
  }

  const parsed = parseReviewJson(content);
  return { ...parsed, reasoning, usage };
}

/** 把云端错误码翻译成老师能看懂的话。 */
export function describeReviewError(error) {
  const code = String(error?.error?.code || error?.code || '');
  if (code.startsWith('auth_')) return '云服务凭据校验失败，请刷新页面后重试。';
  if (code.startsWith('quota_')) return '调用额度已用尽，请稍后重试或联系管理员。';
  if (code.startsWith('request_')) return '请求参数不被模型接受，请换一个模型或减少素材后重试。';
  if (code.startsWith('gateway_') || code.startsWith('model_')) return '模型服务暂时不可用，请稍后重新生成。';
  return error?.message || '智能点评暂时不可用，请稍后重试。';
}
