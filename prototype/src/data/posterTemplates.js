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

import { DEFAULT_FRAME_SCOPE, normalizeFrameScope, teacherIdentityKeys } from './framingPresets';

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

/** 模板的本机镜像键（云端表是 `poster_templates`，读写落在 `services/posterTemplatesApi.js`，[海报 US-302b]）。 */
export const POSTER_TEMPLATE_STORAGE_KEY = 'xinlehui-poster-templates-v1';
/** 排序缺省值（与装裱的 90 同一口径：没写排序号的排在有号的之后）。 */
export const POSTER_TEMPLATE_SORT_FALLBACK = 90;
/** 模板名 / 备注的字数上限（收敛器与「另存为我的模板」的表单读同一份，别在两处各写一个数）。 */
export const POSTER_TEMPLATE_NAME_MAX = 32;
export const POSTER_TEMPLATE_DESCRIPTION_MAX = 80;

/** 模板的幂等键：`id`（云端列 `template_key`）。 */
export function posterTemplateKey(template) {
  const source = group(template);
  return str(source.id || source.templateKey);
}

// ---------------------------------------------------------------------------
// 变更留痕：updated_by / updated_at + 变更历史（[海报 US-312b] / FR-359）
//
// 与装裱 `framingPresets.js` 的 `stampFramingPresetUpdate` **同一套口径**：
//   · 任何库级改动都过 `stampPosterTemplateUpdate()` —— 它同时更新 `updatedBy` / `updatedAt`
//     并往 `history` 追加一条；界面里手改这几个字段必然漂移，别这么干。
//   · `history` 只留在**本机镜像与记录对象**里：云端行仍是固定的 14 列
//     （`POSTER_TEMPLATE_ROW_FIELDS`，历史不进云表 —— 云表结构见 PRD 9.3，加列会让既有写入整条被拒）。
// ---------------------------------------------------------------------------

/** 变更历史最多留多少条（超出丢最旧的）；与装裱同一口径。 */
export const POSTER_TEMPLATE_HISTORY_LIMIT = 20;

/** 变更历史为空时的文案（面板与断言读同一句）。 */
export const POSTER_TEMPLATE_HISTORY_EMPTY = '还没有变更记录：这套模板从建立以来没有被改动过。';

/** 一条变更历史（`谁 · 什么时候 · 做了什么`）：脏值收敛成空串，缺内容的条目丢掉。 */
export function normalizePosterTemplateHistory(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((entry) => {
      const source = group(entry);
      return {
        at: str(source.at),
        by: str(source.by),
        action: str(source.action),
        detail: str(source.detail)
      };
    })
    .filter((entry) => entry.at || entry.action || entry.detail);
}

/** 「改了什么」的字段名（保存回执与变更历史行读它，别在界面里再比一遍）。 */
export const POSTER_TEMPLATE_FIELD_LABELS = {
  name: '名称',
  description: '一句话说明',
  kind: '海报类型',
  spec: '版式参数',
  entryScope: '适用入口',
  enabled: '启停',
  isDefault: '默认模板',
  sortOrder: '排序'
};

/**
 * 模板记录归一化：spec 过 `normalizePosterSpec`，`scope` 复用装裱的三层语义
 * （缺失 / 非法一律读成 platform，与老记录兼容），库级属性脏值收敛成安全值，永不抛错。
 * `history` 与 `updatedBy` / `updatedAt` 都是**留痕字段**（只由 `stampPosterTemplateUpdate` 写）。
 */
export function normalizePosterTemplate(raw) {
  const source = group(raw);
  const spec = normalizePosterSpec(source.spec);
  const scope = normalizeFrameScope(source.scope);
  return {
    id: posterTemplateKey(source),
    name: str(source.name).slice(0, POSTER_TEMPLATE_NAME_MAX) || '未命名海报',
    description: str(source.description).slice(0, POSTER_TEMPLATE_DESCRIPTION_MAX),
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
    updatedAt: str(source.updatedAt),
    history: normalizePosterTemplateHistory(source.history)
  };
}

/**
 * 变更留痕的**唯一写入口**：更新 `updatedBy` / `updatedAt`，并往 `history` 末尾追加一条
 * （超出上限丢最旧的那条）。`posterAdmin.js` 的每一个库级动作都过它。
 */
export function stampPosterTemplateUpdate(template, { by = '', at = 0, action = '', detail = '' } = {}) {
  const item = normalizePosterTemplate(template);
  const timestamp = Number.isFinite(Number(at)) && Number(at) > 0 ? Number(at) : Date.now();
  const iso = new Date(timestamp).toISOString();
  const entry = {
    at: iso,
    by: str(by),
    action: str(action) || '更新模板',
    detail: str(detail)
  };
  return {
    ...item,
    updatedBy: entry.by,
    updatedAt: iso,
    history: [...item.history, entry].slice(-POSTER_TEMPLATE_HISTORY_LIMIT)
  };
}

/**
 * 两次保存之间「改了什么」→ 可读清单（保存回执与变更历史读它）。
 * 只比对模板自己的字段；`updatedBy / updatedAt / history` 不参与（它们就是变更记录本身）。
 */
export function posterTemplateChangeSummary(previous, next) {
  const before = group(previous);
  const after = group(next);
  return Object.keys(POSTER_TEMPLATE_FIELD_LABELS).filter((key) => {
    if (key === 'spec') return JSON.stringify(normalizePosterSpec(before.spec)) !== JSON.stringify(normalizePosterSpec(after.spec));
    if (key === 'kind') return oneOf(before.kind, POSTER_KINDS, '') !== oneOf(after.kind, POSTER_KINDS, '');
    if (key === 'entryScope') return oneOf(before.entryScope, POSTER_ENTRY_SCOPES, '') !== oneOf(after.entryScope, POSTER_ENTRY_SCOPES, '');
    if (key === 'enabled') return bool(before.enabled, true) !== bool(after.enabled, true);
    if (key === 'isDefault') return bool(before.isDefault, false) !== bool(after.isDefault, false);
    if (key === 'sortOrder') return num(before.sortOrder, POSTER_TEMPLATE_SORT_FALLBACK) !== num(after.sortOrder, POSTER_TEMPLATE_SORT_FALLBACK);
    return str(before[key]) !== str(after[key]);
  });
}

/** 变更清单的可读文案（`改动：版式参数 · 启停`）；没有改动时返回空串。 */
export function posterTemplateChangeText(previous, next) {
  const keys = posterTemplateChangeSummary(previous, next);
  return keys.length ? keys.map((key) => POSTER_TEMPLATE_FIELD_LABELS[key]).join(' · ') : '';
}

/** 变更历史的行（最新在前；界面与断言读同一份，别在组件里 reverse）。 */
export function posterTemplateHistoryRows(template) {
  const item = normalizePosterTemplate(template);
  return item.history
    .map((entry, index) => ({
      ...entry,
      isLatest: index === item.history.length - 1,
      text: [entry.action, entry.detail].filter(Boolean).join('：')
    }))
    .reverse();
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

/**
 * 内置模板**不可删除**的判据（FR-357，[海报 US-302] AC4）：内置模板只能停用。
 *
 * 为什么要在 data 层留一个纯函数：这条规则既要在「云端写入前」拦（`services/posterTemplatesApi.js`
 * 的删除闸口），也要在将来的管理端列表里解释「为什么这个删除按钮是灰的」（US-312b 的界面）。
 * 两处读同一份文案，别各写一句 —— 与装裱 `framingPresetDeleteVerdict` 同一口径。
 */
export const POSTER_TEMPLATE_BUILTIN_DELETE_NOTE = '内置模板不可删除，只能停用。';

/** 删除前的判据读数：返回可读原因（空串 = 可以删）；缺 id 也算不可删（没有幂等键就写不动云端）。 */
export function posterTemplateDeleteIssue(template) {
  const item = normalizePosterTemplate(template);
  if (!item.id) return '缺少模板 id（云端 template_key 是幂等键）。';
  if (item.builtin) return POSTER_TEMPLATE_BUILTIN_DELETE_NOTE;
  return '';
}

// ---------------------------------------------------------------------------
// 三层归属的可见性 · 老师个人模板（另存 / 重命名 / 删除）
// （[海报 US-310b] / FR-353、FR-354、FR-359）
//
// 与装裱 `data/framingPresets.js` 的同一套规则**逐条对齐**（PRD 9.2 第 7 条：不发明第二套权限模型）：
//   · 平台模板全员可见；机构模板限本机构；**个人（teacher）模板只有本人看得见**；
//   · 缺 ownerKey 的 org / teacher 模板对老师**不可见**（fail-safe：宁可少显示，也不越权展示）；
//   · 老师只能改 / 删**自己的**个人模板 —— 平台与机构模板由管理员在「海报模板库」里维护（US-312a），
//     老师端连编辑入口都不出现（写入侧再由 `posterTemplateEditableBy` 拦一道）。
//
// 三条纪律，改代码前先读：
//   ① **可见性与可编辑性是两件事**：看得见 ≠ 改得动（老师看得见平台模板，但改不了、删不了）。
//   ② 个人模板的 `ownerKey` **必须落下来**：缺了它对谁都不可见（fail-safe），保存那条路因此统一走
//      `buildTeacherPosterTemplate`，界面不许自己拼一个 ownerKey（拼错的表现是「存了自己看不见」）。
//   ③ 删除**只影响以后的可选列表**：已经导出 / 转发过的海报是图片文件，不是对模板的引用。
// ---------------------------------------------------------------------------

/** 模板层级徽标（列表与「我的」标记读同一份文案）：平台 / 机构 / 我的。 */
export const POSTER_TEMPLATE_SCOPE_LABELS = { platform: '平台', org: '机构', teacher: '我的' };

/** 个人模板的标记文案（验收原文就是这两个字：列表里带「我的」标记的即本人的模板）。 */
export const POSTER_TEMPLATE_MINE_LABEL = POSTER_TEMPLATE_SCOPE_LABELS.teacher;

/** 删除模板时的说明（不阻断、不吓人，但要说清「已经产出的图不受影响」）。 */
export const POSTER_TEMPLATE_DELETE_NOTE = '删除只影响以后的可选列表；已经导出、转发或下载过的海报文件不会被改动。';

/** 老师端对平台 / 机构模板动手时的统一拒绝文案（界面与写入侧读同一句）。 */
export const POSTER_TEMPLATE_SCOPE_DENIED_TEXT = '平台与机构模板由管理员在「海报模板库」里维护，老师端不能修改或删除。';

/**
 * 观察者（老师 / 管理员）→ 可见性与可编辑性的入参。
 * 身份串的两个来源（teacherId 与 teacherName）与装裱共用 `teacherIdentityKeys`：
 * 业务数据里 id（teacher-linxiao）与姓名（林晓老师）都出现过，两个都收。
 */
export function posterTemplateViewer({ role = 'teacher', teacherName = '', teacherId = '', orgId = '', seeAllScopes = false, manageAllScopes = false } = {}) {
  return {
    role,
    teacherName: str(teacherName),
    teacherId: str(teacherId),
    orgId: str(orgId),
    seeAllScopes: seeAllScopes === true,
    manageAllScopes: manageAllScopes === true
  };
}

/**
 * 某位观察者能不能看到这套模板：
 * - 管理端（`role: 'admin'`）要维护三层模板，读全量；
 * - 老师端只读「平台 + 本机构 + ownerKey 命中自己的个人模板」，**别人的个人模板一律看不到**；
 * - org / teacher 模板缺 ownerKey 时对老师不可见（fail-safe）。
 */
export function posterTemplateVisibleTo(template, viewer = {}) {
  if (viewer.role === 'admin' || viewer.seeAllScopes === true) return true;
  const item = normalizePosterTemplate(template);
  if (item.scope === DEFAULT_FRAME_SCOPE) return true;
  if (!item.ownerKey) return false;
  if (item.scope === 'org') return Boolean(viewer.orgId) && item.ownerKey === str(viewer.orgId);
  return teacherIdentityKeys(viewer).includes(item.ownerKey);
}

/** 过滤出观察者可见的模板（保持原顺序，排序由 `sortPosterTemplatesForViewer` 决定）。 */
export function filterPosterTemplatesForViewer(templates, viewer = {}) {
  return list(templates).filter((item) => posterTemplateVisibleTo(item, viewer));
}

/**
 * 列表顺序的唯一来源（老师端视角）：**个人模板排在最前面**，其余仍按 `sortPosterTemplates`
 * （sortOrder 升序 → id）—— AC 原文「个人模板…在列表上方优先展示」就落在这一条上。
 * 为什么不是改 `sortPosterTemplates`：那是**全仓的排序真源**（云端返回 / 本机兜底 / 管理端列表都读它），
 * 「我的优先」是**观察者视角**的排序，管理端要的是库顺序（三层混排按排序号）。
 */
export function sortPosterTemplatesForViewer(templates, viewer = {}) {
  const ordered = sortPosterTemplates(templates);
  const mine = (item) => item.scope === 'teacher' && posterTemplateEditableBy(item, viewer);
  return [...ordered.filter(mine), ...ordered.filter((item) => !mine(item))];
}

/**
 * 这份模板能不能由这位观察者改写（重命名 / 删除）：
 * 管理端可维护三层；老师端**只有自己的个人模板**可改可删；平台与机构模板一律不可（老师端不显示入口）。
 */
export function posterTemplateEditableBy(template, viewer = {}) {
  if (viewer.role === 'admin' || viewer.manageAllScopes === true) return true;
  const item = normalizePosterTemplate(template);
  if (item.scope !== 'teacher') return false;
  return Boolean(item.ownerKey) && teacherIdentityKeys(viewer).includes(item.ownerKey);
}

/** 可编辑的模板列表（界面只给它渲染改名 / 删除入口）。 */
export function editablePosterTemplates(templates, viewer = {}) {
  return list(templates).filter((item) => posterTemplateEditableBy(item, viewer));
}

/** 模板名归一化：去首尾空格、把连续空白压成一个空格、截到上限；空值用 `fallback`。 */
export function normalizePosterTemplateName(value, fallback = '') {
  const raw = str(value).replace(/\s+/g, ' ').trim();
  return (raw || str(fallback)).slice(0, POSTER_TEMPLATE_NAME_MAX);
}

/**
 * 模板名的问题（空名 / 重名）→ 可读文案；没问题返回空串。
 * 重名在**同一份列表内**判断：老师端这份列表就是「平台 + 本机构 + 我的」可见集合，
 * 让老师不必靠「哪个是我的 XX」来分辨两套同名模板。重命名时用 `exceptId` 排除自己。
 */
export function posterTemplateNameIssue(name, templates, { exceptId = '' } = {}) {
  const clean = normalizePosterTemplateName(name);
  if (!clean) return '请填写模板名';
  const clash = list(templates).some((item) => item && item.id !== exceptId
    && normalizePosterTemplateName(item.name) === clean);
  return clash ? `已有名为「${clean}」的模板，请换个名字` : '';
}

/**
 * 「另存为我的海报模板」：把老师此刻看到的那一张（含改过的文案）存成一套**个人模板**。
 *
 * ownerKey 取观察者身份串（老师姓名优先）—— 缺了 ownerKey 的个人模板对谁都不可见（fail-safe），
 * 所以这里必须落下来；id 仍用随机唯一值（`template_key` 是 upsert 冲突键，不能由自然键派生）。
 * `kind` / `entryScope` 从**来源模板**带过来：存下来的这套要能在这两处入口同样被选中，
 * 而不是只在这一处能用的半张模板。
 */
export function buildTeacherPosterTemplate({ name, description = '', spec = null, kind = '', entryScope = '', viewer = {}, sortOrder } = {}) {
  const now = Date.now();
  const ownerKey = str(viewer.teacherName || viewer.teacherId || teacherIdentityKeys(viewer)[0] || '');
  return normalizePosterTemplate({
    id: `poster-teacher-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: normalizePosterTemplateName(name, '我的海报'),
    description: str(description).replace(/\s+/g, ' ').slice(0, POSTER_TEMPLATE_DESCRIPTION_MAX),
    spec,
    kind,
    scope: 'teacher',
    ownerKey,
    entryScope,
    enabled: true,
    builtin: false,
    // 默认模板是**库级设置**（管理端 US-312b 的事）：个人模板天然不是默认模板。
    isDefault: false,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : POSTER_TEMPLATE_SORT_FALLBACK,
    updatedBy: ownerKey,
    updatedAt: new Date(now).toISOString()
  });
}

/** 重命名：只改名字，模板 id、spec 与 kind 一个字段都不动（已经导出的海报引用的就是那份 spec）。 */
export function renamePosterTemplate(template, name) {
  const item = normalizePosterTemplate(template);
  return { ...item, name: normalizePosterTemplateName(name, normalizePosterTemplateName(item.name, '我的海报')) };
}

/** 模板层级徽标：平台 / 机构 / 我的（`我的` 就是个人模板的标记）。 */
export function posterTemplateScopeLabel(template) {
  const scope = normalizeFrameScope(group(template).scope);
  return POSTER_TEMPLATE_SCOPE_LABELS[scope] || POSTER_TEMPLATE_SCOPE_LABELS.platform;
}

// ---------------------------------------------------------------------------
// 内置模板库（[海报 US-302a]：8 套、覆盖五类场景，每类至少 1 套、主流三类各 2 套）
//
// 出厂的模板就是「一份 spec + 一句场景说明」。这里用 `builtinPosterSpec` 构造：
// 写法上只写有意为之的字段，其余交给收敛器补齐 —— 于是「内置模板一定合法」是结构保证，
// 而不是「写的时候小心点」。
//
// 两条配色纪律（AC）：只用品牌色（暖金 #CFA52E / 墨黑 #2B271F / 暖白 #FBF8F2）。
// 辅助色取 `POSTER_MUTED_COLORS`（褐 / 深褐 / 米线 / 暖沙，都是同一色系的中性色）——
// **不出现蓝色作为主视觉**，`posterIsBlueHex()` 是这条纪律的机器判据（断言与自检读它）。
//
// 四条版式纪律：① 每套都预留二维码位与机构 Logo 位（FR-323）；② 二维码边长 ≥ 120px（可扫性）；
// ③ 所有几何落在画布内（短边是比例尺，长画布的 y 可以 >1）；④ Logo 按 3:1 横幅估高不越界。
// 这四条都由断言逐套兜住（`/tmp/assert-us090.mjs`，与渲染自检各管一半）。
// ---------------------------------------------------------------------------

const builtinPosterSpec = (fields) => normalizePosterSpec({ ...fields, version: POSTER_SPEC_VERSION });

/** 品牌三色与辅助色的短别名（下面每套模板的配色一眼可读，别在各处再抄十六进制串）。 */
const BRAND_GOLD = POSTER_BRAND_COLORS.gold;
const BRAND_INK = POSTER_BRAND_COLORS.ink;
const BRAND_PAPER = POSTER_BRAND_COLORS.paper;
const MUTED_BROWN = POSTER_MUTED_COLORS.brown;
const MUTED_DEEP = POSTER_MUTED_COLORS.deep;
const MUTED_LINE = POSTER_MUTED_COLORS.line;
const MUTED_SAND = POSTER_MUTED_COLORS.sand;

/** 二维码位（每套模板都带一个；内容固定为分享令牌链接，老师端不给自由填写 URL 的口子）。 */
const builtinQrSlot = (fields) => ({
  id: 'qr',
  type: 'qrcode',
  value: '{分享链接}',
  caption: '扫码看完整成长档案',
  captionSizeRatio: 0.0125,
  ...fields
});

/** 机构 Logo 位（`url` 留空 = 用渲染时传进来的 `data.logo`）。 */
const builtinLogoSlot = (fields) => ({ id: 'logo', type: 'logo', maxWRatio: 0.15, opacity: 0.9, ...fields });

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

/** 「墨色留白 · 单作品」的版式：暖白纯色底 + 墨黑细框，标题居中如展签（与暖金版构成一对）。
 *  作品区同样占上部约 55%（`h: 0.735` × 短边 1080 = 画布高度的 55.1%）—— 两套单作品模板的差别
 *  在配色与标题对齐，不在作品区大小（[海报 US-303] 的 `posterSingleLayout().ok` 逐套检查它）。 */
const singleInkSpec = builtinPosterSpec({
  kind: 'single',
  canvas: { ...POSTER_CANVAS_PRESETS.single },
  background: { type: 'solid', stops: [BRAND_PAPER] },
  frame: { enabled: true, color: BRAND_INK, widthRatio: 0.005, cornerRadiusRatio: 0.008 },
  // 一条居中的短金线：给居中的标题一个「落款位」的呼吸感。
  decor: { hairline: { color: BRAND_GOLD, widthRatio: 0.0018, x: 0.42, y: 0.878, w: 0.16 } },
  slots: [
    { ...DEFAULT_POSTER_IMAGE_SLOT, x: 0.14, y: 0.125, w: 0.72, h: 0.735, radiusRatio: 0.008, paddingRatio: 0.014, shadow: false },
    {
      id: 'title',
      type: 'text',
      x: 0.14,
      y: 0.905,
      w: 0.72,
      align: 'center',
      font: 'serif',
      weight: 'bold',
      sizeRatio: 0.034,
      color: BRAND_INK,
      maxLines: 1,
      template: '《{作品名}》'
    },
    {
      id: 'student',
      type: 'text',
      x: 0.14,
      y: 0.968,
      w: 0.72,
      align: 'center',
      font: 'sans-serif',
      sizeRatio: 0.021,
      color: MUTED_BROWN,
      maxLines: 1,
      template: '{学员名} · {日期}'
    },
    {
      id: 'quote',
      type: 'text',
      x: 0.2,
      y: 1.02,
      w: 0.6,
      align: 'center',
      font: 'serif',
      sizeRatio: 0.02,
      color: MUTED_DEEP,
      maxLines: 2,
      lineHeight: 1.7,
      template: '{点评金句}'
    },
    builtinQrSlot({ x: 0.4425, y: 1.115, sizeRatio: 0.115, captionColor: MUTED_BROWN }),
    builtinLogoSlot({ x: 0.14, y: 0.058, maxWRatio: 0.13, opacity: 0.85 })
  ]
});

/** 「墨色九宫 · 阶段成长」的版式：三行三列固定九宫格，每格标注课次日期。 */
const periodNineGridSpec = builtinPosterSpec({
  kind: 'period',
  canvas: { ...POSTER_CANVAS_PRESETS.period },
  background: { type: 'linear-gradient', angle: 150, stops: [BRAND_PAPER, MUTED_SAND] },
  frame: { enabled: true, color: BRAND_INK, widthRatio: 0.006, cornerRadiusRatio: 0.014 },
  decor: { hairline: { color: BRAND_GOLD, widthRatio: 0.0018, x: 0.08, y: 1.075, w: 0.84 } },
  slots: [
    {
      id: 'title',
      type: 'text',
      x: 0.08,
      y: 0.062,
      w: 0.84,
      align: 'left',
      font: 'serif',
      weight: 'bold',
      sizeRatio: 0.038,
      color: BRAND_INK,
      maxLines: 1,
      template: '{学员名} 的成长记录'
    },
    {
      id: 'period',
      type: 'text',
      x: 0.08,
      y: 0.122,
      w: 0.84,
      align: 'left',
      font: 'sans-serif',
      sizeRatio: 0.019,
      color: MUTED_BROWN,
      maxLines: 1,
      template: '{周期} · 共 {作品数} 幅'
    },
    {
      id: 'collage',
      type: 'image',
      x: 0.08,
      y: 0.178,
      w: 0.84,
      h: 0.86,
      bg: '#FFFFFF',
      radiusRatio: 0.016,
      paddingRatio: 0.01,
      shadow: false,
      border: { color: MUTED_LINE, widthRatio: 0.0015 },
      // 固定 3×3 九宫格（与「原木素雅」的自适应网格构成两种取向）：9 格以内每格都在。
      grid: { columns: 3, rows: 3, gapRatio: 0.014, maxItems: 9 },
      cellCaption: { visible: true, position: 'below', sizeRatio: 0.0135, color: MUTED_BROWN }
    },
    {
      id: 'summary',
      type: 'text',
      x: 0.08,
      y: 1.105,
      w: 0.84,
      align: 'left',
      font: 'serif',
      sizeRatio: 0.02,
      color: MUTED_DEEP,
      maxLines: 3,
      lineHeight: 1.6,
      template: '{阶段总结}'
    },
    builtinQrSlot({ x: 0.755, y: 1.26, sizeRatio: 0.125, captionSizeRatio: 0.013, captionColor: MUTED_BROWN }),
    builtinLogoSlot({ x: 0.08, y: 1.62, maxWRatio: 0.15 })
  ]
});

/** 「墨色作品墙 · 班级集体」的版式：全班每人一格，格下标注学员姓名，底部机构落款与二维码。 */
const classInkWallSpec = builtinPosterSpec({
  kind: 'class',
  canvas: { ...POSTER_CANVAS_PRESETS.class },
  background: { type: 'linear-gradient', angle: 135, stops: [BRAND_PAPER, MUTED_SAND] },
  frame: { enabled: true, color: BRAND_INK, widthRatio: 0.005, cornerRadiusRatio: 0.01 },
  decor: { hairline: { color: BRAND_GOLD, widthRatio: 0.0018, x: 0.08, y: 0.152, w: 0.84 } },
  slots: [
    {
      id: 'title',
      type: 'text',
      x: 0.08,
      y: 0.058,
      w: 0.84,
      align: 'left',
      font: 'serif',
      weight: 'bold',
      sizeRatio: 0.036,
      color: BRAND_INK,
      maxLines: 1,
      template: '{班级名} 作品墙'
    },
    {
      id: 'period',
      type: 'text',
      x: 0.08,
      y: 0.115,
      w: 0.84,
      align: 'left',
      font: 'sans-serif',
      sizeRatio: 0.019,
      color: MUTED_BROWN,
      maxLines: 1,
      template: '{周期} · 共 {作品数} 幅作品'
    },
    {
      id: 'wall',
      type: 'image',
      x: 0.07,
      y: 0.19,
      w: 0.86,
      h: 0.85,
      bg: '#FFFFFF',
      radiusRatio: 0.014,
      paddingRatio: 0.008,
      shadow: false,
      border: { color: MUTED_LINE, widthRatio: 0.0015 },
      // 自适应网格：人数多时自动换更密的档位，上限 = 班级作品墙的口径（30）。
      grid: { columns: 0, rows: 0, gapRatio: 0.014, maxItems: POSTER_CLASS_MAX_ITEMS_DEFAULT },
      cellCaption: { visible: true, position: 'below', sizeRatio: 0.0135, color: MUTED_BROWN }
    },
    {
      id: 'org',
      type: 'text',
      x: 0.08,
      y: 1.1,
      w: 0.5,
      align: 'left',
      font: 'serif',
      weight: 'bold',
      sizeRatio: 0.022,
      color: BRAND_INK,
      maxLines: 1,
      template: '{机构名}'
    },
    {
      id: 'teacher',
      type: 'text',
      x: 0.08,
      y: 1.142,
      w: 0.5,
      align: 'left',
      font: 'sans-serif',
      sizeRatio: 0.017,
      color: MUTED_BROWN,
      maxLines: 1,
      template: '{老师姓名} · {日期}'
    },
    builtinQrSlot({ x: 0.7, y: 1.075, sizeRatio: 0.13, captionSizeRatio: 0.0125, captionColor: MUTED_BROWN }),
    builtinLogoSlot({ x: 0.08, y: 1.23, maxWRatio: 0.16 })
  ]
});

/** 「暖金名片 · 班级集体」的版式：暖沙底 + 金框 + 四行三列名片格（12 人以内一人一格）。 */
const classGoldCardsSpec = builtinPosterSpec({
  kind: 'class',
  canvas: { ...POSTER_CANVAS_PRESETS.class },
  background: { type: 'solid', stops: [MUTED_SAND] },
  frame: { enabled: true, color: BRAND_GOLD, widthRatio: 0.009, cornerRadiusRatio: 0.028 },
  decor: { hairline: { color: BRAND_INK, widthRatio: 0.0016, x: 0.08, y: 0.155, w: 0.84 } },
  slots: [
    {
      id: 'title',
      type: 'text',
      x: 0.08,
      y: 0.06,
      w: 0.84,
      align: 'center',
      font: 'serif',
      weight: 'bold',
      sizeRatio: 0.034,
      color: BRAND_INK,
      maxLines: 1,
      template: '{班级名} 作品墙'
    },
    {
      id: 'period',
      type: 'text',
      x: 0.08,
      y: 0.118,
      w: 0.84,
      align: 'center',
      font: 'sans-serif',
      sizeRatio: 0.019,
      color: MUTED_BROWN,
      maxLines: 1,
      template: '{周期} · 共 {作品数} 幅'
    },
    {
      id: 'wall',
      type: 'image',
      x: 0.075,
      y: 0.192,
      w: 0.85,
      h: 0.83,
      bg: '#FFFFFF',
      radiusRatio: 0.012,
      paddingRatio: 0.008,
      shadow: true,
      border: { color: MUTED_LINE, widthRatio: 0.0015 },
      // 名片墙：固定四行三列（12 格），超过 12 位学员时由渲染层按课次均匀精选并提示。
      grid: { columns: 4, rows: 3, gapRatio: 0.012, maxItems: 12 },
      cellCaption: { visible: true, position: 'below', sizeRatio: 0.013, color: MUTED_BROWN }
    },
    {
      id: 'org',
      type: 'text',
      x: 0.08,
      y: 1.1,
      w: 0.84,
      align: 'center',
      font: 'serif',
      sizeRatio: 0.021,
      color: BRAND_INK,
      maxLines: 1,
      template: '{机构名} · {老师姓名}'
    },
    builtinQrSlot({ x: 0.4075, y: 1.17, sizeRatio: 0.115, captionColor: MUTED_BROWN }),
    builtinLogoSlot({ x: 0.435, y: 1.375, maxWRatio: 0.13 })
  ]
});

/** 「深墨画框 · 成长视频封面」的版式：深墨底衬暖白画框，含「成长记录」标题与时长角标。 */
const videoInkCoverSpec = builtinPosterSpec({
  kind: 'video-cover',
  canvas: { ...POSTER_CANVAS_PRESETS['video-cover'] },
  background: { type: 'linear-gradient', angle: 160, stops: [BRAND_INK, MUTED_DEEP] },
  frame: { enabled: true, color: BRAND_GOLD, widthRatio: 0.008, cornerRadiusRatio: 0.03 },
  decor: { hairline: { color: BRAND_GOLD, widthRatio: 0.0016, x: 0.4, y: 0.765, w: 0.2, opacity: 0.9 } },
  slots: [
    {
      id: 'cover',
      type: 'image',
      x: 0.1,
      y: 0.125,
      w: 0.8,
      h: 0.6,
      bg: BRAND_PAPER,
      radiusRatio: 0.022,
      paddingRatio: 0.012,
      shadow: true,
      border: { color: BRAND_GOLD, widthRatio: 0.0012 }
    },
    // 播放图标：四种占位区里没有「图形」这一类，用一个衬线的实心三角字符表达
    // （US-306 要的是「有播放图标」，不新增 slot 类型；压在画框下沿外侧不遮作品主体）。
    {
      id: 'play',
      type: 'text',
      x: 0.7,
      y: 0.585,
      w: 0.14,
      align: 'center',
      font: 'sans-serif',
      weight: 'bold',
      sizeRatio: 0.075,
      color: BRAND_PAPER,
      maxLines: 1,
      template: '▶'
    },
    {
      id: 'title',
      type: 'text',
      x: 0.1,
      y: 0.795,
      w: 0.8,
      align: 'center',
      font: 'serif',
      weight: 'bold',
      sizeRatio: 0.052,
      color: BRAND_PAPER,
      maxLines: 1,
      template: '成长记录'
    },
    {
      id: 'student',
      type: 'text',
      x: 0.1,
      y: 0.875,
      w: 0.8,
      align: 'center',
      font: 'sans-serif',
      sizeRatio: 0.024,
      color: BRAND_GOLD,
      maxLines: 1,
      template: '{学员名} · {周期}'
    },
    {
      id: 'duration',
      type: 'text',
      x: 0.1,
      y: 0.935,
      w: 0.8,
      align: 'center',
      font: 'sans-serif',
      sizeRatio: 0.022,
      color: MUTED_SAND,
      maxLines: 1,
      letterSpacingRatio: 0.004,
      template: '时长 {时长}'
    },
    builtinQrSlot({ x: 0.42, y: 1.065, sizeRatio: 0.13, captionColor: MUTED_SAND }),
    builtinLogoSlot({ x: 0.43, y: 1.34, maxWRatio: 0.14, opacity: 0.85 })
  ]
});

/**
 * 「暖白长卷 · 成长报告」的版式：1080×3240（3 个短边）的长图，自上而下四段 ——
 * 头图 → 课程时间线（周期与课时数）→ 作品与点评 → 成长概览 → 二维码与落款。
 * 分段标题是版式文字（与二维码说明同一类），**内容一律来自变量**（FR-326：不许写死示例文案）。
 */
const reportLongScrollSpec = builtinPosterSpec({
  kind: 'report-long',
  canvas: { width: 1080, height: 3240 },
  background: { type: 'solid', stops: [BRAND_PAPER] },
  frame: { enabled: true, color: BRAND_GOLD, widthRatio: 0.004, cornerRadiusRatio: 0 },
  decor: { hairline: { color: BRAND_GOLD, widthRatio: 0.0016, x: 0.08, y: 0.82, w: 0.84 } },
  slots: [
    {
      id: 'title',
      type: 'text',
      x: 0.08,
      y: 0.1,
      w: 0.84,
      align: 'left',
      font: 'serif',
      weight: 'bold',
      sizeRatio: 0.034,
      color: BRAND_INK,
      maxLines: 1,
      template: '{学员名} 的成长报告'
    },
    {
      id: 'period',
      type: 'text',
      x: 0.08,
      y: 0.165,
      w: 0.84,
      align: 'left',
      font: 'sans-serif',
      sizeRatio: 0.019,
      color: MUTED_BROWN,
      maxLines: 1,
      template: '{周期} · {课程名}'
    },
    {
      id: 'cover',
      type: 'image',
      x: 0.08,
      y: 0.215,
      w: 0.84,
      h: 0.56,
      bg: '#FFFFFF',
      radiusRatio: 0.012,
      paddingRatio: 0.01,
      shadow: false,
      border: { color: MUTED_LINE, widthRatio: 0.0015 }
    },
    {
      id: 'timelineTitle',
      type: 'text',
      x: 0.08,
      y: 0.86,
      w: 0.84,
      align: 'left',
      font: 'sans-serif',
      weight: 'bold',
      sizeRatio: 0.022,
      color: BRAND_INK,
      maxLines: 1,
      template: '课程时间线'
    },
    {
      id: 'timeline',
      type: 'text',
      x: 0.08,
      y: 0.905,
      w: 0.84,
      align: 'left',
      font: 'serif',
      sizeRatio: 0.02,
      color: MUTED_DEEP,
      maxLines: 2,
      lineHeight: 1.7,
      template: '{周期} · 共 {课时数} 次课'
    },
    {
      id: 'worksTitle',
      type: 'text',
      x: 0.08,
      y: 1.03,
      w: 0.84,
      align: 'left',
      font: 'sans-serif',
      weight: 'bold',
      sizeRatio: 0.022,
      color: BRAND_INK,
      maxLines: 1,
      template: '作品与点评'
    },
    {
      id: 'collage',
      type: 'image',
      x: 0.08,
      y: 1.075,
      w: 0.84,
      h: 0.78,
      bg: '#FFFFFF',
      radiusRatio: 0.014,
      paddingRatio: 0.01,
      shadow: false,
      border: { color: MUTED_LINE, widthRatio: 0.0015 },
      grid: { columns: 0, rows: 0, gapRatio: 0.014, maxItems: 9 },
      cellCaption: { visible: true, position: 'below', sizeRatio: 0.0135, color: MUTED_BROWN }
    },
    {
      id: 'quote',
      type: 'text',
      x: 0.08,
      y: 1.92,
      w: 0.84,
      align: 'left',
      font: 'serif',
      sizeRatio: 0.021,
      color: MUTED_DEEP,
      maxLines: 3,
      lineHeight: 1.7,
      template: '{点评金句}'
    },
    {
      id: 'summaryTitle',
      type: 'text',
      x: 0.08,
      y: 2.08,
      w: 0.84,
      align: 'left',
      font: 'sans-serif',
      weight: 'bold',
      sizeRatio: 0.022,
      color: BRAND_INK,
      maxLines: 1,
      template: '成长概览'
    },
    {
      id: 'summary',
      type: 'text',
      x: 0.08,
      y: 2.125,
      w: 0.84,
      align: 'left',
      font: 'serif',
      sizeRatio: 0.021,
      color: MUTED_DEEP,
      maxLines: 8,
      lineHeight: 1.75,
      template: '{阶段总结}'
    },
    builtinQrSlot({ x: 0.42, y: 2.5, sizeRatio: 0.16, captionSizeRatio: 0.013, captionColor: MUTED_BROWN }),
    builtinLogoSlot({ x: 0.08, y: 0.045, maxWRatio: 0.14 }),
    {
      id: 'footer',
      type: 'text',
      x: 0.08,
      y: 2.8,
      w: 0.84,
      align: 'center',
      font: 'sans-serif',
      sizeRatio: 0.018,
      color: MUTED_BROWN,
      maxLines: 1,
      template: '{机构名} · {老师姓名}'
    }
  ]
});

/**
 * 内置模板（出厂种子，[海报 US-302a]）。三条共同约定（FR-323 / US-302）：
 *   - 每套都**预留二维码位与机构 Logo 位**（可以 `visible: false` 关掉显示，但字段要在）；
 *   - `builtin: true` + `enabled: true`，且**不可删除、只可停用**（US-312b 的门槛）；
 *   - 名称可读、`description` 一句话说清「什么场景、什么色系」。
 * `entryScope` 写的是「这套版式适合哪个入口」：单作品两处都能用（课后反馈里只有一幅作品），
 * 阶段 / 班级 / 封面 / 长图都要多幅作品与周期数据，只有成长档案里有（US-309 据此置灰入口）。
 *
 * 排序即 `sortOrder`（1 起、与数组顺序一致）：单作品 → 阶段 → 班级 → 封面 → 长图，
 * 每类内部先暖金后墨色。`poster-warm-gold-single` 仍是唯一默认模板（老师端首次进装裱/转发默认选它）。
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
    id: 'poster-ink-quiet-single',
    name: '墨色留白 · 单作品',
    description: '墨黑细框配暖白纸感底色，标题居中如展签。适合国画、线描这类素雅作品。',
    kind: 'single',
    spec: singleInkSpec,
    scope: 'platform',
    ownerKey: '',
    entryScope: 'both',
    enabled: true,
    builtin: true,
    isDefault: false,
    sortOrder: 2
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
    sortOrder: 3
  },
  {
    id: 'poster-ink-nine-period',
    name: '墨色九宫 · 阶段成长',
    description: '三行三列的作品九宫格，每格标注课次日期。适合 9 幅以内的阶段性回顾。',
    kind: 'period',
    spec: periodNineGridSpec,
    scope: 'platform',
    ownerKey: '',
    entryScope: 'archive',
    enabled: true,
    builtin: true,
    isDefault: false,
    sortOrder: 4
  },
  {
    id: 'poster-ink-wall-class',
    name: '墨色作品墙 · 班级集体',
    description: '全班每人一格的作品墙，格下标注学员姓名。适合带班老师发到班级群里。',
    kind: 'class',
    spec: classInkWallSpec,
    scope: 'platform',
    ownerKey: '',
    entryScope: 'archive',
    enabled: true,
    builtin: true,
    isDefault: false,
    sortOrder: 5
  },
  {
    id: 'poster-gold-card-class',
    name: '暖金名片 · 班级集体',
    description: '暖沙底色与四行三列名片格，金框收边。适合 12 人以内的班级点名式展示。',
    kind: 'class',
    spec: classGoldCardsSpec,
    scope: 'platform',
    ownerKey: '',
    entryScope: 'archive',
    enabled: true,
    builtin: true,
    isDefault: false,
    sortOrder: 6
  },
  {
    id: 'poster-ink-video-cover',
    name: '深墨画框 · 成长视频封面',
    description: '深墨底衬暖白画框，含成长记录标题与时长角标。适合给成长视频当封面。',
    kind: 'video-cover',
    spec: videoInkCoverSpec,
    scope: 'platform',
    ownerKey: '',
    entryScope: 'archive',
    enabled: true,
    builtin: true,
    isDefault: false,
    sortOrder: 7
  },
  {
    id: 'poster-paper-report-long',
    name: '暖白长卷 · 成长报告',
    description: '1080×3240 长图，头图、作品与点评、成长概览自上而下。适合微信里滑读。',
    kind: 'report-long',
    spec: reportLongScrollSpec,
    scope: 'platform',
    ownerKey: '',
    entryScope: 'archive',
    enabled: true,
    builtin: true,
    isDefault: false,
    sortOrder: 8
  }
].map((template) => normalizePosterTemplate(template));

// ---------------------------------------------------------------------------
// 本机镜像与列表合并（云端不可达时的兜底，[海报 US-302b] / FR-356、FR-368）
//
// 三层归属（platform / org / teacher）与装裱完全同构，**处境也相同**：本机云端的
// `poster_templates` 表还没建立（建议表在 tasks/prd-share-poster.md 9.3），写入会被 PostgREST
// 整条拒掉 —— 所以「先落本机镜像、再推云端」是这里的默认姿势，`services/posterTemplatesApi.js`
// 的读取也按**本机镜像优先**合并（与 `framingPresets.js` / `musicTracks.js` 同一套口径：
// 云表缺列或未建时，本机的那一份才是最新的，云端只负责补进本机没有的 template_key）。
//
// 「本机镜像优先」不会让内置模板变味：内置模板只在**本机也没有这个 key** 时才补进来
// （`mergePosterTemplates` 的主列表先占位），所以管理员在后台改过的名字 / 停用 / 排序不会被
// 出厂值顶回去，重复初始化也不会产生重复数据（FR-356）。
// ---------------------------------------------------------------------------

/** 读坏 JSON 一律回落 fallback（本机镜像来自别的版本 / 手工改过 / 配额写了一半都可能坏）。 */
function safeParsePosterJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/**
 * 合并两份模板列表：**主列表优先**，只有主列表里没有的 `template_key` 才从入参里补进来，
 * 最后统一过一遍排序（顺序的唯一来源仍是 `sortPosterTemplates`）。
 *
 * 三条纪律：① 没有 id 的条目直接丢（没有幂等键就既存不下也删不掉）；② 同一个 key 只留一条
 * （先出现的那条赢）——「重复初始化不产生重复数据」这条 AC 在合并层就成立，不依赖云端去重；
 * ③ 入参不被修改（纯函数，可 `node` 直跑断言）。
 */
export function mergePosterTemplates(primary, incoming) {
  const kept = [];
  const seen = new Set();
  list(primary).concat(list(incoming)).forEach((raw) => {
    const template = normalizePosterTemplate(raw);
    if (!template.id || seen.has(template.id)) return;
    seen.add(template.id);
    kept.push(template);
  });
  return sortPosterTemplates(kept);
}

/** 保证列表里有**全部内置模板**（已有的那几条原样保留，缺的按出厂值补进来）。 */
export function withBuiltinPosterTemplates(templates) {
  return mergePosterTemplates(templates, seedPosterTemplates);
}

/** 内置模板里「这份列表还没有」的那几条（幂等初始化的输入；顺序 = 出厂顺序）。 */
export function missingBuiltinPosterTemplates(existing) {
  const present = new Set(list(existing).map((item) => posterTemplateKey(item)).filter(Boolean));
  return seedPosterTemplates.filter((template) => !present.has(template.id));
}

/**
 * 读本机镜像：读坏 / 空 / 没有 `window`（Node 直跑断言）一律回落**内置模板库**。
 * 与装裱 `loadFramingPresets()` 同一口径 —— 「本地兜底」的兜底就是出厂值。
 */
export function loadPosterTemplates() {
  if (typeof window === 'undefined') return seedPosterTemplates;
  const saved = safeParsePosterJson(window.localStorage.getItem(POSTER_TEMPLATE_STORAGE_KEY), null);
  if (!Array.isArray(saved) || !saved.length) return seedPosterTemplates;
  // 老版本写下的镜像可能没有这次升级新增的内置模板 → 补进来（FR-356 的「随首次加载初始化」）。
  return withBuiltinPosterTemplates(saved);
}

/** 写本机镜像（裸数组，与装裱主键同一形状：外部读取方直接 `JSON.parse` 拿列表）。配额满时静默降级。 */
export function persistPosterTemplates(templates) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(POSTER_TEMPLATE_STORAGE_KEY, JSON.stringify(sortPosterTemplates(templates)));
  } catch { /* 配额满 / 隐私模式：界面仍拿得到内存里的那一份 */ }
}

// ---------------------------------------------------------------------------
// 校验读数（AC 的「非法字段被收敛」要看得见；管理端保存前与断言共用这一份）
//
// 这里只报**结构与参数**层面的问题（越界 / 未知枚举 / 丢弃的占位区 / 变量不在白名单 /
// 蓝色主视觉 / 二维码数量）。「可扫性、文字溢出」那两类要真渲染一次才算得出来，属 US-311a 的导出校验；
// 管理端**保存前**的那一份估算（估算行数 / 最小边长）在 `data/posterAdmin.js` 的
// `posterAdminPreSaveChecks()`（US-312b / FR-355），两处读同一份阈值常量。
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
