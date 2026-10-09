import { cloud } from '../cloud';
import { resolveSkills } from '../data/skillLibrary';

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

/** 把人设 / 技能库 / 记忆组装成 system 提示词。 */
export function buildPersonaSystemPrompt(profile, extra = {}) {
  if (!profile) return FALLBACK_SYSTEM + '\n\n' + DIMENSION_SPEC.map(([k, v]) => `- ${k}：${v}`).join('\n');

  const parts = [];
  const identity = [profile.name, profile.roleLabel, profile.campus].filter(Boolean).join(' · ');
  parts.push(`你是${identity || '一位美术老师'}${profile.years ? `，教龄 ${profile.years} 年` : ''}。`);

  if (profile.beliefs) parts.push(`【教学信念】\n${profile.beliefs}`);
  if (profile.tone) parts.push(`【说话风格】\n${profile.tone}`);
  if (profile.boundaries) parts.push(`【安全与伦理边界】\n${profile.boundaries}`);

  // 技能来自独立的技能库：人设只持有被勾选的 id，真正的描述从库里取。
  // 库里停用某项后，这里会自动过滤掉，无需回头改每一份人设。
  const skills = resolveSkills(profile.skillKeys, extra.skillLibrary || [], profile.skills);
  if (skills.length) {
    parts.push(`【已启用技能】\n${skills.map(skill => `- ${skill.name}${skill.description ? `：${skill.description}` : ''}`).join('\n')}`);
  }

  if (profile.memory) parts.push(`【长期记忆（本班本阶段，点评时必须结合并回访）】\n${profile.memory}`);

  parts.push(`【本次任务】\n基于老师上传的作品图片与课堂观察，生成五维点评草稿，供老师审阅后编辑发布。`);
  parts.push(`【写作要求】\n${DIMENSION_SPEC.map(([k, v]) => `- ${k}：${v}`).join('\n')}\n- 只使用图片与老师观察中真实可见的证据，不要虚构课堂细节。\n- 证据不足的维度必须明确写出「本次证据不足」，而不是编造。\n- 若长期记忆中提到的回访点（例如上一次给出的练习建议）在本次素材里无法判断，要说明无法判断。`);
  parts.push(`【输出格式】\n只输出一个 JSON 对象，不要 Markdown、不要代码块、不要任何解释文字。结构：\n{"evidence":["可核验的观察依据 1","可核验的观察依据 2"],"reviews":{"美术能力":"...","上课状态":"...","行为能力":"...","内在状态":"...","家长建议":"..."}}`);

  if (extra.subject) parts.push(`【本次课题】${extra.subject}`);
  return parts.join('\n\n');
}

function buildUserContent({ subject, studentName, keywords = [], teacherObservation = '', artworkDataUrl, photoDataUrl }) {
  const lines = [
    `学员：${studentName || '未指定'}`,
    `课题：${subject || '通用美术'}`,
    `老师补充观察：${teacherObservation || '未提供'}`,
    `老师勾选的观察关键词：${keywords.length ? keywords.join('、') : '未勾选'}`
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
  return { reviews: normalized, evidence: Array.isArray(parsed.evidence) ? parsed.evidence.filter(Boolean).map(String) : [] };
}

/**
 * 流式过程中把半成品 JSON 转成可读中文，用于「逐字显示」。
 * 只保留长度足够的字符串值，并剔除字段名本身，所以读起来就是正在写下的点评。
 */
const JSON_KEY_WORDS = /^(美术能力|上课状态|行为能力|内在状态|家长建议|evidence|reviews|summary)$/;
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
 * @param {(full:string, chunk:string)=>void} [options.onReasoning] 思考链增量
 * @param {(full:string, chunk:string)=>void} [options.onContent] 正文增量
 * @returns {Promise<{reviews:object,evidence:string[],reasoning:string,usage:object|null}>}
 */
export async function streamArtworkReview({ profile, skillLibrary, subject, studentName, keywords, teacherObservation, artworkDataUrl, photoDataUrl, onReasoning, onContent, signal }) {
  const messages = [
    { role: 'system', content: buildPersonaSystemPrompt(profile, { subject, skillLibrary }) },
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
