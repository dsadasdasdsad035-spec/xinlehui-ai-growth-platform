// 课次（lesson）—— 本地兜底数据，与云端 lessons 表保持同样的字段形状。
//
// 课次是「某班某天某一次课」的唯一上下文实体：产出 lessonId 之后，装裱展签的日期、
// 点评的课题、归档的唯一键、成长档案与海报的排序，全部从这里取，不再各自猜一个。
// 与其它模块同一套模型：本地只是「断网/未开通云服务时的兜底」，云端表才是真源。
//
// 关于字段命名：应用内一律 camelCase，云端行是 snake_case，映射在 services/lessonApi.js。
const STORAGE_KEY = 'xinlehui-lessons-v1';

/** 一所机构共享一份工作区数据，这两个 id 是原型阶段所有课次共用的默认归属。 */
export const DEFAULT_ORG_ID = 'org-xinlehui';
export const DEFAULT_CAMPUS_ID = 'campus-xinghe';

/** status 只允许这五个值，顺序即状态机的推进顺序（不可跳变）。 */
export const LESSON_STATUSES = ['draft', 'collecting', 'processing', 'reviewing', 'archived'];

export const LESSON_STATUS_LABELS = {
  draft: '草稿',
  collecting: '收集素材',
  processing: '装裱处理',
  reviewing: '点评中',
  archived: '已归档'
};

/** 状态机：每个状态只允许推到它的下一个状态，archived 是终态。 */
export const LESSON_STATUS_FLOW = {
  draft: 'collecting',
  collecting: 'processing',
  processing: 'reviewing',
  reviewing: 'archived',
  archived: ''
};

/** 出席状态。默认 present —— 老师勾了谁就是谁到场，缺课要显式标记。 */
export const ATTENDANCE_STATES = ['present', 'absent', 'makeup'];

export const ATTENDANCE_LABELS = {
  present: '出席',
  absent: '缺课',
  makeup: '补课'
};

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

const pad2 = value => String(value).padStart(2, '0');

/** 学员在原型阶段还没有独立 id，用姓名派生一个稳定 id，保证同一位学员跨课次一致。 */
export function makeStudentId(name) {
  return `student-${String(name || '').trim() || 'unknown'}`;
}

let lessonIdSeq = 0;

/**
 * 新課次的 lessonId 必须是**唯一**的，不能由「班级+日期+序号」派生。
 *
 * 反例：如果 lessonId = f(classId, lessonDate, lessonNo)，那么「重复创建检测」就退化成
 * 「两条记录的 id 相同」，唯一性校验永远发现不了冲突，upsert 还会把前一条悄悄覆盖掉。
 * 唯一性由 `classId + lessonDate + lessonNo` 这个自然键负责（见 findLessonConflict）。
 */
export function makeUniqueLessonId() {
  lessonIdSeq += 1;
  return `lesson-${Date.now().toString(36)}-${lessonIdSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 由「班级 + 课次日期 + 课时序号」确定性派生一个 id，**只用于读取没有 id 的旧数据**。
 * 确定性很关键：同一条旧记录每次读进来都要得到同一个 id，否则合并/去重会重复计数。
 */
export function makeLessonId({ classId, lessonDate, lessonNo, fallback } = {}) {
  const cls = String(classId || '').trim();
  const date = normalizeLessonDate(lessonDate);
  const no = Number.isFinite(Number(lessonNo)) && lessonNo !== null && lessonNo !== '' ? normalizeLessonNo(lessonNo) : null;
  if (!cls || !date || no === null) return `lesson-${String(fallback || 'legacy').trim() || 'legacy'}`;
  return `lesson-${cls}-${date.replace(/-/g, '')}-${no}`;
}

/** 课次日期统一为 YYYY-MM-DD；'2026.08.04' / '2026/08/04' / ISO 字符串 / Date 都收。 */
export function normalizeLessonDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  const matched = text.match(/^(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})/);
  if (matched) return `${matched[1]}-${pad2(matched[2])}-${pad2(matched[3])}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}

/**
 * 展签 / 海报上的日期格式：`2026.08.11`。
 * 日期来源永远是课次日期（lesson.lessonDate），不是「今天」也不是归档日 —— 展签写的是
 * 创作那一天，补录上节课时不能变成今天。
 */
export function formatLessonDateDots(value) {
  return normalizeLessonDate(value).replace(/-/g, '.');
}

/**
 * 课时序号：正整数。
 * 返回 0 表示「未知」—— 历史归档记录本来就没有课时序号，用 0 而不是猜一个 1，
 * 免得凭空造出一个会和真实课次撞唯一键的序号。
 */
export function normalizeLessonNo(value) {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function normalizeLessonStatus(value) {
  const text = String(value ?? '').trim();
  return LESSON_STATUSES.includes(text) ? text : 'draft';
}

export function normalizeAttendance(value) {
  const text = String(value ?? '').trim();
  return ATTENDANCE_STATES.includes(text) ? text : 'present';
}

export function nextLessonStatus(status) {
  return LESSON_STATUS_FLOW[normalizeLessonStatus(status)] || '';
}

/** 只允许沿状态机前进一格；跳级、回退都不允许。 */
export function canTransitionLesson(from, to) {
  const current = normalizeLessonStatus(from);
  const target = String(to ?? '').trim();
  if (!LESSON_STATUSES.includes(target)) return false;
  return nextLessonStatus(current) === target;
}

export function assertLessonTransition(from, to) {
  if (!canTransitionLesson(from, to)) {
    const currentLabel = LESSON_STATUS_LABELS[normalizeLessonStatus(from)] || from;
    const targetLabel = LESSON_STATUS_LABELS[to] || to;
    throw new Error(`课次状态不能从「${currentLabel}」直接变成「${targetLabel}」，请按流程逐步推进。`);
  }
}

/** 参与学员：作品与照片都只存 id 引用，素材本体不进数据模型。 */
export function createParticipant(input = {}) {
  // 旧数据里 participants 可能就是一个姓名数组，容忍它，别把学员丢掉。
  const source = typeof input === 'string' ? { name: input } : (input || {});
  const name = String(source.name ?? '').trim();
  return {
    studentId: String(source.studentId || '').trim() || makeStudentId(name),
    name,
    attendance: normalizeAttendance(source.attendance),
    artworkIds: normalizeIdList(source.artworkIds),
    photoIds: normalizeIdList(source.photoIds),
    // 临时加入的插班/试听学员：只写进本次课次，不回写班级名单（US-405）。
    temporary: source.temporary === true
  };
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item ?? '').trim()).filter(Boolean);
}

function normalizeParticipants(value) {
  if (!Array.isArray(value)) return [];
  // 过滤掉空条目：没有姓名的参与者在下游（展签、点评、海报）没有意义，留着只会串档。
  return value.map(createParticipant).filter(item => item.name);
}

/**
 * 兼容读取课次的更新时间戳。
 * 规范形状是 timestamps: { createdAt, updatedAt }；旧数据可能是平铺的 createdAt / updatedAt，
 * 两种都认，免得排序和展示在旧记录上拿到 undefined。
 */
export function lessonTimestamp(lesson, key = 'updatedAt') {
  const stamp = lesson?.timestamps?.[key];
  if (stamp) return String(stamp);
  return String(lesson?.[key] || '');
}

/** 课次唯一键：班内同一天同一课时序号只允许存在一条。 */
export function lessonKeyOf(lesson) {
  const normalized = normalizeLesson(lesson);
  return `${normalized.classId}::${normalized.lessonDate}::${normalized.lessonNo}`;
}

/** 新建空白课次：lessonNo 默认 1（US-404 会按该班该课程已归档次数推荐真实值）。 */
export function createEmptyLesson(input = {}) {
  const now = new Date().toISOString();
  const lessonDate = normalizeLessonDate(input.lessonDate) || normalizeLessonDate(new Date());
  const classId = String(input.classId || '').trim();
  const lessonNo = input.lessonNo === undefined || input.lessonNo === null || input.lessonNo === ''
    ? 1
    : normalizeLessonNo(input.lessonNo);
  return {
    lessonId: String(input.lessonId || '').trim() || makeUniqueLessonId(),
    orgId: String(input.orgId || DEFAULT_ORG_ID),
    campusId: String(input.campusId || DEFAULT_CAMPUS_ID),
    classId,
    courseId: String(input.courseId || ''),
    lessonNo,
    lessonDate,
    topic: String(input.topic || ''),
    objectives: String(input.objectives || ''),
    teacherId: String(input.teacherId || ''),
    participants: normalizeParticipants(input.participants),
    status: normalizeLessonStatus(input.status),
    timestamps: {
      // 用 ?? 而不是 ||：显式传空串表示「历史数据本来就没有时间戳」，不要偷偷填 now。
      createdAt: String(input?.timestamps?.createdAt ?? input.createdAt ?? now),
      updatedAt: String(input?.timestamps?.updatedAt ?? input.updatedAt ?? now)
    }
  };
}

/**
 * 把任意来源的课次数据收敛成规范形状。
 * 关键点是「不报错、不丢数据」：缺 lessonId 就按班级+日期+序号推导，
 * 缺字段就补默认值，无法识别的旧字段原样挂在 legacy 上。
 */
export function normalizeLesson(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const lessonDate = normalizeLessonDate(source.lessonDate || source.date);
  const classId = String(source.classId || '').trim();
  // 课时序号缺失（旧数据）算 1 次课吗？不 —— 见 normalizeLessonNo：未知就是 0。
  const lessonNo = source.lessonNo === undefined || source.lessonNo === null || source.lessonNo === ''
    ? 0
    : normalizeLessonNo(source.lessonNo);
  const base = createEmptyLesson({
    ...source,
    classId,
    lessonDate: lessonDate || undefined,
    lessonNo
  });
  return {
    ...base,
    // 日期读不出来时保持为空，不要偷偷填今天：历史记录上的日期错一天，下游展签就跟着错。
    lessonDate,
    // 旧记录没有 lessonId 时按确定性规则推导，保证同一个班同一天同一次课永远得到同一个 id。
    lessonId: String(source.lessonId || source.id || '').trim()
      || makeLessonId({ classId, lessonDate, lessonNo: base.lessonNo, fallback: source.legacyKey || source.id || 'legacy' }),
    // 无法映射进课次模型的原始记录原样留着，宁可多带一个字段也不要丢数据。
    ...(source.legacy ? { legacy: source.legacy } : {})
  };
}

/**
 * 把「没有课次实体的历史归档记录」映射成课次。
 *
 * 历史记录里只有学员姓名、班级名、作品名和一个日期，没有班级 id、课时序号与状态。
 * 这里不猜这些值：课时序号留 0（未知），状态直接给 archived，原始记录挂在 legacy 上，
 * 于是「读得到、显示得出、不报错、不丢数据」，又不会和真实课次撞唯一键。
 */
export function lessonFromLegacyRecord(record = {}) {
  const legacyId = String(record.id || '').trim() || `legacy-${Date.now()}`;
  const lessonDate = normalizeLessonDate(record.date || record.lessonDate) || '';
  const className = String(record.className || record.class || '').trim();
  const studentName = String(record.student || '').trim();
  return normalizeLesson({
    lessonId: `lesson-legacy-${legacyId}`,
    orgId: record.orgId,
    campusId: record.campusId,
    classId: String(record.classId || (className ? `legacy-class-${className}` : 'legacy-class-unknown')),
    courseId: record.courseId,
    // 历史记录没有课时序号，留 0 表示未知，而不是编一个。
    lessonNo: 0,
    lessonDate,
    topic: String(record.title || record.topic || '').trim(),
    objectives: String(record.objectives || '').trim(),
    teacherId: record.teacherId,
    participants: studentName
      ? [{ name: studentName, attendance: record.status === '缺课' ? 'absent' : 'present' }]
      : [],
    status: 'archived',
    timestamps: { createdAt: record.createdAt || '', updatedAt: record.updatedAt || '' },
    legacyKey: legacyId,
    legacy: record
  });
}

export function lessonsFromLegacyRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.map(lessonFromLegacyRecord);
}

/** 返回与 lesson 撞唯一键的另一条课次（不含它自己），没有冲突返回 null。 */
export function findLessonConflict(lesson, list) {
  const target = normalizeLesson(lesson);
  const key = `${target.classId}::${target.lessonDate}::${target.lessonNo}`;
  const others = Array.isArray(list) ? list : [];
  return others.find(item => {
    if (!item) return false;
    const other = normalizeLesson(item);
    return other.lessonId !== target.lessonId
      && `${other.classId}::${other.lessonDate}::${other.lessonNo}` === key;
  }) || null;
}

export function findDuplicateLessons(list) {
  const seen = new Map();
  const duplicates = [];
  (Array.isArray(list) ? list : []).forEach(item => {
    const key = lessonKeyOf(item);
    if (seen.has(key)) duplicates.push([seen.get(key), item]);
    else seen.set(key, item);
  });
  return duplicates;
}

const byLessonOrder = (a, b) => (
  String(b.lessonDate || '').localeCompare(String(a.lessonDate || ''))
) || (b.lessonNo || 0) - (a.lessonNo || 0);

/**
 * 合并两份课次列表：winner 优先（同 lessonId 覆盖 loser）。
 * 云端回来的是真源，本地只是兜底镜像，所以调用方传 winner = 远端。
 */
export function mergeLessons(winner, loser) {
  const byId = new Map();
  [...(Array.isArray(loser) ? loser : []), ...(Array.isArray(winner) ? winner : [])].forEach(item => {
    if (!item) return;
    const lesson = normalizeLesson(item);
    byId.set(lesson.lessonId, lesson);
  });
  return [...byId.values()].sort(byLessonOrder);
}

export function sortLessons(list) {
  return (Array.isArray(list) ? list : []).map(normalizeLesson).sort(byLessonOrder);
}

/** 按 classId + 日期范围过滤（闭区间），云端不可用时与本地兜底走同一套判断。 */
export function filterLessons(list, { classId, from, to } = {}) {
  const cls = String(classId || '').trim();
  const start = normalizeLessonDate(from);
  const end = normalizeLessonDate(to);
  return sortLessons(list).filter(item => {
    if (cls && item.classId !== cls) return false;
    if (start && item.lessonDate < start) return false;
    if (end && item.lessonDate > end) return false;
    return true;
  });
}

// 演示用种子课次：与 data/studentManagement.js 的班级、data/feedbackRecords.js 的历史归档对得上，
// 这样「课次 → 归档记录」的对应关系在原型里看得见。
export const seedLessons = [
  {
    lessonId: 'lesson-class-sat-2-20260804-12',
    orgId: DEFAULT_ORG_ID,
    campusId: DEFAULT_CAMPUS_ID,
    classId: 'class-sat-2',
    courseId: 'course-creative-painting',
    lessonNo: 12,
    lessonDate: '2026-08-04',
    topic: '向着光的花',
    objectives: '观察光的方向，用冷暖对比表现花朵的主次关系。',
    teacherId: 'teacher-linxiao',
    participants: [
      { name: '陈一诺', attendance: 'present', artworkIds: ['artwork-seed-20260804'], photoIds: [] },
      { name: '林小满', attendance: 'present' },
      { name: '赵禾', attendance: 'absent' }
    ],
    status: 'archived',
    timestamps: { createdAt: '2026-08-04T02:10:00.000Z', updatedAt: '2026-08-04T03:02:00.000Z' }
  },
  {
    lessonId: 'lesson-class-sat-2-20260811-13',
    orgId: DEFAULT_ORG_ID,
    campusId: DEFAULT_CAMPUS_ID,
    classId: 'class-sat-2',
    courseId: 'course-creative-painting',
    lessonNo: 13,
    lessonDate: '2026-08-11',
    topic: '向日葵主题课',
    objectives: '用厚涂和线条表达个人感受，注意画面主次。',
    teacherId: 'teacher-linxiao',
    participants: [
      { name: '陈一诺', attendance: 'present' },
      { name: '林小满', attendance: 'present' },
      { name: '赵禾', attendance: 'makeup' }
    ],
    status: 'collecting',
    timestamps: { createdAt: '2026-08-11T02:05:00.000Z', updatedAt: '2026-08-11T02:40:00.000Z' }
  },
  {
    lessonId: 'lesson-class-sat-2-20260721-11',
    orgId: DEFAULT_ORG_ID,
    campusId: DEFAULT_CAMPUS_ID,
    classId: 'class-sat-2',
    courseId: 'course-creative-painting',
    lessonNo: 11,
    lessonDate: '2026-07-21',
    topic: '彩色的家',
    objectives: '安排房子与天空的色彩关系，尝试主动选择颜色。',
    teacherId: 'teacher-linxiao',
    participants: [
      { name: '陈一诺', attendance: 'present', artworkIds: ['artwork-seed-20260721'], photoIds: [] },
      { name: '林小满', attendance: 'present' }
    ],
    status: 'archived',
    timestamps: { createdAt: '2026-07-21T02:10:00.000Z', updatedAt: '2026-07-21T02:58:00.000Z' }
  }
].map(normalizeLesson);

export function loadLessons() {
  if (typeof window === 'undefined') return sortLessons(seedLessons);
  const saved = safeParse(window.localStorage.getItem(STORAGE_KEY), null);
  if (!Array.isArray(saved) || !saved.length) return sortLessons(seedLessons);
  return sortLessons(saved);
}

export function persistLessons(list) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sortLessons(list))); } catch { /* 配额满时静默降级，云端仍是真源 */ }
}
