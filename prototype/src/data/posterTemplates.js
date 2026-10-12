// 海报模板（poster spec v1）的数据模型与收敛器 —— 「后台改参数即出新模板」的唯一真源。
// （[海报 US-301a] / tasks/prd-share-poster.md 的 FR-301 ~ FR-307、FR-312、FR-323、FR-325）
//
// 与装裱（`services/frameSpec.js` + `data/framingPresets.js`）**完全同构**：模板是**参数**不是底图 ——
// 一份 spec 能被 canvas 精确画出来，于是「加一套模板」只是加一份 JSON，而不是加一段代码；
// 结果可复现（同一份 spec + 同一份数据 → 同一张图），也能无损缩放到任何导出尺寸。
//
// 本模块在 data 层：**零依赖纯函数**，不碰 DOM / canvas / 网络，可 `node` 直跑断言。
// 真正落笔的是 `services/poster.js` 的 `renderPoster({ spec, data, scale })`（US-301b）——
// 预览与导出共用它，只有 `scale` 不同（FR-312），所以这里不提供任何「预览专用」的字段。
//
// 三条硬约定：
//   1. spec 结构固定为 `version / kind / canvas / background / frame / decor / slots[]`（FR-301）。
//   2. `slots[]` 只有四种类型：`image` / `text` / `qrcode` / `logo`（FR-302）。
//      **未知类型没有合理默认值 → 直接丢弃**（渲染一个不认识的东西等于画错），其余字段一律回落默认值。
//   3. **所有位置、尺寸与字号都是「相对画布短边的比例」**，禁止绝对像素（FR-303）：
//      同一份模板在 1080 宽预览与 2160 宽导出下版式同构。`posterShortEdge()` 就是这个单位。
//      注意长画布的 y 可以大于 1（1080 宽 × 1920 高的画布高 = 1.778 个短边），这不是越界：
//      `POSTER_POSITION_RATIO_RANGE.max = 4` 就是为了给 4096 高的长图留位置。
//
// 模板记录（`poster_templates` 云表的形状，US-301b 起读写）也在这里归一化：三层归属
// （platform / org / teacher，`scope` + `ownerKey`）**复用装裱那一套**（PRD 9.2 第 7 条：
// 「与装裱 PRD 的模板层级策略保持一致，避免每个需求都发明一套权限模型」），所以 scope 的收敛
// 直接取 `data/framingPresets.js` 的 `normalizeFrameScope`。

import { DEFAULT_FRAME_SCOPE, normalizeFrameScope } from './framingPresets';

// ---------------------------------------------------------------------------
// 收敛小工具（本模块自用；全部「永不抛错」，拿到脏数据就退回 fallback）
// ---------------------------------------------------------------------------

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const group = (value) => (isPlainObject(value) ? value : {});
const list = (value) => (Array.isArray(value) ? value : []);

/**
 * 安全的字符串化：**永不抛错**。
 * `String([Symbol()])` / `String(Object.create(null))` 这类都会抛（数组的 join → 元素的 ToString 会炸），
 * 而 spec 来自云端行、本机镜像、后台手填与大模型输出 —— 「永不抛错」这条承诺里当然包含字符串化这一支。
 */
const str = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'bigint') return value.toString();
  try {
    return String(value).trim();
  } catch {
    return '';
  }
};

/**
 * 数值收敛：只认真数字与数字串。
 * 布尔 / null / 数组 / 对象**不算数**（`Number(true)` 是 1、`Number([])` 是 0 —— 这类强制转换
 * 会把「字段缺失」悄悄变成「一个像样的值」，正是 AC 要拦的那种脏数据），一律回落 fallback。
 */
const num = (value, fallback) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, num(value, fallback)));

/** 比例型参数：收敛到 `{min,max}`（脏值回落 fallback）。 */
const ratioIn = (value, range, fallback) => clamp(value, range.min, range.max, fallback);

const intIn = (value, range, fallback) => Math.round(clamp(value, range.min, range.max, fallback));

const bool = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

const oneOf = (value, options, fallback) => (options.includes(value) ? value : fallback);

const hex = (value, fallback) => {
  const text = str(value);
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : fallback;
};

/**
 * 只接受 http(s) / data:image / blob（与装裱的素材地址同一把闸：不把任意串印到海报上）。
 * **导出**：渲染层收到的素材地址（`data.images` / `data.logo`）也要过同一把闸 ——
 * 模板里的地址已由收敛器过了一遍，运行时传进来的那一份不能是第二套判据。
 */
export function posterImageUrl(value) {
  const raw = str(value);
  return /^(https?:\/\/|data:image\/|blob:)/i.test(raw) ? raw : '';
}

// ---------------------------------------------------------------------------
// 枚举与常量（收敛器 / 渲染引擎 / 管理端面板 / 断言读同一份 —— 别在任何一侧再抄一遍）
// ---------------------------------------------------------------------------

/** spec 结构版本号。坏版本号一律按 v1 读（不回退、不抛错）。 */
export const POSTER_SPEC_VERSION = 1;

/** 五类海报（FR-313 ~ FR-317）。 */
export const POSTER_KINDS = ['single', 'period', 'class', 'video-cover', 'report-long'];
export const DEFAULT_POSTER_KIND = 'single';
export const POSTER_KIND_LABELS = {
  single: '单作品',
  period: '阶段成长',
  class: '班级集体',
  'video-cover': '成长视频封面',
  'report-long': '成长报告长图'
};

/** 四类占位区（FR-302）。 */
export const POSTER_SLOT_TYPES = ['image', 'text', 'qrcode', 'logo'];
export const POSTER_SLOT_TYPE_LABELS = { image: '作品图', text: '文字', qrcode: '二维码', logo: '机构标识' };

/** 字体白名单（canvas 只能用系统已装字体；白名单外的字体回落 `sans-serif`，绝不出现方框）。 */
export const POSTER_FONT_WHITELIST = ['serif', 'sans-serif', 'Songti SC', 'Kaiti SC', 'Noto Serif SC'];
export const DEFAULT_POSTER_FONT = 'sans-serif';
export const POSTER_FONT_WEIGHTS = ['normal', 'bold'];
export const POSTER_TEXT_ALIGNS = ['left', 'center', 'right'];

/** image slot 只支持 `contain`（FR-306 + FR-309）：海报只做排版，绝不裁切孩子的作品。 */
export const POSTER_IMAGE_FITS = ['contain'];

export const POSTER_BACKGROUND_TYPES = ['solid', 'linear-gradient'];
/** 拼贴格子的标注位置（US-304 的「每格下方可选标注课次日期」默认贴下）。 */
export const POSTER_CAPTION_POSITIONS = ['below', 'above'];

/** 模板适用入口（云表 `entry_scope`）：成长档案 / 课后反馈第四步 / 两处都用。 */
export const POSTER_ENTRY_SCOPES = ['archive', 'feedback', 'both'];
export const POSTER_ENTRY_SCOPE_LABELS = { archive: '成长档案', feedback: '课后反馈', both: '两处入口' };
export const DEFAULT_POSTER_ENTRY_SCOPE = 'both';

/** 品牌色（AC：暖金 / 墨黑 / 暖白；**蓝色不作为主视觉**）。 */
export const POSTER_BRAND_COLORS = { gold: '#CFA52E', ink: '#2B271F', paper: '#FBF8F2' };
/** 正文与分隔线的辅助色（与装裱同一色系，仍然与蓝无关）。 */
export const POSTER_MUTED_COLORS = { brown: '#6D6559', deep: '#514A38', line: '#E4DCCB', sand: '#F3EDE2' };

/** 三类模板归属（与装裱共用一套层级语义，这里只做别名导出方便海报侧读)。 */
export const POSTER_TEMPLATE_SCOPES = ['platform', 'org', 'teacher'];
export { DEFAULT_FRAME_SCOPE as DEFAULT_POSTER_TEMPLATE_SCOPE };

// ---------------------------------------------------------------------------
// 生效范围（收敛器与渲染层共用；越界一律收敛到边界，而不是把画面画崩）
// ---------------------------------------------------------------------------

/** 画布边长：下限避免退化成 1px 图；上限 4096 是 canvas 单边保护（长图那个 iOS Safari 的坑，US-307）。 */
export const POSTER_CANVAS_EDGE_RANGE = { min: 320, max: 4096 };
/** 位置比例（相对短边）：负值允许少量出血；上限 4 覆盖 1080 宽 × 4096 高长图的底部（约 3.79）。 */
export const POSTER_POSITION_RATIO_RANGE = { min: -0.5, max: 4 };
/** 尺寸比例（相对短边）：`1` = 短边全长。 */
export const POSTER_EXTENT_RATIO_RANGE = { min: 0.01, max: 4 };
/** 字号比例：0.024 ≈ 1080 宽画布上的 26px。 */
export const POSTER_FONT_SIZE_RATIO_RANGE = { min: 0.008, max: 0.4 };
/** 行高与字距：行高是**倍数**，字距是相对短边的比例（与字号一样是尺寸）。 */
export const POSTER_LINE_HEIGHT_RANGE = { min: 0.8, max: 2.5 };
export const POSTER_LETTER_SPACING_RATIO_RANGE = { min: 0, max: 0.05 };
export const POSTER_MAX_LINES_RANGE = { min: 1, max: 8 };
export const POSTER_OPACITY_RANGE = { min: 0, max: 1 };
export const POSTER_FRAME_WIDTH_RATIO_RANGE = { min: 0.001, max: 0.06 };
export const POSTER_RADIUS_RATIO_RANGE = { min: 0, max: 0.5 };
export const POSTER_KEYLINE_WIDTH_RATIO_RANGE = { min: 0.0005, max: 0.01 };
export const POSTER_BORDER_WIDTH_RATIO_RANGE = { min: 0.0005, max: 0.01 };
export const POSTER_PADDING_RATIO_RANGE = { min: 0, max: 0.1 };
export const POSTER_QR_SIZE_RATIO_RANGE = { min: 0.05, max: 0.4 };
/**
 * 二维码最小边长（像素）：小于它手机扫码成功率显著下降（PRD 9.4）。
 * 管理端保存前的可扫性校验（US-311a / US-312b）读这一份，别在面板里写死 120。
 */
export const POSTER_QR_MIN_PIXELS = 120;
export const POSTER_LOGO_WIDTH_RATIO_RANGE = { min: 0.04, max: 0.6 };
/** 拼贴网格：`columns` / `rows` 为 0 表示**自适应**（按作品数选 2×2 / 3×3 / 3×4，US-304）。 */
export const POSTER_GRID_ITEM_RANGE = { min: 1, max: 60 };
export const POSTER_GRID_COLUMN_RANGE = { min: 0, max: 8 };
export const POSTER_GRID_GAP_RATIO_RANGE = { min: 0, max: 0.1 };
/** 拼贴作品数上限（FR-320 的「默认 12」，超出按课次均匀精选）。 */
export const POSTER_GRID_MAX_ITEMS_DEFAULT = 12;
/** 班级作品墙的学员数上限（FR-322 的「默认 30」，超出提示并支持分批出图）。 */
export const POSTER_CLASS_MAX_ITEMS_DEFAULT = 30;

/** 每类海报的建议画布（缺失 / 非法画布时按 kind 回落）。 */
export const POSTER_CANVAS_PRESETS = {
  single: { width: 1080, height: 1440 },
  period: { width: 1080, height: 1920 },
  class: { width: 1080, height: 1920 },
  'video-cover': { width: 1080, height: 1920 },
  // 长图高度自适应：默认起点 1920，上限由 POSTER_CANVAS_EDGE_RANGE 封在 4096（US-307）。
  'report-long': { width: 1080, height: 1920 }
};

// ---------------------------------------------------------------------------
// 文案变量（FR-304）：text slot 的 `template` 与 qrcode 的 `value` 都用 `{变量}` 占位
// ---------------------------------------------------------------------------

/**
 * 变量名 → 渲染上下文里的字段名。
 * 前七个是 PRD FR-304 点名要支持的；后面几个是五类版式真正会用到、渲染时手边就有的字段
 * （`{分享链接}` 服务二维码与分享文案，`{作品数}` / `{课时数}` / `{周期}` 服务阶段与班级版式）。
 */
export const POSTER_VARIABLE_KEYS = {
  学员名: 'studentName',
  作品名: 'artworkTitle',
  周期: 'period',
  日期: 'date',
  老师姓名: 'teacherName',
  机构名: 'orgName',
  点评金句: 'quote',
  班级名: 'className',
  课程名: 'courseName',
  阶段总结: 'summary',
  标题: 'title',
  作品数: 'artworkCount',
  课时数: 'lessonCount',
  时长: 'duration',
  分享链接: 'shareUrl'
};

/** 变量名清单（顺序即文档里的顺序；后台与老师端的「可用变量」提示读它）。 */
export const POSTER_VARIABLES = Object.keys(POSTER_VARIABLE_KEYS);

/** 模板串里出现的变量名（按出现顺序去重）。`{` 未闭合的片段不算变量。 */
export function posterTemplateVariableNames(text) {
  const source = str(text);
  const found = [];
  const pattern = /\{([^{}]+)\}/g;
  let match = pattern.exec(source);
  while (match) {
    const name = match[1].trim();
    if (name && !found.includes(name)) found.push(name);
    match = pattern.exec(source);
  }
  return found;
}

/**
 * 模板串里**不在白名单**的变量名（FR-19 的口径：未知占位符渲染时保留原文，
 * 管理端保存前必须给出警告 —— 这就是那条警告的判据）。
 */
export function posterUnknownVariables(text) {
  return posterTemplateVariableNames(text).filter((name) => !POSTER_VARIABLES.includes(name));
}

// ---------------------------------------------------------------------------
// 默认值（「字段缺失或非法时回落默认值」的那一份默认值；渲染引擎与后台面板也读它）
// ---------------------------------------------------------------------------

export const DEFAULT_POSTER_CANVAS = POSTER_CANVAS_PRESETS[DEFAULT_POSTER_KIND];
export const DEFAULT_POSTER_BACKGROUND = {
  type: 'linear-gradient',
  angle: 135,
  stops: [POSTER_BRAND_COLORS.paper, POSTER_MUTED_COLORS.sand],
  // 预留字段位（PRD 9.2 第 1 条：插画 / 手绘底图列第二期，但字段先留好，加功能不改结构）。
  image: ''
};
export const DEFAULT_POSTER_FRAME = { enabled: true, color: POSTER_BRAND_COLORS.gold, widthRatio: 0.008, cornerRadiusRatio: 0.03 };
export const DEFAULT_POSTER_DECOR = {
  hairline: { visible: true, color: POSTER_BRAND_COLORS.gold, widthRatio: 0.002, x: 0.08, y: 0.824, w: 0.84, opacity: 1 }
};
/** 图片 slot 的兜底（含拼贴配置）：单幅作品的取值，缺失字段按它回落。 */
export const DEFAULT_POSTER_IMAGE_SLOT = {
  id: 'artwork',
  type: 'image',
  visible: true,
  x: 0.08,
  y: 0.075,
  w: 0.84,
  h: 0.735,
  fit: 'contain',
  bg: '#FFFFFF',
  radiusRatio: 0.02,
  paddingRatio: 0.012,
  shadow: true,
  border: { color: POSTER_MUTED_COLORS.line, widthRatio: 0.0015 },
  grid: { columns: 0, rows: 0, gapRatio: 0.016, maxItems: POSTER_GRID_MAX_ITEMS_DEFAULT },
  cellCaption: { visible: false, position: 'below', sizeRatio: 0.014, color: POSTER_MUTED_COLORS.brown, maxLines: 1 },
  opacity: 1
};
export const DEFAULT_POSTER_TEXT_SLOT = {
  id: 'title',
  type: 'text',
  visible: true,
  x: 0.08,
  y: 0.86,
  w: 0.84,
  align: 'left',
  font: 'serif',
  weight: 'bold',
  sizeRatio: 0.038,
  color: POSTER_BRAND_COLORS.ink,
  maxLines: 1,
  lineHeight: 1.4,
  letterSpacingRatio: 0.001,
  template: '《{作品名}》',
  opacity: 1
};
export const DEFAULT_POSTER_QR_SLOT = {
  id: 'qr',
  type: 'qrcode',
  visible: true,
  x: 0.755,
  y: 0.905,
  sizeRatio: 0.145,
  value: '{分享链接}',
  caption: '扫码看完整成长档案',
  captionSizeRatio: 0.013,
  captionColor: POSTER_MUTED_COLORS.brown,
  bg: '#FFFFFF',
  opacity: 1
};
export const DEFAULT_POSTER_LOGO_SLOT = {
  id: 'logo',
  type: 'logo',
  visible: true,
  x: 0.08,
  y: 1.21,
  maxWRatio: 0.16,
  // 可选：模板自带 Logo（留空则用渲染时传进来的 `data.logo`）。
  url: '',
  opacity: 0.9
};

/**
 * 单作品海报的默认版式（PRD 9.3 的草案；作品区占上部约 55%）：
 * 作品图 → 分隔线（decor）→ 作品名 → 学员与日期 → 点评金句 → 二维码 → 机构 Logo。
 */
export const DEFAULT_POSTER_SLOTS = [
  DEFAULT_POSTER_IMAGE_SLOT,
  DEFAULT_POSTER_TEXT_SLOT,
  {
    id: 'student',
    type: 'text',
    visible: true,
    x: 0.08,
    y: 0.917,
    w: 0.84,
    align: 'left',
    font: 'sans-serif',
    weight: 'normal',
    sizeRatio: 0.022,
    color: POSTER_MUTED_COLORS.brown,
    maxLines: 1,
    lineHeight: 1.4,
    letterSpacingRatio: 0,
    template: '{学员名} · {日期}',
    opacity: 1
  },
  {
    id: 'quote',
    type: 'text',
    visible: true,
    x: 0.08,
    y: 0.965,
    w: 0.58,
    align: 'left',
    font: 'serif',
    weight: 'normal',
    sizeRatio: 0.021,
    color: POSTER_MUTED_COLORS.deep,
    maxLines: 2,
    lineHeight: 1.6,
    letterSpacingRatio: 0,
    template: '{点评金句}',
    opacity: 1
  },
  DEFAULT_POSTER_QR_SLOT,
  DEFAULT_POSTER_LOGO_SLOT
];

/** spec 的默认值（等于「一份什么都没写的 spec」被 normalize 之后的样子）。 */
export const DEFAULT_POSTER_SPEC = {
  version: POSTER_SPEC_VERSION,
  kind: DEFAULT_POSTER_KIND,
  canvas: { ...DEFAULT_POSTER_CANVAS },
  background: { ...DEFAULT_POSTER_BACKGROUND, stops: [...DEFAULT_POSTER_BACKGROUND.stops] },
  frame: { ...DEFAULT_POSTER_FRAME },
  decor: { hairline: { ...DEFAULT_POSTER_DECOR.hairline } },
  slots: DEFAULT_POSTER_SLOTS
};

// ---------------------------------------------------------------------------
// 比例坐标（FR-303）：短边是那一把尺子
// ---------------------------------------------------------------------------

/** 画布短边（比例坐标的单位长度）：1080×1920 的画布短边 = 1080。 */
export function posterShortEdge(canvas) {
  const source = group(canvas);
  const width = num(source.width, DEFAULT_POSTER_CANVAS.width);
  const height = num(source.height, DEFAULT_POSTER_CANVAS.height);
  return Math.max(1, Math.min(width, height));
}

/** 比例 → 像素（渲染层唯一该用的换算入口；预览与导出只差 canvas 与 scale）。 */
export function posterRatioToPixels(value, canvas) {
  return ratioIn(value, POSTER_POSITION_RATIO_RANGE, 0) * posterShortEdge(canvas);
}

// ---------------------------------------------------------------------------
// 拼贴网格（image slot 的 `grid`）：`columns/rows = 0` = 自适应
//
// 档位按 US-304 的验收原文：**4 幅→2×2、6–9 幅→3×3、10–12 幅→3×4**（「列×行」，列在前）。
// 这里只回答「几个格子、怎么排」——「超上限时选哪几幅」由 `posterEvenSample()` 回答，
// 渲染层与预览提示共用同一份判据（别在组件里再算一遍）。
// ---------------------------------------------------------------------------

/** 自适应档位：`max` 是本档管到多少幅（升序；最后一档兜住 maxItems 的上限 60）。 */
export const POSTER_GRID_SHAPE_PRESETS = [
  { max: 4, columns: 2, rows: 2 },
  { max: 9, columns: 3, rows: 3 },
  { max: POSTER_GRID_ITEM_RANGE.max, columns: 3, rows: 4 }
];

/**
 * 拼贴网格的行列数。返回 `{ columns, rows, capacity, count, total, trimmed, adaptive }`：
 *   - `count` = 实际要画的格数（已按 `maxItems` 封顶）、`total` = 传进来的幅数、
 *     `trimmed` = 被上限挡掉的幅数（US-304 的「共 N 幅，已收录 M 幅」读这两个读数）；
 *   - `adaptive` = 是否走自适应档位（作者显式给了 columns 与 rows 时为 false）。
 * 显式只给一个方向也回落自适应 —— 半套网格没有意义（行数 / 列数算不出来）。
 */
export function posterGridShape({ columns, rows, count, maxItems } = {}) {
  const total = Math.max(0, Math.round(num(count, 0)));
  const limit = intIn(maxItems, POSTER_GRID_ITEM_RANGE, POSTER_GRID_MAX_ITEMS_DEFAULT);
  const shown = Math.min(total, limit);
  const fixedColumns = intIn(columns, POSTER_GRID_COLUMN_RANGE, 0);
  const fixedRows = intIn(rows, POSTER_GRID_COLUMN_RANGE, 0);
  const base = { count: shown, total, trimmed: Math.max(0, total - shown) };
  if (fixedColumns > 0 && fixedRows > 0) {
    return { ...base, columns: fixedColumns, rows: fixedRows, capacity: fixedColumns * fixedRows, adaptive: false };
  }
  const last = POSTER_GRID_SHAPE_PRESETS[POSTER_GRID_SHAPE_PRESETS.length - 1];
  const preset = POSTER_GRID_SHAPE_PRESETS.find((item) => shown <= item.max) || last;
  return { ...base, columns: preset.columns, rows: preset.rows, capacity: preset.columns * preset.rows, adaptive: true };
}

/**
 * 超上限时的**均匀取样**（US-304 的「按课次均匀精选」）：首尾必取，中间等间隔取，
 * 顺序保持原样（拼贴按课次顺序读，取样不该把顺序打乱）。`limit` 非法时回落默认 12。
 */
export function posterEvenSample(items, limit) {
  const list = Array.isArray(items) ? items : [];
  const max = intIn(limit, POSTER_GRID_ITEM_RANGE, POSTER_GRID_MAX_ITEMS_DEFAULT);
  if (list.length <= max) return list.slice();
  if (max <= 0) return [];
  const picked = [];
  for (let index = 0; index < max; index += 1) {
    const position = max === 1 ? Math.round((list.length - 1) / 2) : Math.round((index * (list.length - 1)) / (max - 1));
    if (!picked.includes(position)) picked.push(position);
  }
  return picked.map((position) => list[position]);
}

// ---------------------------------------------------------------------------
// 收敛器：normalizePosterSpec（FR-307 —— 字段缺失或非法回落默认值，**永不抛错**）
// ---------------------------------------------------------------------------

const defaultSlotOfType = (type) => DEFAULT_POSTER_SLOTS.find((slot) => slot.type === type) || null;

function normalizeCanvas(raw, kind) {
  const source = group(raw);
  const preset = POSTER_CANVAS_PRESETS[kind] || POSTER_CANVAS_PRESETS[DEFAULT_POSTER_KIND];
  return {
    width: intIn(source.width, POSTER_CANVAS_EDGE_RANGE, preset.width),
    height: intIn(source.height, POSTER_CANVAS_EDGE_RANGE, preset.height)
  };
}

function normalizeBackground(raw) {
  const source = group(raw);
  const type = oneOf(source.type, POSTER_BACKGROUND_TYPES, DEFAULT_POSTER_BACKGROUND.type);
  let stops = list(source.stops)
    .map((stop) => hex(stop, ''))
    .filter(Boolean)
    .slice(0, 4);
  if (!stops.length) {
    stops = [...DEFAULT_POSTER_BACKGROUND.stops];
  } else if (type === 'linear-gradient' && stops.length === 1) {
    // 渐变至少两个色标（canvas 的 addColorStop 只给一个也是合法输入，但画出来是纯色 —— 补成同色，
    // 渲染层因此永远可以「取首尾两个色标」，不必自己判长度）。
    stops = [stops[0], stops[0]];
  }
  if (type === 'solid') stops = [stops[0]];
  return {
    type,
    angle: ratioIn(source.angle, { min: 0, max: 360 }, DEFAULT_POSTER_BACKGROUND.angle),
    stops,
    image: posterImageUrl(source.image)
  };
}

function normalizeFrame(raw) {
  const source = group(raw);
  return {
    enabled: bool(source.enabled, DEFAULT_POSTER_FRAME.enabled),
    color: hex(source.color, DEFAULT_POSTER_FRAME.color),
    widthRatio: ratioIn(source.widthRatio, POSTER_FRAME_WIDTH_RATIO_RANGE, DEFAULT_POSTER_FRAME.widthRatio),
    cornerRadiusRatio: ratioIn(source.cornerRadiusRatio, POSTER_RADIUS_RATIO_RANGE, DEFAULT_POSTER_FRAME.cornerRadiusRatio)
  };
}

function normalizeDecor(raw) {
  const source = group(raw);
  const fallback = DEFAULT_POSTER_DECOR.hairline;
  const hairline = group(source.hairline);
  return {
    hairline: {
      visible: bool(hairline.visible, fallback.visible),
      color: hex(hairline.color, fallback.color),
      widthRatio: ratioIn(hairline.widthRatio, POSTER_KEYLINE_WIDTH_RATIO_RANGE, fallback.widthRatio),
      x: ratioIn(hairline.x, POSTER_POSITION_RATIO_RANGE, fallback.x),
      y: ratioIn(hairline.y, POSTER_POSITION_RATIO_RANGE, fallback.y),
      w: ratioIn(hairline.w, POSTER_EXTENT_RATIO_RANGE, fallback.w),
      opacity: ratioIn(hairline.opacity, POSTER_OPACITY_RANGE, fallback.opacity)
    }
  };
}

function normalizeBorder(raw) {
  if (!isPlainObject(raw)) return null;
  return {
    color: hex(raw.color, POSTER_MUTED_COLORS.line),
    widthRatio: ratioIn(raw.widthRatio, POSTER_BORDER_WIDTH_RATIO_RANGE, 0.0015)
  };
}

function normalizeGrid(raw) {
  const source = group(raw);
  const fallback = DEFAULT_POSTER_IMAGE_SLOT.grid;
  return {
    // 0 = 自适应（按作品数选 2×2 / 3×3 / 3×4 —— US-304 的「按作品数自适应」）。
    columns: intIn(source.columns, POSTER_GRID_COLUMN_RANGE, fallback.columns),
    rows: intIn(source.rows, POSTER_GRID_COLUMN_RANGE, fallback.rows),
    gapRatio: ratioIn(source.gapRatio, POSTER_GRID_GAP_RATIO_RANGE, fallback.gapRatio),
    maxItems: intIn(source.maxItems, POSTER_GRID_ITEM_RANGE, fallback.maxItems)
  };
}

function normalizeCellCaption(raw) {
  if (!isPlainObject(raw)) return { ...DEFAULT_POSTER_IMAGE_SLOT.cellCaption };
  const fallback = DEFAULT_POSTER_IMAGE_SLOT.cellCaption;
  return {
    visible: bool(raw.visible, fallback.visible),
    position: oneOf(raw.position, POSTER_CAPTION_POSITIONS, fallback.position),
    sizeRatio: ratioIn(raw.sizeRatio, POSTER_FONT_SIZE_RATIO_RANGE, fallback.sizeRatio),
    color: hex(raw.color, fallback.color),
    maxLines: intIn(raw.maxLines, { min: 1, max: 2 }, fallback.maxLines)
  };
}

/**
 * 字体收敛：白名单内的原样返回；**写了但不在白名单**的回落 `sans-serif`
 * （与装裱 US-003b 的「白名单外字体回落 sans-serif」同一口径：绝不把系统没装的字体名递给 canvas）；
 * 没写 / 空串才用该占位区的默认字体。
 */
function normalizeFont(value, fallback = DEFAULT_POSTER_FONT) {
  const text = str(value);
  if (POSTER_FONT_WHITELIST.includes(text)) return text;
  return text ? DEFAULT_POSTER_FONT : fallback;
}

/**
 * 单个占位区的收敛。返回归一化后的 slot，或 `null`（不是对象 / 类型未知 —— 这两种没有合理默认值）。
 * 调用方负责补 id（缺失时按 `类型-序号` 生成）与去重。
 */
export function normalizePosterSlot(raw) {
  if (!isPlainObject(raw)) return null;
  const type = oneOf(raw.type, POSTER_SLOT_TYPES, '');
  if (!type) return null;
  const fallback = defaultSlotOfType(type) || {};
  const base = {
    id: str(raw.id),
    type,
    visible: bool(raw.visible, true),
    x: ratioIn(raw.x, POSTER_POSITION_RATIO_RANGE, num(fallback.x, 0)),
    y: ratioIn(raw.y, POSTER_POSITION_RATIO_RANGE, num(fallback.y, 0)),
    opacity: ratioIn(raw.opacity, POSTER_OPACITY_RANGE, num(fallback.opacity, 1))
  };

  if (type === 'text') {
    return {
      ...base,
      w: ratioIn(raw.w, POSTER_EXTENT_RATIO_RANGE, num(fallback.w, 0.84)),
      align: oneOf(raw.align, POSTER_TEXT_ALIGNS, fallback.align || 'left'),
      font: normalizeFont(raw.font, fallback.font || DEFAULT_POSTER_FONT),
      weight: oneOf(raw.weight, POSTER_FONT_WEIGHTS, fallback.weight || 'normal'),
      sizeRatio: ratioIn(raw.sizeRatio, POSTER_FONT_SIZE_RATIO_RANGE, num(fallback.sizeRatio, 0.024)),
      color: hex(raw.color, fallback.color || POSTER_BRAND_COLORS.ink),
      maxLines: intIn(raw.maxLines, POSTER_MAX_LINES_RANGE, num(fallback.maxLines, 1)),
      lineHeight: ratioIn(raw.lineHeight, POSTER_LINE_HEIGHT_RANGE, num(fallback.lineHeight, 1.4)),
      letterSpacingRatio: ratioIn(raw.letterSpacingRatio, POSTER_LETTER_SPACING_RATIO_RANGE, num(fallback.letterSpacingRatio, 0)),
      // 内容模板（含变量）：空串没有意义（画一行空白），回落默认模板；未知变量保留原文（渲染时再告警）。
      template: str(raw.template).slice(0, 200) || str(fallback.template) || '{学员名}'
    };
  }

  if (type === 'image') {
    return {
      ...base,
      w: ratioIn(raw.w, POSTER_EXTENT_RATIO_RANGE, num(fallback.w, 0.84)),
      h: ratioIn(raw.h, POSTER_EXTENT_RATIO_RANGE, num(fallback.h, 0.735)),
      fit: oneOf(raw.fit, POSTER_IMAGE_FITS, fallback.fit || 'contain'),
      bg: hex(raw.bg, fallback.bg || '#FFFFFF'),
      radiusRatio: ratioIn(raw.radiusRatio, POSTER_RADIUS_RATIO_RANGE, num(fallback.radiusRatio, 0.02)),
      paddingRatio: ratioIn(raw.paddingRatio, POSTER_PADDING_RATIO_RANGE, num(fallback.paddingRatio, 0)),
      shadow: bool(raw.shadow, bool(fallback.shadow, false)),
      border: normalizeBorder(raw.border !== undefined ? raw.border : fallback.border),
      grid: normalizeGrid(raw.grid),
      cellCaption: normalizeCellCaption(raw.cellCaption)
    };
  }

  if (type === 'qrcode') {
    return {
      ...base,
      sizeRatio: ratioIn(raw.sizeRatio, POSTER_QR_SIZE_RATIO_RANGE, num(fallback.sizeRatio, 0.145)),
      value: str(raw.value).slice(0, 200) || str(fallback.value) || '{分享链接}',
      caption: str(raw.caption).slice(0, 40),
      captionSizeRatio: ratioIn(raw.captionSizeRatio, POSTER_FONT_SIZE_RATIO_RANGE, num(fallback.captionSizeRatio, 0.013)),
      captionColor: hex(raw.captionColor, fallback.captionColor || POSTER_MUTED_COLORS.brown),
      bg: hex(raw.bg, fallback.bg || '#FFFFFF')
    };
  }

  // logo
  return {
    ...base,
    maxWRatio: ratioIn(raw.maxWRatio, POSTER_LOGO_WIDTH_RATIO_RANGE, num(fallback.maxWRatio, 0.16)),
    url: posterImageUrl(raw.url)
  };
}

function normalizeSlots(raw) {
  // 整个 slots 缺失 / 不是数组 → 回落默认版式（AC：「字段缺失或非法时回落默认值」）。
  // 显式给了空数组则**保留为空**：那是「这张海报不放任何占位区」的明确表达，不是缺字段。
  if (!Array.isArray(raw)) return DEFAULT_POSTER_SLOTS.map((slot) => normalizePosterSlot(slot));
  const used = new Set();
  const slots = [];
  raw.forEach((item, index) => {
    const slot = normalizePosterSlot(item);
    if (!slot) return;
    let id = slot.id || `${slot.type}-${index + 1}`;
    if (used.has(id)) {
      let n = 2;
      while (used.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    used.add(id);
    slots.push({ ...slot, id });
  });
  return slots;
}

/**
 * poster spec v1 的唯一收敛器：把（后台手填 / 大模型 / 云端读回的）脏数据收敛成
 * 一定能被 canvas 安全绘制的形状。字段缺失或非法一律回落默认值，**永不抛错**（FR-307）。
 */
export function normalizePosterSpec(raw) {
  const source = group(raw);
  const kind = oneOf(source.kind, POSTER_KINDS, DEFAULT_POSTER_KIND);
  return {
    version: POSTER_SPEC_VERSION,
    kind,
    canvas: normalizeCanvas(source.canvas, kind),
    background: normalizeBackground(source.background),
    frame: normalizeFrame(source.frame),
    decor: normalizeDecor(source.decor),
    slots: normalizeSlots(source.slots)
  };
}

/** 按 id 取占位区（渲染与面板都用它，别自己 find）。 */
export function findPosterSlot(spec, id) {
  return normalizePosterSpec(spec).slots.find((slot) => slot.id === id) || null;
}

/** 取某一类占位区（例如 `image` 的作品位、`qrcode` 的二维码位）。 */
export function posterSlotsOfType(spec, type) {
  return normalizePosterSpec(spec).slots.filter((slot) => slot.type === type);
}

// ---------------------------------------------------------------------------
// 模板记录（云表 `poster_templates`）：三层归属 + 库级属性
// ---------------------------------------------------------------------------

/** 模板的本机镜像键（云端表是 `poster_templates`，读写落在 US-301b）。 */
export const POSTER_TEMPLATE_STORAGE_KEY = 'xinlehui-poster-templates-v1';
/** 排序缺省值（与装裱的 90 同一口径：没写排序号的排在有号的之后）。 */
export const POSTER_TEMPLATE_SORT_FALLBACK = 90;

/** 模板的幂等键：`id`（云端列 `template_key`）。 */
export function posterTemplateKey(template) {
  const source = group(template);
  return str(source.id || source.templateKey);
}

/**
 * 模板记录归一化：spec 过 `normalizePosterSpec`，`scope` 复用装裱的三层语义
 * （缺失 / 非法一律读成 platform，与老记录兼容），库级属性脏值收敛成安全值，永不抛错。
 */
export function normalizePosterTemplate(raw) {
  const source = group(raw);
  const spec = normalizePosterSpec(source.spec);
  const scope = normalizeFrameScope(source.scope);
  return {
    id: posterTemplateKey(source),
    name: str(source.name).slice(0, 32) || '未命名海报',
    description: str(source.description).slice(0, 80),
    kind: oneOf(source.kind, POSTER_KINDS, spec.kind),
    spec,
    scope,
    // 平台模板没有归属人（与装裱同一口径：读到脏值就清掉）；org / teacher 两层原样保留。
    ownerKey: scope === DEFAULT_FRAME_SCOPE || source.ownerKey == null ? '' : str(source.ownerKey),
    entryScope: oneOf(source.entryScope, POSTER_ENTRY_SCOPES, DEFAULT_POSTER_ENTRY_SCOPE),
    enabled: bool(source.enabled, true),
    builtin: bool(source.builtin, false),
    isDefault: bool(source.isDefault, false),
    sortOrder: intIn(source.sortOrder, { min: 0, max: 999 }, POSTER_TEMPLATE_SORT_FALLBACK),
    updatedBy: str(source.updatedBy),
    updatedAt: str(source.updatedAt)
  };
}

/** 列表顺序的唯一来源：sortOrder 升序，再按 id（云端返回与本地兜底走同一套）。 */
export function sortPosterTemplates(templates) {
  // 排序读归一化之后的 `sortOrder`（一定是整数）—— 别对原始值直接 `Number()`（见 pushRangeIssue 的注释）。
  const order = (item) => num(item?.sortOrder, POSTER_TEMPLATE_SORT_FALLBACK);
  return list(templates)
    .filter(isPlainObject)
    .map((item) => normalizePosterTemplate(item))
    .sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
}

/** 可选模板（停用的不进列表；历史成品图不受影响 —— 与装裱「只停用不删除」同一口径）。 */
export function selectablePosterTemplates(templates) {
  return sortPosterTemplates(templates).filter((template) => template.enabled !== false);
}

/** 停用的模板 id 清单（管理端列表要给它们打「已停用」标记）。 */
export function disabledPosterTemplateKeys(templates) {
  return sortPosterTemplates(templates)
    .filter((template) => template.enabled === false)
    .map((template) => template.id);
}

// ---------------------------------------------------------------------------
// 内置模板库（骨架；US-302a 补到不少于 8 套、覆盖五类场景）
//
// 出厂的模板就是「一份 spec + 一句场景说明」。这里用 `builtinPosterSpec` 构造：
// 写法上只写有意为之的字段，其余交给收敛器补齐 —— 于是「内置模板一定合法」是结构保证，
// 而不是「写的时候小心点」。
// ---------------------------------------------------------------------------

const builtinPosterSpec = (fields) => normalizePosterSpec({ ...fields, version: POSTER_SPEC_VERSION });

/** 「暖金留白 · 单作品」的版式：作品区占上部约 55%，下方是展签式信息带。 */
const singleStarlightSpec = builtinPosterSpec({
  kind: 'single',
  canvas: { ...POSTER_CANVAS_PRESETS.single },
  background: { type: 'linear-gradient', angle: 135, stops: [POSTER_BRAND_COLORS.paper, POSTER_MUTED_COLORS.sand] },
  frame: { enabled: true, color: POSTER_BRAND_COLORS.gold, widthRatio: 0.008, cornerRadiusRatio: 0.03 },
  decor: { hairline: { color: POSTER_BRAND_COLORS.gold, widthRatio: 0.002, x: 0.08, y: 0.835, w: 0.84 } },
  slots: [
    { ...DEFAULT_POSTER_IMAGE_SLOT, shadow: true },
    DEFAULT_POSTER_TEXT_SLOT,
    DEFAULT_POSTER_SLOTS[2],
    DEFAULT_POSTER_SLOTS[3],
    DEFAULT_POSTER_QR_SLOT,
    DEFAULT_POSTER_LOGO_SLOT
  ]
});

/** 「原木素雅 · 阶段成长」的版式：顶部标题与周期，中部自适应拼贴，下部总结与二维码。 */
const periodOakSpec = builtinPosterSpec({
  kind: 'period',
  canvas: { ...POSTER_CANVAS_PRESETS.period },
  background: { type: 'linear-gradient', angle: 160, stops: [POSTER_BRAND_COLORS.paper, '#F1E7D6'] },
  frame: { enabled: true, color: '#8D6439', widthRatio: 0.007, cornerRadiusRatio: 0.02 },
  decor: { hairline: { color: '#8D6439', widthRatio: 0.0018, x: 0.08, y: 0.168, w: 0.84 } },
  slots: [
    {
      id: 'title',
      type: 'text',
      x: 0.08,
      y: 0.07,
      w: 0.84,
      align: 'left',
      font: 'serif',
      weight: 'bold',
      sizeRatio: 0.04,
      color: POSTER_BRAND_COLORS.ink,
      maxLines: 1,
      template: '{学员名} 的成长记录'
    },
    {
      id: 'period',
      type: 'text',
      x: 0.08,
      y: 0.128,
      w: 0.84,
      align: 'left',
      font: 'sans-serif',
      sizeRatio: 0.02,
      color: POSTER_MUTED_COLORS.brown,
      maxLines: 1,
      template: '{周期} · 共 {作品数} 幅'
    },
    {
      id: 'collage',
      type: 'image',
      x: 0.07,
      y: 0.2,
      w: 0.86,
      h: 0.92,
      bg: '#FFFFFF',
      radiusRatio: 0.018,
      paddingRatio: 0.012,
      shadow: false,
      border: { color: '#E7DCC7', widthRatio: 0.0015 },
      // columns / rows = 0：由作品数决定 2×2 / 3×3 / 3×4（US-304 的自适应网格）。
      grid: { columns: 0, rows: 0, gapRatio: 0.016, maxItems: POSTER_GRID_MAX_ITEMS_DEFAULT },
      cellCaption: { visible: true, sizeRatio: 0.014, color: POSTER_MUTED_COLORS.brown }
    },
    {
      id: 'summary',
      type: 'text',
      x: 0.08,
      y: 1.3,
      w: 0.6,
      align: 'left',
      font: 'serif',
      sizeRatio: 0.021,
      color: POSTER_MUTED_COLORS.deep,
      maxLines: 3,
      lineHeight: 1.6,
      template: '{阶段总结}'
    },
    {
      id: 'qr',
      type: 'qrcode',
      x: 0.76,
      y: 1.415,
      sizeRatio: 0.13,
      caption: '扫码看完整成长档案',
      captionSizeRatio: 0.013
    },
    { id: 'logo', type: 'logo', x: 0.08, y: 1.62, maxWRatio: 0.15, opacity: 0.9 }
  ]
});

/**
 * 内置模板（出厂种子）。两条共同约定（FR-323 / US-302）：
 *   - 每套都**预留二维码位与机构 Logo 位**（可以 `visible: false` 关掉显示，但字段要在）；
 *   - `builtin: true` + `enabled: true`，且**不可删除、只可停用**。
 * `entryScope` 写的是「这套版式适合哪个入口」：单作品两处都能用，阶段拼贴只有档案里有多幅作品。
 */
export const seedPosterTemplates = [
  {
    id: 'poster-warm-gold-single',
    name: '暖金留白 · 单作品',
    description: '暖金细框与一条金线，一幅作品居中。适合单节课亮色作品的转发。',
    kind: 'single',
    spec: singleStarlightSpec,
    scope: 'platform',
    ownerKey: '',
    entryScope: 'both',
    enabled: true,
    builtin: true,
    isDefault: true,
    sortOrder: 1
  },
  {
    id: 'poster-oak-period',
    name: '原木素雅 · 阶段成长',
    description: '原木色细框配米白底，自适应拼贴网格。适合一学期多幅作品的阶段回顾。',
    kind: 'period',
    spec: periodOakSpec,
    scope: 'platform',
    ownerKey: '',
    entryScope: 'archive',
    enabled: true,
    builtin: true,
    isDefault: false,
    sortOrder: 2
  }
].map((template) => normalizePosterTemplate(template));

// ---------------------------------------------------------------------------
// 校验读数（AC 的「非法字段被收敛」要看得见；管理端保存前与断言共用这一份）
//
// 这里只报**结构与参数**层面的问题（越界 / 未知枚举 / 丢弃的占位区 / 变量不在白名单 /
// 蓝色主视觉 / 二维码数量）。「可扫性、文字溢出」那两类要真渲染一次才算得出来，属 US-311a 的校验。
// ---------------------------------------------------------------------------

/** 判断一个十六进制色是不是「蓝」的（FR/AC：品牌主视觉不得用蓝）。 */
export function posterIsBlueHex(value) {
  const text = str(value);
  if (!/^#[0-9a-fA-F]{6}$/.test(text)) return false;
  const r = parseInt(text.slice(1, 3), 16) / 255;
  const g = parseInt(text.slice(3, 5), 16) / 255;
  const b = parseInt(text.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.25) return false; // 灰 / 低饱和的中性色不算蓝
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = ((hue * 60) + 360) % 360;
  return hue >= 190 && hue <= 260;
}

const pushRangeIssue = (issues, path, value, range, label) => {
  // 注意**别对任意值直接 `Number(...)`**：`Number([Symbol()])` 会走数组的 join → toString 直接抛错
  // （fuzz 断言真踩到过）。只对数字与数字串求值，其余一律当作「不在范围内」。
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (value === undefined || value === null) return;
  if (Number.isFinite(parsed) && parsed >= range.min && parsed <= range.max) return;
  // 报进文案里的原值一律过 `str()`：脏数据可能是 Symbol（模板字符串插值它会直接抛错），
  // 「收敛器永不抛错」也包括校验读数这一支。
  issues.push({ path, message: `${label} ${str(value)} 超出 ${range.min} ~ ${range.max}，已收敛` });
};

/**
 * 逐项列出「这份 spec 被收敛了哪些地方」。没问题时返回空数组。
 * `raw` 不是对象时只报一条（整体回落默认值）。
 */
export function posterSpecIssues(raw) {
  const issues = [];
  if (!isPlainObject(raw)) {
    if (raw !== undefined && raw !== null) issues.push({ path: 'spec', message: '不是对象，整份回落默认模板' });
    return issues;
  }
  if (raw.version !== undefined && raw.version !== POSTER_SPEC_VERSION) {
    issues.push({ path: 'version', message: `版本号 ${str(raw.version)} 不是 ${POSTER_SPEC_VERSION}，按 v1 读取` });
  }
  if (raw.kind !== undefined && !POSTER_KINDS.includes(raw.kind)) {
    issues.push({ path: 'kind', message: `未知海报类型「${str(raw.kind)}」，回落 ${DEFAULT_POSTER_KIND}` });
  }
  const kind = oneOf(raw.kind, POSTER_KINDS, DEFAULT_POSTER_KIND);
  const canvas = group(raw.canvas);
  pushRangeIssue(issues, 'canvas.width', canvas.width, POSTER_CANVAS_EDGE_RANGE, '画布宽度');
  pushRangeIssue(issues, 'canvas.height', canvas.height, POSTER_CANVAS_EDGE_RANGE, '画布高度');

  const background = group(raw.background);
  if (background.type !== undefined && !POSTER_BACKGROUND_TYPES.includes(background.type)) {
    issues.push({ path: 'background.type', message: `未知背景类型「${str(background.type)}」，回落 ${DEFAULT_POSTER_BACKGROUND.type}` });
  }
  const rawStops = list(background.stops);
  if (rawStops.length && rawStops.every((stop) => !hex(stop, ''))) {
    issues.push({ path: 'background.stops', message: '色标全部非法，回落默认色' });
  }
  const blueStops = rawStops.filter((stop) => posterIsBlueHex(stop));
  if (blueStops.length) {
    issues.push({ path: 'background.stops', message: `背景不能以蓝色为主视觉：${blueStops.join(' / ')}` });
  }
  pushRangeIssue(issues, 'background.angle', background.angle, { min: 0, max: 360 }, '背景角度');

  const frame = group(raw.frame);
  pushRangeIssue(issues, 'frame.widthRatio', frame.widthRatio, POSTER_FRAME_WIDTH_RATIO_RANGE, '边框宽度比例');
  pushRangeIssue(issues, 'frame.cornerRadiusRatio', frame.cornerRadiusRatio, POSTER_RADIUS_RATIO_RANGE, '圆角半径比例');

  const hairline = group(group(raw.decor).hairline);
  pushRangeIssue(issues, 'decor.hairline.y', hairline.y, POSTER_POSITION_RATIO_RANGE, '分隔线位置');
  pushRangeIssue(issues, 'decor.hairline.w', hairline.w, POSTER_EXTENT_RATIO_RANGE, '分隔线长度');

  if (raw.slots !== undefined && !Array.isArray(raw.slots)) {
    issues.push({ path: 'slots', message: '不是数组，回落默认版式' });
  }
  list(raw.slots).forEach((item, index) => {
    const path = `slots[${index}]`;
    if (!isPlainObject(item)) {
      issues.push({ path, message: '不是对象，已丢弃' });
      return;
    }
    if (!POSTER_SLOT_TYPES.includes(item.type)) {
      issues.push({ path, message: `未知占位区类型「${str(item.type)}」，已丢弃（四种类型：${POSTER_SLOT_TYPES.join(' / ')}）` });
      return;
    }
    pushRangeIssue(issues, `${path}.x`, item.x, POSTER_POSITION_RATIO_RANGE, '横坐标比例');
    pushRangeIssue(issues, `${path}.y`, item.y, POSTER_POSITION_RATIO_RANGE, '纵坐标比例');
    if (item.type === 'text') {
      pushRangeIssue(issues, `${path}.w`, item.w, POSTER_EXTENT_RATIO_RANGE, '文字宽度比例');
      pushRangeIssue(issues, `${path}.sizeRatio`, item.sizeRatio, POSTER_FONT_SIZE_RATIO_RANGE, '字号比例');
      pushRangeIssue(issues, `${path}.maxLines`, item.maxLines, POSTER_MAX_LINES_RANGE, '最大行数');
      pushRangeIssue(issues, `${path}.lineHeight`, item.lineHeight, POSTER_LINE_HEIGHT_RANGE, '行高');
      if (item.font !== undefined && !POSTER_FONT_WHITELIST.includes(item.font)) {
        issues.push({ path: `${path}.font`, message: `字体「${str(item.font)}」不在白名单，回落 ${DEFAULT_POSTER_FONT}` });
      }
      posterUnknownVariables(item.template).forEach((name) => {
        issues.push({ path: `${path}.template`, message: `未知变量 {${name}}：渲染时保留原文（可用变量：${POSTER_VARIABLES.map((key) => `{${key}}`).join(' ')}）` });
      });
    }
    if (item.type === 'image') {
      pushRangeIssue(issues, `${path}.w`, item.w, POSTER_EXTENT_RATIO_RANGE, '作品宽度比例');
      pushRangeIssue(issues, `${path}.h`, item.h, POSTER_EXTENT_RATIO_RANGE, '作品高度比例');
      pushRangeIssue(issues, `${path}.radiusRatio`, item.radiusRatio, POSTER_RADIUS_RATIO_RANGE, '圆角半径比例');
      if (item.fit !== undefined && !POSTER_IMAGE_FITS.includes(item.fit)) {
        issues.push({ path: `${path}.fit`, message: `适配方式只支持 contain（不裁切作品），已收敛「${str(item.fit)}」` });
      }
    }
    if (item.type === 'qrcode') {
      pushRangeIssue(issues, `${path}.sizeRatio`, item.sizeRatio, POSTER_QR_SIZE_RATIO_RANGE, '二维码边长比例');
      posterUnknownVariables(item.value).forEach((name) => {
        issues.push({ path: `${path}.value`, message: `未知变量 {${name}}：渲染时保留原文` });
      });
    }
    if (item.type === 'logo') {
      pushRangeIssue(issues, `${path}.maxWRatio`, item.maxWRatio, POSTER_LOGO_WIDTH_RATIO_RANGE, 'Logo 宽度比例');
    }
  });

  // 结构级规则（FR-323 / FR-325）：每套模板都要有二维码位与 Logo 位，二维码**只允许一个**。
  // 只在「作者显式写了 slots」时检查 —— slots 缺失会回落默认版式（那里本来就有这两个位），
  // 对着回落的默认值报「缺 Logo 位」是假警报。
  if (Array.isArray(raw.slots)) {
    const slotTypes = raw.slots.map((item) => (isPlainObject(item) ? item.type : ''));
    const visibleQrCount = raw.slots.filter((item) => isPlainObject(item) && item.type === 'qrcode' && item.visible !== false).length;
    if (!slotTypes.includes('qrcode')) issues.push({ path: 'slots', message: '缺少二维码位（可关闭显示，但字段要在）' });
    if (!slotTypes.includes('logo')) issues.push({ path: 'slots', message: '缺少机构 Logo 位（可关闭显示，但字段要在）' });
    if (visibleQrCount > 1) issues.push({ path: 'slots', message: `海报上只允许一个二维码（现在有 ${visibleQrCount} 个可见的）` });
  }

  return issues;
}

/** 模板记录层面的校验读数（面板顶部与断言读它）：未知类型 / 空 id / 未知适用入口。 */
export function posterTemplateIssues(raw) {
  const issues = [];
  const source = group(raw);
  if (!posterTemplateKey(source)) issues.push({ path: 'id', message: '缺少模板 id（云端 template_key 是幂等键）' });
  if (source.kind !== undefined && !POSTER_KINDS.includes(source.kind)) {
    issues.push({ path: 'kind', message: `未知海报类型「${str(source.kind)}」，回落 spec 里的 ${oneOf(source.kind, POSTER_KINDS, DEFAULT_POSTER_KIND)}` });
  }
  if (source.entryScope !== undefined && !POSTER_ENTRY_SCOPES.includes(source.entryScope)) {
    issues.push({ path: 'entryScope', message: `未知适用入口「${str(source.entryScope)}」，回落 ${DEFAULT_POSTER_ENTRY_SCOPE}` });
  }
  return issues;
}
