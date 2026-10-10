// 课程库（course）—— 本地兜底数据 + 领域规则，与云端 courses 表保持同样的字段形状。
//
// 课程库是「课题从哪来」的唯一来源：课次上的 courseId 指向一门课程，课题（topic）默认由
// 课程的 syllabus（分课时课题表）按课时序号取，取不到才回落 defaultTopic。
// 与其它模块同一套模型：本地只是「断网/未开通云服务时的兜底」，云端表才是真源。
//
// 关于字段命名：应用内一律 camelCase，云端行是 snake_case，映射在 services/courseApi.js。
import { DEFAULT_ORG_ID } from './lessons';

const STORAGE_KEY = 'xinlehui-courses-v1';

/** 年龄段是自由文本，这里只给后台表单一份常用备选，normalize 时不做白名单限制。 */
export const COURSE_AGE_RANGE_OPTIONS = ['3-4岁', '4-5岁', '5-6岁', '6-7岁', '7-9岁', '9-12岁'];

/** 课时总数未知时用 0，不要凭空编一个数字出来（见 normalizeTotalLessons）。 */
export const DEFAULT_COURSE_SORT_ORDER = 90;

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

let courseIdSeq = 0;

/**
 * 新课程的 courseId 必须是**唯一**的，不能由课程名派生。
 *
 * 反例：如果 courseId = f(name)，那么「同名课程」会拿到同一个 id，upsert 会把前一门课
 * 静默覆盖掉，重复创建也永远查不出来。名字的重复性由 findCourseByName 单独判断。
 */
export function makeUniqueCourseId() {
  courseIdSeq += 1;
  return `course-${Date.now().toString(36)}-${courseIdSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 由课程名确定性派生 id，**只用于读取没有 id 的旧数据**（例如班级上那个 course 名字字段）。
 * 确定性很关键：同一条旧数据每次读进来都要得到同一个 id，否则合并/去重会重复计数。
 */
export function makeCourseIdFromName(name) {
  const text = String(name ?? '').trim();
  return `course-legacy-${text || 'unknown'}`;
}

export function normalizeCourseAgeRange(value) {
  return String(value ?? '').trim();
}

/** 课时总数：正整数；缺省或非法一律 0（未知），不伪造一个 16。 */
export function normalizeTotalLessons(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function normalizeSortOrder(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : DEFAULT_COURSE_SORT_ORDER;
}

/** 课次序号：正整数，0 表示未知。 */
function normalizeSyllabusLessonNo(value) {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function syllabusEntryFromString(topic, index) {
  return { lessonNo: index + 1, topic: String(topic ?? '').trim(), objectives: '' };
}

/**
 * 把任意形态的 syllabus 收敛成 `[{ lessonNo, topic, objectives }]`，按 lessonNo 升序。
 *
 * 接受的写法（旧数据/后台表单可能混用）：
 * - `[{ lessonNo: 3, topic: '线的散步' }]`（也认 no / index / lesson 与 title / name）
 * - `['认识颜色', '冷暖色']`（数组下标 + 1 就是课时序号）
 * - `{ '3': '线的散步', '4': { topic: '大大的脸' } }`（课时序号做键的对象）
 *
 * 条目没写课时序号时用它在数组里的位置 + 1（纯字符串数组就是这种情况）；
 * 序号或课题为空的条目直接丢弃；同一课时序号重复时**后者覆盖前者**。
 */
export function normalizeSyllabus(value) {
  const entries = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (item === null || item === undefined) return;
      if (typeof item === 'string' || typeof item === 'number') {
        const entry = syllabusEntryFromString(item, index);
        if (entry.topic) entries.push(entry);
        return;
      }
      if (typeof item !== 'object') return;
      const lessonNo = normalizeSyllabusLessonNo(item.lessonNo ?? item.no ?? item.index ?? index + 1);
      const topic = String(item.topic ?? item.title ?? item.name ?? '').trim();
      if (!lessonNo || !topic) return;
      entries.push({ lessonNo, topic, objectives: String(item.objectives ?? item.goal ?? '').trim() });
    });
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach(key => {
      const lessonNo = normalizeSyllabusLessonNo(key);
      const raw = value[key];
      const topic = String((raw && typeof raw === 'object' ? raw.topic ?? raw.title : raw) ?? '').trim();
      if (!lessonNo || !topic) return;
      entries.push({
        lessonNo,
        topic,
        objectives: String((raw && typeof raw === 'object' ? raw.objectives ?? raw.goal : '') ?? '').trim()
      });
    });
  }
  // 同序号后者覆盖前者：先按出现顺序展开成 Map，再按序号排序。
  const byNo = new Map();
  entries.forEach(entry => byNo.set(entry.lessonNo, entry));
  return [...byNo.values()].sort((a, b) => a.lessonNo - b.lessonNo);
}

/** 新建课程：courseId 随机唯一；课时总数未知留 0，由后台表单填。 */
export function createEmptyCourse(input = {}) {
  const now = new Date().toISOString();
  return {
    courseId: String(input.courseId || '').trim() || makeUniqueCourseId(),
    orgId: String(input.orgId || DEFAULT_ORG_ID),
    name: String(input.name ?? input.course ?? input.title ?? '').trim(),
    ageRange: normalizeCourseAgeRange(input.ageRange ?? input.age),
    totalLessons: normalizeTotalLessons(input.totalLessons),
    defaultTopic: String(input.defaultTopic ?? input.defaultTitle ?? '').trim(),
    syllabus: normalizeSyllabus(input.syllabus),
    enabled: input.enabled !== false,
    sortOrder: normalizeSortOrder(input.sortOrder),
    timestamps: {
      // 用 ?? 而不是 ||：显式空串表示「历史数据本来就没有时间戳」，不要偷偷填 now。
      createdAt: String(input?.timestamps?.createdAt ?? input.createdAt ?? now),
      updatedAt: String(input?.timestamps?.updatedAt ?? input.updatedAt ?? now)
    }
  };
}

/**
 * 把任意来源的课程数据收敛成规范形状：不报错、不丢数据。
 * 缺 courseId 时按课程名推导一个稳定的 legacy id；无法识别的原始字段原样挂在 legacy 上。
 */
export function normalizeCourse(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = createEmptyCourse(source);
  return {
    ...base,
    courseId: String(source.courseId || source.id || '').trim()
      || makeCourseIdFromName(base.name || source.legacyKey || 'unknown'),
    ...(source.legacy ? { legacy: source.legacy } : {})
  };
}

/** 兼容读取课程的更新时间戳（规范形状是 timestamps，旧数据可能是平铺字段）。 */
export function courseTimestamp(course, key = 'updatedAt') {
  const stamp = course?.timestamps?.[key];
  if (stamp) return String(stamp);
  return String(course?.[key] || '');
}

/** 停用课程不出现在可选列表；enabled 明确为 false 才算停用。 */
export function isCourseSelectable(course) {
  return normalizeCourse(course).enabled !== false;
}

export function selectableCourses(list) {
  return sortCourses(list).filter(item => item.enabled !== false);
}

/**
 * 历史课次的课程名要能显示出来，所以这里**不过滤 enabled**：
 * 课程被停用后，引用它的旧课次仍要显示课程名，只有新选择时看不到它。
 */
export function findCourseById(list, courseId) {
  const key = String(courseId || '').trim();
  if (!key) return null;
  const items = (Array.isArray(list) ? list : []).map(normalizeCourse);
  return items.find(item => item.courseId === key) || null;
}

/** 按课程名查（班级上存的是课程名而不是 id，选课与后台去重都要用）。 */
export function findCourseByName(list, name) {
  const key = String(name || '').trim();
  if (!key) return null;
  const items = sortCourses(list);
  return items.find(item => item.name === key) || null;
}

/**
 * 把可能是「课程 id」也可能是「课程名」的值解析成课程 id。
 * data/studentManagement.js 的班级只存了课程名，界面要拿 id 去关联课次时走这里。
 */
export function resolveCourseId(list, value) {
  const key = String(value || '').trim();
  if (!key) return '';
  const byId = findCourseById(list, key);
  if (byId) return byId.courseId;
  const byName = findCourseByName(list, key);
  return byName ? byName.courseId : '';
}

/** 课次要显示的课程名：先按 courseId 查课程库（含停用课程），再退到旧记录里的课程名。 */
export function resolveLessonCourseName(lesson, list, fallback = '') {
  const courseId = String(lesson?.courseId || '').trim();
  const matched = findCourseById(list, courseId);
  if (matched && matched.name) return matched.name;
  const legacyName = String(lesson?.legacy?.course || lesson?.legacy?.courseName || '').trim();
  if (legacyName) return legacyName;
  return String(fallback || '').trim();
}

/** 该课程在第 lessonNo 次课的推荐课题：先查 syllabus，查不到回落 defaultTopic。 */
export function resolveSyllabusTopic(course, lessonNo) {
  const normalized = normalizeCourse(course);
  const no = normalizeSyllabusLessonNo(lessonNo);
  if (no) {
    const matched = normalized.syllabus.find(item => item.lessonNo === no);
    if (matched && matched.topic) return matched.topic;
  }
  return normalized.defaultTopic || '';
}

/**
 * 同上的完整版：返回 `{ lessonNo, topic, objectives, fromSyllabus }`。
 * fromSyllabus 为 false 表示这次用的是 defaultTopic 回落值，界面可以据此提示老师。
 */
export function resolveSyllabusEntry(course, lessonNo) {
  const normalized = normalizeCourse(course);
  const no = normalizeSyllabusLessonNo(lessonNo);
  const matched = no ? normalized.syllabus.find(item => item.lessonNo === no) : null;
  if (matched) return { ...matched, fromSyllabus: true };
  return { lessonNo: no, topic: normalized.defaultTopic || '', objectives: '', fromSyllabus: false };
}

const byCourseOrder = (a, b) => (
  a.sortOrder - b.sortOrder
) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
  || String(a.courseId).localeCompare(String(b.courseId));

export function sortCourses(list) {
  return (Array.isArray(list) ? list : []).map(normalizeCourse).sort(byCourseOrder);
}

/** 从列表里去掉一门课程（删除课程时用），返回新数组。 */
export function removeCourse(list, courseId) {
  const key = String(courseId || '').trim();
  return sortCourses(list).filter(item => item.courseId !== key);
}

/** 合并两份课程列表：winner 优先（同 courseId 覆盖 loser）。云端回来的是真源。 */
export function mergeCourses(winner, loser) {
  const byId = new Map();
  [...(Array.isArray(loser) ? loser : []), ...(Array.isArray(winner) ? winner : [])].forEach(item => {
    if (!item) return;
    const course = normalizeCourse(item);
    byId.set(course.courseId, course);
  });
  return sortCourses([...byId.values()]);
}

// 演示用种子课程：courseId 与 data/lessons.js 的种子课次对得上（course-creative-painting），
// 课程名与 data/studentManagement.js 的班级 course 字段对得上。
// syllabus 与种子课次的 topic 对齐（11 彩色的家 / 12 向着光的花 / 13 向日葵主题课），
// 7-10 与 14-16 故意留空，用来演示「syllabus 缺失时回落 defaultTopic」。
export const seedCourses = [
  {
    courseId: 'course-creative-painting',
    orgId: DEFAULT_ORG_ID,
    name: '创意绘画',
    ageRange: '5-7岁',
    totalLessons: 16,
    defaultTopic: '自由创作',
    syllabus: [
      { lessonNo: 1, topic: '我的第一支画笔', objectives: '熟悉材料，敢下笔。' },
      { lessonNo: 2, topic: '认识冷暖色', objectives: '在画面里分清冷暖两族颜色。' },
      { lessonNo: 3, topic: '圆形变变变', objectives: '用基本形组合出具体形象。' },
      { lessonNo: 4, topic: '线的散步', objectives: '感受线条的轻重与快慢。' },
      { lessonNo: 5, topic: '大大的脸', objectives: '观察五官比例并大胆表现。' },
      { lessonNo: 6, topic: '天空的颜色', objectives: '尝试用渐变表现天空。' },
      { lessonNo: 11, topic: '彩色的家', objectives: '安排房子与天空的色彩关系，尝试主动选择颜色。' },
      { lessonNo: 12, topic: '向着光的花', objectives: '观察光的方向，用冷暖对比表现花朵的主次关系。' },
      { lessonNo: 13, topic: '向日葵主题课', objectives: '用厚涂和线条表达个人感受，注意画面主次。' }
    ],
    enabled: true,
    sortOrder: 10,
    timestamps: { createdAt: '2026-06-01T02:00:00.000Z', updatedAt: '2026-08-01T02:00:00.000Z' }
  },
  {
    courseId: 'course-color',
    orgId: DEFAULT_ORG_ID,
    name: '色彩启蒙',
    ageRange: '4-5岁',
    totalLessons: 12,
    defaultTopic: '色彩游戏',
    syllabus: [
      { lessonNo: 1, topic: '颜色宝宝找朋友', objectives: '在游戏中认识三原色。' },
      { lessonNo: 2, topic: '颜色的味道', objectives: '把颜色和感受连起来说。' },
      { lessonNo: 3, topic: '印一印，变一变', objectives: '体验色彩混合的结果。' }
    ],
    enabled: true,
    sortOrder: 20,
    timestamps: { createdAt: '2026-06-01T02:00:00.000Z', updatedAt: '2026-08-01T02:00:00.000Z' }
  },
  {
    courseId: 'course-line-drawing',
    orgId: DEFAULT_ORG_ID,
    name: '线描与造型',
    ageRange: '7-9岁',
    totalLessons: 16,
    defaultTopic: '线条练习',
    syllabus: [
      { lessonNo: 1, topic: '一条线的旅行', objectives: '用一笔画完成画面分割。' },
      { lessonNo: 2, topic: '城市线描', objectives: '用疏密表现前后关系。' }
    ],
    enabled: true,
    sortOrder: 30,
    timestamps: { createdAt: '2026-06-01T02:00:00.000Z', updatedAt: '2026-08-01T02:00:00.000Z' }
  },
  {
    courseId: 'course-mixed-media',
    orgId: DEFAULT_ORG_ID,
    // 已停用的课程：不再出现在可选列表里，但引用它的历史课次仍要显示课程名。
    name: '综合材料',
    ageRange: '6-8岁',
    totalLessons: 8,
    defaultTopic: '材料探索',
    syllabus: [{ lessonNo: 1, topic: '纸的脾气', objectives: '感受不同纸张的特性。' }],
    enabled: false,
    sortOrder: 40,
    timestamps: { createdAt: '2026-05-01T02:00:00.000Z', updatedAt: '2026-07-20T02:00:00.000Z' }
  }
].map(normalizeCourse);

export function loadCourses() {
  if (typeof window === 'undefined') return sortCourses(seedCourses);
  const saved = safeParse(window.localStorage.getItem(STORAGE_KEY), null);
  if (!Array.isArray(saved) || !saved.length) return sortCourses(seedCourses);
  return sortCourses(saved);
}

export function persistCourses(list) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sortCourses(list))); } catch { /* 配额满时静默降级，云端仍是真源 */ }
}
