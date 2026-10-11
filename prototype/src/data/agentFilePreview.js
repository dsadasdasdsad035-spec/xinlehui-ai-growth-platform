/**
 * 管理端「拼装预览」的选人与选课（[第三步 US-106b] / F-REVIEW-PROMPT-02）。
 *
 * 验收原文：**拼装预览与老师端实际加载使用同一个拼装函数**。所以拼装本身**不许在本模块重写** ——
 * 预览必须调用老师端 `startCloudReview` 用的那两个函数：
 *   `data/agentFiles.js` 的 `agentFileLoadout()`（加载顺序 / 生效范围 / 每层上限 / 8000 字预算 / 变量替换）
 *   → `services/llmReview.js` 的 `buildPersonaPrompt()`（把两段正文接进 system 提示词）。
 *
 * 本模块只管**界面到上下文的翻译**：把「一位学员 + 一节课 + 一位老师」换成那两个函数要的
 * 九个上下文字段（与 `main.jsx` 里传的形状逐字一致），外加下拉标签、上下文一句话、空态文案 ——
 * 这些文案放在这里，JSX 只渲染字段（US-105 的教训：JSX 里拼模板字符串会被解析器拒掉）。
 *
 * 零依赖纯函数（只 import 同层的 `lessons.js`），可以直接用 Node 跑断言。
 */

import {
  ATTENDANCE_LABELS,
  formatLessonDateDots,
  makeStudentId,
  normalizeLesson,
  sortLessons
} from './lessons';

/** 面板顶部的一句话说明（讲清「预览用的是哪个函数」）。 */
export const AGENT_FILE_PREVIEW_NOTE = '选一位学员与一节课：下面这段 system 提示词由老师端生成点评时**同一个拼装函数**实时算出（agentFileLoadout → buildPersonaPrompt），不是另写一份示例文案。';

/** 空态：还没有课次 / 这节课次还没有参与学员。 */
export const AGENT_FILE_PREVIEW_EMPTY_LESSON = '还没有课次：老师端「课后反馈」创建一节课次之后，这里才能预览。';
export const AGENT_FILE_PREVIEW_EMPTY_STUDENT = '这节课次还没有参与学员：先在老师端第一步登记参与学员，才谈得上「给谁生成点评」。';

/** 预览正文的两种来源（跟随当前编辑的草稿 vs 已保存的文件库）。 */
export const AGENT_FILE_PREVIEW_DRAFT_NOTE = '按右侧编辑器当前的正文拼装（含未保存的改动）：保存之后老师端才会加载这一份。';
export const AGENT_FILE_PREVIEW_SAVED_NOTE = '按已保存的文件库拼装（编辑器里没有未保存的改动）。';

/** 没有老师人设时的说明：兜底分支不加载 agent.md 与记忆文件（与老师端行为一致）。 */
export const AGENT_FILE_PREVIEW_NO_PROFILE_NOTE = '还没有老师人设：按「无人生兜底分支」拼装 —— 这一支不会加载 agent.md 与记忆文件（老师端同样是这个行为）。';

const str = (value) => (value === null || value === undefined ? '' : String(value).trim());

/** 课次候选（新的在前，与老师端的课次排序一致；没有日期的脏数据不进候选）。 */
export function agentFilePreviewLessons(lessons = []) {
  return sortLessons(lessons).filter((lesson) => lesson.lessonId && lesson.lessonDate);
}

/** 一节课的显示名：`2026.08.11 · 周六创意绘画 2 班 · 第 13 次课 · 向日葵主题课`。 */
export function agentFilePreviewLessonLabel(lesson, { className = '' } = {}) {
  const item = normalizeLesson(lesson);
  const parts = [
    formatLessonDateDots(item.lessonDate) || '日期未填',
    str(className) || str(item.legacy?.className) || '班级未填',
    item.lessonNo > 0 ? `第 ${item.lessonNo} 次课` : '序号未知',
    str(item.topic)
  ];
  return parts.filter(Boolean).join(' · ');
}

/** 课次下拉：`{ value: lessonId, label, lesson, className }`。 */
export function agentFilePreviewLessonOptions(lessons = [], { classes = [] } = {}) {
  const list = Array.isArray(classes) ? classes : [];
  return agentFilePreviewLessons(lessons).map((lesson) => {
    const classRecord = list.find((item) => str(item?.id) === lesson.classId) || null;
    const className = str(classRecord?.name) || str(lesson.legacy?.className);
    return {
      value: lesson.lessonId,
      label: agentFilePreviewLessonLabel(lesson, { className }),
      lesson,
      classRecord,
      className
    };
  });
}

/**
 * 学员下拉：这节课次的参与学员（含标了缺课的 —— 「这次给谁生成点评」是老师的选择，不是我们的）。
 * `value` 用 `studentId`（`makeStudentId()` 的派生口径，与学员记忆的生效范围写法一致）。
 */
export function agentFilePreviewStudentOptions(lesson) {
  const item = normalizeLesson(lesson || {});
  return item.participants.map((participant) => {
    const studentId = str(participant.studentId) || makeStudentId(participant.name);
    const attendanceLabel = ATTENDANCE_LABELS[participant.attendance] || participant.attendance;
    return {
      value: studentId,
      studentId,
      name: participant.name,
      attendance: participant.attendance,
      attendanceLabel,
      label: `${participant.name} · ${attendanceLabel}`
    };
  });
}

/** 选中项回退：拿不准就取第一个（下拉永远是受控的）。 */
export function agentFilePreviewPick(options = [], value = '') {
  const list = Array.isArray(options) ? options : [];
  const key = str(value);
  return list.find((option) => option.value === key) || list[0] || null;
}

/**
 * 本次上下文 —— **字段名与 `main.jsx` 的 `startCloudReview` 逐字一致**（九个键，不多不少）：
 * 机构 id / 机构名 / 老师 id / 老师姓名 / 班级 id / 班级名 / 学员 id / 学员姓名 / 课次日期。
 * 老师姓名优先取人设（与老师端 `activeProfile?.name || currentTeacherName` 同一优先级），
 * 课次日期用展签口径的 `2026.08.11`（`formatLessonDateDots`，老师端传的也是它）。
 */
export function agentFilePreviewContext({ lesson = null, student = null, classRecord = null, profile = null, orgId = '', orgName = '' } = {}) {
  const item = normalizeLesson(lesson || {});
  return {
    orgId: str(orgId) || str(item.orgId),
    orgName: str(orgName),
    teacherId: str(profile?.id) || str(item.teacherId),
    teacherName: str(profile?.name) || str(classRecord?.teacher),
    classId: str(item.classId),
    className: str(classRecord?.name) || str(item.legacy?.className),
    studentId: str(student?.value) || str(student?.studentId),
    studentName: str(student?.name),
    lessonDate: formatLessonDateDots(item.lessonDate)
  };
}

/** 上下文一句话读数：`机构 昕乐绘 · 班级 周六创意绘画 2 班 · 老师 林晓老师 · 课次日期 2026.08.11 · 学员 陈一诺`。 */
export function agentFilePreviewContextText(context, { topic = '' } = {}) {
  const source = context && typeof context === 'object' ? context : {};
  const parts = [
    // 机构名与机构 id 只写一个：有名字就写名字（id 是给「名字空着」时兜底的）。
    source.orgName ? `机构 ${source.orgName}` : (source.orgId ? `机构 id ${source.orgId}` : '机构未填'),
    source.className ? `班级 ${source.className}` : '班级未填',
    source.teacherName ? `老师 ${source.teacherName}` : '老师未填',
    source.lessonDate ? `课次日期 ${source.lessonDate}` : '课次日期未填'
  ];
  if (str(source.studentName)) parts.push(`学员 ${source.studentName}`);
  if (str(topic)) parts.push(`课题 ${topic}`);
  return parts.filter(Boolean).join(' · ');
}

/** 跟着当前编辑的文件选目标：学员记忆 → 那位学员；班级记忆 → 那个班的第一节课；老师 agent.md → 他带的课。 */
export function agentFilePreviewTargetForFile(file, lessons = [], { classes = [] } = {}) {
  const kind = str(file?.kind);
  const scope = str(file?.scope);
  const ref = str(file?.scopeRef);
  const options = agentFilePreviewLessonOptions(lessons, { classes });
  if (!ref || !options.length) return null;
  if (scope === 'student') {
    for (const option of options) {
      const students = agentFilePreviewStudentOptions(option.lesson);
      const hit = students.find((student) => student.value === ref || student.name === ref);
      if (hit) return { lessonId: option.value, studentId: hit.value };
    }
    return null;
  }
  if (scope === 'class') {
    const hit = options.find((option) => option.lesson.classId === ref || option.className === ref);
    if (hit) return { lessonId: hit.value, studentId: '' };
  }
  if (kind && scope === 'teacher') {
    const hit = options.find((option) => str(option.lesson.teacherId) === ref || str(option.classRecord?.teacher) === ref);
    if (hit) return { lessonId: hit.value, studentId: '' };
  }
  return null;
}
