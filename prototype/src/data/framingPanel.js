/**
 * 管理端「装裱设置」参数面板的领域规则（[第二步 US-011a] 的故事范围）。
 *
 * 面板要覆盖 v2 spec 的**全部参数**，靠「人间记忆」保证不了 —— 漏掉一个字段的表现是
 * 「界面上没有那个开关」，而验收原文恰恰是「覆盖相框、卡纸、展签、水印、落款、时间的全部 v2 参数」。
 * 所以这里把三件事写成数据与纯函数：
 *   1. **覆盖矩阵** `FRAMING_PANEL_FIELDS`：每个 v2 叶子参数对应的控件（形状 / 颜色 / 数字 / 开关 / 上传 / 九宫格）；
 *   2. **覆盖率判据** `framingPanelMissingFields(spec)`：拿一份**收敛后的 v2 spec**（`normalizeFrameSpecV2`
 *      的产物，由调用方传进来）逐叶子比对，列出「面板还没有控件」的参数 —— 空数组才算覆盖完整。
 *      Node 与浏览器（页面里 `await import('/src/data/framingPanel.js')`）跑的是同一份函数。
 *   3. **写入规则** `framingPanelGroupSpec` / `framingPanelFrameGroup`：面板改一个字段时只写它所属的那一组 + `version`，
 *      老模板的其它字段一个都不动（与 `data/frameStyles.js` 的「微调只写 frame / mat」是同一条纪律）。
 *
 * 为什么是**零依赖**模块（不 import `services/frameSpec.js`）：那个模块会经 `../cloud` 拉起云端 SDK，
 * data 层不能碰它；而「哪些叶子参数存在」这件事本身不需要收敛器 —— 叶子清单由调用方（后台面板 / 浏览器断言）
 * 用 `normalizeFrameSpecV2()` 现算，这里只负责比对与写入。
 *
 * 六组的清单与 `data/framingPresets.js` 的 `FRAMING_PRESET_SPEC_GROUPS`（US-031 的口径）一致：
 * 相框 / 卡纸 / 展签 / 水印 / 落款 / 时间。`canvas` 与 `art`（作品旋转）**不在**面板范围内，
 * 它们不是「六组」里的参数（作品旋转属于单幅作品的 artworkEdit，见 US-004）。
 */

/** 面板的六个参数组（顺序即界面顺序；id 必须与 v2 spec 的分组名一致）。 */
export const FRAMING_PANEL_GROUPS = [
  { id: 'frame', label: '相框', hint: '形状、框宽、材质色与光影；材质色同时决定框的底色。' },
  { id: 'mat', label: '卡纸', hint: '卡纸开关、颜色、宽度与细分隔线；关掉卡纸时作品区会占满开口。' },
  { id: 'plaque', label: '展签', hint: '展签开关、位置、底色与文字样式；位置只认上 / 下两条边（作品区一直在中间）。' },
  { id: 'watermark', label: '水印', hint: '机构 Logo、文字水印与二维码，位置走九宫格 + 短边比例。' },
  { id: 'signature', label: '落款', hint: '文字落款 / 手写签名图 + 可选印章。' },
  { id: 'date', label: '时间', hint: '来源 / 格式 / 前缀与样式，默认取本次课次日期。' }
];

export const FRAMING_PANEL_GROUP_IDS = FRAMING_PANEL_GROUPS.map((item) => item.id);
export const FRAMING_PANEL_GROUP_LABELS = FRAMING_PANEL_GROUPS.reduce((acc, item) => ({ ...acc, [item.id]: item.label }), {});

/**
 * 覆盖矩阵：v2 的**每一个叶子参数** → 面板上的控件。
 *
 * `path` 是 spec 里的点分路径（与 `normalizeFrameSpecV2()` 的产物逐字对应），
 * 界面上的控件带 `data-frame-param="<path>"`（一个参数可以有多个控件：例如「卡纸细分隔线」
 * 有一个开关 + 一个颜色选择器，两个控件都标同一个 path）。
 * `control` 只是给人看的分类：select | color | number | text | toggle | upload | pad。
 */
export const FRAMING_PANEL_FIELDS = [
  // —— 相框 ——
  { group: 'frame', path: 'frame.shape', label: '形状', control: 'select' },
  { group: 'frame', path: 'frame.color', label: '材质色', control: 'color' },
  { group: 'frame', path: 'frame.widthRatio', label: '框宽', control: 'number' },
  { group: 'frame', path: 'frame.cornerRadiusRatio', label: '圆角半径', control: 'number' },
  { group: 'frame', path: 'frame.texture', label: '纹理', control: 'select' },
  // 光影：开关 + 高光 / 暗部 / 角度三支（`frame.lighting` 只在开关打开时写进 spec）
  { group: 'frame', path: 'frame.lighting.highlight', label: '光影高光', control: 'color' },
  { group: 'frame', path: 'frame.lighting.shadow', label: '光影暗部', control: 'color' },
  { group: 'frame', path: 'frame.lighting.angle', label: '光影角度', control: 'number' },
  // —— 卡纸 ——
  { group: 'mat', path: 'mat.visible', label: '卡纸开关', control: 'toggle' },
  { group: 'mat', path: 'mat.color', label: '卡纸色', control: 'color' },
  { group: 'mat', path: 'mat.widthRatio', label: '卡纸宽', control: 'number' },
  { group: 'mat', path: 'mat.innerLine', label: '卡纸细分隔线', control: 'color' },
  // —— 展签 ——
  { group: 'plaque', path: 'plaque.visible', label: '展签开关', control: 'toggle' },
  { group: 'plaque', path: 'plaque.position', label: '展签位置', control: 'select' },
  { group: 'plaque', path: 'plaque.bg', label: '展签底色', control: 'color' },
  { group: 'plaque', path: 'plaque.text', label: '展签文字色', control: 'color' },
  { group: 'plaque', path: 'plaque.fontFamily', label: '展签字体', control: 'select' },
  { group: 'plaque', path: 'plaque.letterSpacing', label: '展签字距', control: 'number' },
  // —— 水印 ——
  { group: 'watermark', path: 'watermark.logo.visible', label: '机构 Logo 开关', control: 'toggle' },
  { group: 'watermark', path: 'watermark.logo.url', label: '机构 Logo 图', control: 'upload' },
  { group: 'watermark', path: 'watermark.logo.position', label: '机构 Logo 位置', control: 'pad' },
  { group: 'watermark', path: 'watermark.logo.offsetX', label: '机构 Logo 偏移 X', control: 'number' },
  { group: 'watermark', path: 'watermark.logo.offsetY', label: '机构 Logo 偏移 Y', control: 'number' },
  { group: 'watermark', path: 'watermark.logo.widthRatio', label: '机构 Logo 宽度', control: 'number' },
  { group: 'watermark', path: 'watermark.logo.opacity', label: '机构 Logo 透明度', control: 'number' },
  { group: 'watermark', path: 'watermark.text.visible', label: '文字水印开关', control: 'toggle' },
  { group: 'watermark', path: 'watermark.text.content', label: '文字水印内容', control: 'text' },
  { group: 'watermark', path: 'watermark.text.position', label: '文字水印位置', control: 'pad' },
  { group: 'watermark', path: 'watermark.text.offsetX', label: '文字水印偏移 X', control: 'number' },
  { group: 'watermark', path: 'watermark.text.offsetY', label: '文字水印偏移 Y', control: 'number' },
  { group: 'watermark', path: 'watermark.text.fontFamily', label: '文字水印字体', control: 'select' },
  { group: 'watermark', path: 'watermark.text.fontSize', label: '文字水印字号', control: 'number' },
  { group: 'watermark', path: 'watermark.text.color', label: '文字水印颜色', control: 'color' },
  { group: 'watermark', path: 'watermark.text.opacity', label: '文字水印透明度', control: 'number' },
  { group: 'watermark', path: 'watermark.text.rotateDeg', label: '文字水印旋转', control: 'number' },
  { group: 'watermark', path: 'watermark.qr.visible', label: '二维码开关', control: 'toggle' },
  { group: 'watermark', path: 'watermark.qr.target', label: '二维码目标', control: 'select' },
  { group: 'watermark', path: 'watermark.qr.position', label: '二维码位置', control: 'pad' },
  { group: 'watermark', path: 'watermark.qr.offsetX', label: '二维码偏移 X', control: 'number' },
  { group: 'watermark', path: 'watermark.qr.offsetY', label: '二维码偏移 Y', control: 'number' },
  { group: 'watermark', path: 'watermark.qr.sizeRatio', label: '二维码尺寸', control: 'number' },
  { group: 'watermark', path: 'watermark.qr.caption', label: '二维码说明文字', control: 'text' },
  // —— 落款 ——
  { group: 'signature', path: 'signature.visible', label: '落款开关', control: 'toggle' },
  { group: 'signature', path: 'signature.mode', label: '落款形式', control: 'select' },
  { group: 'signature', path: 'signature.teacherName', label: '落款姓名 / 文字', control: 'text' },
  { group: 'signature', path: 'signature.message', label: '落款寄语', control: 'text' },
  { group: 'signature', path: 'signature.imageUrl', label: '手写签名图', control: 'upload' },
  { group: 'signature', path: 'signature.imageWidthRatio', label: '签名图宽度', control: 'number' },
  { group: 'signature', path: 'signature.seal.visible', label: '印章开关', control: 'toggle' },
  { group: 'signature', path: 'signature.seal.text', label: '印文', control: 'text' },
  { group: 'signature', path: 'signature.seal.color', label: '印章颜色', control: 'color' },
  { group: 'signature', path: 'signature.seal.shape', label: '印章形状', control: 'select' },
  { group: 'signature', path: 'signature.position', label: '落款位置', control: 'pad' },
  { group: 'signature', path: 'signature.offsetX', label: '落款偏移 X', control: 'number' },
  { group: 'signature', path: 'signature.offsetY', label: '落款偏移 Y', control: 'number' },
  { group: 'signature', path: 'signature.fontFamily', label: '落款字体', control: 'select' },
  { group: 'signature', path: 'signature.fontSize', label: '落款字号', control: 'number' },
  { group: 'signature', path: 'signature.color', label: '落款颜色', control: 'color' },
  // —— 时间 ——
  { group: 'date', path: 'date.visible', label: '时间开关', control: 'toggle' },
  { group: 'date', path: 'date.source', label: '时间来源', control: 'select' },
  { group: 'date', path: 'date.format', label: '时间格式', control: 'select' },
  { group: 'date', path: 'date.prefix', label: '时间前缀', control: 'text' },
  { group: 'date', path: 'date.manualValue', label: '手填日期', control: 'text' },
  { group: 'date', path: 'date.position', label: '时间位置', control: 'pad' },
  { group: 'date', path: 'date.offsetX', label: '时间偏移 X', control: 'number' },
  { group: 'date', path: 'date.offsetY', label: '时间偏移 Y', control: 'number' },
  { group: 'date', path: 'date.fontSize', label: '时间字号', control: 'number' },
  { group: 'date', path: 'date.color', label: '时间颜色', control: 'color' }
];

export const FRAMING_PANEL_FIELD_PATHS = FRAMING_PANEL_FIELDS.map((item) => item.path);
const FRAMING_PANEL_FIELD_SET = new Set(FRAMING_PANEL_FIELD_PATHS);

/** 某个路径的面板字段描述（界面与断言共用；没有就是 null）。 */
export function framingPanelField(path) {
  return FRAMING_PANEL_FIELDS.find((item) => item.path === path) || null;
}

/** 面板是否覆盖某个路径。 */
export function framingPanelCovers(path) {
  return FRAMING_PANEL_FIELD_SET.has(String(path));
}

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * 列出对象里的**叶子路径**（`{frame:{color:'#fff'}}` → `['frame.color']`）。
 *
 * 空对象本身算一个叶子（`{}` → `['frame.lighting']`）：收敛器给出的「结构上是对象、
 * 里面一个字段都没有」的参数一样需要面板上有控件，不能被当成「没有这个参数」略过。
 * 数组与 null 都当叶子（它们是原样写入的值）。
 */
export function framingPanelLeafPaths(value, prefix = '') {
  if (!isPlainObject(value)) return prefix ? [prefix] : [];
  const keys = Object.keys(value);
  if (!keys.length) return prefix ? [prefix] : [];
  return keys.flatMap((key) => framingPanelLeafPaths(value[key], prefix ? `${prefix}.${key}` : key));
}

/**
 * 覆盖率判据：`spec`（**收敛后的 v2 结构**，`normalizeFrameSpecV2()` 的产物）里，
 * 六个组中**面板没有控件**的叶子参数。空数组 = 覆盖完整。
 *
 * 只检查六组：`canvas` 与 `art` 不在「相框 / 卡纸 / 展签 / 水印 / 落款 / 时间」的范围内
 * （作品旋转属于单幅作品的 artworkEdit）。
 */
export function framingPanelMissingFields(spec, fields = FRAMING_PANEL_FIELD_PATHS) {
  const covered = new Set(fields);
  return framingPanelPresentPaths(spec).filter((path) => !covered.has(path));
}

/** 六个组里**实际出现**的叶子路径（组本身缺失就不算 —— 面板不要求 spec 一定已收敛过）。 */
export function framingPanelPresentPaths(spec) {
  const source = isPlainObject(spec) ? spec : {};
  return FRAMING_PANEL_GROUP_IDS.flatMap((group) => (
    isPlainObject(source[group]) ? framingPanelLeafPaths(source[group], group) : []
  ));
}

/** 面板覆盖情况的一句话描述（界面上的徽标；`{covered, total, missing}`）。 */
export function framingPanelCoverage(spec, fields = FRAMING_PANEL_FIELD_PATHS) {
  const covered = new Set(fields);
  const present = framingPanelPresentPaths(spec);
  const missing = present.filter((path) => !covered.has(path));
  const hit = new Set(present.filter((path) => covered.has(path)));
  return {
    covered: hit.size,
    total: FRAMING_PANEL_FIELD_PATHS.length,
    present: present.length,
    missing
  };
}

/**
 * 把一份**分组值**写进 spec：只覆盖这一组 + `version`，其余字段（v1 平面字段与其它分组）原样保留。
 *
 * 混写结构在 `normalizeFrameSpecV2` 里是合法输入（v2 分组优先、v1 平面字段兜底），
 * 所以「老 v1 模板 + 后台改了一个相框形状」不需要迁移模板本身。
 */
export function framingPanelGroupSpec(spec, group, values) {
  const base = isPlainObject(spec) ? spec : {};
  return { ...base, version: 2, [group]: values };
}

/**
 * 相框分组的写入口径：**光影只有在开关打开时才有 `lighting` 字段**（缺省 = 不画光影 = v1 老模板的样子）。
 *
 * 这条与 `services/frameSpec.js` 的 `frameSpecRenderView` 是同一个判据（`frame.lighting` 是对象才算显式给出），
 * 所以「关掉光影」写出来的是**删掉这个键**，而不是写 `lighting: null` —— 后者在渲染层同样不画，
 * 但界面上「有没有开过光影」就说不清了，模板里也会留下一个空壳。
 */
export function framingPanelFrameGroup(values, lightingOn = false) {
  const source = isPlainObject(values) ? values : {};
  const { lighting: rawLighting, ...rest } = source;
  if (!lightingOn || !isPlainObject(rawLighting)) return rest;
  return { ...rest, lighting: { ...rawLighting } };
}

/**
 * `frame.lighting` 是否被**显式**给出（= 光影开关的状态）。
 * 与 `services/frameSpec.js` 的渲染判据逐字对应：只要 `frame.lighting` 是普通对象就算开着。
 */
export function framingPanelLightingOn(spec) {
  const frame = isPlainObject(spec) && isPlainObject(spec.frame) ? spec.frame : {};
  return isPlainObject(frame.lighting);
}

/** 光影三支的默认值：与 `DEFAULT_FRAME_SPEC_V2.frame.lighting` 一致（面板打开开关时先用它）。 */
export const FRAMING_PANEL_LIGHTING_DEFAULT = { highlight: '#E8C766', shadow: '#8A6B1C', angle: 135 };

/** 开关某一组里的一个布尔字段（面板的 checkbox 都用它，避免每处各写一遍合并逻辑）。 */
export function framingPanelToggle(values, key, on) {
  const source = isPlainObject(values) ? values : {};
  return { ...source, [key]: on === true };
}
