// 成长报告长图海报（[海报 US-307] / FR-313、FR-317、FR-324 ~ FR-326）的数据装配与规则。
//
// 一张成长报告长图 = **一份竖向分段的版式**（本模块按真实内容算出每一段的高度与位置）
// + **一份数据**（这位学员在这个周期里的归档内容）。与单作品 / 阶段 / 班级 / 封面四支同分工：
// 本模块在 data 层、零依赖纯函数，可 `node` 直跑断言；真正落笔的在 `services/posterReportLong.js`
// （预览 `scale = 1`、导出按 `plan.layout.exportScale`，同一个 `renderPoster`）。
//
// 四条本故事特有的纪律：
//   ① **高度按内容自适应**：画布 1080 宽、高度 = 各段内容高度之和
//      （封面头图 → 课程时间线 → 作品与点评摘要 → 成长概览 → 二维码）。记录多了图就长，
//      没有任何一处写死「长图多高」。
//   ② **高度受 canvas 单边上限保护**：`POSTER_REPORT_MAX_EDGE` 直接读
//      `POSTER_CANVAS_EDGE_RANGE.max`（4096 —— 超长图在 iOS Safari 上会得到一张空白图，
//      PRD 9.4 点名的坑），降级顺序就是验收点名的那一条：
//        · 高度 ≤ 2048（2× 的折算上限）→ 一张图、2× 导出；
//        · 2048 < 高度 ≤ 4096 → **先降 DPI**：导出从 2× 降为 1×（仍是一张图）；
//        · 高度 > 4096 → **再分段出多张**：按分段边界切成多张，每张 ≤ 4096，文件名带页码
//          `…_长图_1of3.png`。
//   ③ **内容全部来自归档数据**（FR-326）：课次行读 `archiveLessonEntry()`（成长档案时间线那一支）、
//      点评摘要读老师确认后的五维原文（`videoSubtitleFromReview()` 逐字截取，不改写）、
//      成长概览读 `posterPeriodSummary()`（阶段报告聚合那一支）—— 数据不足时写
//      「本阶段数据不足」（`ARCHIVE_REPORT_INSUFFICIENT_TEXT`），**不套示例文案**。
//      「课程时间线 / 作品与点评摘要 / 成长概览」这几句是**版式分段标题**（与模板里的分段标题、
//      二维码说明同一类），不是替内容写的话。
//   ④ **渲染前给预计高度与预计文件大小**：`layout.estimate` 只读本模块算出的几何 + 体积经验值，
//      界面直接渲染它（`text` 一句读全），不自己再算一遍。
//
// 一个已知边界（结构性、不是漏判）：逐行文案写进占位区的 `template` 字面量（渲染层的变量上下文是
// 整张图一份，逐行内容无法走变量）。若老师的作品名里**恰好**写了 `{日期}` 这类白名单变量名，
// 渲染层会按变量替换 —— 与「模板里的变量」同一条既有口径，这里不另造转义。

import {
  POSTER_BRAND_COLORS,
  POSTER_CANVAS_EDGE_RANGE,
  POSTER_CANVAS_PRESETS,
  POSTER_KIND_LABELS,
  POSTER_MUTED_COLORS,
  normalizePosterSpec,
  normalizePosterTemplate,
  posterImageUrl,
  seedPosterTemplates
} from './posterTemplates';
import { POSTER_SINGLE_SHARE_PENDING_TEXT } from './posterSingle';
import {
  POSTER_PERIOD_INSUFFICIENT_TEXT,
  posterPeriodLabel,
  posterPeriodSummary
} from './posterPeriod';
import {
  ARCHIVE_PERIOD_DEFAULT,
  ARCHIVE_PERIODS,
  ARCHIVE_TARGET_PERSONAL,
  archivePeriodWindow,
  archiveTargetView,
  filterArchiveRecordsByPeriod
} from './archiveTargets';
import {
  buildArchiveReportSnapshot,
  resolveArchiveReportPeriod
} from './archiveReports';
import { archiveLessonEntry } from './archiveResident';
import { resolveArchiveLesson } from './archiveLesson';
import { shareTokenUrl, shareTokenView } from './shareTokens';
import { artworkExportSizeText, sanitizeArtworkExportSegment } from './artworkExport';
import { videoSubtitleFromReview } from './videoTimeline';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();
const int = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0);
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** 「今天」的归一（与 `data/posterPeriod.js` 同一口径：先落成真 Date 再交给周期函数）。 */
function resolvedToday(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = str(value);
  if (text) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

// ---------------------------------------------------------------------------
// 常量（界面、断言与渲染读同一份 —— 别在任何一侧再抄一遍）
// ---------------------------------------------------------------------------

/** 成长报告长图的画布（FR-317）：宽 1080，高度按内容自适应（见 `layout.height`）。 */
export const POSTER_REPORT_KIND = 'report-long';
export const POSTER_REPORT_CANVAS = { ...POSTER_CANVAS_PRESETS[POSTER_REPORT_KIND] };
export const POSTER_REPORT_WIDTH = POSTER_REPORT_CANVAS.width;

/** 单张长图的高度上限 = canvas 单边上限（唯一真源在 `POSTER_CANVAS_EDGE_RANGE.max`，别再写 4096）。 */
export const POSTER_REPORT_MAX_EDGE = POSTER_CANVAS_EDGE_RANGE.max;
export const POSTER_REPORT_MAX_HEIGHT = POSTER_REPORT_MAX_EDGE;
/** 高度下限（内容再短也不小于一个短边）：保证相框与留白不会被压成一条。 */
export const POSTER_REPORT_MIN_HEIGHT = POSTER_REPORT_WIDTH;

/** 导出倍数：不降级时 2×（2160 宽）；降 DPI 后 1×（1080 宽）。 */
export const POSTER_REPORT_EXPORT_SCALE = 2;
export const POSTER_REPORT_DEGRADED_SCALE = 1;

/** 五个纵向分段（验收原文的顺序）：封面头图 → 课程时间线 → 作品与点评摘要 → 成长概览 → 二维码。 */
export const POSTER_REPORT_SEGMENTS = [
  { id: 'cover', label: '封面头图' },
  { id: 'timeline', label: '课程时间线' },
  { id: 'works', label: '作品与点评摘要' },
  { id: 'summary', label: '成长概览' },
  { id: 'qr', label: '二维码' }
];
export const POSTER_REPORT_SEGMENT_LABELS = POSTER_REPORT_SEGMENTS.reduce((table, item) => {
  table[item.id] = item.label;
  return table;
}, {});

/** 降级档位（验收点名的顺序：先降 DPI，再分段出多张）。 */
export const POSTER_REPORT_DEGRADES = { none: 'none', dpi: 'dpi', paged: 'paged' };
export const POSTER_REPORT_DEGRADE_LABELS = {
  [POSTER_REPORT_DEGRADES.none]: '一张图 · 2× 导出',
  [POSTER_REPORT_DEGRADES.dpi]: '一张图 · 降 DPI（1× 导出）',
  [POSTER_REPORT_DEGRADES.paged]: '分段出多张'
};

/** 默认选用的内置长图模板（US-302a 的那一套）。 */
export const POSTER_REPORT_DEFAULT_TEMPLATE_KEY = 'poster-paper-report-long';

/** 课次行 / 作品行的上限（防极端；超限如实说明，不静默丢）。 */
export const POSTER_REPORT_MAX_LESSONS = 60;
/** 点评摘要的字数上限（逐字截取；比字幕的 24 宽一点 —— 长图是滑读的）。 */
export const POSTER_REPORT_QUOTE_MAX_CHARS = 40;

/**
 * 体积经验值（像素数 → PNG 字节数）：只用于「渲染前的预计文件大小」，渲染完用真实 `blob.size` 覆盖。
 * 0.15 是在真机预览上量出来的（12 条归档记录的长图实测 0.149 bytes/px：暖白底 + 文字 + 12 张作品缩略图）——
 * 它是**估算**，断言按量级比对（实际落在预计的 0.5~1.6 倍之间），不假装它是精确值。
 */
export const POSTER_REPORT_BYTES_PER_PIXEL = 0.15;

/** 分段标题与占位文案（版式文字，不是替内容写的话）。 */
export const POSTER_REPORT_TITLE_TEMPLATE = '{学员名} 的成长报告';
export const POSTER_REPORT_PERIOD_TEMPLATE = '{周期} · 共 {课时数} 次课';
export const POSTER_REPORT_TIMELINE_TITLE = '课程时间线';
export const POSTER_REPORT_WORKS_TITLE = '作品与点评摘要';
export const POSTER_REPORT_SUMMARY_TITLE = '成长概览';
export const POSTER_REPORT_QR_CAPTION = '扫码看完整成长档案';
export const POSTER_REPORT_FOOTER_TEMPLATE = '{机构名} · {老师姓名}';
/** 作品与点评摘要一段里一幅作品都没有时的占位（验收原文「数据不足」那一档）。 */
export const POSTER_REPORT_WORKS_MISSING_TEXT = POSTER_PERIOD_INSUFFICIENT_TEXT;

/** 空态与可读原因（界面直接渲染这些句子，不自己拼）。 */
export const POSTER_REPORT_STUDENT_MISSING_TEXT = '还没有可生成长图的归档记录：先完成课后反馈的归档，再来生成成长报告长图。';
export const POSTER_REPORT_PERIOD_EMPTY_TEXT = '这个周期里还没有归档记录：换一个周期，或先完成一次课后反馈的归档。';
export const POSTER_REPORT_EMPTY_TITLE = '暂时没有可生成的长图';
export const POSTER_REPORT_ARTWORK_MISSING_REASON = `这个周期里还没有可收录的成品作品图：作品与点评摘要一段写「${POSTER_REPORT_WORKS_MISSING_TEXT}」，其余各段照常出图。`;
export const POSTER_REPORT_SHARE_PENDING_REASON = `没有有效的分享链接：二维码位显示「${POSTER_SINGLE_SHARE_PENDING_TEXT}」而不是空白方块。`;
export const POSTER_REPORT_LESSON_TRIM_REASON = (total, shown) => `这个周期共有 ${int(total)} 节课，长图按课次顺序列出前 ${int(shown)} 节（超长图的课次行上限 ${POSTER_REPORT_MAX_LESSONS} 节）。`;
export const POSTER_REPORT_QUOTE_TRUNCATED_REASON = (count) => `${int(count)} 条点评摘要超过了 ${POSTER_REPORT_QUOTE_MAX_CHARS} 字的摘录上限，按停顿处逐字截断（不改写、不补话）。`;
export const POSTER_REPORT_QUOTE_MISSING_REASON = '有课次还没有老师确认后的点评原文：那一行只写课次与作品名，不编一句摘要。';
export const POSTER_REPORT_EXPORT_BLOCKED_TITLE = '暂时不能导出这张长图';
export const POSTER_REPORT_FILENAME_LABEL = '长图';

/**
 * 竖向排版的几何（全部相对**画布短边**，即 1080）：
 * 与模板一样用比例表达，换算成像素只有 `posterRatioToPixels()` 一个入口。
 * 这一段是「长图长什么样」的唯一真源 —— 断言逐项读它，别在断言里抄数字。
 */
export const POSTER_REPORT_LAYOUT = {
  marginX: 0.08,
  topGap: 0.07,
  /** 分段之间的间距（分段边界）与段内块之间的间距（相邻两行）。 */
  sectionGap: 0.05,
  blockGap: 0.02,
  bottomGap: 0.06,
  /** 行内「缩略图 → 文字」之间的横向间距。 */
  rowColGap: 0.02,
  coverHeight: 0.44,
  rowThumb: 0.115,
  qrSize: 0.16,
  /** 二维码说明与落款离上一块的间距。 */
  qrCaptionGap: 0.02,
  footerGap: 0.03,
  text: {
    title: { sizeRatio: 0.034, lineHeight: 1.35, letterSpacingRatio: 0.001 },
    period: { sizeRatio: 0.019, lineHeight: 1.4, letterSpacingRatio: 0.002 },
    sectionTitle: { sizeRatio: 0.022, lineHeight: 1.4, letterSpacingRatio: 0.002 },
    timelineLine: { sizeRatio: 0.018, lineHeight: 1.7, letterSpacingRatio: 0 },
    rowTitle: { sizeRatio: 0.02, lineHeight: 1.35, letterSpacingRatio: 0 },
    rowQuote: { sizeRatio: 0.017, lineHeight: 1.5, letterSpacingRatio: 0 },
    summaryLine: { sizeRatio: 0.019, lineHeight: 1.65, letterSpacingRatio: 0 },
    qrCaption: { sizeRatio: 0.014, lineHeight: 1.4, letterSpacingRatio: 0.002 },
    footer: { sizeRatio: 0.018, lineHeight: 1.4, letterSpacingRatio: 0.004 }
  }
};

// ---------------------------------------------------------------------------
// 文本折行估算（data 层没有 canvas：按「字宽 ≈ 字号」估，宁可多留一行也不把字压在下一段上）
// ---------------------------------------------------------------------------

/**
 * 一行放得下几个字：`width / fontSize`。中文一字约等于一个字号宽，拉丁窄一些 ——
 * 这里按 1:1 估（偏保守：容量估小了行数估多，段高只会多留一点，不会叠字）。
 */
export function posterReportLineCapacity(widthPx, fontSizePx) {
  const width = num(widthPx);
  const size = num(fontSizePx);
  if (!(width > 0) || !(size > 0)) return 1;
  return Math.max(1, Math.floor(width / size));
}

/**
 * 文本会折成几行（估算）：显式 `\n` 按行拆，每行按容量折。
 * 渲染层仍按占位区的 `maxLines` 截断 —— 估多了只是多留白，估少了会叠字，所以取上界。
 */
export function posterReportFoldedLines(text, { widthPx, fontSizePx, maxLines = 8 } = {}) {
  const source = String(text === null || text === undefined ? '' : text);
  const capacity = posterReportLineCapacity(widthPx, fontSizePx);
  const limit = Math.max(1, int(maxLines) || 8);
  let total = 0;
  source.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    total += Math.max(1, Math.ceil(Array.from(line).length / capacity));
  });
  return Math.max(1, Math.min(limit, total || 1));
}

// ---------------------------------------------------------------------------
// 体积与降级读数
// ---------------------------------------------------------------------------

/** 像素数 → 预计 PNG 字节数（渲染前的读数；渲染完成后界面改用真实 `blob.size`）。 */
export function posterReportEstimateBytes({ width = POSTER_REPORT_WIDTH, height = 0, scale = 1 } = {}) {
  const deviceWidth = Math.max(1, Math.round(num(width) * Math.max(0.01, num(scale) || 1)));
  const deviceHeight = Math.max(1, Math.round(num(height) * Math.max(0.01, num(scale) || 1)));
  return Math.round(deviceWidth * deviceHeight * POSTER_REPORT_BYTES_PER_PIXEL);
}

/**
 * 降级读数：按验收点名的顺序给档次、导出倍数与一句可读说明。
 *   - `none`：高度 ≤ 上限 ÷ 导出倍数（2048）→ 一张图、2×；
 *   - `dpi` ：高度在 2048 与 4096 之间 → 先降 DPI（1×），仍是一张图；
 *   - `paged`：高度 > 4096 → 分段出多张（`pages` 张，文件名带页码）。
 * 返回值里 `single` = 是不是一张图就能装下（界面据此决定显示「第 N 张」还是只有一张）。
 */
export function posterReportDegradeView({ height = 0, maxEdge = POSTER_REPORT_MAX_EDGE, exportScale = POSTER_REPORT_EXPORT_SCALE, pages = 1 } = {}) {
  const limit = Math.max(1, Math.round(num(maxEdge) || POSTER_REPORT_MAX_EDGE));
  const value = Math.max(0, Math.round(num(height)));
  const wanted = Math.max(1, num(exportScale) || POSTER_REPORT_EXPORT_SCALE);
  const half = Math.round(limit / wanted);
  const single = value <= limit;
  if (!single) {
    const count = Math.max(2, int(pages) || 2);
    return {
      mode: POSTER_REPORT_DEGRADES.paged,
      modeLabel: POSTER_REPORT_DEGRADE_LABELS[POSTER_REPORT_DEGRADES.paged],
      single: false,
      height: value,
      maxEdge: limit,
      halfEdge: half,
      exportScale: POSTER_REPORT_DEGRADED_SCALE,
      pages: count,
      note: `整张长图 ${value}px 超过 canvas 单边上限 ${limit}px：按「先降 DPI、再分段出多张」的顺序切成 ${count} 张（每张 ≤ ${limit}px，导出 ${POSTER_REPORT_DEGRADED_SCALE}×），文件名带页码 ${POSTER_REPORT_FILENAME_LABEL}_1of${count}。`
    };
  }
  if (value > half) {
    return {
      mode: POSTER_REPORT_DEGRADES.dpi,
      modeLabel: POSTER_REPORT_DEGRADE_LABELS[POSTER_REPORT_DEGRADES.dpi],
      single: true,
      height: value,
      maxEdge: limit,
      halfEdge: half,
      exportScale: POSTER_REPORT_DEGRADED_SCALE,
      pages: 1,
      note: `整张长图 ${value}px 超过 ${wanted}× 的折算上限 ${half}px（${limit} ÷ ${wanted}×）：按「先降 DPI」的降级顺序，导出降为 ${POSTER_REPORT_DEGRADED_SCALE}×（${POSTER_REPORT_WIDTH} 宽），仍是一张图 —— 不提高倍数也就撞不到 canvas 单边上限。`
    };
  }
  return {
    mode: POSTER_REPORT_DEGRADES.none,
    modeLabel: POSTER_REPORT_DEGRADE_LABELS[POSTER_REPORT_DEGRADES.none],
    single: true,
    height: value,
    maxEdge: limit,
    halfEdge: half,
    exportScale: wanted,
    pages: 1,
    note: `整张长图 ${value}px ≤ ${half}px：一张图、${wanted}× 导出（${Math.round(POSTER_REPORT_WIDTH * wanted)} 宽），不触发任何降级。`
  };
}

// ---------------------------------------------------------------------------
// 模板选择
// ---------------------------------------------------------------------------

/** 选一张长图模板：内置那一套 → 任意默认的长图模板 → 第一套启用的长图模板。 */
export function findPosterReportTemplate(templates = seedPosterTemplates) {
  const list = (Array.isArray(templates) ? templates : []).map(normalizePosterTemplate).filter((item) => item.id);
  const reports = list.filter((item) => item.kind === POSTER_REPORT_KIND && item.enabled !== false);
  return reports.find((item) => item.id === POSTER_REPORT_DEFAULT_TEMPLATE_KEY)
    || reports.find((item) => item.isDefault)
    || reports[0]
    || null;
}

// ---------------------------------------------------------------------------
// 内容：课次行（全部来自归档数据）
// ---------------------------------------------------------------------------

/**
 * 周期内的课次行：每一条归档记录一行，顺序 = 课次顺序（记录列表本就按日期升序）。
 * 每行取 `archiveLessonEntry()`（成长档案时间线那一支产物）+ 课次实体的课题，
 * 点评摘要取老师确认后的**第一个有正文的维度**的首句（`videoSubtitleFromReview` 逐字截取）。
 */
export function posterReportLessons({ records = [], lessons = [], tokens = [], now = null } = {}) {
  const lessonList = (Array.isArray(lessons) ? lessons : []).filter(isPlainObject);
  return (Array.isArray(records) ? records : []).filter(isPlainObject).map((record) => {
    const entry = archiveLessonEntry(record, { surface: 'teacher', tokens, now, lessons: lessonList });
    const resolved = record && str(record.lessonId) !== ''
      ? resolveArchiveLesson({
        lessonId: record.lessonId,
        classId: record.classId,
        lessonDate: record.lessonDate || record.date,
        lessonNo: record.lessonNo,
        lessons: lessonList
      })
      : { lesson: null };
    const lessonById = record && str(record.lessonId)
      ? lessonList.find((item) => str(item.lessonId) === str(record.lessonId)) || null
      : null;
    const lesson = resolved.lesson || lessonById;
    const topic = str(lesson && lesson.topic) || str(record.topic);
    const dimension = entry.dimensions[0] || null;
    const quote = dimension
      ? videoSubtitleFromReview(dimension.text, { maxChars: POSTER_REPORT_QUOTE_MAX_CHARS })
      : { text: '', source: '', truncated: false };
    return {
      index: 0,
      recordId: str(record.id),
      recordKey: str(record.recordKey),
      date: entry.date,
      dateDots: entry.dateDots,
      lessonNo: entry.lessonNo,
      lessonNoText: entry.lessonNoText,
      title: entry.title,
      topic,
      isAbsence: Boolean(entry.isAbsence),
      artworkUrl: str(entry.artwork && entry.artwork.url),
      dimensionCount: entry.dimensionCount,
      quote: {
        dimension: dimension ? dimension.name : '',
        text: str(quote.text),
        truncated: Boolean(quote.truncated)
      }
    };
  }).map((row, index) => ({ ...row, index: index + 1 }));
}

/** 一节课在时间线上的那一行（`2026.08.04 · 第 1 次课 · 春天的花园`）：只拼真实字段，缺哪段省哪段。 */
export function posterReportTimelineLine(row) {
  const source = isPlainObject(row) ? row : {};
  return [str(source.dateDots) || str(source.date), str(source.lessonNoText), str(source.topic) || str(source.title)]
    .filter(Boolean)
    .join(' · ');
}

/** 作品行（只收**有成品图**的课次，与阶段海报的「拼贴只收有成品图」同一条纪律）。 */
export function posterReportArtworkRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => str(row && row.artworkUrl));
}

// ---------------------------------------------------------------------------
// 竖向分段：把内容排成「块」（每一块自带高度与段内偏移）——分页只是在块边界上切
// ---------------------------------------------------------------------------

function textBlockLayout(entry, shortEdge) {
  const sizePx = num(entry.sizeRatio) * shortEdge;
  return { sizePx, linePx: sizePx * num(entry.lineHeight) };
}

/**
 * 内容 → 块列表。块是**可分页的最小单位**（一行课次 / 一行作品 / 一条总结 / 段标题 / 封面 / 码），
 * 每一块的 `height` 是像素、`slots` 里的 `dy` 是块内偏移（页面合成时再加块自身的 y）。
 * 分页只在这里的块边界上切，因此**任何一段版式都不会被切一半**（段标题还会跟着下一块走，见 packer）。
 */
function buildReportBlocks(content) {
  const S = num(content.shortEdge) || POSTER_REPORT_WIDTH;
  const L = POSTER_REPORT_LAYOUT;
  const px = (ratio) => num(ratio) * S;
  const marginX = px(L.marginX);
  const contentW = Math.max(1, S - marginX * 2);
  const blockGap = px(L.blockGap);
  const sectionGap = px(L.sectionGap);
  const rowColGap = px(L.rowColGap);

  const blocks = [];
  const push = (block) => { blocks.push(block); return block; };

  const textSlot = ({ id, text, metric, dy = 0, x = marginX, w = contentW, align = 'left', font = 'sans-serif', weight = 'normal', color = POSTER_MUTED_COLORS.deep, maxLines = 1 }) => ({
    id,
    type: 'text',
    dy,
    x: x / S,
    w: w / S,
    align,
    font,
    weight,
    sizeRatio: metric.sizeRatio,
    color,
    maxLines,
    lineHeight: metric.lineHeight,
    letterSpacingRatio: metric.letterSpacingRatio,
    template: text
  });
  const imageSlot = ({ id, dy = 0, x = marginX, w = contentW, h = px(L.rowThumb) }) => ({
    id,
    type: 'image',
    dy,
    x: x / S,
    w: w / S,
    h: h / S,
    radiusRatio: 0.012,
    paddingRatio: 0.008,
    border: { color: POSTER_MUTED_COLORS.line, widthRatio: 0.0015 }
  });

  // ① 封面头图：标题 → 周期与课时数 → 代表作
  const title = textBlockLayout(L.text.title, S);
  const period = textBlockLayout(L.text.period, S);
  const coverH = px(L.coverHeight);
  push({
    id: 'cover',
    kind: 'cover',
    segment: 'cover',
    height: title.linePx + blockGap + period.linePx + blockGap + coverH,
    // 头图下沿（像素、块内偏移）：分隔线跟着它走 —— 自适应高度下模板里那条固定 y 的线没有位置含义。
    coverBottom: title.linePx + blockGap + period.linePx + blockGap + coverH,
    slots: [
      textSlot({ id: 'title', text: POSTER_REPORT_TITLE_TEMPLATE, metric: L.text.title, dy: 0, font: 'serif', weight: 'bold', color: POSTER_BRAND_COLORS.ink }),
      textSlot({ id: 'period', text: POSTER_REPORT_PERIOD_TEMPLATE, metric: L.text.period, dy: title.linePx + blockGap, color: POSTER_MUTED_COLORS.brown }),
      imageSlot({ id: 'cover', dy: title.linePx + blockGap + period.linePx + blockGap, h: coverH })
    ]
  });

  // ② 课程时间线：标题 + 一节一行
  const sectionTitle = textBlockLayout(L.text.sectionTitle, S);
  const lineLayout = textBlockLayout(L.text.timelineLine, S);
  push({
    id: 'timelineTitle',
    kind: 'title',
    segment: 'timeline',
    height: sectionTitle.linePx,
    slots: [textSlot({ id: 'timelineTitle', text: POSTER_REPORT_TIMELINE_TITLE, metric: L.text.sectionTitle, font: 'sans-serif', weight: 'bold', color: POSTER_BRAND_COLORS.ink })]
  });
  content.timeline.forEach((line, index) => {
    push({
      id: `timeline-${index + 1}`,
      kind: 'line',
      segment: 'timeline',
      height: lineLayout.linePx,
      slots: [textSlot({ id: `timelineLine-${index + 1}`, text: line, metric: L.text.timelineLine, color: POSTER_MUTED_COLORS.deep })]
    });
  });

  // ③ 作品与点评摘要：标题 + 一幅作品一块（缩略图 + 课次行 + 点评摘要）
  push({
    id: 'worksTitle',
    kind: 'title',
    segment: 'works',
    height: sectionTitle.linePx,
    slots: [textSlot({ id: 'worksTitle', text: POSTER_REPORT_WORKS_TITLE, metric: L.text.sectionTitle, font: 'sans-serif', weight: 'bold', color: POSTER_BRAND_COLORS.ink })]
  });
  if (content.works.length) {
    const rowTitle = textBlockLayout(L.text.rowTitle, S);
    const rowQuote = textBlockLayout(L.text.rowQuote, S);
    const thumbSize = px(L.rowThumb);
    const textX = marginX + thumbSize + rowColGap;
    const textW = Math.max(1, contentW - thumbSize - rowColGap);
    content.works.forEach((row, index) => {
      const quoteText = row.quote.text ? `${row.quote.dimension}：${row.quote.text}` : '';
      const quoteLines = quoteText
        ? posterReportFoldedLines(quoteText, { widthPx: textW, fontSizePx: rowQuote.sizePx, maxLines: 2 })
        : 0;
      // 行高 = 缩略图与文字块里更高的那一个；文字块在行内**竖向居中**（不贴顶，也不越出行高）。
      const textHeight = rowTitle.linePx + (quoteLines ? blockGap / 2 + quoteLines * rowQuote.linePx : 0);
      const rowHeight = Math.max(thumbSize, textHeight);
      const offsetY = (rowHeight - textHeight) / 2;
      push({
        id: `worksRow-${index + 1}`,
        kind: 'row',
        segment: 'works',
        rowIndex: index + 1,
        row,
        height: rowHeight,
        slots: [
          imageSlot({ id: `worksRow-${index + 1}-art`, w: thumbSize, h: thumbSize }),
          textSlot({
            id: `worksRow-${index + 1}-title`,
            text: [str(row.dateDots) || str(row.date), str(row.lessonNoText), str(row.title)].filter(Boolean).join(' · '),
            metric: L.text.rowTitle,
            dy: offsetY,
            x: textX,
            w: textW,
            font: 'sans-serif',
            weight: 'bold',
            color: POSTER_BRAND_COLORS.ink,
            maxLines: 1
          }),
          ...(quoteLines ? [textSlot({
            id: `worksRow-${index + 1}-quote`,
            text: quoteText,
            metric: L.text.rowQuote,
            dy: offsetY + rowTitle.linePx + blockGap / 2,
            x: textX,
            w: textW,
            font: 'serif',
            color: POSTER_MUTED_COLORS.deep,
            maxLines: quoteLines
          })] : [])
        ]
      });
    });
  } else {
    // 一幅成品图都没有：**换类型**（不画空盒子），写数据层给的那句占位
    push({
      id: 'worksPlaceholder',
      kind: 'line',
      segment: 'works',
      height: lineLayout.linePx,
      slots: [textSlot({ id: 'worksPlaceholder', text: POSTER_REPORT_WORKS_MISSING_TEXT, metric: L.text.summaryLine, dy: 0, font: 'serif', color: POSTER_MUTED_COLORS.deep })]
    });
  }

  // ④ 成长概览：标题 + 报告聚合出来的那几句（一句一块，页码之间可以切开）
  push({
    id: 'summaryTitle',
    kind: 'title',
    segment: 'summary',
    height: sectionTitle.linePx,
    slots: [textSlot({ id: 'summaryTitle', text: POSTER_REPORT_SUMMARY_TITLE, metric: L.text.sectionTitle, font: 'sans-serif', weight: 'bold', color: POSTER_BRAND_COLORS.ink })]
  });
  content.summaryLines.forEach((line, index) => {
    const layout = textBlockLayout(L.text.summaryLine, S);
    const folds = posterReportFoldedLines(line, { widthPx: contentW, fontSizePx: layout.sizePx, maxLines: 4 });
    push({
      id: `summary-${index + 1}`,
      kind: 'line',
      segment: 'summary',
      height: folds * layout.linePx,
      slots: [textSlot({ id: `summaryLine-${index + 1}`, text: line, metric: L.text.summaryLine, font: 'serif', color: POSTER_MUTED_COLORS.deep, maxLines: folds })]
    });
  });

  // ⑤ 二维码 + 落款（有效分享 → 真码；没有分享 → 文字位；机构标识走落款文字，不画假 Logo）
  const qrSize = px(L.qrSize);
  const qrCaption = textBlockLayout(L.text.qrCaption, S);
  const footer = textBlockLayout(L.text.footer, S);
  // 白底静区吃掉的边（渲染层按模块数算，这里按 1.35 倍估）：块高按静区算，免得码压住落款。
  const qrBlockHeight = qrSize * 1.35 + px(L.qrCaptionGap) + qrCaption.linePx;
  push({
    id: 'qr',
    kind: 'qr',
    segment: 'qr',
    height: qrBlockHeight,
    slots: content.sharePending
      ? [textSlot({
        id: 'qrPending',
        text: POSTER_SINGLE_SHARE_PENDING_TEXT,
        metric: L.text.qrCaption,
        dy: qrBlockHeight / 2 - qrCaption.linePx / 2,
        align: 'center',
        color: POSTER_MUTED_COLORS.brown,
        maxLines: 1
      })]
      : [{
        id: 'qr',
        type: 'qrcode',
        dy: 0,
        x: (S - qrSize) / 2 / S,
        sizeRatio: L.qrSize,
        bg: '#FFFFFF',
        caption: POSTER_REPORT_QR_CAPTION,
        captionSizeRatio: L.text.qrCaption.sizeRatio,
        captionColor: POSTER_MUTED_COLORS.brown
      }]
  });
  push({
    id: 'footer',
    kind: 'footer',
    segment: 'qr',
    height: footer.linePx,
    slots: [textSlot({
      id: 'footer',
      text: POSTER_REPORT_FOOTER_TEMPLATE,
      metric: L.text.footer,
      align: 'center',
      color: POSTER_MUTED_COLORS.brown,
      letterSpacingRatio: L.text.footer.letterSpacingRatio
    })]
  });

  // 段内用 blockGap、分段边界用 sectionGap；最后一块不带间距。
  blocks.forEach((block, index) => {
    const next = blocks[index + 1];
    block.gapAfter = !next ? 0 : (next.segment === block.segment ? blockGap : sectionGap);
  });
  return blocks;
}

/**
 * 分页（验收的降级顺序里「分段出多张」那一步）：在**块边界**上贪心装入，每张 ≤ `maxHeight`。
 * 段标题**跟着下一块走**（keep-with-next）：不让「作品与点评摘要」这个标题孤零零落在页尾，
 * 翻到下一张才看到内容（那会让老师以为漏了）。
 */
export function packReportBlocks(blocks = [], { maxHeight = POSTER_REPORT_MAX_HEIGHT, topGap = 0, bottomGap = 0 } = {}) {
  const list = Array.isArray(blocks) ? blocks.filter(isPlainObject) : [];
  const limit = Math.max(1, Math.round(num(maxHeight) || POSTER_REPORT_MAX_HEIGHT));
  const pages = [];
  let current = null;
  const startPage = () => ({ blocks: [], height: num(topGap) + num(bottomGap) });
  list.forEach((block, index) => {
    const next = list[index + 1];
    const keepWithNext = block.kind === 'title' && next && next.segment === block.segment;
    const need = num(block.height) + num(block.gapAfter) + (keepWithNext ? num(next.height) + num(next.gapAfter) : 0);
    if (!current) current = startPage();
    if (current.blocks.length && current.height + need > limit) {
      pages.push(current);
      current = startPage();
    }
    current.blocks.push(block);
    current.height += num(block.height) + num(block.gapAfter);
  });
  if (current) pages.push(current);
  return pages.map((page, index) => {
    let y = num(topGap);
    const laid = page.blocks.map((block) => {
      const entry = { ...block, y };
      y += num(block.height) + num(block.gapAfter);
      return entry;
    });
    return {
      index: index + 1,
      total: pages.length,
      blocks: laid,
      height: Math.max(1, Math.round(page.height))
    };
  });
}

// ---------------------------------------------------------------------------
// 数据装配（这一步之后，界面只要 `spec` + `data` 就能渲染）
// ---------------------------------------------------------------------------

/**
 * 装配一张成长报告长图：`{ spec, data, pages, layout, ...读数 }`。
 *
 * 入参：
 *  - `records` = 归档记录（全量；按「学员 + 周期」过滤在本模块里做）；
 *  - `lessons` = 课次实体（可选：老记录靠它补课时序号与课题，与别处同一支判据）；
 *  - `student` = 这一张长图属于哪一位孩子（读不出来给空态，不渲染空白长图）；
 *  - `period` = `半学期 | 一学期 | 一年度`（脏值回落默认「一学期」）；
 *  - `record` = 二维码指向的那条记录（缺省时取周期内**最新**的一条）；
 *  - `today` = 可注入的「今天」（周期窗口与聚合都读它，断言与界面因此读同一份）。
 */
export function buildPosterReportLongPlan({
  records = [],
  lessons = [],
  student = '',
  period = '',
  record = null,
  tokens = [],
  now = null,
  today = null,
  teacherName = '',
  orgName = '',
  logo = '',
  origin = '',
  spec = null,
  template = null
} = {}) {
  const studentName = str(student);
  const periodName = resolveArchiveReportPeriod(period);
  const todayValue = resolvedToday(today);
  const window = archivePeriodWindow(periodName, todayValue);
  const periodLabel = posterPeriodLabel(periodName, todayValue);
  const templateRecord = template ? normalizePosterTemplate(template) : findPosterReportTemplate();
  const baseSpec = normalizePosterSpec(spec || (templateRecord && templateRecord.spec) || undefined);

  // 「学员 + 周期」的记录：对象过滤与周期过滤都走档案页那一支（未选学员 = 空列表，不是全部记录）。
  const targetView = archiveTargetView(records, { target: ARCHIVE_TARGET_PERSONAL, student: studentName });
  const inPeriod = studentName
    ? filterArchiveRecordsByPeriod(targetView.lessons, periodName, todayValue)
    : [];
  const allRows = posterReportLessons({ records: inPeriod, lessons, tokens, now });
  const rows = allRows.slice(0, POSTER_REPORT_MAX_LESSONS);
  const artworks = posterReportArtworkRows(rows);

  // 成长概览：阶段报告那一支聚合出来的句子（数字句 + 覆盖情况），不足时写「本阶段数据不足」。
  const snapshot = studentName
    ? buildArchiveReportSnapshot({
      records,
      target: ARCHIVE_TARGET_PERSONAL,
      name: studentName,
      period: periodName,
      type: '成长集锦',
      today: todayValue
    })
    : null;
  const summary = posterPeriodSummary(snapshot);

  // 封面头图 = 本周期**最新一幅**有成品图的作品（没有作品时头图位让给一句占位，不留空白）。
  const coverRow = [...artworks].reverse()[0] || null;

  // 分享：`record`（这一步刚归档 / 正在看的那一条）优先，否则周期内最新的一条。
  const shareRecord = isPlainObject(record) && str(record.student) === studentName
    ? record
    : [...inPeriod].reverse().find((item) => str(item.student) === studentName) || null;
  const share = shareRecord
    ? shareTokenView({ tokens, recordId: shareRecord.id, now })
    : { state: 'none', stateLabel: '', active: false, tokenText: '', link: '' };
  const shareUrl = share.active && share.tokenText ? shareTokenUrl(share.tokenText, { origin }) : '';
  const sharePending = !shareUrl;

  const quoteTruncated = rows.filter((row) => row.quote.truncated).length;
  const quoteMissing = rows.filter((row) => !row.quote.text).length;

  const content = {
    shortEdge: POSTER_REPORT_WIDTH,
    timeline: rows.map((row) => posterReportTimelineLine(row)).filter(Boolean),
    works: artworks,
    summaryLines: summary.lines.filter(Boolean),
    sharePending
  };
  const blocks = buildReportBlocks(content);
  // **有内容才出图**：没有学员 / 这个周期一条记录都没有 → `pages: []`（结构上就渲染不出一张空白海报），
  // 界面与 `services/posterReportLong.js` 都读这个事实，别去渲染一张「只有标题与占位」的图。
  const renderable = Boolean(studentName) && rows.length > 0;
  const pageList = renderable
    ? packReportBlocks(blocks, {
      maxHeight: POSTER_REPORT_MAX_HEIGHT,
      topGap: POSTER_REPORT_LAYOUT.topGap * POSTER_REPORT_WIDTH,
      bottomGap: POSTER_REPORT_LAYOUT.bottomGap * POSTER_REPORT_WIDTH
    })
    : [];
  const singleHeight = Math.max(
    POSTER_REPORT_MIN_HEIGHT,
    Math.round(blocks.reduce((total, block) => total + block.height + block.gapAfter, 0)
      + POSTER_REPORT_LAYOUT.topGap * POSTER_REPORT_WIDTH
      + POSTER_REPORT_LAYOUT.bottomGap * POSTER_REPORT_WIDTH)
  );
  const degrade = posterReportDegradeView({
    height: singleHeight,
    maxEdge: POSTER_REPORT_MAX_HEIGHT,
    exportScale: POSTER_REPORT_EXPORT_SCALE,
    pages: pageList.length
  });

  const logoUrl = posterImageUrl(logo);
  const images = {};
  if (coverRow) images.cover = coverRow.artworkUrl;
  artworks.forEach((row, index) => { images[`worksRow-${index + 1}-art`] = row.artworkUrl; });

  const wholeEstimate = {
    width: POSTER_REPORT_WIDTH,
    height: singleHeight,
    scale: degrade.exportScale,
    deviceWidth: POSTER_REPORT_WIDTH * degrade.exportScale,
    deviceHeight: Math.round(singleHeight * degrade.exportScale),
    bytes: posterReportEstimateBytes({ width: POSTER_REPORT_WIDTH, height: singleHeight, scale: degrade.exportScale })
  };
  const estimateText = `预计高度 ${singleHeight}px（${degrade.single ? '一张图' : `${pageList.length} 张`}）· 预计文件大小 ${artworkExportSizeText(wholeEstimate.bytes)}（${degrade.exportScale}× 导出 = ${POSTER_REPORT_WIDTH * degrade.exportScale} 宽）`;

  const data = {
    studentName,
    period: periodLabel,
    lessonCount: String(rows.length),
    artworkCount: String(artworks.length),
    summary: summary.text,
    teacherName: str(teacherName),
    orgName: str(orgName),
    logo: logoUrl,
    shareUrl,
    images
  };

  // 逐页合成 spec：每一页自己的画布高度、自己的块坐标（块是按内容算好的，页面只是重新定 y）。
  const pages = pageList.map((page) => {
    const specValue = composeReportPageSpec({ baseSpec, page, content, data, coverRow });
    const exportScale = degrade.single ? degrade.exportScale : POSTER_REPORT_DEGRADED_SCALE;
    const estimate = {
      width: POSTER_REPORT_WIDTH,
      height: page.height,
      scale: exportScale,
      deviceWidth: Math.round(POSTER_REPORT_WIDTH * exportScale),
      deviceHeight: Math.round(page.height * exportScale),
      bytes: posterReportEstimateBytes({ width: POSTER_REPORT_WIDTH, height: page.height, scale: exportScale })
    };
    const segmentIds = [...new Set(page.blocks.map((block) => block.segment))];
    const worksBlocks = page.blocks.filter((block) => block.kind === 'row');
    const segments = segmentIds.map((id) => ({
      id,
      label: POSTER_REPORT_SEGMENT_LABELS[id] || id,
      blocks: page.blocks.filter((block) => block.segment === id).length,
      height: Math.round(page.blocks.filter((block) => block.segment === id).reduce((total, block) => total + block.height + block.gapAfter, 0))
    }));
    return {
      index: page.index,
      total: page.total,
      height: page.height,
      top: POSTER_REPORT_LAYOUT.topGap * POSTER_REPORT_WIDTH,
      filename: posterReportFilename({
        student: studentName,
        period: periodName,
        pageIndex: page.index,
        pageTotal: page.total
      }),
      blocks: page.blocks,
      segments,
      segmentIds,
      notes: segments.map((segment) => segment.label).join(' · '),
      artworkFrom: worksBlocks.length ? worksBlocks[0].rowIndex : 0,
      artworkTo: worksBlocks.length ? worksBlocks[worksBlocks.length - 1].rowIndex : 0,
      lineFrom: page.blocks.filter((block) => block.kind === 'line' && block.segment === 'timeline').length
        ? page.blocks.filter((block) => block.kind === 'line' && block.segment === 'timeline')[0].id
        : '',
      spec: specValue,
      data,
      estimate
    };
  });

  const notes = [];
  if (!studentName) notes.push(POSTER_REPORT_STUDENT_MISSING_TEXT);
  if (studentName && !rows.length) notes.push(POSTER_REPORT_PERIOD_EMPTY_TEXT);
  if (studentName && rows.length && !artworks.length) notes.push(POSTER_REPORT_ARTWORK_MISSING_REASON);
  if (studentName && allRows.length > rows.length) notes.push(POSTER_REPORT_LESSON_TRIM_REASON(allRows.length, rows.length));
  if (studentName && summary.reason) notes.push(summary.reason);
  if (studentName && quoteTruncated) notes.push(POSTER_REPORT_QUOTE_TRUNCATED_REASON(quoteTruncated));
  if (studentName && quoteMissing) notes.push(POSTER_REPORT_QUOTE_MISSING_REASON);
  if (studentName && sharePending) notes.push(POSTER_REPORT_SHARE_PENDING_REASON);

  return {
    hasStudent: Boolean(studentName),
    kind: POSTER_REPORT_KIND,
    kindLabel: POSTER_KIND_LABELS[POSTER_REPORT_KIND],
    templateKey: templateRecord ? templateRecord.id : '',
    templateName: templateRecord ? templateRecord.name : '',
    baseSpec,
    spec: pages[0] ? pages[0].spec : baseSpec,
    data,
    studentName,
    period: periodName,
    periodLabel,
    window: { period: window.period, days: window.days, from: window.from, to: window.to },
    teacherName: str(teacherName),
    orgName: str(orgName),
    lessons: rows,
    allLessonCount: allRows.length,
    rows,
    timeline: content.timeline.slice(),
    works: {
      total: rows.length,
      count: artworks.length,
      missing: rows.length > 0 && artworks.length === 0,
      placeholderText: artworks.length ? '' : POSTER_REPORT_WORKS_MISSING_TEXT,
      rows: artworks
    },
    cover: {
      slotId: 'cover',
      url: coverRow ? coverRow.artworkUrl : '',
      title: coverRow ? str(coverRow.title) : '',
      dateDots: coverRow ? str(coverRow.dateDots) : '',
      missing: !coverRow,
      placeholderText: coverRow ? '' : POSTER_REPORT_WORKS_MISSING_TEXT
    },
    summary,
    counts: summary.counts,
    quotes: { truncated: quoteTruncated, missing: quoteMissing, maxChars: POSTER_REPORT_QUOTE_MAX_CHARS },
    shareRecordId: shareRecord ? str(shareRecord.id) : '',
    share: {
      state: share.state,
      stateLabel: share.stateLabel,
      active: Boolean(share.active),
      tokenText: str(share.tokenText),
      link: shareUrl,
      pending: sharePending,
      placeholderText: sharePending ? POSTER_SINGLE_SHARE_PENDING_TEXT : ''
    },
    logo: { url: logoUrl, fallbackText: logoUrl ? '' : str(orgName) },
    layout: {
      width: POSTER_REPORT_WIDTH,
      height: singleHeight,
      renderable,
      maxEdge: POSTER_REPORT_MAX_HEIGHT,
      minHeight: POSTER_REPORT_MIN_HEIGHT,
      segments: POSTER_REPORT_SEGMENTS.slice(),
      coverHeight: Math.round(POSTER_REPORT_LAYOUT.coverHeight * POSTER_REPORT_WIDTH),
      rowThumb: Math.round(POSTER_REPORT_LAYOUT.rowThumb * POSTER_REPORT_WIDTH),
      qrSize: Math.round(POSTER_REPORT_LAYOUT.qrSize * POSTER_REPORT_WIDTH),
      blocks: blocks.length,
      estimate: { ...wholeEstimate, text: estimateText },
      recommendTemplate: POSTER_REPORT_DEFAULT_TEMPLATE_KEY
    },
    degrade: { ...degrade, pageCount: pageList.length },
    pages,
    page: pages[0] || null,
    estimateText,
    notes,
    exportGate: posterReportExportGate({ hasStudent: Boolean(studentName), rows })
  };
}

/**
 * 合成一页的 spec：块 → 占位区（页内绝对 y = 块 y + 块内偏移）。
 * `dy` 与块高都是像素，写进 spec 时一律除以短边 —— 与渲染层「比例坐标」的口径一致。
 */
function composeReportPageSpec({ baseSpec, page, content, data, coverRow }) {
  const S = num(content.shortEdge) || POSTER_REPORT_WIDTH;
  const slots = [];
  page.blocks.forEach((block) => {
    block.slots.forEach((slot) => {
      const { dy = 0, ...rest } = slot;
      slots.push({ ...rest, y: (block.y + dy) / S });
    });
  });
  // 封面缺件：头图位换成一句文字占位（**换类型**，不画空盒子 —— 与 US-303 同一条纪律）。
  const withCover = !coverRow
    ? {
      ...baseSpec,
      slots: slots.map((slot) => (slot.id === 'cover'
        ? {
          id: 'cover',
          type: 'text',
          x: POSTER_REPORT_LAYOUT.marginX,
          y: slot.y,
          w: 1 - POSTER_REPORT_LAYOUT.marginX * 2,
          align: 'center',
          font: 'serif',
          weight: 'normal',
          sizeRatio: POSTER_REPORT_LAYOUT.text.summaryLine.sizeRatio,
          color: POSTER_MUTED_COLORS.deep,
          maxLines: 2,
          lineHeight: POSTER_REPORT_LAYOUT.text.summaryLine.lineHeight,
          letterSpacingRatio: 0,
          template: POSTER_REPORT_WORKS_MISSING_TEXT
        }
        : slot))
    }
    : { ...baseSpec, slots };
  // 分隔线：跟着**头图的下沿**走（自适应高度下模板里那条固定 y 的线没有位置含义），
  // 别的页不画（`coverBlock` 只在第 1 张上）。
  const coverBlock = page.blocks.find((block) => block.kind === 'cover');
  const hairline = withCover.decor && withCover.decor.hairline ? withCover.decor.hairline : null;
  const decor = hairline
    ? {
      hairline: coverBlock
        ? {
          ...hairline,
          visible: true,
          x: POSTER_REPORT_LAYOUT.marginX,
          y: (coverBlock.y + num(coverBlock.coverBottom) + POSTER_REPORT_LAYOUT.blockGap * S * 0.35) / S,
          w: 1 - POSTER_REPORT_LAYOUT.marginX * 2
        }
        : { ...hairline, visible: false }
    }
    : withCover.decor;
  return normalizePosterSpec({
    ...withCover,
    canvas: { width: POSTER_REPORT_WIDTH, height: Math.max(1, Math.round(page.height)) },
    decor,
    slots: withCover.slots
  });
}

/**
 * 同一张长图的**另一张**（分段出多张 / 导出全部）：纯函数，读的是已经算好的分页产物 ——
 * 复算不会与预览那一张出现两种版式（块坐标按同一份内容算，页面只重新定 y）。
 */
export function posterReportPagePlan(plan, pageIndex = 1) {
  const value = isPlainObject(plan) ? plan : {};
  const pages = Array.isArray(value.pages) ? value.pages : [];
  if (!pages.length) return null;
  const index = Math.min(Math.max(1, int(pageIndex) || 1), pages.length);
  const page = pages[index - 1];
  return {
    ...value,
    page,
    spec: page.spec,
    data: value.data,
    layout: { ...value.layout, pageHeight: page.height, pageIndex: page.index, pageTotal: page.total },
    exportGate: value.exportGate
  };
}

/**
 * 导出门：没有学员 / 这个周期一条归档记录都没有时不允许导出，原因就是那句可读文案
 * （与单作品 / 阶段 / 班级三条同一条纪律：不下载一张没有内容的图）。
 * 一幅成品图都没有**不拦**：其余四段（时间线 / 概览 / 码）本身就是内容，作品段如实写占位。
 */
export function posterReportExportGate(plan) {
  const value = isPlainObject(plan) ? plan : {};
  if (!value.hasStudent) return { allowed: false, reason: POSTER_REPORT_STUDENT_MISSING_TEXT };
  const rows = Array.isArray(value.rows) ? value.rows : [];
  if (!rows.length) return { allowed: false, reason: POSTER_REPORT_PERIOD_EMPTY_TEXT };
  return { allowed: true, reason: '' };
}

/**
 * 导出文件名（FR-342 的长图版）：`{学员名}_{周期}_长图.{png|jpg}`；
 * 分段出多张时带页码 `_1of3`（验收原文「..._长图_1of3.png」）。空片段不参与拼接，
 * 非法字符走**装裱导出那一支**（`sanitizeArtworkExportSegment`，别再写一份）。
 */
export function posterReportFilename({ student = '', period = '', extension = 'png', pageIndex = 0, pageTotal = 0 } = {}) {
  const ext = str(extension).toLowerCase() === 'jpg' || str(extension).toLowerCase() === 'jpeg' ? 'jpg' : 'png';
  const segments = [student, resolveArchiveReportPeriod(period)]
    .map(sanitizeArtworkExportSegment)
    .filter(Boolean);
  const pages = int(pageTotal);
  const page = pages > 1 && int(pageIndex) > 0 ? `${int(pageIndex)}of${pages}` : '';
  return [...segments, POSTER_REPORT_FILENAME_LABEL, page].filter(Boolean).join('_') + `.${ext}`;
}

/** 周期可选项（界面渲染这一份；与档案页 / 阶段报告 / 阶段海报同源）。 */
export const POSTER_REPORT_PERIOD_OPTIONS = ARCHIVE_PERIODS.slice();
export { ARCHIVE_PERIOD_DEFAULT as POSTER_REPORT_DEFAULT_PERIOD };
