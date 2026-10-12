// 一键转发弹窗的数据层（[海报 US-308] / FR-327 ~ FR-334）。
//
// 「点一键转发家长 → 弹窗里选模板 → 右边看效果」这件事的**规则**全在这一份里（零依赖纯函数，
// 可 `node` 直跑断言）：入口与模板的匹配（FR-354）、模板清单与「我的 / 系统」归属、
// 适用性判据与可读原因（FR-333）、默认选中（FR-313 的单作品默认 + 模板库的 `isDefault`）、
// 空态（FR-332）、数据来源的一件事（FR-331：成长的档案入口 = 当前学员 + 当前周期）以及
// **五类版式的分派**（同一个模板清单里混着五类版式，这里按 `kind` 交给对应的 plan 构建器）。
//
// 三条纪律（与 /tmp/assert-us096 那一批海报故事同源）：
//   ① 时间预算不是「界面上的装饰」：`POSTER_DIALOG_FIRST_PREVIEW_BUDGET_MS` /
//      `POSTER_DIALOG_SWITCH_BUDGET_MS` 是 FR-330 / FR-361 / FR-362 的唯一真源，
//      界面读数、断言与 `posterDialogPerfChecks()` 都读它（别在任一侧再抄一遍 3000 / 300）。
//   ② 缩略图的分辨率来自 PRD 9.5 的 `scale = 0.25`（`POSTER_DIALOG_THUMB_SCALE`）——
//      8 套模板各渲染一张全尺寸图会把弹窗拖慢，缩略图是「小图」。
//   ③ **这里只装配，不渲染**：渲染在 `services/posterDialog.js`（同一个 `renderPoster`），
//      弹窗组件只渲染这一份的产物。

import {
  POSTER_ENTRY_SCOPE_LABELS,
  POSTER_KIND_LABELS,
  selectablePosterTemplates
} from './posterTemplates';
import {
  ARCHIVE_EMPTY_ACTION,
  ARCHIVE_PERIODS,
  ARCHIVE_PERIOD_DEFAULT,
  ARCHIVE_TARGET_CLASS,
  ARCHIVE_TARGET_PERSONAL,
  archiveTargetView,
  filterArchiveRecordsByPeriod,
  resolveArchivePeriod
} from './archiveTargets';
import { resolveArchiveReportPeriod } from './archiveReports';
import { archiveRecordMediaView } from './archiveMedia';
import { formatLessonDateDots, normalizeLessonDate } from './lessons';
import { buildPosterSinglePlan } from './posterSingle';
import { buildPosterPeriodPlan } from './posterPeriod';
import { buildPosterClassPlan } from './posterClass';
import { buildPosterVideoCoverPlan } from './posterVideoCover';
import { buildPosterReportLongPlan } from './posterReportLong';
import { videoJobKey } from './videoJobs';

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();

/** 「今天」的归一（与 `data/posterClass.js` 同一条注释）：必须先落到一个真 Date 再交给周期函数。 */
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
// 入口与预算（界面、断言与这里的读数共用一份）
// ---------------------------------------------------------------------------

/** 两处入口（FR-327 / FR-331）：成长档案 / 课后反馈第四步。 */
export const POSTER_DIALOG_ENTRY_ARCHIVE = 'archive';
export const POSTER_DIALOG_ENTRY_FEEDBACK = 'feedback';
export const POSTER_DIALOG_ENTRIES = [POSTER_DIALOG_ENTRY_ARCHIVE, POSTER_DIALOG_ENTRY_FEEDBACK];
/** 入口文案 = 模板适用范围的文案（同一套词，别写第二份）。 */
export const POSTER_DIALOG_ENTRY_LABELS = POSTER_ENTRY_SCOPE_LABELS;

/** 打开弹窗 → 首张预览渲染完成 ≤ 3 秒（FR-330 / FR-361）。 */
export const POSTER_DIALOG_FIRST_PREVIEW_BUDGET_MS = 3000;
/** 换模板 → 预览重绘 ≤ 300ms（FR-330 / FR-362）。 */
export const POSTER_DIALOG_SWITCH_BUDGET_MS = 300;
/** 缩略图分辨率（PRD 9.5：`scale = 0.25`，8 套模板各渲染一张全尺寸图会把弹窗拖慢）。 */
export const POSTER_DIALOG_THUMB_SCALE = 0.25;
/** 预览倍数：1×（1080 宽），与 PRD 9.5 的「预览走低倍率」一致。 */
export const POSTER_DIALOG_PREVIEW_SCALE = 1;

export const POSTER_DIALOG_RENDER_FAILED_TEXT = '海报没有渲染成功：请检查网络或换一张模板后重试。';
export const POSTER_DIALOG_SWITCH_PENDING_TEXT = '正在换模板…';
export const POSTER_DIALOG_FIRST_PENDING_TEXT = '正在生成第一张预览…';

/** 课后反馈入口的置灰原因（FR-333 的原文：「需在成长档案中生成」）。 */
export const POSTER_DIALOG_ARCHIVE_ONLY_NOTE = '需在成长档案中生成';
/** 逆向的一条：只服务课后反馈的版式，在成长档案入口置灰（默认没有这样的模板，规则先立在这里）。 */
export const POSTER_DIALOG_FEEDBACK_ONLY_NOTE = '这套版式只在课后反馈入口使用';
/** 班级对象下、按学员生成的版式：说清去哪儿生成，而不是给一个灰按钮。 */
export const POSTER_DIALOG_STUDENT_ONLY_NOTE = '按学员生成：请切到个人成长档案再转发';
/** 学员对象下、班级名单读不出来时的原因（班级墙需要名单，不编一份）。 */
export const POSTER_DIALOG_CLASS_MISSING_NOTE = '这位学员还没有班级归属：班级集体海报需要班级名单';
/** 空态（FR-332）：不渲染空白海报，给入口。 */
export const POSTER_DIALOG_EMPTY_TITLE = '这个周期还没有归档记录';
export const POSTER_DIALOG_EMPTY_DESC = '完成一次课后反馈并归档后，成品作品与老师确认后的点评会出现在海报里。';
export const POSTER_DIALOG_EMPTY_PERIOD_HINT = '这位学员在别的周期有归档记录：换一个周期就能出图（不用重新归档）。';
export const POSTER_DIALOG_EMPTY_OBJECT_NOTE = '还没有可生成海报的归档记录：先完成课后反馈的归档，再来转发。';
export const POSTER_DIALOG_CREATE_LABEL = ARCHIVE_EMPTY_ACTION;
export const POSTER_DIALOG_ASSET_NOTE = '海报只用归档后的成品素材与老师确认后的点评：不含原图、不含推理过程、不含任何联系方式。';

/** 五类版式的「主体」：按学员生成的四种 + 按班级生成的一种（US-309 的置灰判据读这一份）。 */
export const POSTER_DIALOG_KIND_SUBJECTS = {
  single: 'student',
  period: 'student',
  class: 'class',
  'video-cover': 'student',
  'report-long': 'student'
};

export function posterDialogKindSubject(kind) {
  return POSTER_DIALOG_KIND_SUBJECTS[kind] || 'student';
}

/**
 * 档案页的「周期筛选」→ 海报周期（FR-331 的「跟随档案页筛选条件」）。
 * `全部`（默认档）不是海报能表达的周期（五类版式都按周期出图）→ 回落 `ARCHIVE_PERIOD_DEFAULT`，
 * 界面用 `posterDialogPeriodNote()` 把这件事说明白，而不是静默换一个周期。
 */
export function posterDialogPeriod(value) {
  const name = str(value);
  if (ARCHIVE_PERIODS.includes(name)) return name;
  return ARCHIVE_PERIOD_DEFAULT;
}

/** 这个周期是「档案页筛选给的」还是「回落默认」的（界面读数与断言读同一份）。 */
export function posterDialogPeriodSource(value) {
  return ARCHIVE_PERIODS.includes(str(value)) ? 'filter' : 'default';
}

/**
 * 周期说明（跟随筛选时为空串）：说明为什么不是「全部」。
 * **只对成长档案入口有意义**（那边真的有「周期筛选」这一档）：课后反馈入口的数据来源是本次课次
 * （FR-331 的第二条），没有「档案页筛选」可跟随 —— 这时返回空串，别把档案页的句子搬到反馈入口。
 */
export function posterDialogPeriodNote(value, entry = POSTER_DIALOG_ENTRY_ARCHIVE) {
  if (str(entry) === POSTER_DIALOG_ENTRY_FEEDBACK) return '';
  const name = str(value);
  if (ARCHIVE_PERIODS.includes(name)) return '';
  const label = name ? `「${name}」` : '未设置';
  return `档案页当前的周期筛选是${label}，海报按周期出图：这里先按「${ARCHIVE_PERIOD_DEFAULT}」生成，也可以在弹窗里换周期。`;
}

/** 周期选项（海报能表达的三个周期；「全部」不在其中 —— 它与 `resolveArchiveReportPeriod` 同源）。 */
export const POSTER_DIALOG_PERIOD_OPTIONS = ARCHIVE_PERIODS.slice();

// ---------------------------------------------------------------------------
// 对象：学员 / 班级（数据来源的唯一入口）
// ---------------------------------------------------------------------------

/**
 * 弹窗的「对象」：档案页当前选中的学员或班级（FR-331）。
 * 学员对象额外带**班级归属与名单**（班级集体海报要用）：优先查学员名单，查不到时退回记录自带的班级名 ——
 * 名单读不出来就如实为空，不编一份（班级版式随后会置灰并给原因）。
 */
export function posterDialogObject({ target = ARCHIVE_TARGET_PERSONAL, name = '', record = null, students = [] } = {}) {
  const isClass = target === ARCHIVE_TARGET_CLASS;
  const objectName = str(name);
  const list = Array.isArray(students) ? students : [];
  if (isClass) {
    const roster = list.filter((item) => str(item && item.className) === objectName).map((item) => str(item && item.name)).filter(Boolean);
    return { kind: 'class', name: objectName, className: objectName, roster, record: null, students: list };
  }
  const profile = list.find((item) => str(item && item.name) === objectName) || null;
  // 记录里可能带班级（老记录有 className）—— 但 `isPlainObject` 为假时**不能**把 `false` 交给 `str()`
  // （`str(false)` 会得到字符串 "false"，班级名就成了假的，后续所有按班过滤都跟着错）。
  const recordClassName = isPlainObject(record) ? str(record.className) : '';
  const className = str(profile && profile.className) || recordClassName;
  const roster = className
    ? list.filter((item) => str(item && item.className) === className).map((item) => str(item && item.name)).filter(Boolean)
    : [];
  return { kind: 'student', name: objectName, className, roster, record: isPlainObject(record) ? record : null, students: list };
}

/** 对象名下的**全部**归档记录（不带周期窗口）—— 空态要区分「一条都没有」与「只是不在这个周期」。 */
export function posterDialogTargetRecords({ records = [], object = {} } = {}) {
  const subject = isPlainObject(object) ? object : {};
  const name = str(subject.name);
  if (!name) return [];
  const targetView = archiveTargetView(records, subject.kind === 'class'
    ? { target: ARCHIVE_TARGET_CLASS, className: name }
    : { target: ARCHIVE_TARGET_PERSONAL, student: name });
  return targetView.lessons;
}

/** 对象 + 周期里的归档记录（对象过滤与周期过滤都走档案页那一支，不另写一份）。 */
export function posterDialogRecords({ records = [], object = {}, period = '', today = null } = {}) {
  const all = posterDialogTargetRecords({ records, object });
  if (!all.length) return [];
  return filterArchiveRecordsByPeriod(all, resolveArchiveReportPeriod(period), resolvedToday(today));
}

/**
 * 单作品海报的「这条记录」：本周期里这位学员的**最后一条**记录 —— 有成品图的记录优先
 * （单作品海报的主角是作品；只有缺课记录时退回那条记录，海报上会显示「作品尚未同步完成」占位）。
 * 课后反馈入口由调用方把「本次课次」直接放进 `object.record`，不走这里（FR-331 的两处数据来源）。
 */
export function posterDialogSubjectRecord({ records = [], object = {}, period = '', today = null } = {}) {
  const subject = isPlainObject(object) ? object : {};
  if (isPlainObject(subject.record)) {
    const media = archiveRecordMediaView(subject.record, { surface: 'teacher' });
    const date = normalizeLessonDate(subject.record.lessonDate || subject.record.date);
    return {
      record: subject.record,
      source: 'lesson',
      date,
      dateDots: date ? formatLessonDateDots(date) : '',
      count: 1,
      hasArtwork: Boolean(str(media.artwork && media.artwork.url))
    };
  }
  const inPeriod = posterDialogRecords({ records, object: subject, period, today });
  if (!inPeriod.length) return { record: null, source: 'none', date: '', dateDots: '', count: 0, hasArtwork: false };
  let picked = null;
  inPeriod.forEach((record) => {
    const media = archiveRecordMediaView(record, { surface: 'teacher' });
    const url = str(media.artwork && media.artwork.url);
    const date = normalizeLessonDate(record.lessonDate || record.date);
    // 「最后一条带成品图的」优先；一条都没有时留着最后一条（占位照出）。
    if (url) picked = { record, date, url };
    else if (!picked) picked = { record, date, url: '' };
  });
  const date = picked.date || '';
  return {
    record: picked.record,
    source: 'period',
    date,
    dateDots: date ? formatLessonDateDots(date) : '',
    count: inPeriod.length,
    hasArtwork: Boolean(picked.url)
  };
}

// ---------------------------------------------------------------------------
// 模板清单与适用性（FR-354 / FR-333）
// ---------------------------------------------------------------------------

/**
 * 弹窗的模板清单：**停用的不出现**（与装裱 / 模板库同一口径），其余逐条给出
 * `applicable` 与「为什么不能用」的可读原因。顺序沿用模板库的 `sortOrder`（唯一排序真源）。
 *
 * 适用性三条，逐条给原因（先说的那条优先）：
 *   ① 入口：`entryScope` 命中当前入口（`both` 两处都算）；
 *   ② 主体：班级对象下，按学员生成的版式没有主体（置灰）；学员对象下，班级版式用**这位学员的班级**
 *      （名单与班级记录都来自档案页那一份，不另选一个班级）；
 *   ③ 数据：学员对象 + 班级版式但没有班级归属 → 置灰并说清需要班级名单。
 */
export function posterDialogTemplateRows({ templates = [], entry = POSTER_DIALOG_ENTRY_ARCHIVE, object = {} } = {}) {
  const subject = isPlainObject(object) ? object : {};
  const objectKind = subject.kind === 'class' ? 'class' : 'student';
  const hasName = Boolean(str(subject.name));
  const className = str(subject.className);
  return selectablePosterTemplates(templates).map((template) => {
    const kind = template.kind;
    const templateSubject = posterDialogKindSubject(kind);
    const entryOk = template.entryScope === entry || template.entryScope === 'both';
    // 学员对象下班级版式仍然可用（用这位学员的班级）——「主体不匹配」只发生在班级对象上。
    const subjectOk = objectKind === 'class' ? templateSubject === 'class' : true;
    // 班级墙要的是**班级名**（不是学员名）：学员没有班级归属时置灰，别拿学员名当班级名画一堵空墙。
    const dataOk = !(objectKind === 'student' && templateSubject === 'class') || Boolean(className);
    const applicable = hasName && entryOk && subjectOk && dataOk;
    let reason = '';
    if (!hasName) reason = POSTER_DIALOG_EMPTY_OBJECT_NOTE;
    else if (!entryOk) reason = entry === POSTER_DIALOG_ENTRY_FEEDBACK ? POSTER_DIALOG_ARCHIVE_ONLY_NOTE : POSTER_DIALOG_FEEDBACK_ONLY_NOTE;
    else if (!subjectOk) reason = POSTER_DIALOG_STUDENT_ONLY_NOTE;
    else if (!dataOk) reason = POSTER_DIALOG_CLASS_MISSING_NOTE;
    return {
      id: template.id,
      name: template.name,
      kind,
      kindLabel: POSTER_KIND_LABELS[kind] || kind,
      entryScope: template.entryScope,
      entryLabel: POSTER_DIALOG_ENTRY_LABELS[template.entryScope] || '',
      scope: template.scope,
      ownerKey: template.ownerKey,
      isDefault: Boolean(template.isDefault),
      sortOrder: template.sortOrder,
      subject: templateSubject,
      template,
      applicable,
      reason
    };
  });
}

/**
 * 默认选中：可用的模板里优先模板库的**默认模板**，其次第一张「单作品」（FR-313 的单作品默认口径），
 * 再次第一张可用的。换对象 / 换入口后老的选择不适用时，选择守卫读同一个函数。
 */
export function posterDialogDefaultTemplateId(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row && row.applicable);
  if (!list.length) return '';
  const fallback = list.find((row) => row.isDefault) || list.find((row) => row.kind === 'single') || list[0];
  return fallback.id;
}

/** 选择守卫：当前选中还可用就保持，不可用（换对象 / 换入口 / 模板被停用）就回落到默认选中。 */
export function posterDialogSelectTemplate(rows = [], currentId = '') {
  const list = Array.isArray(rows) ? rows : [];
  const id = str(currentId);
  const current = list.find((row) => row.id === id && row.applicable);
  if (current) return current.id;
  return posterDialogDefaultTemplateId(list);
}

// ---------------------------------------------------------------------------
// 空态（FR-332）
// ---------------------------------------------------------------------------

/**
 * 空态：对象 + 周期里一条记录都没有 → 不渲染空白海报，给「去创建课后反馈」入口。
 * 两种口径分开说（`reason`）：
 *   - `none`：这位学员 / 班级**一条归档记录都没有**（去创建课后反馈）；
 *   - `period`：有记录、只是不在这个周期（换周期就能出图，并如实报另一侧有几条）。
 */
export function posterDialogEmptyView({ records = [], object = {}, period = '', today = null } = {}) {
  const subject = isPlainObject(object) ? object : {};
  // 对象自带记录（课后反馈入口的「本次课次」，FR-331）时**不是空态**：这一张图的内容来自这条记录，
  // 与「这个周期里有没有归档记录」是两件事 —— 补录一节很老的课次时它会落在默认周期窗口之外，
  // 按周期判会把一张有内容的图误判成空态。
  if (isPlainObject(subject.record)) {
    return { on: false, reason: 'lesson', count: 1, outside: 0, title: '', desc: '', hint: '', action: '' };
  }
  const inPeriod = posterDialogRecords({ records, object: subject, period, today });
  if (inPeriod.length) return { on: false, reason: 'ready', count: inPeriod.length, outside: 0, title: '', desc: '', hint: '', action: '' };
  const all = posterDialogTargetRecords({ records, object: subject });
  const outside = Math.max(0, all.length - inPeriod.length);
  if (!all.length) {
    return {
      on: true,
      reason: 'none',
      count: 0,
      outside: 0,
      title: POSTER_DIALOG_EMPTY_TITLE,
      desc: POSTER_DIALOG_EMPTY_DESC,
      hint: POSTER_DIALOG_EMPTY_OBJECT_NOTE,
      action: POSTER_DIALOG_CREATE_LABEL
    };
  }
  return {
    on: true,
    reason: 'period',
    count: 0,
    outside,
    title: POSTER_DIALOG_EMPTY_TITLE,
    desc: `${resolveArchiveReportPeriod(period)}里没有${subject.kind === 'class' ? '这个班级' : '这位学员'}的归档记录。`,
    hint: outside ? `${POSTER_DIALOG_EMPTY_PERIOD_HINT}（另有 ${outside} 条在其他周期）` : POSTER_DIALOG_EMPTY_PERIOD_HINT,
    action: POSTER_DIALOG_CREATE_LABEL
  };
}

// ---------------------------------------------------------------------------
// 计划分派（五类版式 → 各自的 plan 构建器）
// ---------------------------------------------------------------------------

/**
 * 按模板的 `kind` 装配这一张海报：**只有一份分派**，两处入口（成长档案 / 课后反馈）走同一支 ——
 * US-309 的「全仓只有一份海报渲染实现」从这里开始成立（导出与预览也共用 services 那一支）。
 */
export function buildPosterDialogPlan({
  kind = 'single',
  template = null,
  object = {},
  period = '',
  records = [],
  lessons = [],
  tokens = [],
  videoRecords = [],
  jobs = [],
  now = null,
  today = null,
  teacherName = '',
  orgName = '',
  logo = '',
  origin = '',
  spec = null
} = {}) {
  const subject = isPlainObject(object) ? object : {};
  const value = str(kind) || 'single';
  const base = { records, lessons, tokens, now, today, teacherName, orgName, logo, origin, spec, template };
  const objectName = str(subject.name);
  if (value === 'period') return buildPosterPeriodPlan({ ...base, student: objectName, period });
  if (value === 'class') {
    // 班级名来自对象解析（班级对象的 className = 名字；学员对象的是**这位学员的班级**）——
    // 解析不出来时不给 `className` 兜底成学员名（那会画出一堵空墙）。
    const className = str(subject.className) || (subject.kind === 'class' ? objectName : '');
    return buildPosterClassPlan({ ...base, className, roster: subject.roster || [], period });
  }
  if (value === 'video-cover') {
    const type = subject.kind === 'class' ? 'class' : 'personal';
    return buildPosterVideoCoverPlan({
      ...base,
      videoRecords,
      jobs,
      objectName,
      isClass: subject.kind === 'class',
      period,
      jobKey: videoJobKey({ type, studentId: type === 'class' ? '' : objectName, classId: type === 'class' ? objectName : '', period })
    });
  }
  if (value === 'report-long') return buildPosterReportLongPlan({ ...base, student: objectName, period });
  const { record } = posterDialogSubjectRecord({ records, object: subject, period, today });
  return buildPosterSinglePlan({ ...base, record });
}

/**
 * 预览 / 缩略图的重绘键：真正会改变这张图的所有输入（换模板、换对象、换周期、换模板库那一侧的字段）。
 * 五类版式的字段各不相同（各自的 plan 结构），所以这里按 kind 分别取 —— 别用一个「大概够用」的键
 * （漏了字段的表现是「换了内容预览不动」，多算了字段的表现是「白重绘」，后者只是慢、前者是错的）。
 */
export function posterDialogPlanKey(plan = null) {
  const value = isPlainObject(plan) ? plan : null;
  if (!value) return '';
  const kind = str(value.kind);
  const shared = [kind, str(value.templateKey), str(value.periodLabel)];
  if (kind === 'single') {
    return [...shared,
      str(value.studentName), str(value.artworkTitle), str(value.dateDots),
      str(value.quote && value.quote.text), str(value.artwork && value.artwork.url),
      value.artwork && value.artwork.missing ? 'missing-art' : 'has-art',
      str(value.logo && value.logo.url) || str(value.logo && value.logo.fallbackText),
      value.share && value.share.active ? str(value.share.link) : 'no-share'
    ].join('|');
  }
  if (kind === 'period') {
    const collage = value.collage || {};
    return [...shared,
      str(value.studentName),
      (collage.entries || []).map((entry) => `${entry.url.slice(-24)}:${entry.caption}:${entry.title || ''}`).join(','),
      collage.total, collage.count, str(collage.grid && collage.grid.label),
      str(value.summary && value.summary.text),
      str(value.logo && value.logo.url) || str(value.logo && value.logo.fallbackText),
      value.share && value.share.active ? str(value.share.link) : 'no-share'
    ].join('|');
  }
  if (kind === 'class') {
    const batch = value.batch || {};
    const wall = value.wall || {};
    return [...shared,
      str(value.className),
      (batch.cells || []).map((cell) => `${cell.student}:${cell.hasArtwork ? 'art' : 'none'}:${str(cell.url).slice(-24)}:${cell.caption || ''}`).join(','),
      batch.index, str(wall.grid && wall.grid.label), wall.nameCaptions ? 'captions' : 'no-captions',
      str(value.data && value.data.logo) || str(value.logo && value.logo.url),
      value.share && value.share.active ? str(value.share.link) : 'no-share'
    ].join('|');
  }
  if (kind === 'video-cover') {
    return [...shared,
      str(value.objectName), str(value.artwork && value.artwork.url), str(value.artwork && value.artwork.dateDots),
      str(value.cover && value.cover.durationBadgeText),
      str(value.logo && value.logo.url) || str(value.logo && value.logo.fallbackText),
      value.share && value.share.active ? str(value.share.link) : 'no-share'
    ].join('|');
  }
  if (kind === 'report-long') {
    const page = (value.pages && value.pages[0]) || null;
    return [...shared,
      str(value.studentName), page ? page.height : 0,
      (value.rows || []).map((row) => `${row.recordKey || row.index}:${str(row.artworkUrl).slice(-24)}:${str(row.quote && row.quote.text)}`).join(','),
      str(value.cover && value.cover.url),
      value.share && value.share.active ? str(value.share.link) : 'no-share'
    ].join('|');
  }
  return shared.join('|');
}

// ---------------------------------------------------------------------------
// 性能读数（FR-330：首张预览 ≤ 3 秒、换模板重绘 ≤ 300ms）
// ---------------------------------------------------------------------------

/**
 * 两条耗时读数：**结论只在数据层算**（界面只渲染 `value` / `budget` / `ok` / `text`）。
 * `null` = 还没测到（如实写「待测」，不写 0，也不写一个好看的默认值）。
 */
export function posterDialogPerfChecks({ firstPreviewMs = null, switchMs = null } = {}) {
  // 只有**真的量到**才算数：`null` / `undefined` / 空串不进比对（`Number(null)` 是 0，
  // 直接 `Number.isFinite(Number(value))` 会把「还没测」读成「0ms、达标」—— 真踩过）。
  const ms = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value.trim()) : NaN);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
  };
  const first = ms(firstPreviewMs);
  const swap = ms(switchMs);
  const row = (id, label, value, budget, text) => ({
    id,
    label,
    value: value === null ? '' : `${value}ms`,
    budget: `≤ ${budget}ms`,
    ok: value === null ? null : value <= budget,
    text: value === null ? '待测' : text
  });
  const rows = [
    row('first-preview', '首张预览', first, POSTER_DIALOG_FIRST_PREVIEW_BUDGET_MS,
      first !== null && first <= POSTER_DIALOG_FIRST_PREVIEW_BUDGET_MS ? '打开弹窗到首张出图，达标' : '首张预览超预算：先出图再补缩略图，别让它带更多活'),
    row('switch', '换模板重绘', swap, POSTER_DIALOG_SWITCH_BUDGET_MS,
      swap !== null && swap <= POSTER_DIALOG_SWITCH_BUDGET_MS ? '换模板即时可见，达标' : '换模板重绘超预算：检查这一套模板的素材与网格')
  ];
  const measured = rows.filter((item) => item.ok !== null);
  return {
    rows,
    measured: measured.length,
    total: rows.length,
    allOk: measured.length ? rows.every((item) => item.ok !== false) : null,
    summary: measured.length
      ? rows.map((item) => `${item.label} ${item.value || '待测'}`).join(' · ')
      : '待测：打开弹窗与换一次模板后给出读数'
  };
}
