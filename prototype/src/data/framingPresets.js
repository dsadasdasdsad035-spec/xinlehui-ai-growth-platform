// 装裱预设 —— 本地兜底数据，与云端 framing_presets 表保持同样的字段形状。
// spec 是「可由 canvas 精确绘制」的参数集合，不是位图。
//
// [第二步 US-001a] 起 spec 用 **v2 结构**（`services/frameSpec.js` 的 DEFAULT_FRAME_SPEC_V2）。
// 4 套内置预设是从 v1 平面结构逐字段迁移过来的，颜色/框宽/字体一个数都没动，
// 因此 `renderFramedArtwork` 的渲染结果与迁移前逐像素一致（v2 → v1 由 frameSpecView 映射）。
//
// 注意 watermark / signature / date 三个分组**故意省略**：v2 的字段全部可选，缺省即 v1 行为
// （不绘制任何叠加元素）。要加的预设自己补这三组即可，不要在这里塞一份别的默认值。
//
// [第二步 US-001b] 起模板分三层（`scope`）：platform / org / teacher，三层共用云端
// framing_presets 一张表，靠 `scope + ownerKey` 区分归属（平台模板 ownerKey 为空）。
// 老记录没有 scope 字段 → `normalizeFrameScope` 一律按 platform 读取。
import { FRAME_STYLE_COLORS, FRAME_STYLE_LIGHTING_ANGLE } from './frameStyles';

const STORAGE_KEY = 'xinlehui-framing-presets-v1';

/** 模板三层：平台 / 机构 / 老师个人。三层共表，`presetKey`（云端 preset_key）仍是唯一键。 */
export const FRAMING_PRESET_SCOPES = ['platform', 'org', 'teacher'];
export const DEFAULT_FRAME_SCOPE = 'platform';
export const FRAMING_PRESET_SCOPE_LABELS = { platform: '平台', org: '机构', teacher: '我的' };

/**
 * 归一化模板层级：缺失（老记录）或非法值一律落到 platform，永不抛错。
 * 注意这是「按最宽松的一层读」还是「按最严格的一层读」的分水岭 —— 这里选 platform，
 * 因为老的 4 套内置预设本来就是全平台可见；个人模板的越权风险由 ownerKey 过滤兜住（见 presetVisibleTo）。
 */
export function normalizeFrameScope(value) {
  return FRAMING_PRESET_SCOPES.includes(value) ? value : DEFAULT_FRAME_SCOPE;
}

/** 补齐 scope / ownerKey 两个层级字段，其余字段原样保留（不改别的行为）。 */
export function normalizeFramingPreset(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const scope = normalizeFrameScope(input.scope);
  return {
    ...input,
    scope,
    // 平台模板没有归属人（PRD：平台模板 owner_key 为空），读到脏值就清掉；
    // org / teacher 两层的 ownerKey 原样保留，由 presetVisibleTo 判断可见性。
    ownerKey: scope === 'platform' || input.ownerKey == null ? '' : String(input.ownerKey)
  };
}

/**
 * 观察者身份 → 可用于匹配 ownerKey 的身份串。
 * 原型阶段老师只有一个会话身份（`roleMeta.teacher.name`，见 main.jsx），
 * 但业务数据里 id（teacher-linxiao）与姓名（林晓老师）都出现过，所以两个都收。
 */
export function teacherIdentityKeys(viewer = {}) {
  return [viewer.teacherId, viewer.teacherName].filter(Boolean).map(String);
}

/**
 * 某位观察者能不能看到这套模板：
 * - 管理端（`role: 'admin'`）要维护三层模板，读全量；
 * - 老师端只读「平台 + 本机构 + ownerKey 命中自己的个人模板」，别人的个人模板一律看不到；
 * - org / teacher 模板缺 ownerKey 时对老师不可见（fail-safe：宁可少显示，也不越权展示）。
 */
export function presetVisibleTo(preset, viewer = {}) {
  if (viewer.role === 'admin' || viewer.seeAllScopes === true) return true;
  const item = normalizeFramingPreset(preset);
  if (item.scope === 'platform') return true;
  if (!item.ownerKey) return false;
  if (item.scope === 'org') return Boolean(viewer.orgId) && item.ownerKey === String(viewer.orgId);
  return teacherIdentityKeys(viewer).includes(item.ownerKey);
}

/** 过滤出观察者可见的模板（保持原顺序，排序由调用方决定）。 */
export function filterFramingPresetsForViewer(presets, viewer = {}) {
  return (Array.isArray(presets) ? presets : []).filter(item => presetVisibleTo(item, viewer));
}

/** 列表顺序的唯一来源：sortOrder 升序，再按 id —— 云端返回与本地兜底走同一套。 */
export function sortFramingPresets(presets) {
  const order = item => (Number.isFinite(item?.sortOrder) ? item.sortOrder : 90);
  return (Array.isArray(presets) ? [...presets] : [])
    .sort((a, b) => order(a) - order(b) || String(a?.id).localeCompare(String(b?.id)));
}

/**
 * 内置预设的 spec 构造器。
 * `lighting` 的默认值（#E8C766 / #8A6B1C / 135°）是 US-002a 起 4 套老预设一直在用的光影，
 * **不要改它**：老预设的渲染逐像素不变是持久承诺（US-002a 的口径）。
 * 新预设按自己的材质色传一份合适的光影（`FRAME_STYLE_COLORS` 里同一材质的 highlight / shadow）。
 */
const builtinSpec = ({ outer, mat, plaqueBg, plaqueText, atmosphere, rationale, outerWidthRatio = 0.0412, matWidthRatio = 0.0647, innerLine = null, plaqueFontFamily = 'serif', plaqueLetterSpacing = 1, shape = 'square', cornerRadiusRatio = 0.06, matVisible = true, lighting = { highlight: '#E8C766', shadow: '#8A6B1C', angle: 135 } }) => ({
  version: 2,
  canvas: { width: 1800, height: 1360, background: '#F3EDE2', wallRatio: 0.025 },
  frame: {
    shape, color: outer, widthRatio: outerWidthRatio, cornerRadiusRatio,
    texture: 'solid', lighting
  },
  mat: { visible: matVisible, color: mat, widthRatio: matWidthRatio, innerLine },
  plaque: { visible: true, bg: plaqueBg, text: plaqueText, fontFamily: plaqueFontFamily, letterSpacing: plaqueLetterSpacing, position: 'bottom' },
  art: { rotateDeg: 0 },
  atmosphere,
  rationale
});

/**
 * 新增样式（US-006 的样式库）用材质色 id 写 spec：底色与光影都从 `FRAME_STYLE_COLORS` 取，
 * 不在这个文件里再抄一遍十六进制值（色板的唯一真源在 `data/frameStyles.js`）。
 */
const styleSpec = (colorId, options = {}) => {
  const color = FRAME_STYLE_COLORS.find(item => item.id === colorId) || FRAME_STYLE_COLORS[0];
  return builtinSpec({
    outer: color.hex,
    lighting: { highlight: color.highlight, shadow: color.shadow, angle: FRAME_STYLE_LIGHTING_ANGLE },
    ...options
  });
};

/**
 * 内置样式库（US-006 起 11 套）。
 *
 * 验收要求「不少于 8 套，覆盖暖金直角 / 深棕直角 / 原木圆角 / 米白圆角 /
 * 原木拱形 / 暖金拱形 / 墨黑斜角 / 暖黄细边」八种长相，`FRAME_STYLE_LOOK_PRESETS`
 * 就是这八种长相 → 预设 id 的对照表（浏览器验证与后台都读它，别另写一份）。
 *
 * 前 4 套是历史预设（us-001a 迁移过来的，spec 一个数都没动），后 7 套是 US-006 新增的：
 * 材质色与光影来自 `data/frameStyles.js` 的色板，形状走 `frame.shape`。
 */
export const seedFramingPresets = [
  {
    id: 'frame-starlight', name: '星光展',
    description: '暖金外框配米白卡纸，深色展签。适合色彩明亮的作品，展陈感强。',
    spec: builtinSpec({ outer: '#cfa52e', mat: '#f3ede2', plaqueBg: '#2b271f', plaqueText: '#fbf8f2', atmosphere: '暖金收边，米白承托，像一次小小的颁奖。', rationale: '金色外框呼应作品的明亮色，米白卡纸避免抢色。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 1
  },
  {
    id: 'frame-oak', name: '自然原木',
    description: '原木棕外框配米白卡纸。温度自然，能托住任意色域的作品。',
    spec: builtinSpec({ outer: '#8d6439', mat: '#f3ede2', plaqueBg: '#3e3022', plaqueText: '#fbf8f2', atmosphere: '原木温度，像把作品放回一张安静的桌子。', rationale: '木质棕与米白同属暖调，不与孩子的用色冲突。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 2
  },
  {
    id: 'frame-ink', name: '东方雅境',
    description: '墨色极简外框配纸色卡纸，气息安静克制。',
    spec: builtinSpec({ outer: '#27241f', mat: '#eee8dd', plaqueBg: '#27241f', plaqueText: '#eee8dd', atmosphere: '墨色极简，纸色留白，气息安静。', rationale: '深墨外框压住画面，纸色卡纸保留东方留白。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 3
  },
  {
    id: 'frame-ai-shuimo', name: '新中式水墨',
    description: '由大模型依据「新中式水墨风，墨色细外框 + 米色纸纹卡纸，落款用深墨色小字，安静克制，适合水彩作品」生成。',
    spec: builtinSpec({
      outer: '#2B2A28', outerWidthRatio: 0.015, mat: '#F3EEE2', matWidthRatio: 0.09,
      innerLine: '#8C8578', plaqueBg: '#EFE8D8', plaqueText: '#2B2A28',
      plaqueFontFamily: 'Noto Serif SC', plaqueLetterSpacing: 2,
      atmosphere: '细墨线轻收四周，米色卡纸如宣纸留白，童趣水彩在一片静气中安然呼吸。',
      rationale: '墨线收束，米色承托童趣，留白透气，静而不冷。'
    }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: false, scope: 'platform', ownerKey: '', sortOrder: 4
  },
  {
    id: 'frame-dark-brown', name: '深棕展框',
    description: '深棕外框配米白卡纸。沉稳的木质调，适合色彩浓郁或偏暖的作品。',
    spec: styleSpec('dark-brown', { mat: '#F3EDE2', matWidthRatio: 0.0647, plaqueBg: '#2F2419', plaqueText: '#FBF8F2', atmosphere: '深棕沉下来，把亮度都留给孩子的画。', rationale: '深棕比纯黑温和，配米白卡纸不压画面。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 5
  },
  {
    id: 'frame-wood-rounded', name: '原木圆角',
    description: '原木色圆角外框配米白卡纸。四角柔和，手作感强，适合低龄孩子的作品。',
    spec: styleSpec('natural-wood', { shape: 'rounded', cornerRadiusRatio: 0.22, mat: '#F3EDE2', matWidthRatio: 0.0647, plaqueBg: '#3E3022', plaqueText: '#FBF8F2', atmosphere: '圆润的木色像一本摊开的绘本。', rationale: '圆角与木质色共同降低「被评判」的紧张感。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 6
  },
  {
    id: 'frame-cream-rounded', name: '米白圆角',
    description: '米白圆角外框配浅灰卡纸。安静轻盈，适合线条与留白较多的作品。',
    spec: styleSpec('cream', { shape: 'rounded', cornerRadiusRatio: 0.22, mat: '#E4E0D8', matWidthRatio: 0.072, plaqueBg: '#3E3A33', plaqueText: '#FBF8F2', atmosphere: '米白的圆角把画面轻轻托起来。', rationale: '浅色外框在浅色墙面上仍然有边界，靠圆角与卡纸层次分开。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 7
  },
  {
    id: 'frame-wood-arch', name: '原木拱形',
    description: '原木色拱形外框配米白卡纸。顶部半圆，像一扇小窗。',
    spec: styleSpec('natural-wood', { shape: 'arch', mat: '#F3EDE2', matWidthRatio: 0.0647, plaqueBg: '#3E3022', plaqueText: '#FBF8F2', atmosphere: '拱顶让小画也有展陈感。', rationale: '拱形把视线收向画面中心，木色保持温度。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 8
  },
  {
    id: 'frame-gold-arch', name: '暖金拱形',
    description: '暖金拱形外框配米白卡纸。展陈感最强的一套，适合结课与画展。',
    spec: styleSpec('warm-gold', { shape: 'arch', mat: '#F3EDE2', matWidthRatio: 0.0647, plaqueBg: '#2B271F', plaqueText: '#FBF8F2', atmosphere: '拱顶配暖金，像一次小小的颁奖典礼。', rationale: '金色与拱形一起给作品仪式感，米白卡纸避免抢色。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 9
  },
  {
    id: 'frame-ink-bevel', name: '墨黑斜角',
    description: '墨黑斜角外框配纸色卡纸。利落克制，适合现代感强的作品。',
    spec: styleSpec('ink', { shape: 'bevel', mat: '#EEE8DD', matWidthRatio: 0.0647, innerLine: '#8C8578', plaqueBg: '#2A2724', plaqueText: '#EEE8DD', atmosphere: '斜切的黑框像一枚印章。', rationale: '斜角比直角更利落，纸色卡纸留住手作的温度。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 10
  },
  {
    id: 'frame-warm-thin', name: '暖黄细边',
    description: '暖黄细外框配米白卡纸。几乎只是一圈线，把舞台完全留给作品。',
    spec: styleSpec('warm-yellow', { outerWidthRatio: 0.014, mat: '#F3EDE2', matWidthRatio: 0.08, plaqueBg: '#3E3A33', plaqueText: '#FBF8F2', atmosphere: '一圈细暖黄，像给画描了一根亮边。', rationale: '细边不抢画面，暖黄呼应儿童作品里常见的黄。' }),
    plaqueStudent: '', plaqueDate: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 11
  }
];

/**
 * 八种必须覆盖的长相 → 内置预设 id 的对照表（US-006 的验收清单）。
 * key 是验收用的中文长相名，`shape` / `colorId` / `widthId` 是断言用的判据
 * （`widthId` 为 `thin` 表示「细边」那一套，其余为 `standard`）。
 */
export const FRAME_STYLE_LOOK_PRESETS = [
  { look: '暖金直角', presetId: 'frame-starlight', shape: 'square', colorId: 'warm-gold', widthId: 'standard' },
  { look: '深棕直角', presetId: 'frame-dark-brown', shape: 'square', colorId: 'dark-brown', widthId: 'standard' },
  { look: '原木圆角', presetId: 'frame-wood-rounded', shape: 'rounded', colorId: 'natural-wood', widthId: 'standard' },
  { look: '米白圆角', presetId: 'frame-cream-rounded', shape: 'rounded', colorId: 'cream', widthId: 'standard' },
  { look: '原木拱形', presetId: 'frame-wood-arch', shape: 'arch', colorId: 'natural-wood', widthId: 'standard' },
  { look: '暖金拱形', presetId: 'frame-gold-arch', shape: 'arch', colorId: 'warm-gold', widthId: 'standard' },
  { look: '墨黑斜角', presetId: 'frame-ink-bevel', shape: 'bevel', colorId: 'ink', widthId: 'standard' },
  { look: '暖黄细边', presetId: 'frame-warm-thin', shape: 'square', colorId: 'warm-yellow', widthId: 'thin' }
];

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

/** 列表里还没有的内置样式（按 id 比较，保持内置样式库的顺序）。 */
export function missingBuiltinFramingPresets(presets) {
  const ids = new Set((Array.isArray(presets) ? presets : []).map(item => item?.id));
  return seedFramingPresets.filter(item => !ids.has(item.id));
}

/**
 * 把「本地/云端里没有的内置样式」补进列表（按 id 比较，保持原顺序、内置的排在后面）。
 *
 * 为什么需要它：内置样式库是随版本长出来的（US-006 从 4 套扩到 11 套），而
 * `loadFramingPresets()` 一旦读到 localStorage 里的旧列表就直接返回 —— 老用户的列表里
 * 永远不会有新内置样式，「内置不少于 8 套」在真机上就不成立。
 * 因为**内置预设只允许停用、不允许删除**（后台 `remove()` 会挡住），所以「补齐缺失的内置」
 * 不会被「后台删掉了又被加回来」的循环打扰。
 */
export function mergeBuiltinFramingPresets(presets) {
  const list = Array.isArray(presets) ? presets : [];
  const missing = missingBuiltinFramingPresets(list);
  return missing.length ? [...list, ...missing] : list;
}

/**
 * 补齐「云端还不知道的模板」：**关键帧与顺序都以云端为准**，只是把云端列表里缺的那些
 * （`fallback` 里的，通常 = 本机兜底镜像 ∪ 内置样式库）追加在后面。
 *
 * 为什么读取路径也要做这件事：云端是真源，但**云端表里可能根本没有新内置样式** ——
 * 本机的云端表就缺 `owner_key` 列、写不进去（US-001b 的列映射只在代码里），只存着最早那 4 套。
 * 只认云端列表的话，老师端永远看不到 US-006 新增的 7 套内置样式，「内置不少于 8 套」在真机上不成立。
 * 只补 **id 缺失** 的条目，所以：① 不会用本机旧数据覆盖云端的更新；② 管理端在本机停用过的模板
 * （`fallback` 里是 `enabled: false`）仍然按停用生效，不会被内置样式库的 `enabled: true` 顶回来。
 */
export function mergeMissingFramingPresets(remote, fallback) {
  const list = Array.isArray(remote) ? remote : [];
  const ids = new Set(list.map(item => item?.id));
  const extras = (Array.isArray(fallback) ? fallback : []).filter(item => item?.id && !ids.has(item.id));
  return extras.length ? [...list, ...extras] : list;
}

export function loadFramingPresets() {
  if (typeof window === 'undefined') return seedFramingPresets;
  const saved = safeParse(window.localStorage.getItem(STORAGE_KEY), null);
  if (!Array.isArray(saved) || !saved.length) return seedFramingPresets;
  return mergeBuiltinFramingPresets(saved);
}

export function persistFramingPresets(presets) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets)); } catch { /* 配额满时静默降级 */ }
}

/**
 * 新建一套模板。默认是**平台层**（后台「新增装裱」由管理员维护）；
 * 老师端「另存为我的模板」（US-031）传 `{ scope: 'teacher', ownerKey: 当前老师 }`，
 * 个人模板必须带 ownerKey，否则读的一侧按 fail-safe 规则谁都看不到。
 */
export function createEmptyFramingPreset(options = {}) {
  const now = Date.now();
  const scope = normalizeFrameScope(options.scope);
  return {
    id: `frame-${now}`,
    name: '新装裱',
    description: '',
    spec: null,
    plaqueStudent: '',
    plaqueDate: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    plaqueTitle: '',
    enabled: true,
    builtin: false,
    scope,
    ownerKey: scope === 'platform' ? '' : String(options.ownerKey || ''),
    sortOrder: 90
  };
}
