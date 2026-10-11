// 第三步「五维点评」的课次上下文（[第三步到第一步联通] US-057）。
//
// 为什么需要这一层：
//  - 第三步原来的「课题」下拉是**写死的字符串**（通用美术 / 创意绘画（3-6岁）…），与课程库、
//    与本次课次毫无关系 —— 点评提示词里的【本次课题】永远不是这节课真正上的是什么；
//  - 点评提示词里的课次日期必须取 `lesson.lessonDate`（第一步的课次信息），不能用系统当天：
//    补录上节课时，点评要和展签、成长档案、文件名指向同一天（US-014 / US-038 的同一条纪律）。
//
// 三条规则（**唯一真源**：界面下拉、提示词、轨迹留档都读这一份产物，别在别处再算一遍）：
//  1. **课次实体优先，但只在自然键一致时** —— `classId + lessonDate + lessonNo` 三项都对得上
//     才认它（课次上的 `topic` / `lessonDate` 就是这次点评的上下文）；对不上说明第一步的表单已经
//     指向另一次课（换班、改日期、改序号），这时以表单为准 —— 否则「补录上节课」的点评里会印着
//     上一条课次的日期（US-038 修的就是这一类错配）。
//  2. 课题取值顺序：课次实体上的 `topic` → 传入的表单课题（第一步按课时序号从课程库推的）→
//     课程库按课时序号取的 syllabus 课题 / 默认课题。
//  3. 下拉选项来自**课程库**（`课程名（年龄段）`）+ 本次课次的课题；本次课次的那门课程即使已停用
//     也留在列表里（历史课次不能因为课程停用就丢名字，与 `findCourseById` 不过滤 enabled 同一条纪律）。
//
// 零依赖纯模块（只 import 其它 data 模块），可以直接 `node` 跑断言（见 prototype/AGENTS.md）。
import { findCourseById, normalizeCourse, resolveSyllabusTopic, selectableCourses } from './courses';
import { formatLessonDateDots, normalizeLessonDate } from './lessons';

const str = (value) => String(value ?? '').trim();

/** 课时序号：正整数，0 表示未知（与 `data/lessons.js` 同口径）。 */
const lessonNoOf = (value) => {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
};

/** 课题来源：`lesson` = 课次实体，`course` = 课程库 / 表单推导，`teacher` = 老师在下拉里手选过。 */
export const REVIEW_SUBJECT_SOURCES = { lesson: 'lesson', course: 'course', teacher: 'teacher', none: 'none' };

/** 下拉里「本次课次课题」的标记（老师一眼能看出默认值是哪来的）。 */
export const REVIEW_SUBJECT_LESSON_SUFFIX = '（本次课次课题）';
/** 下拉里本次课次那门课程的标记。 */
export const REVIEW_SUBJECT_COURSE_SUFFIX = ' · 本次课次课程';
/** 课程库为空、也没有课次课题时的空态文案（不渲染空下拉）。 */
export const REVIEW_SUBJECT_EMPTY_NOTE = '还没有可选课题：课程与分课时课题由机构管理员在「课程库」里维护，第一步的课题也从那里取。';

/** 课程在下拉里的写法：`课程名（年龄段）`（没有年龄段就只写课程名）。 */
export function reviewCourseLabel(course) {
  const item = normalizeCourse(course);
  if (!item.name) return '';
  return item.ageRange ? `${item.name}（${item.ageRange}）` : item.name;
}

/**
 * 传入的课次实体是不是「就是第一步正在编辑的这一次课」：
 * 自然键 `classId + lessonDate + lessonNo` 三项必须齐全且逐项一致
 * （缺一项就不认 —— 「认不出来」比「认错一次课」安全）。
 */
export function reviewLessonMatches(lesson, { classId = '', lessonDate = '', lessonNo = 0 } = {}) {
  const item = lesson && typeof lesson === 'object' ? lesson : null;
  if (!item) return false;
  const wantClass = str(classId);
  const wantDate = normalizeLessonDate(lessonDate);
  const wantNo = lessonNoOf(lessonNo);
  if (!wantClass || !wantDate || !wantNo) return false;
  return str(item.classId) === wantClass
    && normalizeLessonDate(item.lessonDate) === wantDate
    && lessonNoOf(item.lessonNo) === wantNo;
}

/**
 * 第三步的下拉选项（唯一真源）：
 *   ① 本次课次的课题（来自课次实体或课程库，带「本次课次课题」标记）；
 *   ② 课程库里的可选课程（`课程名（年龄段）`），本次课次那门课程带「本次课次课程」标记。
 * 同名的条目只留第一条（`value` 是选项的值，重复会让下拉出现两个一样的选项）。
 */
export function reviewSubjectOptions({ courses = [], courseId = '', topic = '' } = {}) {
  const options = [];
  const push = (value, label, source) => {
    const key = str(value);
    if (!key || options.some((item) => item.value === key)) return;
    options.push({ value: key, label: str(label) || key, source });
  };
  const lessonTopic = str(topic);
  if (lessonTopic) push(lessonTopic, `${lessonTopic}${REVIEW_SUBJECT_LESSON_SUFFIX}`, REVIEW_SUBJECT_SOURCES.lesson);
  const theCourseId = str(courseId);
  const list = selectableCourses(courses);
  // 本次课次的那门课程**即使停用也在列表里**（历史课次仍要能显示 / 选中它的名字）。
  const owned = findCourseById(courses, theCourseId);
  const all = owned && !list.some((item) => item.courseId === owned.courseId) ? [...list, owned] : list;
  all.forEach((course) => {
    const label = reviewCourseLabel(course);
    push(label, course.courseId === theCourseId ? `${label}${REVIEW_SUBJECT_COURSE_SUFFIX}` : label, REVIEW_SUBJECT_SOURCES.course);
  });
  return options;
}

/**
 * 本次点评的课次上下文（课题 / 课次日期 / 课程 / 下拉选项）。
 *
 * 入参是**第一步的表单上下文**（`classId / courseId / lessonNo / lessonDate / topic`）
 * 与候选的**课次实体**（`lesson`，通常是 `lessons.find(item=>item.lessonId===currentLessonId)`）。
 * 自然键一致时以课次实体为准，否则以表单为准（见文件头的规则 1）。
 */
export function reviewLessonContext({ lesson = null, courses = [], classId = '', courseId = '', lessonNo = 0, lessonDate = '', topic = '' } = {}) {
  const usesLesson = reviewLessonMatches(lesson, { classId, lessonDate, lessonNo });
  const entity = usesLesson ? lesson : null;
  const resolvedCourseId = str(entity?.courseId) || str(courseId);
  const course = findCourseById(courses, resolvedCourseId);
  const resolvedLessonNo = lessonNoOf(entity?.lessonNo) || lessonNoOf(lessonNo);
  // 课题：课次实体 → 表单（第一步按课时序号从课程库推的）→ 课程库现推一次（兜底，永不抛错）。
  const resolvedTopic = str(entity?.topic) || str(topic) || resolveSyllabusTopic(course, resolvedLessonNo);
  const resolvedDate = normalizeLessonDate(entity?.lessonDate || lessonDate);
  return {
    lessonId: str(entity?.lessonId),
    classId: str(entity?.classId) || str(classId),
    courseId: resolvedCourseId,
    courseName: str(course?.name),
    courseLabel: reviewCourseLabel(course),
    lessonNo: resolvedLessonNo,
    lessonDate: resolvedDate,
    lessonDateDots: formatLessonDateDots(resolvedDate),
    topic: resolvedTopic,
    // `lesson` = 这次点评的上下文来自课次实体；`form` = 来自第一步表单（这次课次还没保存）。
    contextSource: entity ? 'lesson' : 'form',
    usesLesson: Boolean(entity),
    options: reviewSubjectOptions({ courses, courseId: resolvedCourseId, topic: resolvedTopic })
  };
}

/**
 * 下拉最终选中的值（`{ value, source, label, picked }`）：
 *   老师手选过且那个值还在选项里 → 老师的选择；否则 → 本次课次的课题；再否则 → 课程库里的课程；
 *   一个选项都没有时返回空串（界面渲染空态，不渲染空下拉）。
 * 「手选过的值不在选项里」（例如对应课程被删了）时自动落回派生值，控制得住的下拉不会出现空选中。
 */
export function resolveReviewSubject({ options = [], context = null, picked = '' } = {}) {
  const list = (Array.isArray(options) ? options : []).filter((item) => item && str(item.value));
  const find = (value) => list.find((item) => item.value === value) || null;
  const pick = find(str(picked));
  if (pick) return { value: pick.value, label: pick.label, source: REVIEW_SUBJECT_SOURCES.teacher, picked: true };
  const topic = find(str(context?.topic));
  if (topic) return { value: topic.value, label: topic.label, source: REVIEW_SUBJECT_SOURCES.lesson, picked: false };
  const course = find(str(context?.courseLabel));
  if (course) return { value: course.value, label: course.label, source: REVIEW_SUBJECT_SOURCES.course, picked: false };
  const first = list[0] || null;
  return first
    ? { value: first.value, label: first.label, source: REVIEW_SUBJECT_SOURCES.course, picked: false }
    : { value: '', label: '', source: REVIEW_SUBJECT_SOURCES.none, picked: false };
}

/** 下拉上那一行说明（老师看得见的「这次点评的课题与日期从哪来」）。 */
export function reviewSubjectContextNote(context = null) {
  const item = context && typeof context === 'object' ? context : {};
  if (!item.options?.length) return REVIEW_SUBJECT_EMPTY_NOTE;
  const from = item.contextSource === 'lesson' ? '本次课次（已保存的课次数据）' : '本次课次（第一步的表单，课程库的分课时课题）';
  const bits = [];
  if (item.topic) bits.push(`课题《${item.topic}》`);
  if (item.courseLabel) bits.push(`课程 ${item.courseLabel}`);
  if (item.lessonDateDots) bits.push(`课次日期 ${item.lessonDateDots}`);
  return `${from}：${bits.join(' · ')}。下拉里还可以换成课程库里的其它课程类型。`;
}
