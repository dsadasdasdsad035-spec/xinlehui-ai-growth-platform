// 海报的「文案与作品微调」（[海报 US-310a] / FR-335 ~ FR-339）的数据层。
//
// 「老师想把这个孩子的标题与寄语改得更贴合他，也想只收其中几幅作品」—— 这件事的**规则**全在这一份里
// （零依赖：只 import 其它 data 模块，可 `node` 直跑断言），界面（`PosterDialog.jsx` 的微调面板）
// 只读这一份的产物，渲染仍然走 `services/posterDialog.js` 那一支（同一个 `renderPoster`）。
//
// 四条纪律：
//   ① **可编辑项只有五项**：标题 / 金句（寄语）/ 日期 / 是否显示二维码 / 收录哪些作品
//      （`POSTER_TUNING_FIELDS`）。版式坐标、字体与配色属于模板（改了会影响全机构一致性）——
//      这不是「界面上少画几个输入框」，而是**结构保证**：`applyPosterTuning()` 只读那五个字段，
//      其余键（`x` / `font` / `color` / `spec` …）一律进 `locked` / `ignored` 读数，一个字节都不落进 spec。
//   ② **一项可编辑的前提是这套版式里有承载它的位**（`posterTuningTargets()`）：没有金句位的版式
//      不给一个「改了没反应」的输入框，而是写清原因（宁缺毋滥，与全仓「不编一个假值」同一条纪律）。
//      「收录哪些作品」只在阶段 / 班级海报上可选（PRD 原文的括注），其余版式按已归档的作品出图。
//   ③ **微调不改版式**：唯一会写进 spec 的两个字段是文字位的 `template`（标题的内容）与
//      二维码位的 `visible`（隐藏）—— 坐标 / 字体 / 配色 / 尺寸一个都不动（`POSTER_TUNING_WRITTEN_FIELDS`）。
//      写进 `data` 的那几项（`quote` / `date` / 素材清单）都不是版式，属「画什么」而不是「画在哪」。
//   ④ **空值 = 用原值**：输入框留空表示「不改这一项」（`posterTuningKey()` 因此把空值排除在外）——
//      「老师把标题清空」与「老师没改标题」是两件事，前者不该把标题位变成空白。

import { formatLessonDateDots, normalizeLessonDate } from './lessons';
import { POSTER_KIND_LABELS } from './posterTemplates';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();
const int = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0);

// ---------------------------------------------------------------------------
// 可编辑项 / 不可编辑项（界面、断言与结构守卫读同一份）
// ---------------------------------------------------------------------------

export const POSTER_TUNING_FIELD_TITLE = 'title';
export const POSTER_TUNING_FIELD_QUOTE = 'quote';
export const POSTER_TUNING_FIELD_DATE = 'date';
export const POSTER_TUNING_FIELD_QRCODE = 'qrcode';
export const POSTER_TUNING_FIELD_ARTWORKS = 'artworks';

/** 五项可编辑项（顺序即面板里的顺序）。 */
export const POSTER_TUNING_FIELDS = [
  POSTER_TUNING_FIELD_TITLE,
  POSTER_TUNING_FIELD_QUOTE,
  POSTER_TUNING_FIELD_DATE,
  POSTER_TUNING_FIELD_QRCODE,
  POSTER_TUNING_FIELD_ARTWORKS
];

export const POSTER_TUNING_FIELD_LABELS = {
  [POSTER_TUNING_FIELD_TITLE]: '标题',
  [POSTER_TUNING_FIELD_QUOTE]: '金句 / 寄语',
  [POSTER_TUNING_FIELD_DATE]: '日期',
  [POSTER_TUNING_FIELD_QRCODE]: '显示二维码',
  [POSTER_TUNING_FIELD_ARTWORKS]: '收录哪些作品'
};

export const POSTER_TUNING_FIELD_HINTS = {
  [POSTER_TUNING_FIELD_TITLE]: '留空 = 用这一套版式的原标题。',
  [POSTER_TUNING_FIELD_QUOTE]: '默认取五维点评「美术能力」首句；这里填的是一句老师自己写的寄语。',
  [POSTER_TUNING_FIELD_DATE]: '留空 = 用课次日期（补录上节课时就是上节课的日期）。',
  [POSTER_TUNING_FIELD_QRCODE]: '关掉后二维码区完全不画（不留空白占位）。',
  [POSTER_TUNING_FIELD_ARTWORKS]: '不勾选任何一项 = 按归档数据全收。'
};

/** 不可编辑项：版式坐标 / 字体 / 配色（PRD 原文）。 */
export const POSTER_TUNING_LOCKED_FIELDS = ['layout', 'font', 'color'];
export const POSTER_TUNING_LOCKED_NOTE = '版式坐标、字体与配色属于模板：老师端不可编辑（改了会影响全机构一致性）。';

/**
 * 锁定的「字段名家族」：坐标 / 尺寸 / 字体 / 配色 / 结构。
 * 这些键出现在微调入参里一律**不读**（进 `locked` 读数）—— 断言可以据此证明「改版式这条路不存在」。
 */
export const POSTER_TUNING_LOCKED_KEYS = [
  'x', 'y', 'w', 'h', 'dy', 'sizeRatio', 'maxWRatio', 'widthRatio', 'cornerRadiusRatio', 'radiusRatio',
  'paddingRatio', 'lineHeight', 'letterSpacingRatio', 'maxLines', 'align', 'weight', 'opacity',
  'font', 'color', 'bg', 'stops', 'angle', 'captionSizeRatio', 'captionColor',
  'canvas', 'background', 'decor', 'frame', 'grid', 'cellCaption', 'slots', 'spec', 'template', 'visible'
];

/** 微调**唯一**允许写进 spec 的字段（结构读数：断言逐槽比对「只有这两个字段变了」）。 */
export const POSTER_TUNING_WRITTEN_FIELDS = ['template', 'visible'];

/** 字数上限（标题 / 寄语）：与单作品金句同一档（30 字），超出的部分在数据层截断并给读数。 */
export const POSTER_TUNING_TITLE_MAX_CHARS = 30;
export const POSTER_TUNING_QUOTE_MAX_CHARS = 30;

// ---------------------------------------------------------------------------
// 「这一项能不能改」的可读原因（不编一个「改了没反应」的输入框）
// ---------------------------------------------------------------------------

export const POSTER_TUNING_QUOTE_UNAVAILABLE = '这套版式没有金句位：换成单作品模板，或把想说的话写进标题。';
export const POSTER_TUNING_QUOTE_REPORT_NOTE = '长图的内容全部来自归档数据（FR-326）：逐条点评摘要不可改写。';
export const POSTER_TUNING_DATE_UNAVAILABLE = '这套版式没有日期位：日期随课次数据（展签 / 周期）显示，不单独编辑。';
export const POSTER_TUNING_ARTWORKS_UNAVAILABLE = '「收录哪些作品」只在阶段 / 班级海报上可选：单作品海报的主角就是这一幅，封面与长图按已归档的作品出图。';
export const POSTER_TUNING_ARTWORKS_MIN_NOTE = '至少要留一幅（位）：只剩一幅时那一幅不可再取消 —— 一张没有内容的图不下载。';
export const POSTER_TUNING_ARTWORKS_NOTE = (total, selected) => `已勾选 ${int(selected)} / ${int(total)} 幅（位）：没勾的不会出现在这张海报上。`;
export const POSTER_TUNING_CLASS_BATCH_NOTE = '勾选只作用于这一批：分批出图的其余批次仍按班级名单出图。';
export const POSTER_TUNING_TITLE_NOTE = (text) => `标题已改为老师填写的「${str(text)}」（原为这一套版式的默认标题）。`;
export const POSTER_TUNING_QUOTE_NOTE = (text) => `金句位已改为老师手写的寄语「${str(text)}」（不再是点评原文的截取）。`;
export const POSTER_TUNING_DATE_NOTE = (text) => `日期已改为 ${str(text)}（默认取课次日期）。`;
export const POSTER_TUNING_QR_NOTE = '二维码区已按老师的设置隐藏（不画、也不留空白占位）。';
export const POSTER_TUNING_TRUNCATED_NOTE = (label, limit) => `${label}超过 ${limit} 字上限：超出部分已截断（逐字保留前 ${limit} 字）。`;
export const POSTER_TUNING_LOCKED_NOTE_INLINE = '微调只改文案与作品：坐标 / 字体 / 配色属于模板，改动不会生效。';
export const POSTER_TUNING_RESET_LABEL = '恢复默认文案';

// ---------------------------------------------------------------------------
// 承载位（这套版式里有哪些位）—— 可编辑项的真源
// ---------------------------------------------------------------------------

/** 要被微调的 spec 列表：普通版式一份；长图每一页各自一份（页面版式是逐页合成的）。 */
function posterTuningSpecs(plan) {
  const list = [];
  if (isPlainObject(plan) && isPlainObject(plan.spec)) list.push(plan.spec);
  (isPlainObject(plan) && Array.isArray(plan.pages) ? plan.pages : []).forEach((page) => {
    if (isPlainObject(page) && isPlainObject(page.spec)) list.push(page.spec);
  });
  return list;
}

function posterTuningSlots(plan) {
  return posterTuningSpecs(plan).reduce((list, spec) => list.concat(Array.isArray(spec.slots) ? spec.slots : []), []);
}

/** 标题位：`id === 'title'` 的文字位（八套内置版式的第一行都是它）。 */
function posterTuningTitleSlotId(plan) {
  const slot = posterTuningSlots(plan).find((item) => isPlainObject(item) && item.id === 'title' && item.type === 'text');
  return slot ? str(slot.id) : '';
}

/** 金句位：`id === 'quote'` 的文字位（内容从 `{点评金句}` 变量来）。 */
function posterTuningQuoteSlotId(plan) {
  const slot = posterTuningSlots(plan).find((item) => isPlainObject(item) && item.id === 'quote' && item.type === 'text');
  return slot ? str(slot.id) : '';
}

/** 日期位：任何文字位的模板串里用到 `{日期}`（没有这个变量的版式改日期不会有反应）。 */
function posterTuningDateSlotId(plan) {
  const slot = posterTuningSlots(plan).find((item) => isPlainObject(item)
    && item.type === 'text'
    && String(item.template === null || item.template === undefined ? '' : item.template).includes('{日期}'));
  return slot ? str(slot.id) : '';
}

/** 二维码位：`type === 'qrcode'`，或没有有效分享时那几个占位位（`qr` / `qrPending`）。 */
function posterTuningQrSlotIds(plan) {
  return posterTuningSlots(plan)
    .filter((item) => isPlainObject(item) && (item.type === 'qrcode' || item.id === 'qr' || item.id === 'qrPending'))
    .map((item) => str(item.id))
    .filter((id, index, list) => id && list.indexOf(id) === index);
}

/** 收录哪些作品：只有阶段 / 班级海报有「一批作品」可选（其余版式按已归档的作品出图）。 */
export const POSTER_TUNING_ARTWORK_KINDS = ['period', 'class'];

/**
 * 「未收窄的那一份清单」：阶段 = 拼贴条目、班级 = 格子。
 * 已经打过微调的 plan 自带 **基础清单**（`plan.tuning.artworkBaseEntries`）—— 再打一次时从这里出发，
 * 否则第二次会把「已经收窄的清单」再收窄一次（幂等性：同一份微调打两遍 = 打一遍）。
 */
function artworkEntriesOf(plan, kind) {
  const value = isPlainObject(plan) ? plan : {};
  if (isPlainObject(value.tuning) && Array.isArray(value.tuning.artworkBaseEntries)) return value.tuning.artworkBaseEntries;
  if (kind === 'period') return (isPlainObject(value.collage) && Array.isArray(value.collage.entries)) ? value.collage.entries : [];
  if (kind === 'class') return (isPlainObject(value.batch) && Array.isArray(value.batch.cells)) ? value.batch.cells : [];
  return [];
}

/** 清单条目（id 是**这一份清单里的位置**：换周期 / 换对象后老选择自然失效）。 */
function artworkItemsFrom(kind, entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (kind === 'period') {
    return list.map((entry, index) => ({
      id: `work-${index + 1}`,
      label: [str(entry && entry.caption) || '未标注日期', str(entry && entry.title) || '未命名作品'].join(' · '),
      caption: str(entry && entry.caption),
      hasArtwork: Boolean(str(entry && entry.url))
    }));
  }
  return list.map((cell, index) => ({
    id: `student-${index + 1}`,
    label: [str(cell && cell.student) || '未记录姓名', str(cell && cell.hasArtwork) ? '已收录作品' : '本期暂无作品（占位格）'].join(' · '),
    caption: str(cell && cell.caption),
    hasArtwork: Boolean(cell && cell.hasArtwork)
  }));
}

/** 收录项清单（阶段 = 拼贴的每一幅；班级 = 名单里的每一位）。返回 `{ available, signature, items, reason }`。 */
export function posterTuningArtworkItems(plan) {
  const value = isPlainObject(plan) ? plan : {};
  const kind = str(value.kind);
  if (!POSTER_TUNING_ARTWORK_KINDS.includes(kind)) {
    return { available: false, kind, signature: '', items: [], reason: POSTER_TUNING_ARTWORKS_UNAVAILABLE };
  }
  const items = artworkItemsFrom(kind, artworkEntriesOf(value, kind));
  return { available: true, kind, signature: items.map((item) => item.id).join(','), items, reason: '' };
}

/**
 * 可编辑项清单：每一项给「能不能改」与原因（界面据此把输入框禁用并写明为什么）。
 * `items` 是收录项的当前清单（阶段 / 班级才有）。
 */
export function posterTuningTargets(plan) {
  const value = isPlainObject(plan) ? plan : {};
  const kind = str(value.kind);
  const titleSlotId = posterTuningTitleSlotId(value);
  const quoteSlotId = posterTuningQuoteSlotId(value);
  const dateSlotId = posterTuningDateSlotId(value);
  const qrSlotIds = posterTuningQrSlotIds(value);
  const artworks = posterTuningArtworkItems(value);
  return {
    kind,
    kindLabel: POSTER_KIND_LABELS[kind] || kind,
    title: {
      id: POSTER_TUNING_FIELD_TITLE,
      available: Boolean(titleSlotId),
      slotId: titleSlotId,
      reason: titleSlotId ? '' : '这套版式没有标题位。'
    },
    quote: {
      id: POSTER_TUNING_FIELD_QUOTE,
      available: Boolean(quoteSlotId),
      slotId: quoteSlotId,
      // 长图（report-long）逐条点评摘要来自归档原文：**不可改写**（FR-326 不许写死示例文案）。
      reason: quoteSlotId ? '' : (kind === 'report-long' ? POSTER_TUNING_QUOTE_REPORT_NOTE : POSTER_TUNING_QUOTE_UNAVAILABLE)
    },
    date: {
      id: POSTER_TUNING_FIELD_DATE,
      available: Boolean(dateSlotId),
      slotId: dateSlotId,
      reason: dateSlotId ? '' : POSTER_TUNING_DATE_UNAVAILABLE
    },
    qrcode: {
      id: POSTER_TUNING_FIELD_QRCODE,
      available: qrSlotIds.length > 0,
      slotIds: qrSlotIds,
      reason: qrSlotIds.length ? '' : '这套版式没有二维码位。'
    },
    artworks: {
      id: POSTER_TUNING_FIELD_ARTWORKS,
      available: artworks.available,
      signature: artworks.signature,
      items: artworks.items,
      reason: artworks.reason
    }
  };
}

// ---------------------------------------------------------------------------
// 取值：入参归一（只认五个字段）/ 默认值 / 重绘键
// ---------------------------------------------------------------------------

/**
 * 入参归一：**只认五项可编辑字段**，其余键落进 `locked`（版式坐标 / 字体 / 配色那一族）或
 * `ignored`（不认识的键）。字符串字段 trim 后超长的按上限截断（`truncated` 记名字）。
 */
export function normalizePosterTuning(raw = null) {
  const source = isPlainObject(raw) ? raw : {};
  const text = (value, limit) => {
    const original = str(Array.isArray(value) ? '' : (isPlainObject(value) ? '' : value));
    if (original.length <= limit) return { value: original, truncated: false };
    return { value: original.slice(0, limit), truncated: true };
  };
  const title = text(source[POSTER_TUNING_FIELD_TITLE], POSTER_TUNING_TITLE_MAX_CHARS);
  const quote = text(source[POSTER_TUNING_FIELD_QUOTE], POSTER_TUNING_QUOTE_MAX_CHARS);
  const date = str(source[POSTER_TUNING_FIELD_DATE]);
  const artworks = (Array.isArray(source[POSTER_TUNING_FIELD_ARTWORKS]) ? source[POSTER_TUNING_FIELD_ARTWORKS] : [])
    .map((item) => str(item))
    .filter((id, index, list) => id && list.indexOf(id) === index);
  const known = POSTER_TUNING_FIELDS;
  const locked = Object.keys(source).filter((key) => POSTER_TUNING_LOCKED_KEYS.includes(key)).sort();
  const ignored = Object.keys(source).filter((key) => !known.includes(key) && !POSTER_TUNING_LOCKED_KEYS.includes(key)).sort();
  const truncated = [];
  if (title.truncated) truncated.push(POSTER_TUNING_FIELD_TITLE);
  if (quote.truncated) truncated.push(POSTER_TUNING_FIELD_QUOTE);
  return {
    title: title.value,
    quote: quote.value,
    date: date ? (normalizeLessonDate(date) || date) : '',
    // 默认显示二维码（`undefined` 与 `true` 同义）；只有显式 false 才是「关掉」。
    qrcode: source[POSTER_TUNING_FIELD_QRCODE] === undefined ? true : source[POSTER_TUNING_FIELD_QRCODE] !== false,
    artworks,
    truncated,
    locked,
    ignored
  };
}

/** 面板的**默认值读数**：这一张海报当前的标题文案 / 金句原文 / 日期（老师看到的就是「改之前」的样子）。 */
export function posterTuningDefaults(plan) {
  const value = isPlainObject(plan) ? plan : {};
  const quoteText = value.quote && typeof value.quote === 'object' ? str(value.quote.text) : str(value.quote);
  return {
    title: posterTuningTitleText(value),
    quote: quoteText,
    date: str(value.dateDots) || formatLessonDateDots(value.date)
  };
}

/** 这一张海报当前的标题文案（标题位模板替换变量后的**字面口径**：只换得出值的变量）。 */
export function posterTuningTitleText(plan) {
  const value = isPlainObject(plan) ? plan : {};
  const slot = posterTuningSlots(value).find((item) => isPlainObject(item) && item.id === 'title' && item.type === 'text');
  if (!slot) return '';
  const data = isPlainObject(value.data) ? value.data : {};
  const context = {
    学员名: str(data.studentName) || str(value.studentName),
    作品名: str(data.artworkTitle) || str(value.artworkTitle),
    周期: str(data.period) || str(value.periodLabel),
    班级名: str(data.className) || str(value.className),
    机构名: str(data.orgName),
    老师姓名: str(data.teacherName)
  };
  return String(slot.template || '').replace(/\{([^{}]+)\}/g, (whole, name) => {
    const key = str(name);
    return Object.prototype.hasOwnProperty.call(context, key) ? context[key] : whole;
  });
}

/**
 * 重绘键：**真正会改变这一张图的微调输入**（空值不算 —— 留空 = 用原值）。
 * 它进 `posterDialogPlanKey()` 的公共段，因此「打字 → 预览立刻重绘」不需要第二个 effect。
 */
export function posterTuningKey(tuning) {
  const value = isPlainObject(tuning) ? tuning : {};
  const parts = [];
  if (str(value.title)) parts.push(`t:${str(value.title)}`);
  if (str(value.quote)) parts.push(`q:${str(value.quote)}`);
  if (str(value.date)) parts.push(`d:${normalizeLessonDate(value.date) || str(value.date)}`);
  if (value.qrcode === false) parts.push('qr:off');
  if (Array.isArray(value.artworks) && value.artworks.length) parts.push(`a:${value.artworks.map((id) => str(id)).join('+')}`);
  return parts.join('~');
}

// ---------------------------------------------------------------------------
// 落笔：把微调应用到一份 plan 上（不改版式）
// ---------------------------------------------------------------------------

/** 把某个文字位的 `template` 换成字面文案（**只动 template**：坐标 / 字体 / 配色一个字不改）。 */
function patchesTitleTemplate(spec, slotId, text) {
  const slots = (Array.isArray(spec.slots) ? spec.slots : []).map((slot) => (isPlainObject(slot) && slot.id === slotId && slot.type === 'text'
    ? { ...slot, template: text }
    : slot));
  return { ...spec, slots };
}

/** 隐藏二维码相关位（`visible: false` 的位在渲染层完全不画，也不留空白占位）。 */
function patchesQrHidden(spec, slotIds) {
  const ids = Array.isArray(slotIds) ? slotIds : [];
  const slots = (Array.isArray(spec.slots) ? spec.slots : []).map((slot) => {
    if (!isPlainObject(slot)) return slot;
    const isQr = slot.type === 'qrcode' || ids.includes(str(slot.id));
    return isQr ? { ...slot, visible: false } : slot;
  });
  return { ...spec, slots };
}

/**
 * 把微调应用到一份 plan：返回**同一结构**的新 plan（`spec` / `data` / 各读数就地换成生效值），
 * 并把这次微调的读数挂在 `plan.tuning` 上（界面、断言与导出都读它）。
 *
 * 入参 `raw` 是老师填的那五个字段；`locked` / `ignored` 只做如实回报（一个字节都不会落进 spec）。
 * `plan` 为空 / 没有可选内容时原样返回（微调不会把一张出不了图的 plan 变成能出图的）。
 */
export function applyPosterTuning(plan, raw = null) {
  const base = isPlainObject(plan) ? plan : null;
  if (!base) return plan;
  const targets = posterTuningTargets(base);
  const values = normalizePosterTuning(raw);
  const applied = [];
  const notes = [];
  let next = base;

  // ① 标题：换掉标题位的 template（内容，不是版式）。
  if (targets.title.available && values.title) {
    const slotId = targets.title.slotId;
    next = { ...next, spec: patchesTitleTemplate(next.spec, slotId, values.title) };
    if (Array.isArray(next.pages)) {
      next = { ...next, pages: next.pages.map((page) => (isPlainObject(page) && isPlainObject(page.spec) ? { ...page, spec: patchesTitleTemplate(page.spec, slotId, values.title) } : page)) };
    }
    applied.push(POSTER_TUNING_FIELD_TITLE);
    notes.push(POSTER_TUNING_TITLE_NOTE(values.title));
  }

  // ② 金句 / 寄语：换掉 `{点评金句}` 变量的值 + 让读数跟上（`plan.quote` 是面板与断言读的那一份）。
  if (targets.quote.available && values.quote) {
    next = {
      ...next,
      data: { ...(isPlainObject(next.data) ? next.data : {}), quote: values.quote },
      quote: { ...(isPlainObject(next.quote) ? next.quote : {}), text: values.quote, manual: true }
    };
    applied.push(POSTER_TUNING_FIELD_QUOTE);
    notes.push(POSTER_TUNING_QUOTE_NOTE(values.quote));
  }

  // ③ 日期：换掉 `{日期}` 变量的值（展签口径 `YYYY.MM.DD` 一并更新）。
  if (targets.date.available && values.date) {
    next = {
      ...next,
      data: { ...(isPlainObject(next.data) ? next.data : {}), date: values.date },
      date: values.date,
      dateDots: formatLessonDateDots(values.date)
    };
    applied.push(POSTER_TUNING_FIELD_DATE);
    notes.push(POSTER_TUNING_DATE_NOTE(formatLessonDateDots(values.date) || values.date));
  }

  // ④ 二维码开关：默认显示；只有显式关掉才隐藏（隐藏的位在渲染层不画、不留空白）。
  if (targets.qrcode.available && values.qrcode === false) {
    const slotIds = targets.qrcode.slotIds;
    next = { ...next, spec: patchesQrHidden(next.spec, slotIds) };
    if (Array.isArray(next.pages)) {
      next = { ...next, pages: next.pages.map((page) => (isPlainObject(page) && isPlainObject(page.spec) ? { ...page, spec: patchesQrHidden(page.spec, slotIds) } : page)) };
    }
    applied.push(POSTER_TUNING_FIELD_QRCODE);
    notes.push(POSTER_TUNING_QR_NOTE);
  }

  // ⑤ 收录哪些作品（阶段 = 拼贴的每一幅；班级 = 名单里的每一位）。
  let artworkView = { total: targets.artworks.items.length, selected: targets.artworks.items.length, excluded: 0, applied: false };
  const allIds = targets.artworks.items.map((item) => item.id);
  // 只认这一份清单里真实存在的 id（换周期 / 换模板后老选择自动失效，不会把图收空）；
  // 勾到一幅不剩时回落「全收」（界面也会把「取消最后一幅」禁掉，这里是不变量）。
  const pickedIds = values.artworks.filter((id) => allIds.includes(id));
  const effectiveIds = pickedIds.length ? pickedIds : allIds;
  // 「全选」等于没改（重绘键因此稳定：勾掉再勾回来不会留一个假的覆盖值）。
  const narrowed = targets.artworks.available && pickedIds.length > 0 && effectiveIds.length < allIds.length;
  // 未收窄的那一份清单：再打一次微调时从这里出发（同一份微调打两遍 = 打一遍）。
  const baseEntries = targets.artworks.available ? artworkEntriesOf(base, targets.kind) : [];
  if (narrowed) {
    next = targets.kind === 'period'
      ? patchesPeriodArtworks(next, effectiveIds, baseEntries)
      : patchesClassArtworks(next, effectiveIds, baseEntries);
    values.artworks = effectiveIds;
    artworkView = {
      total: allIds.length,
      selected: effectiveIds.length,
      excluded: Math.max(0, allIds.length - effectiveIds.length),
      applied: true
    };
    applied.push(POSTER_TUNING_FIELD_ARTWORKS);
    notes.push(POSTER_TUNING_ARTWORKS_NOTE(allIds.length, effectiveIds.length));
    if (targets.kind === 'class' && int(next.batch && next.batch.total) > 1) notes.push(POSTER_TUNING_CLASS_BATCH_NOTE);
  }

  values.truncated.forEach((field) => {
    const limit = field === POSTER_TUNING_FIELD_TITLE ? POSTER_TUNING_TITLE_MAX_CHARS : POSTER_TUNING_QUOTE_MAX_CHARS;
    notes.push(POSTER_TUNING_TRUNCATED_NOTE(POSTER_TUNING_FIELD_LABELS[field], limit));
  });

  return {
    ...next,
    tuning: {
      kind: targets.kind,
      key: posterTuningKey(values),
      values: { ...values },
      applied,
      locked: values.locked,
      ignored: values.ignored,
      truncated: values.truncated,
      artwork: artworkView,
      // 未收窄的那一份清单（幂等：再打一次微调时从这里重新出发）。
      artworkBaseEntries: baseEntries,
      // 可编辑项的真源读数：界面据此禁用输入框并写原因（不自己判一遍）。
      targets,
      notes,
      available: POSTER_TUNING_FIELDS.filter((id) => (targets[id] ? targets[id].available : false))
    }
  };
}

/**
 * 阶段海报：只收录勾选的那几幅（拼贴条目 / 素材 / 网格读数一起换）。
 * `baseEntries` = 未收窄的那一份清单（再打一次微调时从这里出发，保证幂等）；
 * 一行都不剩（不可能出现，界面对「取消最后一幅」置灰）时原样返回 —— 宁可不改，也不画一张空图。
 */
function patchesPeriodArtworks(plan, ids, baseEntries = null) {
  const entries = Array.isArray(baseEntries)
    ? baseEntries
    : ((isPlainObject(plan.collage) && Array.isArray(plan.collage.entries)) ? plan.collage.entries : []);
  const kept = entries.filter((entry, index) => ids.includes(`work-${index + 1}`));
  if (!kept.length) return plan;
  const slotId = str(plan.collage && plan.collage.slotId);
  const data = isPlainObject(plan.data) ? plan.data : {};
  const images = isPlainObject(data.images) ? data.images : {};
  return {
    ...plan,
    data: {
      ...data,
      images: { ...images, [slotId || 'collage']: kept.map((entry) => ({ url: entry.url, caption: entry.caption })) }
    },
    collage: {
      ...plan.collage,
      entries: kept,
      count: kept.length,
      note: POSTER_TUNING_ARTWORKS_NOTE(entries.length, kept.length)
    }
  };
}

/**
 * 班级海报：只收录勾选的那几位（格子 / 素材 / 网格重新算 —— 行列由人数决定，别让网格与格子对不上）。
 * `batchContext` 不动：分批出图的其余批次仍按班级名单出图（面板会写明这一条）。
 */
function patchesClassArtworks(plan, ids, baseEntries = null) {
  const cells = Array.isArray(baseEntries)
    ? baseEntries
    : ((isPlainObject(plan.batch) && Array.isArray(plan.batch.cells)) ? plan.batch.cells : []);
  const kept = cells.filter((cell, index) => ids.includes(`student-${index + 1}`));
  if (!kept.length) return plan;
  const wallSlotId = str(plan.wall && plan.wall.slotId);
  const data = isPlainObject(plan.data) ? plan.data : {};
  const images = isPlainObject(data.images) ? data.images : {};
  const grid = posterClassWallGridShape(kept.length);
  const artworks = kept.filter((cell) => cell.hasArtwork).length;
  const slots = (Array.isArray(plan.spec && plan.spec.slots) ? plan.spec.slots : []).map((slot) => {
    if (!isPlainObject(slot) || slot.type !== 'image' || (wallSlotId && slot.id !== wallSlotId)) return slot;
    return {
      ...slot,
      grid: { ...slot.grid, columns: grid.columns, rows: grid.rows, maxItems: Math.max(grid.capacity, kept.length, 1) }
    };
  });
  return {
    ...plan,
    spec: { ...plan.spec, slots },
    data: {
      ...data,
      artworkCount: String(artworks),
      images: { ...images, [wallSlotId || 'wall']: kept.map((cell) => ({ url: cell.url, caption: cell.caption, placeholderText: cell.placeholderText })) }
    },
    batch: {
      ...plan.batch,
      cells: kept,
      size: kept.length,
      names: kept.map((cell) => str(cell && cell.student)),
      artworks,
      placeholders: kept.length - artworks
    },
    wall: { ...plan.wall, grid: { ...grid, label: `${grid.columns}×${grid.rows}` } }
  };
}

/** 班级作品墙的网格（与 `data/posterClass.js` 的 `posterClassGridShape` 同一档规则：近方形）。 */
function posterClassWallGridShape(count) {
  const total = int(count);
  if (!total) return { columns: 0, rows: 0, capacity: 0, count: 0 };
  const columns = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / columns);
  return { columns, rows, capacity: columns * rows, count: total };
}
