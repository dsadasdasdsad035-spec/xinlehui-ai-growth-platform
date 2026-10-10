import { cloud, unwrap } from '../cloud';
import {
  assertLessonTransition,
  findLessonConflict,
  createEmptyLesson,
  filterLessons,
  lessonTimestamp,
  loadLessons,
  mergeLessons,
  normalizeLesson,
  normalizeLessonDate,
  persistLessons,
  sortLessons
} from '../data/lessons';

// 课次的云端数据层：与其它表同一套「一所机构共享一份工作区」模型，lesson_key 做幂等键。
//
// 本地 localStorage 只是兜底：云端未开通、断网或写失败时，老师刚录入的课次不能丢，
// 所以每一次写入都先落一份本地镜像（见 mirrorLocally），再尝试推云端。
const TABLE = 'lessons';

// 课次上的素材（作品/照片）只存 id 引用，不存地址：素材本体不进数据模型，也不进本地缓存。
function rowToLesson(row) {
  return normalizeLesson({
    lessonId: row.lesson_key,
    orgId: row.org_id,
    campusId: row.campus_id,
    classId: row.class_id,
    courseId: row.course_id,
    lessonNo: row.lesson_no,
    lessonDate: row.lesson_date,
    topic: row.topic,
    objectives: row.objectives,
    teacherId: row.teacher_id,
    participants: row.participants,
    status: row.status,
    timestamps: { createdAt: row.created_at || '', updatedAt: row.updated_at || '' }
  });
}

function lessonToRow(lesson) {
  const normalized = normalizeLesson(lesson);
  return {
    lesson_key: normalized.lessonId,
    org_id: normalized.orgId,
    campus_id: normalized.campusId,
    class_id: normalized.classId,
    course_id: normalized.courseId,
    lesson_no: normalized.lessonNo,
    lesson_date: normalized.lessonDate,
    topic: normalized.topic,
    objectives: normalized.objectives,
    teacher_id: normalized.teacherId,
    participants: normalized.participants,
    status: normalized.status,
    created_at: lessonTimestamp(normalized, 'createdAt') || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/** 把一条课次并进本地兜底数据（同 lessonId 覆盖），云端写失败时它就是唯一副本。 */
function mirrorLocally(lesson) {
  const next = mergeLessons([lesson], loadLessons());
  persistLessons(next);
  return next;
}

export async function loadRemoteLessons() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return sortLessons((rows || []).map(rowToLesson));
}

export async function loadRemoteLessonById(lessonId) {
  const row = unwrap(
    await cloud.database.from(TABLE).select('*').eq('lesson_key', String(lessonId)).maybeSingle()
  );
  return row ? rowToLesson(row) : null;
}

/** 按 classId + 日期范围（闭区间）查询；from / to 可只给一个，都不给就是全量。 */
export async function queryRemoteLessons({ classId, from, to } = {}) {
  let query = cloud.database.from(TABLE).select('*');
  if (classId) query = query.eq('class_id', String(classId));
  if (from) query = query.gte('lesson_date', String(from));
  if (to) query = query.lte('lesson_date', String(to));
  const rows = unwrap(await query.order('lesson_date', { ascending: false }));
  return filterLessons((rows || []).map(rowToLesson), { classId, from, to });
}

/** 云端是真源；云端不可用（断网 / 未开通）时才回落到本地兜底镜像。 */
export async function loadAllLessons() {
  try {
    const remote = await loadRemoteLessons();
    if (remote.length) return remote;
  } catch { /* 断网或云服务未开通，走本地兜底 */ }
  return loadLessons();
}

export async function saveLesson(lesson) {
  const normalized = normalizeLesson(lesson);
  // 先落本地再推云端：云端失败时调用方可以提示「已保存在本机，稍后重试」，但数据不丢。
  mirrorLocally(normalized);
  unwrap(await cloud.database.from(TABLE).upsert(lessonToRow(normalized), { onConflict: 'lesson_key' }));
  return normalized;
}

export async function deleteRemoteLesson(lessonId) {
  unwrap(await cloud.database.from(TABLE).delete().eq('lesson_key', String(lessonId)));
  return lessonId;
}

export async function getLessonById(lessonId) {
  const key = String(lessonId || '');
  try {
    const remote = await loadRemoteLessonById(key);
    if (remote) return remote;
  } catch { /* 云端不可用时回落到本地兜底 */ }
  return loadLessons().find(item => item.lessonId === key) || null;
}

export async function queryLessons({ classId, from, to } = {}) {
  try {
    const remote = await queryRemoteLessons({ classId, from, to });
    if (remote.length) return remote;
  } catch { /* 同上 */ }
  return filterLessons(loadLessons(), { classId, from, to });
}

/** 班内唯一性：classId + lessonDate + lessonNo，重复创建必须被拒绝并给出可读提示。 */
export async function createLesson(input, { existingLessons } = {}) {
  // 校验用调用方给的值，不用 createEmptyLesson 的默认值：
  // 默认值（日期今天、序号 1）是表单里的体验，领域层不能靠它把漏填蒙混过去。
  const classId = String(input?.classId || '').trim();
  const lessonDate = normalizeLessonDate(input?.lessonDate);
  const lessonNo = Number(input?.lessonNo);
  if (!classId) throw new Error('请先选择班级，再创建课次。');
  if (!lessonDate) throw new Error('请先确认课次日期，再创建课次。');
  if (!Number.isFinite(lessonNo) || lessonNo <= 0) throw new Error('请先填写正整数课时序号，再创建课次。');

  const lesson = createEmptyLesson({ ...input, classId, lessonDate, lessonNo });
  const existing = existingLessons || await loadAllLessons();
  const conflict = findLessonConflict(lesson, existing);
  if (conflict) {
    throw new Error(`该班 ${lesson.lessonDate} 已有第 ${conflict.lessonNo} 次课，请修改课时序号后再保存。`);
  }
  return saveLesson(lesson);
}

export async function updateLesson(lessonId, patch, { existingLessons } = {}) {
  const key = String(lessonId || '');
  const list = (existingLessons || await loadAllLessons()).map(normalizeLesson);
  const current = list.find(item => item.lessonId === key);
  if (!current) throw new Error('课次不存在或已被删除，请刷新后重试。');

  const next = normalizeLesson({ ...current, ...patch, lessonId: key });
  const conflict = list.find(item => item.lessonId !== key
    && item.classId === next.classId
    && item.lessonDate === next.lessonDate
    && item.lessonNo === next.lessonNo);
  if (conflict) {
    throw new Error(`该班 ${next.lessonDate} 已有第 ${conflict.lessonNo} 次课，请修改课时序号后再保存。`);
  }
  return saveLesson({ ...next, timestamps: { ...next.timestamps, updatedAt: new Date().toISOString() } });
}

/** 状态推进：只允许沿 draft → collecting → processing → reviewing → archived 逐步前进。 */
export async function transitionLessonStatus(lessonId, status, { existingLessons } = {}) {
  const key = String(lessonId || '');
  const list = (existingLessons || await loadAllLessons()).map(normalizeLesson);
  const current = list.find(item => item.lessonId === key);
  if (!current) throw new Error('课次不存在或已被删除，请刷新后重试。');
  if (current.status === status) return current;
  assertLessonTransition(current.status, status);
  return saveLesson({ ...current, status, timestamps: { ...current.timestamps, updatedAt: new Date().toISOString() } });
}
