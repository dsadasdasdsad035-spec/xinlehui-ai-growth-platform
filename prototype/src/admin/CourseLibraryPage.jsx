// 管理员端「课程库」：左列表 + 右编辑，维护课程名 / 年龄段 / 课时总数 / 默认课题 /
// 分课时课题 / 启停 / 排序。
//
// 这一页是老师端「课程下拉 + 课题推荐」的数据源：课次的默认课题由
// resolveSyllabusTopic(course, lessonNo) 按课时序号从 syllabus 取，取不到才回落
// defaultTopic，所以分课时课题必须能在后台自己维护，而不是写死在代码里。
//
// 写入一律走 services/courseApi.js（它自己负责「先落本地镜像再推云端」），
// 页面只做表单校验与引用范围提示，不直接碰云端表。

import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, CircleAlert, Plus, Trash2 } from 'lucide-react';
import { Button, PageHeader, Status } from '../ui';
import {
  COURSE_AGE_RANGE_OPTIONS,
  DEFAULT_COURSE_SORT_ORDER,
  createEmptyCourse,
  findCourseByName,
  normalizeCourse,
  normalizeSortOrder,
  normalizeSyllabus,
  normalizeTotalLessons,
  removeCourse,
  selectableCourses,
  sortCourses
} from '../data/courses';
import { createCourse, deleteCourse, updateCourse } from '../services/courseApi';
import { loadStudentManagement } from '../data/studentManagement';

// 「未填课时总数」在领域层是 0（未知，见 data/courses.js 的 normalizeTotalLessons）。
// 16 次课是机构最常见的排课长度，但这个默认值只属于表单体验，不写进领域层。
const NEW_COURSE_DEFAULT_LESSONS = 16;

/** 课程 → 可编辑草稿：课时序号在表单里按字符串存，空行才好输入。 */
function draftFromCourse(course) {
  return {
    courseId: String(course?.courseId || ''),
    name: String(course?.name || ''),
    ageRange: String(course?.ageRange || ''),
    totalLessons: course?.totalLessons ? String(course.totalLessons) : '',
    defaultTopic: String(course?.defaultTopic || ''),
    sortOrder: String(course?.sortOrder ?? DEFAULT_COURSE_SORT_ORDER),
    enabled: course?.enabled !== false,
    syllabus: (course?.syllabus || []).map(entry => ({
      lessonNo: String(entry.lessonNo || ''),
      topic: String(entry.topic || ''),
      objectives: String(entry.objectives || '')
    }))
  };
}

/** 草稿 → 领域字段（与 courseApi 的入参同名，syllabus 交给 normalizeSyllabus 收敛）。 */
function payloadFromDraft(draft) {
  return {
    name: String(draft.name || '').trim(),
    ageRange: String(draft.ageRange || '').trim(),
    totalLessons: normalizeTotalLessons(draft.totalLessons),
    defaultTopic: String(draft.defaultTopic || '').trim(),
    sortOrder: normalizeSortOrder(draft.sortOrder),
    enabled: draft.enabled !== false,
    syllabus: normalizeSyllabus(draft.syllabus)
  };
}

export default function CourseLibraryPage({ courses = [], setCourses, lessons = [], setToast }) {
  const sorted = useMemo(() => sortCourses(courses), [courses]);
  const [editingId, setEditingId] = useState(() => sortCourses(courses)[0]?.courseId || '');
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editing = isNew ? null : sorted.find(item => item.courseId === editingId) || null;

  // 选中项变了（或云端水合回来把库刷新了）就重置草稿，避免拿着旧内容去覆盖新数据。
  useEffect(() => {
    if (isNew) return;
    setDraft(editing ? draftFromCourse(editing) : null);
    setError('');
  }, [editing, isNew]);

  const patch = (key, value) => setDraft(current => (current ? { ...current, [key]: value } : current));

  const patchSyllabus = (index, key, value) => setDraft(current => {
    if (!current) return current;
    const rows = current.syllabus.map((row, i) => (i === index ? { ...row, [key]: value } : row));
    return { ...current, syllabus: rows };
  });

  const addSyllabusRow = () => setDraft(current => {
    if (!current) return current;
    const nextNo = current.syllabus.reduce((max, row) => Math.max(max, Number(row.lessonNo) || 0), 0) + 1;
    return { ...current, syllabus: [...current.syllabus, { lessonNo: String(nextNo), topic: '', objectives: '' }] };
  });

  const removeSyllabusRow = (index) => setDraft(current => (
    current ? { ...current, syllabus: current.syllabus.filter((row, i) => i !== index) } : current
  ));

  const startNew = () => {
    setIsNew(true);
    setEditingId('');
    setConfirmDelete(false);
    setError('');
    // 新课程的 courseId 现在就要定下来：后端 createCourse 会沿用它，
    // 这样「云端推不上去、只留在本机」时列表里的这门课与本地镜像是同一条记录。
    setDraft(draftFromCourse(createEmptyCourse({ totalLessons: NEW_COURSE_DEFAULT_LESSONS })));
  };

  /** 引用范围：删除前必须能说清楚「会影响哪些课次 / 班级」。 */
  const usageFor = (course) => {
    if (!course) return { lessonCount: 0, classCount: 0 };
    const lessonCount = (Array.isArray(lessons) ? lessons : [])
      .filter(item => String(item?.courseId || '') === course.courseId).length;
    // 班级上存的是课程名（见 data/studentManagement.js 的 class.course），按名字数一遍。
    const classCount = loadStudentManagement().classes
      .filter(item => String(item?.course || '').trim() === course.name).length;
    return { lessonCount, classCount };
  };

  const validate = () => {
    const name = String(draft?.name || '').trim();
    if (!name) return '请先填写课程名，再保存课程。';
    const duplicate = findCourseByName(sorted, name);
    if (duplicate && duplicate.courseId !== draft.courseId) {
      return `课程库里已经有「${duplicate.name}」，请换一个课程名或直接编辑那一门。`;
    }
    return '';
  };

  const save = async () => {
    if (!draft) return;
    const reason = validate();
    if (reason) { setError(reason); return; }
    setError('');
    setSaving(true);
    const payload = payloadFromDraft(draft);
    try {
      if (isNew) {
        const created = await createCourse({ courseId: draft.courseId, ...payload }, { existingCourses: sorted });
        setCourses(sortCourses([...sorted, created]));
        setIsNew(false);
        setEditingId(created.courseId);
        setToast(`课程「${created.name}」已保存，老师端即可选用`);
      } else {
        const saved = await updateCourse(draft.courseId, payload, { existingCourses: sorted });
        setCourses(sortCourses(sorted.map(item => (item.courseId === saved.courseId ? saved : item))));
        setToast(`课程「${saved.name}」已更新`);
      }
    } catch {
      // courseApi 在推云端之前已经写过本地镜像，所以同步失败时也要把这一门留在列表里；
      // 否则下一次 persistCourses 会用不含它的旧列表把本地镜像覆盖掉，刷新后就真的丢了。
      if (isNew) {
        const local = normalizeCourse({ courseId: draft.courseId, ...payload });
        setCourses(sortCourses([...sorted, local]));
        setIsNew(false);
        setEditingId(local.courseId);
      } else {
        const current = sorted.find(item => item.courseId === draft.courseId);
        const local = normalizeCourse({ ...current, ...payload, courseId: draft.courseId });
        setCourses(sortCourses(sorted.map(item => (item.courseId === local.courseId ? local : item))));
      }
      setToast('已保存到本机；云端暂未连通，稍后可重试。');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const target = sorted.find(item => item.courseId === editingId);
    if (!target) return;
    const next = removeCourse(sorted, target.courseId);
    setConfirmDelete(false);
    setIsNew(false);
    setCourses(next);
    setEditingId(next[0]?.courseId || '');
    try {
      await deleteCourse(target.courseId);
      setToast(`课程「${target.name}」已删除`);
    } catch {
      setToast('已从本机移除，云端删除未同步。');
    }
  };

  const selectableCount = selectableCourses(sorted).length;
  const usage = editing ? usageFor(editing) : { lessonCount: 0, classCount: 0 };
  const configuredLessons = draft ? normalizeSyllabus(draft.syllabus).length : 0;
  const totalLessons = draft ? normalizeTotalLessons(draft.totalLessons) : 0;

  return <>
    <PageHeader
      title="课程库"
      desc="维护机构课程与分课时课题：老师端选课、课次的推荐课题都从这里取，改完不用找开发。"
      prd="PRD-11 / F-COURSE-ADM-01"
      actions={<Button icon={Plus} onClick={startNew}>新增课程</Button>}
    />
    <div className="split-page course-library">
      <div className="panel persona-list">
        <div className="panel-head">
          <h2>课程</h2>
          <small>{sorted.length} 门 · 可选 {selectableCount}</small>
        </div>
        {sorted.map(course => <button
          key={course.courseId}
          className={!isNew && course.courseId === editingId ? 'active' : ''}
          onClick={() => { setIsNew(false); setEditingId(course.courseId); setConfirmDelete(false); }}
        >
          <span className="class-color"/>
          <div>
            <b>{course.name || '未命名课程'}</b>
            <small>{[course.ageRange || '年龄段未填', course.totalLessons ? `${course.totalLessons} 课时` : '课时数未填'].join(' · ')}</small>
          </div>
          <em>{course.enabled === false ? '已停用' : '启用中'}</em>
        </button>)}
        {sorted.length ? null : <p className="persona-empty">课程库还是空的。点右上角「新增课程」建第一门。</p>}
        <p className="persona-empty">停用的课程不会出现在老师端选课列表里，但历史课次的课程名照常显示。</p>
      </div>

      <div className="panel persona-editor">
        {draft ? <>
          <div className="panel-head">
            <div>
              <h2>{isNew ? '新增课程' : (draft.name || '未命名课程')}</h2>
              <p>
                {isNew ? '保存后即可被老师端选课。' : <>课程 ID <code>{draft.courseId}</code> · 老师端{draft.enabled !== false ? '可选' : '不可选（已停用）'}</>}
              </p>
            </div>
            <div className="row-actions">
              {isNew ? null : <button className="icon-btn danger-text" title="删除课程" onClick={() => setConfirmDelete(true)}><Trash2 size={16}/></button>}
              <Button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存课程'}</Button>
            </div>
          </div>

          <div className="form-grid compact">
            <label>课程名<input value={draft.name} placeholder="例如：创意绘画" onChange={event => patch('name', event.target.value)}/></label>
            <label>年龄段
              <input list="course-age-options" value={draft.ageRange} placeholder="例如：5-7岁" onChange={event => patch('ageRange', event.target.value)}/>
            </label>
            <label>课时总数<input type="number" min="0" value={draft.totalLessons} placeholder="留空表示未知" onChange={event => patch('totalLessons', event.target.value)}/></label>
            <label>默认课题<input value={draft.defaultTopic} placeholder="分课时课题缺失时回落这一条" onChange={event => patch('defaultTopic', event.target.value)}/></label>
            <label>排序（越小越靠前）<input type="number" value={draft.sortOrder} onChange={event => patch('sortOrder', event.target.value)}/></label>
            <div style={{ alignSelf: 'end', paddingBottom: 10 }}>
              <label className="framing-enable">
                <input type="checkbox" checked={draft.enabled !== false} onChange={event => patch('enabled', event.target.checked)}/> 在老师端可选
              </label>
            </div>
          </div>
          <datalist id="course-age-options">
            {COURSE_AGE_RANGE_OPTIONS.map(option => <option key={option} value={option}/>)}
          </datalist>

          <div className="persona-skills">
            <div className="panel-head">
              <div>
                <h3>分课时课题</h3>
                <p>按课时序号取默认课题；这里没配的课时，课次会用默认课题「{draft.defaultTopic || '未填写'}」。</p>
              </div>
              <div className="row-actions">
                <button className="text-link" onClick={addSyllabusRow}><Plus size={14}/>新增一课时</button>
              </div>
            </div>
            {draft.syllabus.length ? <div className="course-syllabus-head">
              <span>课时序号</span><span>课题</span><span>教学目标（选填）</span><span/>
            </div> : null}
            {draft.syllabus.map((row, index) => <div className="course-syllabus-row" key={`${row.lessonNo}-${index}`}>
              <input type="number" min="1" value={row.lessonNo} placeholder="序号" onChange={event => patchSyllabus(index, 'lessonNo', event.target.value)}/>
              <input value={row.topic} placeholder="例如：彩色的家" onChange={event => patchSyllabus(index, 'topic', event.target.value)}/>
              <input value={row.objectives} placeholder="这一课希望孩子练什么" onChange={event => patchSyllabus(index, 'objectives', event.target.value)}/>
              <button className="icon-btn danger-text" title="移除这一课时" onClick={() => removeSyllabusRow(index)}><Trash2 size={15}/></button>
            </div>)}
            {draft.syllabus.length ? null : <p className="persona-empty">还没有分课时课题。不配也能用，老师端会一直取默认课题。</p>}
            <p className="persona-empty">
              已配置 {configuredLessons} 个课时{totalLessons ? ` / 共 ${totalLessons} 课时` : ''}。序号重复时后填的那条覆盖前一条。
            </p>
          </div>

          {error ? <div className="form-error"><CircleAlert size={16}/>{error}</div> : null}

          {confirmDelete ? <div className="danger-note" style={{ marginTop: 18 }}>
            <CircleAlert size={18}/>
            <span style={{ flex: 1 }}>
              {usage.lessonCount
                ? <>有 <b>{usage.lessonCount}</b> 个课次引用「{draft.name}」{usage.classCount ? `，另有 ${usage.classCount} 个班级按课程名关联到它` : ''}。
                  删除后这些课次将取不到课程名与课题；如果只是不想让老师再选它，建议改为「停用」。</>
                : <>目前没有课次引用「{draft.name}」{usage.classCount ? `，但有 ${usage.classCount} 个班级按课程名关联到它` : ''}。删除后无法恢复，历史课次不受影响。</>}
            </span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>取消</Button>
              <Button variant="danger" onClick={remove}>确认删除</Button>
            </span>
          </div> : null}

          {isNew ? null : <p className="persona-empty">
            <Status value={draft.enabled !== false ? '已启用' : '已停用'}/> 引用范围：{usage.lessonCount} 个课次{usage.classCount ? ` · ${usage.classCount} 个班级` : ''}
          </p>}
        </> : <p className="persona-empty"><BookOpen size={16}/> 选择左侧的一门课程，或点右上角「新增课程」。</p>}
      </div>
    </div>
  </>;
}
