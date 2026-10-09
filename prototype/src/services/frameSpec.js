import { cloud } from '../cloud';

// 装裱方案由大模型「设计参数」，再由前端 canvas「精确绘制」。
//
// 为什么不用大模型直接生图：云端 SDK 只有 chat / models / database / storage 四个模块，
// 没有生图端点；模型目录里虽有 hunyuan-image-alpha，但通过 chat 调用一律返回
// request_invalid_parameter。因此这里让大模型输出可绘制的几何与色彩参数，
// 既保住了「绝不重绘孩子作品」的核心承诺，也把结果变成可复现、可微调的确定值。
const SPEC_MODEL = 'glm-5.3-flash';

const SAFE_FONTS = ['serif', 'sans-serif', 'Songti SC', 'STSong', 'Kaiti SC', 'STKaiti', 'Noto Serif SC'];

export const DEFAULT_FRAME_SPEC = {
  outer: '#cfa52e',
  outerWidthRatio: 0.0412,
  mat: '#f3ede2',
  matWidthRatio: 0.0647,
  innerLine: null,
  plaqueBg: '#2b271f',
  plaqueText: '#fbf8f2',
  plaqueFontFamily: 'serif',
  plaqueLetterSpacing: 1,
  artRotateDeg: 0,
  atmosphere: '',
  rationale: ''
};

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const hex = (value, fallback) => {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : fallback;
};

const hexOrNull = (value) => {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : null;
};

/** 把模型输出收敛成一定能被 canvas 安全绘制的参数。 */
export function normalizeFrameSpec(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = DEFAULT_FRAME_SPEC;
  const font = String(source.plaqueFontFamily ?? '').trim();
  return {
    outer: hex(source.outer, base.outer),
    // 下限定在 0.012：更细的框在 1800px 画布上会看不见，视觉上等同于没有装裱。
    outerWidthRatio: clamp(source.outerWidthRatio, 0.012, 0.06, base.outerWidthRatio),
    mat: hex(source.mat, base.mat),
    matWidthRatio: clamp(source.matWidthRatio, 0.02, 0.12, base.matWidthRatio),
    innerLine: hexOrNull(source.innerLine),
    plaqueBg: hex(source.plaqueBg, base.plaqueBg),
    plaqueText: hex(source.plaqueText, base.plaqueText),
    plaqueFontFamily: SAFE_FONTS.includes(font) ? font : base.plaqueFontFamily,
    plaqueLetterSpacing: clamp(source.plaqueLetterSpacing, 0, 8, base.plaqueLetterSpacing),
    artRotateDeg: Number(source.artRotateDeg) === 90 ? 90 : 0,
    atmosphere: String(source.atmosphere ?? '').slice(0, 120),
    rationale: String(source.rationale ?? '').slice(0, 120)
  };
}

const SPEC_SYSTEM = `你是一位展览级装裱设计师。你把老师用自然语言描述的装裱需求，翻译成可由 canvas 精确绘制的几何与色彩参数。

规则：
- 只输出纯色几何构成，不使用任何位图素材、纹理图片、渐变以外的复杂效果。
- 配色要能托住儿童画：孩子的作品是主角，装裱只负责收边与承托，不能抢色。
- 不要出现相框外的桌面、墙面、影子、手、水印或文字覆盖。
- 只输出一个 JSON 对象，不要 Markdown、不要代码块、不要解释文字。`;

const SPEC_USER = (description) => `装裱需求：${description || '安静克制的儿童作品展览装裱，暖白卡纸，浅木外框。'}

请输出这个 JSON 对象（字段含义见括号）：
{
  "outer": "外框颜色，#RRGGBB",
  "outerWidthRatio": "外框宽度占画布短边的比例，0.012-0.06 之间的小数",
  "mat": "卡纸颜色，#RRGGBB",
  "matWidthRatio": "卡纸宽度占画布短边的比例，0.02-0.12 之间的小数",
  "innerLine": "卡纸内细分隔线颜色 #RRGGBB，或 null 表示不要",
  "plaqueBg": "展签底色 #RRGGBB",
  "plaqueText": "展签文字色 #RRGGBB",
  "plaqueFontFamily": "字体族，只能从 serif / sans-serif / Songti SC / Kaiti SC / Noto Serif SC 中选一个",
  "plaqueLetterSpacing": "展签字距，0-8 之间的数字",
  "artRotateDeg": "作品是否旋转，只能是 0 或 90",
  "atmosphere": "一句话描述这个装裱的氛围，不超过 40 字",
  "rationale": "为什么这样配色，不超过 40 字"
}`;

/** 调用大模型把自然语言需求翻译成装裱参数。 */
export async function generateFrameSpec(description, { signal } = {}) {
  let text = '';
  for await (const chunk of cloud.llm.chat.completions.create({
    model: SPEC_MODEL,
    messages: [
      { role: 'system', content: SPEC_SYSTEM },
      { role: 'user', content: SPEC_USER(description) }
    ],
    stream: true,
    response_format: { type: 'json_object' },
    temperature: 0.5,
    signal
  })) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) text += delta.content;
  }

  const cleaned = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回可用的装裱参数。');
  return normalizeFrameSpec(JSON.parse(cleaned.slice(start, end + 1)));
}
