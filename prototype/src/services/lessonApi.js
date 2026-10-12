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
// 归档要绑定的课次从哪儿来（[第四步到第一步联通] US-414）：纯规则在 data 层，
// 这里只负责「读出来 / 建出来」，两边读的是同一份 `resolveArchiveLesson`。
import { ARCHIVE_LESSON_SOURCES, archiveLessonKey, resolveArchiveLesson } from '../data/archiveLesson';

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

/**
 * 归档前的课次保底（[第四步到第一步联通] US-414 / FR-447）。
 *
 * 归档记录的业务唯一键是 `lessonId::studentId`，所以归档必须落在课次实体上。老师点过
 * 「保存课次」时实体已经在列表里；没点过（一直没离开第一步表单就往下走）时，这里在归档
 * 那一刻把表单落成课次 —— 判据与落库方式全部复用既有实现，不另起一套：
 *  ①「这次归档属于哪一条课次」= `data/archiveLesson.js` 的 `resolveArchiveLesson`（纯函数）；
 *  ② 新建走 `createLesson`（同一套班内唯一性校验与「先落本地镜像再推云端」）。
 * 找不到同键课次、云端又写不进去时返回 `lesson: null`：调用方退回退化键（历史记录的可读路径），
 * 不冒名顶替别的课次，也不抛错（归档不能因为课次没建起来就整个失败）。
 */
export async function ensureArchiveLesson(input = {}, { existingLessons } = {}) {
  const classId = String(input.classId || '').trim();
  const lessonDate = normalizeLessonDate(input.lessonDate);
  const lessonNo = Number(input.lessonNo);
  // 判定用「会话列表 ∪ 本地镜像」：刚在本机保存过（云端还没回来 / 写失败）的课次也要认出来，
  // 否则会给同一次课再建一条实体，两条 lessonId 各自归档 → 同一次课两份档案。
  const known = mergeLessons(
    (Array.isArray(existingLessons) ? existingLessons : []).map(normalizeLesson),
    loadLessons()
  );
  const plan = resolveArchiveLesson({ lessonId: input.lessonId, classId, lessonDate, lessonNo, lessons: known });
  if (plan.lesson) return { lesson: plan.lesson, source: plan.source, created: false, remote: false };
  if (plan.source !== ARCHIVE_LESSON_SOURCES.create) return { lesson: null, source: plan.source, created: false, remote: false };
  // 建之前先问一次云端：同一次课可能已经在**别处**（另一台设备 / 另一个会话）建过实体了 ——
  // 认它，不给同一次课留两条实体（时间线会出现同一节课两遍）。云端不可用时 `queryLessons`
  // 自己回落到本机镜像，不抛错。
  const remote = findArchiveLesson(await queryLessons({ classId, from: lessonDate, to: lessonDate }), plan.naturalKey);
  if (remote) return { lesson: remote, source: ARCHIVE_LESSON_SOURCES.natural, created: false, remote: true };
  // 新建时**不带 lessonId**：会话里那条（input.lessonId）属于另一次课次，
  // 让它落到新实体上就成了两条课次共用一个 id。
  const patch = {
    classId,
    lessonDate,
    lessonNo,
    courseId: String(input.courseId || ''),
    topic: String(input.topic || ''),
    orgId: input.orgId,
    campusId: input.campusId,
    teacherId: String(input.teacherId || ''),
    participants: input.participants
  };
  try {
    const saved = await createLesson(patch, { existingLessons: known });
    return { lesson: saved, source: plan.source, created: true, remote: true };
  } catch {
    // 云端不通（本地镜像里已经有这条课次）或撞自然键：按自然键从镜像读回来 —— 与「保存课次」同一条兜底。
    // `created` 仍算真：走到这里说明这条课次是**这一次**写下来的（镜像或云端），老师该看到那句回执。
    const mirrored = findArchiveLesson(loadLessons(), plan.naturalKey);
    return mirrored
      ? { lesson: mirrored, source: plan.source, created: true, remote: false }
      : { lesson: null, source: ARCHIVE_LESSON_SOURCES.none, created: false, remote: false };
  }
}

function findArchiveLesson(list, naturalKey) {
  if (!naturalKey) return null;
  return (Array.isArray(list) ? list : []).map(normalizeLesson).find(item => archiveLessonKey(item) === naturalKey) || null;
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
