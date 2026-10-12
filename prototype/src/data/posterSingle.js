// 单作品海报（[海报 US-303] / FR-310、FR-313、FR-318、FR-323）的数据装配与规则。
//
// 一张单作品海报 = **一份模板 spec**（参数，来自 `data/posterTemplates.js`）+ **一份数据**
// （这一节课 / 这一位学员的真实内容）。本模块是二者的装配点，回答的是「数据从哪儿来、缺了怎么办」：
//
//   ① 内容只取归档数据（FR-310）：成品图走 `archiveRecordMediaView()` —— 与成长档案、家长分享页
//      **同一支**「哪张图能显示」的判据（成品图 → 旧字段兜底 → 取不到就是占位），不在这里另判一次。
//   ② 日期与作品名取**课次数据**（FR-313）：课次实体按 `resolveArchiveLesson()` 解析
//      （与归档按钮同一支），日期用课次的 `lessonDate`、作品名用记录里由课次绑定的作品名；
//      一条都读不出来时**留空**，不用 `new Date()` 顶上（与 US-038 展签日期同一条纪律）。
//   ③ 点评金句取五维点评「美术能力」首句、≤ 30 字、逐字来自老师确认后的内容（FR-318）：
//      首句摘取与停顿处截断**复用视频字幕那一支**（`videoSubtitleFromReview`），海报只换字数上限
//      （30 对 24）与提示语 —— 「点评首句」这件事全仓只有一份实现。
//   ④ 缺件不编，而且**结构上编不出来**：
//      · 作品缺失 → 作品位换成占位文案「作品尚未同步完成」，导出门（`posterSingleExportGate`）拦下；
//      · 没有有效分享 → 二维码位换成「分享链接待生成」的文字位，渲染层不可能再画出一个空方块；
//      · 机构没有上传 Logo 图 → Logo 位用机构名代替（机构标识仍然在，不画假图）。
//
// 本模块在 data 层：**零依赖纯函数 + 常量**（只 import 其它 data 模块），可 `node` 直跑断言。
// 真正落笔的是 `services/posterSingle.js`（预览 `scale=1`、导出 `scale=2`，同一个 `renderPoster`）。

import {
  POSTER_BRAND_COLORS,
  POSTER_CANVAS_PRESETS,
  POSTER_KIND_LABELS,
  POSTER_MUTED_COLORS,
  normalizePosterSpec,
  normalizePosterTemplate,
  posterImageUrl,
  posterRatioToPixels,
  seedPosterTemplates
} from './posterTemplates';
import { resolveArchiveLesson } from './archiveLesson';
import { archiveRecordMediaView } from './archiveMedia';
import { formatLessonDateDots, normalizeLessonDate } from './lessons';
import { REVIEW_DIMENSION_NAMES } from './reviewDetailPanel';
import { shareTokenUrl, shareTokenView } from './shareTokens';
import { artworkExportDateText, sanitizeArtworkExportSegment } from './artworkExport';
import { videoSubtitleFromReview } from './videoTimeline';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();

// ---------------------------------------------------------------------------
// 常量（界面、断言与渲染读同一份 —— 别在任何一侧再抄一遍）
// ---------------------------------------------------------------------------

/** 单作品海报的画布（FR-313）：1080×1440（3:4）。 */
export const POSTER_SINGLE_KIND = 'single';
export const POSTER_SINGLE_CANVAS = { ...POSTER_CANVAS_PRESETS.single };

/** 作品区占画布高度的比例（「作品区占上部约 55%」）：期望值与容差范围。 */
export const POSTER_SINGLE_ARTWORK_SHARE = 0.55;
export const POSTER_SINGLE_ARTWORK_SHARE_RANGE = { min: 0.5, max: 0.6 };

/**
 * 作品位的角色 id 约定（与 US-302a 的自检夹具同一份）：`artwork` / `cover` = 单图位。
 * 单作品海报的作品位就是 `artwork`；取不到时退化为「第一个 image 占位区」。
 */
export const POSTER_SINGLE_ARTWORK_SLOT_ID = 'artwork';

/** 点评金句（FR-318）：维度 = 五维里的第一位（不另写一个维度名），字数上限 30。 */
export const POSTER_SINGLE_QUOTE_DIMENSION = REVIEW_DIMENSION_NAMES[0];
export const POSTER_SINGLE_QUOTE_MAX_CHARS = 30;

/** 没有老师确认后的点评原文时可读原因（**不编金句**）。 */
export const POSTER_SINGLE_QUOTE_MISSING_REASON = `这节课还没有老师确认后的「${POSTER_SINGLE_QUOTE_DIMENSION}」点评原文：金句位留空，不用别的句子顶上。`;

/** 两个占位文案（验收原文点名；界面提示、渲染占位与断言读同一份）。 */
export const POSTER_SINGLE_ARTWORK_MISSING_TEXT = '作品尚未同步完成';
export const POSTER_SINGLE_SHARE_PENDING_TEXT = '分享链接待生成';

/** 还没有归档记录时的可读原因（空态，不是「渲染一张空白海报」）。 */
export const POSTER_SINGLE_RECORD_MISSING_TEXT = '还没有可分享的归档记录：先完成课后反馈的归档，再来生成单作品海报。';

/** 默认选用的内置单作品模板（US-302a 的唯一默认模板就是它）。 */
export const POSTER_SINGLE_DEFAULT_TEMPLATE_KEY = 'poster-warm-gold-single';

/** 没有作品名时的一句说明（标题位留空，不编名字）。 */
export const POSTER_SINGLE_TITLE_MISSING_NOTE = '这条记录没有作品名：作品名位留空（不编一个名字）。';

/** 机构没有上传 Logo 图时的说明（Logo 位用机构名代替）。 */
export function posterSingleLogoFallbackNote(orgName = '') {
  const name = str(orgName);
  return name
    ? `机构还没有上传标识图：Logo 位用机构名「${name}」代替。`
    : '机构还没有上传标识图，也没有机构名：Logo 位留空。';
}

/** 导出被拦下时的可读原因（作品缺失那条就是验收原文）。 */
export const POSTER_SINGLE_EXPORT_BLOCKED_TITLE = '暂时不能导出这张海报';

// ---------------------------------------------------------------------------
// 模板选择与版式读数（「作品区占上部约 55%」的机器判据）
// ---------------------------------------------------------------------------

/**
 * 选一张单作品模板：优先内置的默认单作品模板 → 任意默认模板 → 第一套启用的单作品模板。
 * 传入的列表（云端 / 本机镜像）先过 `normalizePosterTemplate`，脏记录不进结果。
 */
export function findPosterSingleTemplate(templates = seedPosterTemplates) {
  const list = (Array.isArray(templates) ? templates : []).map(normalizePosterTemplate).filter(item => item.id);
  const singles = list.filter(item => item.kind === POSTER_SINGLE_KIND && item.enabled !== false);
  return singles.find(item => item.id === POSTER_SINGLE_DEFAULT_TEMPLATE_KEY)
    || singles.find(item => item.isDefault)
    || singles[0]
    || null;
}

/** 作品位的占位区（`artwork` 优先，其次第一个 image 位；没有就返回 null）。 */
export function posterSingleArtworkSlot(spec) {
  const normalized = normalizePosterSpec(spec);
  const images = normalized.slots.filter(slot => slot.type === 'image');
  return images.find(slot => slot.id === POSTER_SINGLE_ARTWORK_SLOT_ID) || images[0] || null;
}

/**
 * 版式读数：画布、作品位盒子、**作品区占画布高度的比例**与是否落在容差范围内。
 * `ok = false` 不会抛错也不会改版式 —— 它是给面板与断言看的读数（模板是参数，改参数不改代码）。
 */
export function posterSingleLayout(spec) {
  const normalized = normalizePosterSpec(spec);
  const canvas = normalized.canvas;
  const slot = posterSingleArtworkSlot(normalized);
  const height = slot ? posterRatioToPixels(slot.h, canvas) : 0;
  const share = canvas.height > 0 ? height / canvas.height : 0;
  const range = POSTER_SINGLE_ARTWORK_SHARE_RANGE;
  const ok = Boolean(slot) && share >= range.min && share <= range.max;
  return {
    ok,
    kind: normalized.kind,
    kindLabel: POSTER_KIND_LABELS[normalized.kind] || normalized.kind,
    canvas: { width: canvas.width, height: canvas.height },
    artwork: slot
      ? { id: slot.id, x: slot.x, y: slot.y, w: slot.w, h: slot.h, height, share }
      : null,
    share,
    target: POSTER_SINGLE_ARTWORK_SHARE,
    range,
    note: slot
      ? `作品区占画布高度 ${(share * 100).toFixed(1)}%（目标约 ${(POSTER_SINGLE_ARTWORK_SHARE * 100).toFixed(0)}%）`
      : '这份模板里没有作品位（image 占位区）。'
  };
}

// ---------------------------------------------------------------------------
// 点评金句（FR-318）
// ---------------------------------------------------------------------------

/**
 * 金句：五维点评「美术能力」的**首句**，≤ `maxChars` 字，逐字来自老师确认后的内容。
 * 返回 `{ dimension, text, source, truncated, limit, reason }`：
 *  - `text` 是原文的连续片段（超长时在停顿标点处断开，仍逐字）；
 *  - 没有原文时 `text` 为空串、`reason` 给可读原因（宁可没有金句，也不编一句）。
 * 首句摘取与截断复用 `videoSubtitleFromReview`（视频字幕那支的唯一实现，只是上限不同）。
 */
export function posterSingleQuote(reviews, { maxChars = POSTER_SINGLE_QUOTE_MAX_CHARS } = {}) {
  const source = isPlainObject(reviews) ? reviews : {};
  const raw = source[POSTER_SINGLE_QUOTE_DIMENSION];
  const picked = videoSubtitleFromReview(raw, { maxChars });
  const text = str(picked && picked.text);
  return {
    dimension: POSTER_SINGLE_QUOTE_DIMENSION,
    text,
    source: str(picked && picked.source),
    truncated: Boolean(picked && picked.truncated),
    limit: maxChars,
    reason: text ? '' : POSTER_SINGLE_QUOTE_MISSING_REASON
  };
}

/**
 * 「金句逐字来自老师确认后的点评」的判据（空串 = 合规）。
 * 三层：金句是原文的**连续片段**（`includes`）+ 不超 30 字 + 没有原文时金句必须为空。
 */
export function posterSingleQuoteIssue(quote, reviewText) {
  const text = str(quote);
  const source = String(reviewText === null || reviewText === undefined ? '' : reviewText);
  if (!text) return '';
  if (!source.trim()) return '金句没有对应的点评原文：金句只能从老师确认后的点评里原样截取，不能另写一句。';
  if (!source.includes(text)) {
    return `金句「${text.slice(0, 16)}」不是点评原文的连续片段：金句必须逐字来自老师确认后的点评，不得改写。`;
  }
  if (text.length > POSTER_SINGLE_QUOTE_MAX_CHARS) {
    return `金句 ${text.length} 字，超过 ${POSTER_SINGLE_QUOTE_MAX_CHARS} 字上限。`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// 占位补丁：作品缺失 / 无有效分享 / 无 Logo 图（三种缺件在版式里的位置不变，只换那一格的内容）
// ---------------------------------------------------------------------------

/** 占位文字位的字号（相对短边）：作品位大一些、二维码位小一些、Logo 位最小。 */
const POSTER_SINGLE_PLACEHOLDER_SIZE = { image: 0.022, qrcode: 0.016, logo: 0.02 };
const POSTER_SINGLE_PLACEHOLDER_LINE_HEIGHT = 1.5;

function posterSinglePlaceholderSlot(slot, text, { sizeRatio = 0.02, align = 'center', color = POSTER_MUTED_COLORS.brown, weight = 'normal' } = {}) {
  // 每一类占位区的「宽度」字段名不同：image / text 是 `w`，二维码是 `sizeRatio`（正方形边长），
  // Logo 是 `maxWRatio`（上限宽度）—— 占位文字位统一用它们当自己的 `w`。
  const width = slot.type === 'qrcode' ? slot.sizeRatio : (slot.type === 'logo' ? slot.maxWRatio : slot.w);
  const boxHeight = slot.type === 'image' ? slot.h : (slot.type === 'qrcode' ? slot.sizeRatio : 0);
  const lineHeight = POSTER_SINGLE_PLACEHOLDER_LINE_HEIGHT;
  // 竖向居中：按一行算（占位文案都在一行里放得下，见本模块的几何断言）。
  const y = boxHeight > 0
    ? slot.y + (boxHeight - sizeRatio * lineHeight) / 2
    : slot.y;
  return {
    id: slot.id,
    type: 'text',
    visible: slot.visible !== false,
    opacity: slot.opacity,
    x: slot.x,
    y,
    w: width,
    align,
    font: 'sans-serif',
    weight,
    sizeRatio,
    color,
    maxLines: 2,
    lineHeight,
    letterSpacingRatio: 0,
    template: text
  };
}

/**
 * 打占位补丁：**位置与尺寸不动**，只把缺件的那一格换成文字位。
 *
 * 为什么换类型而不是「传一个空图」：海报模板里没有「空盒子」这个概念 —— 图片解码失败时那一格
 * 什么都不画（`reason: 'no-image'`），于是版式上留一块真的空白。验收要的是「显示占位而不是空白」，
 * 所以占位文案必须**进绘制层**；而「二维码区显示文字而不是空白方块」也只有这样才是结构保证。
 *
 * 阶段海报（[海报 US-304]）复用同一支：它的拼贴位缺件时文案是「本阶段数据不足」，
 * 因此 `imagePlaceholderText` 可换（缺省仍是「作品尚未同步完成」，单作品那条路径一字不变）。
 */
export function posterSingleSpecPatch(spec, {
  artworkMissing = false,
  sharePending = false,
  logoFallback = '',
  // 图位缺件的**文案**可换（[海报 US-304] 的阶段拼贴位缺件时写「本阶段数据不足」而不是
  // 「作品尚未同步完成」）：位置、尺寸、字号一律不动，换的只是那一句。
  imagePlaceholderText = POSTER_SINGLE_ARTWORK_MISSING_TEXT
} = {}) {
  const normalized = normalizePosterSpec(spec);
  const artworkSlot = posterSingleArtworkSlot(normalized);
  const logoText = str(logoFallback);
  const imageText = str(imagePlaceholderText) || POSTER_SINGLE_ARTWORK_MISSING_TEXT;
  const slots = normalized.slots.map((slot) => {
    if (artworkMissing && slot.type === 'image' && artworkSlot && slot.id === artworkSlot.id) {
      return posterSinglePlaceholderSlot(slot, imageText, {
        sizeRatio: POSTER_SINGLE_PLACEHOLDER_SIZE.image,
        color: POSTER_MUTED_COLORS.deep
      });
    }
    if (sharePending && slot.type === 'qrcode') {
      return posterSinglePlaceholderSlot(slot, POSTER_SINGLE_SHARE_PENDING_TEXT, {
        sizeRatio: POSTER_SINGLE_PLACEHOLDER_SIZE.qrcode
      });
    }
    if (logoText && slot.type === 'logo') {
      return posterSinglePlaceholderSlot(slot, logoText, {
        sizeRatio: POSTER_SINGLE_PLACEHOLDER_SIZE.logo,
        align: 'left',
        color: POSTER_BRAND_COLORS.ink,
        weight: 'bold'
      });
    }
    return slot;
  });
  return { ...normalized, slots };
}

// ---------------------------------------------------------------------------
// 数据装配（这一步之后，界面只要 `spec` + `data` 就能渲染）
// ---------------------------------------------------------------------------

/**
 * 装配一张单作品海报：`{ spec, data, ...读数 }`。
 *
 * 入参：
 *  - `record` = 这条归档记录（缺省 / 空 → `hasRecord: false`，界面给空态而不是渲染空白海报）；
 *  - `lessons` = 课次列表（日期与作品名从课次数据里取，[第四步到第一步联通]）；
 *  - `tokens` = 分享令牌（**有效**的那一条才算数：撤回 / 过期都让二维码位显示「分享链接待生成」）；
 *  - `teacherName` / `orgName` / `logo` = 落款与机构标识；`origin` = 分享链接的站点前缀。
 */
export function buildPosterSinglePlan({
  record = null,
  lessons = [],
  tokens = [],
  now = null,
  teacherName = '',
  orgName = '',
  logo = '',
  origin = '',
  spec = null,
  template = null
} = {}) {
  const source = isPlainObject(record) ? record : null;
  const templateRecord = template ? normalizePosterTemplate(template) : findPosterSingleTemplate();
  const baseSpec = normalizePosterSpec(spec || (templateRecord && templateRecord.spec) || undefined);

  // 课次实体按两条路解析：① 自然键（班级 + 日期 + 课时序号，与归档按钮同一支 `resolveArchiveLesson`）；
  // ② 记录自带的 `lessonId` 直查 —— 第二条让「老师事后改过课次日期」也如实反映到海报上（US-038 的口径）。
  const lessonList = (Array.isArray(lessons) ? lessons : []).filter(isPlainObject);
  const lessonPlan = source
    ? resolveArchiveLesson({
      lessonId: source.lessonId,
      classId: source.classId,
      lessonDate: source.lessonDate || source.date,
      lessonNo: source.lessonNo,
      lessons: lessonList
    })
    : { source: 'none', lesson: null, lessonId: '', naturalKey: '' };
  const lessonById = source && str(source.lessonId)
    ? lessonList.find(item => str(item.lessonId) === str(source.lessonId)) || null
    : null;
  const lesson = lessonPlan.lesson || lessonById;
  const lessonSource = lessonPlan.lesson ? lessonPlan.source : (lessonById ? 'selected' : lessonPlan.source);

  // 日期与作品名取课次数据（FR-313）：课次实体在就用它，否则退回记录自己的课次字段（它们同样来自课次表单）。
  const date = normalizeLessonDate(lesson && lesson.lessonDate)
    || normalizeLessonDate(source && (source.lessonDate || source.date));
  const dateDots = date ? formatLessonDateDots(date) : '';
  const artworkTitle = str(source && source.title);
  const topic = str(lesson && lesson.topic) || str(source && source.topic);
  const studentName = str(source && source.student);

  // 成品素材：与成长档案 / 家长分享页同一支判据（老师端口径）。
  const media = source
    ? archiveRecordMediaView(source, { surface: 'teacher' })
    : { artwork: { url: '', placeholder: false, placeholderText: '', status: '' } };
  const artworkUrl = str(media.artwork && media.artwork.url);
  const artworkMissing = !artworkUrl;

  // 有效分享：`shareTokenView` 是分享状态（含撤回 / 过期）的唯一真源。
  const share = source
    ? shareTokenView({ tokens, recordId: source.id, now })
    : { state: 'none', stateLabel: '', active: false, tokenText: '', link: '' };
  const shareUrl = share.active && share.tokenText ? shareTokenUrl(share.tokenText, { origin }) : '';
  const sharePending = !shareUrl;

  const quote = posterSingleQuote(source && source.reviews);
  const logoUrl = posterImageUrl(logo);
  const logoFallback = !logoUrl ? str(orgName) : '';
  const fallbackReason = logoUrl
    ? ''
    : (str(logo) ? '机构标识地址不是图片地址：Logo 位改用机构名代替。' : posterSingleLogoFallbackNote(logoFallback));

  const patchedSpec = posterSingleSpecPatch(baseSpec, { artworkMissing, sharePending, logoFallback });
  const data = {
    studentName,
    artworkTitle,
    date,
    quote: quote.text,
    teacherName: str(teacherName),
    orgName: str(orgName),
    // 成品图 / 机构 Logo / 分享链接（渲染层各自过自己的闸：图片地址走 `posterImageUrl`）。
    images: artworkUrl,
    logo: logoUrl,
    shareUrl
  };

  const notes = [];
  if (!source) notes.push(POSTER_SINGLE_RECORD_MISSING_TEXT);
  if (source && artworkMissing) notes.push(`作品缺失：作品位显示「${POSTER_SINGLE_ARTWORK_MISSING_TEXT}」，导出被拦下。`);
  if (source && sharePending) notes.push(`没有有效的分享链接：二维码位显示「${POSTER_SINGLE_SHARE_PENDING_TEXT}」而不是空白方块。`);
  if (source && !artworkTitle) notes.push(POSTER_SINGLE_TITLE_MISSING_NOTE);
  if (source && quote.reason) notes.push(quote.reason);
  if (source && fallbackReason) notes.push(fallbackReason);

  return {
    hasRecord: Boolean(source),
    kind: POSTER_SINGLE_KIND,
    kindLabel: POSTER_KIND_LABELS[POSTER_SINGLE_KIND],
    templateKey: templateRecord ? templateRecord.id : '',
    templateName: templateRecord ? templateRecord.name : '',
    baseSpec,
    spec: patchedSpec,
    data,
    lessonSource,
    lesson: lesson
      ? { lessonId: str(lesson.lessonId), lessonDate: str(lesson.lessonDate), lessonNo: lesson.lessonNo || 0, topic: str(lesson.topic) }
      : null,
    studentName,
    artworkTitle,
    topic,
    date,
    dateDots,
    teacherName: str(teacherName),
    orgName: str(orgName),
    quote,
    quoteIssue: posterSingleQuoteIssue(quote.text, quote.source),
    artwork: {
      url: artworkUrl,
      missing: artworkMissing,
      placeholderText: artworkMissing ? POSTER_SINGLE_ARTWORK_MISSING_TEXT : '',
      status: str(media.artwork && media.artwork.status)
    },
    share: {
      state: share.state,
      stateLabel: share.stateLabel,
      active: Boolean(share.active),
      tokenText: str(share.tokenText),
      link: shareUrl,
      pending: sharePending,
      placeholderText: sharePending ? POSTER_SINGLE_SHARE_PENDING_TEXT : ''
    },
    logo: { url: logoUrl, fallbackText: logoFallback },
    layout: posterSingleLayout(baseSpec),
    notes,
    exportGate: posterSingleExportGate({ hasRecord: Boolean(source), artwork: { missing: artworkMissing } })
  };
}

/**
 * 导出门（FR-343 的三项校验里「素材未缺失」这一条）：
 * 作品缺失 → 不允许导出，原因就是验收原文「作品尚未同步完成」。
 */
export function posterSingleExportGate(plan) {
  const value = isPlainObject(plan) ? plan : {};
  if (!value.hasRecord) return { allowed: false, reason: POSTER_SINGLE_RECORD_MISSING_TEXT };
  if (value.artwork && value.artwork.missing) return { allowed: false, reason: POSTER_SINGLE_ARTWORK_MISSING_TEXT };
  return { allowed: true, reason: '' };
}

/**
 * 导出文件名（FR-342 的单作品版）：`{学员名}_{作品名}_{课次日期}_海报.{png|jpg}`。
 * 空片段不参与拼接，非法字符走**装裱导出那一支**（`sanitizeArtworkExportSegment`，别再写一份）。
 */
export function posterSingleFilename({ student = '', artworkTitle = '', date = '', extension = 'png' } = {}) {
  const ext = str(extension).toLowerCase() === 'jpg' || str(extension).toLowerCase() === 'jpeg' ? 'jpg' : 'png';
  const segments = [student, artworkTitle, artworkExportDateText(date)]
    .map(sanitizeArtworkExportSegment)
    .filter(Boolean);
  return [...segments, '海报'].join('_') + `.${ext}`;
}
