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
  // `plaqueDate`（云表 `plaque_date`）是**历史字段**：它曾经承载一个具体日期值
  // （甚至默认写今天），于是补录上节课时展签会写成归档当天 —— US-014 联通后日期值一律取
  // `lesson.lessonDate`，模板只保留「格式（`spec.plaque.dateFormat`）+ 位置（`spec.plaque.position`）」。
  // 这里**结构上剔除**旧字段：读到老镜像 / 老云端行也不会有人再拿它当日期渲染。
  const { plaqueDate: legacyPlaqueDate, ...rest } = input;
  void legacyPlaqueDate;
  return {
    ...rest,
    scope,
    // 平台模板没有归属人（PRD：平台模板 owner_key 为空），读到脏值就清掉；
    // org / teacher 两层的 ownerKey 原样保留，由 presetVisibleTo 判断可见性。
    ownerKey: scope === 'platform' || input.ownerKey == null ? '' : String(input.ownerKey),
    // 默认模板 / 课程绑定 / 变更记录（US-011b）：读脏数据一律收敛成安全值，永不抛错。
    isDefault: input.isDefault === true,
    boundCourseTypes: normalizeCourseBindings(input.boundCourseTypes),
    updatedBy: input.updatedBy == null ? '' : String(input.updatedBy),
    updatedAt: input.updatedAt == null ? '' : String(input.updatedAt),
    history: normalizeFramingPresetHistory(input.history)
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
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 1,
    // 出厂的默认模板（US-011b）：管理员没改过之前，老师端「没命中课程绑定」时就用它。
    // 它也是「被引用的模板只能停用、不能删除」的现成例子（删它会被拦下）。
    isDefault: true
  },
  {
    id: 'frame-oak', name: '自然原木',
    description: '原木棕外框配米白卡纸。温度自然，能托住任意色域的作品。',
    spec: builtinSpec({ outer: '#8d6439', mat: '#f3ede2', plaqueBg: '#3e3022', plaqueText: '#fbf8f2', atmosphere: '原木温度，像把作品放回一张安静的桌子。', rationale: '木质棕与米白同属暖调，不与孩子的用色冲突。' }),
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 2
  },
  {
    id: 'frame-ink', name: '东方雅境',
    description: '墨色极简外框配纸色卡纸，气息安静克制。',
    spec: builtinSpec({ outer: '#27241f', mat: '#eee8dd', plaqueBg: '#27241f', plaqueText: '#eee8dd', atmosphere: '墨色极简，纸色留白，气息安静。', rationale: '深墨外框压住画面，纸色卡纸保留东方留白。' }),
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 3
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
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: false, scope: 'platform', ownerKey: '', sortOrder: 4
  },
  {
    id: 'frame-dark-brown', name: '深棕展框',
    description: '深棕外框配米白卡纸。沉稳的木质调，适合色彩浓郁或偏暖的作品。',
    spec: styleSpec('dark-brown', { mat: '#F3EDE2', matWidthRatio: 0.0647, plaqueBg: '#2F2419', plaqueText: '#FBF8F2', atmosphere: '深棕沉下来，把亮度都留给孩子的画。', rationale: '深棕比纯黑温和，配米白卡纸不压画面。' }),
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 5
  },
  {
    id: 'frame-wood-rounded', name: '原木圆角',
    description: '原木色圆角外框配米白卡纸。四角柔和，手作感强，适合低龄孩子的作品。',
    spec: styleSpec('natural-wood', { shape: 'rounded', cornerRadiusRatio: 0.22, mat: '#F3EDE2', matWidthRatio: 0.0647, plaqueBg: '#3E3022', plaqueText: '#FBF8F2', atmosphere: '圆润的木色像一本摊开的绘本。', rationale: '圆角与木质色共同降低「被评判」的紧张感。' }),
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 6
  },
  {
    id: 'frame-cream-rounded', name: '米白圆角',
    description: '米白圆角外框配浅灰卡纸。安静轻盈，适合线条与留白较多的作品。',
    spec: styleSpec('cream', { shape: 'rounded', cornerRadiusRatio: 0.22, mat: '#E4E0D8', matWidthRatio: 0.072, plaqueBg: '#3E3A33', plaqueText: '#FBF8F2', atmosphere: '米白的圆角把画面轻轻托起来。', rationale: '浅色外框在浅色墙面上仍然有边界，靠圆角与卡纸层次分开。' }),
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 7
  },
  {
    id: 'frame-wood-arch', name: '原木拱形',
    description: '原木色拱形外框配米白卡纸。顶部半圆，像一扇小窗。',
    spec: styleSpec('natural-wood', { shape: 'arch', mat: '#F3EDE2', matWidthRatio: 0.0647, plaqueBg: '#3E3022', plaqueText: '#FBF8F2', atmosphere: '拱顶让小画也有展陈感。', rationale: '拱形把视线收向画面中心，木色保持温度。' }),
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 8
  },
  {
    id: 'frame-gold-arch', name: '暖金拱形',
    description: '暖金拱形外框配米白卡纸。展陈感最强的一套，适合结课与画展。',
    spec: styleSpec('warm-gold', { shape: 'arch', mat: '#F3EDE2', matWidthRatio: 0.0647, plaqueBg: '#2B271F', plaqueText: '#FBF8F2', atmosphere: '拱顶配暖金，像一次小小的颁奖典礼。', rationale: '金色与拱形一起给作品仪式感，米白卡纸避免抢色。' }),
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 9
  },
  {
    id: 'frame-ink-bevel', name: '墨黑斜角',
    description: '墨黑斜角外框配纸色卡纸。利落克制，适合现代感强的作品。',
    spec: styleSpec('ink', { shape: 'bevel', mat: '#EEE8DD', matWidthRatio: 0.0647, innerLine: '#8C8578', plaqueBg: '#2A2724', plaqueText: '#EEE8DD', atmosphere: '斜切的黑框像一枚印章。', rationale: '斜角比直角更利落，纸色卡纸留住手作的温度。' }),
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 10
  },
  {
    id: 'frame-warm-thin', name: '暖黄细边',
    description: '暖黄细外框配米白卡纸。几乎只是一圈线，把舞台完全留给作品。',
    spec: styleSpec('warm-yellow', { outerWidthRatio: 0.014, mat: '#F3EDE2', matWidthRatio: 0.08, plaqueBg: '#3E3A33', plaqueText: '#FBF8F2', atmosphere: '一圈细暖黄，像给画描了一根亮边。', rationale: '细边不抢画面，暖黄呼应儿童作品里常见的黄。' }),
    plaqueStudent: '', plaqueTitle: '', enabled: true, builtin: true, scope: 'platform', ownerKey: '', sortOrder: 11
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
 * 「恢复内置样式库」：把缺的内置样式补回列表，**排在最后**。
 * 为什么不是插回原来的位置：列表顺序是管理员维护的（可以上移 / 下移），恢复一套被删掉的样式
 * 不该把它插回中间、把管理员排好的顺序打乱 —— 补回来的排最后，管理员想挪再用上下移。
 */
export function restoreMissingBuiltinFramingPresets(presets) {
  const list = Array.isArray(presets) ? presets : [];
  const missing = missingBuiltinFramingPresets(list);
  if (!missing.length) return list;
  const maxOrder = list.reduce((max, item) => Math.max(max, Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : 0), 0);
  return [...list, ...missing.map((item, index) => ({ ...item, sortOrder: maxOrder + (index + 1) * 10 }))];
}

/**
 * 把「本地/云端里没有的内置样式」补进列表（按 id 比较，保持原顺序、内置的排在后面）。
 *
 * 为什么需要它：内置样式库是随版本长出来的（US-006 从 4 套扩到 11 套），而
 * `loadFramingPresets()` 一旦读到 localStorage 里的旧列表就直接返回 —— 老用户的列表里
 * 永远不会有新内置样式，「内置不少于 8 套」在真机上就不成立。
 *
 * US-011b 起多了一个反向要求：**内置样式库可增删改**，管理员在后台删掉的内置样式
 * 不能在下一次进入时又冒回来。判据是「写入这份镜像时内置样式库有哪些 id」
 * （`knownBuiltinIds`，由 `persistFramingPresets` 落下来）：
 *   - 缺失且在 `knownBuiltinIds` 里 → 管理员删掉的，**不补**；
 *   - 缺失且不在 `knownBuiltinIds` 里 → 版本升级新增的内置样式，补进来；
 *   - 没有 `knownBuiltinIds`（v1 裸数组镜像 / 没传）→ 按老行为全补（老用户见得到新内置样式）。
 * 「恢复内置样式库」这个动作就是不带 `knownBuiltinIds` 调它。
 */
export function mergeBuiltinFramingPresets(presets, { knownBuiltinIds = null } = {}) {
  const list = Array.isArray(presets) ? presets : [];
  const known = Array.isArray(knownBuiltinIds) ? new Set(knownBuiltinIds.map(String)) : null;
  const missing = missingBuiltinFramingPresets(list).filter(item => !known || !known.has(String(item.id)));
  return missing.length ? [...list, ...missing] : list;
}

/**
 * 补齐「本机镜像里还没有的模板」：**同一条模板以本机镜像为准**，只把云端里
 * 本机没有的 id 追加在后面（多设备 / 后台直接写库产出的模板仍然能读进来）。
 *
 * 为什么方向是「本机优先」（US-011b 起，之前是云端优先）：
 * 云端 `framing_presets` 表还没有 `scope` / `owner_key` 以及 US-011b 的
 * `is_default` / `bound_course_types` / `updated_by` 这些列，任何一条带新列的 row 会被
 * PostgREST **整条拒掉**（实测 400 `DATABASE_PGRST204`）—— 也就是说模板的写入目前
 * **只在本机镜像里真正落地**，云端那 4 条还是 2026-10-09 的旧记录（v1 平面 spec）。
 * 若继续让云端优先，管理员刚设好的「默认模板 / 课程绑定 / 启停 / 排序」会在下一次进入时
 * 被旧记录顶掉（本故事的验收在真机上就不成立）。等云表补上这些列、写入能成功后，
 * 再把方向翻回云端优先即可（改这一处就够了）。
 */
export function mergeRemoteFramingPresets(remote, fallback) {
  const list = (Array.isArray(fallback) ? fallback : []).filter(item => item && item.id);
  const ids = new Set(list.map(item => String(item.id)));
  const builtinIds = new Set(seedFramingPresets.map(item => String(item.id)));
  const extras = (Array.isArray(remote) ? remote : []).filter(item => {
    if (!item || !item.id || ids.has(String(item.id))) return false;
    // 本机镜像里没有的**内置样式**（且这次读出来的镜像里也没有它）：那是管理员在后台删掉的
    // （US-011b 允许删内置样式），或者还没被 `mergeBuiltinFramingPresets` 补进来 ——
    // 两种都不该被云端里的旧记录「复活」。（云端那 4 条旧记录正是这个形状。）
    return !builtinIds.has(String(item.id));
  });
  return extras.length ? [...list, ...extras] : list;
}

/**
 * 本地镜像里的「内置样式库快照」另存一条**独立的键**（`xinlehui-framing-presets-meta-v1`）。
 *
 * 为什么不塞进主键里：`xinlehui-framing-presets-v1` 一直是**裸数组**，很多地方（验证脚本、
 * 其它读本机镜像的代码）直接 `JSON.parse(...).find(...)`。把它改成 `{presets, ...}` 结构
 * 会静默打断这些读取方。主键的形状保持不变，附属元数据放这条兄弟键里。
 */
const STORE_META_KEY = 'xinlehui-framing-presets-meta-v1';

/** 读本地镜像（模板列表 + 写入时内置样式库的 id 快照）。读坏数据安全降级为内置样式库。 */
export function loadFramingPresetStore() {
  if (typeof window === 'undefined') return { presets: seedFramingPresets, knownBuiltinIds: null };
  const saved = safeParse(window.localStorage.getItem(STORAGE_KEY), null);
  const meta = safeParse(window.localStorage.getItem(STORE_META_KEY), null);
  const known = Array.isArray(meta?.knownBuiltinIds) ? meta.knownBuiltinIds.map(String) : null;
  if (!Array.isArray(saved) || !saved.length) return { presets: seedFramingPresets, knownBuiltinIds: known };
  return { presets: mergeBuiltinFramingPresets(saved, { knownBuiltinIds: known }), knownBuiltinIds: known };
}

export function loadFramingPresets() {
  return loadFramingPresetStore().presets;
}

export function persistFramingPresets(presets) {
  if (typeof window === 'undefined') return;
  try {
    // 主键保持裸数组（外部读取方的既有假设不变）。
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    // 「写这份镜像时内置样式库有哪些 id」：加载时用它区分「管理员删掉的」（不补回来）
    // 与「版本升级新增的」（补进来）。见 mergeBuiltinFramingPresets 的注释。
    window.localStorage.setItem(STORE_META_KEY, JSON.stringify({ version: 2, knownBuiltinIds: seedFramingPresets.map(item => item.id) }));
  } catch { /* 配额满时静默降级 */ }
}

// ---------------------------------------------------------------------------
// 我的模板（老师端「另存为我的模板」/ 重命名 / 删除，[第二步 US-009]）
//
// 三条口径写清楚，免得后人改坏：
//   1. **保存下来的是一份 spec，不是「当前选用」的一层补丁**。来源是 `frameSpecRenderView()`
//      给出的渲染视图（= 渲染层真正读到的那几个字段），所以「老师看到的样子」与「存下来的样子」
//      由同一条路径保证一致，且**结构上不可能带上对单幅作品的编辑**（artworkEdit：旋转 / 裁剪 / 缩放）。
//      展签日期也一样：渲染视图里只有**格式**（`plaqueDateFormat`），没有日期值。
//   2. **只有本人写、本人删**：`framePresetEditableBy` 是界面与（将来）接口共用的写权限判据，
//      平台与机构模板在老师端不显示编辑入口，也不接受写入。
//   3. 删除**只影响可选列表**：成品图是保存 / 归档时写下的独立副本（作品位与档案记录各一份），
//      模板没了不会改动任何已经产出的图。
// ---------------------------------------------------------------------------

/** 保存为模板时 spec 里**保留**的分组：相框 / 卡纸 / 展签 / 水印 / 落款 / 时间。 */
export const FRAMING_PRESET_SPEC_GROUPS = ['frame', 'mat', 'plaque', 'watermark', 'signature', 'date'];

/** 分组的中文名（保存成功的回执、面板摘要与断言都读它，别在界面里另写一份）。 */
export const FRAMING_PRESET_GROUP_LABELS = {
  canvas: '画布',
  frame: '相框',
  mat: '卡纸',
  plaque: '展签',
  watermark: '水印',
  signature: '落款',
  date: '时间',
  art: '作品编辑'
};

/**
 * 明确**不进模板**的分组：`art` 是单幅作品的 artworkEdit（旋转 / 裁剪 / 缩放），
 * v1 平面结构里的同一意涵字段是 `artRotateDeg` —— 两者都不进模板（US-009 验收原文「不含 artworkEdit」）。
 * 保存路径走白名单构造（只复制上面的分组），这份清单用于文档与断言的自证。
 */
export const FRAMING_PRESET_UNSAVED_FIELDS = ['art', 'artRotateDeg'];

export const FRAMING_PRESET_NAME_MAX = 24;
export const FRAMING_PRESET_DESCRIPTION_MAX = 60;

/** 删除模板时的说明文案（删除不影响任何已经产出的成品图）。 */
export const FRAMING_PRESET_DELETE_NOTE = '删除只影响以后的可选列表；已经装裱、保存或归档过的成品图不会被改动。';

const plainObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const cloneValue = (value) => JSON.parse(JSON.stringify(value));

/** 模板名归一化：去首尾空格、把连续空白压成一个空格、截到上限；空值用 `fallback`。 */
export function normalizeFramingPresetName(value, fallback = '') {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (raw || String(fallback ?? '').trim()).slice(0, FRAMING_PRESET_NAME_MAX);
}

/**
 * 模板名的问题（空名 / 重名）→ 可读文案；没问题返回空串。
 * 重名在**同一份列表内**判断（老师端这份列表就是「平台 + 本机构 + 我的」可见集合），
 * 让老师不必靠「哪个是我的 XX 展」来分辨两套同名模板。重命名时用 `exceptId` 排除自己。
 */
export function framingPresetNameIssue(name, presets, { exceptId = '' } = {}) {
  const clean = normalizeFramingPresetName(name);
  if (!clean) return '请填写模板名';
  const clash = (Array.isArray(presets) ? presets : []).some(item => item && item.id !== exceptId
    && normalizeFramingPresetName(item.name) === clean);
  return clash ? `已有名为「${clean}」的模板，请换个名字` : '';
}

/**
 * 从**渲染视图**（`services/frameSpec.js` 的 `frameSpecRenderView` 输出）构造一份可保存的 v2 spec。
 *
 * 为什么以渲染视图为输入：那是「渲染层真正读到的那一份」（形状 / 光影 / 卡纸开关 / 五支叠加元素的
 * 收敛后取值），于是「另存为我的模板」存下来的就是老师此刻看到的效果，且白名单构造**结构上**排除了
 * artworkEdit（渲染视图里根本没有 art 分组）。缺失的分组由 `normalizeFrameSpecV2` 补默认值。
 */
export function framePresetSpecFromRenderView(view) {
  const source = plainObject(view);
  const overlays = plainObject(source.overlays);
  const hasOverlays = Object.keys(overlays).length > 0;
  const frame = {
    shape: source.shape || 'square',
    color: source.outer,
    widthRatio: source.outerWidthRatio,
    cornerRadiusRatio: Number.isFinite(Number(source.cornerRadiusRatio)) ? Number(source.cornerRadiusRatio) : 0,
    texture: 'solid'
  };
  // 光影**只在渲染视图显式给出时**才写进模板：缺失 = 不画光影（v1 老模板的行为）。
  // 补一份默认光影会让「以老模板为基础另存」凭空多出一层体积感，那就不是「保存我看到的样式」了。
  if (Object.keys(plainObject(source.lighting)).length) frame.lighting = { ...plainObject(source.lighting) };
  const group = (name) => cloneValue(plainObject(overlays[name]));
  return {
    version: 2,
    frame,
    mat: {
      visible: source.matVisible !== false,
      color: source.mat,
      widthRatio: source.matWidthRatio,
      innerLine: source.innerLine ?? null
    },
    plaque: {
      visible: true,
      bg: source.plaqueBg,
      text: source.plaqueText,
      fontFamily: source.plaqueFontFamily,
      letterSpacing: source.plaqueLetterSpacing,
      position: 'bottom',
      // 展签日期的**格式**跟着渲染视图存下来（US-014）：日期值不存进模板 ——
      // 它永远取本次课次日期（`lesson.lessonDate`）。
      dateFormat: source.plaqueDateFormat
    },
    // 水印 / 落款 / 时间三组**总是写进模板**（验收原文点名了这三项）。渲染视图里没有它们时
    // （v1 老模板不画任何叠加元素）写一份 `visible: false` 的最小占位 —— 「整组缺省」与
    // `visible: false` 在绘制层是逐像素一致的两条路径（US-003a 已证），模板的样子不会变。
    watermark: hasOverlays
      ? (Object.keys(group('watermark')).length ? group('watermark') : { logo: { visible: false }, text: { visible: false }, qr: { visible: false } })
      : { logo: { visible: false }, text: { visible: false }, qr: { visible: false } },
    signature: hasOverlays
      ? (Object.keys(group('signature')).length ? group('signature') : { visible: false })
      : { visible: false },
    date: hasOverlays
      ? (Object.keys(group('date')).length ? group('date') : { visible: false })
      : { visible: false },
    atmosphere: String(source.atmosphere ?? '').slice(0, 120),
    rationale: String(source.rationale ?? '').slice(0, 120)
  };
}

/** 这份 spec 里带了哪几组（保存成功的回执文案；顺序与 FRAMING_PRESET_SPEC_GROUPS 一致）。 */
export function framePresetSpecGroupLabels(spec) {
  const source = plainObject(spec);
  return FRAMING_PRESET_SPEC_GROUPS
    .filter(key => Object.keys(plainObject(source[key])).length > 0)
    .map(key => FRAMING_PRESET_GROUP_LABELS[key] || key);
}

/** 列表里「能由这位观察者改写」的模板（老师端 = 自己的个人模板；管理端 = 全部）。 */
export function framePresetEditableBy(preset, viewer = {}) {
  const item = normalizeFramingPreset(preset);
  if (viewer.role === 'admin' || viewer.manageAllScopes === true) return true;
  // 系统（平台）与机构模板由管理员维护：老师端既不显示编辑入口，也不接受写入。
  if (item.scope !== 'teacher') return false;
  return Boolean(item.ownerKey) && teacherIdentityKeys(viewer).includes(item.ownerKey);
}

/** 可编辑的模板列表（界面只给它渲染编辑入口）。 */
export function editableFramingPresets(presets, viewer = {}) {
  return (Array.isArray(presets) ? presets : []).filter(item => framePresetEditableBy(item, viewer));
}

/** 层级徽标：平台 / 机构 / 我的（`我的` 就是个人模板的标记）。 */
export function framePresetScopeLabel(preset) {
  return FRAMING_PRESET_SCOPE_LABELS[normalizeFrameScope(preset?.scope)] || FRAMING_PRESET_SCOPE_LABELS.platform;
}

/**
 * 「另存为我的模板」：把当前样式存成一套**个人模板**。
 * ownerKey 取观察者身份串（老师姓名优先）—— 缺了 ownerKey 的个人模板对谁都不可见（fail-safe），
 * 所以这里必须落下来；id 仍用随机唯一值（`preset_key` 是 upsert 冲突键，不能由自然键派生）。
 */
export function buildTeacherFramingPreset({ name, description = '', spec = null, viewer = {}, sortOrder } = {}) {
  const now = Date.now();
  const ownerKey = String(viewer.teacherName || viewer.teacherId || teacherIdentityKeys(viewer)[0] || '');
  return {
    id: `frame-teacher-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: normalizeFramingPresetName(name, '我的装裱'),
    description: String(description ?? '').replace(/\s+/g, ' ').trim().slice(0, FRAMING_PRESET_DESCRIPTION_MAX),
    spec,
    plaqueStudent: '',
    plaqueTitle: '',
    enabled: true,
    builtin: false,
    scope: 'teacher',
    ownerKey,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 90,
    // 新建即留下第一条变更记录（US-011b：更新人与变更历史从建立那一刻就有）。
    isDefault: false,
    boundCourseTypes: [],
    updatedBy: ownerKey,
    updatedAt: new Date(now).toISOString(),
    history: [{ at: new Date(now).toISOString(), by: ownerKey, action: '另存为我的模板', detail: '' }]
  };
}

/** 重命名：只改名字，模板 id 与 spec 一个字段都不动（历史成品图引用的就是这份 spec）。 */
export function renameFramingPreset(preset, name) {
  const item = normalizeFramingPreset(preset);
  return { ...item, name: normalizeFramingPresetName(name, normalizeFramingPresetName(item.name, '我的装裱')) };
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
    plaqueTitle: '',
    enabled: true,
    builtin: false,
    scope,
    ownerKey: scope === 'platform' ? '' : String(options.ownerKey || ''),
    sortOrder: 90,
    isDefault: false,
    boundCourseTypes: [],
    updatedBy: String(options.by || ''),
    updatedAt: new Date(now).toISOString(),
    history: [{ at: new Date(now).toISOString(), by: String(options.by || ''), action: '新建模板', detail: '' }]
  };
}

// ---------------------------------------------------------------------------
// 默认模板 · 按课程绑定 · 引用范围 · 变更历史（[第二步 US-011b] / PRD US-011）
//
// 这四件事都是**模板自己的字段**（云表 framing_presets 对应
// `is_default` / `bound_course_types` / `updated_by` + `updated_at`，见 PRD 的数据模型一节）：
//   · `isDefault`      —— 同一时间只有一套默认模板；老师端没命中课程绑定时就用它；
//   · `boundCourseTypes` —— 课程（id 或课程名）→ 这套模板；未绑定的课程回落默认模板；
//   · `updatedBy/updatedAt/history` —— 谁在什么时候改了什么（变更历史可查）。
//
// 写入口径只有一条：**任何变更都过 `stampFramingPresetUpdate`**（它同时更新 updatedBy /
// updatedAt 并往 history 追加一条）。界面里手改这几个字段必然漂移 —— 别这么干。
// ---------------------------------------------------------------------------

/** 变更历史最多留多少条（超出丢最旧的；成品图另存副本，历史只服务于「谁改了什么」）。 */
export const FRAMING_PRESET_HISTORY_LIMIT = 20;

/** 「默认模板」的说明（界面与断言共用一份文案）。 */
export const FRAMING_PRESET_DEFAULT_NOTE = '默认模板：老师端没命中课程绑定（或那门课没绑）时就用它，同一时间只能有一套。';
/** 「按课程绑定」的说明。 */
export const FRAMING_PRESET_COURSE_BINDING_NOTE = '按课程绑定：老师为这门课进入智能装裱时会默认选中它；未绑定的课程用默认模板。';
/** 变更历史为空时的文案。 */
export const FRAMING_PRESET_HISTORY_EMPTY = '还没有变更记录：这套模板从建立以来没有被改动过。';
/** 变更历史里「改了什么」的字段名（保存回执与历史行都读它）。 */
export const FRAMING_PRESET_FIELD_LABELS = {
  name: '名称',
  description: '描述',
  enabled: '启停',
  spec: '装裱参数',
  plaqueStudent: '展签人名',
  plaqueTitle: '作品名',
  sortOrder: '排序',
  boundCourseTypes: '课程绑定',
  isDefault: '默认标记'
};

/** 课程绑定归一化：去空、去重、保持原顺序（课程 id 或课程名都收，两种都能命中）。 */
export function normalizeCourseBindings(value) {
  const list = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
  const seen = new Set();
  const out = [];
  list.forEach(item => {
    const key = String(item ?? '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

/** 模板的变更记录（读脏数据返回空数组）。 */
export function normalizeFramingPresetHistory(value) {
  return (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object').map(item => ({
    at: String(item.at || ''),
    by: String(item.by || ''),
    action: String(item.action || ''),
    detail: String(item.detail || '')
  }));
}

/** 「几点几分」的可读文案（认不出的时间返回空串，不编造）。 */
export function framingPresetTimeText(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (input) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 一条变更记录的可读文案：`2026-10-11 21:30 · 平台管理员 · 设为默认模板`。 */
export function framingPresetHistoryText(entry) {
  const item = entry && typeof entry === 'object' ? entry : {};
  const head = [framingPresetTimeText(item.at), String(item.by || '')].filter(Boolean).join(' · ');
  const tail = [String(item.action || '更新模板'), item.detail ? `（${item.detail}）` : ''].join('');
  return head ? `${head} · ${tail}` : tail;
}

/** 模板的变更历史（最新的在前）。 */
export function framingPresetHistory(preset) {
  const item = preset && typeof preset === 'object' ? preset : {};
  return normalizeFramingPresetHistory(item.history).slice().reverse();
}

/** 最后变更的可读文案：`平台管理员 · 2026-10-11 21:30`；没有记录返回空串。 */
export function framingPresetUpdateText(preset) {
  const item = normalizeFramingPreset(preset);
  return [item.updatedBy, framingPresetTimeText(item.updatedAt)].filter(Boolean).join(' · ');
}

/**
 * 记一次变更：返回**新的**模板对象 ——`updatedBy / updatedAt` 更新为这一次变更，
 * `history` 追加一条（超出上限丢最旧的）。这是 updated_at / updated_by / 变更历史
 * 的唯一写入口：界面里别自己改这四个字段。
 */
export function stampFramingPresetUpdate(preset, { by = '', at = 0, action = '', detail = '' } = {}) {
  const item = normalizeFramingPreset(preset);
  const timestamp = Number.isFinite(Number(at)) && Number(at) > 0 ? Number(at) : Date.now();
  const iso = new Date(timestamp).toISOString();
  const entry = { at: iso, by: String(by || '').trim(), action: String(action || '').trim() || '更新模板', detail: String(detail || '').trim() };
  return {
    ...item,
    updatedBy: entry.by,
    updatedAt: iso,
    history: [...item.history, entry].slice(-FRAMING_PRESET_HISTORY_LIMIT)
  };
}

/**
 * 两次保存之间「改了什么」→ 可读清单（保存回执与变更历史读它，别在界面里再比一遍）。
 * 只比对模板自己的字段；`updatedBy/updatedAt/history` 不参与（它们就是变更记录本身）。
 */
export function framingPresetChangeSummary(previous, next) {
  const before = previous && typeof previous === 'object' ? previous : {};
  const after = next && typeof next === 'object' ? next : {};
  return Object.keys(FRAMING_PRESET_FIELD_LABELS).filter(key => {
    const a = before[key];
    const b = after[key];
    if (key === 'isDefault') return (a === true) !== (b === true);
    if (key === 'boundCourseTypes') return normalizeCourseBindings(a).join('|') !== normalizeCourseBindings(b).join('|');
    if (a === null || a === undefined || b === null || b === undefined) return (a ?? '') !== (b ?? '');
    if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) !== JSON.stringify(b);
    return a !== b;
  }).map(key => FRAMING_PRESET_FIELD_LABELS[key]);
}

/** 可供老师端选用的模板：启用中 + 按 sortOrder 排好（顺序就是老师看到的顺序）。 */
export function selectableFramingPresets(presets) {
  return sortFramingPresets(presets).filter(item => item && item.enabled !== false);
}

/** 当前的默认模板（启用中才算数：停用的默认模板等于没有默认）。 */
export function defaultFramingPreset(presets) {
  return selectableFramingPresets(presets).find(item => item.isDefault === true) || null;
}

/**
 * 老师端「这门课该用哪一套」的唯一真源（三级回落）：
 *   ① 启用中、且 `boundCourseTypes` 命中这门课（课程 id 或课程名）的模板 —— `source: 'course'`；
 *   ② 否则用默认模板（`isDefault === true` 且启用中）—— `source: 'default'`；
 *   ③ 都没有时用排序里的第一套 —— `source: 'first'`（与 US-006 的行为一致）；
 *   ④ 一套可用的都没有 —— `source: 'empty'`，preset 为 null。
 * 绑定的模板被停用时**不算命中**（停用 = 老师端不再出现），回落默认模板，并把
 * `disabledBindingName` 带出去，让界面能说明「按课程绑定的那套已停用」。
 * 同一门课被多套模板绑定属于配置冲突：按排序取第一套（界面会提示冲突的那一套）。
 */
export function resolveFramingPresetForCourse(presets, { courseId = '', courseName = '' } = {}) {
  const list = selectableFramingPresets(presets);
  const keys = [courseId, courseName].map(value => String(value ?? '').trim()).filter(Boolean);
  const bound = keys.length
    ? list.find(item => normalizeCourseBindings(item.boundCourseTypes).some(key => keys.includes(key)))
    : null;
  if (bound) return { preset: bound, source: 'course', disabledBindingName: '' };
  const fallback = list.find(item => item.isDefault === true) || list[0] || null;
  const disabledHit = keys.length
    ? (Array.isArray(presets) ? presets : []).find(item => item && item.enabled === false
      && normalizeCourseBindings(item.boundCourseTypes).some(key => keys.includes(key)))
    : null;
  return {
    preset: fallback,
    source: fallback ? (fallback.isDefault === true ? 'default' : 'first') : 'empty',
    // 按课程绑定的那一套被停用时要能说明原因（停用 = 老师端不再出现，因此不算命中）。
    disabledBindingName: disabledHit ? String(disabledHit.name || '') : ''
  };
}

/** 老师端「为什么默认选中这一套」的一句说明（面板提示条与断言共用）。 */
export function framingPresetResolveText(resolution) {
  const item = resolution && typeof resolution === 'object' ? resolution : {};
  const name = item.preset?.name || '';
  // 绑定的那套被停用：先说清楚「按课程绑定的已停用」，再说现在用的是哪一套。
  if (item.disabledBindingName) {
    return name
      ? `按课程绑定的是「${item.disabledBindingName}」，但它已停用，改用「${name}」`
      : `按课程绑定的是「${item.disabledBindingName}」，但它已停用`;
  }
  if (item.source === 'course') return `本课程已绑定「${name}」，进入智能装裱时默认选中它`;
  if (item.source === 'default') return `默认模板「${name}」已默认选中`;
  return '';
}

/**
 * 设为默认模板（传空 id = 取消默认）。返回**新的列表**：
 * 命中的那套 `isDefault: true` 并记一条变更，原默认模板取消标记并各记一条 ——
 * 「谁是默认」这件事在列表内是唯一的（读的一侧也只会取第一套）。
 */
export function setDefaultFramingPreset(presets, id, { by = '', at = 0 } = {}) {
  const target = String(id ?? '');
  return (Array.isArray(presets) ? presets : []).map(item => {
    const next = { ...item, isDefault: Boolean(target) && String(item.id) === target };
    if (item.isDefault === true && !next.isDefault) return stampFramingPresetUpdate(next, { by, at, action: '取消默认模板' });
    if (next.isDefault && item.isDefault !== true) return stampFramingPresetUpdate(next, { by, at, action: '设为默认模板' });
    return next;
  });
}

/** 绑定 / 解绑一门课程（`courseId` 可以是课程 id 或课程名）。返回**新的模板对象**。 */
export function bindFramingPresetCourse(preset, courseId, bound = true, { by = '', at = 0, detail = '' } = {}) {
  const item = normalizeFramingPreset(preset);
  const key = String(courseId ?? '').trim();
  if (!key) return item;
  const current = item.boundCourseTypes;
  const next = normalizeCourseBindings(bound ? [...current, key] : current.filter(entry => entry !== key));
  if (next.length === current.length) return item;
  return stampFramingPresetUpdate({ ...item, boundCourseTypes: next }, {
    by,
    at,
    action: bound ? '绑定课程' : '解绑课程',
    detail: detail || key
  });
}

/** 同一门课被多套模板绑定时的冲突清单（不含自己）——界面提示用。 */
export function framingPresetCourseConflicts(presets, courseId, { exceptId = '' } = {}) {
  const key = String(courseId ?? '').trim();
  if (!key) return [];
  return (Array.isArray(presets) ? presets : []).filter(item => item && item.enabled !== false
    && String(item.id) !== String(exceptId) && normalizeCourseBindings(item.boundCourseTypes).includes(key));
}

/**
 * 调整排序（`delta` 为 -1 上移 / +1 下移）。返回**新的列表**：整份列表按新顺序重排 sortOrder
 * （1..n × 10），只有被移动的那一套进变更历史 —— 其余只是让位，序号被动重排。
 */
export function moveFramingPreset(presets, id, delta, { by = '', at = 0 } = {}) {
  const list = sortFramingPresets(presets);
  const index = list.findIndex(item => String(item.id) === String(id));
  const step = Number(delta) > 0 ? 1 : Number(delta) < 0 ? -1 : 0;
  const target = index + step;
  if (!step || index < 0 || target < 0 || target >= list.length) return list;
  const moved = [...list];
  const [item] = moved.splice(index, 1);
  moved.splice(target, 0, item);
  return moved.map((entry, position) => {
    const sortOrder = (position + 1) * 10;
    if (Number(entry.sortOrder) === sortOrder) return entry;
    return String(entry.id) === String(item.id)
      ? stampFramingPresetUpdate({ ...entry, sortOrder }, { by, at, action: '调整排序', detail: `第 ${position + 1} 位` })
      : { ...entry, sortOrder };
  });
}

/**
 * 一套模板的引用范围（删除前的提示与「只允许停用」的判据都读它）：
 *   · `isDefault` —— 是不是当前的默认模板（老师端没有绑定课程时都会用它）；
 *   · `boundCourses` —— 被哪几门课程绑定；
 *   · `archivedCount` —— 有多少条**已归档的成品图**是按它生成的（写回记录里的 `presetId`）。
 * `referenced` 为真 = 有老师在用 / 有历史成品引用，按 PRD 只允许停用、不允许删除。
 */
export function framingPresetUsage(preset, { presets = [], records = [] } = {}) {
  const item = normalizeFramingPreset(preset);
  const id = String(item.id || '');
  const boundCourses = item.boundCourseTypes;
  const archivedCount = id
    ? (Array.isArray(records) ? records : []).filter(record => String(record?.framedArtwork?.presetId || '') === id).length
    : 0;
  const reasons = [];
  if (item.isDefault === true) reasons.push('当前是默认模板');
  if (boundCourses.length) reasons.push(`被 ${boundCourses.length} 门课程绑定`);
  if (archivedCount) reasons.push(`有 ${archivedCount} 条历史成品图按它生成`);
  return {
    id,
    name: String(item.name || ''),
    builtin: item.builtin === true,
    isDefault: item.isDefault === true,
    boundCourses,
    boundCourseCount: boundCourses.length,
    archivedCount,
    referenced: reasons.length > 0,
    reasons
  };
}

/** 引用范围的一句话（面板上就显示这句；没有引用时也要明确说「没有」）。 */
export function framingPresetUsageText(preset, usage) {
  const info = usage || framingPresetUsage(preset);
  if (!info.referenced) return '引用范围：不是默认模板、没有课程绑定、也没有按它生成的历史成品图。';
  return `引用范围：${info.reasons.join('、')}。`;
}

/**
 * 删除判据（PRD：「删除模板前提示影响范围，被引用的模板只允许停用不允许删除」）。
 * 返回 `{ allowed, message }`：`message` 就是界面要显示的那句话（两种情况都带影响范围）。
 */
export function framingPresetDeleteVerdict(preset, usage) {
  const name = normalizeFramingPresetName(preset?.name, '未命名装裱');
  const info = usage || framingPresetUsage(preset);
  if (info.referenced) {
    return {
      allowed: false,
      message: `「${name}」${info.reasons.join('、')}，被引用的模板只能停用、不能删除。停用后老师端不再出现，已经产出的成品图不受影响。`
    };
  }
  const builtinNote = info.builtin ? '它是内置样式，删掉后可以用「恢复内置样式库」加回来。' : '';
  return {
    allowed: true,
    message: `「${name}」${framingPresetUsageText(preset, info)}${builtinNote}${FRAMING_PRESET_DELETE_NOTE}`
  };
}
