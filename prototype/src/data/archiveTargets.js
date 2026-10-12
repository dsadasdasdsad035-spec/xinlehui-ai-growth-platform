// 成长档案的「对象筛选」—— 学员 / 班级 / 周期（[第四步 US-205] / FR-206）。
//
// 档案页原来把对象写死在 `record.student === '陈一诺'` 上：打开林小满的档案，看到的还是陈一诺的记录。
// 这里把三件事收成**零依赖纯函数**（界面只渲染它们的产物，可 `node` 直跑断言）：
//   ① 可选项列表 = 学员管理名单 ∪ 记录里出现过的名字 —— 记录不会因为名单被改过就再也选不到；
//   ② 默认选中   = 带入的偏好（路由参数 / 第四步点名的那位学员或班级）→ 可选项第一位；
//   ③ 过滤       = 个人按 `record.student`、班级按 `record.className`，日期升序（原有时间线口径）；
//      没选对象时返回**空列表**而不是「全部记录混在一起」—— 串档的根源就是把「未选择」当成通配。
export const ARCHIVE_TARGET_PERSONAL = '个人';
export const ARCHIVE_TARGET_CLASS = '班级';
export const ARCHIVE_TARGET_MODES = [ARCHIVE_TARGET_PERSONAL, ARCHIVE_TARGET_CLASS];

/** 生成周期的可选项（与档案页的「生成周期」下拉同源）。 */
export const ARCHIVE_PERIODS = ['半学期', '一学期', '一年度'];
export const ARCHIVE_PERIOD_DEFAULT = '一学期';

/** 无匹配记录时的空态入口文案（US-205 第 5 条点名的那一个）。 */
export const ARCHIVE_EMPTY_ACTION = '去创建课后反馈';

const str = value => String(value ?? '').trim();

/** 名字去重（保序）：名单顺序在前，记录里多出来的名字补在后面；空名 / 非字符串一律丢掉。 */
function uniqueNames(values) {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach(value => {
    const name = str(value);
    if (!name || seen.has(name)) return;
    seen.add(name);
    result.push(name);
  });
  return result;
}

/**
 * 两个选择器的可选项：`{students, classes}`。
 * 名单（`studentManagement`）在前、记录里出现过的名字在后 —— 有记录的学员/班级一定选得到。
 */
export function archiveTargetLists({ students = [], classes = [], records = [] } = {}) {
  return {
    students: uniqueNames([...(students || []).map(item => item && item.name), ...(records || []).map(item => item && item.student)]),
    classes: uniqueNames([...(classes || []).map(item => item && item.name), ...(records || []).map(item => item && item.className)])
  };
}

/** 当前对象对应哪一份可选项。 */
export function archiveTargetOptions(lists, target) {
  return (target === ARCHIVE_TARGET_CLASS ? lists && lists.classes : lists && lists.students) || [];
}

/**
 * 选中值：`preferred`（路由参数 / 第四步点名的名字）必须**真的在可选项里**才采用，
 * 否则回落到第一位；一个都没有时是空串（界面显示空态，不显示空下拉里的假名字）。
 */
export function resolveArchiveTargetValue(options, preferred = '') {
  const list = Array.isArray(options) ? options : [];
  const name = str(preferred);
  if (name && list.includes(name)) return name;
  return list[0] || '';
}

/**
 * 过滤：个人档案按 `record.student`、班级档案按 `record.className`；日期升序（与原有时间线一致）。
 * 键为空（没选学员/班级）时返回空列表 —— 「未选择」不是「全部」。
 */
export function filterArchiveRecords(records = [], { target, student = '', className = '' } = {}) {
  const isClass = target === ARCHIVE_TARGET_CLASS;
  const key = str(isClass ? className : student);
  if (!key) return [];
  return (Array.isArray(records) ? records : [])
    .filter(record => str(isClass ? record && record.className : record && record.student) === key)
    .sort((a, b) => str(a && a.date).localeCompare(str(b && b.date)));
}

/**
 * 档案页的「当前对象」视图：界面（标题 / 预览 / 空态 / 统计）只读这一份产物。
 * `displayName` 是没选到对象时的兜底称呼（空态与标题不出现空名字）。
 */
export function archiveTargetView(records = [], { target, student = '', className = '' } = {}) {
  const isClass = target === ARCHIVE_TARGET_CLASS;
  const name = str(isClass ? className : student);
  const lessons = filterArchiveRecords(records, { target, student, className });
  return {
    target: isClass ? ARCHIVE_TARGET_CLASS : ARCHIVE_TARGET_PERSONAL,
    isClass,
    name,
    displayName: name || (isClass ? '这个班级' : '这位孩子'),
    lessons,
    count: lessons.length
  };
}

/**
 * 无匹配记录时的空态（沿用档案里缺课文案的温柔语气）：
 * 说明「为什么这里是空的」+「接下来会发生什么」+ 一句不涉诊断的提示 + 去创建入口。
 */
export function archiveEmptyView(view = {}) {
  const name = str(view.displayName) || (view.isClass ? '这个班级' : '这位孩子');
  if (view.isClass) {
    return {
      title: `${name}还没有归档的课后反馈`,
      desc: '这个班级完成一次课后反馈并归档后，处理过的作品、课堂照片与老师点评会在这里汇成班级的成长轨迹。',
      hint: '每位孩子的成品会分别留存，班级档案会随个人归档一起更新。',
      action: ARCHIVE_EMPTY_ACTION
    };
  }
  return {
    title: `${name}还没有归档的课后反馈`,
    desc: `完成一节${name}的课后反馈并归档后，作品、课堂照片与点评会在这里连成清晰的成长轨迹。`,
    hint: '缺课也会被温柔地留成一页空白，不会在这里消失。',
    action: ARCHIVE_EMPTY_ACTION
  };
}
