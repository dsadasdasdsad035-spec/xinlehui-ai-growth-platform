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
    fontFamily: String(element.fontFamily ?? '').trim() || 'sans-serif',
    fontSize: resolveOverlayFontSize(element.fontSize, canvasWidth, canvasHeight),
    color: String(element.color ?? '').trim() || '#6D6559',
    opacity: clamp(element.opacity, 0, 1, 1),
    rotateDeg: Number.isFinite(Number(element.rotateDeg)) ? Number(element.rotateDeg) : 0,
    missing,
    empty
  };
}
