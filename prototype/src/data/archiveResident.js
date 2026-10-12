// 成长档案「常驻视图」的唯一真源（[第四步 US-206] / FR-206）。
//
// US-205 之前档案页是「先选生成对象与周期，再点生成，才看到预览」；US-206 把这一页收成**常驻视图**：
// 进入就直接看到孩子的成长轨迹，「对象 / 周期」退化成筛选器。于是这一页只有四件事要回答：
//  ① **概况**：已归档课次数、作品数、照片数、最近一次归档时间（`ARCHIVE_OVERVIEW_FIELDS` 是顺序真源）；
//  ② **时间线**：按日期升序的每一节课 —— 成品作品图、课堂照片、五维点评摘要、缺课记录（保留温暖缺课文案）；
//  ③ **筛选**：对象（学员 / 班级）+ 周期窗口 + 是否只看缺课，切换**只过滤不重置**（`archiveResidentView`
//     把「被筛掉的条数」如实报出来，界面用它在空态里说清「为什么这里是空的」）；
//  ④ **四种状态**：加载 / 就绪 / 空 / 错误（`archiveResidentStateView` 给**同形状**的四份读数，
//     界面在组件 body 里无条件读它 —— 少给一个字段就会在渲染期炸成白屏，US-204 真踩过）。
//
// 口径不在这里另写一套：
//  - 对象过滤沿用 `data/archiveTargets.js` 的 `archiveTargetView`（含空态文案）；
//  - 周期窗口沿用同一份的 `filterArchiveRecordsByPeriod`（`today` 可注入）；
//  - 图的取法沿用 `data/archiveMedia.js` 的 `archiveRecordMediaView`（media 持久地址优先、退回 artworkUrl/photoUrl）；
//  - 五维维度名读 `data/reviewDetailPanel.js` 的 `REVIEW_DIMENSION_NAMES`（与第三步、归档摘要同一份）；
//  - 时间读数读 `data/archiveSummary.js` 的 `formatArchiveTime` / `archiveVersionLabel`。
//
// 零依赖纯函数（只 import 同样零依赖的 data 模块），界面只渲染本模块的产物，可 `node` 直跑断言。

import { archiveRecordMediaView } from './archiveMedia';
import { archiveVersionLabel, formatArchiveTime } from './archiveSummary';
import { REVIEW_DIMENSION_NAMES } from './reviewDetailPanel';
// 转发状态（[第四步 US-209]）：档案列表每一行都要显示「未转发 / 已转发 / 已撤回」与打开次数，
// 判据是 `data/shareForward.js` 那一份（与第四步的状态块读同一个函数 —— 列表不自己拼状态）。
import { shareForwardView } from './shareForward';
import {
  ARCHIVE_PERIOD_ALL,
  ARCHIVE_TARGET_CLASS,
  archiveEmptyView,
  archivePeriodWindow,
  archiveTargetView,
  filterArchiveRecordsByPeriod,
  resolveArchivePeriod
} from './archiveTargets';

const str = value => String(value ?? '').trim();
const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** 归档记录的状态词（与 `createFeedbackRecord` 落库的 `status` 同一个词表）。 */
export const ARCHIVE_LESSON_ARCHIVED = '已归档';
export const ARCHIVE_LESSON_ABSENCE = '缺课';

/** 缺课记录里那句温柔的占位（沿用现有文案；记录自带 `summary` 时以记录为准）。 */
export const ARCHIVE_ABSENCE_FALLBACK_TEXT = '老师已经把当天的主题和创作机会好好保留，等孩子回来时，会陪她自然地接上。';

/** 「是否只看缺课」筛选（US-206 来源 PRD 的「是否有缺课筛选」）。 */
export const ARCHIVE_ABSENCE_ALL = '全部课次';
export const ARCHIVE_ABSENCE_ONLY = '只看缺课';
export const ARCHIVE_ABSENCE_FILTERS = [ARCHIVE_ABSENCE_ALL, ARCHIVE_ABSENCE_ONLY];

/** 常驻视图的四种状态（与界面里的状态面板一一对应）。 */
export const ARCHIVE_RESIDENT_STATES = {
  loading: 'loading',
  ready: 'ready',
  empty: 'empty',
  error: 'error'
};

/** 概况四项（顺序真源）：标题渲染、`data-archive-overview-*` 属性与断言都读它。 */
export const ARCHIVE_OVERVIEW_FIELDS = [
  { id: 'lessons', label: '已归档课次', hint: '这位孩子 / 这个班级已经归档的课次数量' },
  { id: 'artworks', label: '作品', hint: '档案里能看到的装裱成品图数量' },
  { id: 'photos', label: '课堂照片', hint: '档案里能看到的修正后课堂照片数量' },
  { id: 'lastArchivedAt', label: '最近归档', hint: '最近一次写入成长档案的时间' }
];

/** 概况四项的 id 清单（断言用：四项缺一不可）。 */
export const ARCHIVE_OVERVIEW_FIELD_IDS = ARCHIVE_OVERVIEW_FIELDS.map(field => field.id);

/** 加载态 / 错误态的文案与动作（错误态必须可重试 —— 重试只重读，不动任何记录）。 */
export const ARCHIVE_RESIDENT_LOADING_TEXT = '正在读取成长档案…';
export const ARCHIVE_RESIDENT_LOADING_DESC = '已归档的课次、成品作品、课堂照片与点评正在路上。';
export const ARCHIVE_RESIDENT_ERROR_TITLE = '成长档案没有读取成功';
export const ARCHIVE_RESIDENT_ERROR_DESC = '网络似乎开了小差，云端档案没有成功返回。可以重试；已经归档的记录不会因为这一次失败而消失。';
export const ARCHIVE_RESIDENT_ERROR_HINT = '重试只会重新读取一次，不会改动任何已归档记录。';
export const ARCHIVE_RESIDENT_RETRY_LABEL = '重新加载';
/** 读取失败时仍把本机镜像里的记录展示出来时的那句话（明示来源，不静默降级 —— FR-142 的口径）。 */
export const ARCHIVE_RESIDENT_LOCAL_NOTE = '云端这次没有读回来，下面是本机镜像里已经保存的档案记录；重试成功后会与云端记录合并。';

/** 时间线的标题与说明（常驻视图的主区块）。 */
export const ARCHIVE_TIMELINE_TITLE = '每一次认真，都值得被连续地看见。';
export const ARCHIVE_TIMELINE_DESC = '这里按日期升序展示每一节课的成品作品、课堂照片与五维点评摘要；缺课也被温柔地留在成长记录里。';

/** 周期 / 缺课筛选把内容筛空时的空态（与「一条记录都没有」区分开 —— 否则老师会以为档案丢了）。 */
export const ARCHIVE_FILTERED_EMPTY_TITLE = '当前筛选下没有归档记录';
export const ARCHIVE_FILTERED_EMPTY_ACTION = '查看全部记录';

/** 这条记录是不是缺课（判据只有落地过的 `status` 字段，不从点评内容里猜）。 */
export function isAbsenceRecord(record) {
  return str(record && record.status) === ARCHIVE_LESSON_ABSENCE;
}

/**
 * 一节课在时间线上的那一张卡（US-206 第 2 条点名的五项：日期与作品名、成品作品图、
 * 课堂照片、五维点评摘要、缺课记录）。
 *
 * 五维摘要只列**真的写了正文的维度**（空维度不占位、更不编一段示例文案，FR-205 的口径）；
 * 缺课记录没有五维，只有那句温柔的话。
 */
export function archiveLessonEntry(record, { surface = 'teacher', tokens = [], now = null } = {}) {
  const source = record && typeof record === 'object' ? record : {};
  const reviews = source.reviews && typeof source.reviews === 'object' && !Array.isArray(source.reviews) ? source.reviews : {};
  const isAbsence = isAbsenceRecord(source);
  const media = archiveRecordMediaView(source, { surface });
  const dimensions = REVIEW_DIMENSION_NAMES
    .map(name => ({ name, text: str(reviews[name]) }))
    .filter(row => row.text);
  const date = str(source.date);
  // 这一条档案的转发状态（US-209）：按档案记录 id 找它最新的一条令牌，三态与打开次数都从那里推导。
  const forward = shareForwardView({ tokens, recordId: str(source.id), record: source, now });
  return {
    id: str(source.id),
    recordKey: str(source.recordKey),
    student: str(source.student),
    className: str(source.className),
    date,
    // 展签口径的课次日期（US-038）：时间线主读数仍是记录的 `date`（与既有页面一致），
    // 这个字段给需要 `2026.08.04` 的位置（例如后续的分享页）。
    dateDots: date.replace(/-/g, '.'),
    title: str(source.title),
    status: isAbsence ? ARCHIVE_LESSON_ABSENCE : (str(source.status) || ARCHIVE_LESSON_ARCHIVED),
    isAbsence,
    archived: Boolean(str(source.id) || str(source.recordKey)),
    archivedAt: str(source.archivedAt),
    archivedAtText: formatArchiveTime(source.archivedAt),
    versionLabel: archiveVersionLabel(source.version),
    artwork: media.artwork,
    photos: media.photos,
    photoCount: media.photoCount,
    dimensions,
    dimensionCount: dimensions.length,
    // 转发状态（US-209）：状态 / 渠道 / 转发时间 / 打开次数都在里面，界面只渲染 `line` 与这几个读数。
    forward,
    // 缺课记录的那句话：记录自带 `summary` 就用它，没有才用统一占位（不编造老师的原话）。
    absenceText: isAbsence ? (str(reviews.summary) || ARCHIVE_ABSENCE_FALLBACK_TEXT) : ''
  };
}

/**
 * 档案概况（US-206 第 4 条）：已归档课次数、作品数、照片数、最近一次归档时间。
 * 读的是**当前筛选后的那批课次** —— 换了筛选，概况跟着变（筛选只过滤，概况如实反映看得到的内容）。
 */
export function archiveResidentSummary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const artworks = list.filter(entry => str(entry && entry.artwork && entry.artwork.url)).length;
  const photos = list.reduce((total, entry) => total + num(entry && entry.photoCount), 0);
  const absenceCount = list.filter(entry => entry && entry.isAbsence).length;
  const lastArchivedAt = list
    .map(entry => str(entry && entry.archivedAt))
    .filter(Boolean)
    .sort()
    .pop() || '';
  return {
    lessons: list.length,
    artworks,
    photos,
    absenceCount,
    lastArchivedAt,
    lastArchivedText: formatArchiveTime(lastArchivedAt)
  };
}

/** 概况渲染成四行（`value` / `detail` 都给，界面不自己拼字符串）。 */
export function archiveResidentOverview(summary) {
  const source = summary && typeof summary === 'object' ? summary : {};
  const lessons = num(source.lessons);
  const absenceCount = num(source.absenceCount);
  const lastText = str(source.lastArchivedText);
  const values = {
    lessons: String(lessons),
    artworks: String(num(source.artworks)),
    photos: String(num(source.photos)),
    lastArchivedAt: lastText || '还没有归档记录'
  };
  const details = {
    lessons: absenceCount ? `含缺课 ${absenceCount} 节` : '每一次课都在时间线上',
    artworks: '装裱成品图',
    photos: '修正后的课堂照片',
    lastArchivedAt: lastText ? '最近一次写入成长档案' : '归档一次课后反馈后就有时间'
  };
  return ARCHIVE_OVERVIEW_FIELDS.map(field => ({
    id: field.id,
    label: field.label,
    hint: field.hint,
    value: values[field.id],
    detail: details[field.id],
    // `ok` 让界面知道这一项是有内容的（最近归档时间在空档案里如实为 false）。
    ok: field.id === 'lastArchivedAt' ? Boolean(lastText) : true
  }));
}

/**
 * 常驻视图（界面只读这一份产物）。
 *
 * 入参：`records`（当前对象的全部归档记录）+ 筛选条件（对象 / 周期 / 是否只看缺课）+ 可注入的 `today`。
 * 返回里把「被筛掉的条数」分开报（`hiddenByPeriod` / `hiddenByAbsence`）—— 空态据此说清原因，
 * 而不是让老师以为档案丢了。
 */
export function archiveResidentView({ records = [], target, student = '', className = '', period = ARCHIVE_PERIOD_ALL, absenceOnly = false, today, tokens = [] } = {}) {
  const targetView = archiveTargetView(records, { target, student, className });
  const periodName = resolveArchivePeriod(period);
  const inPeriod = filterArchiveRecordsByPeriod(targetView.lessons, periodName, today);
  const onlyAbsence = absenceOnly === true || absenceOnly === ARCHIVE_ABSENCE_ONLY;
  const lessons = onlyAbsence ? inPeriod.filter(isAbsenceRecord) : inPeriod;
  const entries = lessons.map(record => archiveLessonEntry(record, { tokens }));
  const summary = archiveResidentSummary(entries);
  return {
    targetView,
    target: targetView.target,
    isClass: targetView.isClass,
    name: targetView.name,
    displayName: targetView.displayName,
    period: periodName,
    periodWindow: archivePeriodWindow(periodName, today),
    absenceOnly: onlyAbsence,
    absenceFilter: onlyAbsence ? ARCHIVE_ABSENCE_ONLY : ARCHIVE_ABSENCE_ALL,
    lessons,
    entries,
    // `count` = 当前筛选下看得到的；`total` = 这位对象一共归档了多少（对象筛选之后的条数）。
    count: entries.length,
    total: targetView.count,
    hiddenByPeriod: targetView.count - inPeriod.length,
    hiddenByAbsence: inPeriod.length - lessons.length,
    summary,
    overview: archiveResidentOverview(summary),
    // 「一条记录都没有」的空态文案沿用 US-205 的 `archiveEmptyView`（验收点名的那一份）。
    empty: archiveEmptyView(targetView)
  };
}

/**
 * 四种状态的判据：数据源还在读 → 加载；读失败 → 错误；读到了但没有课次 → 空；否则就绪。
 * `source` 是档案数据源的状态词（`loading` / `ready` / `failed`），未知值一律按就绪处理。
 */
export function archiveResidentPhase({ source = 'ready', count = 0 } = {}) {
  const status = str(source);
  if (status === 'loading') return ARCHIVE_RESIDENT_STATES.loading;
  if (status === 'failed') return ARCHIVE_RESIDENT_STATES.error;
  return num(count) > 0 ? ARCHIVE_RESIDENT_STATES.ready : ARCHIVE_RESIDENT_STATES.empty;
}

/**
 * 状态面板的四份读数 —— **所有状态返回同一组字段**（US-204 的纪律：少一个字段就会在渲染期白屏）。
 *
 * - `action` 是动作的文案（'' = 没有动作）；三种动作各有一个 flag：
 *   `retry`（重新读取档案）、`reset`（把筛选还原 —— 周期 / 缺课筛选把内容筛空时给的那一个）、
 *   `create`（去创建课后反馈 —— 这个对象一条记录都没有时给的那一个）。
 * - 就绪时四份读数都是空串（界面不渲染状态面板）。
 */
export function archiveResidentStateView({ phase = ARCHIVE_RESIDENT_STATES.ready, view = {} } = {}) {
  const source = view && typeof view === 'object' ? view : {};
  const empty = source.empty && typeof source.empty === 'object' ? source.empty : {};
  const name = str(source.displayName) || '这位孩子';
  const base = { phase, title: '', desc: '', hint: '', action: '', retry: false, reset: false, create: false };
  if (phase === ARCHIVE_RESIDENT_STATES.loading) {
    return { ...base, title: ARCHIVE_RESIDENT_LOADING_TEXT, desc: ARCHIVE_RESIDENT_LOADING_DESC };
  }
  if (phase === ARCHIVE_RESIDENT_STATES.error) {
    return {
      ...base,
      title: ARCHIVE_RESIDENT_ERROR_TITLE,
      desc: ARCHIVE_RESIDENT_ERROR_DESC,
      hint: ARCHIVE_RESIDENT_ERROR_HINT,
      action: ARCHIVE_RESIDENT_RETRY_LABEL,
      retry: true
    };
  }
  if (phase === ARCHIVE_RESIDENT_STATES.empty) {
    // 两种「空」：一条记录都没有（沿用 US-205 的空态）vs 被筛选筛空了（给出还原筛选的动作）。
    const filtered = num(source.total) > 0;
    if (filtered) {
      const parts = [];
      if (num(source.hiddenByPeriod)) parts.push(`周期「${str(source.period)}」`);
      if (num(source.hiddenByAbsence)) parts.push('「只看缺课」');
      return {
        ...base,
        title: ARCHIVE_FILTERED_EMPTY_TITLE,
        desc: `${name}一共归档了 ${num(source.total)} 节课，但都被 ${parts.join('、') || '当前筛选'}挡住了。`,
        hint: '筛选只影响这里显示什么，不会改动任何已归档的记录。',
        action: ARCHIVE_FILTERED_EMPTY_ACTION,
        reset: true
      };
    }
    return {
      ...base,
      title: str(empty.title),
      desc: str(empty.desc),
      hint: str(empty.hint),
      action: str(empty.action),
      create: true
    };
  }
  return base;
}
