import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, Download, FileText, Frame, Image, MessageSquareText, Plus, Search, Users, X } from 'lucide-react';
import { loadStudentManagement, persistStudentManagement } from './data/studentManagement';
import { loadRemoteStudentManagement, saveRemoteStudentManagement } from './services/studentManagementApi';

const downloadAsset = (url, name) => {
  if (!url) return false;
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  return true;
};

function LessonActions({ entry, setToast }) {
  const download = () => {
    const artwork = downloadAsset(entry.artworkUrl, `${entry.title}-线稿作品.png`);
    const photo = downloadAsset(entry.photoUrl, `${entry.title}-课堂照片.jpg`);
    setToast(artwork || photo ? '已开始下载处理后的作品和照片' : '这节课暂时没有可下载的成品素材');
  };
  return <div className="archive-lesson-actions"><button onClick={download}><Download size={14} />下载成品</button><button onClick={() => setToast(`已生成《${entry.title}》的家长分享卡，包含作品、照片和老师点评。`)}><MessageSquareText size={14} />转发家长</button></div>;
}

function EmptyRecords() {
  return <div className="empty-records"><Archive /><b>还没有归档的课后反馈</b><p>完成一次课后反馈并点击“归档并生成分享”，记录会自动出现。</p></div>;
}

function ParentBindingDialog({ student, onClose, onSave, onRevoke }) {
  const [guardianName, setGuardianName] = useState(student?.guardianName || '');
  const [guardianPhone, setGuardianPhone] = useState(student?.guardianPhone || '');
  return <div className="student-create-dialog" role="dialog" aria-modal="true" aria-labelledby="parent-binding-title"><section><button className="dialog-close" aria-label="关闭" onClick={onClose}><X size={18} /></button><span>家长端绑定</span><h2 id="parent-binding-title">邀请家长查看孩子的成长档案</h2><p>确认监护人信息后，会保存绑定资料；短信或微信邀请将在正式账号服务接入后发送。</p><label>监护人称呼 <em>必填</em><input autoFocus value={guardianName} onChange={event => setGuardianName(event.target.value)} placeholder="例如：王小雨妈妈" /></label><label>家长手机号 <em>必填</em><input type="tel" value={guardianPhone} onChange={event => setGuardianPhone(event.target.value)} placeholder="用于家长登录与接收邀请" /></label><div className="dialog-actions">{student?.guardianPhone ? <button className="danger" onClick={onRevoke}>撤销绑定</button> : null}<span/><button onClick={onClose}>取消</button><button className="primary" onClick={() => onSave({ guardianName, guardianPhone })}><Users size={16} />保存并生成邀请</button></div></section></div>;
}

export default function StudentArchiveData({ records, setToast }) {
  const [section, setSection] = useState('学员管理');
  const [student, setStudent] = useState('陈一诺');
  const [studentTab, setStudentTab] = useState('课程记录');
  const [management, setManagement] = useState(loadStudentManagement);
  const [serverSyncReady, setServerSyncReady] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveClass, setArchiveClass] = useState('全部班级');
  const [classArchiveSearch, setClassArchiveSearch] = useState('');
  const [selectedArchiveClass, setSelectedArchiveClass] = useState('周六创意绘画 2 班');
  const [studentDraft, setStudentDraft] = useState({ name: '', birthDate: '', className: '周六创意绘画 2 班', guardianName: '', guardianPhone: '', expect: '' });
  const [classDraft, setClassDraft] = useState({ name: '', course: '创意绘画', schedule: '', teacher: '林晓老师', capacity: 18 });

  const { students, classes } = management;
  useEffect(() => {
    let active = true;
    loadRemoteStudentManagement().then(remote => {
      if (!active) return;
      setManagement(remote);
      setServerSyncReady(true);
    }).catch(() => { /* Keep the local browser backup when the local API is not running. */ });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    persistStudentManagement(students, classes);
    if (serverSyncReady) void saveRemoteStudentManagement({ students, classes }).catch(() => {});
  }, [classes, serverSyncReady, students]);

  const entries = useMemo(() => records.filter(record => record.student === student).sort((a, b) => b.date.localeCompare(a.date)), [records, student]);
  const activeStudent = students.find(item => item.name === student);
  const classRoster = item => students.filter(studentItem => studentItem.className === item.name);
  const deferredArchiveSearch = useDeferredValue(archiveSearch.trim());
  const deferredClassArchiveSearch = useDeferredValue(classArchiveSearch.trim());
  const archiveMatches = useMemo(() => {
    const keyword = deferredArchiveSearch.toLocaleLowerCase();
    return students.filter(item => (archiveClass === '全部班级' || item.className === archiveClass) && (!keyword || item.name.toLocaleLowerCase().includes(keyword)));
  }, [archiveClass, deferredArchiveSearch, students]);
  const classArchiveMatches = useMemo(() => {
    const keyword = deferredClassArchiveSearch.toLocaleLowerCase();
    return classes.filter(item => !keyword || item.name.toLocaleLowerCase().includes(keyword) || item.course.toLocaleLowerCase().includes(keyword));
  }, [classes, deferredClassArchiveSearch]);
  const activeArchiveClass = classes.find(item => item.name === selectedArchiveClass) || classes[0];

  const createStudent = () => {
    const name = studentDraft.name.trim();
    if (!name) return setToast('请先填写孩子姓名');
    if (students.some(item => item.name === name)) return setToast('该学员已存在，请直接选择后编辑');
    setManagement(current => ({ ...current, students: [...current.students, { ...studentDraft, name }] }));
    setStudent(name);
    setStudentTab('基础档案');
    setDialog(null);
    setStudentDraft({ name: '', birthDate: '', className: classes[0]?.name || '', guardianName: '', guardianPhone: '', expect: '' });
    setToast(`已为 ${name} 建立学员档案。`);
  };

  const saveClass = () => {
    const name = classDraft.name.trim();
    if (!name) return setToast('请先填写班级名称');
    if (classes.some(item => item.name === name && item.id !== dialog?.classId)) return setToast('该班级名称已存在');
    if (dialog?.mode === 'edit-class') {
      setManagement(current => ({
        classes: current.classes.map(item => item.id === dialog.classId ? { ...item, ...classDraft, name } : item),
        students: current.students.map(item => item.className === dialog.originalName ? { ...item, className: name } : item)
      }));
      setToast('班级信息已保存，相关学员已同步更新。');
    } else {
      setManagement(current => ({ ...current, classes: [...current.classes, { ...classDraft, id: `class-${Date.now()}`, name }] }));
      setToast(`已新建 ${name}。`);
    }
    setDialog(null);
    setClassDraft({ name: '', course: '创意绘画', schedule: '', teacher: '林晓老师', capacity: 18 });
  };

  const openEditClass = item => {
    setClassDraft({ name: item.name, course: item.course, schedule: item.schedule, teacher: item.teacher, capacity: item.capacity });
    setDialog({ mode: 'edit-class', classId: item.id, originalName: item.name });
  };

  const openParentBinding = () => {
    setDialog({ mode: 'parent-binding' });
  };

  const saveParentBinding = ({ guardianName: rawName, guardianPhone: rawPhone }) => {
    const guardianName = rawName.trim();
    const guardianPhone = rawPhone.trim();
    if (!guardianName || !guardianPhone) return setToast('请填写监护人称呼和手机号，再生成邀请。');
    setManagement(current => ({ ...current, students: current.students.map(item => item.name === student ? { ...item, guardianName, guardianPhone } : item) }));
    setDialog(null);
    setToast(`已为${guardianName}生成家长端邀请；短信/微信发送将在账号服务接入后启用。`);
  };

  const revokeParentBinding = () => {
    setManagement(current => ({ ...current, students: current.students.map(item => item.name === student ? { ...item, guardianName: '', guardianPhone: '' } : item) }));
    setDialog(null);
    setToast(`已撤销${student}的家长端绑定；该手机号将不能再查看孩子档案。`);
  };

  const saveStudentProfile = () => {
    const panel = document.querySelector('.student-profile-form');
    const birthDate = panel?.querySelector('input[type="date"]')?.value || '';
    const className = panel?.querySelector('select')?.value || '';
    const expect = panel?.querySelector('textarea')?.value || '';
    setManagement(current => ({ ...current, students: current.students.map(item => item.name === student ? { ...item, birthDate, className, expect } : item) }));
    setToast(`${student}的基础档案已保存。`);
  };

  const studentManagement = <div className="student-archive-layout">
    <aside className="archive-student-rail">
      <div className="student-rail-head"><div><b>全部学员</b><small>{students.length} 位学员</small></div><button className="add-student-button" onClick={() => setDialog({ mode: 'create-student' })}><Plus size={15} />新增学员</button></div>
      {students.map((item, index) => <button key={item.name} className={student === item.name ? 'active' : ''} onClick={() => { setStudent(item.name); setStudentTab('课程记录'); }}><span className={`avatar lg a${index % 3}`}>{item.name[0]}</span><div><b>{item.name}</b><small>{item.className}</small></div><ArrowRight /></button>)}
    </aside>
    <main className="student-archive-main">
      <header className="student-archive-head"><div><span>{student} · 学员详情</span><h2>从每一节课，看见孩子正在积累的成长。</h2><p>处理后的作品、课堂照片与点评会按课次留存，方便老师持续跟进。</p></div><div className="student-head-actions"><button className="parent-binding-button" onClick={openParentBinding}><Users size={16} />{activeStudent?.guardianName ? '管理家长绑定' : '绑定家长端'}</button><button className="primary" onClick={() => { setSection('个人成长档案'); }}><Archive size={17} />查看个人成长档案</button></div></header>
      <nav className="student-archive-tabs">{['课程记录', '基础档案', '阶段报告'].map(name => <button key={name} className={studentTab === name ? 'active' : ''} onClick={() => setStudentTab(name)}>{name}</button>)}</nav>
      {studentTab === '课程记录' ? <section className="student-work-archive"><div><b>每节课的作品与记录</b><span>仅保留处理后的作品、课堂照片与完整点评。</span></div>{entries.length ? entries.map(entry => <article className={entry.status === '缺课' ? 'absent' : ''} key={entry.id}><time>{entry.date.slice(5).replace('-', '.')}</time>{entry.status === '缺课' ? <div className="absence-note"><b>这节课，我们先轻轻为孩子留下一页。</b><p>{entry.reviews.summary || '老师已经把这次的课程主题和创作机会好好保留，等孩子回来时，我们会陪她自然地接上。'}</p></div> : <><div className="student-work-thumb">{entry.artworkUrl ? <img src={entry.artworkUrl} alt={`${entry.title}处理后的作品`} /> : <Frame />}</div><div className="student-photo-thumb">{entry.photoUrl ? <img src={entry.photoUrl} alt={`${entry.title}课堂照片`} /> : <Image />}</div><div><b>《{entry.title}》</b><p>{entry.reviews.美术能力}</p><button onClick={() => setToast(`已展开 ${entry.date} 的完整多维点评`)}>查看完整点评 <ArrowRight /></button><LessonActions entry={entry} setToast={setToast} /></div></>}</article>) : <EmptyRecords />}</section> : null}
      {studentTab === '基础档案' ? <section className="student-profile-form"><div className="profile-section-head"><div><b>学员基础信息</b><span>这些信息帮助老师理解孩子，并规划后续课程。</span></div><button onClick={saveStudentProfile}>保存档案</button></div><div className="base-info-grid"><label>姓名<input defaultValue={student} readOnly /></label><label>出生年月日<input type="date" defaultValue={activeStudent?.birthDate || ''} /></label><label>所在班级<select defaultValue={activeStudent?.className || ''}>{classes.map(item => <option key={item.id}>{item.name}</option>)}</select></label><label>学习期望<textarea defaultValue={activeStudent?.expect || '希望孩子更自信地表达自己的想法。'} /></label></div><div className="parent-binding-summary"><div><Users size={18} /><span><b>家长端绑定</b><small>{activeStudent?.guardianName ? `${activeStudent.guardianName} · ${activeStudent.guardianPhone || '待补充手机号'}` : '尚未绑定家长账号'}</small></span></div><button onClick={openParentBinding}>{activeStudent?.guardianName ? '管理绑定' : '去绑定'}</button></div></section> : null}
      {studentTab === '阶段报告' ? <section className="student-reports"><div className="report-card-primary"><span>阶段成长报告</span><h3>把作品、照片与点评连成清晰的成长轨迹。</h3><p>当前已归档 {entries.length} 条记录。生成报告后将含课次索引、阶段总结、雷达分析与下一阶段学习规划。</p><button className="primary" onClick={() => setToast('阶段报告生成任务已创建，等待服务端接入')}><FileText size={17} />生成阶段报告</button></div></section> : null}
    </main>
  </div>;

  const classManagement = <section className="class-management-panel">
    <header><div><span>班级管理</span><h2>管理班级、课表与班级成员</h2><p>建立班级后，可在新增学员时直接分配到对应班级。</p></div><button className="primary" onClick={() => setDialog({ mode: 'create-class' })}><Plus size={17} />新建班级</button></header>
    <div className="class-management-list">{classes.map(item => { const roster = classRoster(item); return <article key={item.id}><div className="class-icon"><Users size={20} /></div><div><b>{item.name}</b><p>{item.course} · {item.schedule}</p><small>{item.teacher} · 已有 {roster.length} / {item.capacity} 位学员</small></div><div className="class-card-actions"><button onClick={() => { setStudent(roster[0]?.name || student); setSection('学员管理'); }}>查看学员 <ArrowRight size={14} /></button><button onClick={() => openEditClass(item)}>编辑班级</button></div></article>; })}</div>
  </section>;

  const personalArchive = <section className="archive-overview">
    <header><div><span>个人成长档案</span><h2>{student}的成长档案</h2><p>按孩子汇集作品、课堂照片、点评与阶段性总结。</p></div><button className="primary" onClick={() => { setSection('学员管理'); setStudentTab('课程记录'); }}>查看课次记录 <ArrowRight size={17} /></button></header>
    <section className="archive-student-finder" aria-label="查找学员成长档案"><div className="archive-finder-head"><div><b>查找学员档案</b><span>输入姓名或筛选班级，快速切换正在查看的孩子</span></div><small>共 {archiveMatches.length} 位结果</small></div><div className="archive-finder-controls"><label><Search size={16} /><input value={archiveSearch} onChange={event => setArchiveSearch(event.target.value)} placeholder="搜索学员姓名" aria-label="搜索学员姓名" /></label><select value={archiveClass} onChange={event => setArchiveClass(event.target.value)} aria-label="按班级筛选"><option>全部班级</option>{classes.map(item => <option key={item.id}>{item.name}</option>)}</select></div><div className="archive-student-results">{archiveMatches.length ? archiveMatches.map((item, index) => <button key={item.name} className={student === item.name ? 'active' : ''} onClick={() => setStudent(item.name)}><span className={`avatar a${index % 3}`}>{item.name[0]}</span><span><b>{item.name}</b><small>{item.className}</small></span>{student === item.name ? <em>正在查看</em> : null}</button>) : <p>没有找到匹配的学员，请调整姓名或班级筛选。</p>}</div></section>
    <div className="archive-overview-grid"><article><Frame /><b>{entries.length}</b><span>已归档作品与课次</span></article><article><MessageSquareText /><b>{entries.length}</b><span>可查看的智能点评</span></article><article><FileText /><b>阶段报告</b><span>根据归档记录生成</span></article></div>
    <div className="archive-overview-note"><Archive /><div><b>档案只保存处理后的成品</b><p>上传时的原始拍摄图不会作为成长档案的展示内容；后续调整后的成品会成为最新归档版本。</p></div></div>
  </section>;

  const classArchive = <section className="archive-overview">
    <header><div><span>班级成长档案</span><h2>{activeArchiveClass?.name || '班级'}的成长档案</h2><p>汇集班级作品、课次记录与阶段观察，方便老师回顾整体教学进展。</p></div><button className="primary" onClick={() => setToast('班级成长档案生成任务已创建，等待服务端接入')}><FileText size={17} />生成班级档案</button></header>
    <section className="archive-student-finder" aria-label="查找班级成长档案"><div className="archive-finder-head"><div><b>查找班级档案</b><span>按班级名称或课程类型查找，快速切换要查看的班级</span></div><small>共 {classArchiveMatches.length} 个结果</small></div><div className="archive-finder-controls archive-class-search"><label><Search size={16} /><input value={classArchiveSearch} onChange={event => setClassArchiveSearch(event.target.value)} placeholder="搜索班级名称或课程" aria-label="搜索班级名称或课程" /></label></div><div className="archive-student-results class-archive-results">{classArchiveMatches.length ? classArchiveMatches.map(item => <button key={item.id} className={selectedArchiveClass === item.name ? 'active' : ''} onClick={() => setSelectedArchiveClass(item.name)}><span className="class-result-icon"><Users size={14} /></span><span><b>{item.name}</b><small>{item.course} · {item.schedule}</small></span>{selectedArchiveClass === item.name ? <em>正在查看</em> : null}</button>) : <p>没有找到匹配的班级，请调整搜索内容。</p>}</div></section>
    <div className="archive-overview-grid"><article><Users /><b>{activeArchiveClass ? classRoster(activeArchiveClass).length : 0}</b><span>当前班级在册学员</span></article><article><Archive /><b>{records.filter(record => classRoster(activeArchiveClass || {}).some(item => item.name === record.student)).length}</b><span>已归档课后记录</span></article><article><Image /><b>{activeArchiveClass?.course || '—'}</b><span>当前班级课程类型</span></article></div>
    <div className="archive-overview-note"><Users /><div><b>班级档案会随个人成品归档同步更新</b><p>每次完成课后反馈后，处理过的作品、照片和点评会自动汇入对应班级的成长记录。</p></div></div>
  </section>;

  const content = section === '学员管理' ? studentManagement : section === '班级管理' ? classManagement : section === '个人成长档案' ? personalArchive : classArchive;

  return <section className="management-hub archive-data-live">
    <header className="management-hub-head"><div><span>学员管理</span><h1>让学员、班级与成长记录始终清晰相连</h1><p>从新生建档、班级编排到个人与班级成长档案，都在一个入口完成。</p></div></header>
    <nav className="management-section-nav">{['学员管理', '班级管理', '个人成长档案', '班级成长档案'].map(name => <button key={name} className={section === name ? 'active' : ''} onClick={() => setSection(name)}>{name}</button>)}</nav>
    {content}
    {dialog?.mode === 'parent-binding' ? <ParentBindingDialog student={activeStudent} onClose={() => setDialog(null)} onSave={saveParentBinding} onRevoke={revokeParentBinding} /> : null}
    {dialog && dialog.mode !== 'parent-binding' ? <div className="student-create-dialog" role="dialog" aria-modal="true" aria-labelledby="management-dialog-title"><section><button className="dialog-close" aria-label="关闭" onClick={() => setDialog(null)}><X size={18} /></button>{dialog.mode === 'create-student' ? <><span>新学员入档</span><h2 id="management-dialog-title">先为孩子建立一份成长档案</h2><p>填完基础信息后，即可在课后反馈里选择这位孩子。</p><label>孩子姓名 <em>必填</em><input autoFocus value={studentDraft.name} onChange={event => setStudentDraft(current => ({ ...current, name: event.target.value }))} placeholder="例如：王小雨" /></label><label>所在班级<select value={studentDraft.className} onChange={event => setStudentDraft(current => ({ ...current, className: event.target.value }))}>{classes.map(item => <option key={item.id}>{item.name}</option>)}</select></label><label>出生日期<input type="date" value={studentDraft.birthDate} onChange={event => setStudentDraft(current => ({ ...current, birthDate: event.target.value }))} /></label><label>家长联系方式<input type="tel" value={studentDraft.guardianPhone} onChange={event => setStudentDraft(current => ({ ...current, guardianPhone: event.target.value }))} placeholder="用于课后反馈沟通" /></label><label>家长期待<textarea value={studentDraft.expect} onChange={event => setStudentDraft(current => ({ ...current, expect: event.target.value }))} placeholder="例如：希望孩子更自信地表达自己的想法" /></label><div className="dialog-actions"><button onClick={() => setDialog(null)}>取消</button><button className="primary" onClick={createStudent}><Plus size={16} />建立档案</button></div></> : <><span>{dialog.mode === 'edit-class' ? '编辑班级' : '新建班级'}</span><h2 id="management-dialog-title">{dialog.mode === 'edit-class' ? '调整班级信息' : '建立一个新的班级'}</h2><p>班级名称、课程、上课时间和任课老师会显示在班级管理中。</p><label>班级名称 <em>必填</em><input autoFocus value={classDraft.name} onChange={event => setClassDraft(current => ({ ...current, name: event.target.value }))} placeholder="例如：周三创意绘画 1 班" /></label><label>课程类型<select value={classDraft.course} onChange={event => setClassDraft(current => ({ ...current, course: event.target.value }))}><option>创意绘画</option><option>色彩启蒙</option><option>线描与造型</option><option>综合材料</option></select></label><label>上课时间<input value={classDraft.schedule} onChange={event => setClassDraft(current => ({ ...current, schedule: event.target.value }))} placeholder="例如：每周三 17:00–18:30" /></label><label>任课老师<input value={classDraft.teacher} onChange={event => setClassDraft(current => ({ ...current, teacher: event.target.value }))} /></label><label>班级容量<input type="number" min="1" value={classDraft.capacity} onChange={event => setClassDraft(current => ({ ...current, capacity: Number(event.target.value) }))} /></label><div className="dialog-actions"><button onClick={() => setDialog(null)}>取消</button><button className="primary" onClick={saveClass}>{dialog.mode === 'edit-class' ? '保存修改' : <><Plus size={16} />新建班级</>}</button></div></>}</section></div> : null}
  </section>;
}
