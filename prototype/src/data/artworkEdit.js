/**
 * 单幅作品的编辑状态 `artworkEdit`（US-004a「编辑器旋转与撤销重做」/ PRD FR-5、US-005 的撤销栈）。
 *
 * 与 `data/mediaValidation.js` / `data/intakePerformance.js` 同一套纪律：**零依赖纯函数 + 常量**，
 * 不 import 任何模块、不碰 DOM、不碰网络，可以直接用 Node 跑断言（见 prototype/AGENTS.md 的「验证技巧」）。
 * 浏览器侧只保留「必须有 canvas 才能做」的部分（把角度真的画出来）在 `services/artworkEditor.js`。
 *
 * 这里放四件事，每一件都只有一份真源：
 * 1. `artworkEdit` 的形状（`rotateDeg / crop / zoom / offsetX / offsetY`，FR-5）与归一化 —— 脏数据永不抛错；
 * 2. 旋转角度的算法：90° 粗旋转 + 任意角度微调（±15°、步进 0.5°，US-004a 验收）；
 * 3. 撤销 / 重做的历史栈（验收要求「至少 20 步」，上限 `ARTWORK_EDIT_HISTORY_LIMIT` = 40 步）；
 * 4. 界面用的可读文案（`rotationSummary` / `describeArtworkEdit`）。
 *
 * 铁律：编辑结果只写进这一个对象，**原图 `originalUrl` 全程只读**（FR-5 / FR-30），
 * 也不进装裱模板（模板是 `spec`，那是 `frameSpec.js` 的事，两者互不覆盖）。
 */

/** 编辑状态的结构版本。改结构时 +1（与 frameSpec 的 version 同一套用法）。 */
export const ARTWORK_EDIT_VERSION = 1;

/** 90° 粗旋转的步进：左旋 / 右旋各一步。 */
export const ROTATE_STEP_DEG = 90;

/** 任意角度微调：范围 ±15°、步进 0.5°（US-004a 验收原文）。 */
export const FINE_ROTATION_RANGE = { min: -15, max: 15, step: 0.5 };

/** 微调按钮一步的度数。 */
export const FINE_ROTATION_STEP = FINE_ROTATION_RANGE.step;

/** 撤销栈上限：验收要求「至少 20 步」，这里留 40 步余量（limit 指最多可撤销多少步）。 */
export const ARTWORK_EDIT_HISTORY_LIMIT = 40;

/** 编辑态实时预览的长边上限：低分辨率画布先保证跟手，高清图在确认编辑时才合成。 */
export const EDIT_PREVIEW_MAX_EDGE = 900;

/** 缩放范围（US-004c 的 0.5×–5×）与平移范围，先落成常量给下游故事复用，收敛在这里一处。 */
export const ARTWORK_ZOOM_RANGE = { min: 0.5, max: 5 };
export const ARTWORK_OFFSET_RANGE = { min: -1, max: 1 };

/** `artworkEdit` 的字段清单：构造与归一化的唯一真源（界面只读这些字段）。 */
export const ARTWORK_EDIT_FIELDS = ['version', 'rotateDeg', 'crop', 'zoom', 'offsetX', 'offsetY'];

const clampNumber = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** 认不出的值（NaN / 字符串 / null / 缺省）一律按 0° 处理，不抛错。 */
function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 消掉 `-0`：`-0 === 0` 但 `Object.is(-0,0)` 为假，断言与缓存键都会因此漂移。 */
function trimZero(value) {
  return value === 0 ? 0 : value;
}

/** 角度归一化到 `[0, 360)`。 */
export function normalizeRotationDeg(value) {
  const number = finiteOr(value, 0);
  return trimZero(((number % 360) + 360) % 360);
}

/** 把角度量化到 0.5° 的整数倍（微调的步进），并消掉 `-0`。 */
export function quantizeRotationDeg(value) {
  const number = finiteOr(value, 0);
  return trimZero(Math.round((number / FINE_ROTATION_STEP)) * FINE_ROTATION_STEP);
}

/** 距离最近的 90° 整角（粗旋转的基准），结果 ∈ {0, 90, 180, 270}。 */
export function quarterBaseOf(value) {
  const normalized = normalizeRotationDeg(value);
  return normalizeRotationDeg(Math.round(normalized / ROTATE_STEP_DEG) * ROTATE_STEP_DEG);
}

/**
 * 相对最近 90° 整角的微调量，∈ [-45, 45]。
 * 之所以按「最近整角」而不是「向下取整」：换 90° 时微调量要跟着一起转过去，
 * 否则「右旋 90° + 微调 3°」会变成 273°（微调被吞进粗旋转里，界面上看不出为什么）。
 */
export function fineRotationOf(value) {
  const normalized = normalizeRotationDeg(value);
  const base = Math.round(normalized / ROTATE_STEP_DEG) * ROTATE_STEP_DEG;
  return trimZero(normalized - base);
}

function clampFineRotation(value) {
  return trimZero(clampNumber(quantizeRotationDeg(value), FINE_ROTATION_RANGE.min, FINE_ROTATION_RANGE.max));
}

/**
 * 裁剪矩形归一化：`{x, y, w, h}` 都是 0–1 的相对值（US-004b 写入，本故事先收敛好形状）。
 * 认不出来（缺值 / 非数字 / 宽高非正）一律 `null` = 未裁剪 —— 不要编造一个「看起来有裁剪」的框。
 */
export function normalizeCrop(crop) {
  if (!crop || typeof crop !== 'object') return null;
  const x = Number(crop.x);
  const y = Number(crop.y);
  const w = Number(crop.w);
  const h = Number(crop.h);
  if (![x, y, w, h].every((item) => Number.isFinite(item))) return null;
  if (w <= 0 || h <= 0) return null;
  const width = Math.min(1, w);
  const height = Math.min(1, h);
  return {
    x: trimZero(clampNumber(x, 0, 1 - width)),
    y: trimZero(clampNumber(y, 0, 1 - height)),
    w: trimZero(width),
    h: trimZero(height)
  };
}

/** 默认（未编辑）状态：不旋转、不裁剪、1× 缩放、居中。 */
export function createArtworkEdit(overrides = {}) {
  return normalizeArtworkEdit(overrides);
}

/**
 * 归一化编辑状态：脏数据永不抛错，非法值一律收敛到默认值。
 * 旧数据兼容：老实现把角度放在 `media.artwork.rotation`（90° 的倍数）上，
 * 所以 `rotateDeg / rotate / rotation` 三种写法都读，读不出来按 0°。
 */
export function normalizeArtworkEdit(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rotateValue = source.rotateDeg ?? source.rotate ?? source.rotation;
  return {
    version: ARTWORK_EDIT_VERSION,
    rotateDeg: quantizeRotationDeg(normalizeRotationDeg(rotateValue)),
    crop: normalizeCrop(source.crop),
    zoom: trimZero(clampNumber(finiteOr(source.zoom, 1), ARTWORK_ZOOM_RANGE.min, ARTWORK_ZOOM_RANGE.max)),
    offsetX: trimZero(clampNumber(finiteOr(source.offsetX, 0), ARTWORK_OFFSET_RANGE.min, ARTWORK_OFFSET_RANGE.max)),
    offsetY: trimZero(clampNumber(finiteOr(source.offsetY, 0), ARTWORK_OFFSET_RANGE.min, ARTWORK_OFFSET_RANGE.max))
  };
}

/** 左右旋转 90°：`turns` 正数右旋、负数左旋（一次一步），微调量原样保留。 */
export function rotateArtworkEdit(edit, turns = 1) {
  const current = normalizeArtworkEdit(edit);
  const steps = Number.isFinite(Number(turns)) ? Math.trunc(Number(turns)) : 1;
  return { ...current, rotateDeg: normalizeRotationDeg(current.rotateDeg + steps * ROTATE_STEP_DEG) };
}

/**
 * 任意角度微调一步：`deltaDeg` 按 0.5° 量化，微调量被收敛在 ±15° 之内。
 * 边界处「顶住不越界」而不是绕回（验收写的是范围 ±15°，越界就等于老师无法预期画面）。
 */
export function nudgeArtworkEditRotation(edit, deltaDeg = FINE_ROTATION_STEP) {
  const current = normalizeArtworkEdit(edit);
  const base = quarterBaseOf(current.rotateDeg);
  const fine = clampFineRotation(fineRotationOf(current.rotateDeg) + quantizeRotationDeg(finiteOr(deltaDeg, FINE_ROTATION_STEP)));
  return { ...current, rotateDeg: normalizeRotationDeg(base + fine) };
}

/** 这一步微调是否真的会改变角度（到 ±15° 边界后按钮置灰，而不是点了没反应）。 */
export function canNudgeArtworkEditRotation(edit, deltaDeg = FINE_ROTATION_STEP) {
  const current = normalizeArtworkEdit(edit);
  const step = quantizeRotationDeg(finiteOr(deltaDeg, 0));
  if (!step) return false;
  const fine = fineRotationOf(current.rotateDeg);
  return Math.abs(clampFineRotation(fine + step) - fine) > 1e-9;
}

/** 是不是「什么都没改」的默认态（重置 / 提示文案 / 是否值得提交都用它）。 */
export function artworkEditIsDefault(edit) {
  return artworkEditSnapshotKey(edit) === artworkEditSnapshotKey(createArtworkEdit());
}

/** 确定性快照键：进 React 依赖数组与缓存键。字段顺序由本模块固定，所以两次调用逐字符相同。 */
export function artworkEditSnapshotKey(edit) {
  const current = normalizeArtworkEdit(edit);
  return JSON.stringify(ARTWORK_EDIT_FIELDS.map((field) => [field, current[field]]));
}

/** 带符号的角度文案：`+3.5°` / `-2°` / `0°`。 */
export function formatRotationDeg(value) {
  const number = quantizeRotationDeg(value);
  return `${number > 0 ? '+' : ''}${number}°`;
}

/** 一行描述当前旋转：`右旋 90° · 微调 +3.5°`（无旋转时是「未旋转」）。 */
export function rotationSummary(edit) {
  const current = normalizeArtworkEdit(edit);
  const fine = fineRotationOf(current.rotateDeg);
  const turns = Math.round(quarterBaseOf(current.rotateDeg) / ROTATE_STEP_DEG) % 4;
  const parts = [];
  if (turns === 1) parts.push('右旋 90°');
  else if (turns === 2) parts.push('右旋 180°');
  else if (turns === 3) parts.push('左旋 90°');
  if (fine) parts.push(`微调 ${formatRotationDeg(fine)}`);
  return parts.length ? parts.join(' · ') : '未旋转';
}

/** 面板上的一句话全量描述：旋转 + 裁剪 + 缩放 + 平移。 */
export function describeArtworkEdit(edit) {
  const current = normalizeArtworkEdit(edit);
  const fine = fineRotationOf(current.rotateDeg);
  const crop = current.crop
    ? `已裁剪 ${Math.round(current.crop.w * 100)}%×${Math.round(current.crop.h * 100)}%`
    : '未裁剪';
  const center = current.offsetX || current.offsetY ? '已平移' : '居中';
  return `旋转 ${current.rotateDeg}°${fine ? `（${rotationSummary(current)}）` : ''}｜${crop}｜${current.zoom}× 缩放｜${center}`;
}

// ---- 撤销 / 重做（US-004a「至少 20 步」）------------------------------------------------
// 历史栈存**整份 artworkEdit 快照**（对象很小），所以「撤销」就是把某一版的 edit 原样拿回来，
// 不需要给每种操作写反操作 —— 裁剪 / 缩放（US-004b/c）接进来时天然一起被撤销。

/** 新建一个历史栈：`entries[0]` 是进入编辑时的状态，`index` 指向当前生效的那一版。 */
export function createArtworkEditHistory(seed, options = {}) {
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
    ? Math.trunc(Number(options.limit))
    : ARTWORK_EDIT_HISTORY_LIMIT;
  return {
    limit,
    index: 0,
    entries: [{ edit: normalizeArtworkEdit(seed), label: String(options.label || '开始编辑') }]
  };
}

/**
 * 这个对象是不是一个**已经归一化过**的历史栈。
 * 判据必须够严（字段齐全 + version 相符 + index 落在区间内），否则脏历史会被当成好的直接拿去用；
 * 同时它让 `normalizeArtworkEditHistory` 对合法输入**原样返回同一个对象** ——
 * 界面靠对象同一性判断「撤销到底有没有发生」（返回同一个对象 = 已经在边界上，按钮置灰）。
 */
export function isArtworkEditHistory(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries) || !raw.entries.length) return false;
  if (!Number.isFinite(Number(raw.limit)) || Number(raw.limit) <= 0) return false;
  if (!Number.isInteger(raw.index) || raw.index < 0 || raw.index >= raw.entries.length) return false;
  return raw.entries.every((entry) => entry
    && typeof entry === 'object'
    && entry.edit
    && typeof entry.edit === 'object'
    && entry.edit.version === ARTWORK_EDIT_VERSION
    && ARTWORK_EDIT_FIELDS.every((field) => field in entry.edit));
}

/** 把任意（可能被持久化/外部改坏的）历史栈收敛成可用的结构，认不出来就用 seed 重建。 */
export function normalizeArtworkEditHistory(raw, seed) {
  if (isArtworkEditHistory(raw)) return raw;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries) || !raw.entries.length) {
    return createArtworkEditHistory(seed);
  }
  const limit = Number.isFinite(Number(raw.limit)) && Number(raw.limit) > 0
    ? Math.trunc(Number(raw.limit))
    : ARTWORK_EDIT_HISTORY_LIMIT;
  const entries = raw.entries
    .filter((entry) => entry && typeof entry === 'object' && entry.edit)
    .map((entry) => ({ edit: normalizeArtworkEdit(entry.edit), label: String(entry.label || '编辑') }));
  if (!entries.length) return createArtworkEditHistory(seed);
  const index = clampNumber(Math.trunc(finiteOr(raw.index, entries.length - 1)), 0, entries.length - 1);
  return { limit, entries, index };
}

/**
 * 压入一步编辑：截断「重做」分支后追加，超出上限时丢掉最老的快照。
 * 与当前这一版**完全相同**的编辑不占一步（例如连点两次同一个按钮的边界态），
 * 否则撤销栈会被无变化的空步塞满，「撤销」按下去画面却不动。
 */
export function pushArtworkEditHistory(history, edit, label = '编辑') {
  const base = normalizeArtworkEditHistory(history, edit);
  const next = normalizeArtworkEdit(edit);
  const current = base.entries[base.index];
  if (current && artworkEditSnapshotKey(current.edit) === artworkEditSnapshotKey(next)) return base;
  const entries = base.entries.slice(0, base.index + 1);
  entries.push({ edit: next, label: String(label || '编辑') });
  while (entries.length > base.limit + 1) entries.shift();
  return { ...base, entries, index: entries.length - 1 };
}

/** 撤销一步：已经是最老那一版时原样返回同一个对象（界面据此把按钮置灰）。 */
export function undoArtworkEditHistory(history) {
  const base = normalizeArtworkEditHistory(history);
  if (base.index <= 0) return base;
  return { ...base, index: base.index - 1 };
}

/** 重做一步：已经在最新那一版时原样返回同一个对象。 */
export function redoArtworkEditHistory(history) {
  const base = normalizeArtworkEditHistory(history);
  if (base.index >= base.entries.length - 1) return base;
  return { ...base, index: base.index + 1 };
}

/** 当前生效的编辑状态。 */
export function currentArtworkEdit(history) {
  const base = normalizeArtworkEditHistory(history);
  return base.entries[base.index].edit;
}

/** 界面用的历史状态：可撤销 / 可重做几步、按钮文案、是否已经到上限。 */
export function artworkEditHistoryState(history) {
  const base = normalizeArtworkEditHistory(history);
  const undoSteps = base.index;
  const redoSteps = base.entries.length - 1 - base.index;
  return {
    limit: base.limit,
    index: base.index,
    total: base.entries.length,
    undoSteps,
    redoSteps,
    canUndo: undoSteps > 0,
    canRedo: redoSteps > 0,
    undoLabel: undoSteps > 0 ? base.entries[base.index].label : '',
    redoLabel: redoSteps > 0 ? base.entries[base.index + 1].label : '',
    atLimit: base.index + 1 >= base.limit
  };
}
