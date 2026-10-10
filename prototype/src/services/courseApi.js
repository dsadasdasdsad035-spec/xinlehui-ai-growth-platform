import { cloud, unwrap } from '../cloud';
import {
  courseTimestamp,
  createEmptyCourse,
  findCourseById,
  findCourseByName,
  loadCourses,
  mergeCourses,
  normalizeCourse,
  persistCourses,
  removeCourse,
  selectableCourses,
  sortCourses
} from '../data/courses';

// 课程库的云端数据层：与其它表同一套「一所机构共享一份工作区」模型，course_key 做幂等键。
//
// 本地 localStorage 只是兜底：云端未开通、断网或写失败时，后台刚维护好的课程不能丢，
// 所以每一次写入都先落一份本地镜像（见 mirrorLocally），再尝试推云端。
const TABLE = 'courses';

function rowToCourse(row) {
  return normalizeCourse({
    courseId: row.course_key,
    orgId: row.org_id,
    name: row.name,
    ageRange: row.age_range,
    totalLessons: row.total_lessons,
    defaultTopic: row.default_topic,
    syllabus: row.syllabus,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    timestamps: { createdAt: row.created_at || '', updatedAt: row.updated_at || '' }
  });
}

function courseToRow(course) {
  const normalized = normalizeCourse(course);
  return {
    course_key: normalized.courseId,
    org_id: normalized.orgId,
    name: normalized.name,
    age_range: normalized.ageRange,
    total_lessons: normalized.totalLessons,
    default_topic: normalized.defaultTopic,
    // syllabus 是结构化小数组，直接进 jsonb 列。
    syllabus: normalized.syllabus,
    enabled: normalized.enabled !== false,
    sort_order: normalized.sortOrder,
    created_at: courseTimestamp(normalized, 'createdAt') || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/** 把一门课程并进本地兜底数据（同 courseId 覆盖），云端写失败时它就是唯一副本。 */
function mirrorLocally(course) {
  const next = mergeCourses([course], loadCourses());
  persistCourses(next);
  return next;
}

/** 云端返回全部课程（含停用的），可选性由 selectableCourses 决定，管理端才能看到停用课程。 */
export async function loadRemoteCourses() {
  const rows = unwrap(await cloud.database.from(TABLE).select('*'));
  return sortCourses((rows || []).map(rowToCourse));
}

export async function loadRemoteCourseById(courseId) {
  const row = unwrap(
    await cloud.database.from(TABLE).select('*').eq('course_key', String(courseId)).maybeSingle()
  );
  return row ? rowToCourse(row) : null;
}

/** 云端是真源；云端不可用（断网 / 未开通）时才回落到本地兜底镜像，不把列表清空。 */
export async function loadAllCourses() {
  try {
    const remote = await loadRemoteCourses();
    if (remote.length) return remote;
  } catch { /* 断网或云服务未开通，走本地兜底 */ }
  return loadCourses();
}

/** 老师端选课用的可选列表：停用课程不出现在这里（历史课次显示课程名走 resolveLessonCourseName）。 */
export async function loadSelectableCourses() {
  return selectableCourses(await loadAllCourses());
}

export async function saveCourse(course) {
  const normalized = normalizeCourse(course);
  // 先落本地再推云端：云端失败时调用方可以提示「已保存在本机，稍后重试」，但数据不丢。
  mirrorLocally(normalized);
  unwrap(await cloud.database.from(TABLE).upsert(courseToRow(normalized), { onConflict: 'course_key' }));
  return normalized;
}

/** 新增课程：课程名必填，同名课程拒绝创建（给出可读提示，而不是静默多出一条）。 */
export async function createCourse(input, { existingCourses } = {}) {
  const name = String(input?.name ?? input?.course ?? '').trim();
  if (!name) throw new Error('请先填写课程名，再保存课程。');

  const existing = existingCourses || await loadAllCourses();
  const duplicate = findCourseByName(existing, name);
  if (duplicate) throw new Error(`课程库里已经有「${duplicate.name}」，请改名或直接编辑那一门课程。`);

  return saveCourse(createEmptyCourse({ ...input, name }));
}

export async function updateCourse(courseId, patch, { existingCourses } = {}) {
  const key = String(courseId || '').trim();
  const list = sortCourses(existingCourses || await loadAllCourses());
  const current = list.find(item => item.courseId === key);
  if (!current) throw new Error('课程不存在或已被删除，请刷新后重试。');

  const next = normalizeCourse({ ...current, ...patch, courseId: key });
  if (!next.name) throw new Error('课程名不能为空。');
  const duplicate = findCourseByName(list, next.name);
  if (duplicate && duplicate.courseId !== key) {
    throw new Error(`课程库里已经有「${duplicate.name}」，请换一个课程名。`);
  }
  return saveCourse({ ...next, timestamps: { ...next.timestamps, updatedAt: new Date().toISOString() } });
}

/** 启停课程：停用只是从可选列表里消失，引用它的历史课次不受影响。 */
export async function setCourseEnabled(courseId, enabled, { existingCourses } = {}) {
  return updateCourse(courseId, { enabled: enabled !== false }, { existingCourses });
}

export async function deleteRemoteCourse(courseId) {
  unwrap(await cloud.database.from(TABLE).delete().eq('course_key', String(courseId)));
  return courseId;
}

/**
 * 删除课程：先清本地镜像（断网也要真的删掉），再尽力推云端。
 * 引用范围提示由调用方（后台页面）负责，这里只做删除本身。
 */
export async function deleteCourse(courseId) {
  const key = String(courseId || '').trim();
  if (!key) throw new Error('缺少要删除的课程标识。');
  persistCourses(removeCourse(loadCourses(), key));
  try {
    await deleteRemoteCourse(key);
  } catch { /* 云端不可用时本地已删除，调用方提示同步失败即可 */ }
  return key;
}

export async function getCourseById(courseId, { existingCourses } = {}) {
  const key = String(courseId || '');
  if (!key) return null;
  const list = existingCourses || await loadAllCourses();
  return findCourseById(list, key);
}
