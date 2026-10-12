// 阶段报告（云端表 `archive_reports`）—— 实体模型 / 快照 / 版本与历史 / 本机镜像的唯一真源
// （[第四步 US-207a] / FR-235 ~ FR-238）。
//
// 「老师按学期做一份给家长看的阶段报告，下次打开还想看到它，不要每次重新生成」——这个诉求拆成四件事，
// 全部收在这一份**零依赖纯模块**里（界面只渲染它的产物，可 `node` 直跑断言）：
//
//  ① **唯一键 `reportKey` = 对象（学员 / 班级）+ 周期 + 类型**（FR-236）：同一个键再生成 = 更新那一份，
//     换周期 / 换类型 = 另一份报告。键怎么拼只在这里算一次 —— 界面不许自己再拼一遍
//     （两边各拼一次就会出现「提示说更新了、实际新建了一份」）。
//  ② **快照 `snapshot`**：生成那一刻从归档数据里聚合出的**冻结内容**（课次数量 / 作品数 / 课堂照片数 /
//     每节课的日期、作品名、点评维度原文）。历史版本回看时看到的是**当时**的数据，不是拿今天的记录
//     重算一遍 —— 重算就不叫快照了。
//  ③ **版本与历史**：更新走 `updateArchiveReport`，`version` 自增，被替换的那一版整份进 `history`
//     （上限 `ARCHIVE_REPORT_VERSION_LIMIT` 个版本），历史版本可回看。
//  ④ **落库口径**：本机镜像 `xinlehui-archive-reports-v1` 先落盘（云端表没建出来时它就是唯一副本），
//     云端读写映射在 `services/archiveReportsApi.js` —— 与审计日志 / 装裱模板同一套兜底口径。
//
// 口径不在这里另写一套：目标过滤读 `data/archiveTargets.js`（个人按学员、班级按班级），周期窗口读
// 同一份的 `filterArchiveRecordsByPeriod`，五维维度名读 `data/reviewDetailPanel.js` 的
// `REVIEW_DIMENSION_NAMES`，时间读数读 `data/archiveSummary.js` 的 `formatArchiveTime`。

import { archiveRecordMediaView } from './archiveMedia';
import { REVIEW_DIMENSION_NAMES } from './reviewDetailPanel';
import { formatArchiveTime } from './archiveSummary';
import {
  ARCHIVE_PERIOD_DEFAULT,
  ARCHIVE_PERIODS,
  ARCHIVE_TARGET_CLASS,
  archivePeriodWindow,
  archiveTargetView,
  filterArchiveRecordsByPeriod
} from './archiveTargets';

const str = value => String(value ?? '').trim();
const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** 阶段报告的本机镜像键（云端表是 `archive_reports`）。 */
export const ARCHIVE_REPORT_STORAGE_KEY = 'xinlehui-archive-reports-v1';

/** 报告类型的可选项（FR-235 点名的三个；顺序就是界面里的顺序）。 */
export const ARCHIVE_REPORT_TYPES = ['成长集锦', '作品集', '成长记录'];
export const ARCHIVE_REPORT_TYPE_DEFAULT = '成长集锦';

/** 每个类型一句「它是什么」的说明（界面渲染它，不各写一份）。 */
export const ARCHIVE_REPORT_TYPE_OPTIONS = [
  { name: '成长集锦', hint: '课程足迹、作品、照片与阶段成长总结' },
  { name: '作品集', hint: '按课次串起这一阶段的每一幅作品' },
  { name: '成长记录', hint: '课堂影像、作品与老师寄语' }
];

/**
 * 报告的落库状态词表（`status` 列）：报告是**先写本机镜像、再推云端**的（全站写入口径），
 * 所以「已生成」与「同步到哪了」是两件事 —— 生成永远会成功（纯聚合不抛错），
 * 状态只说这份报告现在落在哪一层：
 *  - `local`：已生成，只在本机镜像里（云端表还没建 / 这次没接到）；
 *  - `synced`：已生成，且这一版已经写进云端 `archive_reports`。
 * 界面与断言都读这一份词表，谁都不许自己写字符串。
 */
export const ARCHIVE_REPORT_STATUSES = { local: 'local', synced: 'synced' };
export const ARCHIVE_REPORT_STATUS_LABELS = {
  [ARCHIVE_REPORT_STATUSES.local]: '已生成 · 仅本机镜像',
  [ARCHIVE_REPORT_STATUSES.synced]: '已生成 · 已同步云端'
};

/** 落库状态归一化：只认 `synced`，其余（含脏值）一律读成 `local`（宁可少声称一点）。 */
export function normalizeArchiveReportStatus(value) {
  return str(value) === ARCHIVE_REPORT_STATUSES.synced ? ARCHIVE_REPORT_STATUSES.synced : ARCHIVE_REPORT_STATUSES.local;
}

/** 保留的历史版本数（超出时丢掉最老的 —— 快照是文本，不设上限会把 localStorage 顶爆）。 */
export const ARCHIVE_REPORT_VERSION_LIMIT = 6;

/** 快照里每节课的点评原文最多保留多少字（一份年度报告 × 50 节课也不该把配额吃掉）。 */
export const ARCHIVE_REPORT_DIMENSION_TEXT_LIMIT = 240;

/** 报告概况的四项（顺序真源）：界面渲染、`data-archive-report-fact` 与断言都读它。 */
export const ARCHIVE_REPORT_FACTS = [
  { id: 'lessons', label: '关联课次', hint: '这份报告覆盖的已归档课次' },
  { id: 'artworks', label: '作品', hint: '这些课次里有成品作品图的幅数' },
  { id: 'photos', label: '课堂照片', hint: '看得见的修正后课堂照片张数' },
  { id: 'absence', label: '缺课', hint: '其中被温柔留白的课次' }
];
export const ARCHIVE_REPORT_FACT_IDS = ARCHIVE_REPORT_FACTS.map(field => field.id);

/** 界面文案（一处定义，界面与断言读同一份）。 */
export const ARCHIVE_REPORT_SECTION_TITLE = '阶段报告';
export const ARCHIVE_REPORT_SECTION_DESC = '按周期与类型生成一份给家长看的阶段报告：它按「对象 + 周期 + 类型」唯一，再次进入这一页会直接展示已经生成的那一份，不再让你重新做一遍。';
export const ARCHIVE_REPORT_EMPTY_TEXT = '这份报告还没有生成过。选好周期与类型，点「生成阶段报告」就会从归档数据里聚合出第一版。';
export const ARCHIVE_REPORT_HISTORY_TITLE = '历史版本';
export const ARCHIVE_REPORT_HISTORY_EMPTY = '还没有历史版本：生成之后每次「更新报告」都会把上一版完整保留在这里。';
export const ARCHIVE_REPORT_HISTORY_BACK = '回到最新版本';
export const ARCHIVE_REPORT_HISTORY_VIEW = '查看这一版';
export const ARCHIVE_REPORT_HISTORY_NOTE = '历史版本是生成那一刻的冻结快照，回看时看到的就是当时的数据。';
export const ARCHIVE_REPORT_GENERATE_LABEL = '生成阶段报告';
export const ARCHIVE_REPORT_UPDATE_LABEL = '更新报告';
export const ARCHIVE_REPORT_DELETE_LABEL = '删除报告';
export const ARCHIVE_REPORT_DELETE_CONFIRM_LABEL = '确认删除';
export const ARCHIVE_REPORT_DELETE_CANCEL_LABEL = '取消';
export const ARCHIVE_REPORT_DELETE_NOTE = '删除只摘掉这份报告：归档记录、作品与点评一条都不会动。';
export const ARCHIVE_REPORT_DELETE_DONE = '报告已删除；归档记录与作品一条都没有动。';
export const ARCHIVE_REPORT_LOCAL_NOTE = '云端这次没有接到这份报告，它已经保存在本机镜像里；云端表接上之后会随下一次写入同步过去。';
export const ARCHIVE_REPORT_STALE_HINT = '归档里有比这份报告更新的内容，点「更新报告」生成新的一版（旧版本会留在历史里）。';
export const ARCHIVE_REPORT_LESSON_TITLE = '这份报告覆盖的课次';

/** 生成入口的禁用原因（一条都读不到时如实说明，不给笼统的「请完善信息」）。 */
export function archiveReportGenerateIssue({ name = '', total = 0, count = 0, period = '' } = {}) {
  if (!str(name)) return '先选择要生成报告的学员或班级。';
  if (!num(total)) return '这个对象还没有归档的课后反馈：先归档一次，再回来生成阶段报告。';
  if (!num(count)) {
    return `${name}一共归档了 ${num(total)} 节课，但「${str(period) || ARCHIVE_PERIOD_DEFAULT}」周期内一节都没有：换一个周期，或先归档新的课次。`;
  }
  return '';
}

/** 周期：报告只认三个真实周期（报告没有「全部」这一档 —— 它必须是一个可命名的阶段）。 */
export function resolveArchiveReportPeriod(value) {
  const name = str(value);
  return ARCHIVE_PERIODS.includes(name) ? name : ARCHIVE_PERIOD_DEFAULT;
}

/** 类型：不在词表里的一律读成默认类型（脏值不抛错、也不静默生成「另一种」报告）。 */
export function resolveArchiveReportType(value) {
  const name = str(value);
  return ARCHIVE_REPORT_TYPES.includes(name) ? name : ARCHIVE_REPORT_TYPE_DEFAULT;
}

/**
 * 业务唯一键（FR-236）：`对象段 + 周期 + 类型`。
 * 对象段带 `student::` / `class::` 前缀 —— 同一个名字既是学员又是班级时不会撞键。
 * 没有对象名时给空串：**空键不生成报告**（界面据此禁用生成按钮）。
 */
export function archiveReportKey({ target, name = '', period, type } = {}) {
  const resolvedName = str(name);
  if (!resolvedName) return '';
  const scope = str(target) === ARCHIVE_TARGET_CLASS ? 'class' : 'student';
  return `${scope}::${resolvedName}::${resolveArchiveReportPeriod(period)}::${resolveArchiveReportType(type)}`;
}

/** FNV-1a 32 位（与 `data/feedbackRecords.js` 的 `deriveRecordId` 同一套算法）。 */
function archiveReportHash(text) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 报告 id 由 `reportKey` 派生：同一个键永远得到同一个 id（幂等写入的基础）。 */
export function deriveArchiveReportId(reportKey) {
  return `report-${archiveReportHash(str(reportKey))}`;
}

/** 一节课进快照的那一行：只留**文本**（素材地址不进数据模型，与全站口径一致）。 */
function reportLessonRow(record) {
  const source = record && typeof record === 'object' ? record : {};
  const reviews = source.reviews && typeof source.reviews === 'object' && !Array.isArray(source.reviews) ? source.reviews : {};
  const media = archiveRecordMediaView(source, { surface: 'teacher' });
  const dimensions = REVIEW_DIMENSION_NAMES
    .map(name => ({ name, text: str(reviews[name]).slice(0, ARCHIVE_REPORT_DIMENSION_TEXT_LIMIT) }))
    .filter(row => row.text);
  return {
    id: str(source.id),
    recordKey: str(source.recordKey),
    date: str(source.date),
    title: str(source.title),
    status: str(source.status),
    isAbsence: str(source.status) === '缺课',
    // 「作品 / 照片」只数**真的看得见的**（与档案概况同一口径：占位不算、没有图不算）。
    hasArtwork: Boolean(str(media.artwork && media.artwork.url)),
    photoCount: num(media.photoCount),
    dimensionCount: dimensions.length,
    dimensions
  };
}

/**
 * 生成一份报告的快照（FR-239 的原料）：**全部来自归档数据聚合**，没有一句写死的示例文案。
 *
 * 关联课次 = 这位对象名下**落在报告周期窗口内**的记录（周期口径与档案页的筛选器同一份：
 * 只有下界、没有上界、读不出日期的记录留在窗口里 —— 报告不凭空藏记录）。
 * `studentId` / `classId` 取自记录本身（旧记录没有就留空，不编）。
 */
export function buildArchiveReportSnapshot({ records = [], target, name = '', period, type, today } = {}) {
  const reportPeriod = resolveArchiveReportPeriod(period);
  const reportType = resolveArchiveReportType(type);
  const targetView = archiveTargetView(records, { target, student: name, className: name });
  const inPeriod = filterArchiveRecordsByPeriod(targetView.lessons, reportPeriod, today);
  const lessons = inPeriod.map(reportLessonRow);
  const studentId = str(inPeriod.map(record => record && record.studentId).find(Boolean));
  const classId = str(inPeriod.map(record => record && record.classId).find(Boolean));
  return {
    target: targetView.target,
    isClass: targetView.isClass,
    name: targetView.name,
    displayName: targetView.displayName,
    period: reportPeriod,
    type: reportType,
    periodWindow: archivePeriodWindow(reportPeriod, today),
    // 四项概况与快照里实际覆盖的课次一一对应（数出来，不是填出来的）。
    lessonCount: lessons.length,
    artworkCount: lessons.filter(lesson => lesson.hasArtwork).length,
    photoCount: lessons.reduce((total, lesson) => total + num(lesson.photoCount), 0),
    absenceCount: lessons.filter(lesson => lesson.isAbsence).length,
    lessonIds: lessons.map(lesson => lesson.id || lesson.recordKey).filter(Boolean),
    lessons,
    studentId,
    classId
  };
}

/** 概况四行：界面只渲染这一份产物（`value` / `detail` 都拼好，界面不自己拼字符串）。 */
export function archiveReportSnapshotView(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const facts = {
    lessons: String(num(source.lessonCount)),
    artworks: String(num(source.artworkCount)),
    photos: String(num(source.photoCount)),
    absence: String(num(source.absenceCount))
  };
  const details = {
    lessons: str(source.period) ? `按「${str(source.period)}」周期聚合` : '',
    artworks: '有成品作品图的课次',
    photos: '修正后的课堂照片',
    absence: num(source.absenceCount) ? '缺课也被温柔地留了一页' : '这一阶段没有缺课'
  };
  return {
    lessonCount: num(source.lessonCount),
    artworkCount: num(source.artworkCount),
    photoCount: num(source.photoCount),
    absenceCount: num(source.absenceCount),
    periodWindow: source.periodWindow && typeof source.periodWindow === 'object' ? source.periodWindow : null,
    facts: ARCHIVE_REPORT_FACTS.map(field => ({
      id: field.id,
      label: field.label,
      hint: field.hint,
      value: facts[field.id],
      detail: details[field.id]
    })),
    lessonRows: (Array.isArray(source.lessons) ? source.lessons : []).map(lesson => ({
      id: str(lesson && lesson.id),
      date: str(lesson && lesson.date),
      title: str(lesson && lesson.title),
      status: str(lesson && lesson.status),
      isAbsence: Boolean(lesson && lesson.isAbsence),
      hasArtwork: Boolean(lesson && lesson.hasArtwork),
      photoCount: num(lesson && lesson.photoCount),
      dimensionCount: num(lesson && lesson.dimensionCount),
      dimensions: (Array.isArray(lesson && lesson.dimensions) ? lesson.dimensions : []).map(row => ({ name: str(row && row.name), text: str(row && row.text) }))
    }))
  };
}

/** 版本读数：「第 2 版」（脏数据回落第 1 版，与归档记录的 `archiveVersionLabel` 同一句）。 */
export function archiveReportVersionLabel(version) {
  const value = Math.trunc(Number(version));
  return `第 ${Number.isFinite(value) && value > 0 ? value : 1} 版`;
}

/**
 * `10 月 12 日` 这一句（验收原文「生成于 X 月 X 日 · 共 N 节课」）。
 * 跨年的报告补上年份（`2025 年 12 月 30 日`）—— 老师手里可能同时有两年的报告。
 */
export function archiveReportDateText(value, now = new Date()) {
  const source = str(value);
  if (!source) return '';
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return source;
  const year = Number.isFinite(Number(now && now.getFullYear ? now.getFullYear() : NaN)) ? now.getFullYear() : new Date().getFullYear();
  const prefix = date.getFullYear() === year ? '' : `${date.getFullYear()} 年 `;
  return `${prefix}${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 报告实体（FR-236）：`reportKey / period / type / snapshot / version / generatedAt / generatedBy / status`。 */
export function createArchiveReport({ snapshot, generatedBy = '', generatedAt = '', status = '' } = {}) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const reportKey = archiveReportKey({ target: source.target, name: source.name, period: source.period, type: source.type });
  const at = str(generatedAt) || new Date().toISOString();
  return {
    reportKey,
    id: deriveArchiveReportId(reportKey),
    target: str(source.target) === ARCHIVE_TARGET_CLASS ? ARCHIVE_TARGET_CLASS : '个人',
    name: str(source.name),
    displayName: str(source.displayName) || str(source.name),
    studentId: str(source.studentId),
    classId: str(source.classId),
    period: resolveArchiveReportPeriod(source.period),
    type: resolveArchiveReportType(source.type),
    snapshot: snapshot && typeof snapshot === 'object' ? snapshot : {},
    version: 1,
    generatedAt: at,
    generatedBy: str(generatedBy),
    status: normalizeArchiveReportStatus(status),
    history: []
  };
}

/**
 * 更新报告：`version` 自增，**被替换的那一版整份进 `history`**（顺序：最新在前），
 * 超过 `ARCHIVE_REPORT_VERSION_LIMIT` 时丢掉最老的（快照是文本，不设上限会顶爆 localStorage）。
 * `reportKey` / `id` 全程不变 —— 同一个键永远只有一份「当前版本」。
 * 快照必须是**为同一个键**聚合的（界面按当前选中的周期与类型聚合，天然一致）；
 * 键的身份只由 `current` 决定，一次更新不会把报告改成另一个键。
 */
export function updateArchiveReport(report, { snapshot, generatedBy = '', generatedAt = '', status = '' } = {}) {
  const current = normalizeArchiveReport(report);
  if (!current) return createArchiveReport({ snapshot, generatedBy, generatedAt, status });
  const at = str(generatedAt) || new Date().toISOString();
  const previous = {
    version: current.version,
    generatedAt: current.generatedAt,
    generatedBy: current.generatedBy,
    // 历史版本只说「哪一版是什么内容」：落库状态是当前这一版的读数，进历史没有意义。
    status: ARCHIVE_REPORT_STATUSES.synced,
    snapshot: current.snapshot
  };
  return {
    ...current,
    snapshot: snapshot && typeof snapshot === 'object' ? snapshot : current.snapshot,
    version: current.version + 1,
    generatedAt: at,
    generatedBy: str(generatedBy) || current.generatedBy,
    status: normalizeArchiveReportStatus(status || current.status),
    history: [previous, ...current.history].slice(0, ARCHIVE_REPORT_VERSION_LIMIT)
  };
}

/** 历史版本归一化：只保留「有一份快照」的条目，脏条目丢掉而不是让界面读到 undefined。 */
export function normalizeArchiveReportHistory(list) {
  return (Array.isArray(list) ? list : [])
    .map(entry => {
      const source = entry && typeof entry === 'object' ? entry : {};
      const version = Math.trunc(Number(source.version));
      if (!Number.isFinite(version) || version <= 0) return null;
      return {
        version,
        generatedAt: str(source.generatedAt),
        generatedBy: str(source.generatedBy),
        status: ARCHIVE_REPORT_STATUSES.synced,
        snapshot: source.snapshot && typeof source.snapshot === 'object' ? source.snapshot : {}
      };
    })
    .filter(Boolean);
}

/**
 * 读盘 / 云端 payload 一律过这一道：脏值不抛错、缺字段补默认。
 * 没有 `reportKey` 的条目直接丢掉（没有键就没有身份，也就没法去重与更新）。
 * `status` 缺省按 `local` 读（读到的多半就是本机镜像那一份），只有显式 `synced` 才算已同步。
 */
export function normalizeArchiveReport(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const period = resolveArchiveReportPeriod(source.period);
  const type = resolveArchiveReportType(source.type);
  const name = str(source.name);
  const reportKey = str(source.reportKey) || archiveReportKey({ target: source.target, name, period, type });
  if (!reportKey) return null;
  const snapshot = source.snapshot && typeof source.snapshot === 'object' ? source.snapshot : {};
  const version = Math.trunc(Number(source.version));
  return {
    reportKey,
    id: str(source.id) || deriveArchiveReportId(reportKey),
    target: str(source.target) === ARCHIVE_TARGET_CLASS ? ARCHIVE_TARGET_CLASS : '个人',
    name,
    displayName: str(source.displayName) || name,
    studentId: str(source.studentId),
    classId: str(source.classId),
    period,
    type,
    snapshot,
    version: Number.isFinite(version) && version > 0 ? version : 1,
    generatedAt: str(source.generatedAt),
    generatedBy: str(source.generatedBy),
    status: normalizeArchiveReportStatus(source.status),
    history: normalizeArchiveReportHistory(source.history)
  };
}

/** 落库状态的就地改写（「先本机、后云端」的第二步用它把状态翻成已同步），内容一个字不动。 */
export function setArchiveReportStatus(report, status) {
  const current = normalizeArchiveReport(report);
  if (!current) return null;
  return { ...current, status: normalizeArchiveReportStatus(status) };
}

/** 按 `reportKey` 找那一份报告（先归一化：界面读到的字段永远齐全）。 */
export function findArchiveReport(reports, reportKey) {
  const key = str(reportKey);
  if (!key) return null;
  return (Array.isArray(reports) ? reports : [])
    .map(normalizeArchiveReport)
    .find(report => report && report.reportKey === key) || null;
}

/**
 * 按 `reportKey` 去重兜底（同一个键只该有一份报告：它就是「当前版本」）。
 * **保序**：同键的后来者覆盖前一个，但位置仍是它第一次出现的位置（界面「就地替换、顺序不动」靠它）。
 */
export function normalizeArchiveReportList(reports) {
  const byKey = new Map();
  (Array.isArray(reports) ? reports : []).forEach(item => {
    const report = normalizeArchiveReport(item);
    if (report) byKey.set(report.reportKey, report);
  });
  return [...byKey.values()];
}

/** 读盘 / 展示用的顺序：同一份列表再按生成时间**倒序**（最近生成的排前面）。 */
export function dedupeArchiveReports(reports) {
  return normalizeArchiveReportList(reports).sort((a, b) => str(b.generatedAt).localeCompare(str(a.generatedAt)));
}

/** 生成 / 更新之后把它并进列表：同 `reportKey` **就地替换**、其余不动（顺序不动）。 */
export function applyArchiveReport(reports, report) {
  const next = normalizeArchiveReport(report);
  const list = normalizeArchiveReportList(reports);
  if (!next) return list;
  const index = list.findIndex(item => item.reportKey === next.reportKey);
  if (index < 0) return [next, ...list];
  return list.map((item, position) => (position === index ? next : item));
}

/**
 * 删除报告（FR-241）：只摘掉这一份报告，**归档记录一个字都不动**
 * （记录在 `xinlehui-feedback-records-v1` / 云端 `feedback_records`，与报告是两套数据）。
 */
export function removeArchiveReport(reports, reportKey) {
  const key = str(reportKey);
  if (!key) return normalizeArchiveReportList(reports);
  return normalizeArchiveReportList(reports).filter(report => report.reportKey !== key);
}

/**
 * 再次进入档案页时默认展示哪一份报告：这位对象名下**最近生成**的那一份，
 * 把它的周期与类型回填给下拉（验收原文「若已有同 reportKey 的报告则直接展示」）。
 * 一份都没有时给默认周期 / 类型（一学期 + 成长集锦）。
 */
export function archiveReportDefaultSelection({ reports = [], target, name = '' } = {}) {
  const scope = str(target) === ARCHIVE_TARGET_CLASS ? ARCHIVE_TARGET_CLASS : '个人';
  const own = dedupeArchiveReports(reports).filter(report => report.target === scope && report.name === str(name));
  const latest = own[0];
  return {
    period: latest ? latest.period : ARCHIVE_PERIOD_DEFAULT,
    type: latest ? latest.type : ARCHIVE_REPORT_TYPE_DEFAULT,
    report: latest || null
  };
}

/**
 * 归档里有没有比这份报告更新的内容（生成之后又归档 / 改过点评）：
 * 有就给「更新报告」一个具体的理由，而不是让老师自己猜要不要点。
 * 判据只看时间戳（`updatedAt` → `archivedAt`），推不出来的一律不算「更新了」。
 */
export function archiveReportStale(report, records = []) {
  const current = normalizeArchiveReport(report);
  if (!current) return false;
  const generatedAt = str(current.generatedAt);
  if (!generatedAt) return false;
  return (Array.isArray(records) ? records : []).some(record => {
    const stamp = str(record && (record.updatedAt || record.archivedAt));
    return Boolean(stamp) && stamp > generatedAt;
  });
}

/**
 * 报告视图：界面只渲染这一份产物。历史版本按**最新在前**给全（`versionLabel` / `generatedAtText` 都拼好）。
 * `annotation` 就是验收原文那一句：「生成于 10 月 12 日 · 共 3 节课」。
 */
export function archiveReportView(report, { now } = {}) {
  const current = normalizeArchiveReport(report);
  if (!current) return null;
  const snapshotView = archiveReportSnapshotView(current.snapshot);
  const generatedAtText = formatArchiveTime(current.generatedAt);
  const history = current.history.map(entry => {
    const entryView = archiveReportSnapshotView(entry.snapshot);
    return {
      version: entry.version,
      versionLabel: archiveReportVersionLabel(entry.version),
      generatedAt: entry.generatedAt,
      generatedAtText: formatArchiveTime(entry.generatedAt),
      generatedBy: entry.generatedBy,
      annotation: `生成于 ${archiveReportDateText(entry.generatedAt, now) || '未记录时间'} · 共 ${entryView.lessonCount} 节课`,
      lessonCount: entryView.lessonCount,
      facts: entryView.facts,
      lessonRows: entryView.lessonRows
    };
  });
  return {
    reportKey: current.reportKey,
    id: current.id,
    target: current.target,
    name: current.name,
    displayName: current.displayName,
    studentId: current.studentId,
    classId: current.classId,
    period: current.period,
    type: current.type,
    title: `${current.displayName} · ${current.period}${current.type}`,
    status: current.status,
    statusLabel: ARCHIVE_REPORT_STATUS_LABELS[current.status] || ARCHIVE_REPORT_STATUS_LABELS.ready,
    version: current.version,
    versionLabel: archiveReportVersionLabel(current.version),
    generatedAt: current.generatedAt,
    generatedAtText,
    generatedBy: current.generatedBy,
    generatedByText: current.generatedBy ? `由 ${current.generatedBy} 生成` : '生成人未记录',
    annotation: `生成于 ${archiveReportDateText(current.generatedAt, now) || '未记录时间'} · 共 ${snapshotView.lessonCount} 节课`,
    lessonCount: snapshotView.lessonCount,
    artworkCount: snapshotView.artworkCount,
    photoCount: snapshotView.photoCount,
    absenceCount: snapshotView.absenceCount,
    facts: snapshotView.facts,
    lessonRows: snapshotView.lessonRows,
    history,
    historyCount: history.length,
    hasHistory: history.length > 0
  };
}

/** 生成按钮的文案：没有报告 → 「生成阶段报告」；已有 → 「更新报告」（同一个按钮，两种语义）。 */
export function archiveReportActionLabel(report) {
  return report ? ARCHIVE_REPORT_UPDATE_LABEL : ARCHIVE_REPORT_GENERATE_LABEL;
}

/** 生成按钮的动作词（界面的 `data-archive-report-action` 与断言读它）。 */
export function archiveReportAction(report) {
  return report ? 'update' : 'create';
}

const safeParse = (value, fallback) => {
  try {
    return JSON.parse(value) || fallback;
  } catch {
    return fallback;
  }
};

/**
 * 配额兜底（本机镜像的第二档降级）：历史版本只留「哪一版、什么时候生成的、多少节课」，
 * 当前快照的课次明细截到前 40 条 —— 宁可少存一点明细，也不能让报告整份写不进去。
 */
export function slimArchiveReportsForStorage(reports) {
  return dedupeArchiveReports(reports).map(report => {
    const snapshot = report.snapshot && typeof report.snapshot === 'object' ? report.snapshot : {};
    const lessons = Array.isArray(snapshot.lessons) ? snapshot.lessons.slice(0, 40) : [];
    return {
      ...report,
      snapshot: { ...snapshot, lessons },
      history: report.history.map(entry => {
        const entrySnapshot = entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : {};
        const { lessons: entryLessons, ...rest } = entrySnapshot;
        return { ...entry, snapshot: rest };
      })
    };
  });
}

function writeArchiveReports(list) {
  try {
    window.localStorage.setItem(ARCHIVE_REPORT_STORAGE_KEY, JSON.stringify(list));
  } catch {
    window.localStorage.setItem(ARCHIVE_REPORT_STORAGE_KEY, JSON.stringify(slimArchiveReportsForStorage(list)));
  }
}

/** 读本机镜像（没有 / 读坏都给空数组：报告是可选内容，读不到就当还没生成过）。 */
export function loadArchiveReports() {
  if (typeof window === 'undefined') return [];
  return dedupeArchiveReports(safeParse(window.localStorage.getItem(ARCHIVE_REPORT_STORAGE_KEY), []));
}

export function persistArchiveReports(reports) {
  if (typeof window === 'undefined') return;
  const list = dedupeArchiveReports(reports);
  try {
    writeArchiveReports(list);
  } catch {
    /* 配额实在不够时连瘦身版都写不进去：报告已经在本机界面里，下一次写入再试。 */
  }
}

/**
 * 合并本机镜像与云端（与 `mergeFeedbackRecords` 同一套写法）：
 * 两边先各过 `normalizeArchiveReport`，**同键本机优先**（本机刚生成、还没推上云的那一版
 * 不能被云端旧记录顶掉 —— 云端表没建出来时本机镜像就是唯一副本），最后按生成时间倒序去重。
 * 一个例外：两边**版本号一致**时说明这一版确实推上云过（云端有它），状态据实读成「已同步」——
 * 否则「已同步」会被下一次读盘悄悄降级成「仅本机镜像」，那是假消息。
 */
export function mergeArchiveReports(localReports, remoteReports) {
  const byKey = new Map();
  (Array.isArray(remoteReports) ? remoteReports : []).forEach(item => {
    const report = normalizeArchiveReport(item);
    if (report) byKey.set(report.reportKey, report);
  });
  (Array.isArray(localReports) ? localReports : []).forEach(item => {
    const report = normalizeArchiveReport(item);
    if (!report) return;
    const remote = byKey.get(report.reportKey);
    byKey.set(report.reportKey, remote && remote.version === report.version
      ? { ...report, status: ARCHIVE_REPORT_STATUSES.synced }
      : report);
  });
  return dedupeArchiveReports([...byKey.values()]);
}

/** 报告条目的云端 payload 白名单（行映射在 `services/archiveReportsApi.js`）。 */
export const ARCHIVE_REPORT_FIELDS = [
  'reportKey', 'id', 'target', 'name', 'displayName', 'studentId', 'classId',
  'period', 'type', 'snapshot', 'version', 'generatedAt', 'generatedBy', 'status', 'history'
];
