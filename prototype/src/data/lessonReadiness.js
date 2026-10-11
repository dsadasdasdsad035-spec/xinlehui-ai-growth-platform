// 第一步「进入下一步」的前置校验（US-410）。
//
// 零依赖纯函数（**不 import 任何模块**）：必填项清单、判定与「具体原因」文案全部收在这里，
// 界面只负责渲染。好处有两个：
//   ① 展示层不可能与 go() 的拦截规则漂移 —— US-410 之前 go() 只查了「出席学员 / 作品」两项，
//      班级、课程、课次日期、课时序号缺了都能走到第二步，老师在后面才发现漏填；
//   ② 可以直接 `node /tmp/xxx.mjs` import 它跑断言（见 prototype/AGENTS.md 的「验证技巧」）。
//
// 校验顺序与第一步表单自上而下的顺序一致：
// 班级 → 课程 → 课次日期 → 课时序号 → 至少一位出席学员 → 至少一幅作品。
//
// 文案口径（验收原文）：任一项缺失要给**具体原因**（如「还没有上传任何学员作品」），
// 不能用笼统的「请完善信息」；所以每条原因都写到「去哪儿补」为止。

/** 校验项的固定顺序：界面渲染、摘要拼装与断言都按它走。 */
export const INTAKE_CHECK_ORDER = ['class', 'course', 'lessonDate', 'lessonNo', 'attendance', 'artwork'];

/** 每一项的短标签（用在「还差 N 项：班级、课程」这类摘要里）。 */
export const INTAKE_CHECK_LABELS = {
  class: '班级',
  course: '课程',
  lessonDate: '课次日期',
  lessonNo: '课时序号',
  attendance: '至少一位出席学员',
  artwork: '至少一幅作品'
};

/**
 * 单项缺失时的具体原因。写到「去哪儿补」，老师看完就知道该点哪里。
 * mode 只影响「出席学员」与「作品」两项：个人反馈的名单只有选中的那一位。
 */
function reasonFor(id, { classCount, courseCount, mode }) {
  if (id === 'class') {
    return classCount > 0
      ? '还没有选择班级：请在上方「选择班级」里选中本次上课的班级。'
      : '机构里还没有可用的班级：请先去「学员管理」新建班级，再回来创建课后反馈。';
  }
  if (id === 'course') {
    return courseCount > 0
      ? '还没有选择课程：请在上方「选择课程」里选中本次课程（停用的课程不在可选列表里）。'
      : '课程库暂时没有可选课程：请联系机构管理员在「课程库」里新增或启用课程。';
  }
  if (id === 'lessonDate') {
    return '课次日期为必填项：请在「课次日期与课时序号」里选择本次上课的日期（补录上节课可以选过去的日期）。';
  }
  if (id === 'lessonNo') {
    return '课时序号为必填的正整数：请填写这是该班的第几次课（例如 13），课题会按这个序号从分课时课题里取。';
  }
  if (id === 'attendance') {
    return mode === '个人反馈'
      ? '个人反馈还没有到场的学员：请在上方「选择学员」里选中一位孩子，并把出席状态设为「出席」或「补课」。'
      : '本次课次还没有到场的学员（名单被清空，或全部标成了缺课）：请在「参与学员与出席状态」里至少把一位学员标为「出席」或「补课」。';
  }
  return mode === '个人反馈'
    ? '还没有上传任何学员作品：请在「学员作品」里上传 1 幅作品。'
    : '还没有上传任何学员作品：请在「学员作品上传位」里为至少一位到场学员上传 1 幅作品。';
}

/**
 * 评估「能不能从第一步进入第二步」。
 *
 * 入参都是第一步的**派生值**（不是 state 本身），展示层不许再自己写判断：
 *   classId        当前班级 id（选中且可见才有值）
 *   classCount     可见班级数量（用来区分「没选」和「机构里就没有班」）
 *   courseId       当前生效课程 id
 *   courseCount    可选课程数量
 *   lessonDate     课次日期（YYYY-MM-DD，必填）
 *   lessonNoValid  课时序号是否为合法正整数
 *   mode           '个人反馈' | '班级反馈'
 *   attendedCount  到场学员数（出席 + 补课）
 *   artworkCount   已上传并绑定到学员的作品数（个人反馈未上传时传 0）
 */
export function evaluateIntake(input) {
  // 入参收敛：null / undefined / 非对象（调用方漏传）一律按「什么都没有」处理，永不抛错。
  const source = input && typeof input === 'object' ? input : {};
  const {
    classId = '',
    classCount = 0,
    courseId = '',
    courseCount = 0,
    lessonDate = '',
    lessonNoValid = false,
    mode = '个人反馈',
    attendedCount = 0,
    artworkCount = 0
  } = source;
  const context = {
    classCount: Number(classCount) || 0,
    courseCount: Number(courseCount) || 0,
    mode: mode === '班级反馈' ? '班级反馈' : '个人反馈'
  };
  const satisfied = {
    class: Boolean(classId),
    course: Boolean(courseId),
    lessonDate: Boolean(String(lessonDate).trim()),
    lessonNo: Boolean(lessonNoValid),
    attendance: (Number(attendedCount) || 0) > 0,
    artwork: (Number(artworkCount) || 0) > 0
  };
  const checks = INTAKE_CHECK_ORDER.map(id => ({
    id,
    label: INTAKE_CHECK_LABELS[id],
    ok: satisfied[id],
    reason: satisfied[id] ? '' : reasonFor(id, context)
  }));
  const failed = checks.filter(check => !check.ok);
  const ok = failed.length === 0;
  const failedLabels = failed.map(check => check.label);
  return {
    ok,
    total: checks.length,
    passedCount: checks.length - failed.length,
    failedCount: failed.length,
    checks,
    failed,
    failedLabels,
    reasons: failed.map(check => check.reason),
    summary: ok
      ? `前置校验已全部通过（${checks.length} 项），可以进入智能装裱。`
      : `还差 ${failed.length} 项：${failedLabels.join('、')}`,
    // 具体原因的多行文本（便于 toast / 断言直接取，不必自己去遍历 failed）。
    detailText: failed.map(check => check.reason).join('\n')
  };
}
