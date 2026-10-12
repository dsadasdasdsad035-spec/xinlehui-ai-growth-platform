// 阶段成长海报（[海报 US-304] / FR-310、FR-313、FR-323）的数据装配与规则。
//
// 一张阶段成长海报 = **一份模板 spec**（`data/posterTemplates.js` 的参数）+ **一份数据**
// （这位学员在这一个周期里的真实内容）。本模块回答「数据从哪儿来、缺了怎么办」，
// 与 `data/posterSingle.js`（单作品）同一套分工：本模块在 data 层、零依赖之外的纯函数，可 `node` 直跑断言。
//
//   ① 周期口径不另写一套：周期词表 / 窗口 / 过滤全部读 `data/archiveTargets.js`
//      （`ARCHIVE_PERIODS`、`archivePeriodWindow`、`filterArchiveRecordsByPeriod`）——
//      与成长档案页的周期筛选器是**同一支**实现（「一学期」= 最近 180 天的下界，只有下界没有上界，
//      读不出日期的记录留在窗口里）。
//   ② 阶段总结只能来自归档数据聚合：快照走 `buildArchiveReportSnapshot()`、总结句走
//      `archiveReportDigestView()`（阶段报告那一支的唯一实现）；聚合不出内容时写
//      `ARCHIVE_REPORT_INSUFFICIENT_TEXT`（「本阶段数据不足」）——**不套示例文案**。
//   ③ 拼贴只收**有成品图的课次**：每一格走 `archiveRecordMediaView(record, {surface:'teacher'})`
//      （与成长档案 / 家长分享页 / 单作品海报同一支「哪张图能显示」的判据），没有成品图的课次不进格子；
//      一格都不剩时**不留空白**：把拼贴位换成一句占位文案（与 US-303 同一条纪律，见 `posterSingleSpecPatch`）。
//   ④ 网格与上限：档位由 `posterGridShape()` 决定（4 幅内 2×2、6–9 幅 3×3、10–12 幅 3×4），
//      超过上限（默认 12）按课次**均匀精选**（`posterEvenSample`，首尾必取、顺序不变），
//      并给出一句「共 N 幅，已收录 M 幅」的提示（`posterPeriodTrimNote`，验收原文）。
//   ⑤ 缺件不编：没有有效分享 → 二维码位换成「分享链接待生成」的文字位；机构没有 Logo 图 →
//      Logo 位用机构名代替。两条都复用 `data/posterSingle.js` 的占位补丁与文案（不写第二份）。
//
// 真正落笔的在 `services/posterPeriod.js`（预览 `scale=1`、导出 `scale=2`，同一个 `renderPoster`）。

import {
  POSTER_CANVAS_PRESETS,
  POSTER_GRID_MAX_ITEMS_DEFAULT,
  POSTER_KIND_LABELS,
  normalizePosterSpec,
  normalizePosterTemplate,
  posterEvenSample,
  posterGridShape,
  posterImageUrl,
  seedPosterTemplates
} from './posterTemplates';
import {
  posterSingleLogoFallbackNote,
  posterSingleSpecPatch
} from './posterSingle';
import {
  ARCHIVE_PERIOD_DEFAULT,
  ARCHIVE_PERIODS,
  ARCHIVE_TARGET_PERSONAL,
  archivePeriodWindow,
  archiveTargetView,
  filterArchiveRecordsByPeriod
} from './archiveTargets';
import {
  ARCHIVE_REPORT_INSUFFICIENT_TEXT,
  archiveReportDigestView,
  buildArchiveReportSnapshot,
  resolveArchiveReportPeriod
} from './archiveReports';
import { archiveRecordMediaView } from './archiveMedia';
import { formatLessonDateDots, normalizeLessonDate } from './lessons';
import { shareTokenUrl, shareTokenView } from './shareTokens';
import { sanitizeArtworkExportSegment } from './artworkExport';
// 海报二维码与分享令牌联动（[海报 US-313]）：plan 的 `share` 段（含「只画一个二维码」读数）
// 与其它四类版式共用 `data/posterShareQr.js` 这一支装配点。
import { posterShareQrShareView } from './posterShareQr';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();
const int = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0);

/**
 * 「今天」的归一：**必须先落到一个真 Date** 再交给周期函数。
 * 直接把 `null` 传下去会被 `new Date(null)` 读成「1970-01-01」（epoch 不是「无效值」），
 * 窗口因此被算成一个 1970 年的空区间 —— 这是 `archivePeriodWindow()` 的既有口径，
 * 本模块不重复判一遍，只保证自己永远递一个有效 Date。
 */
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

/** 阶段成长海报的画布（FR-313 的阶段版）：1080×1920。 */
export const POSTER_PERIOD_KIND = 'period';
export const POSTER_PERIOD_CANVAS = { ...POSTER_CANVAS_PRESETS.period };

/** 拼贴的收录上限（默认 12 幅；超过时按课次均匀精选）。 */
export const POSTER_PERIOD_MAX_CELLS = POSTER_GRID_MAX_ITEMS_DEFAULT;

/** 默认选用的内置阶段模板：自适应网格那套（固定九宫格那套做不到 10–12 幅 → 3×4）。 */
export const POSTER_PERIOD_DEFAULT_TEMPLATE_KEY = 'poster-oak-period';

/** 阶段总结位在数据不足时写的那句话（验收原文；与阶段报告的同一句常量同源）。 */
export const POSTER_PERIOD_INSUFFICIENT_TEXT = ARCHIVE_REPORT_INSUFFICIENT_TEXT;

/** 数据不足时的可读原因（为什么这里没有总结，不糊一句「请完善信息」）。 */
export const POSTER_PERIOD_INSUFFICIENT_REASON = '这个周期里还没有可聚合的归档记录：阶段总结位写「本阶段数据不足」，不用示例文案填充。';

/** 一位学员在周期内一幅成品图都没有时的可读原因（拼贴位显示占位文案，不留空白）。 */
export const POSTER_PERIOD_ARTWORK_MISSING_REASON = '这个周期里还没有可收录的成品作品图：拼贴位显示占位文案，导出被拦下。';

/** 还没有可选学员 / 一条归档记录都没有时的空态（不渲染一张空白海报）。 */
export const POSTER_PERIOD_STUDENT_MISSING_TEXT = '还没有可生成阶段海报的归档记录：先完成课后反馈的归档，再来生成阶段成长海报。';

/** 导出被拦下时的可读标题（与单作品那一支同口径）。 */
export const POSTER_PERIOD_EXPORT_BLOCKED_TITLE = '暂时不能导出这张海报';

/**
 * 自适应网格的三个档位（验收原文的机器判据：4 幅 → 2×2、6–9 幅 → 3×3、10–12 幅 → 3×4）。
 * 真正的行列数由 `posterGridShape()` 算出来 —— 这里只把「验收要求的是哪三档」写下来，
 * 由断言逐档比对两者一致（不另写一份网格实现）。
 */
export const POSTER_PERIOD_GRID_STEPS = [
  { max: 4, columns: 2, rows: 2 },
  { max: 9, columns: 3, rows: 3 },
  { max: 12, columns: 3, rows: 4 }
];

// ---------------------------------------------------------------------------
// 周期、网格与收录提示（纯读数）
// ---------------------------------------------------------------------------

/** 窗口 → 一句周期文案（`posterPeriodLabel` 与装配层共用同一份拼法）。 */
function periodLabelFromWindow(name, window) {
  const from = formatLessonDateDots(window.from);
  const to = formatLessonDateDots(window.to);
  return from && to ? `${name}（${from} – ${to}）` : name;
}

/**
 * 周期文案：`一学期（2026.04.16 – 2026.10.12）`。
 * 窗口读 `archivePeriodWindow()`（与档案页筛选器同一支）；认不出日期时只给周期名，不编一段窗口。
 */
export function posterPeriodLabel(period, today = null) {
  const name = resolveArchiveReportPeriod(period);
  return periodLabelFromWindow(name, archivePeriodWindow(name, resolvedToday(today)));
}

/**
 * 拼贴网格的读数：`{ columns, rows, capacity, count, total, trimmed, adaptive, label }`。
 * 行列数完全由 `posterGridShape()` 决定（模板自己写了固定行列时以模板为准）。
 */
export function posterPeriodGrid(count, { maxItems = POSTER_PERIOD_MAX_CELLS } = {}) {
  const shape = posterGridShape({ columns: 0, rows: 0, count, maxItems });
  return { ...shape, label: `${shape.columns}×${shape.rows}` };
}

/** 超过上限时的那句提示（验收原文「共 N 幅，已收录 M 幅」）；没有超上限时是空串。 */
export function posterPeriodTrimNote(total, shown) {
  const all = int(total);
  const kept = int(shown);
  if (all <= kept) return '';
  return `共 ${all} 幅，已收录 ${kept} 幅`;
}

// ---------------------------------------------------------------------------
// 模板选择
// ---------------------------------------------------------------------------

/** 拼贴位（`collage` 优先，其次第一个自适应网格的 image 位，最后第一个 image 位）。 */
export function posterPeriodCollageSlot(spec) {
  const normalized = normalizePosterSpec(spec);
  const images = normalized.slots.filter((slot) => slot.type === 'image');
  return images.find((slot) => slot.id === 'collage'
      && Number(slot.grid.columns) <= 0 && Number(slot.grid.rows) <= 0)
    || images.find((slot) => slot.id === 'collage')
    || images.find((slot) => Number(slot.grid.columns) <= 0 && Number(slot.grid.rows) <= 0)
    || images[0]
    || null;
}

/**
 * 选一张阶段模板：优先内置的自适应阶段模板 → 任意启用的自适应阶段模板 → 第一套启用的阶段模板。
 * 传入的列表（云端 / 本机镜像）先过 `normalizePosterTemplate`，脏记录不进结果。
 */
export function findPosterPeriodTemplate(templates = seedPosterTemplates) {
  const list = (Array.isArray(templates) ? templates : []).map(normalizePosterTemplate).filter((item) => item.id);
  const periods = list.filter((item) => item.kind === POSTER_PERIOD_KIND && item.enabled !== false);
  const adaptive = periods.filter((item) => {
    const slot = posterPeriodCollageSlot(item.spec);
    return Boolean(slot) && Number(slot.grid.columns) <= 0 && Number(slot.grid.rows) <= 0;
  });
  return adaptive.find((item) => item.id === POSTER_PERIOD_DEFAULT_TEMPLATE_KEY)
    || adaptive.find((item) => item.isDefault)
    || adaptive[0]
    || periods.find((item) => item.id === POSTER_PERIOD_DEFAULT_TEMPLATE_KEY)
    || periods[0]
    || null;
}

// ---------------------------------------------------------------------------
// 阶段总结（只从归档聚合里来）
// ---------------------------------------------------------------------------

/**
 * 海报上的短句：取报告那一句**冒号之前**的部分（一个字都不改写）；
 * 没有冒号（如「五个维度在每一节课上都有原文，雷达是完整的。」）就原样用。
 * 为什么砍掉冒号后的明细：报告里那半句是「美术能力（51/52 节课）」这样的逐维清单，
 * 海报的总结位只有三行（`maxLines: 3`），搬上去必然被省略号吃掉 —— 海报要的是那句话本身。
 */
function posterPeriodShortSentence(sentence) {
  const text = str(sentence);
  const cut = text.indexOf('：');
  return cut > 0 ? `${text.slice(0, cut)}。` : text;
}

/**
 * 阶段总结：`{ text, lines, insufficient, counts }`。
 *  - 周期内一节课都没有 → 只有一句「本阶段数据不足」（验收原文）；
 *  - 有课次时：第一行是聚合出来的数字句（课次 / 作品 / 照片 / 缺课），第二行是五维点评原文的覆盖情况
 *    —— 两句都来自 `archiveReportDigestView()`（阶段报告那一支的唯一实现），第二行只取短句；
 *  - 五维一段原文都没有时第二行同样写「本阶段数据不足」（宁缺毋滥，不套示例文案）。
 */
export function posterPeriodSummary(snapshot) {
  const source = isPlainObject(snapshot) ? snapshot : {};
  const counts = {
    lessons: int(source.lessonCount),
    artworks: int(source.artworkCount),
    photos: int(source.photoCount),
    absence: int(source.absenceCount)
  };
  if (!counts.lessons) {
    return {
      text: POSTER_PERIOD_INSUFFICIENT_TEXT,
      lines: [POSTER_PERIOD_INSUFFICIENT_TEXT],
      insufficient: true,
      reason: POSTER_PERIOD_INSUFFICIENT_REASON,
      counts
    };
  }
  const digest = archiveReportDigestView(source);
  const lines = digest.insufficient
    ? [digest.lines[0], POSTER_PERIOD_INSUFFICIENT_TEXT]
    : [digest.lines[0], posterPeriodShortSentence(digest.lines[1] || '')].filter(Boolean);
  return {
    text: lines.join('\n'),
    lines,
    insufficient: digest.insufficient,
    reason: digest.insufficient ? POSTER_PERIOD_INSUFFICIENT_REASON : '',
    coveredDimensions: digest.coveredDimensions,
    counts
  };
}

// ---------------------------------------------------------------------------
// 拼贴素材（只收有成品图的课次，按课次顺序）
// ---------------------------------------------------------------------------

/**
 * 一个周期的拼贴素材：**有成品图的课次**一幅一条，顺序 = 课次顺序（记录列表本就按日期升序）。
 * 每条 `{ url, caption, date, title, recordId, recordKey }`：`caption` 是展签口径的课次日期
 * （「每格下方可选标注课次日期」的数据源），没有日期的课次留空而不是编一天。
 */
export function posterPeriodCollageEntries(records = []) {
  return (Array.isArray(records) ? records : [])
    .filter(isPlainObject)
    .map((record) => {
      const media = archiveRecordMediaView(record, { surface: 'teacher' });
      const url = str(media.artwork && media.artwork.url);
      if (!url) return null;
      const date = normalizeLessonDate(record.lessonDate || record.date);
      return {
        url,
        caption: date ? formatLessonDateDots(date) : '',
        date,
        title: str(record.title),
        recordId: str(record.id),
        recordKey: str(record.recordKey)
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 数据装配（这一步之后，界面只要 `spec` + `data` 就能渲染）
// ---------------------------------------------------------------------------

/**
 * 装配一张阶段成长海报：`{ spec, data, ...读数 }`。
 *
 * 入参：
 *  - `records` = 归档记录列表（全量；按「学员 + 周期」过滤在本模块里做）；
 *  - `student` = 这一张海报属于哪一位孩子（读不出来给空态，不渲染空白海报）；
 *  - `period` = `半学期 | 一学期 | 一年度`（脏值回落默认「一学期」）；
 *  - `record` = 二维码指向的那条记录（缺省时取周期内**最新**的一条：阶段海报的分享入口）；
 *  - `today` = 可注入的「今天」（周期窗口与快照都读它；断言与界面因此读同一份）；
 *  - `dateCaptions` = 每格下方的课次日期标注开关（默认开 —— 模板参数，这里只做开关）。
 */
export function buildPosterPeriodPlan({
  records = [],
  student = '',
  period = '',
  record = null,
  today = null,
  tokens = [],
  now = null,
  teacherName = '',
  orgName = '',
  logo = '',
  origin = '',
  spec = null,
  template = null,
  maxCells = POSTER_PERIOD_MAX_CELLS,
  dateCaptions = true
} = {}) {
  const studentName = str(student);
  const periodName = resolveArchiveReportPeriod(period);
  const todayValue = resolvedToday(today);
  const window = archivePeriodWindow(periodName, todayValue);
  const periodLabel = periodLabelFromWindow(periodName, window);
  const templateRecord = template ? normalizePosterTemplate(template) : findPosterPeriodTemplate();
  const baseSpec = normalizePosterSpec(spec || (templateRecord && templateRecord.spec) || undefined);
  const limit = Math.max(1, int(maxCells) || POSTER_PERIOD_MAX_CELLS);

  // 「学员 + 周期」的记录：对象过滤与周期过滤都走档案页那一支（未选学员 = 空列表，不是全部记录）。
  const targetView = archiveTargetView(records, { target: ARCHIVE_TARGET_PERSONAL, student: studentName });
  const inPeriod = studentName
    ? filterArchiveRecordsByPeriod(targetView.lessons, periodName, todayValue)
    : [];
  // 没有成品图的记录只参与聚合（有课次、有照片也是数据），不进拼贴格。
  const allEntries = posterPeriodCollageEntries(inPeriod);
  const entries = posterEvenSample(allEntries, limit);
  const grid = posterPeriodGrid(entries.length, { maxItems: limit });
  const trimNote = posterPeriodTrimNote(allEntries.length, entries.length);

  // 快照由阶段报告那一支聚合（对象 + 周期的过滤规则同一份）；`todayValue` 必须显式传，
  // 不传时它的默认值是 `undefined` → 用当前时间，注入的「今天」就失效了。
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

  // 阶段海报的分享入口：`record`（这一步刚归档 / 正在看的那一条）优先，否则周期内最新的一条。
  const shareRecord = isPlainObject(record) && str(record.student) === studentName
    ? record
    : [...inPeriod].reverse().find((item) => str(item.student) === studentName) || null;
  const share = shareRecord
    ? shareTokenView({ tokens, recordId: shareRecord.id, now })
    : { state: 'none', stateLabel: '', active: false, tokenText: '', link: '' };
  const shareUrl = share.active && share.tokenText ? shareTokenUrl(share.tokenText, { origin }) : '';
  const sharePending = !shareUrl;
  // plan 的 `share` 段（[海报 US-313]）：与单作品海报同一支装配 —— 链接 / 有效期读数 /
  // 二维码位那句按状态分档的占位文案 / 「只画一个二维码」读数。
  const shareView = posterShareQrShareView({
    state: share.state,
    stateLabel: share.stateLabel,
    active: share.active,
    tokenText: share.tokenText,
    link: shareUrl,
    path: share.link,
    expiresText: share.expiresText,
    daysLeft: share.daysLeft,
    spec: baseSpec
  });

  const logoUrl = posterImageUrl(logo);
  const logoFallback = !logoUrl ? str(orgName) : '';
  const fallbackReason = logoUrl
    ? ''
    : (str(logo) ? '机构标识地址不是图片地址：Logo 位改用机构名代替。' : posterSingleLogoFallbackNote(logoFallback));
  const artworkMissing = entries.length === 0;

  // 缺件补丁：拼贴位（一幅都没有时）/ 二维码位（没有有效分享）/ Logo 位（没有标识图）三种空位
  // 都**换类型**成文字位 —— 与 US-303 共用同一支实现，位置尺寸一字不动。
  const patched = posterSingleSpecPatch(baseSpec, {
    artworkMissing,
    sharePending,
    logoFallback,
    imagePlaceholderText: POSTER_PERIOD_INSUFFICIENT_TEXT,
    sharePendingText: shareView.placeholderText
  });
  const collageSlot = posterPeriodCollageSlot(baseSpec);
  // `dateCaptions` 默认开（模板参数就是开）：只有显式关掉时才把那一格的 `cellCaption.visible` 拨成 false
  // —— 除此之外什么也不动（位置 / 尺寸 / 圆角 / 边框一个字都不改）。
  const spec2 = dateCaptions === false && collageSlot
    ? {
      ...patched,
      slots: patched.slots.map((slot) => (slot.type === 'image' && slot.id === collageSlot.id
        ? { ...slot, cellCaption: { ...slot.cellCaption, visible: false } }
        : slot))
    }
    : patched;

  const data = {
    studentName,
    period: periodLabel,
    artworkCount: String(allEntries.length),
    summary: summary.text,
    teacherName: str(teacherName),
    orgName: str(orgName),
    // 拼贴素材（keyed 形状：只喂命中的占位区，渲染层不猜素材）；地址过渲染层的素材闸。
    images: { [collageSlot ? collageSlot.id : 'collage']: entries.map((entry) => ({ url: entry.url, caption: entry.caption })) },
    logo: logoUrl,
    shareUrl
  };

  const notes = [];
  if (!studentName) notes.push(POSTER_PERIOD_STUDENT_MISSING_TEXT);
  if (studentName && summary.reason) notes.push(summary.reason);
  if (studentName && artworkMissing) notes.push(POSTER_PERIOD_ARTWORK_MISSING_REASON);
  if (studentName && trimNote) notes.push(`${trimNote}（按课次均匀精选；每格最多 ${limit} 幅）。`);
  if (studentName && sharePending) notes.push(`没有有效的分享链接：二维码位显示「${shareView.placeholderText}」而不是空白方块。`);
  if (studentName && shareView.qr.note) notes.push(shareView.qr.note);
  if (studentName && fallbackReason) notes.push(fallbackReason);

  return {
    hasStudent: Boolean(studentName),
    kind: POSTER_PERIOD_KIND,
    kindLabel: POSTER_KIND_LABELS[POSTER_PERIOD_KIND],
    templateKey: templateRecord ? templateRecord.id : '',
    templateName: templateRecord ? templateRecord.name : '',
    baseSpec,
    spec: spec2,
    data,
    studentName,
    period: periodName,
    periodLabel,
    window: { period: window.period, days: window.days, from: window.from, to: window.to },
    teacherName: str(teacherName),
    orgName: str(orgName),
    collage: {
      slotId: collageSlot ? collageSlot.id : '',
      total: allEntries.length,
      count: entries.length,
      trimmed: Math.max(0, allEntries.length - entries.length),
      note: trimNote,
      dateCaptions: Boolean(dateCaptions),
      grid,
      entries
    },
    summary,
    counts: summary.counts,
    dateCaptions: Boolean(dateCaptions),
    shareRecordId: shareRecord ? str(shareRecord.id) : '',
    share: shareView,
    logo: { url: logoUrl, fallbackText: logoFallback },
    notes,
    exportGate: posterPeriodExportGate({
      hasStudent: Boolean(studentName),
      collage: { count: entries.length }
    })
  };
}

/**
 * 导出门：没有学员 / 一幅成品图都收不进来时不允许导出，原因就是那句可读文案
 * （与单作品海报的「作品缺失拦导出」同一条纪律：不下载一张没有内容的图）。
 */
export function posterPeriodExportGate(plan) {
  const value = isPlainObject(plan) ? plan : {};
  if (!value.hasStudent) return { allowed: false, reason: POSTER_PERIOD_STUDENT_MISSING_TEXT };
  if (!int(value.collage && value.collage.count)) {
    return { allowed: false, reason: `${POSTER_PERIOD_INSUFFICIENT_TEXT}：${POSTER_PERIOD_ARTWORK_MISSING_REASON}` };
  }
  return { allowed: true, reason: '' };
}

/**
 * 导出文件名（FR-342 的阶段版）：`{学员名}_{周期}_成长海报.{png|jpg}`。
 * 空片段不参与拼接，非法字符走**装裱导出那一支**（`sanitizeArtworkExportSegment`，别再写一份）。
 */
export function posterPeriodFilename({ student = '', period = '', extension = 'png' } = {}) {
  const ext = str(extension).toLowerCase() === 'jpg' || str(extension).toLowerCase() === 'jpeg' ? 'jpg' : 'png';
  const segments = [student, resolveArchiveReportPeriod(period)]
    .map(sanitizeArtworkExportSegment)
    .filter(Boolean);
  return [...segments, '成长海报'].join('_') + `.${ext}`;
}

/** 周期可选项（界面渲染这一份；与档案页 / 阶段报告同源）。 */
export const POSTER_PERIOD_OPTIONS = ARCHIVE_PERIODS.slice();
export { ARCHIVE_PERIOD_DEFAULT as POSTER_PERIOD_DEFAULT_PERIOD };
