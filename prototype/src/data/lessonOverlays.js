// 水印 · 落款 · 时间面板（[第二步 US-007]）的规则层。
//
// 老师端第二步的这块面板做三件事，规则全部收在这一个文件里，界面只负责渲染：
//   1. **按课次上下文算默认值**：时间默认取本次课次日期（第一步的课次信息），落款默认取当前登录老师姓名；
//   2. **「本次选用」的一层补丁**：老师的调整叠在模板 spec 之上（`buildOverlayOverrides` /
//      `applyOverlayOverrides`），**不写回模板**（模板写权限是 US-031 的事），也不进草稿
//      （US-409 的草稿字段清单是硬约束）—— 与 US-006 的相框微调同一个口径；
//   3. **九宫格定位控件的拖动换算**：点击格子 = 定位，拖动 = 偏移微调（`overlayDragOffsets`）。
//
// 三条口径（写清楚免得后人改坏）：
//   - **没有改动时原样返回输入 spec**（连对象都不换）：老 v1 模板的渲染逐像素不变；
//   - 改动只写 `watermark` / `signature` / `date` 三个分组 + `version`，老 v1 平面字段一个都不动 ——
//     混写结构在 `normalizeFrameSpecV2` 里是合法输入（v2 分组优先、v1 平面字段兜底）；
//   - 数值的**最终收敛在 `normalizeFrameSpecV2`**（偏移 ±0.5、比例范围、颜色、字符串上限），
//     这里不抄第二份范围表：本模块只负责「哪些字段被改过」与补丁合并，值本身交给收敛器。
//
// 依赖说明（与 AGENTS.md 的「data 模块不 import services」纪律的唯一例外）：这里 import 的
// `services/overlayLayout.js` 自身**零依赖**（不 import 任何模块、不碰 cloud / DOM），
// 所以本模块仍然是零依赖、可直接 `node` 跑纯函数断言；位置枚举与标签的**真源**在它那里，
// 抄一份到 data 层才是真正会漂移的写法（沿 US-020 的口径）。

import {
  CUSTOM_ELEMENT_POSITION,
  ELEMENT_OFFSET_RANGE,
  ELEMENT_POSITIONS,
  SIGNATURE_MODES,
  SEAL_SHAPES,
  clampOverlayOffset,
  overlayPositionLabel,
  resolveElementAnchor
} from '../services/overlayLayout';

/** 叠加元素写回 spec 时带的版本号（与 `FRAME_SPEC_V2` 同一个值，这里不 import frameSpec 以免拖进 cloud）。 */
export const OVERLAY_SPEC_VERSION = 2;

/** 面板的三区（验收原文：水印（Logo / 文字 / 二维码）、落款（姓名 / 寄语 / 签名或印章）、时间（来源 / 格式 / 位置））。 */
export const OVERLAY_SECTIONS = [
  { id: 'watermark', label: '水印', hint: '机构 Logo / 文字水印 / 二维码' },
  { id: 'signature', label: '落款', hint: '姓名 / 寄语 / 签名图 / 印章' },
  { id: 'date', label: '时间', hint: '来源 / 格式 / 位置' }
];

/** 水印区里的三支（每支独立显隐、位置、偏移、尺寸）。 */
export const WATERMARK_KINDS = [
  { id: 'logo', label: '机构 Logo' },
  { id: 'text', label: '文字水印' },
  { id: 'qr', label: '二维码' }
];

/**
 * 老师端可改的字段白名单：结构上只有这些字段能被这块面板改动。
 * 白名单外的字段（脏数据 / 手写的 spec）一律丢弃，不抛错。
 */
export const OVERLAY_TWEAK_FIELDS = {
  watermark: {
    logo: ['visible', 'url', 'position', 'offsetX', 'offsetY', 'widthRatio', 'opacity'],
    text: ['visible', 'content', 'position', 'offsetX', 'offsetY', 'fontFamily', 'fontSize', 'color', 'opacity'],
    qr: ['visible', 'target', 'position', 'offsetX', 'offsetY', 'sizeRatio', 'caption']
  },
  signature: ['visible', 'mode', 'teacherName', 'message', 'imageUrl', 'imageWidthRatio', 'position', 'offsetX', 'offsetY', 'fontFamily', 'fontSize', 'color', 'seal'],
  date: ['visible', 'source', 'format', 'prefix', 'manualValue', 'position', 'offsetX', 'offsetY', 'fontSize', 'color']
};

/** 印章（落款的可选子元素）可改字段。 */
export const OVERLAY_SEAL_FIELDS = ['visible', 'text', 'color', 'shape'];

/**
 * 面板的「档」选项表：老师端不用懂参数（字号 / 尺寸 / 不透明度都是几档），
 * 值仍然按 spec 的口径写（字号 = 1800×1360 画布上的像素，比例 = 相对画布短边）。
 */
export const OVERLAY_FONT_SIZE_OPTIONS = [
  { id: 's', label: '小', value: 16 },
  { id: 'm', label: '中', value: 21 },
  { id: 'l', label: '大', value: 28 },
  { id: 'xl', label: '特大', value: 36 }
];

/** 尺寸档（Logo 宽度 / 二维码边长 / 签名图宽度共用；三档都落在收敛器的生效范围内）。 */
export const OVERLAY_ELEMENT_SIZE_OPTIONS = [
  { id: 's', label: '小', value: 0.06 },
  { id: 'm', label: '中', value: 0.1 },
  { id: 'l', label: '大', value: 0.16 }
];

export const OVERLAY_OPACITY_OPTIONS = [
  { id: 'solid', label: '实心', value: 1 },
  { id: 'soft', label: '柔和', value: 0.7 },
  { id: 'faint', label: '淡', value: 0.45 }
];

/** 文字颜色档（面板上是色板按钮，不用颜色选择器）：墨色 / 褐色 / 暖金 / 朱砂 / 浅灰。 */
export const OVERLAY_TEXT_COLORS = [
  { id: 'ink', label: '墨色', hex: '#2B271F' },
  { id: 'brown', label: '褐色', hex: '#6D6559' },
  { id: 'gold', label: '暖金', hex: '#8A6B1C' },
  { id: 'cinnabar', label: '朱砂', hex: '#B33A2B' },
  { id: 'grey', label: '浅灰', hex: '#8D8471' }
];

/** 落款形式（id 的真源是 overlayLayout 的 `SIGNATURE_MODES`，仅补中文名）。 */
const SIGNATURE_MODE_LABELS = { text: '文字落款', image: '签名图' };
export const OVERLAY_SIGNATURE_MODE_OPTIONS = SIGNATURE_MODES.map((id) => ({ id, label: SIGNATURE_MODE_LABELS[id] || id }));

/** 印章形状（id 的真源是 overlayLayout 的 `SEAL_SHAPES`）。 */
const SEAL_SHAPE_LABELS = { square: '方形', round: '圆形' };
export const OVERLAY_SEAL_SHAPE_OPTIONS = SEAL_SHAPES.map((id) => ({ id, label: SEAL_SHAPE_LABELS[id] || id }));

/** 偏移归零（「复位偏移」按钮与断言共用的一个值）。 */
export const OVERLAY_OFFSET_RESET = { offsetX: 0, offsetY: 0 };

/**
 * 拖动微调的换算口径：**拖过整块九宫格 = 偏移变化 0.3**（= 画布短边的 30%），
 * 所以拖一格（1/3 块）约 0.1 —— 既够精细（一格一格地挪），也不会拖半天不动。
 * `deadZone` 是回到中心附近的吸附：拖回中间会被吸成 0，不会留下「差一点点」的偏移。
 */
export const OVERLAY_DRAG = { rangePerPad: 0.3, deadZone: 0.02 };

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isPrimitive = (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
const round4 = (value) => Math.round(Number(value) * 10000) / 10000;

/** 位置文案（真源在 overlayLayout；非法位置按 bottom-right 的口径）。 */
export function overlayPositionText(position) {
  const key = ELEMENT_POSITIONS.includes(position) ? position : 'bottom-right';
  return overlayPositionLabel(key);
}

/** 位置是否在九宫格里（拖动微调后仍是九宫格之一；`custom` 只来自数据里的旧值）。 */
export function isGridPosition(position) {
  return ELEMENT_POSITIONS.includes(position) && position !== CUSTOM_ELEMENT_POSITION;
}

/** 比例 → 百分比文案（`0.1` → `10%`）。 */
export function overlayPercentText(ratio) {
  const n = Number(ratio);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

/** 单个偏移值 → 文案（`0` → `0`，`0.03` → `3%`，`-0.0325` → `-3%`）。 */
export function overlayOffsetText(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) < 0.0005) return '0';
  return `${Math.round(n * 100)}%`;
}

/** 一组偏移（element 或 `{offsetX,offsetY}`）→ 「左右 3% · 上下 12%」（都为零时是「未偏移」）。 */
export function overlayOffsetSummary(element) {
  const item = isPlainObject(element) ? element : {};
  const x = clampOverlayOffset(item.offsetX);
  const y = clampOverlayOffset(item.offsetY);
  if (Math.abs(x) < 0.0005 && Math.abs(y) < 0.0005) return '未偏移';
  return `左右 ${overlayOffsetText(x)} · 上下 ${overlayOffsetText(y)}`;
}

/** 偏移是否已归零（「复位偏移」按钮的 disabled 判据）。 */
export function overlayOffsetIsZero(element) {
  const item = isPlainObject(element) ? element : {};
  return Math.abs(clampOverlayOffset(item.offsetX)) < 0.0005 && Math.abs(clampOverlayOffset(item.offsetY)) < 0.0005;
}

/**
 * 拖动 → 偏移（九宫格上的「拖动可微调」）。
 *
 * `from` 是**按下那一刻**的偏移（拖动过程中用同一个基准 + 总位移算，不累积增量，
 * 所以指针来回移动不会漂）。`dirX / dirY` 来自 `resolveElementAnchor`（偏移正向朝画布内侧），
 * 于是「在格子里把元素往右拖」在成品图上也是往右移：贴右的格子 dirX = -1，偏移相应减小。
 * 没有有效边长（控件未挂载 / 宽度为 0）时原样返回基准偏移，绝不产出 NaN。
 */
export function overlayDragOffsets({ from, dx = 0, dy = 0, padWidth = 0, padHeight = 0, dirX = 1, dirY = 1 } = {}) {
  const start = isPlainObject(from) ? from : {};
  const axis = (value, delta, span, dir) => {
    const base = clampOverlayOffset(value);
    const size = Number(span);
    const distance = Number(delta);
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(distance)) return round4(base);
    const next = clampOverlayOffset(base + (distance / size) * OVERLAY_DRAG.rangePerPad * (dir < 0 ? -1 : 1));
    return round4(Math.abs(next) < OVERLAY_DRAG.deadZone ? 0 : next);
  };
  return {
    offsetX: axis(start.offsetX, dx, padWidth, dirX),
    offsetY: axis(start.offsetY, dy, padHeight, dirY)
  };
}

/** 拖动手势是否成立（超过 3px 才算拖动，避免「点一下」被当成拖动产生微小偏移）。 */
export const OVERLAY_DRAG_THRESHOLD_PX = 3;

export function overlayDragIsActive(dx, dy) {
  return Math.abs(Number(dx) || 0) > OVERLAY_DRAG_THRESHOLD_PX || Math.abs(Number(dy) || 0) > OVERLAY_DRAG_THRESHOLD_PX;
}

/** 某支叠加元素在拖动时用的方向（与定位层同一份 `resolveElementAnchor`）。 */
export function overlayElementDragDirection(position) {
  const anchor = resolveElementAnchor(position);
  return { dirX: anchor.dirX, dirY: anchor.dirY };
}

/** 偏移范围（面板文案用；真源仍是 overlayLayout 的 `ELEMENT_OFFSET_RANGE`）。 */
export const OVERLAY_OFFSET_RANGE_TEXT = `±${Math.round(ELEMENT_OFFSET_RANGE.max * 100)}%`;

/**
 * 「本次课次日期」在面板上的显示值：认得出的日期归一成 `YYYY.MM.DD`，认不出的**原样返回**
 * （不编造日期；与 `overlayDateText` / `formatLessonDateDots` 同一个口径）。
 */
export function overlayLessonDateValue(lessonDate) {
  const raw = String(lessonDate ?? '').trim();
  if (!raw) return '';
  const separated = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (separated) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${separated[1]}.${pad(separated[2])}.${pad(separated[3])}`;
  }
  return raw;
}

/** 落款默认值 = 当前登录老师姓名（没有身份时回落变量占位符 `{老师姓名}`）。 */
export function overlayDefaultSignatureName(teacherName) {
  const name = String(teacherName ?? '').trim();
  return name || '{老师姓名}';
}

// ---------------------------------------------------------------------------
// 微调（本次选用的补丁）
// ---------------------------------------------------------------------------

/** 一个叶子分组里有没有实际改动（空对象 = 没改过）。 */
const hasFields = (group) => isPlainObject(group) && Object.keys(group).length > 0;

/** 只保留白名单里的原始值（对象只放行 `seal` 这一层）。 */
function pickFields(source, fields) {
  const input = isPlainObject(source) ? source : {};
  const picked = {};
  for (const field of fields) {
    const value = input[field];
    if (field === 'seal') {
      const seal = isPlainObject(value) ? value : null;
      if (!seal) continue;
      const sealPicked = {};
      for (const key of OVERLAY_SEAL_FIELDS) {
        if (isPrimitive(seal[key])) sealPicked[key] = seal[key];
      }
      if (hasFields(sealPicked)) picked.seal = sealPicked;
      continue;
    }
    if (isPrimitive(value)) picked[field] = value;
  }
  return picked;
}

/**
 * 归一化「本次选用」的微调：只认识白名单里的字段，其余一律丢弃（脏数据不抛错）。
 * 结构与 spec 的分组一致（watermark 下再分 logo / text / qr），空对象表示「这一层没改过」。
 */
export function normalizeOverlayTweaks(raw) {
  const input = isPlainObject(raw) ? raw : {};
  const watermark = isPlainObject(input.watermark) ? input.watermark : {};
  return {
    watermark: {
      logo: pickFields(watermark.logo, OVERLAY_TWEAK_FIELDS.watermark.logo),
      text: pickFields(watermark.text, OVERLAY_TWEAK_FIELDS.watermark.text),
      qr: pickFields(watermark.qr, OVERLAY_TWEAK_FIELDS.watermark.qr)
    },
    signature: pickFields(input.signature, OVERLAY_TWEAK_FIELDS.signature),
    date: pickFields(input.date, OVERLAY_TWEAK_FIELDS.date)
  };
}

export function hasOverlayTweaks(raw) {
  const tweaks = normalizeOverlayTweaks(raw);
  return hasFields(tweaks.watermark.logo)
    || hasFields(tweaks.watermark.text)
    || hasFields(tweaks.watermark.qr)
    || hasFields(tweaks.signature)
    || hasFields(tweaks.date);
}

/** 改过的字段逐项列出（面板摘要与断言读同一份）。 */
export function overlayTweakEntries(raw) {
  const tweaks = normalizeOverlayTweaks(raw);
  const entries = [];
  for (const kind of WATERMARK_KINDS) {
    for (const field of Object.keys(tweaks.watermark[kind.id])) {
      entries.push({ section: 'watermark', kind: kind.id, field, label: `${kind.label}·${field}` });
    }
  }
  for (const field of Object.keys(tweaks.signature)) entries.push({ section: 'signature', kind: '', field, label: `落款·${field}` });
  for (const field of Object.keys(tweaks.date)) entries.push({ section: 'date', kind: '', field, label: `时间·${field}` });
  return entries;
}

export function overlayTweakCount(raw) {
  return overlayTweakEntries(raw).length;
}

/** 面板摘要，例如「水印已调整 · 落款已调整」；没有改动时是「跟随模板」。 */
export function overlayTweakSummary(raw) {
  const entries = overlayTweakEntries(raw);
  if (!entries.length) return '跟随模板';
  const touched = OVERLAY_SECTIONS
    .map((section) => ({ section, count: entries.filter((entry) => entry.section === section.id).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.section.label}（${item.count} 项）`);
  return touched.join(' · ');
}

/**
 * 把微调合并成**完整分组**：未改动的区返回 `null`（调用方据此原样返回 spec）。
 *
 * `baseGroups` 是模板 spec 经 `normalizeFrameSpecV2` 收敛后的分组（面板显示的那一份就是它），
 * 所以「老师只改了位置」时，其余字段带着模板的原值一起写回 —— 混写结构合法，
 * 且不会把没改过的字段掉成默认值。
 */
export function buildOverlayOverrides(baseGroups, raw) {
  const tweaks = normalizeOverlayTweaks(raw);
  if (!hasOverlayTweaks(tweaks)) return null;
  const groups = isPlainObject(baseGroups) ? baseGroups : {};
  const overrides = {};
  const watermarkTouched = hasFields(tweaks.watermark.logo) || hasFields(tweaks.watermark.text) || hasFields(tweaks.watermark.qr);
  if (watermarkTouched) {
    const base = isPlainObject(groups.watermark) ? groups.watermark : {};
    overrides.watermark = {
      logo: { ...(isPlainObject(base.logo) ? base.logo : {}), ...tweaks.watermark.logo },
      text: { ...(isPlainObject(base.text) ? base.text : {}), ...tweaks.watermark.text },
      qr: { ...(isPlainObject(base.qr) ? base.qr : {}), ...tweaks.watermark.qr }
    };
  }
  if (hasFields(tweaks.signature)) {
    const base = isPlainObject(groups.signature) ? groups.signature : {};
    const seal = isPlainObject(base.seal) ? base.seal : {};
    overrides.signature = { ...base, ...tweaks.signature, seal: { ...seal, ...(tweaks.signature.seal || {}) } };
  }
  if (hasFields(tweaks.date)) {
    overrides.date = { ...(isPlainObject(groups.date) ? groups.date : {}), ...tweaks.date };
  }
  return Object.keys(overrides).length ? overrides : null;
}

/**
 * 把完整分组叠到 spec 上，返回**新的 spec 对象**；`overrides` 为空时**原样返回输入**
 * （同一个对象，不复制）—— 这就是「老模板渲染逐像素不变」的实现点。
 * 只覆盖 `watermark` / `signature` / `date` 三个分组 + `version`，其余字段一个不碰。
 */
export function applyOverlayOverrides(spec, overrides) {
  if (!isPlainObject(overrides) || !Object.keys(overrides).length) return spec;
  const base = isPlainObject(spec) ? spec : {};
  return { ...base, version: OVERLAY_SPEC_VERSION, ...overrides };
}

/** 补丁指纹（渲染缓存键用；没有改动时是空串）。 */
export function overlayInstanceKey(overrides) {
  if (!isPlainObject(overrides) || !Object.keys(overrides).length) return '';
  return JSON.stringify(overrides);
}

/**
 * 「现在开着哪些叠加元素」——面板抬头与断言共用一句话。
 * 判据是 `visible === true`（与绘制层的 `shouldDrawOverlay` 同一个口径）。
 */
export function overlayEnabledSummary(groups) {
  const source = isPlainObject(groups) ? groups : {};
  const watermark = isPlainObject(source.watermark) ? source.watermark : {};
  const labels = [];
  for (const kind of WATERMARK_KINDS) {
    if (isPlainObject(watermark[kind.id]) && watermark[kind.id].visible === true) labels.push(kind.label);
  }
  if (isPlainObject(source.signature) && source.signature.visible === true) labels.push('落款');
  if (isPlainObject(source.date) && source.date.visible === true) labels.push('时间');
  if (!labels.length) return '本次不绘制任何叠加元素';
  return `已开启 ${labels.length} 项：${labels.join(' · ')}`;
}

/** 已开启的叠加元素数量（面板徽标用）。 */
export function overlayEnabledCount(groups) {
  const summary = overlayEnabledSummary(groups);
  const match = summary.match(/已开启 (\d+) 项/);
  return match ? Number(match[1]) : 0;
}

/**
 * 这一支「开启后真的画得出来吗」：画不出来时面板要说清原因，而不是让老师以为功能坏了
 * （默认值大多能画：文字水印默认 `{机构名}`、时间默认取本次课次日期）。
 * 判据只看**素材与必填内容**，不在这里做变量替换（那是渲染层的事）。
 */
export function overlayElementCanDraw(kind, element) {
  const item = isPlainObject(element) ? element : {};
  switch (kind) {
    case 'logo': return Boolean(String(item.url ?? '').trim());
    case 'text': return Boolean(String(item.content ?? '').trim());
    case 'qr': return Boolean(String(item.target ?? '').trim());
    case 'signature':
      return item.mode === 'image' ? Boolean(String(item.imageUrl ?? '').trim()) : Boolean(String(item.teacherName ?? '').trim());
    case 'date':
      if (item.source === 'manual') return Boolean(String(item.manualValue ?? '').trim());
      // lesson / today 两个来源都有值（课次日期为空时渲染层自己会不画，这里不替它判断）。
      return true;
    default: return true;
  }
}

/** 该支为什么画不出来（面板提示用；能画时返回空串）。 */
export function overlayElementBlockerText(kind, element) {
  if (overlayElementCanDraw(kind, element)) return '';
  switch (kind) {
    case 'logo': return '还没有上传机构 Logo：先上传再定位，画面上才会出现。';
    case 'text': return '文字水印的内容是空的：填一句话（或用「{机构名}」这类变量）后才会绘制。';
    case 'signature': return '选择的是签名图，但还没有上传：先上传签名图再定位。';
    case 'date': return '手动填写的日期是空的：选一个日期后才会绘制。';
    default: return '还缺素材或内容，画面上不会出现。';
  }
}
