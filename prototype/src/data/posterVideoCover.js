// 成长视频封面海报（[海报 US-306] / FR-316、FR-323、FR-345）的数据装配与规则。
//
// 一张视频封面 = **一份模板 spec**（`data/posterTemplates.js` 的 `video-cover` 版式）+ **一份数据**
// （这位孩子在这个周期里的真实内容）。本模块回答「数据从哪儿来、缺了怎么办」，与
// `data/posterSingle.js`（单作品）/ `data/posterPeriod.js`（阶段）/ `data/posterClass.js`（班级）
// 同一套分工：data 层零依赖纯函数，只 import 其它 data 模块，可 `node` 直跑断言。
//
//   ① **画布与成长视频同比例**（US-306 第 1 条 / FR-316）：画布取 `POSTER_CANVAS_PRESETS['video-cover']`
//      （1080×1920），比例判据读视频模块自己的输出口径 `VIDEO_PERSONAL_RENDER`（竖屏 1080×1920 · 9:16）
//      —— 两边**不是各写一半**：视频改口径，这里 `posterVideoCoverRatio().ok` 会当场变红。
//      主视觉只做 `contain` 等比缩放与留边（FR-309），不裁切、不调色、更不拉伸。
//   ② **时长角标与视频模块状态联动**（US-306 第 4 条）：时长只有一个来源 —— 成片记录的
//      **成片三件套**（`videoOutputView()`，与 `services/poster.js` 的预览 / 下载 / 分享同一支判据）。
//      演示队列的字段白名单把 `outputUrl / durationSec / bytes` 清空，所以「任务跑到 100%」也拿不到时长
//      —— 这时角标写**占位**（`POSTER_VIDEO_COVER_DURATION_PLACEHOLDER`）且导出门拦下（`posterVideoCoverExportGate`），
//      绝不编一个数字顶上。任务状态（渲染中 / 已完成 / 失败…）只用于那句可读说明。
//   ③ 主视觉取**本周期最新一幅有成品图的作品**（`archiveRecordMediaView`，与成长档案 / 家长分享页 /
//      其它海报同一支「哪张图能显示」的判据）；一幅都没有时主视觉位换成占位文案并拦下导出。
//   ④ 二维码指向**成片分享链接**：有效令牌走 `activeVideoShareToken()`（撤回 / 过期都不算数）；
//      没有有效链接时二维码位换成「分享链接待生成」的文字位（与 US-303 共用同一支占位补丁）。
//   ⑤ 缺件不编：没有有效分享 → 二维码位文字占位；机构没有 Logo 图 → Logo 位用机构名代替。
//
// 真正落笔的在 `services/posterVideoCover.js`（预览 `scale=1`、导出 `scale=2`，同一个 `renderPoster`）。

import {
  POSTER_CANVAS_PRESETS,
  POSTER_KIND_LABELS,
  normalizePosterSpec,
  normalizePosterTemplate,
  posterImageUrl,
  seedPosterTemplates
} from './posterTemplates';
import {
  POSTER_SINGLE_ARTWORK_MISSING_TEXT,
  posterSingleLogoFallbackNote,
  posterSingleSpecPatch
} from './posterSingle';
// 海报二维码与分享令牌联动（[海报 US-313]）：plan 的 `share` 段（含状态文案与「只画一个二维码」读数）
// 与其它四类版式共用 `data/posterShareQr.js` 这一支装配点。
import { posterShareQrShareView } from './posterShareQr';
import {
  ARCHIVE_PERIOD_DEFAULT,
  ARCHIVE_PERIODS,
  archivePeriodWindow,
  filterArchiveRecordsByPeriod
} from './archiveTargets';
import { resolveArchiveReportPeriod } from './archiveReports';
import { archiveRecordMediaView } from './archiveMedia';
import { formatLessonDateDots, normalizeLessonDate } from './lessons';
import { shareTokenUrl } from './shareTokens';
import { VIDEO_JOB_DEMO_DONE_NOTE, normalizeVideoJobType, videoJobKey, videoJobStatusLabel, videoJobTypeLabel } from './videoJobs';
import { findVideoRecord, videoRecordKey } from './videoRecords';
import { activeVideoShareToken, videoOutputView, videoSharePanelView } from './videoShare';
import { VIDEO_PERSONAL_RENDER } from './videoPersonal';
import { sanitizeArtworkExportSegment } from './artworkExport';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();
const int = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0);

/** 「今天」的归一：**必须先落到一个真 Date** 再交给周期函数（`new Date(null)` = 1970 的口径见 posterPeriod）。 */
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

/** 成长视频封面（FR-316 的第五类版式）。 */
export const POSTER_VIDEO_COVER_KIND = 'video-cover';
/** 画布 1080×1920：与成长视频的输出口径**同比例**（9:16）。 */
export const POSTER_VIDEO_COVER_CANVAS = { ...POSTER_CANVAS_PRESETS[POSTER_VIDEO_COVER_KIND] };

/** 默认选用的内置封面模板（US-302a 里唯一一套 `video-cover`）。 */
export const POSTER_VIDEO_COVER_DEFAULT_TEMPLATE_KEY = 'poster-ink-video-cover';

/** 主视觉占位区的角色 id（与自检夹具的 `SELF_CHECK_SINGLE_IMAGE_SLOTS` 同一约定：单图位）。 */
export const POSTER_VIDEO_COVER_SLOT_ID = 'cover';

/**
 * 四条**叠加件**（US-306 第 2 条：成长记录标题 / 周期 / 时长角标 / 播放图标）：
 * 它们的 id 就是内置模板里的占位区 id，界面与断言读这一份（模板被改坏时如实点名缺哪一条）。
 */
export const POSTER_VIDEO_COVER_OVERLAYS = [
  { id: 'title', role: '标题', label: '成长记录标题' },
  { id: 'student', role: '周期', label: '学员与周期' },
  { id: 'duration', role: '时长角标', label: '时长角标' },
  { id: 'play', role: '播放图标', label: '播放图标' }
];

/** 播放图标（内置模板里用衬线实心三角字符表达；四种占位区里没有「图形」这一类）。 */
export const POSTER_VIDEO_COVER_PLAY_ICON = '▶';

/** 标题槽的默认文字（内置模板就是这一句；模板是可改的参数，所以这里只作为「出厂值」的读取口径）。 */
export const POSTER_VIDEO_COVER_TITLE_TEXT = '成长记录';

/** 成片未产出时角标上的**占位**（US-306 第 4 条：占位且不可导出）。 */
export const POSTER_VIDEO_COVER_DURATION_PLACEHOLDER = '待生成';

/** 竖屏口径的别名（界面与断言不自己写 9:16 —— 读视频模块那一份）。 */
export const POSTER_VIDEO_COVER_VIDEO_RENDER = {
  width: VIDEO_PERSONAL_RENDER.width,
  height: VIDEO_PERSONAL_RENDER.height,
  aspect: VIDEO_PERSONAL_RENDER.aspect
};

/** 还没有可生成的归档记录时的空态（不渲染一张空白海报）。 */
export const POSTER_VIDEO_COVER_OBJECT_MISSING_TEXT = '还没有可生成封面的归档记录：先完成课后反馈的归档，再来给成长视频配一张封面。';

/**
 * 主视觉缺件时**画面上**的那句占位短句：与单作品海报同一句（`POSTER_SINGLE_ARTWORK_MISSING_TEXT`）——
 * 两处的意思是一样的（这一幅还没有成品图），短语只留一份，别写第二个字符串。
 */
export const POSTER_VIDEO_COVER_ARTWORK_MISSING_TEXT = POSTER_SINGLE_ARTWORK_MISSING_TEXT;

/** 这个周期里一幅成品图都没有时的可读原因（主视觉位显示占位文案，导出被拦下）。 */
export const POSTER_VIDEO_COVER_ARTWORK_MISSING_REASON = '这个周期里还没有可收录的成品作品图：主视觉位显示占位文案，导出被拦下。';

/** 成片还没产出时的可读原因（导出门与面板提示读同一句，验收原文的「占位且不可导出」）。 */
export const POSTER_VIDEO_COVER_PENDING_REASON = `这条成长视频还没有成片（渲染服务未给出成片三件套）：时长角标先显示占位「时长 ${POSTER_VIDEO_COVER_DURATION_PLACEHOLDER}」，导出被拦下 —— 先在视频模块生成成片。`;

/** 导出被拦下时的可读标题（与其它海报同一口径）。 */
export const POSTER_VIDEO_COVER_EXPORT_BLOCKED_TITLE = '暂时不能导出这张封面';

/** 周期可选项（界面渲染这一份；与档案页 / 阶段报告 / 视频模块同源）。 */
export const POSTER_VIDEO_COVER_OPTIONS = ARCHIVE_PERIODS.slice();
export const POSTER_VIDEO_COVER_DEFAULT_PERIOD = ARCHIVE_PERIOD_DEFAULT;

/**
 * 时长角标为什么是占位的可读说明（一个函数唯一产出这句话，界面不许自己拼）：
 * 任务在跑就点明任务状态，模板不出片就直说，连记录都没有就说清「还没有成片记录」。
 */
export function posterVideoCoverPendingNote({ status = '', statusLabel = '', jobPresent = false, recordPresent = false } = {}) {
  const state = str(status);
  if (state === 'done') return `${VIDEO_JOB_DEMO_DONE_NOTE}时长角标先显示占位。`;
  if (state) return `视频${jobPresent ? '任务' : ''}${str(statusLabel) ? `「${str(statusLabel)}」` : ''}：成片还没有产出，时长角标先显示占位。`;
  if (recordPresent) return '这条成片记录还没有成片三件套（地址 / 时长 / 体积）：时长角标先显示占位，导出被拦下。';
  return '还没有这条成长视频的成片记录：时长角标先显示占位，导出被拦下 —— 先在视频模块生成成片。';
}

// ---------------------------------------------------------------------------
// 画布比例与主视觉（「与成长视频同比例、不拉伸」的机器判据）
// ---------------------------------------------------------------------------

/** 主视觉占位区（`cover` 优先，其次第一个 image 位；没有就返回 null）。 */
export function posterVideoCoverSlot(spec) {
  const normalized = normalizePosterSpec(spec);
  const images = normalized.slots.filter((slot) => slot.type === 'image');
  return images.find((slot) => slot.id === POSTER_VIDEO_COVER_SLOT_ID) || images[0] || null;
}

/**
 * 画布与成长视频的比例读数：`{ ok, canvas, video, ratioLabel, fit, note }`。
 * `ok = false` 不会改版式 —— 它是给面板与断言看的读数（模板是参数，改参数不改代码）。
 */
export function posterVideoCoverRatio(spec) {
  const normalized = normalizePosterSpec(spec);
  const canvas = normalized.canvas;
  const slot = posterVideoCoverSlot(normalized);
  const canvasRatio = canvas.height > 0 ? canvas.width / canvas.height : 0;
  const videoRatio = VIDEO_PERSONAL_RENDER.height > 0
    ? VIDEO_PERSONAL_RENDER.width / VIDEO_PERSONAL_RENDER.height
    : 0;
  const ok = Boolean(slot) && Math.abs(canvasRatio - videoRatio) < 1e-6;
  const canvasLabel = `${canvas.width}×${canvas.height}`;
  const videoLabel = `${VIDEO_PERSONAL_RENDER.width}×${VIDEO_PERSONAL_RENDER.height}（${VIDEO_PERSONAL_RENDER.aspect}）`;
  return {
    ok,
    canvas: { width: canvas.width, height: canvas.height },
    canvasLabel,
    canvasRatio,
    video: { ...POSTER_VIDEO_COVER_VIDEO_RENDER },
    videoLabel,
    ratioLabel: VIDEO_PERSONAL_RENDER.aspect,
    videoRatio,
    fit: slot ? slot.fit : '',
    note: slot
      ? (ok
        ? `画布 ${canvasLabel} 与成长视频 ${videoLabel} 同比例：主视觉按 contain 等比缩放居中，不裁切、不拉伸。`
        : `画布 ${canvasLabel} 与成长视频 ${videoLabel} 不是同比例：封面会被拉伸或留白异常，请把模板画布改回 ${videoLabel}。`)
      : '这份模板里没有主视觉位（image 占位区）。'
  };
}

// ---------------------------------------------------------------------------
// 四条叠加件（标题 / 周期 / 时长角标 / 播放图标）
// ---------------------------------------------------------------------------

/**
 * 四条叠加件的读数：`{ present, missing, rows, issue, titleText, playIcon, periodLabel, durationBadgeText }`。
 * 模板被后台改过时（某一条被删掉 / 关掉）如实点名缺哪一条，而不是渲染一张「少一样东西」的封面。
 */
export function posterVideoCoverOverlays(spec, { periodLabel = '', durationBadgeText = '' } = {}) {
  const normalized = normalizePosterSpec(spec);
  const rows = POSTER_VIDEO_COVER_OVERLAYS.map((item) => {
    const slot = normalized.slots.find((entry) => entry.id === item.id) || null;
    return {
      id: item.id,
      role: item.role,
      label: item.label,
      present: Boolean(slot) && slot.visible !== false,
      type: slot ? slot.type : '',
      template: slot ? str(slot.template) : ''
    };
  });
  const missing = rows.filter((row) => !row.present);
  const titleRow = rows.find((row) => row.id === 'title') || null;
  const playRow = rows.find((row) => row.id === 'play') || null;
  return {
    rows,
    present: missing.length === 0,
    missing: missing.map((row) => row.label),
    issue: missing.length
      ? `这份模板缺少叠加件：${missing.map((row) => row.label).join('、')} —— 封面要同时有「成长记录」标题、周期、时长角标与播放图标。`
      : '',
    titleText: titleRow ? titleRow.template : '',
    playIcon: playRow ? playRow.template : '',
    periodLabel: str(periodLabel),
    durationBadgeText: str(durationBadgeText)
  };
}

// ---------------------------------------------------------------------------
// 模板选择
// ---------------------------------------------------------------------------

/** 选一张封面模板：优先内置封面模板 → 任意启用的封面模板；脏记录不进结果。 */
export function findPosterVideoCoverTemplate(templates = seedPosterTemplates) {
  const list = (Array.isArray(templates) ? templates : [])
    .map(normalizePosterTemplate)
    .filter((item) => item.id);
  const covers = list.filter((item) => item.kind === POSTER_VIDEO_COVER_KIND && item.enabled !== false);
  return covers.find((item) => item.id === POSTER_VIDEO_COVER_DEFAULT_TEMPLATE_KEY)
    || covers.find((item) => item.isDefault)
    || covers[0]
    || null;
}

// ---------------------------------------------------------------------------
// 与视频模块的联动（时长角标 / 分享二维码）
// ---------------------------------------------------------------------------

/**
 * 时长角标视图：`{ ready, from, durationText, badgeText, placeholder, status, statusLabel, note, … }`。
 *
 * 时长只在**成片三件套齐全**时才成立（`videoOutputView`，与视频模块预览 / 下载 / 分享同一支判据）：
 * 成片记录优先（它是成片本身的载体），其次任务上挂的输出（渲染服务接入后走这条路）。
 * 演示队列的字段白名单把三件套清空，所以「任务 100%」也拿不到时长 —— 这就是「尚未生成」的判据。
 */
export function posterVideoCoverDurationView({ record = null, job = null } = {}) {
  const stored = isPlainObject(record) ? record : null;
  const task = isPlainObject(job) ? job : null;
  const recordOutput = videoOutputView(stored);
  const jobOutput = videoOutputView(task);
  const from = recordOutput.ready ? 'record' : (jobOutput.ready ? 'job' : '');
  const output = from === 'record' ? recordOutput : jobOutput;
  const ready = Boolean(from);
  const status = task ? str(task.status) : '';
  const statusLabel = status ? videoJobStatusLabel(status) : '';
  const durationText = ready ? output.durationText : '';
  return {
    ready,
    from,
    durationSec: ready ? output.durationSec : 0,
    durationText,
    bytes: ready ? output.bytes : 0,
    bytesText: ready ? output.bytesText : '',
    badgeText: `时长 ${ready ? durationText : POSTER_VIDEO_COVER_DURATION_PLACEHOLDER}`,
    placeholder: ready ? '' : POSTER_VIDEO_COVER_DURATION_PLACEHOLDER,
    recordPresent: Boolean(stored),
    jobPresent: Boolean(task),
    status,
    statusLabel,
    note: ready
      ? `时长角标取成片记录的真实时长（${from === 'record' ? '成片记录' : '任务输出'}）：${durationText}。`
      : posterVideoCoverPendingNote({ status, statusLabel, jobPresent: Boolean(task), recordPresent: Boolean(stored) })
  };
}

// ---------------------------------------------------------------------------
// 主视觉素材（本周期最新一幅有成品图的作品）
// ---------------------------------------------------------------------------

/** 记录日期（归一后）—— 「取本周期最新一幅」的排序键；读不出来给空串。 */
function recordDay(record) {
  return normalizeLessonDate(record && (record.lessonDate || record.date));
}

/**
 * 主视觉：本周期内**最新一幅有成品图的作品**（同一天后来的那条覆盖前一条，顺序即列表顺序）。
 * 一条都没有（或都还没有成品图）返回 `null` —— 界面走占位文案 + 拦导出，不编一个画面。
 */
export function posterVideoCoverArtwork(records = [], { objectName = '', isClass = false, period = '', today = null } = {}) {
  const name = str(objectName);
  if (!name) return null;
  const inPeriod = filterArchiveRecordsByPeriod(records, resolveArchiveReportPeriod(period), resolvedToday(today));
  let picked = null;
  inPeriod.forEach((record) => {
    if (!isPlainObject(record)) return;
    const owner = isClass ? str(record.className) : str(record.student);
    if (owner !== name) return;
    const media = archiveRecordMediaView(record, { surface: 'teacher' });
    const url = str(media.artwork && media.artwork.url);
    if (!url) return;
    const day = recordDay(record);
    // 「最新」优先看课次日期；读不出日期的记录排在有空日期的后面（按列表顺序取最后一条）。
    const newer = !picked || (day && picked.day ? day >= picked.day : (day ? true : !picked.day));
    if (!newer) return;
    picked = {
      url,
      day,
      date: day,
      dateDots: day ? formatLessonDateDots(day) : '',
      title: str(record.title),
      recordId: str(record.id),
      recordKey: str(record.recordKey),
      studentName: str(record.student),
      className: str(record.className)
    };
  });
  return picked;
}

// ---------------------------------------------------------------------------
// 数据装配（这一步之后，界面只要 `spec` + `data` 就能渲染）
// ---------------------------------------------------------------------------

/**
 * 装配一张成长视频封面：`{ spec, data, ...读数 }`。
 *
 * 入参：
 *  - `objectName` = 这张封面属于谁（个人视图是学员名、班级视图是班级名；读不出来给空态）；
 *  - `isClass` = 班级视图（成片类型 `class`，对象取班级名）；
 *  - `period` = `半学期 | 一学期 | 一年度`（**与视频模块的生成周期同一份口径**：时长角标就靠它对齐成片记录）；
 *  - `videoRecords` / `jobs` = 视频模块状态（成片记录 + 演示任务；时长角标与那句说明读它们）；
 *  - `jobKey` = 这条任务的业务键（缺省时按对象 + 周期现算，与视频模块同一支 `videoJobKey`）；
 *  - `tokens` = 分享令牌（**成片的有效令牌**才算数：撤回 / 过期都让二维码位显示「分享链接待生成」）；
 *  - `today` / `now` = 可注入的时间（周期窗口与令牌有效期都读它；断言与界面因此读同一份）。
 */
export function buildPosterVideoCoverPlan({
  records = [],
  videoRecords = [],
  jobs = [],
  objectName = '',
  isClass = false,
  period = '',
  jobKey = '',
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
  const type = normalizeVideoJobType(isClass ? 'class' : 'personal');
  const name = str(objectName);
  const periodName = resolveArchiveReportPeriod(period);
  const todayValue = resolvedToday(today);
  const window = archivePeriodWindow(periodName, todayValue);
  const periodLabel = periodLabelFromWindow(periodName, window);
  const templateRecord = template ? normalizePosterTemplate(template) : findPosterVideoCoverTemplate();
  const baseSpec = normalizePosterSpec(spec || (templateRecord && templateRecord.spec) || undefined);

  const key = str(jobKey) || videoJobKey({
    type,
    studentId: isClass ? '' : name,
    classId: isClass ? name : '',
    period: periodName
  });
  const jobList = (Array.isArray(jobs) ? jobs : []).filter(isPlainObject);
  const job = jobList.find((item) => str(item.jobKey) === key) || null;
  const record = name ? findVideoRecord(videoRecords, videoRecordKey({ type, studentId: isClass ? '' : name, classId: isClass ? name : '', period: periodName })) : null;
  const durationView = posterVideoCoverDurationView({ record, job });

  const artwork = name
    ? posterVideoCoverArtwork(records, { objectName: name, isClass, period: periodName, today: todayValue })
    : null;
  const artworkMissing = !artwork;

  // 成片的分享链接：有效令牌走 `activeVideoShareToken`（撤回 / 过期都不算数），否则二维码位换文字占位。
  // 状态与有效期读数取 `videoSharePanelView`（成片分享那一支的唯一实现：撤回 / 过期也分得出来，
  // 不是只有「有 / 没有」两种）—— [海报 US-313] 起二维码位那句占位也跟着状态走。
  const shareToken = name ? activeVideoShareToken(tokens, key, now) : null;
  const sharePanel = name ? videoSharePanelView({ tokens, jobKey: key, now }) : null;
  const shareUrl = shareToken ? shareTokenUrl(shareToken.token, { origin }) : '';
  const sharePending = !shareUrl;
  const shareView = posterShareQrShareView({
    state: sharePanel ? sharePanel.state : 'none',
    stateLabel: sharePanel ? sharePanel.stateLabel : '',
    active: Boolean(shareToken),
    tokenText: shareToken ? str(shareToken.token) : '',
    link: shareUrl,
    path: sharePanel ? sharePanel.link : '',
    expiresText: sharePanel ? sharePanel.expiresText : '',
    spec: baseSpec
  });

  const logoUrl = posterImageUrl(logo);
  const logoFallback = !logoUrl ? str(orgName) : '';
  const fallbackReason = logoUrl
    ? ''
    : (str(logo) ? '机构标识地址不是图片地址：Logo 位改用机构名代替。' : posterSingleLogoFallbackNote(logoFallback));

  const patched = posterSingleSpecPatch(baseSpec, {
    artworkMissing,
    sharePending,
    sharePendingText: shareView.placeholderText,
    logoFallback,
    // 画面上那句占位短句（与单作品海报同一句）；位置与尺寸一字不动，换的只是那一句。
    imagePlaceholderText: POSTER_VIDEO_COVER_ARTWORK_MISSING_TEXT
  });
  const coverSlot = posterVideoCoverSlot(baseSpec);
  const overlays = posterVideoCoverOverlays(baseSpec, {
    periodLabel,
    durationBadgeText: durationView.badgeText
  });
  const ratio = posterVideoCoverRatio(baseSpec);

  const data = {
    studentName: name,
    artworkTitle: artwork ? artwork.title : '',
    period: periodLabel,
    date: artwork ? artwork.date : '',
    teacherName: str(teacherName),
    orgName: str(orgName),
    // 时长角标：成片三件套齐全时是真时长，否则是占位（结构上印不出假数字）。
    duration: durationView.ready ? durationView.durationText : POSTER_VIDEO_COVER_DURATION_PLACEHOLDER,
    // 主视觉（keyed 形状：只喂命中的占位区，渲染层不猜素材）与机构 Logo / 分享链接。
    images: { [coverSlot ? coverSlot.id : POSTER_VIDEO_COVER_SLOT_ID]: artwork ? artwork.url : '' },
    logo: logoUrl,
    shareUrl
  };

  const notes = [];
  if (!name) notes.push(POSTER_VIDEO_COVER_OBJECT_MISSING_TEXT);
  if (name && artworkMissing) notes.push(POSTER_VIDEO_COVER_ARTWORK_MISSING_REASON);
  if (name && !durationView.ready) notes.push(durationView.note);
  if (name && sharePending) notes.push(`没有有效的成片分享链接：二维码位显示「${shareView.placeholderText}」而不是空白方块。`);
  if (name && shareView.qr.note) notes.push(shareView.qr.note);
  if (name && fallbackReason) notes.push(fallbackReason);
  if (name && overlays.issue) notes.push(overlays.issue);

  return {
    hasObject: Boolean(name),
    kind: POSTER_VIDEO_COVER_KIND,
    kindLabel: POSTER_KIND_LABELS[POSTER_VIDEO_COVER_KIND],
    templateKey: templateRecord ? templateRecord.id : '',
    templateName: templateRecord ? templateRecord.name : '',
    baseSpec,
    spec: patched,
    data,
    isClass,
    type,
    typeLabel: videoJobTypeLabel(type),
    objectName: name,
    studentName: isClass ? '' : name,
    className: isClass ? name : '',
    period: periodName,
    periodLabel,
    window: { period: window.period, days: window.days, from: window.from, to: window.to },
    teacherName: str(teacherName),
    orgName: str(orgName),
    cover: {
      slotId: coverSlot ? coverSlot.id : '',
      titleText: overlays.titleText,
      playIcon: overlays.playIcon,
      periodLabel,
      durationBadgeText: overlays.durationBadgeText || durationView.badgeText,
      overlays
    },
    artwork: {
      url: artwork ? artwork.url : '',
      missing: artworkMissing,
      placeholderText: artworkMissing ? POSTER_VIDEO_COVER_ARTWORK_MISSING_REASON : '',
      date: artwork ? artwork.date : '',
      dateDots: artwork ? artwork.dateDots : '',
      title: artwork ? artwork.title : '',
      recordId: artwork ? artwork.recordId : '',
      recordKey: artwork ? artwork.recordKey : ''
    },
    duration: durationView,
    ratio,
    video: {
      jobKey: key,
      jobPresent: Boolean(job),
      status: durationView.status,
      statusLabel: durationView.statusLabel,
      ready: durationView.ready,
      from: durationView.from,
      recordId: record ? str(record.id) : '',
      videoKey: record ? str(record.videoKey) : '',
      version: record ? int(record.version) : 0,
      label: `${videoJobTypeLabel(type)} · ${periodLabel}`,
      pendingText: durationView.ready ? '' : POSTER_VIDEO_COVER_DURATION_PLACEHOLDER,
      pendingReason: durationView.ready ? '' : POSTER_VIDEO_COVER_PENDING_REASON
    },
    share: shareView,
    logo: { url: logoUrl, fallbackText: logoFallback },
    // 「能不能出预览」与「能不能导出」是两件事：视频还没成片时**预览照出**（角标就是占位），
    // 导出被拦下 —— 验收要的正是「看得见占位、但下载不了」。
    renderable: Boolean(name) && !artworkMissing,
    notes,
    exportGate: posterVideoCoverExportGate({
      hasObject: Boolean(name),
      artwork: { missing: artworkMissing },
      duration: { ready: durationView.ready }
    })
  };
}

/** 周期文案：`一学期（2026.04.16 – 2026.10.12）`（与阶段海报 / 视频模块同一份拼法）。 */
function periodLabelFromWindow(name, window) {
  const from = formatLessonDateDots(window.from);
  const to = formatLessonDateDots(window.to);
  return from && to ? `${name}（${from} – ${to}）` : name;
}

/**
 * 导出门（US-306 第 4 条：**视频尚未生成时不可导出**）：
 * 没有对象 / 没有主视觉 / 成片时长还没出来，三者任一都不下载 —— 原因就是那句可读文案。
 * （分辩顺序：先对象、再主视觉、最后视频状态 —— 缺哪一条就说哪一条。）
 */
export function posterVideoCoverExportGate(plan) {
  const value = isPlainObject(plan) ? plan : {};
  if (!value.hasObject) return { allowed: false, reason: POSTER_VIDEO_COVER_OBJECT_MISSING_TEXT };
  if (value.artwork && value.artwork.missing) {
    return { allowed: false, reason: `${POSTER_VIDEO_COVER_EXPORT_BLOCKED_TITLE}：${POSTER_VIDEO_COVER_ARTWORK_MISSING_REASON}` };
  }
  if (!(value.duration && value.duration.ready)) {
    return { allowed: false, reason: POSTER_VIDEO_COVER_PENDING_REASON };
  }
  return { allowed: true, reason: '' };
}

/**
 * 导出文件名（FR-342 的封面版）：`{对象名}_{周期}_视频封面.{png|jpg}`。
 * 空片段不参与拼接，非法字符走**装裱导出那一支**（`sanitizeArtworkExportSegment`，别再写一份）。
 */
export function posterVideoCoverFilename({ student = '', period = '', extension = 'png' } = {}) {
  const ext = str(extension).toLowerCase() === 'jpg' || str(extension).toLowerCase() === 'jpeg' ? 'jpg' : 'png';
  const segments = [student, resolveArchiveReportPeriod(period)]
    .map(sanitizeArtworkExportSegment)
    .filter(Boolean);
  return [...segments, '视频封面'].join('_') + `.${ext}`;
}
