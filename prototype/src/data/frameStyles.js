/**
 * 相框样式库与「样式微调」（[第二步 US-006] 的故事范围）。
 *
 * 三件事都只在这一个文件里定义，界面只负责渲染：
 *   1. **样式微调的选项表**：形状 / 材质色 / 框宽三组（验收原文的三组）+ 卡纸开关与卡纸色；
 *   2. **微调的收敛与应用**（`normalizeFrameStyleTweaks` / `applyFrameStyleTweaks`）；
 *   3. **描述文案**（卡片副标题 / 面板摘要）。
 *
 * 三条口径（写清楚免得后人改坏）：
 *   - 微调**不改模板**：结果只是「本次选用时叠在模板 spec 之上的一层补丁」，老师的调整不会写回
 *     平台 / 机构 / 老师模板（模板的写权限是 US-031 的事）。所以这里没有任何 persist。
 *   - 「没有微调」时必须原样返回输入 spec（连对象都不换）：老模板的渲染逐像素不变，
 *     这条纪律与 `frameSpecRenderView` 的 v1 兼容承诺是同一件事。
 *   - 材质色与光影**一起改**：`frame.lighting` 的高光 / 暗部是按材质色配好的，只换底色会在墨黑框上
 *     留下暖金高光。每个色板条目自带 highlight / shadow，换色时一起写。
 *
 * 本模块**零依赖**（不 import services）：Node 可直接 import 跑纯函数断言
 * （`services/frameSpec.js` 会经 `../cloud` 拉起云端 SDK，data 层不能碰它）。
 */

/** 形状微调：id 必须与 `services/frameSpec.js` 的 `FRAME_SHAPES` 一致（那是几何层的枚举真源）。 */
export const FRAME_STYLE_SHAPES = [
  { id: 'square', label: '直角', hint: '方正收边，最经典' },
  { id: 'rounded', label: '圆角', hint: '四角柔和，适合孩子的手作感' },
  { id: 'arch', label: '拱形', hint: '顶部半圆，展陈感强' },
  { id: 'bevel', label: '斜角', hint: '四角斜切，现代简洁' }
];

/**
 * 材质色板：`hex` 是外框底色，`highlight` / `shadow` 是同一材质的受光面与暗部
 * （换色时三支一起写，见文件头第 3 条口径）。暖金这一组与内置预设的既有光影逐值相同，
 * 所以「切回暖金」不会顺手改掉老模板的质感。
 */
export const FRAME_STYLE_COLORS = [
  { id: 'warm-gold', label: '暖金', hex: '#CFA52E', highlight: '#E8C766', shadow: '#8A6B1C' },
  { id: 'dark-brown', label: '深棕', hex: '#5A4632', highlight: '#7E6549', shadow: '#33261A' },
  { id: 'natural-wood', label: '原木', hex: '#8D6439', highlight: '#B08553', shadow: '#5C3F22' },
  { id: 'cream', label: '米白', hex: '#E9E1D2', highlight: '#FBF8F2', shadow: '#BFB4A0' },
  { id: 'ink', label: '墨黑', hex: '#2A2724', highlight: '#4A453F', shadow: '#141210' },
  { id: 'warm-yellow', label: '暖黄', hex: '#E0B84A', highlight: '#F3D98A', shadow: '#A57F22' }
];

/**
 * 框宽三档：比例口径与 spec 一致（相对画布短边）。
 * 三档都落在 `FRAME_WIDTH_RATIO_RANGE`（0.008–0.08）内 —— 渲染层的收敛因此不会改动它们，
 * 「显示的比例 = 渲染的比例」。
 */
export const FRAME_STYLE_WIDTHS = [
  { id: 'thin', label: '细框', ratio: 0.014, hint: '像纸边一样轻' },
  { id: 'standard', label: '标准', ratio: 0.0412, hint: '与内置模板一致' },
  { id: 'wide', label: '宽框', ratio: 0.068, hint: '展览级的厚重感' }
];

/** 卡纸色板（卡纸开关是独立的布尔微调，见 FRAME_STYLE_TWEAK_FIELDS）。 */
export const FRAME_STYLE_MAT_COLORS = [
  { id: 'paper', label: '米白', hex: '#F3EDE2' },
  { id: 'paper-ink', label: '纸色', hex: '#EEE8DD' },
  { id: 'snow', label: '雪白', hex: '#FFFFFF' },
  { id: 'grey', label: '浅灰', hex: '#E4E0D8' },
  { id: 'sand', label: '暖砂', hex: '#EADFCB' }
];

/** 微调字段清单（结构上就只有这五项；界面的「已微调」徽标与重置都按它算）。 */
export const FRAME_STYLE_TWEAK_FIELDS = ['shape', 'color', 'width', 'matVisible', 'matColor'];

/**
 * 切到圆角时的默认半径（相对画布短边）。
 * 内置模板的 `cornerRadiusRatio` 多为 0.06（圆角几乎看不出来），老师点了「圆角」却看不见变化
 * 是比「圆角不够大」更糟的体验，所以形状切到圆角且模板半径小于 `FRAME_STYLE_MIN_VISIBLE_CORNER_RADIUS`
 * 时，用这个默认半径（圆角半径的三条上限仍在渲染层收敛，这里只负责「看得见」）。
 */
export const FRAME_STYLE_DEFAULT_CORNER_RADIUS = 0.18;
export const FRAME_STYLE_MIN_VISIBLE_CORNER_RADIUS = 0.12;
/** 光影方向：与既有内置模板一致（光源在左上，高光在左上、暗部在右下）。 */
export const FRAME_STYLE_LIGHTING_ANGLE = 135;
/** 微调后写回的 spec 版本号（微调只会写 `frame` / `mat` 两个分组，其余字段原样保留）。 */
export const FRAME_STYLE_SPEC_VERSION = 2;

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const byId = (list, id) => list.find(item => item.id === id) || null;

export const frameShapeOption = (id) => byId(FRAME_STYLE_SHAPES, id);
export const frameColorOption = (id) => byId(FRAME_STYLE_COLORS, id);
export const frameWidthOption = (id) => byId(FRAME_STYLE_WIDTHS, id);
export const frameMatColorOption = (id) => byId(FRAME_STYLE_MAT_COLORS, id);

export const frameShapeLabel = (id) => frameShapeOption(id)?.label || '';
export const frameColorLabel = (id) => frameColorOption(id)?.label || '';
export const frameWidthLabel = (id) => frameWidthOption(id)?.label || '';
export const frameMatColorLabel = (id) => frameMatColorOption(id)?.label || '';

/**
 * 归一化微调：只认识选项表里的 id，其余一律丢弃（脏数据不抛错）。
 * `matVisible` 用 `null` 表示「没调过」，与「显式调成 false（关掉卡纸）」区分开 ——
 * 用一个 boolean 会把「没调」和「关掉」混成同一件事，界面上就没法区分有没有微调过。
 */
export function normalizeFrameStyleTweaks(raw) {
  const input = isPlainObject(raw) ? raw : {};
  return {
    shape: frameShapeOption(input.shape) ? input.shape : '',
    color: frameColorOption(input.color) ? input.color : '',
    width: frameWidthOption(input.width) ? input.width : '',
    matVisible: typeof input.matVisible === 'boolean' ? input.matVisible : null,
    matColor: frameMatColorOption(input.matColor) ? input.matColor : ''
  };
}

/** 有没有实际微调（决定是否显示「已微调」徽标 / 是否要叠补丁）。 */
export function hasFrameStyleTweaks(raw) {
  const tweaks = normalizeFrameStyleTweaks(raw);
  return Boolean(tweaks.shape || tweaks.color || tweaks.width || tweaks.matColor || tweaks.matVisible !== null);
}

/** 逐项列出微调（界面徽标、摘要与断言读同一份）。 */
export function frameStyleTweakEntries(raw) {
  const tweaks = normalizeFrameStyleTweaks(raw);
  const entries = [];
  if (tweaks.shape) entries.push({ field: 'shape', group: '形状', value: tweaks.shape, label: frameShapeLabel(tweaks.shape) });
  if (tweaks.color) entries.push({ field: 'color', group: '材质色', value: tweaks.color, label: frameColorLabel(tweaks.color) });
  if (tweaks.width) entries.push({ field: 'width', group: '框宽', value: tweaks.width, label: frameWidthLabel(tweaks.width) });
  if (tweaks.matColor) entries.push({ field: 'matColor', group: '卡纸色', value: tweaks.matColor, label: `卡纸${frameMatColorLabel(tweaks.matColor)}` });
  if (tweaks.matVisible !== null) entries.push({ field: 'matVisible', group: '卡纸', value: tweaks.matVisible, label: tweaks.matVisible ? '卡纸已开' : '卡纸已关' });
  return entries;
}

export function frameStyleTweakCount(raw) {
  return frameStyleTweakEntries(raw).length;
}

/** 面板摘要，例如「圆角 · 墨黑 · 宽框 · 卡纸已关」；没有微调时是「默认样式」。 */
export function frameStyleTweakSummary(raw) {
  const entries = frameStyleTweakEntries(raw);
  return entries.length ? entries.map(item => item.label).join(' · ') : '默认样式';
}

/**
 * 把微调叠到模板 spec 上，返回**新的 spec 对象**。
 *
 * - 没有微调时**原样返回输入**（同一个对象，不复制）：这是「老模板渲染逐像素不变」的实现点；
 * - 只覆盖 `frame` / `mat` 两个分组 + `version`，其余分组（水印 / 落款 / 时间 / 展签）一个都不碰 ——
 *   混写结构在 `normalizeFrameSpecV2` 里是合法输入（v2 分组优先、v1 平面字段兜底），
 *   所以「老 v1 模板 + 老师的形状微调」不需要迁移模板本身。
 */
export function applyFrameStyleTweaks(spec, raw) {
  const tweaks = normalizeFrameStyleTweaks(raw);
  if (!hasFrameStyleTweaks(tweaks)) return spec;
  const base = isPlainObject(spec) ? spec : {};
  const rawFrame = isPlainObject(base.frame) ? base.frame : {};
  const rawMat = isPlainObject(base.mat) ? base.mat : {};
  const frame = { ...rawFrame };
  const mat = { ...rawMat };
  // v1 平面结构里卡纸色是字符串（base.mat），换成对象分组时要把这个值搬过来，否则卡纸会掉回默认米白。
  if (typeof base.mat === 'string' && base.mat.trim()) mat.color = String(base.mat).trim();

  const shape = frameShapeOption(tweaks.shape);
  if (shape) {
    frame.shape = shape.id;
    if (shape.id === 'rounded' && !(Number(frame.cornerRadiusRatio) >= FRAME_STYLE_MIN_VISIBLE_CORNER_RADIUS)) {
      frame.cornerRadiusRatio = FRAME_STYLE_DEFAULT_CORNER_RADIUS;
    }
  }
  const color = frameColorOption(tweaks.color);
  if (color) {
    frame.color = color.hex;
    frame.lighting = { highlight: color.highlight, shadow: color.shadow, angle: FRAME_STYLE_LIGHTING_ANGLE };
  }
  const width = frameWidthOption(tweaks.width);
  if (width) frame.widthRatio = width.ratio;
  if (tweaks.matVisible !== null) mat.visible = tweaks.matVisible;
  const matColor = frameMatColorOption(tweaks.matColor);
  if (matColor) mat.color = matColor.hex;

  return { ...base, version: FRAME_STYLE_SPEC_VERSION, frame, mat };
}

/**
 * 从一份 spec 读出「它看起来是什么样」：形状 / 材质色 / 框宽 / 卡纸，以及卡片副标题。
 * 卡片缩略图渲染失败时（或还没有作品可以渲染时）界面就靠这份描述画 CSS 预览，
 * 所以它必须对 v1 平面结构、缺字段、脏值都成立。
 */
export function describeFrameStyleSpec(spec) {
  const base = isPlainObject(spec) ? spec : {};
  const frame = isPlainObject(base.frame) ? base.frame : {};
  const mat = isPlainObject(base.mat) ? base.mat : {};
  const shapeId = frameShapeOption(frame.shape) ? frame.shape : 'square';
  const colorHex = String(frame.color ?? base.outer ?? '').trim().toUpperCase();
  const colorOption = FRAME_STYLE_COLORS.find(item => item.hex.toUpperCase() === colorHex) || null;
  const rawWidth = Number(frame.widthRatio ?? base.outerWidthRatio);
  const widthRatio = Number.isFinite(rawWidth) ? rawWidth : null;
  const widthOption = widthRatio === null
    ? null
    : FRAME_STYLE_WIDTHS.reduce((best, item) => (best === null || Math.abs(item.ratio - widthRatio) < Math.abs(best.ratio - widthRatio) ? item : best), null);
  const widthLabel = widthOption && Math.abs(widthOption.ratio - widthRatio) <= 0.006
    ? widthOption.label
    : (widthRatio === null ? '默认框宽' : `宽 ${(widthRatio * 100).toFixed(1)}%`);
  const matVisible = typeof mat.visible === 'boolean' ? mat.visible : true;
  const matHex = String(mat.color ?? (typeof base.mat === 'string' ? base.mat : '') ?? '').trim().toUpperCase();
  const matOption = FRAME_STYLE_MAT_COLORS.find(item => item.hex.toUpperCase() === matHex) || null;
  const shapeLabel = frameShapeLabel(shapeId);
  const colorLabel = colorOption ? colorOption.label : (colorHex || '默认材质');
  const matColorLabel = matOption ? matOption.label : (matHex || '米白');
  return {
    shapeId,
    shapeLabel,
    // 命中色板的 id 用来高亮微调控件；没命中的颜色（模板自定义色）保持空串，界面就不高亮任何一颗。
    colorId: colorOption?.id || '',
    colorHex: colorHex || FRAME_STYLE_COLORS[0].hex,
    colorLabel,
    widthRatio,
    widthId: widthOption && Math.abs(widthOption.ratio - widthRatio) <= 0.006 ? widthOption.id : '',
    widthLabel,
    matVisible,
    matColorId: matOption?.id || '',
    matHex: matHex || '#FFFFFF',
    matColorLabel,
    summary: `${shapeLabel} · ${colorLabel} · ${widthLabel}${matVisible ? '' : ' · 无卡纸'}`
  };
}
