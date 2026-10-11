// 叠加元素（水印 / 落款 / 时间 / 二维码）的**公共定位框架 + 变量替换**。
//
// 为什么单独一份（[第二步 US-003a] 的验收）：
//   1. **九宫格位置枚举 + offsetX/offsetY 比例偏移**（-0.5~0.5）。九个格子决定元素贴哪个角/边，
//      偏移是在这个基础上再挪一点。**正值一律朝画布内侧**（右下角 +0.03 表示「离右边和下边各留
//      3% 短边」），负值把元素往画布外推（可以让水印出血），所以同一份模板不会因为换个角落
//      就把元素推出画面。
//   2. **位置与尺寸一律用「相对画布短边的比例」表达**：短边 = min(画布宽, 高)。同一份模板在
//      1800×1360 的合成画布与将来更大的导出图上，元素相对位置与相对大小完全一致。
//      字号在 spec 里是「1800×1360 画布上的像素值」，这里按 `OVERLAY_BASE_SHORT_EDGE` 折算成比例再放大回来。
//   3. **文本内容支持变量占位符替换**：`{机构名}` `{学员名}` `{作品名}` `{老师姓名}` `{课次日期}`。
//      **未命中的变量（不是这五个之一）保留原文**，并由 `overlayVariableWarnings()` 回报给后台（FR-19）；
//      命中的变量但当前上下文里没有值（例如机构名还没配置）替换成空串 —— 空内容不绘制，不会留下
//      「一堆空括号」的占位。
//
// 本模块是**零依赖纯函数**（不 import 任何模块，与 `frameShapes.js` 同一口径）：
// 渲染层与将来的后台定位面板（US-007 的九宫格控件）读的是同一份规则，也保证能直接
// `node xxx.mjs` 跑断言 —— 界面做不了的定位/替换规则全部收在这里。

/** offsetX / offsetY 的生效范围（相对画布短边）。**收敛器与定位层共用这一份**，不要在任何一侧写死 ±0.5。 */
export const ELEMENT_OFFSET_RANGE = { min: -0.5, max: 0.5 };

/** 自由定位：面板上拖动微调后落到这个位置（锚点 = 画布中心 + 偏移）。 */
export const CUSTOM_ELEMENT_POSITION = 'custom';

/**
 * 九宫格位置枚举（PRD 词汇表的口径）。前九个是九宫格，最后一个 `custom` 是拖动微调后的自由位置。
 * 定位、归一化与后台控件（US-007）都读这一份。
 */
export const ELEMENT_POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
  CUSTOM_ELEMENT_POSITION
];

/** 九宫格锚点（画布宽/高的比例，0=左/上、0.5=中、1=右/下）。`custom` 锚在中心。 */
export const ELEMENT_POSITION_ANCHORS = ELEMENT_POSITIONS.reduce((map, position) => {
  if (position === CUSTOM_ELEMENT_POSITION) { map[position] = { x: 0.5, y: 0.5 }; return map; }
  const [row, column] = position.split('-');
  const fraction = (key) => (key === 'left' || key === 'top' ? 0 : key === 'center' || key === 'middle' ? 0.5 : 1);
  map[position] = { x: fraction(column), y: fraction(row) };
  return map;
}, {});

/** 字号的设计基准短边：1800×1360 合成画布的短边。spec 里的 fontSize 就是按这个尺寸写的像素值。 */
export const OVERLAY_BASE_SHORT_EDGE = 1360;

/**
 * 文本类叠加元素的**字体白名单**（PRD：面板字体限后台白名单）。
 * 唯一真源在这里：`frameSpec` 的收敛器（v1 与 v2 两侧）与绘制层都读它，
 * 后台/老师端的字体下拉（US-007）也从这里取选项 —— 别在任何一侧再抄一份。
 */
export const OVERLAY_FONT_WHITELIST = ['serif', 'sans-serif', 'Songti SC', 'STSong', 'Kaiti SC', 'STKaiti', 'Noto Serif SC'];

/** 白名单外的字体族回落值（`sans-serif` 是 v2 默认水印与最稳的通用族）。 */
export const DEFAULT_OVERLAY_FONT = 'sans-serif';

/** 字体是否在白名单里。 */
export function isOverlayFont(value) {
  return OVERLAY_FONT_WHITELIST.includes(String(value ?? '').trim());
}

/** 归一化字体族：白名单外一律回落（脏数据 / 任意字体名都进不了渲染）。 */
export function normalizeOverlayFont(value, fallback = DEFAULT_OVERLAY_FONT) {
  const raw = String(value ?? '').trim();
  return OVERLAY_FONT_WHITELIST.includes(raw) ? raw : fallback;
}

/** 九宫格位置的中文名（后台/老师端控件与无障碍标签共用一份）。 */
export const OVERLAY_POSITION_LABELS = {
  'top-left': '左上',
  'top-center': '上中',
  'top-right': '右上',
  'middle-left': '左中',
  'middle-center': '居中',
  'middle-right': '右中',
  'bottom-left': '左下',
  'bottom-center': '下中',
  'bottom-right': '右下',
  [CUSTOM_ELEMENT_POSITION]: '自由位置'
};

/** 位置的中文名；非法位置按 `bottom-right`（与定位层的兜底同一个口径）。 */
export function overlayPositionLabel(position) {
  return OVERLAY_POSITION_LABELS[position] || OVERLAY_POSITION_LABELS['bottom-right'];
}

/** 五个变量占位符（PRD 词汇表）与上下文字段名的对应关系。 */
export const OVERLAY_VARIABLE_KEYS = {
  '机构名': 'orgName',
  '学员名': 'studentName',
  '作品名': 'workTitle',
  '老师姓名': 'teacherName',
  '课次日期': 'lessonDate'
};

/** 变量名清单（顺序即文档里的顺序，界面上提示占位符时也用它）。 */
export const OVERLAY_VARIABLES = Object.keys(OVERLAY_VARIABLE_KEYS);

const COLUMNS = {
  left: { align: 0, dir: 1, textAlign: 'left' },
  center: { align: 0.5, dir: 1, textAlign: 'center' },
  right: { align: 1, dir: -1, textAlign: 'right' }
};

const ROWS = {
  top: { align: 0, dir: 1, textBaseline: 'top' },
  middle: { align: 0.5, dir: 1, textBaseline: 'middle' },
  bottom: { align: 1, dir: -1, textBaseline: 'bottom' }
};

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const size = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const pad2 = (value) => String(value).padStart(2, '0');

/** 把 offset 收敛到 `ELEMENT_OFFSET_RANGE`；脏值（NaN / null / 字符串）返回 fallback。 */
export function clampOverlayOffset(value, fallback = 0) {
  return clamp(value, ELEMENT_OFFSET_RANGE.min, ELEMENT_OFFSET_RANGE.max, fallback);
}

/** 位置是否合法。非法位置一律回落 `bottom-right`（与 v2 默认值同一个口径）。 */
export function isElementPosition(value) {
  return ELEMENT_POSITIONS.includes(value);
}

/**
 * 位置 → 定位参数。`align*` 是元素贴哪条边（0/0.5/1），`dir*` 是「偏移正向朝哪边」：
 * 贴左边/上边时正向朝画布内侧（右下），贴右边/下边时正向朝左/上（也是内侧），中间/中心取自然方向。
 * 文本元素的 `textAlign` / `textBaseline` 由同一份映射给出，保证「九宫格一改，文字与图形一起走」。
 */
export function resolveElementAnchor(position) {
  const key = isElementPosition(position) ? position : 'bottom-right';
  if (key === CUSTOM_ELEMENT_POSITION) {
    return { position: key, alignX: 0.5, alignY: 0.5, dirX: 1, dirY: 1, textAlign: 'center', textBaseline: 'middle' };
  }
  const [row, column] = key.split('-');
  const col = COLUMNS[column] || COLUMNS.right;
  const line = ROWS[row] || ROWS.bottom;
  return {
    position: key,
    alignX: col.align,
    alignY: line.align,
    dirX: col.dir,
    dirY: line.dir,
    textAlign: col.textAlign,
    textBaseline: line.textBaseline
  };
}

/** 画布短边（位置与尺寸的比例基准）。宽高缺失/为 0 时返回 1，保证下游永不出现 NaN。 */
export function overlayShortEdge(canvasWidth, canvasHeight) {
  const w = size(canvasWidth);
  const h = size(canvasHeight);
  return Math.max(1, Math.min(w || 1, h || 1));
}

/** 比例 → 像素（相对画布短边）。 */
export function scaleByShortEdge(ratio, canvasWidth, canvasHeight) {
  const n = Number(ratio);
  if (!Number.isFinite(n)) return 0;
  return n * overlayShortEdge(canvasWidth, canvasHeight);
}

/**
 * 文本类元素的锚点：返回**绘制点** + `textAlign` / `textBaseline`（配合 ctx.fillText 直接用）。
 * 偏移正值朝画布内侧，所以右下角的元素写 `offsetX/offsetY = 0.03` 就得到「离右下各留 3% 短边」。
 */
export function resolveOverlayAnchor({ position, offsetX, offsetY, canvasWidth, canvasHeight } = {}) {
  const anchor = resolveElementAnchor(position);
  const shortEdge = overlayShortEdge(canvasWidth, canvasHeight);
  const dx = clampOverlayOffset(offsetX) * anchor.dirX * shortEdge;
  const dy = clampOverlayOffset(offsetY) * anchor.dirY * shortEdge;
  return {
    position: anchor.position,
    x: anchor.alignX * size(canvasWidth) + dx,
    y: anchor.alignY * size(canvasHeight) + dy,
    textAlign: anchor.textAlign,
    textBaseline: anchor.textBaseline,
    shortEdge
  };
}

/**
 * 图片/二维码类元素的定位框（左上角 + 尺寸，全部由短边比例算出）。
 * 宽高缺省为 0（调用方再用图片自身比例补高），所以「只给宽度比例」也能定位。
 */
export function resolveOverlayBox({ position, offsetX, offsetY, widthRatio, heightRatio, canvasWidth, canvasHeight } = {}) {
  const anchor = resolveElementAnchor(position);
  const shortEdge = overlayShortEdge(canvasWidth, canvasHeight);
  const width = Math.max(0, Number(widthRatio) || 0) * shortEdge;
  const height = Math.max(0, Number(heightRatio) || 0) * shortEdge;
  const canvasW = size(canvasWidth);
  const canvasH = size(canvasHeight);
  const dx = clampOverlayOffset(offsetX) * anchor.dirX * shortEdge;
  const dy = clampOverlayOffset(offsetY) * anchor.dirY * shortEdge;
  return {
    position: anchor.position,
    // 贴边时用「画布 - 元素尺寸」当基准：元素整体落在画布内，偏移再把它往内侧推。
    x: anchor.alignX * Math.max(0, canvasW - width) + dx,
    y: anchor.alignY * Math.max(0, canvasH - height) + dy,
    width,
    height,
    shortEdge
  };
}

/**
 * 字号像素值：spec 里写的是「设计基准短边（1360）下的像素」，这里按实际画布短边等比放大。
 * 于是同一份模板在更大的导出图上文字同样大（位置与尺寸都走短边比例的说法在这里闭合）。
 */
export function resolveOverlayFontSize(fontSize, canvasWidth, canvasHeight) {
  const n = Number(fontSize);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n * (overlayShortEdge(canvasWidth, canvasHeight) / OVERLAY_BASE_SHORT_EDGE);
}

/**
 * 日期文本归一成 `YYYY.MM.DD`（`{课次日期}` 的展示口径）。
 * 认得 `2026-08-04` / `2026.08.04` / `2026/8/4` / `20260804` 与前 10 位是日期的 ISO 串；
 * **认不出来就原样返回**，不编造日期（与 data/lessons.js 的旧数据兼容口径一致）。
 * 时间元素的 source / format 切换属于 US-003c，这里只服务变量替换。
 */
export function overlayDateText(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}.${pad2(value.getMonth() + 1)}.${pad2(value.getDate())}`;
  }
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const separated = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (separated) return `${separated[1]}.${pad2(separated[2])}.${pad2(separated[3])}`;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}.${compact[2]}.${compact[3]}`;
  return raw;
}

/**
 * 变量上下文：把渲染时手边的真实值收敛成**一定是字符串**的五个字段。
 * `lessonDate` 顺手归一成 `YYYY.MM.DD`；其余字段 trim，缺省为空串（空值不绘制，不留空占位）。
 */
export function overlayVariableContext(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    orgName: String(source.orgName ?? '').trim(),
    studentName: String(source.studentName ?? '').trim(),
    workTitle: String(source.workTitle ?? '').trim(),
    teacherName: String(source.teacherName ?? '').trim(),
    lessonDate: overlayDateText(source.lessonDate ?? source.date)
  };
}

/** 模板里出现的 `{变量}` 名（按出现顺序去重）。用于后台提示占位符与找「未命中变量」。 */
export function findOverlayVariables(template) {
  const raw = String(template ?? '');
  const found = [];
  for (const match of raw.matchAll(/\{([^{}]{1,16})\}/g)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * 变量替换。返回 `{ text, replaced, missing, empty }`：
 *   - `replaced` 命中且有值的变量名；
 *   - `missing`  **不在五个变量里**的占位符（原文保留，后台要给它一条警告 —— FR-19）；
 *   - `empty`    命中了变量但当前上下文没有值（替换成空串）。
 * 永不抛错：非字符串模板按空串处理。
 */
export function applyOverlayVariables(template, context = {}) {
  const values = context && typeof context === 'object' ? context : {};
  const names = findOverlayVariables(template);
  const replaced = [];
  const missing = [];
  const empty = [];
  for (const name of names) {
    const key = OVERLAY_VARIABLE_KEYS[name];
    if (!key) { missing.push(name); continue; }
    const value = String(values[key] ?? '').trim();
    if (value) replaced.push(name); else empty.push(name);
  }
  const text = String(template ?? '').replace(/\{([^{}]{1,16})\}/g, (whole, name) => {
    const key = OVERLAY_VARIABLE_KEYS[name];
    if (!key) return whole; // 未命中：保留原文，绝不静默吞掉
    return String(values[key] ?? '').trim();
  });
  return { text, replaced, missing, empty };
}

/** 后台用的警告文案（FR-19：未命中变量时保留原文并在后台给出警告）。 */
export function overlayVariableWarnings(template, context = {}) {
  const { missing, empty } = applyOverlayVariables(template, context);
  const warnings = missing.map((name) => `未知变量 {${name}}：渲染时保留原文，可选变量为 ${OVERLAY_VARIABLES.map((item) => `{${item}}`).join(' ')}`);
  if (empty.length) warnings.push(`变量 ${empty.map((name) => `{${name}}`).join(' ')} 当前没有值，渲染时替换为空。`);
  return warnings;
}

/**
 * 元素是否绘制：**只有显式 `visible === true` 才画**。
 * 缺省 / false / 脏值一律不画 —— v1 本来就没有叠加元素，默认 true 会让迁移过来的老模板凭空多出东西。
 */
export function shouldDrawOverlay(element) {
  return !!element && typeof element === 'object' && element.visible === true;
}

/** 按绘制门控过滤元素列表（不可见的元素直接**不进绘制层**，因此不会留下任何空白占位）。 */
export function visibleOverlayElements(elements) {
  return (Array.isArray(elements) ? elements : []).filter((item) => shouldDrawOverlay(item?.element));
}

/**
 * 文本类元素的绘制计划：`null` 表示**完全不绘制**（不可见 / 内容为空）。
 * 位置、字号与文本色全部在这里定好，绘制层只负责 fillText，不做任何位置推算。
 */
export function planOverlayText({ element, canvasWidth, canvasHeight, context = {} } = {}) {
  if (!shouldDrawOverlay(element)) return null;
  const { text, missing, empty } = applyOverlayVariables(element.content, context);
  if (!text.trim()) return null;
  const anchor = resolveOverlayAnchor({
    position: element.position,
    offsetX: element.offsetX,
    offsetY: element.offsetY,
    canvasWidth,
    canvasHeight
  });
  return {
    text,
    x: anchor.x,
    y: anchor.y,
    textAlign: anchor.textAlign,
    textBaseline: anchor.textBaseline,
    fontFamily: normalizeOverlayFont(element.fontFamily),
    fontSize: resolveOverlayFontSize(element.fontSize, canvasWidth, canvasHeight),
    color: String(element.color ?? '').trim() || '#6D6559',
    opacity: clamp(element.opacity, 0, 1, 1),
    rotateDeg: Number.isFinite(Number(element.rotateDeg)) ? Number(element.rotateDeg) : 0,
    missing,
    empty
  };
}

// ---------------------------------------------------------------------------
// 图片类元素（机构 Logo / 二维码 / 手写签名图）的定位
// ---------------------------------------------------------------------------

/**
 * 图片类元素高度的上限（相对画布高）：又窄又长的 Logo 按宽度比例算出来的高度可能高过整块画布，
 * 所以这里按「先定宽度、再按图片比例定高度、高度超限就整体等比缩回来」收敛，
 * 保证元素**整体落在画布内**（与九宫格偏移「正值朝内侧」是同一类不越界承诺）。
 */
export const OVERLAY_IMAGE_MAX_HEIGHT_RATIO = 0.5;

/**
 * 图片类元素的定位框：宽度取 `widthRatio × 画布短边`，高度按图片自身比例算（**不拉伸、不裁切**），
 * 高度超过 `maxHeightRatio × 画布高` 时整体等比缩小；随后交给 `resolveOverlayBox` 处理贴边与偏移。
 *
 * 图片尺寸未知（还没解码 / 解码失败）时按**正方形**估一个框 —— 宁可在遮挡统计里高估一点，
 * 也不要因为量不出来就漏报「水印挡了孩子的画」。
 */
export function resolveOverlayImageBox({ element, imageWidth, imageHeight, canvasWidth, canvasHeight, maxHeightRatio = OVERLAY_IMAGE_MAX_HEIGHT_RATIO } = {}) {
  const source = element && typeof element === 'object' ? element : {};
  const shortEdge = overlayShortEdge(canvasWidth, canvasHeight);
  const w = Number(imageWidth);
  const h = Number(imageHeight);
  const aspect = Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0 ? h / w : 1;
  const widthRatio = Math.max(0, Number(source.widthRatio) || 0);
  let width = widthRatio * shortEdge;
  let height = width * aspect;
  const canvasH = size(canvasHeight);
  const maxHeight = (Number(maxHeightRatio) || OVERLAY_IMAGE_MAX_HEIGHT_RATIO) * canvasH;
  if (canvasH > 0 && height > maxHeight && height > 0) {
    const k = maxHeight / height;
    width *= k;
    height *= k;
  }
  return resolveOverlayBox({
    position: source.position,
    offsetX: source.offsetX,
    offsetY: source.offsetY,
    widthRatio: shortEdge > 0 ? width / shortEdge : 0,
    heightRatio: shortEdge > 0 ? height / shortEdge : 0,
    canvasWidth,
    canvasHeight
  });
}

/** 矩形规格化：宽高为负时翻正；缺字段/脏值返回 null（调用方一律当「没有框」处理）。 */
export function normalizeRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** 两个矩形的交集（无交集返回 null）。 */
export function intersectRect(a, b) {
  const left = normalizeRect(a);
  const right = normalizeRect(b);
  if (!left || !right) return null;
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  if (x2 <= x || y2 <= y) return null;
  return { x, y, width: x2 - x, height: y2 - y };
}

/** 把矩形绕 (cx, cy) 旋转后取轴对齐外接框（旋转的水印不会漏统面积）。 */
export function rotateRectBounds(rect, cx, cy, degrees) {
  const source = normalizeRect(rect);
  if (!source) return null;
  const deg = Number(degrees);
  if (!Number.isFinite(deg) || deg % 360 === 0) return source;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    [source.x, source.y],
    [source.x + source.width, source.y],
    [source.x + source.width, source.y + source.height],
    [source.x, source.y + source.height]
  ].map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * 文本宽度的粗略估算（**没有 canvas 时**的兜底）：CJK 按 1em、其余按 0.55em。
 * 只在 Node 断言 / 无 canvas 环境下用得上；浏览器里一律传真实 `measureText`。
 */
export function estimateTextWidth(text, fontSize) {
  const size = Number(fontSize) > 0 ? Number(fontSize) : 0;
  let units = 0;
  for (const char of String(text ?? '')) {
    units += /[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(char) ? 1 : 0.55;
  }
  return units * size;
}

/**
 * 文本绘制计划 → **轴对齐外接框**（水印遮挡统计与后台九宫格预览用）。
 *
 * 口径说明（为什么是「近似」）：字形有侧边距、基线之下有 descent，canvas 的
 * `actualBoundingBox*` 在浏览器里能给出墨迹范围，这里优先用它（由绘制层传入 `measureText`）；
 * 拿不到时按 `fontSize × 0.8 / 0.2` 估 ascent / descent。垂直位置按 `textBaseline` 语义对齐，
 * 再按 `rotateDeg` 绕锚点旋转取外接框。所以它是**偏保守**的覆盖面积（略大不略小）。
 */
export function textPlanBox(plan, measureText) {
  if (!plan || !plan.text) return null;
  const fontSize = Number(plan.fontSize) > 0 ? Number(plan.fontSize) : 0;
  let width = estimateTextWidth(plan.text, fontSize);
  let ascent = fontSize * 0.8;
  let descent = fontSize * 0.2;
  if (typeof measureText === 'function') {
    const metrics = measureText(plan.text, `${plan.fontSize}px ${plan.fontFamily}`) || {};
    if (Number.isFinite(metrics.width) && metrics.width > 0) width = metrics.width;
    if (Number.isFinite(metrics.ascent) && metrics.ascent > 0) ascent = metrics.ascent;
    if (Number.isFinite(metrics.descent) && metrics.descent > 0) descent = metrics.descent;
  }
  const height = ascent + descent;
  if (!(width > 0) || !(height > 0)) return null;
  const x = Number(plan.x) || 0;
  const y = Number(plan.y) || 0;
  const align = plan.textAlign === 'center' ? 'center' : plan.textAlign === 'right' ? 'right' : 'left';
  const baseline = plan.textBaseline || 'alphabetic';
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  const top = baseline === 'top' ? y
    : baseline === 'middle' ? y - height / 2
      : baseline === 'bottom' ? y - height
        : y - ascent;
  const rect = { x: left, y: top, width, height };
  return rotateRectBounds(rect, x, y, plan.rotateDeg);
}

// ---------------------------------------------------------------------------
// 叠加元素清单与「水印遮挡作品主体」统计
// ---------------------------------------------------------------------------

/**
 * 叠加元素清单：把 `overlays` 五个分组摊平成 `{ kind, element }`。
 * 绘制层与遮挡统计**读同一份清单**，新增一组时只加在这里。
 */
export function overlayElementEntries(overlays) {
  const groups = overlays && typeof overlays === 'object' ? overlays : {};
  const watermark = groups.watermark && typeof groups.watermark === 'object' ? groups.watermark : {};
  return [
    { kind: 'watermark.text', element: watermark.text },
    { kind: 'watermark.logo', element: watermark.logo },
    { kind: 'watermark.qr', element: watermark.qr },
    { kind: 'signature', element: groups.signature },
    { kind: 'date', element: groups.date }
  ];
}

/**
 * **已经接了画笔**的类别（US-003b 是文字水印 + 机构 Logo）。
 *
 * 纪律：新增一支画笔时，这里与 `framing.js` 的 `drawOverlayElements()` **一起改**，
 * 并在 `overlayElementBoxes()` 里补对应的取框分支。绘制与遮挡统计必须看同一份清单 ——
 * 只看其一就会出现「提示说挡住了、其实没画」或者「画了但统计不到」。
 */
export const DRAWN_OVERLAY_KINDS = ['watermark.text', 'watermark.logo'];

/** 该类别的框是否按**图片**计算（其余按文本）。 */
const IMAGE_OVERLAY_KINDS = ['watermark.logo', 'watermark.qr', 'signature'];

/**
 * 每个「可见且已接画笔」的叠加元素在画布上的轴对齐外接框。
 *
 * - 文本类：走 `planOverlayText()`（内容为空 / 不可见 → 没有框），再 `textPlanBox()` 取外接框；
 * - 图片类：走 `resolveOverlayImageBox()`，尺寸由 `imageSizes[kind]` 提供（真实解码值）；
 * - 二维码：走 `resolveOverlayBox()`（`sizeRatio` 正方形，二维码本来就该是方的）。
 *
 * `imageSizes` 里没有的图片按正方形估（见 `resolveOverlayImageBox`）。
 * 返回 `[{ kind, element, box }]`，顺序与 `overlayElementEntries()` 一致（也就与绘制顺序一致）。
 */
export function overlayElementBoxes({ overlays, canvasWidth, canvasHeight, context = {}, measureText, imageSizes = {}, kinds = DRAWN_OVERLAY_KINDS } = {}) {
  const wanted = Array.isArray(kinds) ? kinds : DRAWN_OVERLAY_KINDS;
  const sizes = imageSizes && typeof imageSizes === 'object' ? imageSizes : {};
  const boxes = [];
  for (const { kind, element } of visibleOverlayElements(overlayElementEntries(overlays))) {
    if (!wanted.includes(kind)) continue;
    let box = null;
    if (kind === 'watermark.qr') {
      const ratio = Number(element?.sizeRatio) || 0;
      box = resolveOverlayBox({
        position: element?.position,
        offsetX: element?.offsetX,
        offsetY: element?.offsetY,
        widthRatio: ratio,
        heightRatio: ratio,
        canvasWidth,
        canvasHeight
      });
    } else if (IMAGE_OVERLAY_KINDS.includes(kind)) {
      box = resolveOverlayImageBox({
        element,
        imageWidth: sizes[kind]?.width,
        imageHeight: sizes[kind]?.height,
        canvasWidth,
        canvasHeight
      });
    } else {
      box = textPlanBox(planOverlayText({ element, canvasWidth, canvasHeight, context }), measureText);
    }
    const rect = normalizeRect(box);
    if (rect) boxes.push({ kind, element, box: rect });
  }
  return boxes;
}

/** 水印 / 落款允许遮挡作品主体的面积上限（US-003b 的验收：超过 15% 要提示）。 */
export const OVERLAY_COVERAGE_LIMIT = 0.15;

/** 超过多少块矩形才退回「直接累加」的保守估计（容斥是 2^n 项，别让元素数量把面板卡住）。 */
const UNION_EXACT_LIMIT = 12;

/**
 * 若干矩形的**并集面积**（容斥原理，精确；元素数超过 `UNION_EXACT_LIMIT` 时退回累加，
 * 结果只会偏大，用于「是否超过上限」的判断是安全的）。
 */
export function unionRectArea(rects) {
  const items = (Array.isArray(rects) ? rects : []).map(normalizeRect).filter(Boolean);
  if (!items.length) return 0;
  if (items.length === 1) return items[0].width * items[0].height;
  if (items.length > UNION_EXACT_LIMIT) {
    return items.reduce((sum, rect) => sum + rect.width * rect.height, 0);
  }
  let total = 0;
  const masks = 1 << items.length;
  for (let mask = 1; mask < masks; mask += 1) {
    let left = -Infinity, top = -Infinity, right = Infinity, bottom = Infinity, bits = 0;
    for (let index = 0; index < items.length; index += 1) {
      if (!(mask & (1 << index))) continue;
      bits += 1;
      const rect = items[index];
      left = Math.max(left, rect.x);
      top = Math.max(top, rect.y);
      right = Math.min(right, rect.x + rect.width);
      bottom = Math.min(bottom, rect.y + rect.height);
    }
    const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
    total += (bits % 2 === 1 ? 1 : -1) * overlap;
  }
  return total;
}

/** 百分比文案：保留一位小数（`7.5%` / `23%`）。 */
export function coveragePercentLabel(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value) || value <= 0) return '0%';
  const percent = Math.round(value * 1000) / 10;
  return `${percent}%`;
}

/**
 * 「水印 / 落款遮挡作品主体」的统计与提示。
 *
 * 口径（PRD FR-24 与 US-003 的验收「水印/落款区永远不遮挡作品本体超过 15% 面积时给出提示」）：
 * - 分母是**作品主体**（作品在画布里真正占的那块矩形，`subjectRect`），不是整块画布，
 *   也不是卡纸开口 —— 卡纸与相框区域本来就让给水印，只有压在孩子画上的部分才算遮挡；
 * - 分子是所有叠加元素框与作品主体**交集的并集**（用并集而不是逐个相加：两个水印叠在一起不该算两遍）；
 * - `exceeds` 为真时 `message` 给可读提示（面板直接显示），未超限时 `summary` 给一句中性说明。
 *
 * 永不抛错：`subjectRect` 缺失/非法时全部按 0 收敛（面板只会看到「没有遮挡」）。
 */
export function evaluateOverlayCoverage(options) {
  // 形参解构的默认值只对 `undefined` 生效，`null` 会直接抛 —— 面板可能把没算出来的值直接透传，
  // 所以这里显式收敛一次（与其它模块「脏数据永不抛错」的口径一致）。
  const source = options && typeof options === 'object' ? options : {};
  const boxes = Array.isArray(source.boxes) ? source.boxes : [];
  const limitRatio = source.limitRatio === undefined ? OVERLAY_COVERAGE_LIMIT : source.limitRatio;
  const subject = normalizeRect(source.subjectRect);
  const limit = clamp(limitRatio, 0, 1, OVERLAY_COVERAGE_LIMIT);
  const subjectArea = subject ? subject.width * subject.height : 0;
  const items = boxes.map((item) => {
    const box = normalizeRect(item?.box);
    const overlap = subject && box ? intersectRect(box, subject) : null;
    const area = overlap ? overlap.width * overlap.height : 0;
    return {
      kind: String(item?.kind || ''),
      box,
      intersection: overlap,
      area,
      ratio: subjectArea > 0 ? area / subjectArea : 0
    };
  });
  const coveredArea = unionRectArea(items.map((item) => item.intersection).filter(Boolean));
  const coveredRatio = subjectArea > 0 ? coveredArea / subjectArea : 0;
  const exceeds = coveredRatio > limit + 1e-9;
  const worst = items.slice().sort((a, b) => b.area - a.area)[0] || null;
  const percent = coveragePercentLabel(coveredRatio);
  const limitText = coveragePercentLabel(limit);
  return {
    items,
    subject,
    subjectArea,
    coveredArea,
    coveredRatio,
    limit,
    limitText,
    percentText: percent,
    exceeds,
    worst,
    summary: subjectArea > 0 ? `水印与落款合计遮挡作品主体 ${percent}（上限 ${limitText}）` : '',
    message: exceeds
      ? `水印遮挡作品主体约 ${percent}，超过 ${limitText} 上限，建议缩小水印尺寸或挪到作品的空白处，别把孩子的画挡死。`
      : ''
  };
}
