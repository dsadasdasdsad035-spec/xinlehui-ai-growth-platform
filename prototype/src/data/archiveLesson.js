// 归档与课次实体的绑定（[第四步到第一步联通] US-414 / FR-447）。
//
// 归档记录的业务唯一键是 `lessonId::studentId`（见 `data/feedbackRecords.js` 的 `resolveRecordKey`）。
// 要让这条键**永远**是课次加学员，归档就必须落在一条真实的课次实体上 —— 本模块是
// 「这次归档属于哪一条课次」的唯一真源（零依赖纯函数 + 常量，可 `node` 直跑断言）：
//
//  ① 判据是课次的**自然键**：班级 + 课次日期 + 课时序号 —— 与 `data/lessons.js` 的
//     `lessonKeyOf` 同一个拼法（键的格式只有那一处），也是 lessons 表的唯一键。
//     不在这里另拼一份，也不从「学员 + 作品名」反推（那是历史数据才有的退化口径）。
//  ② 同自然键的课次已经在列表里（老师点过「保存课次」，或刷新后从云端回来的）→ 直接用它。
//  ③ 列表里还没有、但自然键完整（班级 + 日期 + 序号都能定下来）→ `create`：
//     归档那一刻把这次的表单落成课次实体（`services/lessonApi.js` 的 `ensureArchiveLesson`）。
//     这一步是「同一天两节课不再被判成同一次更新」的实现点 —— 两节课的自然键不同
//     （课时序号不同），落成两条课次、得到两个 lessonId，于是两条记录两个键。
//  ④ 自然键不完整（历史归档记录只有班级名 + 日期 + 作品名）→ `none`：
//     退化键路径原样保留，旧记录照旧可读（`feedbackRecords.js` 的兼容映射）。
//
// 表单改过日期 / 序号但没重新保存「保存课次」时，本模块认**表单**（自然键）：
// 记录上的日期、课题、班级本来就全部来自表单，课次实体跟着表单走才不会出现
// 「recordKey 指向第 11 次课、记录自己写着第 12 次课」这种两个来源打架的情况。
// 课次实体已经存在且自然键一致的那条会被认出来，不会重复建。
import { lessonKeyOf, normalizeLessonDate, normalizeLessonNo } from './lessons';

const str = value => String(value === null || value === undefined ? '' : value).trim();

/** 归档要绑定的课次从哪儿来（面板读数与断言读同一份）。 */
export const ARCHIVE_LESSON_SOURCES = {
  selected: 'selected',
  natural: 'natural',
  create: 'create',
  none: 'none'
};

export const ARCHIVE_LESSON_SOURCE_LABELS = {
  selected: '本次课次（第一步已保存）',
  natural: '同一次课（按班级 + 日期 + 课时序号命中）',
  create: '归档时新建的课次',
  none: '没有课次（历史记录口径）'
};

/**
 * 课次的自然键（班级 + 课次日期 + 课时序号），拼法取自 `lessonKeyOf`。
 * 三样缺一就返回空串 —— **不许**用 normalizeLesson 的默认值补齐：它会把缺失的日期填成今天、
 * 序号填成 1，于是「看起来有键」而实际是编出来的（同一天两节课在这里被合并就全白做了）。
 * 课次对象（camelCase）与表单值共用同一个函数：字段名本来就一样。
 */
export function archiveLessonKey(source = {}) {
  const classId = str(source.classId);
  const lessonDate = normalizeLessonDate(source.lessonDate || source.date);
  const lessonNo = normalizeLessonNo(source.lessonNo);
  if (!classId || !lessonDate || !lessonNo) return '';
  return lessonKeyOf({ classId, lessonDate, lessonNo });
}

/**
 * 「这次归档要绑哪一条课次」的判定（纯函数）。
 *
 * 入参：`lessonId` = 本次会话已经保存过的课次（`currentLessonId`，可为空）；
 *      `classId / lessonDate / lessonNo` = 第一步表单上的课次信息；
 *      `lessons` = 当前可见的课次列表（会话列表 ∪ 本地镜像）。
 * 返回值：`{ source, lesson, lessonId, naturalKey }` ——
 *   `lesson` 非空时就是那一条课次实体（调用方读它的 `lessonId`）；
 *   `source = create` 时 `lesson` 为空：调用方需要把表单落成课次后再归档。
 */
export function resolveArchiveLesson({ lessonId = '', classId = '', lessonDate = '', lessonNo = 0, lessons = [] } = {}) {
  const list = (Array.isArray(lessons) ? lessons : []).filter(Boolean);
  const picked = str(lessonId);
  const naturalKey = archiveLessonKey({ classId, lessonDate, lessonNo });
  const match = naturalKey ? list.find(item => archiveLessonKey(item) === naturalKey) || null : null;
  if (match) {
    // 命中的就是这次会话保存的那一条：说「本次课次」，其余（刷新后从云端回来 / 别处建的同一次课）说「同一次课」。
    return {
      source: match.lessonId === picked ? ARCHIVE_LESSON_SOURCES.selected : ARCHIVE_LESSON_SOURCES.natural,
      lesson: match,
      lessonId: str(match.lessonId),
      naturalKey
    };
  }
  if (naturalKey) return { source: ARCHIVE_LESSON_SOURCES.create, lesson: null, lessonId: '', naturalKey };
  // 自然键不完整：只认本次会话已经保存过的那条课次（它带的 id 就是记录要用的 lessonId）；
  // 连它都没有 → none，退化键路径（历史记录的可读路径）。
  return picked
    ? { source: ARCHIVE_LESSON_SOURCES.selected, lesson: null, lessonId: picked, naturalKey: '' }
    : { source: ARCHIVE_LESSON_SOURCES.none, lesson: null, lessonId: '', naturalKey: '' };
}

/** 一行给老师看的说明（归档按钮的 title 用，面板与断言读同一句）。 */
export function archiveLessonNote(plan = {}) {
  const source = plan.source || ARCHIVE_LESSON_SOURCES.none;
  const label = ARCHIVE_LESSON_SOURCE_LABELS[source] || ARCHIVE_LESSON_SOURCE_LABELS.none;
  if (source === ARCHIVE_LESSON_SOURCES.create) return `${label}：归档会先把它落成课次，档案键 = 课次 + 学员。`;
  if (source === ARCHIVE_LESSON_SOURCES.none) return `${label}：档案键退化为「班级 + 日期 + 学员 + 作品名」。`;
  return `${label}：档案键 = 课次 + 学员（${label}）。`;
}
