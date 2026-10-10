import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Archive, ArrowLeft, ArrowRight, Bell, BookOpen, Boxes, Check, ChevronDown,
  CircleAlert, CircleCheck, Clock3, Download, FileText, Film, FolderOpen, Frame,
  GraduationCap, Image, Landmark, LayoutDashboard, LogOut, Menu, MessageSquareText, MoreHorizontal,
  Package, PanelLeftClose, Plus, RefreshCw, RotateCcw, RotateCw, Search, Settings, ShieldCheck, Sparkles,
  Store, Trash2, UploadCloud, UserRound, Users, Video, WandSparkles, X, Zap
} from 'lucide-react';
import './styles.css';
import './brand-yellow.css';
import './focus-workspace.css';
import './upload-flow.css';
import './teacher-flow.css';
import './review-gallery.css';
import './archive-studio.css';
import './archive-enhancements.css';
import './review-vertical.css';
import './teacher-welcome.css';
import './welcome-simple.css';
import './welcome-art-direction.css';
import './welcome-finish.css';
import './welcome-responsive-import.css';
import './teacher-typography.css';
import './growth-report.css';
import './flow-v2.css';
import './premium-framing.css';
import './p0-local-draft.css';
import './review-compact.css';
import './persona-framing.css';
import './gallery/gallery.css';
import pandaMascot from './assets/panda-gold-hero.png';
import pandaObserve from './assets/panda-gold-observe.png';
import pandaWave from './assets/panda-poses/01-wave-paintbrush.png';
import { createFeedbackRecord, loadFeedbackRecords, persistFeedbackRecords } from './data/feedbackRecords';
import { createParentSession, loadParentFeedbackRecords, loadRemoteFeedbackRecords, saveRemoteFeedbackRecords } from './services/feedbackRecordsApi';
import { loadStudentManagement } from './data/studentManagement';
import StudentArchiveData from './StudentArchiveData';
import GrowthArchiveData from './GrowthArchiveData';
import { requestAiReview, uploadControlledMedia } from './services/reviewApi';
import { ARTWORK_CLEAN_ALGORITHM, createExhibitionFrame, createPortraitPrint, extractArtworkSurface, renderFramedArtwork, rotateArtworkOriginal } from './services/framing';
import { createEmptyTeacherProfile, loadTeacherProfiles, persistTeacherProfiles } from './data/teacherProfiles';
import { deleteRemoteTeacherProfile, loadRemoteTeacherProfiles, saveRemoteTeacherProfile } from './services/teacherProfileApi';
import { createEmptySkill, loadSkillLibrary, persistSkillLibrary, resolveSkills, skillFromIndexEntry, skillFromPackage } from './data/skillLibrary';
import { deleteRemoteSkill, loadRemoteSkillLibrary, saveRemoteSkill } from './services/skillLibraryApi';
import { archiveSkillPackage, readSkillPackage } from './services/skillPackage';
import { MARKETPLACE_SYNCED_AT, indexStats, marketCategories, searchMarket, searchSkillIndex } from './data/skillMarketplace';
import { createEmptyFramingPreset, loadFramingPresets, persistFramingPresets } from './data/framingPresets';
import { deleteRemoteFramingPreset, loadRemoteFramingPresets, saveRemoteFramingPreset } from './services/framingPresetsApi';
import { DEFAULT_FRAME_SPEC, generateFrameSpec, normalizeFrameSpec } from './services/frameSpec';
import { REVIEW_MODEL, describeReviewError, readableFromRawJson, streamArtworkReview } from './services/llmReview';
import { keywordCandidatesPrompt, keywordCategoriesFor, keywordOptionsFor, orderKeywords, pickSupportedKeywords } from './data/reviewKeywords';
// 三个基础展示原语抽到 ui.jsx，3D 画廊页与主文件共用同一份
import { Button, PageHeader, Status } from './ui';
import { hydrateGalleryExhibitions, hydrateGalleryVenues, loadGalleryExhibitions, loadGalleryVenues, persistGalleryExhibitions, persistGalleryVenues } from './data/galleryVenues';
import { loadRemoteGalleryExhibitions, loadRemoteGalleryVenues } from './services/galleryVenuesApi';
// 课次（lesson）是后续四步流程的唯一上下文实体：本地兜底 + 云端 lessons 表为真源。
import { loadLessons, persistLessons } from './data/lessons';
import { loadRemoteLessons } from './services/lessonApi';
// 课程库（course）是课题的来源：课次上的 courseId 指向一门课程，课题按课时序号从 syllabus 取。
import { loadCourses, persistCourses } from './data/courses';
import { loadRemoteCourses } from './services/courseApi';
import GalleryPage from './gallery/GalleryPage';
import GalleryAdminPage from './gallery/GalleryAdminPage';
// 课程库（US-402b）：管理员维护课程与分课时课题，是老师端选课与课次推荐课题的来源。
import CourseLibraryPage from './admin/CourseLibraryPage';

// 五个维度各自的留空提示语 —— 只说明「这一维该看什么」，不预填任何成句的点评。
const REVIEW_DIMENSION_HINTS = {
  美术能力: '等待大模型读取作品后生成：画面里能指认的色彩、构图、造型或材料使用。',
  上课状态: '等待大模型依据课堂素材生成：投入、停顿后是否回到画面、是否主动补充细节。',
  行为能力: '等待大模型依据课堂素材生成：任务理解、表达、协作或整理等可观察行为。',
  内在状态: '等待大模型生成：本次课堂中可观察到的表达与变化，不作心理诊断。',
  家长建议: '等待大模型生成：1—3 条与本次观察有关、家长今晚就能尝试的具体行动。'
};

const PRD = {
  auth: 'PRD-7.1 / F-ID-01', dashboard: 'PRD-5 / F-PORTAL-01', lessons: 'PRD-7 / F-FEEDBACK-01',
  create: 'PRD-7 / F-FEEDBACK-02', ai: 'PRD-4 / F-AI-01', tasks: 'PRD-10 / F-AI-02',
  classes: 'PRD-2 / F-ORG-01', archives: 'PRD-12 / F-ARCHIVE-01', parent: 'PRD-5 / F-PARENT-01',
  apps: 'PRD-11 / F-APP-01', providers: 'PRD-9 / F-MODEL-01', users: 'PRD-2 / F-RBAC-01',
  logs: 'PRD-6 / F-LOG-01', archiveAdmin: 'PRD-14 / F-ARCHIVE-ADM-01', permissions: 'PRD-2.1 / F-RBAC-02',
  guide: 'PRD-4~17 / PROTOTYPE-MAP'
};
const roleMeta = {
  teacher: { label: '老师', name: '林晓老师', campus: '星河校区' },
  parent: { label: '家长', name: '陈一诺妈妈', campus: '家长端' },
  admin: { label: '管理员', name: '平台管理员', campus: '平台总部' }
};

const navByRole = {
  // 老师人设与技能库是机构级基础数据，只有管理员能维护；
  // 老师只能在「课后反馈」里只读选用人设来生成点评，看不到这两个维护入口。
  teacher: [
    ['dashboard','课后反馈工作台',LayoutDashboard], ['teacherFlow','课后反馈',WandSparkles], ['ai','AI助手',WandSparkles],
    ['classes','学员管理',Users], ['growthCenter','个人成长中心',BookOpen], ['progress','进度看板',Clock3],
    ['gallery','3D 画廊',Landmark]
  ],
  parent: [['parent','首页',LayoutDashboard],['parentInsight','作品观察',Sparkles],['parentArchive','成长档案',Archive],['gallery','3D 画廊',Landmark],['growthCenter','个人成长中心',BookOpen],['authorization','授权管理',ShieldCheck],['profile','个人中心',UserRound]],
  admin: [['adminDash','运营总览',LayoutDashboard],['apps','应用中心',Boxes],['providers','模型供应商',Zap],['teacherPersona','老师人设',GraduationCap],['skillLibrary','技能库',Boxes],['courseLibrary','课程库',BookOpen],['framingSettings','装裱设置',Frame],['galleryAdmin','3D 画廊',Landmark],['users','用户管理',Users],['logs','生成日志',FileText],['archiveAdmin','档案管理',Archive],['permissions','权限设置',ShieldCheck],['settings','系统配置',Settings]]
};

const aiAppsSeed = [
  {id:'frame',name:'作品智能装裱',desc:'自动校正、去背景并匹配画框场景',icon:Frame,color:'blue',status:'enabled',version:'2.4.1'},
  {id:'photo',name:'照片美化',desc:'自然优化课堂人像、光线与构图',icon:Image,color:'coral',status:'enabled',version:'1.8.0'},
  {id:'review',name:'AI 智能点评',desc:'生成个人与班级长短版点评',icon:MessageSquareText,color:'green',status:'enabled',version:'3.1.2'},
  {id:'video',name:'AI 生视频',desc:'课堂剪辑、字幕、配乐与图生视频',icon:Film,color:'yellow',status:'enabled',version:'1.5.0'}
];

const taskSeed = [
  {id:'T-0824',title:'向日葵主题课 · 作品装裱',student:'陈一诺等 18 人',app:'作品智能装裱',model:'VisionArt Pro',status:'成功',time:'3 分 24 秒'},
  {id:'T-0823',title:'色彩启蒙班 · 个人点评',student:'林小满等 12 人',app:'AI 智能点评',model:'Qwen Text Max',status:'成功',time:'48 秒'},
  {id:'T-0822',title:'水彩风景课 · 课堂视频',student:'周六 2 班',app:'AI 生视频',model:'Seedance 2',status:'生成中',time:'68%'},
  {id:'T-0821',title:'创意线描 · 照片美化',student:'小艺术家班',app:'照片美化',model:'VisionArt Edit',status:'部分成功',time:'29/30'}
];

const mergeFeedbackRecords = (localRecords, remoteRecords) => {
  const byId = new Map(remoteRecords.map(record => [record.id, record]));
  localRecords.forEach(record => {
    const remote = byId.get(record.id);
    byId.set(record.id, remote ? { ...remote, ...record, reviews: { ...remote.reviews, ...record.reviews } } : record);
  });
  return [...byId.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
};

function App(){
  const [auth,setAuth]=useState(false), [authMode,setAuthMode]=useState('login'), [role,setRole]=useState('teacher');
  const [parentStudent,setParentStudent]=useState(''),[parentStudents,setParentStudents]=useState([]),[parentPhone,setParentPhone]=useState(''),[parentSession,setParentSession]=useState('');
  const [page,setPage]=useState('dashboard'), [mobileNav,setMobileNav]=useState(false), [toast,setToast]=useState('');
  const [modal,setModal]=useState(null), [apps,setApps]=useState(aiAppsSeed), [tasks,setTasks]=useState(taskSeed), [records,setRecords]=useState(loadFeedbackRecords);
  const [recordsRemoteReady,setRecordsRemoteReady]=useState(false);
  // 老师人设（含技能库与大模型记忆）和装裱预设都以云端表为准，本地只做兜底。
  const [teacherProfiles,setTeacherProfiles]=useState(loadTeacherProfiles);
  const [framingPresets,setFramingPresets]=useState(loadFramingPresets);
  // 技能库是与人设分开维护的基础数据，人设只持有被勾选的 id。
  const [skillLibrary,setSkillLibrary]=useState(loadSkillLibrary);
  // 3D 画廊：展厅地点（实景图 + 重建参数）与画展（作品清单），同样以云端表为准。
  const [galleryVenues,setGalleryVenues]=useState(loadGalleryVenues);
  const [galleryExhibitions,setGalleryExhibitions]=useState(loadGalleryExhibitions);
  // 课次列表：云端 lessons 表为真源，本地只做兜底；下游四步流程都从这里取上下文。
  const [lessons,setLessons]=useState(loadLessons);
  // 课程库：云端 courses 表为真源，本地只做兜底；课次课题与班级选课都从这里取。
  const [courses,setCourses]=useState(loadCourses);
  const [flow,setFlow]=useState({step:1,classId:'',students:[],files:[],apps:['frame','review'],tone:'温暖专业',generateState:'idle',published:false});
  const [demoState,setDemoState]=useState('normal');
  useEffect(()=>{ if(toast){const t=setTimeout(()=>setToast(''),2600); return()=>clearTimeout(t)}},[toast]);
  useEffect(()=>{let active=true;loadRemoteFeedbackRecords().then(remote=>{if(!active)return;setRecords(current=>mergeFeedbackRecords(current,remote));setRecordsRemoteReady(true);}).catch(()=>{});return()=>{active=false}},[]);
  useEffect(()=>{persistFeedbackRecords(records);if(recordsRemoteReady)void saveRemoteFeedbackRecords(records).catch(()=>{});},[records,recordsRemoteReady]);
  useEffect(()=>{persistTeacherProfiles(teacherProfiles)},[teacherProfiles]);
  useEffect(()=>{persistFramingPresets(framingPresets)},[framingPresets]);
  useEffect(()=>{persistSkillLibrary(skillLibrary)},[skillLibrary]);
  useEffect(()=>{persistGalleryVenues(galleryVenues)},[galleryVenues]);
  useEffect(()=>{persistGalleryExhibitions(galleryExhibitions)},[galleryExhibitions]);
  useEffect(()=>{persistLessons(lessons)},[lessons]);
  useEffect(()=>{persistCourses(courses)},[courses]);
  useEffect(()=>{let active=true;
    loadRemoteTeacherProfiles().then(remote=>{if(active&&remote.length)setTeacherProfiles(remote)}).catch(()=>{});
    loadRemoteFramingPresets().then(remote=>{if(active&&remote.length)setFramingPresets(remote)}).catch(()=>{});
    loadRemoteSkillLibrary().then(remote=>{if(active&&remote.length)setSkillLibrary(remote)}).catch(()=>{});
    // 画廊这两个必须过 hydrate：内置展厅的实景图不进库，云端那条回来是没图的，
    // 直接 setState 顶掉会让内置展厅变成"没有实景图"。
    loadRemoteGalleryVenues().then(remote=>{if(active&&remote.length)setGalleryVenues(hydrateGalleryVenues(remote))}).catch(()=>{});
    loadRemoteGalleryExhibitions().then(remote=>{if(active&&remote.length)setGalleryExhibitions(hydrateGalleryExhibitions(remote))}).catch(()=>{});
    // 课次：云端不可用时保留本地兜底数据，不把列表清空。
    loadRemoteLessons().then(remote=>{if(active&&remote.length)setLessons(remote)}).catch(()=>{});
    // 课程库：同上；云端返回全部课程（含停用），可选性由 selectableCourses 判断。
    loadRemoteCourses().then(remote=>{if(active&&remote.length)setCourses(remote)}).catch(()=>{});
    return()=>{active=false};
  },[]);
  const navigate=(p)=>{setPage(p);setMobileNav(false);window.scrollTo(0,0)};
  const login=async(nextRole, phone='', code='')=>{
    if(nextRole==='parent'&&phone!=='demo'){
      try{const session=await createParentSession(phone,code);setParentStudents(session.studentNames);setParentStudent(session.studentNames[0]);setParentPhone(phone);setParentSession(session.token);}catch(error){setToast(error.message||'家长登录失败，请稍后重试。');return false;}
    }
    if(nextRole==='parent'&&phone==='demo'){const demoStudents=loadStudentManagement().students.filter(item=>item.guardianName);setParentStudents(demoStudents.map(item=>item.name));setParentStudent(demoStudents[0]?.name||'');setParentPhone('');setParentSession('');}
    setRole(nextRole);setAuth(true);setPage(nextRole==='teacher'?'dashboard':nextRole==='parent'?'parent':'adminDash');setToast(`已进入${roleMeta[nextRole].label}体验`);return true;
  };
  if(!auth) return <AuthScreen mode={authMode} setMode={setAuthMode} onLogin={login}/>;
  return <div className="app">
    <Sidebar role={role} page={page} nav={navByRole[role]} onNav={navigate} open={mobileNav} close={()=>setMobileNav(false)}/>
    <main className="main">
      <Topbar role={role} onMenu={()=>setMobileNav(true)} onSwitch={(r)=>login(r,'demo')} onGuide={()=>navigate('guide')} onLogout={()=>setAuth(false)}/>
      <div className="content">
        <PageRouter {...{page,role,navigate,setToast,setModal,apps,setApps,tasks,setTasks,flow,setFlow,demoState,setDemoState,records,setRecords,parentStudent,parentStudents,parentPhone,parentSession,setParentStudent,teacherProfiles,setTeacherProfiles,framingPresets,setFramingPresets,skillLibrary,setSkillLibrary,galleryVenues,setGalleryVenues,galleryExhibitions,setGalleryExhibitions,lessons,setLessons,courses,setCourses}}/>
      </div>
    </main>
    {toast?<div className="toast panda-toast"><img src={pandaWave} alt="熊猫鼓励"/><span><CircleCheck size={18}/>{toast}</span></div>:null}
    {modal?<Modal type={modal} close={()=>setModal(null)} {...{setToast,apps,setApps}}/>:null}
  </div>
}

function AuthScreen({mode,setMode,onLogin}){
  const [mobile,setMobile]=useState(''),[code,setCode]=useState(''),[agree,setAgree]=useState(false),[err,setErr]=useState(''),[loginRole,setLoginRole]=useState('teacher');
  const submit=async(e)=>{e.preventDefault();if(!/^1\d{10}$/.test(mobile))return setErr('请输入正确的 11 位手机号');if(code.length<4)return setErr('请输入验证码');if(!agree)return setErr('请先同意服务协议与隐私政策');setErr('');const accepted=await onLogin(mode==='register'?'teacher':loginRole,mobile,code);if(!accepted)setErr('该手机号尚未绑定孩子档案，请联系老师完成家长端绑定。');};
  return <div className="auth-shell">
    <section className="auth-story">
      <div className="brand brand-light"><span className="brand-mark"><Sparkles/></span><b>昕乐绘</b></div>
      <div className="auth-art">
        <div className="paper paper-a"><span>今天的作品</span><div className="sunflower">✦</div></div>
        <div className="paper paper-b"><span>成长，从每一次表达开始</span><div className="scribble">◌ ◒ ◍</div></div>
        <img className="auth-panda" src={pandaMascot} alt="昕乐绘熊猫艺术导师"/>
      </div>
      <div><h1>让每一份童画<br/>都有专业的回应</h1><p>作品装裱、照片美化、视频剪辑、智能点评和成长档案，在一个工作流里完成。</p></div>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <div className="mobile-brand"><span className="brand-mark"><Sparkles/></span><b>昕乐绘</b></div>
        <h2>{mode==='login'?'欢迎回来':'创建老师账号'}</h2><p className="muted">{mode==='login'?(loginRole==='teacher'?'登录后继续完成今天的课后反馈':'登录后查看孩子专属的成长档案'):'首版通过管理员邀请加入机构'}</p>
        {mode==='login'?<div className="auth-role-choice" aria-label="选择登录身份"><button type="button" className={loginRole==='teacher'?'active':''} onClick={()=>setLoginRole('teacher')}>我是老师</button><button type="button" className={loginRole==='parent'?'active':''} onClick={()=>setLoginRole('parent')}>我是家长</button></div>:null}
        <form onSubmit={submit}>
          <label>手机号<input value={mobile} onChange={e=>setMobile(e.target.value)} placeholder="请输入手机号" maxLength={11}/></label>
          <label>验证码<div className="inline-input"><input value={code} onChange={e=>setCode(e.target.value)} placeholder="请输入验证码"/><button type="button" className="text-btn" onClick={()=>setErr('验证码已发送（原型模拟）')}>获取验证码</button></div></label>
          {mode==='register'?<label>机构邀请码<input placeholder="例如：XLH-2026"/></label>:null}
          <label className="check"><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)}/><span>我已阅读并同意《服务协议》《隐私政策》及未成年人信息处理说明</span></label>
          {err?<div className="form-error"><CircleAlert size={16}/>{err}</div>:null}
          <button className="primary wide" type="submit">{mode==='login'?'登录':'注册并加入机构'}<ArrowRight size={18}/></button>
        </form>
        <button className="auth-toggle" onClick={()=>{setMode(mode==='login'?'register':'login');setErr('')}}>{mode==='login'?'没有账号？申请注册':'已有账号？返回登录'}</button>
        <div className="demo-logins"><span>快速体验</span><div><button onClick={()=>onLogin('teacher','demo')}>老师</button><button onClick={()=>onLogin('parent','demo')}>家长</button><button onClick={()=>onLogin('admin','demo')}>管理员</button></div></div>
        <small className="prd-tag">{PRD.auth}</small>
      </div>
    </section>
  </div>
}

function Sidebar({role,page,nav,onNav,open,close}){
 return <><aside className={`sidebar ${open?'open':''}`}>
  <div className="brand"><span className="brand-mark"><Sparkles/></span><b>昕乐绘</b><button className="sidebar-close" onClick={close}><X/></button></div>
  <div className="workspace"><span>{roleMeta[role].campus}</span><ChevronDown size={15}/></div>
  <nav>{nav.map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>onNav(id)}><Icon size={19}/><span>{label}</span></button>)}</nav>
  <div className="sidebar-foot"><div className="quota"><div><span>本月 AI 用量</span><b>68%</b></div><div className="progress"><i style={{width:'68%'}}/></div><small>6,820 / 10,000 点</small></div><button onClick={()=>onNav('guide')}><BookOpen size={18}/>原型导览</button></div>
 </aside>{open?<div className="scrim" onClick={close}/>:null}</>
}

function Topbar({role,onMenu,onSwitch,onGuide,onLogout}){
 const [open,setOpen]=useState(false);
 return <header className="topbar"><button className="mobile-menu" onClick={onMenu}><Menu/></button><div className="top-search"><Search size={17}/><input placeholder="搜索班级、学员、任务或档案"/></div><div className="top-actions"><button className="icon-btn" title="通知"><Bell size={19}/><i/></button><div className="role-switch"><button onClick={()=>setOpen(!open)}><span className="avatar">{roleMeta[role].name[0]}</span><span><b>{roleMeta[role].name}</b><small>{roleMeta[role].label}</small></span><ChevronDown size={15}/></button>{open?<div className="role-menu"><span>切换体验身份</span>{Object.entries(roleMeta).map(([k,v])=><button key={k} onClick={()=>{onSwitch(k);setOpen(false)}} className={k===role?'selected':''}>{v.label}<small>{v.name}</small></button>)}<hr/><button onClick={onGuide}>查看页面导览</button><button onClick={onLogout}><LogOut size={15}/>退出登录</button></div>:null}</div></div></header>
}

function Stat({label,value,delta,icon:Icon,tone='blue'}){return <div className="stat"><span className={`stat-icon ${tone}`}><Icon size={20}/></span><div><span>{label}</span><b>{value}</b><small>{delta}</small></div></div>}

function TeacherFlow({setToast}){const [step,setStep]=useState(1);const [mode,setMode]=useState('个人反馈');const [subject,setSubject]=useState('通用美术');const [style,setStyle]=useState('星光展');const [saved,setSaved]=useState(false);const next=()=>setStep(x=>x+1);return <><PageHeader title="课后反馈" desc={step===1?'先创建本次课后反馈。':step===2?'完成作品、照片和视频的智能呈现。':step===3?'基于本节课素材，完成有依据的五维点评。':'成长已被记录。'} prd="课后反馈工作流"/><div className="flow-steps"><b className={step===1?'on':''}>1 创建信息</b><i/><b className={step===2?'on':''}>2 智能装裱</b><i/><b className={step===3?'on':''}>3 五维点评</b><i/><b className={step===4?'on':''}>4 归档转发</b></div>{step===1?<section className="single-task"><div className="task-title"><span>第一步</span><h2>创建课后反馈信息</h2><p>选择对象后，同时上传作品、照片和课堂视频。</p></div><div className="feedback-mode"><button className={mode==='个人反馈'?'selected':''} onClick={()=>setMode('个人反馈')}>个人反馈<small>为一位孩子制作</small></button><button className={mode==='班级反馈'?'selected':''} onClick={()=>setMode('班级反馈')}>班级反馈<small>可批量处理多位学员</small></button></div><div className="task-form"><label>选择班级<select><option>周六创意绘画 2 班</option><option>素描基础班</option><option>水彩启蒙 1 班</option></select></label><label>选择学员<select><option>{mode==='个人反馈'?'陈一诺':'本班全部学员（18人）'}</option><option>陈一诺、林小满、周子乐</option></select></label></div><div className="sync-upload"><div><Frame/><b>学员作品 <em>必选</em></b><small>{mode==='个人反馈'?'上传 1 幅作品':'支持按学员批量上传'}</small><button onClick={()=>setToast('作品已添加（演示）')}>上传作品</button></div><div><Image/><b>学员照片 <em>选填</em></b><small>课堂人物照片，可批量上传</small><button onClick={()=>setToast('照片已添加（演示）')}>上传照片</button></div><div><Video/><b>上课视频 <em>选填</em></b><small>课堂片段，可批量上传</small><button onClick={()=>setToast('视频已添加（演示）')}>上传视频</button></div></div><div className="task-action"><Button icon={ArrowRight} onClick={next}>创建信息，进入智能装裱</Button></div></section>:step===2?<section className="single-task studio-task"><div className="task-title"><span>第二步</span><h2>智能装裱</h2><p>作品、人物照片与课堂视频在这里分别完成处理。</p></div><div className="media-process"><article><div className={`mini-frame ${style==='自然原木'?'oak':style==='东方雅境'?'ink':''}`}>✺</div><div><b>学员作品</b><p>智能校正光影、去除背景，生成展览级装裱。</p><div className="tiny-choice">{['星光展','自然原木','东方雅境'].map(x=><button key={x} className={style===x?'active':''} onClick={()=>setStyle(x)}>{x}</button>)}</div></div></article><article><div className="photo-card"><img src={pandaMascot} alt="课堂人物美化"/></div><div><b>学员照片</b><p>自然优化光线、肤色与构图，不改变孩子真实面貌。</p><button className="small-action" onClick={()=>setToast('人物照片已自然美化（演示）')}>一键人物 P 图</button></div></article><article><div className="video-card"><Film/></div><div><b>上课视频</b><p>自动选取高光片段，生成一支温暖的课堂短片。</p><button className="small-action" onClick={()=>setToast('课堂视频已开始一键剪辑（演示）')}>一键剪辑</button></div></article></div><div className="task-action"><Button variant="secondary" onClick={()=>setStep(1)}>返回修改</Button><Button icon={ArrowRight} onClick={next}>装裱完成，进入五维点评</Button></div></section>:step===3?<section className="review-task"><div className="review-media"><div className="task-title"><span>本次课素材</span><h2>陈一诺 · 《向着光的花》</h2></div><div className="review-gallery"><div className="review-art">✺</div><div className="review-photo"><img src={pandaMascot} alt="课堂照片"/></div><div className="review-video"><Film/><span>课堂高光 00:38</span></div></div></div><div className="coach-review"><div className="focus-head"><div><span>第三步</span><h2>五维点评</h2></div><select value={subject} onChange={e=>setSubject(e.target.value)}><option>通用美术</option><option>创意绘画（3-6岁）</option><option>儿童画（6-9岁）</option><option>素描（9-18岁）</option><option>速写（9-18岁）</option><option>水彩 / 水粉（7-18岁）</option><option>国画（6-18岁）</option><option>漫画 / 动画（8-18岁）</option></select></div><p className="evidence">以下内容仅依据本次作品、课堂照片与视频生成；老师可编辑后发布。</p>{[['美术能力','作品使用黄、蓝两种主色形成清晰冷暖对比；向上延伸的花瓣线条表现出稳定的造型控制。'],['上课状态','视频片段中，她能持续投入创作，并在老师提示后继续补充花瓣细节。'],['行为能力','课堂中主动分享“花想把光送给妈妈”，表达清楚，也能等待同伴完成。'],['内在状态','明亮的色彩和向上构图呈现出积极、开放的表达倾向；这不是心理诊断。'],['家长建议','今晚请先欣赏再提问： “这朵花今天想把光送给谁？” 让孩子继续讲自己的故事。']].map(([a,b])=><article className="coach-card" key={a}><b>{a}</b><p>{b}</p></article>)}<div className="task-action"><Button icon={Archive} onClick={()=>{setSaved(true);next();setToast('点评已归档到成长档案')}}>归档并生成分享</Button></div></div></section>:<section className="share-task"><img src={pandaObserve} alt="熊猫艺术导师"/><div><span>已归档至陈一诺的成长档案</span><h2>这一次的成长，<br/>已经被完整记录。</h2><p>作品、课堂照片、视频与五维点评已经同步保存。</p><div className="share-actions"><Button icon={Archive} onClick={()=>setToast('成长集锦制作中')}>制作成长集锦</Button><Button variant="secondary" icon={Frame} onClick={()=>setToast('个人作品集制作中')}>制作个人作品集</Button><Button variant="secondary" icon={MessageSquareText} onClick={()=>setToast('家长分享链接已生成')}>一键转发给家长</Button></div></div></section>}</>}

function ArchiveStudio({setToast}){const [kind,setKind]=useState('个人');const [view,setView]=useState('阶段报告');return <><PageHeader title="成长档案" desc="选择一位孩子或一个班级，生成可回看的成长成果。" prd={PRD.archives}/><section className="archive-studio"><div className="archive-filter"><div className="mode-switch"><button className={kind==='个人'?'active':''} onClick={()=>setKind('个人')}>个人档案</button><button className={kind==='班级'?'active':''} onClick={()=>setKind('班级')}>班级档案</button></div><select><option>{kind==='个人'?'陈一诺 · 7岁':'周六创意绘画 2 班'}</option><option>{kind==='个人'?'林小满 · 8岁':'素描基础班'}</option></select><small>{kind==='个人'?'已记录 18 次课程 · 42 幅作品':'AI 将从前、中、后三个阶段精选作品，并生成班级与个人总结'}</small></div><div className="archive-types">{[['阶段报告',FileText,'作品、照片、点评与阶段总结'],['视频集锦',Film,'一个学期的温馨视频记录'],['作品展览',Frame,'AI 美术馆展厅效果']].map(([name,Icon,desc])=><button key={name} className={view===name?'active':''} onClick={()=>setView(name)}><Icon/><b>{name}</b><small>{desc}</small></button>)}</div>{view==='阶段报告'?<div className="report-view"><div className="report-cover"><div className="report-art">✺</div><b>{kind==='个人'?'陈一诺':'周六创意绘画 2 班'} · 阶段成长报告</b></div><div className="report-copy"><h2>把一次次表达，连成清晰的成长。</h2><div className="report-grid">{[['美术能力','能稳定使用冷暖对比，画面层次更丰富。'],['行为表现','主动表达想法，也更能倾听和协作。'],['本学期进步点','从“完成作品”走向“讲述自己的作品”。'],['下学期学习规划','继续色彩训练，增加构图与观察练习。'],['老师寄语','愿你一直保留这份敢于表达、愿意探索的光。']].map(([a,b])=><article key={a}><b>{a}</b><p>{b}</p></article>)}</div><Button icon={FileText} onClick={()=>setToast('阶段报告已生成')}>生成阶段报告</Button></div></div>:view==='视频集锦'?<div className="video-album"><div className="semester-video"><Film/><span>2026 春季 · 成长影像</span><i>00:58</i></div><div><h2>一学期的认真，值得被温柔回看。</h2><p>AI 从课堂视频中选取专注创作、分享表达、与同伴互动的片段，串联为一支温馨视频，结尾附上老师寄语。</p><blockquote>“愿你在每一次落笔里，都更靠近真实的自己。”</blockquote><Button icon={Film} onClick={()=>setToast('视频集锦开始生成')}>生成视频集锦</Button></div></div>:<div className="museum-exhibit"><div className="museum-wall"><div className="exhibit-frame">✺</div><div className="exhibit-frame small">✹</div><div className="exhibit-frame small">●</div></div><div><h2>走进属于孩子的美术馆。</h2><p>{kind==='个人'?'AI 将孩子的作品转为个人线上展览。':'精选班级前、中、后三个阶段作品，生成一场班级艺术展，并附每位孩子的成长总结。'}</p><Button icon={Frame} onClick={()=>setToast('美术馆展览开始生成')}>生成美术馆展览</Button></div></div>}</section></>}
function ProgressBoard({tasks}){return <><PageHeader title="进度看板" desc="上方查阅个人与班级课后反馈；下方追踪所有 AI 生成任务。" prd={PRD.tasks}/><section className="progress-summary"><div><span>课后反馈</span><h2>今天已完成 6 份</h2><p>个人反馈 4 份 · 班级反馈 2 份</p><button>查看反馈记录 <ArrowRight size={14}/></button></div><div className="today-inline"><b>今日待办</b><span>3 项</span><p>14:30 周六创意绘画 2 班 · 待完成班级反馈</p><button>展开待办</button></div></section><TaskTable tasks={tasks} title="生成任务进度" onView={()=>{}}/></>}
function TeacherWelcome({navigate}){return <section className="teacher-welcome"><div className="welcome-copy"><span>今天，孩子们因为你拥有了一段表达自己的时光。</span><h1>你认真守护的每一次创作，<br/>都在悄悄成为孩子的底气。</h1><p>我们知道，一堂好课的背后，是你观察到的细节、给出的耐心和不轻易放过的每一点闪光。现在，让这些温柔的看见继续陪孩子向前生长。</p><div className="welcome-notes"><article><b>回看今天</b><small>整理课堂里值得被记住的瞬间</small></article><article><b>看见孩子</b><small>把作品、表达与进步好好留下来</small></article></div><Button icon={ArrowRight} onClick={()=>navigate('teacherFlow')}>开始今天的课后反馈</Button></div><div className="welcome-art"><div className="welcome-card card-back">今日的光</div><div className="welcome-card card-front"><img src={pandaWave} alt="熊猫艺术导师"/><b>辛苦了，林晓老师</b><small>让每一次用心，都有温暖的回响</small></div></div></section>}
const COLOR_LANGUAGE=/色彩|颜色|冷暖|明暗|深浅|涂色|色块|主色|辅助色/;

async function inspectArtworkEvidence(source){
  if(!source) return {status:'ready',hasColor:false,visibleMarks:false};
  const image=await new Promise((resolve,reject)=>{const item=new Image();item.onload=()=>resolve(item);item.onerror=reject;item.src=source});
  const maxSide=256;
  const scale=Math.min(1,maxSide/Math.max(image.naturalWidth||1,image.naturalHeight||1));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round((image.naturalWidth||1)*scale));canvas.height=Math.max(1,Math.round((image.naturalHeight||1)*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,canvas.width,canvas.height);
  const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
  let visible=0,colored=0;
  for(let index=0;index<pixels.length;index+=4){const [red,green,blue,alpha]=[pixels[index],pixels[index+1],pixels[index+2],pixels[index+3]];if(alpha<32) continue;const high=Math.max(red,green,blue),low=Math.min(red,green,blue);if(high>238&&low>220) continue;visible++;if(high-low>38&&high>70) colored++;}
  const colorCoverage=visible?colored/visible:0;
  return {status:'ready',hasColor:colorCoverage>=0.07,visibleMarks:visible>40,colorCoverage};
}

function keepArtworkReviewEvidenceBound(review,evidence){
  if(evidence?.hasColor) return review;
  const remaining=String(review||'').split(/(?<=[。；])/).filter(sentence=>!COLOR_LANGUAGE.test(sentence));
  const safe=remaining.join('').trim();
  return safe||'本次作品以可见的线条、形状和画面安排为主要依据。老师会继续围绕孩子已经画出来的部分，陪她观察、补充和表达，不对画面中没有呈现的信息作推测。';
}

function TeacherFlowV2({navigate,setToast,setRecords,framingPresets=[],teacherProfiles=[],skillLibrary=[]}){
  const management=loadStudentManagement();
  const availableClasses=management.classes||[];
  const [selectedClassId,setSelectedClassId]=useState(()=>availableClasses[0]?.id||'');
  const selectedClass=availableClasses.find(item=>item.id===selectedClassId)||availableClasses[0];
  const classStudents=management.students.filter(item=>item.className===selectedClass?.name);
  const [selectedStudentName,setSelectedStudentName]=useState(()=>classStudents[0]?.name||management.students[0]?.name||'');
  const selectedStudent=classStudents.find(item=>item.name===selectedStudentName)||management.students.find(item=>item.name===selectedStudentName)||classStudents[0]||management.students[0];
  const selectedStudentLabel=selectedStudent?.name||'未选择学员';
  const selectedClassLabel=selectedClass?.name||'未选择班级';
  const savedDraft=()=>{try{return JSON.parse(localStorage.getItem('xinlehui-feedback-draft')||'null')}catch{return null}};
  const draft=savedDraft();
  const [step,setStep]=useState(1);
  const [mode,setMode]=useState('个人反馈');
  // frame 存的是云端装裱预设的 id，不再是写死的样式名。
  const [frame,setFrame]=useState('');
  const enabledFrames=framingPresets.filter(item=>item.enabled!==false);
  const activeFrame=enabledFrames.find(item=>item.id===frame)||enabledFrames[0]||null;
  const activeFrameId=activeFrame?.id||'';
  const [subject,setSubject]=useState('通用美术');
  const [media,setMedia]=useState({artwork:null,photo:null});
  const [batchUploads,setBatchUploads]=useState({artwork:[],photo:[]});
  const [uploadState,setUploadState]=useState({artwork:'idle',photo:'idle'});
  const [archived,setArchived]=useState(false);
  // 五维点评的正文默认留空：内容只能来自大模型（人设 + 专业技能 + 记忆）。
  // 留空状态下的提示语只说明这一维要看什么，不预填任何「像点评的句子」。
  const reviewDefaults={
    美术能力:'',
    上课状态:'',
    行为能力:'',
    内在状态:'',
    家长建议:''
  };
  const [reviews,setReviews]=useState(reviewDefaults);
  const [keywords,setKeywords]=useState([]);
  // 大模型识别出的观察词（用于在面板上打「AI」标记）；keywords 是最终生效的集合。
  const [aiKeywords,setAiKeywords]=useState([]);
  const [keywordSuggesting,setKeywordSuggesting]=useState(false);
  const [keywordDirty,setKeywordDirty]=useState(false);
  // 只有点击「使用本地草稿」时才为 true：五维点评正文默认必须来自大模型。
  const [localDraftUsed,setLocalDraftUsed]=useState(false);
  const [framingState,setFramingState]=useState('idle');
  const [reviewState,setReviewState]=useState('idle');
  // 本次点评使用哪个老师人设（人设 + 技能库 + 大模型记忆一起进 system 提示词）。
  const [activeProfileId,setActiveProfileId]=useState('');
  const [reviewStream,setReviewStream]=useState({open:false,phase:'idle',reasoning:'',content:'',message:'',elapsed:0});
  const reviewAbort=useRef(null);
  useEffect(()=>{if(!frame&&activeFrameId)setFrame(activeFrameId)},[frame,activeFrameId]);
  useEffect(()=>{if(!activeProfileId&&teacherProfiles[0])setActiveProfileId(teacherProfiles[0].id)},[activeProfileId,teacherProfiles]);
  useEffect(()=>{if(reviewStream.phase!=='running')return undefined;const timer=setInterval(()=>setReviewStream(current=>current.phase==='running'?{...current,elapsed:current.elapsed+1}:current),1000);return()=>clearInterval(timer)},[reviewStream.phase]);
  const [reviewGenerated,setReviewGenerated]=useState(false);
  const [artworkEvidence,setArtworkEvidence]=useState(null);
  const resolvedArtworkEvidence=artworkEvidence;
  const artworkInput=useRef(null), photoInput=useRef(null);
  const steps=[['创建信息','选择对象并上传素材'],['智能装裱','完成作品与照片的裁剪装裱'],['五维点评','依据素材完成温暖点评'],['归档转发','形成一次完整课后反馈']];
  useEffect(()=>{
    // This compact legacy form is hydrated from the current student registry so
    // a newly created class or student can immediately be selected for feedback.
    const selects=document.querySelectorAll('.feedback-flow-v2 .task-form select');
    const classSelect=selects[0],studentSelect=selects[1];
    if(!classSelect||!studentSelect) return undefined;
    const fillStudents=classId=>{
      const currentClass=availableClasses.find(item=>item.id===classId)||availableClasses[0];
      const children=management.students.filter(item=>item.className===currentClass?.name);
      studentSelect.replaceChildren();
      if(mode==='班级反馈') studentSelect.append(new Option(`本班全部学员（${children.length}人）`,'__class__'));
      else children.forEach(item=>studentSelect.append(new Option(`${item.name}${item.age?` · ${item.age}岁`:''}`,item.name)));
      studentSelect.disabled=mode==='班级反馈';
      studentSelect.value=mode==='班级反馈'?'__class__':(children.some(item=>item.name===selectedStudentName)?selectedStudentName:children[0]?.name||'');
    };
    classSelect.replaceChildren(...availableClasses.map(item=>new Option(item.name,item.id)));
    classSelect.value=selectedClass?.id||availableClasses[0]?.id||'';
    fillStudents(classSelect.value);
    const handleClass=event=>{const nextId=event.target.value;const next=availableClasses.find(item=>item.id===nextId);setSelectedClassId(nextId);setSelectedStudentName(management.students.find(item=>item.className===next?.name)?.name||'');setArchived(false);};
    const handleStudent=event=>{setSelectedStudentName(event.target.value);setArchived(false);};
    classSelect.addEventListener('change',handleClass);
    studentSelect.addEventListener('change',handleStudent);
    return()=>{classSelect.removeEventListener('change',handleClass);studentSelect.removeEventListener('change',handleStudent);};
  });
  useEffect(()=>{
    const portableMedia=Object.fromEntries(Object.entries(media).map(([key,value])=>[key,value?{id:value.id,name:value.name,type:value.type,size:value.size,storage:value.storage}:null]));
    localStorage.setItem('xinlehui-feedback-draft',JSON.stringify({step,media:portableMedia}));
  },[step,media]);
  useEffect(()=>{window.dispatchEvent(new CustomEvent('xinlehui-feedback-step',{detail:step}))},[step]);
  useEffect(()=>{window.__xinlehuiFeedbackMode=mode;window.dispatchEvent(new CustomEvent('xinlehui-feedback-mode',{detail:mode}))},[mode]);
  // 观察词变化不改写 reviewGenerated：正文是老师自己的判断结果，
  // 改词只提示「建议重新生成」，是否重新生成由老师决定（归档不被硬挡）。
  useEffect(()=>{
    const handleKeywords=(event)=>{setKeywords(event.detail);setKeywordDirty(true)};
    window.addEventListener('xinlehui-review-keywords',handleKeywords);
    return()=>window.removeEventListener('xinlehui-review-keywords',handleKeywords);
  },[]);
  useEffect(()=>{
    const source=media.artwork?.cleanUrl||media.artwork?.orientedUrl||media.artwork?.originalUrl;
    if(!source){setArtworkEvidence(null);return;}
    let cancelled=false;
    setArtworkEvidence(null);
    inspectArtworkEvidence(source).then(evidence=>{if(!cancelled) setArtworkEvidence(evidence)}).catch(()=>{if(!cancelled) setArtworkEvidence({status:'ready',hasColor:false,visibleMarks:false})});
    return()=>{cancelled=true};
  },[media.artwork?.id,media.artwork?.cleanUrl,media.artwork?.orientedUrl,media.artwork?.originalUrl]);
  // 点评不再自动触发：云端视觉点评单次约 20 秒且会消耗额度，改由老师点击「开始生成点评」。
  // 生成入口是下面的 startCloudReview，过程与结果通过 reviewStream 流式呈现。
  // 画心提取与装裱拆成两段，原因是它们的触发条件不同：
  //   - 提取很贵（几百毫秒的逐像素扫描），只在作品或方向变化时重跑一次；
  //   - 装裱很便宜（一次 canvas 合成），换一个装裱方案、换一个学员就要立刻重画。
  // 旧实现把两件事捆在一个 effect 里，导致「切换装裱方案」既不重画、也没人渲染结果。
  const framePlaque=()=>({
    spec:activeFrame?.spec||DEFAULT_FRAME_SPEC,
    student:activeFrame?.plaqueStudent||selectedStudentLabel||'',
    title:activeFrame?.plaqueTitle||'',
    date:activeFrame?.plaqueDate||new Date().toISOString().slice(0,10).replace(/-/g,'.')
  });
  // 第一段：裁掉纸外的桌面/地面，得到只有作品本身的画心。
  useEffect(()=>{
    if(step!==2||!media.artwork?.id||!media.artwork?.processingRequested) return;
    if(media.artwork?.cleanUrl&&media.artwork?.cleanAlgorithm===ARTWORK_CLEAN_ALGORITHM) return;
    let cancelled=false;
    setFramingState('processing');
    extractArtworkSurface({source:media.artwork.originalUrl,rotation:media.artwork.rotation||0}).then(cleanUrl=>{
      if(cancelled||!cleanUrl) return;
      // 原图、旋转预览和画心永远分开保存，任何结果都不能覆盖原图地址。
      setMedia(current=>({...current,artwork:{...current.artwork,cleanUrl,cleanAlgorithm:ARTWORK_CLEAN_ALGORITHM,framedUrl:null,framedStyle:''}}));
    }).catch(()=>{if(!cancelled) setFramingState('error')});
    return()=>{cancelled=true};
  },[step,media.artwork?.id,media.artwork?.processingRequested,media.artwork?.rotation,media.artwork?.cleanUrl,media.artwork?.cleanAlgorithm]);
  // 第二段：把画心按当前装裱方案（云端预设 / 大模型生成的参数）合成成完整的装裱图。
  // 结果存进 framedUrl，step 2 的预览与 step 3 的展陈都直接读它 —— 这就是「框实时渲染到作品上」。
  const activeFrameSpecKey=activeFrame?.id||'default';
  useEffect(()=>{
    if(step!==2||!media.artwork?.cleanUrl||media.artwork?.cleanAlgorithm!==ARTWORK_CLEAN_ALGORITHM) return;
    const plaque=framePlaque();
    const styleKey=JSON.stringify([activeFrameSpecKey,plaque.student,plaque.title,plaque.date]);
    if(media.artwork?.framedStyle===styleKey&&media.artwork?.framedUrl) return;
    let cancelled=false;
    renderFramedArtwork({
      source:media.artwork.cleanUrl,
      spec:plaque.spec,
      student:plaque.student,
      title:plaque.title,
      date:plaque.date,
      rotation:0
    }).then(framedUrl=>{
      if(cancelled) return;
      setMedia(current=>({...current,artwork:{...current.artwork,framedUrl,framedStyle:styleKey}}));
      setFramingState('ready');
    }).catch(()=>{if(!cancelled) setFramingState('error')});
    return()=>{cancelled=true};
  },[step,media.artwork?.cleanUrl,media.artwork?.cleanAlgorithm,media.artwork?.framedStyle,media.artwork?.framedUrl,activeFrameSpecKey,selectedStudentLabel]);
  useEffect(()=>{
    if(step!==2||!media.photo?.url||media.photo?.portraitReady) return;
    let cancelled=false;
    createPortraitPrint({source:media.photo.url}).then(portraitUrl=>{
      if(cancelled) return;
      setMedia(current=>({...current,photo:{...current.photo,originalUrl:current.photo.originalUrl||current.photo.url,url:portraitUrl,portraitReady:true}}));
    }).catch(()=>{});
    return()=>{cancelled=true};
  },[step,media.photo?.id,media.photo?.url,media.photo?.portraitReady]);
  // 五维点评的正文只由大模型产出（人设 + 专业技能 + 记忆 + 作品图）。
  // 这里不再做「进入第三步就自动预填」的本地文案：那样老师看到的其实不是 AI 的思考结果。
  // 云端不可用时，才由老师在面板上显式点击「使用本地草稿模板」兜底，并明确标注来源。
  const fillLocalDraft=()=>{
    const has=(...items)=>items.some(item=>keywords.includes(item));
    const evidence=resolvedArtworkEvidence||{status:'ready',hasColor:false,visibleMarks:false};
    const colorEvidence=evidence.hasColor?(has('暖色调','冷色调','色彩丰富','对比鲜明','渐变柔和')?'孩子主动使用了有辨识度的色彩关系':'作品中可见多种明显色相与局部变化'):'';
    const compositionEvidence=has('构图饱满','留白意境','居中主体','散点分布','层次分明','自由布局')?'画面的主体位置与空间安排有自己的选择':'主体、细节与画面空间之间已经有了初步安排';
    const lineEvidence=has('线条流畅','笔触有力','细致入微','自由奔放','涂色均匀','大胆粗犷')?'线条与笔触呈现出清楚的创作节奏':'线条与可见笔触里保留了孩子自然、真实的手感';
    const student=selectedStudentLabel||'孩子';
    const artReview=evidence.hasColor?`本次作品中，${colorEvidence}；${compositionEvidence}。${lineEvidence}。下一次可以邀请${student}在主体周围尝试一处深浅或大小的变化，让画面的层次更清楚。`:`本次作品以可见的线条、形状和画面安排为主要依据。${compositionEvidence}。${lineEvidence}。下一次可以邀请${student}围绕已经画出的主体补充一处大小、位置或细节变化，让画面表达得更清楚。`;
    const focus=keywords.length?keywords.join('、'):'本次作品、课堂素材与老师观察';
    setReviews({
      美术能力:artReview,
      上课状态:`从本次作品完成度和课堂照片看，${student}愿意把自己的想法慢慢放进画面。下次老师会继续用一个具体、轻松的问题，帮助${student}更快进入创作状态。`,
      行为能力:`${student}能跟着任务一步步完成，也愿意讲述自己的画面想法。面对新的要求时，正在建立自己的节奏和判断；老师会用分步骤的提醒支持自主完成。`,
      内在状态:`这次创作里，${student}通过${focus}留下了真实的表达。我们尊重这份表达，也会持续观察课堂中的投入、选择和回应；这些是本次创作观察，不作为心理诊断。`,
      家长建议:`回家后先请${student}给作品取一个名字，再问：「你最喜欢画面里的哪一处？为什么？」听完后只补一句具体肯定，例如「我看见你把这里画得很认真」。不急着评价像不像，让${student}继续相信自己的表达。`
    });
    setLocalDraftUsed(true);
    setReviewState('ready');
    setReviewGenerated(true);
    setKeywordDirty(false);
    setToast('已填入本地草稿模板（未调用大模型），请老师逐条修改后再发布。');
  };
  // 课后反馈只收图片：作品与课堂照片。视频已从这条工作流里去掉。
  const readFile=async(kind,file)=>{
    if(!file) return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
      setToast('请选择 JPG、PNG 或 WebP 格式的图片');
      return;
    }
    if(file.size>20*1024*1024){
      setToast('图片大小超出 20MB，请压缩后重新选择');
      return;
    }
    const url=URL.createObjectURL(file);
    // Show the selected file immediately. The server upload only enriches this
    // local preview for AI processing; a temporary network error must not make
    // the user think the click did nothing.
    setMedia(current=>({...current,[kind]:{id:`local-${Date.now()}`,name:file.name,url,originalUrl:url,orientedUrl:url,rotation:0,orientationConfirmed:false,processingRequested:false,type:file.type,size:file.size,storage:'local-preview',uploadStatus:'uploading'}}));
    setUploadState(current=>({...current,[kind]:'uploading'}));
    try{
      const uploaded=await uploadControlledMedia(kind,file);
      setMedia(current=>({...current,[kind]:{...current[kind],...uploaded,url,storage:'controlled-memory',uploadStatus:'ready'}}));
      setUploadState(current=>({...current,[kind]:'ready'}));
      setToast(`已受控上传${kind==='artwork'?'学员作品':'课堂照片'}：${file.name}`);
    }catch(error){
      setMedia(current=>({...current,[kind]:{...current[kind],uploadStatus:'local-only'}}));
      setUploadState(current=>({...current,[kind]:'local-only'}));
      setToast(`${kind==='artwork'?'作品':'照片'}已在本地预览；受控上传暂未连接，稍后可重新选择文件提交 AI。`);
    }
  };
  const readFiles=(kind,fileList,input)=>{
    const files=Array.from(fileList||[]);
    // Clearing the native input lets a teacher choose the same photo again
    // after a failed upload or a quick correction.
    const sourceInput=input||({artwork:artworkInput,photo:photoInput}[kind]?.current);
    if(sourceInput) sourceInput.value='';
    if(!files.length) return;
    if(mode==='班级反馈'){
      setBatchUploads(current=>({...current,[kind]:files.map(file=>({name:file.name,type:file.type,size:file.size,url:URL.createObjectURL(file),rotation:0,orientationChecked:true}))}));
      readFile(kind,files[0]);
      const names={artwork:'学员作品',photo:'课堂照片'};
      setToast(`已批量添加 ${files.length} 份${names[kind]}，可进入下一步统一处理`);
      return;
    }
    readFile(kind,files[0]);
  };
  const hasUploadedArtwork=Boolean(media.artwork?.url);
  const hasProcessedArtwork=Boolean(media.artwork?.cleanUrl&&media.artwork?.cleanAlgorithm===ARTWORK_CLEAN_ALGORITHM);
  // 用来在点评区标注「这几段评语是哪位人设写出来的」。
  const activeProfileLabel=(teacherProfiles.find(item=>item.id===activeProfileId)||teacherProfiles[0])?.name||'默认人设';
  const go=(next)=>{
    if(next>=2&&!hasUploadedArtwork){setToast('请先上传学员作品，才能进入智能装裱');return}
    if(next>=3&&!hasProcessedArtwork){setToast('作品正在自动处理，请等待作品裁剪完成后再进入五维点评。');return}
    if(next>=4&&(!hasProcessedArtwork||!reviewGenerated)){setToast('请等待作品点评生成完成后再归档。');return}
    setStep(next);
    if(next===2){
      if(hasProcessedArtwork){setFramingState('ready');return;}
      setMedia(current=>({...current,artwork:{...current.artwork,orientationConfirmed:true,processingRequested:true,framedStyle:'',cleanUrl:null,cleanAlgorithm:null,framedUrl:null}}));
      setFramingState('processing');
    }
  };
  const resetDraft=()=>{localStorage.removeItem('xinlehui-feedback-draft');setMedia({artwork:null,photo:null});setBatchUploads({artwork:[],photo:[]});setReviews(reviewDefaults);setKeywords([]);setAiKeywords([]);setLocalDraftUsed(false);setKeywordDirty(false);setArchived(false);setReviewGenerated(false);setStep(1);setToast('已新建一份课后反馈草稿')};
  // 老师手动增删观察词。AI 选中的词被取消时，同步从「AI 已识别」集合里去掉，标记才一致。
  const toggleKeyword=(keyword)=>{
    setKeywords(current=>current.includes(keyword)?current.filter(item=>item!==keyword):[...current,keyword]);
    setAiKeywords(current=>current.includes(keyword)?current.filter(item=>item!==keyword):current);
    setKeywordDirty(true);
  };
  const rotatePersonalArtwork=async(direction=1)=>{
    const artwork=media.artwork;
    if(!artwork?.originalUrl||framingState==='rotating'||framingState==='processing') return;
    const rotation=((artwork.rotation||0)+(direction>0?90:270))%360;
    setFramingState('rotating');
    try{
      const orientedUrl=await rotateArtworkOriginal({source:artwork.originalUrl,rotation});
      setMedia(current=>({...current,artwork:{...current.artwork,rotation,orientedUrl,orientationConfirmed:true,processingRequested:true,framedStyle:'',cleanUrl:null,cleanAlgorithm:null,framedUrl:null}}));
      setFramingState('processing');
    }catch{setFramingState('error');setToast('作品旋转失败，请重新上传原图。')}
  };
  const startArtworkCleanup=()=>{
    if(!media.artwork?.originalUrl||framingState==='processing') return;
    setMedia(current=>({...current,artwork:{...current.artwork,orientationConfirmed:true,processingRequested:true,framedStyle:'',cleanUrl:null,cleanAlgorithm:null,framedUrl:null}}));
    setFramingState('processing');
  };
  const rotatePersonalPhoto=()=>setMedia(current=>({...current,photo:{...current.photo,rotation:((current.photo?.rotation||0)+90)%360}}));
  const rotateBatchItem=(kind,index)=>setBatchUploads(current=>({...current,[kind]:current[kind].map((item,itemIndex)=>itemIndex===index?{...item,rotation:((item.rotation||0)+90)%360,orientationChecked:false}:item)}));
  // blob: / http: 素材转成 data URL —— 云端模型只能取到内嵌数据，浏览器本地的 blob: 地址它读不到。
  const mediaToDataUrl=async(url)=>{
    if(!url) return '';
    if(String(url).startsWith('data:')) return String(url);
    try{
      const blob=await (await fetch(url)).blob();
      return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('素材读取失败'));reader.readAsDataURL(blob);});
    }catch{ return ''; }
  };
  const stopCloudReview=()=>{
    reviewAbort.current?.abort();
    reviewAbort.current=null;
    setReviewStream(current=>({...current,phase:'idle',message:'已停止生成'}));
  };
  // 云端流式点评：人设 + 技能库 + 大模型记忆一起进 system 提示词，作品图作为 image_url 传入。
  // 五个维度的正文与「作品观察词」都由这一个调用产出：先让模型读懂画面，再按维度写评语。
  const startCloudReview=async()=>{
    if(mode==='班级反馈'){setToast('班级课程反馈将接入下一段课程目标生成服务');return;}
    if(!media.artwork?.cleanUrl&&!media.artwork?.originalUrl){setToast('请先上传并完成作品处理，再生成点评。');return;}
    reviewAbort.current?.abort();
    const controller=new AbortController();
    reviewAbort.current=controller;
    const activeProfile=teacherProfiles.find(item=>item.id===activeProfileId)||teacherProfiles[0]||null;
    setReviewState('processing');
    setKeywordSuggesting(true);
    setReviewStream({open:true,phase:'running',reasoning:'',content:'',message:'',elapsed:0});
    try{
      const artworkDataUrl=await mediaToDataUrl(media.artwork?.cleanUrl||media.artwork?.orientedUrl||media.artwork?.originalUrl);
      const photoDataUrl=await mediaToDataUrl(media.photo?.url);
      const result=await streamArtworkReview({
        profile:activeProfile,
        skillLibrary,
        subject,
        studentName:selectedStudentLabel,
        keywords,
        teacherObservation:'',
        artworkDataUrl,
        photoDataUrl,
        keywordCandidates:keywordCandidatesPrompt(mode),
        keywordScope:mode==='班级反馈'?'课程观察关键词':'作品观察词',
        signal:controller.signal,
        onReasoning:full=>setReviewStream(current=>({...current,reasoning:full})),
        onContent:full=>setReviewStream(current=>({...current,content:full}))
      });
      setReviews(current=>({...current,...result.reviews}));
      setReviewGenerated(true);
      setLocalDraftUsed(false);
      setKeywordDirty(false);
      setReviewState('ready');
      setReviewStream(current=>({...current,phase:'done',reasoning:result.reasoning||current.reasoning,content:'',message:''}));
      // 模型识别出的观察词：与老师已手动勾选的取并集，再按目录顺序排好。
      const picked=pickSupportedKeywords(result.keywords,mode);
      setAiKeywords(picked);
      if(picked.length) setKeywords(current=>orderKeywords([...current,...picked],mode));
      const unmatched=!picked.length&&(result.keywords||[]).length;
      setToast(picked.length
        ?`已按「${activeProfileLabel}」生成点评，并识别出 ${picked.length} 个观察词，请老师确认后再发布`
        :unmatched
          ?`已按「${activeProfileLabel}」生成点评；本次识别出的词不在词表内，请老师手动勾选观察词`
          :`已按「${activeProfileLabel}」生成点评草稿，请老师确认后再发布`);
    }catch(error){
      if(controller.signal.aborted) return;
      setReviewState('ready');
      setReviewStream(current=>({...current,phase:'error',message:describeReviewError(error)}));
      setToast(describeReviewError(error));
    }finally{
      setKeywordSuggesting(false);
      if(reviewAbort.current===controller) reviewAbort.current=null;
    }
  };
  const archiveRecord=()=>{
    if(!hasProcessedArtwork||!reviewGenerated){setToast('请先完成线稿提取和智能点评，才能归档给家长。');return;}
    if(!archived){setRecords(records=>[createFeedbackRecord({media,subject,reviews,mode,student:selectedStudentLabel,className:selectedClassLabel}),...records]);setArchived(true);}
    setToast('点评已归档到成长档案');go(4);
  };
  return <><PageHeader title="课后反馈" desc="每一个环节都可随时进入，当前进度会同步保留。" prd="课后反馈工作流"/>
    <section className="feedback-flow-v2">
      <FlowStepper steps={steps} step={step} flags={[hasUploadedArtwork,hasProcessedArtwork,reviewGenerated,archived]} onGo={go}/>
      <div className="scene-status"><span>当前进行：{steps[step-1][0]}</span><button onClick={()=>go(Math.max(1,step-1))} disabled={step===1}>反馈上一步</button></div>
      {reviewStream.open?<ReviewStreamPanel stream={reviewStream} profiles={teacherProfiles} activeProfileId={activeProfileId} setActiveProfileId={setActiveProfileId} onStart={startCloudReview} onStop={stopCloudReview} onLocalDraft={fillLocalDraft} onClose={()=>setReviewStream(current=>({...current,open:false}))}/>:null}
      {step===3&&!reviewStream.open?<ReviewLaunchPanel profiles={teacherProfiles} skillLibrary={skillLibrary} activeProfileId={activeProfileId} setActiveProfileId={setActiveProfileId} onStart={startCloudReview} onLocalDraft={fillLocalDraft} draftReady={reviewGenerated} localDraftUsed={localDraftUsed} keywordCount={keywords.length} hasArtwork={Boolean(media.artwork?.cleanUrl||media.artwork?.originalUrl)}/>:null}
      {step===2&&mode==='班级反馈'?<ClassFramingWall artworks={batchUploads.artwork} photos={batchUploads.photo} onRotate={index=>rotateBatchItem('artwork',index)} onRotatePhoto={index=>rotateBatchItem('photo',index)}/>:null}
      {step===1?<section className="scene-panel"><div className="scene-heading"><span>第一步</span><h2>创建课后反馈信息</h2><p>先确定服务对象，再同步收集本节课素材。素材只在本次操作中保留。</p></div><div className="feedback-mode"><button className={mode==='个人反馈'?'selected':''} onClick={()=>setMode('个人反馈')}>个人反馈<small>为一位孩子完成反馈</small></button><button className={mode==='班级反馈'?'selected':''} onClick={()=>setMode('班级反馈')}>班级反馈<small>批量处理全班素材</small></button></div><div className="task-form"><label>选择班级<select><option>周六创意绘画 2 班</option><option>色彩启蒙班</option></select></label><label>选择学员<select><option>{mode==='个人反馈'?'陈一诺 · 7岁':'本班全部学员（18人）'}</option><option>林小满 · 8岁</option></select></label></div><div className="sync-upload"><div className={media.artwork?.url?'has-file':''}><Frame/><b>学员作品 <em>必选</em></b><small>{mode==='班级反馈'&&batchUploads.artwork.length?`已选择 ${batchUploads.artwork.length} 幅作品 · ${batchUploads.artwork[0].name}`:media.artwork?.url?media.artwork.name:'支持个人或按学员批量上传'}</small><input ref={artworkInput} type="file" accept="image/jpeg,image/png,image/webp" hidden multiple={mode==='班级反馈'} onChange={e=>readFiles('artwork',e.target.files,e.currentTarget)}/><button onClick={()=>artworkInput.current?.click()}>{media.artwork?.url?'已上传 · 重新选择':'上传作品'}</button></div><div className={media.photo?.url?'has-file':''}><Image/><b>学员照片 <em>选填</em></b><small>{mode==='班级反馈'&&batchUploads.photo.length?`已选择 ${batchUploads.photo.length} 张照片 · ${batchUploads.photo[0].name}`:media.photo?.url?media.photo.name:'课堂人物照片，可批量上传'}</small><input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden multiple={mode==='班级反馈'} onChange={e=>readFiles('photo',e.target.files,e.currentTarget)}/><button onClick={()=>photoInput.current?.click()}>{media.photo?.url?'已上传 · 重新选择':'上传照片'}</button></div></div><div className="upload-privacy-note"><ShieldCheck size={14}/>只有当前操作里真实选择的素材才会显示“已上传”；刷新或重新进入后请重新上传。班级反馈支持一次选择多份作品或照片。</div><div className="scene-actions"><Button variant="secondary" onClick={resetDraft}>新建草稿</Button><Button icon={ArrowRight} onClick={()=>go(2)}>进入智能装裱</Button></div></section>:null}
      {step===2?<section className="scene-panel studio-task"><div className="scene-heading"><span>第二步</span><h2>智能装裱</h2><p>先旋转完整原图并确认方向；确认后自动裁掉纸外的桌面、地面与背景，只保留作品本身。装裱方案（画框、卡纸、展签、日期与署名）由管理员在「装裱设置」中统一维护，这里直接选用。</p></div><div className="media-process"><article><div className={`mini-frame uploaded-art${media.artwork?.framedUrl?' framed-preview':''}`}>{media.artwork?.url?<><img src={media.artwork.framedUrl||media.artwork.cleanUrl||media.artwork.orientedUrl||media.artwork.originalUrl} alt={media.artwork.framedUrl?`已按「${activeFrame?.name||'默认装裱'}」完成装裱的作品`:media.artwork.cleanUrl?'已裁掉纸外背景、只保留作品本身':'等待确认方向的完整原图'}/>{media.artwork?.framedUrl?<span className="framed-badge">{activeFrame?.name||'默认装裱'}</span>:null}<div className="frame-rotate-controls" aria-label="旋转作品"><button type="button" title="向左旋转 90°" aria-label="向左旋转作品" disabled={framingState==='rotating'||framingState==='processing'} onClick={()=>rotatePersonalArtwork(-1)}><RotateCcw size={18}/></button><button type="button" title="向右旋转 90°" aria-label="向右旋转作品" disabled={framingState==='rotating'||framingState==='processing'} onClick={()=>rotatePersonalArtwork(1)}><RotateCw size={18}/></button></div></>:'✺'}</div><div><b>学员作品</b><p>{framingState==='processing'?(media.artwork?.cleanUrl?'正在按当前装裱方案合成装裱图…':'正在裁掉纸外的桌面与地面，只保留作品本身…'):media.artwork?.framedUrl?`已装裱：${activeFrame?.name||'默认装裱'}。作品只做等比缩放与居中，不裁切主体、不重绘、不调色。`:media.artwork?.cleanUrl?'已完成作品裁剪，正在生成装裱图…':'当前仅显示完整原图；请先旋转到正确方向。'}</p>{!media.artwork?.cleanUrl?<button type="button" className="confirm-artwork-button" onClick={startArtworkCleanup} disabled={framingState==='rotating'||framingState==='processing'}>{framingState==='processing'?'正在裁剪作品…':'方向正确，开始裁剪与装裱'}</button>:null}<div className="tiny-choice">{enabledFrames.length?enabledFrames.map(item=><button key={item.id} className={activeFrameId===item.id?'active':''} disabled={framingState==='processing'} onClick={()=>setFrame(item.id)} title={item.spec?.atmosphere||item.description||item.name}>{item.name}</button>):<span className="frame-loading">正在读取装裱设置…</span>}</div></div></article><article><div className="photo-card">{media.photo?.url?<><img src={media.photo.url} alt="已自然优化的课堂照片" style={{transform:`rotate(${media.photo.rotation||0}deg)`}}/><button type="button" className="frame-rotate-button photo-rotate-button" onClick={rotatePersonalPhoto}><RefreshCw size={16}/>旋转照片</button></>:<img src={pandaMascot} alt="课堂照片占位预览"/>}</div><div><b>学员照片</b><p>{media.photo?.name||'未上传课堂照片，可返回上一步补充。'}</p></div></article></div><div className="scene-actions"><Button variant="secondary" onClick={()=>go(1)}>返回创建信息</Button><Button icon={ArrowRight} onClick={()=>go(3)}>进入五维点评</Button></div></section>:null}
      {step===3?<section className="scene-panel review-task-v2"><div className="review-media"><div className="scene-heading"><span>{mode==='班级反馈'?'本班课后素材':'本次课素材'}</span><h2>{mode==='班级反馈'?'周六创意绘画 2 班 · 班级课后反馈':`${selectedStudentLabel}${activeFrame?.plaqueTitle?` · 《${activeFrame.plaqueTitle}》`:''}`}</h2></div><div className={`review-gallery ${mode==='班级反馈'?'class-review-gallery':''}`}>{mode==='班级反馈'?<><ClassMediaMosaic items={batchUploads.artwork} kind="artwork" onRotate={index=>rotateBatchItem('artwork',index)}/><ClassMediaMosaic items={batchUploads.photo} kind="photo" onRotate={index=>rotateBatchItem('photo',index)}/></>:<><div className={`review-art exhibition-art${media.artwork?.framedUrl?' framed-art':''}`}>{media.artwork?.framedUrl?<div className="framed-art-final"><img src={media.artwork.framedUrl} alt={`${selectedStudentLabel}的作品 · ${activeFrame?.name||'装裱'}`}/>{activeFrame?.name?<span className="framed-badge">{activeFrame.name}</span>:null}</div>:<><div className="artwork-mat">{media.artwork?.url?<img src={media.artwork.cleanUrl||media.artwork.originalUrl||media.artwork.url} alt={`${selectedStudentLabel}的作品`}/>:'✺'}</div><div className="artwork-plaque"><div><b>{selectedStudentLabel}</b><span>{activeFrame?.plaqueTitle?`《${activeFrame.plaqueTitle}》`:''}</span></div><time>创作于 {(activeFrame?.plaqueDate||new Date().toISOString().slice(0,10).replace(/-/g,'.'))}</time></div></>}</div><div className="review-photo portrait-print"><div className="portrait-mat">{media.photo?.url?<img src={media.photo.url} alt="陈一诺课堂照片"/>:<img src={pandaMascot} alt="课堂照片占位"/>}</div><div className="portrait-caption">{selectedStudentLabel} · {(activeFrame?.plaqueDate||new Date().toISOString().slice(0,10).replace(/-/g,'.'))}</div></div></>}</div></div><ReviewKeywordDock visible selected={keywords} onToggle={toggleKeyword} suggested={aiKeywords} suggesting={keywordSuggesting} dirty={keywordDirty} generated={reviewGenerated}/><div className={`coach-review ${mode==='班级反馈'?'class-coach-review':''}`}><div className="scene-heading"><span>第三步</span><h2>{mode==='班级反馈'?'班级课程反馈':'五维点评'}</h2></div><select value={subject} onChange={e=>setSubject(e.target.value)}><option>通用美术</option><option>创意绘画（3-6岁）</option><option>儿童画（6-9岁）</option><option>素描（9-18岁）</option><option>速写（9-18岁）</option><option>水彩 / 水粉（7-18岁）</option><option>国画（6-18岁）</option></select><p className="evidence">{mode==='班级反馈'?'以下内容基于本节课课程设计、班级素材与老师观察生成，老师可编辑确认后发布给家长。':`下列内容由大模型生成：先读懂作品与课堂素材，再结合「${activeProfileLabel}」的人设、已启用技能与长期记忆，按五个维度分别输出评语。老师可逐条修改后再发布。`}</p>{mode==='班级反馈'?<ClassReviewContent subject={subject}/>:<><div className={`review-source ${reviewGenerated?(localDraftUsed?'local':'ai'):'pending'}`}>{reviewGenerated?(localDraftUsed?<><CircleAlert size={14}/><span>当前正文来自<strong>本地草稿模板</strong>（未调用大模型），发布前请老师逐条核对。</span></>:<><Sparkles size={14}/><span>当前正文由大模型「{activeProfileLabel}」依据人设、技能与长期记忆生成，可直接编辑。</span></>):<><Sparkles size={14}/><span>五个维度等待大模型生成：点击上方「开始生成点评」，评语会逐字写入这里。</span></>}{keywordDirty&&reviewGenerated?<em>观察词已调整，建议重新生成</em>:null}</div>{Object.entries(reviews).map(([name,copy])=><article className={`coach-card${copy?'':' is-empty'}`} key={name}><b>{name}{copy?null:<em className="review-pending">待生成</em>}</b><textarea aria-label={name} value={copy} placeholder={REVIEW_DIMENSION_HINTS[name]||''} onChange={event=>setReviews(current=>({...current,[name]:event.target.value}))}/></article>)}</>}<div className="scene-actions"><Button variant="secondary" onClick={()=>go(2)}>返回智能装裱</Button><Button icon={Archive} onClick={archiveRecord}>归档并生成分享</Button></div></div></section>:null}
      {step===4?<section className="share-task scene-panel"><img src={pandaObserve} alt="熊猫成长伙伴"/><div><span>已归档至{selectedStudentLabel}的成长档案</span><h2>这一次的成长，<br/>已经被完整记录。</h2><p>作品、课堂照片与五维点评已经同步保存到本地草稿。</p><div className="share-actions"><Button icon={Archive} onClick={()=>setToast('成长集锦任务已创建，等待服务端接入')}>制作成长集锦</Button><Button variant="secondary" icon={Frame} onClick={()=>setToast('个人作品集任务已创建，等待服务端接入')}>制作作品集</Button></div><div className="scene-actions"><Button variant="secondary" onClick={()=>go(3)}>返回五维点评</Button><Button icon={FileText} onClick={()=>navigate('archives')}>进入成长档案</Button></div></div></section>:null}
    </section></>;
}

function PremiumFramingResult({setToast}){
  const [framed,setFramed]=useState(false);
  const [photoReady,setPhotoReady]=useState(false);
  const [style,setStyle]=useState('gallery');
  const styles=[['gallery','当代白廊'],['walnut','胡桃木影'],['silk','东方绢雅']];
  const labelName='陈一诺';
  const date='2026.08.07';
  return <>
    <section className="premium-framing-result" aria-label="智能装裱处理结果">
      <div className="premium-framing-head"><div><span>AI 保留原作模式</span><h3>把孩子的作品，安静地带进展厅。</h3><p>仅处理拍摄光影、透视与杂乱背景；原作线条、笔触和色彩不被重绘。</p></div><div className="preserve-pill"><Check/> 原作完整保留</div></div>
      <div className="premium-style-picker">{styles.map(([key,name])=><button key={key} className={style===key?'active':''} onClick={()=>setStyle(key)}><i/><span>{name}</span></button>)}</div>
      <div className="premium-media-grid">
        <article className="museum-piece">
          <div className={`gallery-installation ${style} ${framed?'is-framed':''}`}>
            <div className="gallery-light"/><div className="museum-mount"><div className="artwork-surface"><i className="art-sun"/><i className="art-petal petal-a"/><i className="art-petal petal-b"/><i className="art-petal petal-c"/><i className="art-stem"/><i className="art-wave"/></div></div>
            <div className="museum-label"><b>{labelName}</b><span>《向着光的花》</span><em>创作于 {date}</em></div>
          </div>
          <div className="media-note"><b>学员作品 · 展览装裱</b><span>{framed?'作品已融入展墙与装裱结构':'预览：装裱前将先完成自然校正'}</span></div>
        </article>
        <article className="portrait-piece">
          <div className={`portrait-proof ${photoReady?'is-ready':''}`}><div className="photo-light"/><img src={pandaMascot} alt="课堂照片自然优化预览"/><div className="portrait-label">{labelName} · {date}</div></div>
          <div className="media-note"><b>学员照片 · 自然修图</b><span>只优化构图和光线，不改变五官、神态与真实肤色。</span></div>
          <button className="quiet-process" onClick={()=>{setPhotoReady(true);setToast('已完成自然光线与构图优化，未改变孩子五官（演示）')}}>{photoReady?'照片已自然优化':'一键自然优化'}</button>
        </article>
      </div>
      <div className="framing-one-click"><div><WandSparkles/><span><b>准备好了吗？</b>一键完成作品的校正、融合装裱与展签排版。</span></div><Button icon={Sparkles} onClick={()=>{setFramed(true);setToast('已完成美术馆级融合装裱：原作线条与色彩保持不变（演示）')}}>{framed?'已完成智能装裱':'一键装裱'}</Button></div>
    </section>
  </>;
}

function EvidenceReview({setToast}){
  const [child,setChild]=useState('陈一诺');
  const profiles={
    '陈一诺':{work:'《向着光的花》',facts:['黄、蓝主色与橙色花心形成冷暖层次','花瓣由中心向外延伸，主体集中在画面上半部','视频中在提示后继续补充花瓣细节'],items:[['美术能力','冷暖色关系已经很清楚。下一次可以邀请一诺在花瓣边缘加一层深浅变化，让“光”更有空气感。'],['上课状态','从视频里的持续涂色和最后主动补细节看，她今天保持了稳定投入，遇到停顿后也能重新回到画面。'],['行为能力','在分享环节，她把“花想把光送给妈妈”说得具体，这是把画面想法转成语言的好开始。'],['内在状态','明亮色彩与向上生长的构图，呈现出积极的表达愿望；这是一节课中的创作观察，不作心理诊断。'],['家长建议','回家后先不评价像不像，可以问：“你画里的光最想照到哪里？” 听她讲完，再请她下次把故事补进画面。']]},
    '林小满':{work:'《雨后的花园》',facts:['画面用绿色、紫色和留白表现雨后层次','细线条重复描绘叶片，局部有耐心的补充','照片中先观察同伴作品后再继续调整'],items:[['美术能力','绿色与紫色的搭配很有自己的感觉，留白也让画面透气。可以尝试把前景叶片画得更大，拉开远近关系。'],['上课状态','小满今天进入状态较慢，但找到颜色后能持续安静地完成细节，这种节奏值得被尊重。'],['行为能力','她会先观察、再落笔，说明正在建立自己的判断；老师可用一个具体问题帮助她更快决定下一步。'],['内在状态','画面里反复出现的叶片与留白，像是在用自己的方式整理感受；仅作为作品表达观察，不作心理诊断。'],['家长建议','可以和孩子一起找三处她最满意的细节，再问：“如果明天花园再长一点，你想加什么？” 用具体选择支持她表达。']]}
  };
  const active=profiles[child];
  return <section className="evidence-review-upgrade"><div className="evidence-upgrade-head"><div><span>基于本次素材的观察</span><h3>每一句点评，都能回到孩子的创作现场。</h3></div><select value={child} onChange={e=>setChild(e.target.value)}><option>陈一诺</option><option>林小满</option></select></div><div className="source-facts"><b>{child} · {active.work}</b>{active.facts.map(f=><span key={f}><Check/>{f}</span>)}</div><div className="evidence-dimensions">{active.items.map(([title,copy])=><article key={title}><b>{title}</b><p>{copy}</p></article>)}</div><button className="edit-review" onClick={()=>setToast('老师可在发布前逐条编辑点评内容（演示）')}>老师编辑后再发布</button></section>
}

function ClassReviewContent({subject}){
  const sections=[
    ['课程主题','《向着光的花》· 观察自然中的形态、色彩与生长力量。'],
    ['教学目标','美术目标：观察花瓣方向与色彩关系；能力目标：练习观察、专注与表达；情感目标：在创作中感受生命的明亮与彼此欣赏。'],
    ['课堂流程','① 以“光从哪里来”开启观察；② 认识花朵的形态与色彩；③ 独立创作并完成细节；④ 分享作品，听见同伴的不同表达。'],
    ['本节课的集体收获','孩子们不仅完成了一幅画，也经历了“先观察、再选择、最后表达”的过程。我们看见他们愿意耐心补充细节、讲述自己的想法，也在同伴分享中学习倾听与欣赏。'],
    ['家长可延续的陪伴','回家后可以请孩子用三句话介绍作品：我画了什么、我最满意哪里、下次还想画什么。让创作从课堂延续到日常表达。'],
    ['下一节课预告','将在本节课的观察基础上，继续练习画面的前后关系与色彩层次，帮助孩子把“看见的细节”更自信地呈现出来。']
  ];
  return <div className="class-review-content"><div className="class-review-banner"><span>本节课 · {subject}</span><b>一节美术课，也是一段观察、表达与成长的旅程。</b></div><aside className="review-absence-reminder"><b>也为本次没能来上课的孩子留一句话</b><p>今天的主题和同伴们的创作故事，我们都先好好替孩子保留着。等她回来，老师会用一个轻松的小引子，陪她自然地接上这一课；家长也不用着急补赶进度。</p></aside>{sections.map(([title,copy])=><article key={title}><b>{title}</b><textarea aria-label={title} defaultValue={copy}/></article>)}</div>
}

function ClassFramingWall({artworks=[],photos=[],onRotate,onRotatePhoto}){
  const renderItems=(items,kind)=>{const rotate=kind==='artwork'?onRotate:onRotatePhoto;const typeLabel=kind==='artwork'?'作品':'照片';return <div className="class-framing-scroll">{items.length?items.map((item,index)=><article className={`class-framing-item ${kind}`} key={`${kind}-${item.name}-${index}`}><div className="class-framing-preview"><img src={item.url} alt={item.name} style={{transform:`rotate(${item.rotation||0}deg)`}}/><button type="button" onClick={()=>rotate?.(index)} title={`顺时针旋转${typeLabel}`}><RefreshCw size={14}/></button></div><div><b>{kind==='artwork'?'学员作品':'课堂照片'} {index+1}</b><small>{item.name}</small><em>{kind==='artwork'?'已按完整画面装裱':'已完成自然优化，可旋转校正'}</em></div></article>):<div className="class-framing-empty">本次未上传{kind==='artwork'?'学员作品':'课堂照片'}。</div>}</div>};
  return <section className="class-framing-wall">
    <div className="class-framing-wall-head"><div><b>本班装裱任务</b><small>作品与照片分开处理、分开核对。</small></div></div>
    <section className="class-framing-section"><div className="class-framing-section-head"><div><Frame size={16}/><b>学员作品</b></div><span>{artworks.length} 幅</span></div>{renderItems(artworks,'artwork')}</section>
    <section className="class-framing-section"><div className="class-framing-section-head"><div><Image size={16}/><b>课堂照片</b></div><span>{photos.length} 张</span></div>{renderItems(photos,'photo')}</section>
  </section>
}

function ClassMediaMosaic({items=[],kind='artwork',onRotate}){
  const visibleItems=items;
  const label=kind==='artwork'?'班级作品合展':'班级课堂瞬间';
  const overflow=0;
  const students=['陈一诺','林小满','周子乐','赵禾','苏西','陆一白'];
  const titles=['向着光的花','海底世界','彩色的家','春日小径','雨后的花园','我的小宇宙'];
  return <div className={`class-media-mosaic ${kind}`}>{visibleItems.length?visibleItems.map((item,index)=><figure key={`${item.name}-${index}`}><img src={item.url} alt={item.name} style={{transform:`rotate(${item.rotation||0}deg)`}}/>{kind==='artwork'?<span className="orientation-note">{item.orientationChecked?'已自动校正':'已手动旋转'}</span>:null}<button className="rotate-work" type="button" title={`顺时针旋转${kind==='artwork'?'作品':'照片'}`} onClick={()=>onRotate?.(index)}><RefreshCw size={12}/></button><figcaption>{kind==='artwork'?`${students[index%students.length]} · 《${titles[index%titles.length]}》 · 2026.08.11`:'2026.08.11'}</figcaption></figure>):<div className="mosaic-empty"><Frame/><span>等待班级素材上传</span></div>}{overflow>0?<span className="mosaic-more">+{overflow}</span>:null}<div className="mosaic-label"><b>{label}</b><small>已收录 {items.length} 份</small></div></div>
}

/**
 * 作品观察词面板。
 * 词表来自 src/data/reviewKeywords.js —— 与提示词里的候选清单是同一份，
 * 所以大模型识别出来的词一定能在这里被勾中（见 pickSupportedKeywords 的说明）。
 *
 * 受控组件：selected / onToggle 由 TeacherFlowV2 持有，
 * 生成点评时模型返回的 keywords 会直接写回同一份状态。
 */
function ReviewKeywordDock({visible=false,selected=[],onToggle,suggested=[],suggesting=false,dirty=false,generated=false}){
  const [step,setStep]=useState(1),[open,setOpen]=useState(visible),[feedbackMode,setFeedbackMode]=useState(()=>window.__xinlehuiFeedbackMode||'个人反馈');
  useEffect(()=>{const update=(event)=>setStep(event.detail);window.addEventListener('xinlehui-feedback-step',update);return()=>window.removeEventListener('xinlehui-feedback-step',update)},[]);
  useEffect(()=>{const update=(event)=>setFeedbackMode(event.detail);window.addEventListener('xinlehui-feedback-mode',update);return()=>window.removeEventListener('xinlehui-feedback-mode',update)},[]);
  // 模型识别出词以后自动展开面板，老师一眼就能看到 AI 勾了什么。
  useEffect(()=>{if(suggested.length)setOpen(true)},[suggested]);
  if(!visible&&step!==3) return null;
  const isClass=feedbackMode==='班级反馈';
  const categories=keywordCategoriesFor(feedbackMode);
  const active=selected;
  const aiSet=new Set(suggested);
  const toggle=(keyword)=>onToggle?.(keyword);
  const summary=suggesting
    ?'AI 正在识别画面内容…'
    :suggested.length?`AI 已识别 ${suggested.length} 项${active.length!==suggested.length?` · 共选 ${active.length} 项`:''}`
    :active.length?`已选择 ${active.length} 项`:'AI 自动识别，也可手动补充';
  return <aside className="review-keyword-dock">
    <button className="review-keyword-toggle" onClick={()=>setOpen(!open)}>
      <span><Sparkles size={15}/>{isClass?'班级课程观察关键词':'作品观察词'}{suggesting?<i className="keyword-scanning"/>:null}</span>
      <small className={suggested.length?'has-ai':''}>{summary}</small>
      <ChevronDown className={open?'open':''} size={16}/>
    </button>
    {open?<section className="review-keyword-panel">
      <div className="review-keyword-intro">
        <b>{isClass?'本节课的课程观察关键词':'作品观察词'}</b>
        <small>{isClass?'选择本节课的目标、流程与班级表现，AI 会据此生成一份有教育温度的班级课程反馈。':'大模型会先读懂作品，自动勾选能被画面证据支持的观察词；老师可随时增删，改动会同步进下一次生成的提示词。'}</small>
      </div>
      {dirty&&generated?<div className="review-keyword-dirty">观察词已调整，建议重新生成点评，让评语与关键词一致。</div>:null}
      <div className="review-keyword-groups">{Object.entries(categories).map(([name,options])=><section key={name}>
        <strong>{name}</strong>
        <div>{options.map(item=><button key={item}
          className={`${active.includes(item)?'active':''}${aiSet.has(item)?' ai-picked':''}`}
          title={aiSet.has(item)?'AI 依据画面识别并勾选':'老师手动选择'}
          onClick={()=>toggle(item)}>
          {item}{aiSet.has(item)?<i className="ai-mark" aria-hidden="true">AI</i>:null}
        </button>)}</div>
      </section>)}</div>
    </section>:null}
  </aside>;
}

function CourseLearningTimeline(){
  const [selected,setSelected]=useState(null);
  const sessions=[
    {date:'03 月 08 日',order:'第 01 课',title:'向着光的花',review:'大胆使用明亮的黄色，并愿意把画里的故事讲给老师听。'},
    {date:'03 月 15 日',order:'第 02 课',title:'海底世界',review:'开始主动安排画面里的大小关系，专注完成了鱼群细节。'},
    {date:'03 月 22 日',order:'第 03 课',absent:true},
    {date:'04 月 05 日',order:'第 04 课',title:'彩色的家',review:'在老师提问后继续调整颜色，让画面有了更丰富的层次。'},
    {date:'04 月 12 日',order:'第 05 课',title:'春日小径',review:'能安静观察后再落笔，也愿意倾听同伴的创作想法。'}
  ];
  return <section className="course-learning-timeline"><div className="course-timeline-title"><div><b>这一阶段的课程足迹</b><span>作品、课堂影像与老师观察，按上课日期一一留存。</span></div><small>共 12 次课程 · 以下为时间线预览</small></div><div className="course-timeline-list">{sessions.map((session,index)=>session.absent?<article className="lesson-track absent" key={session.date}><div className="lesson-date"><b>{session.date}</b><span>{session.order}</span></div><div className="absence-note"><span>这一次，一诺暂时没有来到课堂。</span><p>我们把这段空白也轻轻留在成长轨迹里，期待下次课再与她一起，把未完的灵感继续画下去。</p></div></article>:<article className="lesson-track" key={session.date}><div className="lesson-date"><b>{session.date}</b><span>{session.order}</span></div><div className={`track-art art-${index}`}><i className="track-flower"/><i className="track-stem"/></div><div className="track-photo"><img src={pandaWave} alt={`${session.title}课堂照片`}/><span>课堂照片</span></div><div className="track-review"><b>{session.title}</b><p>{session.review}</p><button onClick={()=>setSelected(session)}>查看本节完整反馈 <ArrowRight/></button></div></article>)}</div>{selected?<div className="track-feedback-drawer"><div><span>{selected.date} · {selected.order} · {selected.title}</span><h3>本节课的完整成长反馈</h3><p>{selected.review}</p><small>已关联本节作品、课堂照片、视频片段与老师的五维观察。</small></div><button aria-label="关闭本节反馈" onClick={()=>setSelected(null)}><X/></button></div>:null}</section>
}

function StageReviewSummary({show}){
  const [open,setOpen]=useState(false);
  const [assessment,setAssessment]=useState(false);
  const [selectedLesson,setSelectedLesson]=useState(null);
  const lessons=[
    ['第 01 次','向着光的花','能持续完成花瓣细节，并主动讲述“想把光送给妈妈”。'],
    ['第 03 次','海底世界','尝试用不同大小的鱼群组织画面，分享时能说出自己的安排。'],
    ['第 05 次','彩色的家','在颜色选择上更果断，遇到停顿后能在提示下继续完成。'],
    ['第 08 次','春日小径','开始主动留出画面空间，能耐心完成前景与背景的变化。'],
    ['第 10 次','雨后的花园','观察后再落笔，愿意倾听同伴分享，也能表达自己的选择。'],
    ['第 12 次','向日葵的光','冷暖色关系更清晰，专注完成后愿意把创作故事讲给大家听。']
  ];
  if(!show)return null;
  return <section className="stage-review-summary">
    <div className="stage-review-brief"><div><span>课次点评已归档</span><h3>12 次课程的老师观察，已经和每一张作品、课堂照片一一对应保存。</h3><p>阶段总结、进步点与学习规划仍完整保留在上方；这里用于回看每一节课的具体表现。</p></div><button onClick={()=>setOpen(true)}>查看 12 节课点评 <ArrowRight/></button></div>
    {open?<div className="stage-review-detail" role="dialog" aria-label="每节课详细点评"><div className="stage-review-detail-head"><div><span>陈一诺 · 课次成长记录</span><h3>每一节课，都有被认真看见的细节。</h3></div><button aria-label="关闭详细点评" onClick={()=>setOpen(false)}><X/></button></div><div className="lesson-review-list">{lessons.map(([order,title,review])=><article key={order}><div><span>{order}</span><b>{title}</b></div><p>{review}</p><button onClick={()=>setSelectedLesson([order,title,review])}>查看本节完整反馈 <ArrowRight/></button></article>)}</div>{selectedLesson?<div className="lesson-feedback-detail"><div><span>{selectedLesson[0]} · {selectedLesson[1]}</span><h4>本节课堂完整反馈</h4><p>{selectedLesson[2]}</p><small>已关联：本节作品、课堂照片、课堂视频与老师观察。</small></div><button onClick={()=>setSelectedLesson(null)}><X/></button></div>:null}<div className="assessment-entry"><div><Sparkles/><span><b>学能测评报告</b><small>从课堂学习过程观察专注、表达、规划与审美等能力变化。</small></span></div><button onClick={()=>setAssessment(!assessment)}>{assessment?'收起测评报告':'生成学能测评报告'} <ArrowRight/></button></div>{assessment?<div className="learning-assessment"><div><span>阶段学能测评 · 课堂观察版</span><h3>她正在把“想画什么”，慢慢变成“知道怎样画出来”。</h3><p>依据本阶段作品、照片、视频与老师课堂记录形成，仅用于学习陪伴与课程规划，不用于医学、心理或智力诊断。</p></div><div className="assessment-grid">{[['观察与感知','能留意到花瓣朝向、颜色冷暖等细节。','稳定发展'],['专注与坚持','完成细节的持续性比阶段初更稳定。','进步明显'],['表达与叙事','能把画面想法说成具体故事。','进步明显'],['规划与执行','开始先观察再落笔，并能调整画面。','稳步建立'],['审美与创造','有鲜明色彩偏好，也愿意尝试新的组合。','优势表现'],['下一步支持','在构图观察与自主讲述中继续积累。','学习建议']].map(([name,copy,status])=><article key={name}><b>{name}</b><p>{copy}</p><span>{status}</span></article>)}</div></div>:null}<button className="stage-detail-close" onClick={()=>setOpen(false)}>收起课次点评</button></div>:null}
  </section>;
}

function GrowthArchiveBuilderLegacy({setToast}){
  const [period,setPeriod]=useState('一学期');
  const [format,setFormat]=useState('成长集锦');
  const [generated,setGenerated]=useState(false);
  const periods=['半学期','一学期','一年度','自定义时间'];
  const formats=[['成长集锦',Image,'作品、课堂照片与阶段回顾'],['作品集',Frame,'周期内全部作品的线上展览'],['成长记录（视频）',Film,'课堂视频与成长瞬间剪辑']];
  return <><PageHeader title="成长档案" desc="让看得见的服务，沉淀成孩子可感知的进步与下一步学习方向。" prd={PRD.archives}/>
    <section className="growth-builder">
      <div className="growth-builder-top">
        <div><span>为孩子生成一份阶段成长档案</span><h2>把一次次认真，连成清晰的成长轨迹。</h2><p>报告包含作品、课堂照片、视频、五维点评、阶段总结与下一阶段学习规划，方便家长理解孩子，也便于老师持续陪伴。</p></div>
        <img src={pandaObserve} alt="熊猫成长伙伴"/>
      </div>
      <div className="growth-controls"><label>选择学员<select><option>陈一诺 · 7岁</option><option>林小满 · 8岁</option><option>赵禾 · 9岁</option></select></label><label>选择班级<select><option>周六创意绘画 2 班</option><option>色彩启蒙班</option></select></label></div>
      <div className="period-picker"><b>生成周期</b><div>{periods.map(item=><button key={item} className={period===item?'active':''} onClick={()=>setPeriod(item)}>{item}</button>)}</div>{period==='自定义时间'?<div className="custom-period"><input type="date" defaultValue="2026-03-01"/><i>至</i><input type="date" defaultValue="2026-08-31"/></div>:null}</div>
      <div className="archive-format-picker"><b>选择生成内容</b><div>{formats.map(([name,Icon,desc])=><button key={name} className={format===name?'active':''} onClick={()=>{setFormat(name);setGenerated(false)}}><Icon/><span><strong>{name}</strong><small>{desc}</small></span></button>)}</div></div>
      <div className="report-scope"><article><Frame/><div><b>服务被看见</b><small>精选作品、照片、视频与课堂记录</small></div></article><article><Sparkles/><div><b>进步可感知</b><small>美术能力、行为表现与阶段变化</small></div></article><article><ArrowRight/><div><b>下一步有方向</b><small>可执行的学习规划与家庭陪伴建议</small></div></article></div>
      <Button icon={FileText} onClick={()=>{setGenerated(true);setToast(`${period}${format}已生成`)}}>生成{period}{format}</Button>
      {generated?<section className="growth-report-preview"><div className="report-title"><span>陈一诺 · {period}{format}</span><h2>{format==='成长记录（视频）'?'这一阶段的认真，值得被温柔回看。':'这一次的成长，已经被完整看见。'}</h2><p>共记录 12 次课程 · 26 幅作品 · 18 张课堂照片 · 6 段成长影像</p></div>{format==='成长记录（视频）'?<div className="growth-video-hero"><Film/><b>陈一诺 · {period}成长记录</b><small>作品、课堂高光与老师寄语 · 02:16</small></div>:<><div className="all-media-title"><b>{format==='作品集'?'本周期全部作品':'本周期作品与课堂照片'}</b><small>AI 已按课程时间线完整收录，以下为预览</small></div><div className="all-media-grid">{['向着光的花','海底世界','彩色的家','春日小径','课堂合影 01','课堂合影 02','认真创作','分享瞬间'].map((name,index)=><figure key={name} className={index>3?'photo':''}>{index>3?<img src={pandaWave} alt={name}/>:<i>✺</i>}<figcaption>{name}</figcaption></figure>)}</div></>}<div className="growth-report-grid"><article><b>美术能力</b><p>从大胆用色，进步到能主动组织冷暖关系与画面主次。</p></article><article><b>课堂表现</b><p>专注时间更稳定，愿意分享想法，也能倾听并完成自己的创作。</p></article><article><b>本阶段进步</b><p>从“完成作品”走向“用画讲述自己的故事”。</p></article><article><b>下一阶段学习规划</b><p>围绕色彩层次、构图观察与主题表达，每两周保留一次作品回看与自主讲述。</p></article><article><b>给家长的陪伴建议</b><p>先请孩子讲创作，再问一个具体问题；把她的表达当作成长线索，而非对错答案。</p></article><article><b>老师寄语</b><p>愿一诺继续带着好奇与勇气，在每一次落笔里长出更清晰的自己。</p></article></div><div className="report-footer"><span>下一阶段：色彩表达与构图观察 · 建议继续学习 12 次</span><Button icon={MessageSquareText} onClick={()=>setToast('家长版成长档案链接已生成')}>生成家长版并转发</Button></div></section>:null}
    </section><StageReviewSummary show={generated&&format!=='成长记录（视频）'}/></>;
}

function AcademicAssessmentLegacy(){
  return null;
}

function GrowthArchiveBuilderLegacy2({setToast}){
  const [period,setPeriod]=useState('一学期');
  const [format,setFormat]=useState('成长集锦');
  const [generated,setGenerated]=useState(false);
  const periods=['半学期','一学期','一年度','自定义时间'];
  const formats=[['成长集锦',Image,'作品、课堂照片与阶段回看'],['作品集',Frame,'周期内全部作品的线上展览'],['成长记录（视频）',Film,'课堂视频与成长瞬间剪辑']];
  const reportItems=[['美术能力','从大胆用色，进步到能主动组织冷暖关系与画面主次。'],['课堂表现','专注时间更稳定，愿意分享想法，也能倾听并完成自己的创作。'],['本阶段进步','从“完成作品”走向“用画讲述自己的故事”。'],['下一阶段学习规划','围绕色彩层次、构图观察与主题表达，每两周保留一次作品回看与自主讲述。'],['给家长的陪伴建议','先请孩子讲创作，再问一个具体问题；把她的表达当作成长线索，而非对错答案。'],['老师寄语','愿一诺继续带着好奇与勇气，在每一次落笔里长出更清晰的自己。']];
  return <><PageHeader title="成长档案" desc="让看得见的服务，沉淀成孩子可感知的进步与下一步学习方向。" prd={PRD.archives}/><section className="growth-builder"><div className="growth-builder-top"><div><h2>把一次次认真，连成清晰的成长轨迹。</h2><p>按日期串联作品、课堂照片、每节课的点评与阶段总结，让家长清楚看见孩子的学习状态。</p></div><img src={pandaObserve} alt="熊猫成长伙伴"/></div><div className="growth-controls"><label>选择学员<select><option>陈一诺 · 7岁</option><option>林小满 · 8岁</option><option>赵禾 · 9岁</option></select></label><label>选择班级<select><option>周六创意绘画 2 班</option><option>色彩启蒙班</option></select></label></div><div className="period-picker"><b>生成周期</b><div>{periods.map(item=><button key={item} className={period===item?'active':''} onClick={()=>setPeriod(item)}>{item}</button>)}</div>{period==='自定义时间'?<div className="custom-period"><input type="date" defaultValue="2026-03-01"/><i>至</i><input type="date" defaultValue="2026-08-31"/></div>:null}</div><div className="archive-format-picker"><b>选择生成内容</b><div>{formats.map(([name,Icon,desc])=><button key={name} className={format===name?'active':''} onClick={()=>{setFormat(name);setGenerated(false)}}><Icon/><span><strong>{name}</strong><small>{desc}</small></span></button>)}</div></div><Button icon={FileText} onClick={()=>{setGenerated(true);setToast(`${period}${format}已生成`)}}>生成{period}{format}</Button>{generated?<section className="growth-report-preview"><div className="report-title"><span>陈一诺 · {period}{format}</span><h2>{format==='成长记录（视频）'?'这一阶段的认真，值得被温柔回看。':'这一次的成长，已经被完整看见。'}</h2><p>共记录 12 次课程 · 26 幅作品 · 18 张课堂照片 · 6 段成长影像</p></div>{format==='成长记录（视频）'?<div className="growth-video-hero"><Film/><b>陈一诺 · {period}成长记录</b><small>作品、课堂高光与老师寄语 · 02:16</small></div>:<><CourseLearningTimeline/><div className="growth-report-grid">{reportItems.map(([title,copy])=><article key={title}><b>{title}</b><p>{copy}</p></article>)}</div><AcademicAssessment/></>}<div className="report-footer"><span>下一阶段：色彩表达与构图观察 · 建议继续学习 12 次</span><Button icon={MessageSquareText} onClick={()=>setToast('家长版成长档案链接已生成')}>生成家长版并转发</Button></div></section>:null}</section></>;
}

function LearningRadarLegacy(){
  const dimensions=[['观察感知','86'],['专注坚持','78'],['表达叙事','82'],['规划执行','71'],['审美创造','91'],['互动协作','76']];
  return <div className="learning-radar"><div className="radar-visual"><svg viewBox="0 0 240 220" role="img" aria-label="六维课堂学习观察雷达图"><g className="radar-grid"><polygon points="120,16 210,68 210,152 120,204 30,152 30,68"/><polygon points="120,47 183,83 183,137 120,173 57,137 57,83"/><polygon points="120,78 156,99 156,121 120,142 84,121 84,99"/><path d="M120 16V204M30 68L210 152M210 68L30 152"/></g><polygon className="radar-fill" points="120,35 185,82 173,132 120,155 39,157 55,89"/><g className="radar-dot"><circle cx="120" cy="35" r="4"/><circle cx="185" cy="82" r="4"/><circle cx="173" cy="132" r="4"/><circle cx="120" cy="155" r="4"/><circle cx="39" cy="157" r="4"/><circle cx="55" cy="89" r="4"/></g></svg>{dimensions.map(([label,value],i)=><span key={label} className={`radar-label r${i}`}><b>{label}</b><em>{value}</em></span>)}</div><div className="radar-summary"><b>本阶段学习观察</b><p>审美创造与观察感知是这一阶段更突出的力量；规划执行可在下阶段通过“先想一想再落笔”的练习慢慢建立。</p><div><span><i className="good"/>优势：审美创造</span><span><i className="next"/>下一步：规划执行</span></div></div></div>
}

function AcademicAssessment(){
  const [open,setOpen]=useState(false);
  const rows=[['观察与感知','能发现颜色、大小与方向的变化。','稳定发展'],['专注与坚持','完成细节的持续性比阶段初更稳定。','进步明显'],['表达与叙事','能把画面想法讲成具体故事。','进步明显'],['规划与执行','开始先观察再落笔，也会主动调整。','稳步建立'],['审美与创造','有鲜明的色彩偏好，愿意尝试组合。','优势表现'],['下一步支持','继续积累构图观察与自主讲述。','学习建议']];
  return <section className="academic-assessment"><div><span>阶段学能测评报告</span><h3>从每次创作里，看见孩子正在形成的学习力量。</h3><p>依据课程作品、课堂照片、视频与老师观察形成，用于学习陪伴与课程规划，不作为医学、心理或智力诊断。</p></div><button onClick={()=>setOpen(!open)}>{open?'收起测评报告':'查看学能测评报告'} <ArrowRight/></button>{open?<><LearningRadar/><div className="assessment-grid">{rows.map(([name,copy,status])=><article key={name}><b>{name}</b><p>{copy}</p><span>{status}</span></article>)}</div></>:null}</section>
}

function OnlineExhibition(){
  const [active,setActive]=useState('向着光的花');
  const works=['向着光的花','海底世界','彩色的家','春日小径'];
  return <section className="online-exhibition"><div className="exhibition-head"><div><span>陈一诺 · 2026 春季作品展</span><h3>走进她的色彩美术馆。</h3><p>AI 为每一幅作品布置独立展墙与展签，保留作品原本的线条和色彩。</p></div><button><Frame/>进入全屏展览</button></div><div className="virtual-gallery"><div className="gallery-ceiling-light"/>{works.map((work,index)=><button key={work} className={`gallery-work work-${index} ${active===work?'active':''}`} onClick={()=>setActive(work)}><div className="gallery-frame-work"><i/></div><span>陈一诺</span><b>《{work}》</b><small>2026 春季创作</small></button>)}</div><div className="exhibition-footer"><span>当前展出：<b>《{active}》</b></span><p>点击任意作品，进入这幅画的创作故事与课堂记录。</p></div></section>
}

function GrowthArchiveBuilder({setToast}){
 const [period,setPeriod]=useState('一学期'),[format,setFormat]=useState('成长集锦'),[generated,setGenerated]=useState(false);
 const formats=[['成长集锦',Image,'作品、照片、点评与成长数据'],['作品集',Frame,'AI 布置成线上美术馆展览'],['成长记录（视频）',Film,'课堂视频与成长瞬间剪辑']];
 const reportItems=[['美术能力','从大胆用色，进步到能主动组织冷暖关系与画面主次。'],['课堂表现','专注时间更稳定，愿意分享想法，也能倾听并完成自己的创作。'],['本阶段进步','从“完成作品”走向“用画讲述自己的故事”。'],['下一阶段学习规划','围绕色彩层次、构图观察与主题表达，每两周保留一次作品回看与自主讲述。'],['给家长的陪伴建议','先请孩子讲创作，再问一个具体问题；把她的表达当作成长线索，而非对错答案。'],['老师寄语','愿一诺继续带着好奇与勇气，在每一次落笔里长出更清晰的自己。']];
 return <><PageHeader title="成长档案" desc="让看得见的服务，沉淀成孩子可感知的进步与下一步学习方向。" prd={PRD.archives}/><section className="growth-builder"><div className="growth-builder-top"><div><h2>把一次次认真，连成清晰的成长轨迹。</h2><p>按日期串联作品、课堂照片、每节课的点评与阶段总结，让家长清楚看见孩子的学习状态。</p></div><img src={pandaObserve} alt="熊猫成长伙伴"/></div><div className="growth-controls"><label>选择学员<select><option>陈一诺 · 7岁</option><option>林小满 · 8岁</option></select></label><label>选择班级<select><option>周六创意绘画 2 班</option><option>色彩启蒙班</option></select></label></div><div className="period-picker"><b>生成周期</b><div>{['半学期','一学期','一年度','自定义时间'].map(item=><button key={item} className={period===item?'active':''} onClick={()=>setPeriod(item)}>{item}</button>)}</div></div><div className="archive-format-picker"><b>选择生成内容</b><div>{formats.map(([name,Icon,desc])=><button key={name} className={format===name?'active':''} onClick={()=>{setFormat(name);setGenerated(false)}}><Icon/><span><strong>{name}</strong><small>{desc}</small></span></button>)}</div></div><Button icon={FileText} onClick={()=>{setGenerated(true);setToast(`${period}${format}已生成`)}}>生成{period}{format}</Button>{generated?<section className="growth-report-preview"><div className="report-title"><span>陈一诺 · {period}{format}</span><h2>{format==='作品集'?'这一次的作品，正在自己的美术馆里发光。':format==='成长记录（视频）'?'这一阶段的认真，值得被温柔回看。':'这一次的成长，已经被完整看见。'}</h2><p>共记录 12 次课程 · 26 幅作品 · 18 张课堂照片 · 6 段成长影像</p></div>{format==='成长记录（视频）'?<div className="growth-video-hero"><Film/><b>陈一诺 · {period}成长记录</b><small>作品、课堂高光与老师寄语 · 02:16</small></div>:format==='作品集'?<OnlineExhibition/>:<><CourseLearningTimeline/><div className="growth-report-grid">{reportItems.map(([title,copy])=><article key={title}><b>{title}</b><p>{copy}</p></article>)}</div><AcademicAssessment/></>}<div className="report-footer"><span>下一阶段：色彩表达与构图观察 · 建议继续学习 12 次</span><Button icon={MessageSquareText} onClick={()=>setToast('家长版成长档案链接已生成')}>生成家长版并转发</Button></div></section>:null}</section></>;
}

function StudentArchiveHubLegacy(){
  const [student,setStudent]=useState('陈一诺');
  const [tab,setTab]=useState('档案概览');
  const [assessment,setAssessment]=useState('新生试课');
  const [saved,setSaved]=useState(false);
  const tabs=['档案概览','入学 / 学期测评','课程作品','阶段报告'];
  const studentData={
    '陈一诺':{age:'7岁',lessons:'12',expect:'希望在色彩表达中更敢于讲出自己的想法。',ability:'喜欢明亮色彩，已能观察冷暖关系；构图组织正在建立。'},
    '林小满':{age:'8岁',lessons:'9',expect:'希望提升观察力与耐心，找到属于自己的绘画节奏。',ability:'线条细腻，愿意反复观察；画面主次需要继续练习。'},
    '赵禾':{age:'9岁',lessons:'15',expect:'希望在素描基础与空间表达上获得系统提升。',ability:'造型意识较强，画面细节丰富；光影观察需要持续积累。'}
  };
  const profile=studentData[student];
  return <><PageHeader title="班级学员" desc="每个孩子从第一次相遇开始，都有一份持续生长的教育档案。" prd={PRD.classes}/><section className="student-archive-hub"><aside className="archive-student-rail"><div><b>我的学员</b><small>周六创意绘画 2 班</small></div>{Object.keys(studentData).map((name,index)=><button key={name} className={student===name?'active':''} onClick={()=>{setStudent(name);setTab('档案概览')}}><span className={`avatar lg a${index}`}>{name[0]}</span><div><b>{name}</b><small>{studentData[name].age} · 已上 {studentData[name].lessons} 课时</small></div><ArrowRight/></button>)}<button className="new-student-entry"><Plus/>新建学员档案</button></aside><main className="student-archive-main"><header className="student-archive-head"><div><span>{student} · 个人成长档案</span><h2>每一次表达，都成为下一次成长的线索。</h2><p>{profile.age} · 周六创意绘画 2 班 · 已留存 {profile.lessons} 节课记录</p></div><Button icon={FileText}>分享给家长</Button></header><nav className="student-archive-tabs">{tabs.map(item=><button key={item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}</button>)}</nav>{tab==='档案概览'?<div className="student-profile-form"><section><div className="profile-section-head"><div><b>入档信息</b><span>第一次沟通时建立，老师可持续更新</span></div><button onClick={()=>setSaved(true)}>{saved?'已保存':'保存档案'}</button></div><div className="profile-fields"><label>孩子的学习期待<textarea defaultValue={profile.expect}/></label><label>当前阶段能力<textarea defaultValue={profile.ability}/></label><label>老师首次观察<textarea defaultValue="在试课中愿意尝试新颜色；先观察后落笔，表达时需要一点等待和鼓励。"/></label><label>家长希望获得的支持<textarea defaultValue="希望孩子能放松创作，也更自信地表达自己的想法。"/></label></div></section><section className="profile-growth-route"><div><b>成长档案会持续收录</b><span>不是一次填写完毕，而是陪伴孩子一路生长。</span></div><div>{[['每次课','作品、照片、视频与课堂点评'],['每个阶段','成长报告、学能测评与学习规划'],['每个学期','前后测对比、家长沟通建议与续学方向']].map(([title,desc])=><article key={title}><i/><b>{title}</b><p>{desc}</p></article>)}</div></section></div>:null}{tab==='入学 / 学期测评'?<section className="assessment-center"><div className="assessment-mode"><div><b>测评类型</b><p>新生试课用于建立教育基线；新学期前复测，用于学期末看见真实变化。</p></div><div>{['新生试课','学期前复测','学期末对比'].map(item=><button key={item} className={assessment===item?'active':''} onClick={()=>setAssessment(item)}>{item}</button>)}</div></div><div className="assessment-overview"><div><span>{assessment}</span><h3>{assessment==='新生试课'?'先看见孩子，再决定怎样陪伴她。':assessment==='学期前复测'?'让新的学习，从清楚的起点开始。':'把这一学期的努力，变成看得见的变化。'}</h3><p>评估维度包含美术能力、学习能力、表达与互动、创作状态和成长支持方向；所有结论来自课堂任务、作品与老师观察。</p><Button icon={Sparkles}>开始本次测评</Button></div><LearningRadar/></div><div className="assessment-compare"><div><b>家长一眼看懂的对比</b><span>当前为课堂观察数据，不用于医学、心理或智力诊断。</span></div>{[['美术观察','72','86'],['专注坚持','66','78'],['表达叙事','61','82'],['规划执行','58','71'],['审美创造','77','91']].map(([name,before,now])=><article key={name}><b>{name}</b><div><i style={{width:`${before}%`}}/><em style={{width:`${now}%`}}/></div><span>入学 {before}</span><strong>当前 {now}</strong></article>)}</div><div className="parent-conversation"><b>本次家长沟通建议</b><p>先告诉家长孩子已经展现出的优势，再共同确认一个本阶段可支持的小目标：例如“每次创作前，先和孩子一起说一说画面里最想表达的一个重点”。</p><button>生成沟通纪要 <ArrowRight/></button></div></section>:null}{tab==='课程作品'?<section className="student-work-archive"><div><b>每节课的作品与记录</b><span>作品、课堂照片和老师点评按上课日期一一留存。</span></div>{[['03.08','向着光的花','大胆用色，愿意分享画里的故事。'],['03.15','海底世界','主动组织大小关系，专注完成细节。'],['03.22','缺课记录','这一次没能来到课堂，我们把这段空白轻轻留在成长轨迹里。'],['04.05','彩色的家','能在提示后调整画面，让色彩层次更丰富。']].map((item,index)=><article className={index===2?'absent':''} key={item[0]}><time>{item[0]}</time>{index===2?<div><b>{item[1]}</b><p>{item[2]}</p></div>:<><div className={`student-work-thumb s${index}`}/><div className="student-photo-thumb"><img src={pandaWave} alt={`${item[1]}课堂照片`}/></div><div><b>《{item[1]}》</b><p>{item[2]}</p><button>查看完整点评 <ArrowRight/></button></div></>}</article>)}</section>:null}{tab==='阶段报告'?<section className="student-reports"><div className="report-card-primary"><span>2026 春季 · 阶段成长报告</span><h3>这一次的成长，已经被完整看见。</h3><p>包含全部课程记录、作品、照片、阶段总结、学能测评与下一阶段学习规划。</p><Button icon={FileText}>查看完整报告</Button></div><div className="report-mini-grid">{[['成长集锦','作品、照片、课程点评与成长雷达'],['线上作品展','陈一诺的春季线上美术馆'],['成长记录（视频）','课堂高光与老师寄语']].map(([title,desc])=><article key={title}><b>{title}</b><p>{desc}</p><button>查看 <ArrowRight/></button></article>)}</div></section>:null}</main></section></>;
}

function StudentArchiveHub(){
 const [student,setStudent]=useState('陈一诺'),[tab,setTab]=useState('基础档案'),[saved,setSaved]=useState(false);
 const people={
  '陈一诺':{age:'7岁',birth:'2019-04-18',gender:'女',source:'家长朋友转介绍',experience:'有半年儿童画学习经历',expect:'希望更自信地表达自己的想法。'},
  '林小满':{age:'8岁',birth:'2018-09-06',gender:'女',source:'小红书内容了解',experience:'无系统学习经历',expect:'希望在观察和耐心上有更多进步。'},
  '赵禾':{age:'9岁',birth:'2017-01-22',gender:'男',source:'校区路过咨询',experience:'学过一年创意美术',expect:'希望获得更系统的造型与色彩训练。'}
 };
 const profile=people[student];
 return <><PageHeader title="学员档案" desc="从第一次沟通开始，为每个孩子建立可持续生长的教育档案。" prd={PRD.classes}/><section className="student-archive-hub"><aside className="archive-student-rail"><div><b>我的学员</b><small>周六创意绘画 2 班</small></div>{Object.keys(people).map((name,index)=><button key={name} className={student===name?'active':''} onClick={()=>{setStudent(name);setTab('基础档案')}}><span className={`avatar lg a${index}`}>{name[0]}</span><div><b>{name}</b><small>{people[name].age} · 成长档案</small></div><ArrowRight/></button>)}<button className="new-student-entry"><Plus/>新建学员档案</button></aside><main className="student-archive-main"><header className="student-archive-head"><div><span>{student} · 个人成长档案</span><h2>让孩子的每一步，都有温柔而清晰的记录。</h2><p>{profile.age} · 已归档 12 节课 · 26 幅作品</p></div><Button icon={FileText}>分享给家长</Button></header><nav className="student-archive-tabs">{['基础档案','入学 / 学期测评','课程作品','阶段报告'].map(item=><button key={item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}</button>)}</nav>{tab==='基础档案'?<section className="student-profile-form"><div className="profile-section-head"><div><b>学员基础信息</b><span>首次建立档案时填写；信息会成为后续教学与沟通的背景。</span></div><button onClick={()=>setSaved(true)}>{saved?'已保存':'保存档案'}</button></div><div className="base-info-grid"><label>姓名<input defaultValue={student}/></label><label>性别<select defaultValue={profile.gender}><option>女</option><option>男</option><option>其他 / 暂不填写</option></select></label><label>出生年月日<input type="date" defaultValue={profile.birth}/></label><label>当前年龄<input defaultValue={profile.age}/></label><label>是否有学习经历<select defaultValue={profile.experience}><option>无系统学习经历</option><option>有半年儿童画学习经历</option><option>有一年以上美术学习经历</option></select></label><label>了解机构的渠道<select defaultValue={profile.source}><option>家长朋友转介绍</option><option>小红书内容了解</option><option>校区路过咨询</option><option>活动 / 公开课</option></select></label></div><div className="profile-fields"><label>孩子与家长的学习期待<textarea defaultValue={profile.expect}/></label><label>当前阶段能力与偏好<textarea defaultValue="喜欢明亮色彩，愿意尝试；画面组织与自主表达正在建立。"/></label><label>老师首次观察<textarea defaultValue="愿意参与任务，开始时稍有犹豫；得到具体鼓励后能持续完成作品。"/></label><label>家长沟通备注<textarea defaultValue="家长希望孩子享受创作过程，也期待看到明确的阶段进步。"/></label></div></section>:null}{tab==='入学 / 学期测评'?<StudentAssessment student={student}/>:null}{tab==='课程作品'?<CourseLearningTimeline/>:null}{tab==='阶段报告'?<section className="student-reports"><div className="report-card-primary"><span>2026 春季 · 阶段成长报告</span><h3>这一次的成长，已经被完整看见。</h3><p>包含作品、照片、每节课点评、成长数据和下阶段学习规划。</p><Button icon={FileText}>查看完整报告</Button></div><div className="report-mini-grid">{[['成长集锦','作品、照片、课堂点评与成长雷达'],['线上作品展','陈一诺的春季线上美术馆'],['成长记录（视频）','课堂高光与老师寄语']].map(([title,desc])=><article key={title}><b>{title}</b><p>{desc}</p><button>查看 <ArrowRight/></button></article>)}</div></section>:null}</main></section></>;
}

function StudentAssessment({student}){const [type,setType]=useState('新生试课');return <section className="assessment-center"><div className="assessment-mode"><div><b>测评类型</b><p>新生试课建立教育基线；新学期前复测；学期末以同一维度看见具体变化。</p></div><div>{['新生试课','学期前复测','学期末对比'].map(item=><button key={item} className={type===item?'active':''} onClick={()=>setType(item)}>{item}</button>)}</div></div><div className="assessment-overview"><div><span>{student} · {type}</span><h3>{type==='新生试课'?'先理解孩子，再开始适合她的陪伴。':type==='学期前复测'?'让新的学习，从清楚的起点开始。':'这一学期的努力，正在变成看得见的变化。'}</h3><p>从美术观察、造型色彩、专注、表达叙事、规划执行、审美创造与互动协作七个维度观察。</p><Button icon={Sparkles}>开始本次测评</Button></div><LearningRadar/></div><div className="assessment-compare"><div><b>阶段前后对比</b><span>数据来自课堂任务、作品与老师观察，不作医学、心理或智力诊断。</span></div>{[['美术观察','72','86'],['造型色彩','68','83'],['专注坚持','66','78'],['表达叙事','61','82'],['规划执行','58','71'],['审美创造','77','91']].map(([name,before,now])=><article key={name}><b>{name}</b><div><i style={{width:`${before}%`}}/><em style={{width:`${now}%`}}/></div><span>起点 {before}</span><strong>当前 {now}</strong></article>)}</div><div className="parent-conversation"><b>与家长的沟通建议</b><p>先分享孩子已经拥有的力量，再一起确定一个可实践的小目标：下次创作前，邀请孩子说出“我最想画的一个重点”。</p><button>生成沟通纪要 <ArrowRight/></button></div></section>}

function TeacherAIWorkspace({navigate}){const [zone,setZone]=useState('课前工作');const zones={
 '课前工作':[['课程灵感与教案','按年龄、主题和材料生成可编辑教案'],['备课材料清单','自动整理材料、步骤与安全提醒'],['学员课前画像','快速了解期待、能力与上次课观察']],
 '课中支持':[['课堂观察速记','语音转文字，留存孩子的关键表现'],['课堂提问卡','生成启发式问题，帮助孩子表达'],['课堂素材采集','按学员归档照片、视频和作品']],
 '课后反馈':[['智能装裱','作品、照片、视频的一键专业呈现'],['五维点评','基于本次素材生成可编辑观察'],['成长档案','归档课程记录并生成阶段报告']],
 '宣传招生':[['体验课邀约','生成不同家长人群的邀约文案'],['课程亮点海报','整理主题、作品与活动信息'],['家长案例素材','把真实成长过程整理成合规内容']],
 '转介绍':[['阶段成果分享','将成长数据转成可分享的家长版内容'],['家长感谢卡','生成克制而有温度的感谢与回访文案'],['转介绍沟通建议','基于满意度和阶段成果生成建议话术']]
 };return <><PageHeader title="AI助手" desc="围绕美术老师真实工作场景，让每一段时间都被更好地节省下来。" prd={PRD.ai}/><section className="teacher-ai-workspace"><div className="ai-zone-nav">{Object.keys(zones).map(name=><button key={name} className={zone===name?'active':''} onClick={()=>setZone(name)}>{name}</button>)}</div><div className="ai-zone-intro"><div><span>{zone}</span><h2>{zone==='课前工作'?'把准备，留给真正重要的孩子。':zone==='课中支持'?'让观察发生在课堂，而不打断课堂。':zone==='课后反馈'?'把辛苦的整理，交给 AI 完成。':zone==='宣传招生'?'把真实的教育价值，说得更清楚。':'让被看见的成长，自然产生口碑。'}</h2><p>选择一个工具进入，不需要在复杂功能里来回寻找。</p></div><img src={pandaWave} alt="熊猫工作伙伴"/></div><div className="ai-work-cards">{zones[zone].map(([name,desc],i)=><button key={name} onClick={()=>navigate(zone==='课后反馈'?'teacherFlow':'create')}><span>0{i+1}</span><b>{name}</b><p>{desc}</p><ArrowRight/></button>)}</div></section></>}

function LearningRadar(){
 const dimensions=[['视觉空间','86'],['语言表达','82'],['自我管理','71'],['人际互动','76'],['身体协调','74'],['自然感知','79'],['节奏韵律','73'],['逻辑规划','68']];
 return <div className="holistic-radar"><div className="holistic-radar-visual"><svg viewBox="0 0 260 245" role="img" aria-label="八维课堂成长观察雷达图"><g className="holistic-grid"><polygon points="130,16 210,50 244,122 210,194 130,228 50,194 16,122 50,50"/><polygon points="130,48 187,72 211,122 187,172 130,196 73,172 49,122 73,72"/><polygon points="130,80 164,94 178,122 164,150 130,164 96,150 82,122 96,94"/><path d="M130 16V228M16 122H244M50 50L210 194M210 50L50 194"/></g><polygon className="holistic-fill" points="130,33 192,72 177,146 180,160 130,202 69,170 47,122 82,94"/></svg>{dimensions.map(([label,value],i)=><span className={`holistic-label h${i}`} key={label}><b>{label}</b><em>{value}</em></span>)}</div><div className="holistic-radar-copy"><b>八维成长全景</b><p>这不是给孩子排名，而是帮助老师和家长看见：她现在最有力量的地方在哪里，下一步需要怎样支持。</p><div><span><i className="strength"/>优势线索：视觉空间、语言表达</span><span><i className="support"/>支持重点：逻辑规划、自我管理</span></div></div></div>
}

function PersonalGrowthCenterLegacy({role,setToast}){
 const [topic,setTopic]=useState('今日成长');
 const [done,setDone]=useState(false);
 const teacher=role==='teacher';
 const topics=teacher?['今日成长','课堂观察','家长沟通','教育阅读','AI 效率']:['今日成长','亲子陪伴','读懂孩子','亲子阅读','家庭行动'];
 const learning=teacher?{
  '今日成长':{title:'孩子犹豫时，老师可以先给“具体的允许”。',copy:'与其急着教孩子怎么画，不如先告诉她：“你可以先试一小块，画错也没关系。” 这会保护探索的安全感。',action:'今天课堂里，记录一位孩子犹豫后重新投入的瞬间。'},
  '课堂观察':{title:'观察行为，不急着解释孩子。',copy:'把“她不专心”换成“她在 8 分钟后开始看向窗外，老师提醒后回到画面”。具体记录，才是有依据的教育观察。',action:'用“我看见……”写下一条课堂观察。'},
  '家长沟通':{title:'先分享孩子的力量，再讨论需要支持的地方。',copy:'家长更容易接住具体、温和、有证据的反馈。先让家长知道孩子被真正看见，再共同商量下一步。',action:'选择一位孩子，写下一句可分享给家长的具体肯定。'},
  '教育阅读':{title:'读懂发展规律，才不会催促成长。',copy:'同年龄孩子的发展节奏也不同。教育者需要提供合适的环境和支持，而不是用单一标准比较孩子。',action:'阅读 5 分钟：儿童绘画发展中的“符号表达”阶段。'},
  'AI 效率':{title:'把重复整理交给 AI，把注意力留给孩子。',copy:'用 AI 整理素材、生成初稿和沉淀记录；老师仍然负责观察、判断与最后的温度。',action:'尝试用 AI 把一次课堂观察整理成点评初稿。'}
 }:{
  '今日成长':{title:'孩子需要的，常常是一位愿意听她讲完的大人。',copy:'当孩子展示作品时，先说“我想听听你画了什么”，比“真好看”更能让她感到被理解。',action:'今天用 10 分钟，请孩子讲一讲最近的一幅画。'},
  '亲子陪伴':{title:'少一点替孩子完成，多一点陪她自己发现。',copy:'孩子卡住时，可以问：“你想先从哪里开始？” 给选择、给等待，比直接给答案更有力量。',action:'本周一次：遇到孩子求助时，先等待 10 秒再回应。'},
  '读懂孩子':{title:'作品是表达的入口，不是给孩子下结论的依据。',copy:'颜色、构图和主题可以帮助我们开启对话，但不能替代对孩子真实感受的倾听。',action:'围绕作品问一个开放问题：“画里谁最想说话？”'},
  '亲子阅读':{title:'共读不是完成任务，而是共享一段安静的连接。',copy:'每天 10 分钟，允许孩子翻页、停留、提问，甚至只看图。被尊重的阅读体验会慢慢长出兴趣。',action:'今晚共读 10 分钟，让孩子决定从哪一页开始。'},
  '家庭行动':{title:'成长不需要很多大事，只需要稳定的小行动。',copy:'一个被坚持的小习惯，会让孩子在日常中感到确定和被支持。',action:'本周家庭行动：完成一次“作品故事夜”。'}
 };
 const active=learning[topic];
 const recommendations=teacher?[['来自学员档案的推荐','陈一诺的“规划执行”正在建立：试试课堂提问《你准备先画哪里？》'],['本周共学','如何把作品点评从“好不好”变成“看见了什么”'],['成长工具','五分钟课堂观察记录卡']]:[['来自孩子档案的推荐','一诺正在练习“表达叙事”：试试《如何听孩子讲一幅画》'],['本周共学','当孩子说“我不会”时，家长可以怎样回应'],['成长工具','亲子共读 10 分钟行动卡']];
 return <><PageHeader title="个人成长中心" desc={teacher?'让专业持续生长，让陪伴更有力量。':'和孩子一起成长，也把自己慢慢照顾好。'} prd="MVP-个人成长中心"/><section className="growth-center"><div className="growth-center-hero"><div><span>{teacher?'老师成长路径':'家庭成长路径'}</span><h2>{teacher?'今天也把一点时间，留给自己的教育成长。':'当我们愿意学习，孩子也会在被理解中慢慢长大。'}</h2><p>每天只需要五到十分钟，学一点、做一点、记录一点。</p></div><img src={pandaObserve} alt="熊猫成长伙伴"/></div><nav className="growth-topic-nav">{topics.map(item=><button key={item} className={topic===item?'active':''} onClick={()=>{setTopic(item);setDone(false)}}>{item}</button>)}</nav><div className="growth-today"><article><span>今天值得学习的一件事</span><h3>{active.title}</h3><p>{active.copy}</p><button onClick={()=>setToast('已加入我的学习清单')}>收藏这一课 <BookOpen/></button></article><aside><span>本周成长行动</span><b>{active.action}</b><p>{done?'已完成，给自己的坚持点个赞。':'完成后点一下，让成长留下小小的足迹。'}</p><Button icon={done?Check:Sparkles} onClick={()=>setDone(!done)}>{done?'本周行动已完成':'完成本周行动'}</Button></aside></div><div className="growth-recommendations"><div className="recommendation-title"><div><b>为你推荐</b><span>根据{teacher?'学员档案与日常教学':'孩子档案与当前陪伴需要'}整理</span></div><button>查看学习路径 <ArrowRight/></button></div>{recommendations.map(([tag,content],index)=><article key={tag}><span>0{index+1}</span><b>{tag}</b><p>{content}</p><button>开始学习 <ArrowRight/></button></article>)}</div><div className="growth-center-note"><Sparkles/><div><b>成长中心会持续连接你的真实生活。</b><span>后续将逐步加入本地升学政策、主题共学和经过审核的专业内容；政策信息会标明地区、来源与核验日期。</span></div></div></section></>;
}

function GrowthQA({teacher}){
 const [question,setQuestion]=useState(''); const [answer,setAnswer]=useState(null);
 const prompts=teacher?['孩子总说“我不会”，课堂上怎么回应？','怎样把对孩子的观察说给家长听？','孩子今天不愿意画，老师怎么办？']:['孩子总说“我不会”，我该怎么回应？','孩子画画时坐不住，怎么办？','怎样和孩子聊她的作品？'];
 const solve=(value)=>{const q=value||question;if(!q.trim())return;const text=q.includes('不会')?'先接住感受：“你觉得这里有点难，是吗？” 再把任务缩小成一个可尝试的动作：“我们先一起选一个颜色，画一小块。” 让孩子获得一次可完成的经验，再决定下一步。':q.includes('坐不住')?'先看具体情境：是任务太难、等待太久，还是环境干扰？可以把活动拆成 5–8 分钟的小目标，安排一次身体活动，再回到创作。若这种困难跨场景持续影响生活，建议和专业人士进一步沟通。':q.includes('家长')?'用“作品/课堂里我看见了什么 → 这说明孩子正在练习什么 → 家庭可以怎样支持”的顺序沟通。避免给孩子贴标签，也避免把一次课堂表现扩大成结论。':'从作品细节开始，不急着评价。可以问：“你最想让我先看哪里？” “这幅画里发生了什么？” 听完后复述孩子的话，让她知道自己的表达被认真接住。';setQuestion(q);setAnswer(text)};
 return <section className="growth-qa"><div><span>随时问一问</span><h3>{teacher?'你的教育成长搭档，在日常工作里陪你一起想。':'遇到育儿小问题，先来这里一起理一理。'}</h3><p>回答提供教育陪伴思路与可执行做法；如涉及孩子安全、健康、持续情绪困扰或发展疑虑，会建议寻求相应专业支持。</p></div><div className="qa-input"><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder={teacher?'例如：孩子不愿意动笔，怎么开始陪她？':'例如：孩子不愿意分享作品，我该怎么聊？'}/><Button icon={Sparkles} onClick={()=>solve()}>问一问</Button></div><div className="qa-prompts">{prompts.map(item=><button key={item} onClick={()=>solve(item)}>{item}</button>)}</div>{answer?<div className="qa-answer"><b>给你的建议</b><p>{answer}</p><span>你可以继续追问，或把这个方法加入本周行动。</span></div>:null}</section>
}

function PersonalGrowthCenterV1({role,setToast}){
 const [topic,setTopic]=useState('今日成长'); const [done,setDone]=useState(false); const teacher=role==='teacher';
 const content=teacher?[
  ['课堂观察','用事实记录孩子，而不是用标签定义孩子。','把“她不专心”改成“她在 8 分钟后看向窗外，提醒后回到作品”。'],
  ['家长沟通','先让家长看见孩子的力量，再讨论需要支持的地方。','把一次课堂的具体细节，转成家长今天就能做的一句话。'],
  ['教育阅读','尊重发展节奏，比急着纠正更重要。','理解儿童绘画从符号表达走向画面组织的自然过程。']
 ]:[
  ['亲子陪伴','孩子需要的，常常是一位愿意听她讲完的大人。','先问“你最想让我看哪里？” 再听孩子讲她的作品。'],
  ['读懂孩子','作品是表达的入口，不是给孩子下结论的依据。','从颜色、故事和细节开启对话，不急着解释孩子。'],
  ['亲子阅读','共读是一段连接，不是一项任务。','每天十分钟，让孩子决定从哪一页开始。']
 ];
 const resources=teacher?[
  ['UNICEF · 学习中的玩耍','关于游戏如何支持儿童探索、创造和发展。','文章 / 视频','https://www.unicef.org/parenting/playbox'],
  ['Reading Rockets · 与孩子一起阅读','把阅读变成对话，为课堂语言表达积累素材。','文章 / 视频','https://www.readingrockets.org/literacy-home/reading-your-child'],
  ['HealthyChildren · 家庭沟通','理解孩子如何从大人的沟通方式中学习表达。','文章','https://www.healthychildren.org/English/family-life/family-dynamics/communication-discipline/Pages/Components-of-Good-Communication.aspx']
 ]:[
  ['UNICEF · 让游戏成为学习','用日常游戏支持孩子的探索、创造与情绪发展。','文章 / 视频','https://www.unicef.org/parenting/playbox'],
  ['Reading Rockets · 与孩子共读','把朗读变成故事、图画和感受的对话。','文章 / 视频','https://www.readingrockets.org/literacy-home/reading-your-child'],
  ['HealthyChildren · 从家开始学沟通','大人的倾听和表达，会成为孩子学习沟通的样子。','文章','https://www.healthychildren.org/English/family-life/family-dynamics/communication-discipline/Pages/Components-of-Good-Communication.aspx']
 ];
 const active=content.find(([name])=>name===topic)||content[0];
 return <><PageHeader title="个人成长中心" desc={teacher?'有依据地学习，更有力量地陪伴孩子。':'在陪伴孩子长大的路上，也照顾自己的成长。'} prd="MVP-个人成长中心"/><section className="growth-center"><div className="growth-center-hero"><div><span>{teacher?'老师成长路径':'家庭成长路径'}</span><h2>{teacher?'今天也把一点时间，留给自己的教育成长。':'当我们愿意学习，孩子会在被理解中慢慢长大。'}</h2><p>可信内容、日常问题与可执行行动，都在这里。</p></div><img src={pandaObserve} alt="熊猫成长伙伴"/></div><nav className="growth-topic-nav">{['今日成长',...content.map(([name])=>name)].map(item=><button key={item} className={topic===item?'active':''} onClick={()=>{setTopic(item);setDone(false)}}>{item}</button>)}</nav><div className="growth-today"><article><span>今天值得学习的一件事</span><h3>{active[1]}</h3><p>{active[2]}</p><button onClick={()=>setToast('已加入我的学习清单')}>收藏这一课 <BookOpen/></button></article><aside><span>本周成长行动</span><b>{teacher?'记录一位孩子本周的一个“重新投入”瞬间。':'完成一次 10 分钟的作品故事对话。'}</b><p>{done?'已完成。微小而稳定的行动，会慢慢改变陪伴的质量。':'完成后点一下，让成长留下小小的足迹。'}</p><Button icon={done?Check:Sparkles} onClick={()=>setDone(!done)}>{done?'本周行动已完成':'完成本周行动'}</Button></aside></div><section className="trusted-library"><div className="library-head"><div><b>精选内容</b><span>优先推荐权威儿童发展、教育与阅读机构的公开内容</span></div><button>浏览全部主题 <ArrowRight/></button></div><div>{resources.map(([title,desc,type,url],index)=><a href={url} key={title} target="_blank" rel="noreferrer"><span>0{index+1}</span><b>{title}</b><p>{desc}</p><small>{type} · 外部可信来源</small><ArrowRight/></a>)}</div></section><GrowthQA teacher={teacher}/><div className="growth-center-note"><Sparkles/><div><b>我们只推荐能说明来源的内容。</b><span>升学政策将按地区、学段、发布来源与核验日期呈现；涉及医疗、心理或安全风险的问题，会优先提示专业支持渠道。</span></div></div></section></>;
}

function AdmissionsNavigator(){
 const [city,setCity]=useState('全国政策框架'); const [stage,setStage]=useState('幼升小'); const [channel,setChannel]=useState('全部');
 const stages=['进幼儿园','幼升小','小升初','中考','高考'];
 const data={
  '进幼儿园':['重点查看年龄要求、报名材料、招生范围与园所办园资质。','当地教育局 / 区县教育行政部门、园所官方通知'],
  '幼升小':['重点查看义务教育招生时间、材料、学区/片区与各地实施细则。','市/区教育局官网、学校官方招生通知'],
  '小升初':['重点查看本地义务教育入学政策、报名流程、材料与时间节点。','市/区教育局官网、学校官方招生通知'],
  '中考':['重点查看本地中考报名、指标/名额分配、志愿与高中招生政策。','市教育局 / 教育考试院、学校官方通知'],
  '高考':['重点查看本省考试招生、选科要求、招生章程与阳光高考信息。','省教育考试院、阳光高考、高校官方招生网']
 };
 const routes=[['普通升学','入园、义务教育、中高考的基本流程与核验清单。'],['艺体发展','关注孩子长期兴趣与能力积累；具体招生资格、专业测试与录取规则必须以当年省市和学校官方通知为准。'],['竞赛活动','只查看主管部门公布或认可的活动；不把竞赛当作升学承诺。'],['多元通道','包括综合素质、特色项目、职业教育等信息，按当地政策与孩子实际情况了解。']];
 const visible=channel==='全部'?routes:routes.filter(([name])=>name===channel);
 return <section className="admissions-navigator"><div className="admissions-head"><div><span>升学信息导航</span><h3>先建立清晰框架，再查证当地最新信息。</h3><p>政策因地区、年份、学段和学校而异；这里帮家长找到该从哪里开始查、该问什么、该如何核验。</p></div><div className="policy-status"><b>信息使用提醒</b><span>最后核验：以当地教育行政部门当年公开通知为准</span></div></div><div className="admissions-filters"><label>所在地区<select value={city} onChange={e=>setCity(e.target.value)}><option>全国政策框架</option><option>北京市</option><option>上海市</option><option>广州市</option><option>深圳市</option><option>自定义地区（即将支持）</option></select></label><div>{stages.map(item=><button key={item} className={stage===item?'active':''} onClick={()=>setStage(item)}>{item}</button>)}</div></div><div className="stage-policy-card"><div><span>{city} · {stage}</span><h4>{data[stage][0]}</h4><p><b>优先核验：</b>{data[stage][1]}</p></div><button>查看本阶段清单 <ArrowRight/></button></div><div className="route-filter">{['全部',...routes.map(([name])=>name)].map(item=><button key={item} className={channel===item?'active':''} onClick={()=>setChannel(item)}>{item}</button>)}</div><div className="admissions-route-grid">{visible.map(([name,desc],index)=><article key={name}><span>0{index+1}</span><b>{name}</b><p>{desc}</p><button>了解这一通道 <ArrowRight/></button></article>)}</div><div className="official-policy-links"><b>权威政策入口</b><a href="https://www.moe.gov.cn/jyb_xxgk/xxgk/neirong/fenlei/sxml_jcjy/jcjy_ywjy/ywjy_rxzc/" target="_blank" rel="noreferrer">义务教育招生入学政策文件 <ArrowRight/></a><a href="https://www.moe.gov.cn/jyb_xxgk/xxgk/neirong/fenlei/sxml_gdjy/gdjy_gxzs/gxzs_zszcwj/" target="_blank" rel="noreferrer">高校招生政策文件 <ArrowRight/></a><a href="https://www.moe.gov.cn/srcsite/A29/202203/t20220314_607247.html" target="_blank" rel="noreferrer">全国性竞赛活动管理办法 <ArrowRight/></a></div></section>
}

function PersonalGrowthCenter({role,setToast}){
 const [view,setView]=useState('成长学习'); const teacher=role==='teacher';
 const resources=teacher?[['UNICEF · 学习中的玩耍','游戏如何支持儿童探索、创造与发展。','https://www.unicef.org/parenting/playbox'],['Reading Rockets · 与孩子一起阅读','把阅读变成对话，为课堂表达积累素材。','https://www.readingrockets.org/literacy-home/reading-your-child']]:[['UNICEF · 让游戏成为学习','用日常游戏支持探索、创造与情绪发展。','https://www.unicef.org/parenting/playbox'],['Reading Rockets · 与孩子共读','把朗读变成故事、图画和感受的对话。','https://www.readingrockets.org/literacy-home/reading-your-child']];
 return <><PageHeader title="个人成长中心" desc={teacher?'有依据地学习，更有力量地陪伴孩子。':'在陪伴孩子长大的路上，也照顾自己的成长。'} prd="MVP-个人成长中心"/><section className="growth-center"><div className="growth-center-hero"><div><span>{teacher?'老师成长路径':'家庭成长路径'}</span><h2>{teacher?'今天也把一点时间，留给自己的教育成长。':'当我们愿意学习，孩子会在被理解中慢慢长大。'}</h2><p>可信内容、日常问题与可执行行动，都在这里。</p></div><img src={pandaObserve} alt="熊猫成长伙伴"/></div><nav className="growth-topic-nav"><button className={view==='成长学习'?'active':''} onClick={()=>setView('成长学习')}>成长学习</button><button className={view==='升学信息'?'active':''} onClick={()=>setView('升学信息')}>升学信息导航</button></nav>{view==='升学信息'?<AdmissionsNavigator/>:<><div className="growth-today"><article><span>今天值得学习的一件事</span><h3>{teacher?'观察行为，不急着解释孩子。':'先听孩子把故事讲完，再说你的感受。'}</h3><p>{teacher?'用“我看见……”记录具体情境，再与家长沟通孩子正在练习什么。':'当孩子展示作品时，先问“你最想让我看哪里？” 让她知道自己的表达被认真接住。'}</p><button onClick={()=>setToast('已加入我的学习清单')}>收藏这一课 <BookOpen/></button></article><aside><span>本周成长行动</span><b>{teacher?'记录一位孩子重新投入创作的瞬间。':'完成一次 10 分钟的作品故事对话。'}</b><p>完成后点一下，让成长留下小小的足迹。</p><Button icon={Sparkles} onClick={()=>setToast('本周成长行动已完成')}>完成本周行动</Button></aside></div><section className="trusted-library"><div className="library-head"><div><b>精选内容</b><span>优先推荐权威儿童发展、教育与阅读机构的公开内容</span></div></div><div>{resources.map(([title,desc,url],index)=><a href={url} key={title} target="_blank" rel="noreferrer"><span>0{index+1}</span><b>{title}</b><p>{desc}</p><small>文章 / 视频 · 外部可信来源</small><ArrowRight/></a>)}</div></section><GrowthQA teacher={teacher}/></>}<div className="growth-center-note"><Sparkles/><div><b>我们只推荐能说明来源的内容。</b><span>涉及升学、竞赛和特色招生时，优先呈现官方来源与核验路径；涉及安全、健康或持续发展疑虑时，建议联系相应专业支持。</span></div></div></section></>;
}

// —— 老师人设 / 技能库 / 大模型记忆 与 装裱设置 ——

function PersonaPicker({profiles=[],activeProfileId,setActiveProfileId}){
  return <label className="persona-picker">由哪位老师的人设点评
    <select value={activeProfileId||''} onChange={event=>setActiveProfileId(event.target.value)}>
      {profiles.length?profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.name}{profile.roleLabel?` · ${profile.roleLabel}`:''}</option>):<option value="">默认人设</option>}
    </select>
    <small>人设、技能库与大模型记忆会一起加载进提示词。</small>
  </label>;
}

/**
 * 课后反馈步骤条。
 * 不用圆形序号表示选中：每一环节是一段进度条，
 *  - 当前环节：整段金色高亮；
 *  - 已完成环节：段内压深并换上对勾；
 *  - 未到达环节：整段置灰。
 * flags 是各环节的「真的做完了吗」，只有已走过的环节才会显示完成态。
 */
function FlowStepper({steps=[],step=1,flags=[],onGo}){
  const total=steps.length;
  return <nav className="flow-stepper" aria-label={`课后反馈共 ${total} 步，当前第 ${step} 步`}>
    {steps.map(([name,desc],index)=>{
      const stage=index+1;
      const active=step===stage;
      const done=stage<step&&Boolean(flags[index]);
      const state=active?'active':done?'done':'todo';
      return <button key={name} type="button" className={`flow-stepper-step ${state}`}
        aria-current={active?'step':undefined}
        aria-label={`第 ${stage} 步 ${name}：${desc}${done?'（已完成）':active?'（当前进行）':'（未开始）'}`}
        onClick={()=>onGo?.(stage)}>
        <span className="flow-stepper-title">
          <em aria-hidden="true">{done?<Check size={12}/>:stage}</em>
          <b>{name}</b>
        </span>
        <small>{desc}</small>
        <span className="flow-stepper-track" aria-hidden="true"><i/></span>
      </button>;
    })}
  </nav>;
}

function ReviewLaunchPanel({profiles=[],skillLibrary=[],activeProfileId,setActiveProfileId,onStart,onLocalDraft,hasArtwork,draftReady,localDraftUsed,keywordCount}){
  const active=profiles.find(profile=>profile.id===activeProfileId)||profiles[0]||null;
  const skills=resolveSkills(active?.skillKeys,skillLibrary,active?.skills);
  return <section className="review-launch">
    <div className="review-launch-head">
      <span>五维点评 · 云端视觉模型</span>
      <h3>让大模型带着老师的人设，先读懂这幅画。</h3>
      <p>一次生成会同时完成两件事：识别画面内容并自动勾选作品观察词，再按五个维度写下评语。人设、{skills.length} 项技能与长期记忆一起加载，单次约 20 秒，可随时停止。</p>
    </div>
    <PersonaPicker profiles={profiles} activeProfileId={activeProfileId} setActiveProfileId={setActiveProfileId}/>
    {active?<div className="persona-loaded">
      <div><b>已加载人设</b><span>{[active.name,active.roleLabel,active.campus].filter(Boolean).join(' · ')}</span></div>
      <div><b>长期记忆</b><span>{active.memory?`${active.memory.slice(0,46)}${active.memory.length>46?'…':''}`:'未填写'}</span></div>
      <div className="persona-skill-tags">{skills.length?skills.map(skill=><em key={skill.name}>{skill.name}</em>):<span>未启用技能</span>}</div>
    </div>:null}
    <div className="review-launch-actions">
      <Button icon={WandSparkles} onClick={onStart} disabled={!hasArtwork}>{hasArtwork?(draftReady?'重新生成点评':'开始生成点评'):'请先上传作品'}</Button>
      {onLocalDraft?<button type="button" className="local-draft-link" onClick={onLocalDraft}>
        {localDraftUsed?'已使用本地草稿 · 重新填充模板':'云端不可用？使用本地草稿模板'}
      </button>:null}
      <small>模型：{REVIEW_MODEL}{keywordCount?` · 已识别 ${keywordCount} 个观察词`:''}</small>
    </div>
  </section>;
}

function ReviewStreamPanel({stream,profiles=[],activeProfileId,setActiveProfileId,onStart,onStop,onClose,onLocalDraft}){
  const [showThinking,setShowThinking]=useState(true);
  const active=profiles.find(profile=>profile.id===activeProfileId)||profiles[0]||null;
  const running=stream.phase==='running';
  const live=readableFromRawJson(stream.content);
  return <section className="review-stream">
    <div className="review-stream-head">
      <div>
        <span>{running?'正在生成点评':'点评生成结果'}</span>
        <h3>{active?.name||'默认人设'} 正在观察这次创作</h3>
        <p>{running?`已用时 ${stream.elapsed} 秒 · 思考 ${stream.reasoning.length} 字 · 正文 ${stream.content.length} 字`:`共 ${stream.elapsed} 秒${stream.phase==='error'?' · 生成失败':''}`}</p>
      </div>
      <div className="review-stream-actions">
        {running?<button onClick={onStop}>停止生成</button>:<button onClick={onStart}>重新生成</button>}
        <button onClick={onClose}>收起</button>
      </div>
    </div>
    {stream.phase==='error'?<div className="review-stream-error"><CircleAlert/><span>{stream.message}</span>{onLocalDraft?<button type="button" className="local-draft-link" onClick={onLocalDraft}>改用本地草稿模板</button>:null}</div>:null}
    {stream.reasoning?<div className={`review-thinking ${showThinking?'open':''}`}>
      <button onClick={()=>setShowThinking(!showThinking)}>{showThinking?'收起':'展开'} AI 思考过程<ChevronDown size={16}/></button>
      {showThinking?<pre>{stream.reasoning}</pre>:null}
    </div>:null}
    {running?<div className="review-typing">
      <div className="review-typing-bar"><i style={{width:`${Math.min(96,stream.content.length/6)}%`}}/></div>
      <p>{live||stream.reasoning.slice(-160)||'正在读取作品与素材…'}</p>
    </div>:null}
    {!running&&stream.phase==='done'?<div className="review-stream-done"><Check/><span>点评草稿已写入下方五个维度，老师可直接编辑后再发布。</span></div>:null}
    <div className="review-stream-persona"><PersonaPicker profiles={profiles} activeProfileId={activeProfileId} setActiveProfileId={setActiveProfileId} disabled={running}/></div>
  </section>;
}

function TeacherPersonaPage({teacherProfiles=[],setTeacherProfiles,skillLibrary=[],setToast,navigate}){
  const [editingId,setEditingId]=useState(teacherProfiles[0]?.id||'');
  const editing=teacherProfiles.find(item=>item.id===editingId)||teacherProfiles[0]||null;
  const [draft,setDraft]=useState(()=>editing?{...editing,skillKeys:[...(editing.skillKeys||[])]}:null);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{setDraft(editing?{...editing,skillKeys:[...(editing.skillKeys||[])]}:null)},[editingId,teacherProfiles.length]);
  const patch=(key,value)=>setDraft(current=>current?{...current,[key]:value}:current);

  const commit=async(next)=>{
    const list=teacherProfiles.some(item=>item.id===next.id)?teacherProfiles.map(item=>item.id===next.id?next:item):[...teacherProfiles,next];
    setTeacherProfiles(list);
    setSaving(true);
    try{ await saveRemoteTeacherProfile(next); setToast(`「${next.name}」的人设已保存到云端`); }
    catch{ setToast('已保存到本地；云端暂未连通，稍后可重试。'); }
    finally{ setSaving(false); }
  };
  const remove=async(id)=>{
    if(teacherProfiles.length<2){setToast('至少保留一位老师人设');return;}
    const list=teacherProfiles.filter(item=>item.id!==id);
    setTeacherProfiles(list); setEditingId(list[0]?.id||'');
    try{ await deleteRemoteTeacherProfile(id); setToast('人设已删除'); }catch{ setToast('已从本地移除，云端删除未成功。'); }
  };
  // 人设不再自己维护技能内容，只在技能库里勾选。
  const toggleSkill=(skillId)=>{
    const current=Array.isArray(draft?.skillKeys)?draft.skillKeys:[];
    patch('skillKeys',current.includes(skillId)?current.filter(key=>key!==skillId):[...current,skillId]);
  };
  const selectableSkills=skillLibrary.filter(skill=>skill.enabled!==false);
  const disabledSkills=skillLibrary.filter(skill=>skill.enabled===false);
  const selectedCount=(draft?.skillKeys||[]).filter(key=>selectableSkills.some(skill=>skill.id===key)).length;
  const groupedCategories=[...new Set(selectableSkills.map(skill=>skill.category||'未分类'))];

  return <>
    <PageHeader title="老师人设" desc="人设、勾选的技能与大模型记忆会一起加载给模型；技能本身在「技能库」中维护。" prd="PRD-4 / F-AI-PERSONA-01"
      actions={<Button icon={Plus} onClick={()=>{const next=createEmptyTeacherProfile();setTeacherProfiles([...teacherProfiles,next]);setEditingId(next.id);}}>新增人设</Button>}/>
    <div className="split-page persona-page">
      <div className="panel persona-list">
        <div className="panel-head"><h2>人设列表</h2><small>{teacherProfiles.length} 位</small></div>
        {teacherProfiles.map(profile=><button key={profile.id} className={profile.id===editingId?'active':''} onClick={()=>setEditingId(profile.id)}>
          <span className="avatar">{profile.name?profile.name[0]:'师'}</span>
          <div><b>{profile.name}</b><small>{[profile.roleLabel,profile.campus].filter(Boolean).join(' · ')||'未填写'}</small></div>
          <em>{resolveSkills(profile.skillKeys,skillLibrary,profile.skills).length} 技能</em>
        </button>)}
      </div>
      <div className="panel persona-editor">
        {draft?<>
          <div className="panel-head"><div><h2>{draft.name||'未命名老师'}</h2><p>人设越具体，点评越像这位老师说的话。</p></div>
            <div className="row-actions">
              <button className="text-link" disabled={saving} onClick={()=>commit(draft)}>{saving?'保存中…':'保存到云端'}</button>
              <button className="icon-btn danger-text" title="删除" onClick={()=>remove(draft.id)}><Trash2 size={16}/></button>
            </div>
          </div>
          <div className="form-grid compact">
            <label>姓名<input value={draft.name||''} onChange={event=>patch('name',event.target.value)}/></label>
            <label>职务<input value={draft.roleLabel||''} placeholder="例如：创意绘画主教" onChange={event=>patch('roleLabel',event.target.value)}/></label>
            <label>校区<input value={draft.campus||''} placeholder="例如：星河校区" onChange={event=>patch('campus',event.target.value)}/></label>
            <label>教龄（年）<input type="number" value={draft.years??''} onChange={event=>patch('years',event.target.value===''?null:Number(event.target.value))}/></label>
          </div>
          <label className="persona-field">教学信念<textarea rows={3} value={draft.beliefs||''} onChange={event=>patch('beliefs',event.target.value)} placeholder="例如：先看见孩子的表达，再谈技法。"/></label>
          <label className="persona-field">说话风格<textarea rows={3} value={draft.tone||''} onChange={event=>patch('tone',event.target.value)} placeholder="例如：温暖具体，多用「我看见……」句式。"/></label>
          <label className="persona-field">安全与伦理边界<textarea rows={3} value={draft.boundaries||''} onChange={event=>patch('boundaries',event.target.value)} placeholder="例如：不作心理诊断，不给孩子贴标签。"/></label>
          <label className="persona-field memory">大模型记忆<textarea rows={5} value={draft.memory||''} onChange={event=>patch('memory',event.target.value)} placeholder="写下需要模型长期记住的信息：孩子的用色习惯、上次给出的练习建议、需要回访的点……"/><small>这段文字会原样进入 system 提示词，并参与每次点评。</small></label>
          <div className="persona-skills">
            <div className="panel-head">
              <div><h3>勾选技能</h3><p>从技能库中勾选这位老师启用的技能。已勾选 {selectedCount} 项，会随人设一起写进提示词。</p></div>
              {navigate?<button className="text-link" onClick={()=>navigate('skillLibrary')}>去维护技能库 <ArrowRight size={14}/></button>:null}
            </div>
            {selectableSkills.length?groupedCategories.map(category=><div className="skill-pick-group" key={category}>
              <strong>{category}</strong>
              {selectableSkills.filter(skill=>(skill.category||'未分类')===category).map(skill=>{
                const checked=(draft.skillKeys||[]).includes(skill.id);
                return <label className={`skill-pick ${checked?'checked':''}`} key={skill.id}>
                  <input type="checkbox" checked={checked} onChange={()=>toggleSkill(skill.id)}/>
                  <span><b>{skill.name}</b><small>{skill.description||'未填写说明'}</small></span>
                </label>;
              })}
            </div>):<p className="persona-empty">技能库还是空的，请先到「技能库」里添加。</p>}
            {disabledSkills.length?<p className="persona-empty">另有 {disabledSkills.length} 项技能在库中已停用，不会进入点评。</p>:null}
          </div>
        </>:<p className="persona-empty">选择左侧的一位老师，或新增一位。</p>}
      </div>
    </div>
  </>;
}

// 技能来源徽标：手工维护 / 上传导入 / 本机发现 / 技能市场。
const SOURCE_LABEL={manual:'手工',upload:'上传',local:'本机',market:'市场'};
const AUDIT_TEXT={safe:'未发现风险特征',review:'含脚本文件，建议确认后导入',risky:'命中风险特征，请确认后再导入'};

// base64 归档还原成文件下载，让「装过的包随时可回溯」成立。
function downloadSkillPackage(skill){
  try{
    const name=(skill.packagePath||'').split('//')[1]||`${skill.name}.zip`;
    const binary=atob(skill.packageBlob);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
    const link=document.createElement('a');
    link.href=url; link.download=name; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
  }catch{ /* 归档数据损坏时静默失败：这只是回溯入口，不影响技能本身 */ }
}

function SkillImportPanel({skillLibrary=[],setSkillLibrary,setToast,onClose}){
  const [tab,setTab]=useState('upload');
  const [busy,setBusy]=useState(false);
  const [parsed,setParsed]=useState(null);
  const [error,setError]=useState('');
  const [keyword,setKeyword]=useState('');
  const [category,setCategory]=useState('all');
  const [dragging,setDragging]=useState(false);
  const inputRef=useRef(null);
  const installedRefs=new Set(skillLibrary.map(item=>item.originRef||item.id));

  const takeFile=async(file)=>{
    if(!file) return;
    setError(''); setBusy(true);
    try{ setParsed({...(await readSkillPackage(file)),file}); }
    catch(parseError){ setParsed(null); setError(parseError.message||'这个文件解析不出来。'); }
    finally{ setBusy(false); }
  };

  const commitUpload=async()=>{
    if(!parsed) return;
    setBusy(true);
    try{
      const skill=skillFromPackage(parsed,skillLibrary);
      // zip 原包以 base64 归档进技能行（匿名模式下云存储不可写，database 通道够用且真实）。
      if(parsed.kind==='zip'&&parsed.file){
        try{
          const archived=await archiveSkillPackage(parsed.file);
          if(archived&&archived.inlined){ skill.packageBlob=archived.base64; skill.packagePath=`inline://${parsed.sourceName}`; }
          else{ skill.packagePath=`manifest-only://${parsed.sourceName}`; }
        }catch{ skill.packagePath=`manifest-only://${parsed.sourceName||parsed.name}`; }
      }
      const list=[...skillLibrary,skill];
      setSkillLibrary(list);
      await saveRemoteSkill(skill);
      setToast(`技能「${skill.name}」已导入，人设立即可勾选`);
      setParsed(null); if(onClose) onClose();
    }catch(saveError){ setToast(saveError.message||'导入失败，请重试。'); }
    finally{ setBusy(false); }
  };

  const importEntry=async(entry,kind)=>{
    const skill=skillFromIndexEntry(entry,kind==='market'?'market':'local');
    if(skillLibrary.some(item=>item.id===skill.id)){ setToast(`「${skill.name}」已经在技能库里了`); return; }
    const list=[...skillLibrary,skill];
    setSkillLibrary(list);
    try{ await saveRemoteSkill(skill); setToast(`「${skill.name}」已加入技能库`); }
    catch{ setToast('已加入本地技能库；云端同步未成功，可稍后重试。'); }
  };

  const localHits=searchSkillIndex(keyword);
  const marketHits=searchMarket(keyword,category);

  return <section className="skill-import">
    <div className="skill-import-head">
      <div>
        <span>导入技能</span>
        <h3>从本地文件、本机已装技能或技能市场，把技能加进技能库。</h3>
      </div>
      <button className="icon-btn" title="收起" onClick={()=>onClose&&onClose()}><X size={16}/></button>
    </div>
    <div className="skill-import-tabs">
      {[['upload','上传本地',UploadCloud],['local','本机发现',Package],['market','技能市场',Store]].map(([key,label,Icon])=>
        <button key={key} className={tab===key?'active':''} onClick={()=>{setTab(key);setError('');}}><Icon size={15}/>{label}</button>)}
    </div>

    {tab==='upload'?<div className="skill-import-body">
      <div className={`skill-drop ${dragging?'over':''}`}
        onDragOver={event=>{event.preventDefault();setDragging(true)}}
        onDragLeave={()=>setDragging(false)}
        onDrop={event=>{event.preventDefault();setDragging(false);takeFile(event.dataTransfer.files&&event.dataTransfer.files[0])}}>
        <FileText size={22}/>
        <b>把技能包拖到这里</b>
        <small>支持 .zip 技能包（自动找包里的 SKILL.md）与单个 .md 技能文件</small>
        <button className="primary" disabled={busy} onClick={()=>inputRef.current&&inputRef.current.click()}>{busy?'解析中…':'选择文件'}</button>
        <input ref={inputRef} type="file" accept=".zip,.md,.markdown,text/markdown" hidden
          onChange={event=>{takeFile(event.target.files&&event.target.files[0]);event.target.value=''}}/>
      </div>
      {error?<p className="skill-import-error"><CircleAlert size={14}/>{error}</p>:null}
      {parsed?<div className="skill-audit">
        <div className="skill-audit-head">
          <div>
            <b>{parsed.displayName||parsed.name||'未命名技能'}</b>
            <small>{parsed.kind==='zip'?`技能包 · ${parsed.skillPath}`:'单个技能文件'}{parsed.version?` · v${parsed.version}`:''}{parsed.author?` · ${parsed.author}`:''}</small>
          </div>
          <span className={`audit-badge ${parsed.audit.level}`}>{AUDIT_TEXT[parsed.audit.level]}</span>
        </div>
        <p className="skill-audit-desc">{parsed.description||'（这份技能没有写 description，导入后可在右侧补充。）'}</p>
        <div className="skill-audit-files">
          <strong>包内 {parsed.files.length} 个文件{parsed.files.length>8?`，列出前 8 个`:''}</strong>
          <ul>{parsed.files.slice(0,8).map(file=><li key={file.path}><code>{file.path}</code><em>{file.size>1024?`${Math.round(file.size/1024)} KB`:`${file.size} B`}</em></li>)}</ul>
          {parsed.audit.scriptFiles.length?<p className="skill-audit-warn">含 {parsed.audit.scriptFiles.length} 个脚本文件：{parsed.audit.scriptFiles.slice(0,4).join('、')}</p>:null}
          {parsed.audit.hits.length?<p className="skill-audit-warn risky">命中 {parsed.audit.labels.length} 类风险特征：{parsed.audit.labels.join('、')}。导入只会把 SKILL.md 的说明写进提示词，不会执行包内任何脚本。</p>:null}
        </div>
        <div className="skill-audit-actions">
          <button className="primary" disabled={busy} onClick={commitUpload}>{busy?'导入中…':'确认导入技能库'}</button>
          <button onClick={()=>{setParsed(null);setError('')}}>取消</button>
        </div>
      </div>:null}
    </div>:null}

    {tab==='local'?<div className="skill-import-body">
      <div className="skill-import-search">
        <Search size={15}/>
        <input value={keyword} placeholder={`在本机已安装的 ${indexStats.local} 个技能里查找（find-skills）`} onChange={event=>setKeyword(event.target.value)}/>
      </div>
      <ul className="skill-index-list">
        {localHits.map(entry=>{
          const skillId=`idx-${entry.name}`;
          const done=installedRefs.has(entry.name)||skillLibrary.some(item=>item.id===skillId);
          return <li key={entry.name}>
            <div className="skill-index-main">
              <b>{entry.displayName}</b>
              <small>{entry.description}</small>
              <div className="skill-index-meta">
                <em>{entry.category}</em>
                {entry.version?<em>v{entry.version}</em>:null}
                <em>{entry.fileCount} 文件{entry.scriptCount?` · ${entry.scriptCount} 脚本`:''}{entry.referenceCount?` · ${entry.referenceCount} 参考`:''}</em>
              </div>
            </div>
            <button className={done?'done':''} disabled={done} onClick={()=>importEntry(entry,'local')}>{done?'已在库中':'导入'}</button>
          </li>;
        })}
        {!localHits.length?<li className="skill-index-empty">没有匹配的技能。</li>:null}
      </ul>
    </div>:null}

    {tab==='market'?<div className="skill-import-body">
      <div className="skill-import-search">
        <Search size={15}/>
        <input value={keyword} placeholder={`在技能市场的 ${indexStats.market} 个技能里搜索`} onChange={event=>setKeyword(event.target.value)}/>
      </div>
      <div className="skill-market-cats">
        {marketCategories.map(key=><button key={key} className={category===key?'active':''} onClick={()=>setCategory(key)}>{key==='all'?'全部':key}</button>)}
      </div>
      <ul className="skill-index-list">
        {marketHits.map(entry=>{
          const skillId=`mkt-${entry.name}`;
          const done=installedRefs.has(entry.name)||skillLibrary.some(item=>item.id===skillId);
          return <li key={entry.name}>
            <div className="skill-index-main">
              <b>{entry.displayName}{entry.installs?<span className="installs">{entry.installs>=10000?`${(entry.installs/10000).toFixed(1)} 万次安装`:`${entry.installs} 次安装`}</span>:null}</b>
              <small>{entry.description}</small>
              <div className="skill-index-meta">
                <em>{entry.category}</em>
                {entry.version?<em>v{entry.version}</em>:null}
                {entry.author?<em>{entry.author}</em>:null}
                {entry.license?<em>{entry.license}</em>:null}
                <em>{entry.marketSource==='skillhub'?'skillhub':'marketplace'}</em>
              </div>
            </div>
            <button className={done?'done':''} disabled={done} onClick={()=>importEntry(entry,'market')}>{done?'已安装':'安装'}</button>
          </li>;
        })}
        {!marketHits.length?<li className="skill-index-empty">没有匹配的技能。</li>:null}
      </ul>
      <p className="skill-import-note">市场目录同步于 {MARKETPLACE_SYNCED_AT}，共 {indexStats.market} 个技能，其中 {indexStats.withInstalls} 个带有真实安装量数据。</p>
    </div>:null}
  </section>;
}

function SkillLibraryPage({skillLibrary=[],setSkillLibrary,teacherProfiles=[],setToast}){
  const [editingId,setEditingId]=useState(skillLibrary[0]?.id||'');
  const [importOpen,setImportOpen]=useState(false);
  const editing=skillLibrary.find(item=>item.id===editingId)||skillLibrary[0]||null;
  const [draft,setDraft]=useState(()=>editing?{...editing}:null);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{setDraft(editing?{...editing}:null)},[editingId,skillLibrary.length]);
  const patch=(key,value)=>setDraft(current=>current?{...current,[key]:value}:current);
  const usersOf=(id)=>teacherProfiles.filter(profile=>(profile.skillKeys||[]).includes(id)).map(profile=>profile.name);

  const commit=async(next)=>{
    const list=skillLibrary.some(item=>item.id===next.id)?skillLibrary.map(item=>item.id===next.id?next:item):[...skillLibrary,next];
    setSkillLibrary(list);
    setSaving(true);
    try{ await saveRemoteSkill(next); setToast(`技能「${next.name}」已保存到云端，人设立即可勾选`); }
    catch{ setToast('已保存到本地；云端暂未连通，稍后可重试。'); }
    finally{ setSaving(false); }
  };
  const remove=async(id)=>{
    const used=usersOf(id);
    if(used.length){ setToast(`「${used.join('、')}」还在勾选这项技能，请先到人设中取消勾选。`); return; }
    const list=skillLibrary.filter(item=>item.id!==id);
    setSkillLibrary(list); setEditingId(list[0]?.id||'');
    try{ await deleteRemoteSkill(id); setToast('技能已删除'); }
    catch{ setToast('已从本地移除，云端删除未成功。'); }
  };

  return <>
    <PageHeader title="技能库" desc="所有人设共用的技能基础数据。可手工维护，也可上传技能包、从本机已装技能或技能市场导入。" prd="PRD-4 / F-AI-SKILL-01"
      actions={<>
        <Button variant="secondary" icon={UploadCloud} onClick={()=>setImportOpen(current=>!current)}>导入技能</Button>
        <Button icon={Plus} onClick={()=>{const next=createEmptySkill();setSkillLibrary([...skillLibrary,next]);setEditingId(next.id);}}>新增技能</Button>
      </>}/>
    {importOpen?<SkillImportPanel skillLibrary={skillLibrary} setSkillLibrary={setSkillLibrary} setToast={setToast} onClose={()=>setImportOpen(false)}/>:null}
    <div className="split-page persona-page skill-library-page">
      <div className="panel persona-list">
        <div className="panel-head"><h2>技能列表</h2><small>{skillLibrary.length} 项</small></div>
        {skillLibrary.map(skill=>{
          const used=usersOf(skill.id).length;
          return <button key={skill.id} className={skill.id===editingId?'active':''} onClick={()=>setEditingId(skill.id)}>
            <span className={`skill-cat src-${skill.source||'manual'}`}>{skill.category||'未分类'}</span>
            <div><b>{skill.name}<i className="src-tag">{SOURCE_LABEL[skill.source||'manual']}</i></b><small>{skill.description||'未填写说明'}</small></div>
            <em>{used?`${used} 人使用`:skill.enabled===false?'已停用':'未使用'}</em>
          </button>;
        })}
      </div>
      <div className="panel persona-editor">
        {draft?<>
          <div className="panel-head"><div><h2>{draft.name||'未命名技能'}</h2><p>技能描述会原样写进提示词，直接决定模型怎么观察与表达。</p></div>
            <div className="row-actions">
              <button className="text-link" disabled={saving} onClick={()=>commit(draft)}>{saving?'保存中…':'保存到云端'}</button>
              <button className="icon-btn danger-text" title="删除" onClick={()=>remove(draft.id)}><Trash2 size={16}/></button>
            </div>
          </div>
          <div className="form-grid compact">
            <label>技能名称<input value={draft.name||''} onChange={event=>patch('name',event.target.value)}/></label>
            <label>分类<input value={draft.category||''} placeholder="例如：作品观察" onChange={event=>patch('category',event.target.value)}/></label>
            <label>排序<input type="number" value={draft.sortOrder??90} onChange={event=>patch('sortOrder',Number(event.target.value)||0)}/></label>
            <label className="framing-enable"><input type="checkbox" checked={draft.enabled!==false} onChange={event=>patch('enabled',event.target.checked)}/> 启用</label>
          </div>
          <label className="persona-field">技能描述<textarea rows={5} value={draft.description||''} onChange={event=>patch('description',event.target.value)} placeholder="写清楚这项技能要求模型怎么做，例如：只描述画面中真实可见的颜色关系，不推断孩子对颜色的主观感受。"/><small>这段文字会原样进入 system 提示词。</small></label>
          {draft.source&&draft.source!=='manual'?<div className="skill-origin">
            <div><b>来源</b><span>{SOURCE_LABEL[draft.source]} · {draft.originRef||draft.id}</span></div>
            {draft.version?<div><b>版本</b><span>v{draft.version}</span></div>:null}
            {draft.author?<div><b>作者</b><span>{draft.author}</span></div>:null}
            {draft.license?<div><b>许可</b><span>{draft.license}</span></div>:null}
            {draft.packagePath?<div><b>归档</b><span>
              {draft.packageBlob
                ?<button className="text-link" onClick={()=>downloadSkillPackage(draft)}>下载原包 <Download size={13}/></button>
                :<span>仅保留文件清单（原包未内联归档）</span>}
              <code style={{marginLeft:8}}>{draft.packagePath}</code>
            </span></div>:null}
            <div><b>导入体检</b><span className={`audit-text ${draft.auditLevel||'safe'}`}>{AUDIT_TEXT[draft.auditLevel||'safe']}</span></div>
            {Array.isArray(draft.packageFiles)&&draft.packageFiles.length?<div className="skill-origin-files"><b>包内文件</b><span>{draft.packageFiles.slice(0,10).map(file=><code key={typeof file==='string'?file:file.path}>{typeof file==='string'?file:file.path}</code>)}{draft.packageFiles.length>10?`等 ${draft.packageFiles.length} 个`:''}</span></div>:null}
          </div>:null}
          {usersOf(draft.id).length?<p className="persona-empty">当前被 {usersOf(draft.id).join('、')} 勾选。停用后这些人设会自动跳过这项技能。</p>:<p className="persona-empty">还没有人设勾选这项技能。</p>}
        </>:<p className="persona-empty">选择左侧的一项技能，或新增一项。</p>}
      </div>
    </div>
  </>;
}

function FramingSettingsPage({framingPresets=[],setFramingPresets,setToast}){
  const [editingId,setEditingId]=useState(framingPresets[0]?.id||'');
  const editing=framingPresets.find(item=>item.id===editingId)||framingPresets[0]||null;
  const [draft,setDraft]=useState(()=>editing?{...editing}:null);
  const [generating,setGenerating]=useState(false);
  const [preview,setPreview]=useState('');
  const [saving,setSaving]=useState(false);
  useEffect(()=>{setDraft(editing?{...editing}:null)},[editingId,framingPresets.length]);
  useEffect(()=>{if(!draft)return undefined;let active=true;renderFramedArtwork({source:placeholderArtwork(),spec:draft.spec||DEFAULT_FRAME_SPEC,student:draft.plaqueStudent||'陈一诺',title:draft.plaqueTitle||'向着光的花',date:draft.plaqueDate||'2026.08.11'}).then(url=>{if(active)setPreview(url)}).catch(()=>{if(active)setPreview('')});return()=>{active=false}},[draft?.spec,draft?.plaqueStudent,draft?.plaqueTitle,draft?.plaqueDate]);
  const patch=(key,value)=>setDraft(current=>current?{...current,[key]:value}:current);

  const generate=async()=>{
    if(!draft) return;
    setGenerating(true);
    try{
      const spec=await generateFrameSpec(draft.description);
      patch('spec',spec);
      setToast('大模型已生成装裱参数，右侧预览可确认效果');
    }catch(error){ setToast(error.message||'装裱参数生成失败，请调整描述后重试。'); }
    finally{ setGenerating(false); }
  };
  const commit=async(next)=>{
    const list=framingPresets.some(item=>item.id===next.id)?framingPresets.map(item=>item.id===next.id?next:item):[...framingPresets,next];
    setFramingPresets(list);
    setSaving(true);
    try{ await saveRemoteFramingPreset(next); setToast(`装裱「${next.name}」已保存，老师端即可选用`); }
    catch{ setToast('已保存到本地；云端暂未连通，稍后可重试。'); }
    finally{ setSaving(false); }
  };
  const remove=async(id)=>{
    const target=framingPresets.find(item=>item.id===id);
    if(target?.builtin){setToast('内置装裱不可删除，可先停用');return;}
    const list=framingPresets.filter(item=>item.id!==id);
    setFramingPresets(list); setEditingId(list[0]?.id||'');
    try{ await deleteRemoteFramingPreset(id); setToast('装裱已删除'); }catch{ setToast('已从本地移除，云端删除未成功。'); }
  };

  return <>
    <PageHeader title="装裱设置" desc="后台维护装裱方案，可用自然语言让大模型生成配色与框宽参数，老师端直接选用。" prd="PRD-11 / F-FRAME-ADM-01"
      actions={<Button icon={Plus} onClick={()=>{const next=createEmptyFramingPreset();setFramingPresets([...framingPresets,next]);setEditingId(next.id);}}>新增装裱</Button>}/>
    <div className="split-page framing-settings">
      <div className="panel persona-list">
        <div className="panel-head"><h2>装裱方案</h2><small>{framingPresets.length} 套</small></div>
        {framingPresets.map(preset=><button key={preset.id} className={preset.id===editingId?'active':''} onClick={()=>setEditingId(preset.id)}>
          <span className="frame-dot" style={{background:preset.spec?.outer||'#cfa52e'}}/>
          <div><b>{preset.name}</b><small>{preset.spec?.atmosphere||preset.description||'未生成参数'}</small></div>
          <em>{preset.builtin?'内置':preset.enabled===false?'已停用':'启用中'}</em>
        </button>)}
      </div>
      <div className="panel persona-editor">
        {draft?<>
          <div className="panel-head"><div><h2>{draft.name||'未命名装裱'}</h2><p>描述需求 → 大模型给出参数 → 老师端按参数精确绘制。</p></div>
            <div className="row-actions">
              <button className="text-link" disabled={saving} onClick={()=>commit(draft)}>{saving?'保存中…':'保存到云端'}</button>
              <button className="icon-btn danger-text" title="删除" onClick={()=>remove(draft.id)}><Trash2 size={16}/></button>
            </div>
          </div>
          <div className="form-grid compact">
            <label>名称<input value={draft.name||''} onChange={event=>patch('name',event.target.value)}/></label>
            <label>展签人名<input value={draft.plaqueStudent||''} placeholder="留空则用学员姓名" onChange={event=>patch('plaqueStudent',event.target.value)}/></label>
            <label>展签日期<input value={draft.plaqueDate||''} placeholder="例如 2026.08.11" onChange={event=>patch('plaqueDate',event.target.value)}/></label>
            <label>作品名<input value={draft.plaqueTitle||''} placeholder="留空则不显示作品名" onChange={event=>patch('plaqueTitle',event.target.value)}/></label>
          </div>
          <label className="persona-field">装裱需求描述（自然语言）<textarea rows={3} value={draft.description||''} onChange={event=>patch('description',event.target.value)} placeholder="例如：新中式水墨风，墨色细外框 + 米色纸纹卡纸，落款用深墨色小字，整体安静克制，适合水彩作品。"/></label>
          <div className="framing-generate">
            <Button icon={Sparkles} onClick={generate} disabled={generating||!draft.description}>{generating?'大模型正在设计…':'由大模型生成装裱参数'}</Button>
            <label className="framing-enable"><input type="checkbox" checked={draft.enabled!==false} onChange={event=>patch('enabled',event.target.checked)}/> 在老师端可选</label>
          </div>
          {draft.spec?<div className="framing-spec">
            <div className="framing-preview"><img src={preview} alt={`${draft.name}装裱预览`}/><small>预览使用占位作品，实际渲染时替换为学员作品</small></div>
            <div className="framing-spec-fields">
              <div className="spec-row"><span>外框</span><i style={{background:draft.spec.outer}}/><code>{draft.spec.outer}</code><em>宽 {Math.round((draft.spec.outerWidthRatio||0)*1000)/10}%</em></div>
              <div className="spec-row"><span>卡纸</span><i style={{background:draft.spec.mat}}/><code>{draft.spec.mat}</code><em>宽 {Math.round((draft.spec.matWidthRatio||0)*1000)/10}%</em></div>
              <div className="spec-row"><span>分隔线</span>{draft.spec.innerLine?<><i style={{background:draft.spec.innerLine}}/><code>{draft.spec.innerLine}</code></>:<em>无</em>}</div>
              <div className="spec-row"><span>展签</span><i style={{background:draft.spec.plaqueBg}}/><code>{draft.spec.plaqueBg}</code><em>文字 {draft.spec.plaqueText}</em></div>
              <div className="spec-row"><span>字体</span><code>{draft.spec.plaqueFontFamily}</code><em>字距 {draft.spec.plaqueLetterSpacing}</em></div>
              {draft.spec.atmosphere?<p className="spec-note">氛围：{draft.spec.atmosphere}</p>:null}
              {draft.spec.rationale?<p className="spec-note">理由：{draft.spec.rationale}</p>:null}
            </div>
          </div>:<p className="persona-empty">还没有装裱参数。写好需求描述后点「由大模型生成装裱参数」。</p>}
        </>:<p className="persona-empty">选择左侧的一套装裱，或新增一套。</p>}
      </div>
    </div>
  </>;
}

/** 装裱预览用的占位作品：只在后台设置页使用，不参与真实渲染。 */
let placeholderCache='';
function placeholderArtwork(){
  if(placeholderCache) return placeholderCache;
  const canvas=document.createElement('canvas');
  canvas.width=900; canvas.height=680;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fdfbf6'; ctx.fillRect(0,0,900,680);
  ctx.fillStyle='#f6c445'; ctx.beginPath(); ctx.arc(420,300,140,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#e2603c'; ctx.beginPath(); ctx.arc(590,215,62,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#2f6fbf'; ctx.lineWidth=9; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(150,560); ctx.quadraticCurveTo(450,392,760,560); ctx.stroke();
  ctx.strokeStyle='#3f8f5f'; ctx.lineWidth=7;
  ctx.beginPath(); ctx.moveTo(420,440); ctx.quadraticCurveTo(392,540,300,596); ctx.stroke();
  ctx.fillStyle='#6d6559'; ctx.font='26px serif'; ctx.fillText('占位作品 · 仅用于预览装裱', 300, 646);
  placeholderCache=canvas.toDataURL('image/png');
  return placeholderCache;
}

// 机构级基础数据页：只有管理员能进。导航已经隐藏入口，这里再拦一道，
// 避免从导览页、历史链接或未来新增入口绕过。
const ADMIN_ONLY_PAGES=['teacherPersona','skillLibrary','courseLibrary','framingSettings','galleryAdmin'];

function PageRouter(props){
 const map={dashboard:TeacherWelcome,teacherFlow:TeacherFlowV2,lessons:LessonsPage,create:CreateFlow,ai:TeacherAIWorkspace,tasks:TasksPage,progress:ProgressBoard,classes:StudentArchiveData,growthCenter:PersonalGrowthCenter,archives:GrowthArchiveData,parent:ParentHomeFamily,parentInsight:ParentInsight,parentArchive:ParentArchiveFamily,authorization:AuthorizationPage,profile:ProfilePage,adminDash:AdminDashboard,apps:AppsPage,providers:ProvidersPage,teacherPersona:TeacherPersonaPage,skillLibrary:SkillLibraryPage,courseLibrary:CourseLibraryPage,framingSettings:FramingSettingsPage,galleryAdmin:GalleryAdminPage,gallery:GalleryPage,users:UsersPage,logs:LogsPage,archiveAdmin:ArchiveAdmin,permissions:PermissionsPage,settings:SettingsPage,guide:GuidePage};
 if(ADMIN_ONLY_PAGES.includes(props.page)&&props.role!=='admin'){
   const Fallback=props.role==='parent'?ParentHomeFamily:TeacherWelcome;
   return <Fallback {...props}/>;
 }
 const C=map[props.page]||NotFound; return <C {...props}/>;
}

function TeacherDashboard({navigate,setToast}){const [frame,setFrame]=useState('星光展');const [mode,setMode]=useState('个人反馈');const [uploaded,setUploaded]=useState(false);const [done,setDone]=useState(false);const [album,setAlbum]=useState('成长集锦');const students=mode==='个人反馈'?['陈一诺']:['陈一诺','林小满','周子乐'];return <><PageHeader title="课后工作台" desc="一节课，只完成一次看见。" prd="智能装裱 · 五维点评 · 成长档案"/><div className="focus-nav"><span>智能装裱</span><i/> <span>五维点评</span><i/> <span>成长档案</span><i/> <span>班级反馈</span></div>{!done?<section className="focus-workspace"><div className="framing-stage"><div className="focus-head"><div><span>第一步</span><h2>智能装裱</h2></div><div className="mode-switch"><button className={mode==='个人反馈'?'active':''} onClick={()=>{setMode('个人反馈');setUploaded(false)}}>个人反馈</button><button className={mode==='班级反馈'?'active':''} onClick={()=>{setMode('班级反馈');setUploaded(false)}}>班级反馈</button></div></div>{!uploaded?<div className="upload-flow"><label>选择班级<select defaultValue="周六创意绘画 2 班"><option>周六创意绘画 2 班</option><option>水彩启蒙 1 班</option></select></label><label>选择学员<select defaultValue={mode==='个人反馈'?'陈一诺':'本班全部学员'}><option>{mode==='个人反馈'?'陈一诺':'本班全部学员'}</option><option>陈一诺、林小满、周子乐</option></select></label><div className="upload-slots"><button onClick={()=>setUploaded(true)}><Frame/><b>学员作品 <em>必选</em></b><small>{mode==='个人反馈'?'上传 1 幅作品':'支持按学员批量上传'}</small><span>点击上传</span></button><button onClick={()=>setToast('已添加课堂照片（演示）')}><Image/><b>学员照片 <em>选填</em></b><small>{mode==='个人反馈'?'上传课堂照片':'支持批量上传照片'}</small><span>添加照片</span></button><button onClick={()=>setToast('已添加课堂视频（演示）')}><Video/><b>上课视频 <em>选填</em></b><small>用于课堂状态观察</small><span>添加视频</span></button></div><p>上传作品后，AI 会自动校正画面并进入装裱预览。</p></div>:<><div className="museum-canvas"><div className={`gallery-frame ${frame==='自然原木'?'oak':frame==='东方雅境'?'ink':''}`}><div className="artwork-sun">✺</div><small>{mode==='个人反馈'?'《向着光的花》 · 陈一诺':'本班 3 位学员作品已就绪'}</small></div></div><div className="frame-choices">{['星光展','自然原木','东方雅境'].map(x=><button key={x} className={frame===x?'selected':''} onClick={()=>setFrame(x)}><i className={x==='星光展'?'gold':x==='自然原木'?'wood':'black'}/>{x}</button>)}</div><button className="reset-upload" onClick={()=>setUploaded(false)}>重新选择素材</button><p className="stage-note">已自动校正光影与背景 · 同步生成展览级画面</p></>}</div><div className="review-stage"><div className="focus-head"><div><span>第二步</span><h2>五维点评</h2></div><span className="auto-save">将自动归入成长档案</span></div><div className="student-mini"><span>{mode==='个人反馈'?'陈':'3'}</span><div><b>{mode==='个人反馈'?'陈一诺':'班级反馈 · 3 位学员'}</b><small>周六创意绘画 2 班 · 第 12 次课</small></div></div><div className="five-dimensions">{[['美术能力','大胆运用冷暖对比，色彩表达鲜明'],['上课状态','专注而放松，能耐心完成细节'],['行为能力','愿意表达想法，也能倾听同伴'],['内在状态','画面有向上的力量与开放感'],['家长建议','今晚可和她聊聊：这朵花想把光送给谁？']].map(([a,b])=><article key={a}><b>{a}</b><p>{b}</p></article>)}</div><Button disabled={!uploaded} icon={Sparkles} onClick={()=>{setDone(true);setToast(`已为${students.length}位学员归档成长记录`)}}>完成点评并归档</Button></div></section>:<section className="archive-finish"><div className="finish-panda"><img src={pandaObserve} alt="熊猫艺术导师"/></div><div><span>已自动归入成长档案</span><h2>把这一次被看见，<br/>做成孩子的成长记忆。</h2><p>老师可再选择制作成可分享的展览内容。</p><div className="album-choices"><button className={album==='成长集锦'?'selected':''} onClick={()=>setAlbum('成长集锦')}><Image/><b>成长集锦</b><small>作品 + 课堂照片</small></button><button className={album==='个人作品集'?'selected':''} onClick={()=>setAlbum('个人作品集')}><Frame/><b>个人作品集</b><small>只收录作品，美术馆展览效果</small></button></div><Button icon={Archive} onClick={()=>setToast(`${album}已开始生成`)}>制作{album}</Button></div><div className="album-preview"><div className="mini-gallery"><div>✺</div><span>陈一诺 · 2026 成长展</span></div></div></section>}</>}

function LegacyTeacherDashboard({navigate,tasks}){return <>
 <PageHeader title="上午好，林晓老师" desc="今天有 2 个班级待完成课后反馈，先从最近一节课开始吧。" prd={PRD.dashboard} actions={<Button icon={Plus} onClick={()=>navigate('create')}>开始制作课后反馈</Button>}/>
 <div className="stats"><Stat label="本周完成反馈" value="18 次" delta="比上周 +4" icon={CircleCheck}/><Stat label="待审核任务" value="3 个" delta="1 个即将超时" icon={Clock3} tone="yellow"/><Stat label="成长档案" value="126 份" delta="本月新增 12" icon={Archive} tone="green"/><Stat label="AI 节省时间" value="14.6 小时" delta="预计值" icon={Sparkles} tone="coral"/></div>
 <section className="dashboard-grid"><div className="panel journey-panel"><div className="panel-head"><div><h2>今天的课后反馈</h2><p>周六创意绘画 2 班 ·《梵高的向日葵》</p></div><Status value="待处理"/></div><div className="journey"><div className="done"><span><Check/></span><b>课次信息</b><small>已完成</small></div><div className="current"><span>2</span><b>上传素材</b><small>待上传</small></div><div><span>3</span><b>AI 生成</b><small>未开始</small></div><div><span>4</span><b>审核发布</b><small>未开始</small></div></div><Button onClick={()=>navigate('create')} icon={ArrowRight}>继续制作</Button></div>
 <div className="panel mini-calendar"><div className="panel-head"><h2>近期课次</h2><button className="text-link" onClick={()=>navigate('lessons')}>查看全部</button></div>{[['今天 14:30','周六创意绘画 2 班','18 人'],['明天 09:00','水彩启蒙 1 班','12 人'],['08/08 18:30','大师创想班','15 人']].map(x=><button key={x[0]} onClick={()=>navigate('create')} className="class-row"><span>{x[0]}</span><div><b>{x[1]}</b><small>{x[2]}</small></div><ArrowRight size={16}/></button>)}</div></section>
 <section><div className="section-title"><div><h2>AI 快捷应用</h2><p>选择应用直接开始创作，也可在课后反馈中批量使用。</p></div><button className="text-link" onClick={()=>navigate('ai')}>进入 AI 创作台</button></div><div className="app-rail">{aiAppsSeed.map(a=><AIAppCard key={a.id} app={a} onClick={()=>navigate('ai')}/>)}</div></section>
 <TaskTable tasks={tasks.slice(0,4)} onView={()=>navigate('tasks')} title="最近生成任务"/>
 </>}

function AIAppCard({app,onClick,admin=false,onToggle,onUninstall}){const Icon=app.icon;return <div className="app-card"><div className={`app-icon ${app.color}`}><Icon/></div><div className="app-copy"><h3>{app.name}</h3><p>{app.desc}</p>{admin?<small>v{app.version}</small>:null}</div>{admin?<div className="app-admin-actions"><Status value={app.status==='enabled'?'已启用':'已停用'}/><button className="icon-btn" onClick={onToggle} title="启停"><RefreshCw size={16}/></button><button className="icon-btn danger-text" onClick={onUninstall} title="卸载"><Trash2 size={16}/></button></div>:<button className="circle-go" onClick={onClick}><ArrowRight size={17}/></button>}</div>}

function TaskTable({tasks,onView,title='生成任务'}){return <section className="panel table-panel"><div className="panel-head"><h2>{title}</h2><button className="text-link" onClick={onView}>查看全部</button></div><div className="table-scroll"><table><thead><tr><th>任务</th><th>对象</th><th>AI 应用</th><th>实际模型</th><th>状态</th><th>耗时/进度</th><th></th></tr></thead><tbody>{tasks.map(t=><tr key={t.id}><td><b>{t.title}</b><small>{t.id}</small></td><td>{t.student}</td><td>{t.app}</td><td>{t.model}</td><td><Status value={t.status}/></td><td>{t.time}</td><td><button className="icon-btn"><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table></div></section>}

function LessonsPage({navigate,demoState,setDemoState}){const lessons=[['08 月 04 日','梵高的向日葵','周六创意绘画 2 班','18/18','待制作'],['08 月 03 日','色彩的情绪','色彩启蒙班','12/12','已发布'],['08 月 02 日','城市线描','大师创想班','14/15','已发布'],['07 月 27 日','海底世界','周六创意绘画 2 班','18/18','已归档']];return <><PageHeader title="课后反馈" desc="以课次为单位组织素材、AI 生成、审核发布和档案沉淀。" prd={PRD.lessons} actions={<Button icon={Plus} onClick={()=>navigate('create')}>新建课后反馈</Button>}/><DemoStateSwitch value={demoState} setValue={setDemoState}/>{demoState==='empty'?<EmptyState icon={BookOpen} title="还没有课后反馈" desc="创建第一节课次并上传作品后，就能体验完整 AI 工作流。" action="创建课后反馈" onClick={()=>navigate('create')}/>:demoState==='error'?<ErrorState onRetry={()=>setDemoState('normal')}/>:<div className="panel list-panel"><div className="filters"><div className="search-field"><Search size={16}/><input placeholder="搜索课程或班级"/></div><select><option>全部状态</option><option>待制作</option><option>已发布</option></select><select><option>全部班级</option><option>周六创意绘画 2 班</option></select></div>{lessons.map((l,i)=><button className="lesson-row" key={l[0]+l[1]} onClick={()=>i===0?navigate('create'):navigate('archives')}><div className="date-block"><b>{l[0].split(' ')[2]}</b><span>{l[0].slice(0,5)}</span></div><div className="lesson-main"><b>{l[1]}</b><span>{l[2]}</span></div><span>{l[3]} 人已关联</span><Status value={l[4]}/><ArrowRight size={18}/></button>)}</div>}</>}

function DemoStateSwitch({value,setValue}){return <div className="state-switch"><span>状态预览</span>{[['normal','正常'],['empty','空状态'],['error','错误']].map(([k,v])=><button className={value===k?'active':''} key={k} onClick={()=>setValue(k)}>{v}</button>)}</div>}
function EmptyState({icon:Icon,title,desc,action,onClick}){return <div className="empty"><span><Icon size={30}/></span><h2>{title}</h2><p>{desc}</p>{action?<Button onClick={onClick}>{action}</Button>:null}</div>}
function ErrorState({onRetry}){return <div className="empty error-state"><span><CircleAlert size={30}/></span><h2>加载失败</h2><p>网络似乎开了小差，数据没有成功返回。</p><Button icon={RefreshCw} onClick={onRetry}>重新加载</Button></div>}

function CreateFlow({flow,setFlow,navigate,setToast,setTasks}){
 const steps=['课次与学员','上传素材','AI 应用','生成与审核','发布完成'];
 const next=()=>{if(flow.step===1&&!flow.classId)return setToast('请选择班级');if(flow.step===2&&flow.files.length===0)return setToast('请至少上传一份作品或课堂素材');if(flow.step===3&&flow.apps.length===0)return setToast('请至少选择一个 AI 应用');if(flow.step===3){setFlow(f=>({...f,step:4,generateState:'running'}));setTimeout(()=>setFlow(f=>({...f,generateState:'done'})),1800);return}setFlow(f=>({...f,step:Math.min(5,f.step+1)}))};
 const publish=()=>{setFlow(f=>({...f,step:5,published:true}));setTasks(ts=>[{id:'T-0825',title:'梵高的向日葵 · 完整反馈',student:'周六创意绘画 2 班',app:'组合工作流',model:'模型池自动路由',status:'成功',time:'4 分 12 秒'},...ts]);setToast('课后反馈已发布并写入成长档案')};
 return <><PageHeader title="制作课后反馈" desc="周六创意绘画 2 班 · 梵高的向日葵" prd={PRD.create} actions={<Button variant="secondary" icon={X} onClick={()=>navigate('lessons')}>退出向导</Button>}/><div className="stepper">{steps.map((s,i)=><div className={`${flow.step===i+1?'current':''} ${flow.step>i+1?'done':''}`} key={s}><span>{flow.step>i+1?<Check size={15}/>:i+1}</span><b>{s}</b>{i<steps.length-1?<i/>:null}</div>)}</div><div className="flow-panel">{flow.step===1?<StepLesson flow={flow} setFlow={setFlow}/>:flow.step===2?<StepUpload flow={flow} setFlow={setFlow}/>:flow.step===3?<StepApps flow={flow} setFlow={setFlow}/>:flow.step===4?<StepGenerate flow={flow} setFlow={setFlow} publish={publish}/>:<StepSuccess navigate={navigate}/>}</div>{flow.step<4?<div className="flow-actions"><Button variant="secondary" icon={ArrowLeft} disabled={flow.step===1} onClick={()=>setFlow(f=>({...f,step:f.step-1}))}>上一步</Button><Button icon={ArrowRight} onClick={next}>{flow.step===3?'开始 AI 生成':'下一步'}</Button></div>:null}</>}
function StepLesson({flow,setFlow}){const management=loadStudentManagement();const selectedClass=management.classes.find(item=>item.id===flow.classId);const roster=selectedClass?management.students.filter(item=>item.className===selectedClass.name).map(item=>item.name):[];return <div><div className="flow-title"><h2>选择课次与参与学员</h2><p>这些信息将作为智能点评与成长档案的上下文。</p></div><div className="form-grid"><label>校区<select><option>星河校区</option></select></label><label>班级<select value={flow.classId} onChange={e=>{const classId=e.target.value;const nextClass=management.classes.find(item=>item.id===classId);const students=nextClass?management.students.filter(item=>item.className===nextClass.name).map(item=>item.name):[];setFlow(f=>({...f,classId,students}));}}><option value="">请选择班级</option>{management.classes.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="span-2">课程主题<input defaultValue="梵高的向日葵"/></label><label className="span-2">教学目标<textarea defaultValue="观察向日葵的形态与色彩，通过厚涂和线条表达个人感受。"/></label></div>{flow.classId?<div className="student-select"><div><b>参与学员</b><button className="text-link" onClick={()=>setFlow(f=>({...f,students:roster}))}>全选 {roster.length} 人</button></div><div>{roster.length?roster.map(name=><label key={name} className={flow.students.includes(name)?'selected':''}><input type="checkbox" checked={flow.students.includes(name)} onChange={()=>setFlow(f=>({...f,students:f.students.includes(name)?f.students.filter(item=>item!==name):[...f.students,name]}))}/><span>{name[0]}</span>{name}</label>):<p>该班级暂时还没有学员，请先到学员管理中添加。</p>}</div></div>:null}</div>}
function StepUpload({flow,setFlow}){const add=()=>setFlow(f=>({...f,files:[...f.files,{name:`学员作品_${f.files.length+1}.jpg`,type:'作品',student:['陈一诺','林小满','赵禾'][f.files.length%3],status:'已通过'}]}));return <div><div className="flow-title"><h2>批量上传课堂素材</h2><p>支持作品、课堂照片和视频；原始文件会安全保留。</p></div><button className="upload-zone" onClick={add}><UploadCloud size={34}/><b>点击模拟上传，或将文件拖到这里</b><span>图片 JPG/PNG/WebP ≤20MB；视频 MP4/MOV ≤2GB</span></button>{flow.files.length?<div className="upload-list"><div className="upload-head"><b>已上传 {flow.files.length} 个文件</b><button className="text-link" onClick={add}>继续添加</button></div>{flow.files.map((f,i)=><div className="upload-item" key={i}><span className="file-thumb"><Image/></span><div><b>{f.name}</b><small>{f.type} · 4.8MB</small></div><select defaultValue={f.student}><option>陈一诺</option><option>林小满</option><option>赵禾</option></select><Status value={f.status}/><button className="icon-btn" onClick={()=>setFlow(x=>({...x,files:x.files.filter((_,idx)=>idx!==i)}))}><Trash2 size={16}/></button></div>)}</div>:null}<div className="info-note"><ShieldCheck size={18}/><span>仅可处理已获得监护人授权的学员素材。系统将自动校验授权范围。</span></div></div>}
function StepApps({flow,setFlow}){return <div><div className="flow-title"><h2>选择 AI 应用与生成参数</h2><p>模型由平台模型池自动路由，只会调用已配置并启用的供应商。</p></div><div className="select-apps">{aiAppsSeed.map(a=>{const Icon=a.icon,on=flow.apps.includes(a.id);return <button key={a.id} className={on?'selected':''} onClick={()=>setFlow(f=>({...f,apps:on?f.apps.filter(x=>x!==a.id):[...f.apps,a.id]}))}><span className={`app-icon ${a.color}`}><Icon/></span><div><b>{a.name}</b><small>{a.desc}</small></div><i>{on?<Check/>:null}</i></button>})}</div><div className="form-grid compact"><label>点评语气<select value={flow.tone} onChange={e=>setFlow(f=>({...f,tone:e.target.value}))}><option>温暖专业</option><option>活泼鼓励</option><option>简洁正式</option></select></label><label>输出版本<select><option>短版 + 长版</option><option>仅短版</option><option>仅长版</option></select></label><label>装裱模板<select><option>现代白色画廊</option><option>自然木框</option><option>童趣展墙</option></select></label><label>视频规格<select><option>竖屏 9:16 · 45 秒</option><option>横屏 16:9 · 60 秒</option></select></label></div><div className="cost-preview"><Zap/><div><b>预计消耗 286 AI 点</b><span>装裱 18 张 · 点评 18 份 · 视频 1 条</span></div><small>实际模型与费用将在日志中记录</small></div></div>}
function StepGenerate({flow,setFlow,publish}){if(flow.generateState==='running')return <div className="generating"><div className="orbit"><Sparkles/></div><h2>AI 正在完成课后反馈</h2><p>模型池已为不同任务匹配最合适的模型，请保持页面开启。</p><div className="gen-list"><div><CircleCheck/><span><b>作品智能装裱</b><small>18/18 已完成 · VisionArt Pro</small></span><em>100%</em></div><div><RefreshCw className="spin"/><span><b>AI 智能点评</b><small>正在生成个人点评 · Qwen Text Max</small></span><em>72%</em></div><div><Clock3/><span><b>AI 生视频</b><small>排队中 · Seedance 2</small></span><em>等待</em></div></div></div>;
 return <div><div className="review-head"><div><h2>审核并编辑生成结果</h2><p>所有 AI 内容需老师确认后才能发布。</p></div><Status value="待审核"/></div><div className="review-layout"><div className="gallery-result"><div className="framed-art"><div className="art-sun">✺</div><span>陈一诺 ·《会发光的向日葵》</span></div><div className="thumb-strip"><button className="active">01</button><button>02</button><button>03</button><button>+15</button></div></div><div className="review-editor"><div className="editor-tabs"><button className="active">个人点评</button><button>班级点评</button><button>视频</button></div><label>陈一诺 · 个人点评<textarea defaultValue="一诺今天用厚重又明亮的黄色画出了很有生命力的向日葵。她注意到了花瓣朝向的变化，还大胆加入蓝色线条形成冷暖对比。下一次可以尝试让叶片的大小更有层次，让画面更有呼吸感。"/></label><div className="editor-actions"><button className="secondary" onClick={()=>setFlow(f=>({...f,generateState:'running'}))}><RefreshCw size={16}/>重新生成</button><span>已通过敏感词与负面标签检查</span></div></div></div><div className="flow-actions inside"><Button variant="secondary" icon={ArrowLeft} onClick={()=>setFlow(f=>({...f,step:3}))}>返回修改</Button><Button icon={Check} onClick={publish}>确认并发布</Button></div></div>}
function StepSuccess({navigate}){return <div className="success-screen"><span><Check size={34}/></span><h2>课后反馈已发布</h2><p>18 份个人反馈和 1 份班级反馈已写入成长档案。</p><div className="success-actions"><Button icon={Download}>下载微信素材包</Button><Button variant="secondary" icon={Archive} onClick={()=>navigate('archives')}>查看成长档案</Button></div><div className="share-preview"><div className="phone-card"><div className="wechat-head">课后反馈 · 梵高的向日葵</div><div className="mini-art">✺</div><b>今天，我们和梵高一起看见了向日葵的光。</b><p>18 位小艺术家的作品与个人点评已整理完成。</p></div><div><h3>微信交付清单</h3><ul><li><Check/>班级反馈长图</li><li><Check/>18 份个人作品装裱图</li><li><Check/>个人与班级点评文案</li><li><Check/>课堂回顾短视频</li></ul></div></div></div>}

function AIStudio({navigate}){return <><PageHeader title="AI 创作台" desc="单独使用 AI 应用，或从课后反馈工作流批量调用。" prd={PRD.ai} actions={<Button icon={Plus} onClick={()=>navigate('create')}>组合工作流</Button>}/><div className="ai-hero"><div><h2>让作品呈现更专业，<br/>让反馈表达更有温度。</h2><p>所有任务均通过已启用模型池调用，结果保留生成血缘与成本记录。</p></div><span><Sparkles/></span></div><div className="app-grid">{aiAppsSeed.map(a=><AIAppCard key={a.id} app={a} onClick={()=>navigate('create')}/>)}</div><section className="panel prompt-panel"><div><h2>快速体验：智能点评</h2><p>上传作品并补充教学目标，AI 会生成可编辑的点评草稿。</p></div><div className="quick-form"><label>评价对象<select><option>个人点评 · 陈一诺</option><option>班级点评 · 周六 2 班</option></select></label><label>老师观察<textarea placeholder="例如：今天主动尝试了冷暖色对比……"/></label><Button onClick={()=>navigate('create')} icon={WandSparkles}>进入完整体验</Button></div></section></>}
function TasksPage({tasks,demoState,setDemoState}){return <><PageHeader title="生成任务" desc="查看 AI 任务、实际模型、进度、重试和降级链路。" prd={PRD.tasks}/><DemoStateSwitch value={demoState} setValue={setDemoState}/>{demoState==='empty'?<EmptyState icon={Clock3} title="暂无生成任务" desc="提交 AI 创作后，任务进度会显示在这里。"/>:demoState==='error'?<ErrorState onRetry={()=>setDemoState('normal')}/>:<><div className="filters"><div className="search-field"><Search size={16}/><input placeholder="搜索任务 ID 或标题"/></div><select><option>全部应用</option><option>作品智能装裱</option><option>AI 生视频</option></select><select><option>全部状态</option><option>成功</option><option>生成中</option></select></div><TaskTable tasks={tasks} title="全部任务"/></>}</>}
function ClassesPage(){const students=['陈一诺','林小满','赵禾','周子墨','苏西','陆一白'];return <><PageHeader title="班级与学员" desc="管理老师可访问的班级、学员、家长绑定和授权状态。" prd={PRD.classes} actions={<Button icon={Plus}>添加学员</Button>}/><div className="split-page"><div className="class-list panel"><div className="panel-head"><h2>我的班级</h2><button className="icon-btn"><Plus/></button></div>{['周六创意绘画 2 班','色彩启蒙班','大师创想班'].map((x,i)=><button className={i===0?'active':''} key={x}><span className="class-color"/><div><b>{x}</b><small>{[18,12,15][i]} 位学员</small></div><ArrowRight size={16}/></button>)}</div><div className="panel student-table"><div className="panel-head"><div><h2>周六创意绘画 2 班</h2><p>主教：林晓 · 每周六 14:30</p></div><Button variant="secondary" icon={Plus}>添加学员</Button></div><div className="student-grid">{students.map((s,i)=><button key={s}><span className={`avatar lg a${i}`}>{s[0]}</span><b>{s}</b><small>{7+i%4} 岁 · 已上 {12+i} 课时</small><Status value={i===4?'待授权':'已授权'}/></button>)}</div></div></div></>}
function ArchivesPage(){return <><PageHeader title="成长档案" desc="按学员持续沉淀作品、影像、点评与阶段性成长记录。" prd={PRD.archives} actions={<Button variant="secondary" icon={Download}>批量导出</Button>}/><div className="archive-feature"><div><span className="avatar xl">陈</span><div><h2>陈一诺的成长档案</h2><p>7 岁 · 周六创意绘画 2 班 · 已记录 18 次课程</p></div></div><div className="archive-metrics"><span><b>18</b>课程记录</span><span><b>42</b>作品</span><span><b>6</b>能力维度</span><span><b>4</b>阶段总结</span></div><Button icon={FileText}>导出阶段报告</Button></div><Timeline/></>}
function Timeline(){return <section className="timeline"><div className="timeline-filter"><h2>成长时间线</h2><select><option>全部记录</option><option>作品与点评</option><option>阶段总结</option></select></div>{[['08 月 04 日','梵高的向日葵','色彩表达 · 构图观察','今天大胆使用了冷暖色对比，画面节奏明显增强。'],['07 月 20 日','阶段成长总结','阶段报告 · 第 2 阶段','对色彩关系的感知更敏锐，开始形成个人画面语言。'],['07 月 13 日','海底世界','想象力 · 造型能力','通过大小不同的鱼群建立了清晰的空间层次。']].map((x,i)=><article key={x[0]}><div className="time-dot"><i/></div><div className="timeline-card"><div className="timeline-date">{x[0]}</div><div className="timeline-art">{i===1?'✦':'✺'}</div><div><h3>{x[1]}</h3><span>{x[2]}</span><p>{x[3]}</p><button className="text-link">查看完整记录 <ArrowRight size={14}/></button></div></div></article>)}</section>}

function ParentHome({navigate}){return <><PageHeader title="一诺妈妈，下午好" desc="孩子本周有一份新的课后反馈。" prd={PRD.parent}/><div className="parent-hero"><div><span>最新课后反馈 · 08 月 04 日</span><h2>今天，我们和梵高一起<br/>看见了向日葵的光。</h2><p>林晓老师已经完成作品装裱、课堂回顾和个人点评。</p><Button onClick={()=>navigate('parentArchive')} icon={ArrowRight}>查看完整反馈</Button></div><div className="parent-art"><img src={pandaMascot} alt="熊猫艺术导师"/><span>陈一诺 · 7 岁</span></div></div><div className="parent-grid"><div className="panel"><div className="panel-head"><h2>老师想对一诺说</h2><MessageSquareText/></div><blockquote>“一诺今天用厚重又明亮的黄色画出了很有生命力的向日葵。她还大胆加入蓝色线条形成冷暖对比。”</blockquote><button className="text-link" onClick={()=>navigate('parentArchive')}>查看完整点评</button></div><div className="panel observation-cta"><div><span>新功能</span><h2>读懂孩子的作品</h2><p>上传一幅孩子的画，获得温和的表达线索与可操作的陪伴建议。</p></div><Button onClick={()=>navigate('parentInsight')} icon={Sparkles}>开始作品观察</Button></div><div className="panel"><div className="panel-head"><h2>成长概览</h2><Archive/></div><div className="growth-bars"><label><span>色彩表达</span><i><b style={{width:'86%'}}/></i><em>进步明显</em></label><label><span>造型能力</span><i><b style={{width:'72%'}}/></i><em>稳定成长</em></label><label><span>创造力</span><i><b style={{width:'92%'}}/></i><em>突出</em></label></div></div></div></>}
function parentBoundData(records=[],parentStudent=''){const {students}=loadStudentManagement();const child=students.find(item=>item.name===parentStudent)||students.find(item=>item.guardianName)||students[0]||{name:'孩子',guardianName:'家长'};const entries=records.filter(record=>record.student===child.name).sort((a,b)=>b.date.localeCompare(a.date));return {child,entries,latest:entries.find(item=>item.status!=='缺课')};}
function ParentChildSwitch({parentStudents=[],parentStudent,setParentStudent}){if(parentStudents.length<2)return null;return <div className="parent-child-switch"><span>正在查看</span>{parentStudents.map(name=><button key={name} className={name===parentStudent?'active':''} onClick={()=>setParentStudent(name)}>{name}</button>)}</div>}
function useParentScopedRecords(records,parentSession,parentStudents){const [scoped,setScoped]=useState([]);useEffect(()=>{let active=true;if(!parentSession){setScoped(records.filter(record=>parentStudents.includes(record.student)));return()=>{active=false};}loadParentFeedbackRecords(parentSession).then(remote=>{if(active)setScoped(remote);}).catch(()=>{if(active)setScoped([]);});return()=>{active=false};},[parentSession,parentStudents,records]);return scoped;}
function ParentHomeFamily(props){const records=useParentScopedRecords(props.records,props.parentSession,props.parentStudents);return <><ParentChildSwitch {...props}/><ParentHomeBound {...props} records={records}/></>}
function ParentArchiveFamily(props){const records=useParentScopedRecords(props.records,props.parentSession,props.parentStudents);return <><ParentChildSwitch {...props}/><ParentArchiveBound {...props} records={records}/></>}
function ParentHomeBound({navigate,records=[],parentStudent}){const {child,latest,entries}=parentBoundData(records,parentStudent);const title=latest?.title||'新的作品';const review=latest?.reviews?.美术能力||'老师正在为孩子整理本节课的作品与成长记录。';return <><PageHeader title={`${child.guardianName||`${child.name}家长`}，下午好`} desc={latest?'孩子有一份新的课后反馈。':'老师会在完成课后反馈后，把新的记录发布到这里。'} prd={PRD.parent}/><div className="parent-hero"><div><span>{latest?`最新课后反馈 · ${latest.date.slice(5).replace('-',' 月 ')} 日`:'成长档案已建立'}</span><h2>今天，我们一起看见<br/>{title}里的表达。</h2><p>{latest?'老师已经完成作品处理与个人点评。':'孩子的作品、课堂照片与老师点评会在发布后按时间留存。'}</p><Button onClick={()=>navigate('parentArchive')} icon={ArrowRight}>查看完整反馈</Button></div><div className="parent-art"><img src={pandaMascot} alt="熊猫艺术导师"/><span>{child.name} · 成长档案</span></div></div><div className="parent-grid"><div className="panel"><div className="panel-head"><h2>老师想对{child.name}说</h2><MessageSquareText/></div><blockquote>“{review}”</blockquote><button className="text-link" onClick={()=>navigate('parentArchive')}>查看完整点评</button></div><div className="panel observation-cta"><div><span>新功能</span><h2>读懂孩子的作品</h2><p>上传一幅孩子的画，获得温和的表达线索与可操作的陪伴建议。</p></div><Button onClick={()=>navigate('parentInsight')} icon={Sparkles}>开始作品观察</Button></div><div className="panel"><div className="panel-head"><h2>成长概览</h2><Archive/></div><p className="parent-bound-summary">当前已归档 {entries.length} 条作品与课后记录；每一条都只属于{child.name}的成长档案。</p></div></div></>}
function ParentArchiveBound({records=[],parentStudent}){const {child,entries}=parentBoundData(records,parentStudent);return <><PageHeader title={`${child.name}的成长档案`} desc="记录每一次表达、尝试与进步。" prd={PRD.archives} actions={<Button variant="secondary" icon={Download}>下载阶段报告</Button>}/><div className="archive-feature parent"><div><span className="avatar xl">{child.name[0]}</span><div><h2>个人成长档案</h2><p>已归档 {entries.length} 次课程记录</p></div></div><Status value={child.guardianName?'已绑定':'待绑定'}/></div><section className="parent-bound-timeline"><h2>成长时间线</h2>{entries.length?entries.map(entry=><article key={entry.id}><time>{entry.date}</time><div><b>{entry.status==='缺课'?'这节课，先为孩子留下一页。':`《${entry.title}》`}</b><p>{entry.status==='缺课'?entry.reviews?.summary:entry.reviews?.美术能力}</p></div></article>):<p>老师发布作品和点评后，会在这里呈现。</p>}</section></>}
function ParentInsight({setToast}){const [done,setDone]=useState(false);return <><PageHeader title="作品表达观察" desc="从绘画中理解孩子当下的表达；结论仅供亲子沟通与教育陪伴参考，不作心理诊断。" prd="PRD-5 / F-PARENT-INSIGHT-01"/>{!done?<section className="insight-shell"><div className="insight-copy"><span>温和的看见，而不是给孩子贴标签</span><h2>让一幅画，成为<br/>走近孩子的入口。</h2><p>上传孩子近期独立完成的作品。AI 将结合色彩、构图与符号表达，生成可与孩子展开对话的观察线索和家庭陪伴建议。</p><ul><li><Check/>不评价好坏，只关注表达</li><li><Check/>不作医学或心理诊断</li><li><Check/>每次观察自动归入成长档案</li></ul></div><div className="insight-upload"><img src={pandaObserve} alt="熊猫艺术导师"/><UploadCloud size={28}/><b>上传一幅孩子的作品</b><span>JPG、PNG，建议在自然光下拍摄</span><Button onClick={()=>{setDone(true);setToast('作品观察已生成')}} icon={Sparkles}>生成温和观察</Button></div></section>:<section className="insight-result"><div className="insight-art">✺<small>《太阳花园》· 陈一诺</small></div><div><span className="result-label">作品表达观察</span><h2>一诺正在用明亮的色彩<br/>确认自己的想象力。</h2><p>画面里反复出现的黄色和向上伸展的线条，可能是在表达积极的能量与被看见的愿望。她大胆加入蓝色，不急着追求“像不像”，显示出对自我表达的信心正在生长。</p><div className="parent-tip"><b>今晚可以这样聊</b><span>“这朵花好像很有力量。你觉得它今天想把光送给谁？”</span></div><Button onClick={()=>setToast('已保存到陈一诺的成长档案')} icon={Archive}>保存到成长档案</Button></div></section>}</>}
function ParentArchive(){return <><PageHeader title="陈一诺的成长档案" desc="记录每一次表达、尝试与进步。" prd={PRD.archives} actions={<Button variant="secondary" icon={Download}>下载阶段报告</Button>}/><div className="archive-feature parent"><div><span className="avatar xl">陈</span><div><h2>第 2 成长阶段</h2><p>2026 年 05 月—08 月 · 12 次课程</p></div></div><Status value="已发布"/></div><Timeline/></>}
function AuthorizationPage({setToast}){return <><PageHeader title="授权管理" desc="管理孩子作品、肖像和课堂视频的使用范围。" prd="PRD-16 / F-CONSENT-01"/><div className="panel consent"><div className="consent-head"><span><ShieldCheck/></span><div><h2>陈一诺 · 监护人授权</h2><p>当前授权有效期至 2027-08-04</p></div><Status value="正常"/></div>{[['用于生成课后反馈','允许处理作品、照片和视频'],['用于个人成长档案','允许长期保存已发布记录'],['用于机构内部教学展示','仅本机构老师可见'],['用于公开案例展示','默认关闭，需单独授权']].map((x,i)=><label className="toggle-row" key={x[0]}><div><b>{x[0]}</b><small>{x[1]}</small></div><input type="checkbox" defaultChecked={i<3}/><span/></label>)}<div className="consent-actions"><Button variant="danger" onClick={()=>setToast('撤回申请已提交，公开分享将立即关闭')}>申请撤回授权</Button><Button variant="secondary" icon={Download}>下载授权记录</Button></div></div></>}
function ProfilePage(){return <><PageHeader title="个人中心" desc="管理账号、安全设置和消息通知。" prd="PRD-5 / F-PROFILE-01"/><div className="settings-stack"><div className="panel profile-card"><span className="avatar xl">陈</span><div><h2>陈一诺妈妈</h2><p>138****2026 · 已绑定 1 名学员</p></div><Button variant="secondary">编辑资料</Button></div><div className="panel settings-list">{[['账号与安全','手机号、登录设备和账号注销'],['消息通知','课后反馈、阶段报告和授权变更'],['隐私设置','数据导出、保存期限和授权记录']].map(x=><button key={x[0]}><div><b>{x[0]}</b><small>{x[1]}</small></div><ArrowRight/></button>)}</div></div></>}

function AdminDashboard({navigate}){return <><PageHeader title="运营总览" desc="监控平台业务、AI 调用质量、成本与风险。" prd="PRD-6 / F-ADMIN-01" actions={<Button icon={Plus} onClick={()=>navigate('apps')}>新增 AI 应用</Button>}/><div className="stats"><Stat label="今日 AI 任务" value="1,284" delta="较昨日 +12.8%" icon={Sparkles}/><Stat label="任务成功率" value="96.7%" delta="目标 ≥95%" icon={CircleCheck} tone="green"/><Stat label="今日预估成本" value="¥ 428.60" delta="预算内 72%" icon={Zap} tone="yellow"/><Stat label="待处理告警" value="3" delta="1 个高优先级" icon={CircleAlert} tone="coral"/></div><div className="admin-grid"><div className="panel health-panel"><div className="panel-head"><h2>模型池健康度</h2><button className="text-link" onClick={()=>navigate('providers')}>管理模型</button></div>{[['文本模型池','99.2%','正常'],['图片模型池','97.8%','正常'],['视频模型池','91.4%','需关注'],['视觉理解 / ASR','98.6%','正常']].map(x=><div className="health-row" key={x[0]}><div><b>{x[0]}</b><span>{x[1]} 成功率</span></div><div className="sparkline"><i/><i/><i/><i/><i/></div><Status value={x[2]}/></div>)}</div><div className="panel alerts"><div className="panel-head"><h2>实时告警</h2><Bell/></div><div className="alert-item high"><CircleAlert/><div><b>视频主模型错误率升高</b><span>已自动切换备用模型 · 8 分钟前</span></div></div><div className="alert-item"><Clock3/><div><b>图片任务队列延迟</b><span>P95 达 4.8 分钟 · 21 分钟前</span></div></div><div className="alert-item"><Zap/><div><b>供应商余额低于阈值</b><span>VisualCloud · 1 小时前</span></div></div></div></div><TaskTable tasks={taskSeed} title="最近生成任务" onView={()=>navigate('logs')}/></>}

function AppsPage({apps,setApps,setModal,setToast}){const uninstall=(id)=>setModal({kind:'confirm-uninstall',id});return <><PageHeader title="应用中心" desc="安装、启停、卸载和新增 AI 应用；历史数据始终保留。" prd={PRD.apps} actions={<Button icon={Plus} onClick={()=>setModal({kind:'add-app'})}>新增应用</Button>}/><div className="tabs"><button className="active">已安装 4</button><button>可安装 2</button><button>版本记录</button></div><div className="admin-app-grid">{apps.map(a=><AIAppCard admin key={a.id} app={a} onToggle={()=>{setApps(xs=>xs.map(x=>x.id===a.id?{...x,status:x.status==='enabled'?'disabled':'enabled'}:x));setToast(`${a.name}状态已更新`)}} onUninstall={()=>uninstall(a.id)}/>)}</div><div className="panel marketplace"><div className="panel-head"><div><h2>可安装应用</h2><p>经过平台审核的配置式应用</p></div></div>{[['课堂语音转写','ASR · v1.2.0'],['作品风格分析','视觉理解 · v0.9.2']].map(x=><div className="market-row" key={x[0]}><span className="app-icon blue"><Package/></span><div><b>{x[0]}</b><small>{x[1]}</small></div><Button variant="secondary" onClick={()=>setToast(`${x[0]}已安装`)}>安装</Button></div>)}</div></>}

function ProvidersPage({setModal,setToast}){const [tab,setTab]=useState('providers');return <><PageHeader title="模型供应商与模型池" desc="AI 应用只能引用配置完整、测试通过且已启用的模型。" prd={PRD.providers} actions={<Button icon={Plus} onClick={()=>setModal({kind:'add-provider'})}>新增供应商</Button>}/><div className="tabs"><button className={tab==='providers'?'active':''} onClick={()=>setTab('providers')}>供应商</button><button className={tab==='models'?'active':''} onClick={()=>setTab('models')}>模型列表</button><button className={tab==='pools'?'active':''} onClick={()=>setTab('pools')}>模型池与路由</button></div>{tab==='providers'?<ProviderTable setToast={setToast}/>:tab==='models'?<ModelTable/>:<ModelPools setToast={setToast}/>}</>}
function ProviderTable({setToast}){const rows=[['OpenAI Compatible','文本 / 视觉','https://api.openai.com/v1','已启用','99.4%'],['VisualCloud','图片生成 / 编辑','https://api.visualcloud.cn/v2','已启用','97.8%'],['MotionSeed','视频生成','https://api.motionseed.cn/v1','已启用','91.4%'],['VoiceFlow','ASR / 字幕','https://api.voiceflow.cn','已停用','—']];return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>供应商</th><th>能力</th><th>Endpoint</th><th>状态</th><th>近 24h 成功率</th><th>操作</th></tr></thead><tbody>{rows.map(r=><tr key={r[0]}><td><b>{r[0]}</b><small>凭据：sk-••••••8K2</small></td><td>{r[1]}</td><td><code>{r[2]}</code></td><td><Status value={r[3]}/></td><td>{r[4]}</td><td><div className="row-actions"><button className="text-link" onClick={()=>setToast('连接测试通过 · 386ms')}>连接测试</button><button className="icon-btn"><MoreHorizontal/></button></div></td></tr>)}</tbody></table></div></div>}
function ModelTable(){const rows=[['Qwen Text Max','OpenAI Compatible','文本生成 / 视觉理解','v3.2','已启用','¥0.012 / 1K tokens'],['VisionArt Pro','VisualCloud','图片生成','2026-07','已启用','¥0.18 / 张'],['VisionArt Edit','VisualCloud','图片编辑','v2.1','已启用','¥0.12 / 张'],['Seedance 2','MotionSeed','视频生成','2.0','已启用','¥1.80 / 秒'],['Voice ASR Pro','VoiceFlow','ASR / 字幕','1.4','已停用','¥0.03 / 分钟']];return <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>模型</th><th>供应商</th><th>能力标签</th><th>版本</th><th>状态</th><th>价格</th></tr></thead><tbody>{rows.map(r=><tr key={r[0]}>{r.map((x,i)=><td key={i}>{i===0?<b>{x}</b>:i===4?<Status value={x}/>:x}</td>)}</tr>)}</tbody></table></div></div>}
function ModelPools({setToast}){return <div className="pool-list">{[['文本点评模型池','Qwen Text Max','GPT Text Pro','优先质量'],['图片装裱模型池','VisionArt Pro','VisionArt Edit','均衡'],['视频生成模型池','Seedance 2','MotionLite','优先成本']].map((x,i)=><div className="panel pool-card" key={x[0]}><div className="pool-title"><span className={`app-icon ${['green','blue','yellow'][i]}`}><Zap/></span><div><h3>{x[0]}</h3><p>健康检查每 60 秒 · 自动熔断已开启</p></div><Status value="正常"/></div><div className="route"><div><small>主模型</small><b>{x[1]}</b><span>权重 80%</span></div><ArrowRight/><div><small>备用模型</small><b>{x[2]}</b><span>失败自动切换</span></div></div><div className="pool-foot"><span>路由策略：{x[3]}</span><button className="text-link" onClick={()=>setToast('路由策略已保存')}>编辑策略</button></div></div>)}</div>}

function UsersPage({setModal}){const rows=[['林晓','老师','星河校区 / 3 个班级','正常','今天 14:32'],['王琪','老师','星河校区 / 2 个班级','正常','今天 11:20'],['陈芳','家长','绑定：陈一诺','正常','昨天 20:41'],['赵明','家长','绑定：赵禾','待验证','—'],['平台运营','管理员','全平台','正常','今天 09:12']];return <><PageHeader title="用户管理" desc="统一管理管理员、老师、家长及其数据访问范围。" prd={PRD.users} actions={<Button icon={Plus} onClick={()=>setModal({kind:'invite-user'})}>邀请用户</Button>}/><div className="filters"><div className="search-field"><Search/><input placeholder="姓名、手机号或学员"/></div><select><option>全部角色</option><option>管理员</option><option>老师</option><option>家长</option></select></div><div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>用户</th><th>角色</th><th>数据范围</th><th>状态</th><th>最后登录</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r[0]}><td><b>{r[0]}</b><small>138****{Math.floor(Math.random()*8999+1000)}</small></td><td>{r[1]}</td><td>{r[2]}</td><td><Status value={r[3]}/></td><td>{r[4]}</td><td><button className="icon-btn"><MoreHorizontal/></button></td></tr>)}</tbody></table></div></div></>}
function LogsPage({tasks}){return <><PageHeader title="生成日志" desc="追踪逻辑任务、供应商调用 attempt、降级、用量与成本。" prd={PRD.logs} actions={<Button variant="secondary" icon={Download}>导出日志</Button>}/><div className="log-summary"><span><b>96.7%</b>成功率</span><span><b>4.2s</b>P95 文本延迟</span><span><b>¥428.60</b>今日成本</span><span><b>18</b>自动降级</span></div><TaskTable tasks={tasks} title="任务与调用明细"/><div className="panel trace"><div className="panel-head"><h2>调用链路示例 · T-0822</h2><Status value="生成中"/></div>{[['请求校验','通过','0.12s'],['模型池路由','Seedance 2（主）','0.03s'],['供应商调用 attempt-01','超时 · 自动重试','60.0s'],['供应商调用 attempt-02','MotionLite（备用）','运行中']].map((x,i)=><div className="trace-row" key={x[0]}><span className={i<3?'done':'running'}>{i<3?<Check/>:<RefreshCw/>}</span><div><b>{x[0]}</b><small>{x[1]}</small></div><em>{x[2]}</em></div>)}</div></>}
function ArchiveAdmin(){return <><PageHeader title="档案管理" desc="检索、纠错、导出、删除和审计学员成长档案。" prd={PRD.archiveAdmin}/><div className="filters"><div className="search-field"><Search/><input placeholder="学员姓名、档案 ID 或班级"/></div><select><option>全部授权状态</option><option>有效</option><option>已撤回</option></select></div><div className="archive-admin-grid">{['陈一诺','林小满','赵禾','周子墨','苏西','陆一白'].map((s,i)=><div className="archive-admin-card" key={s}><span className={`avatar lg a${i}`}>{s[0]}</span><div><b>{s}</b><small>档案 A-2026-00{i+12}</small></div><span>{12+i} 条记录</span><Status value={i===4?'待授权':'正常'}/><button className="icon-btn"><MoreHorizontal/></button></div>)}</div></>}
function PermissionsPage({setToast}){const perms=[['课后反馈','创建课次','上传素材','审核发布'],['AI 创作','使用生图','使用视频','使用点评'],['成长档案','查看','导出','纠错','删除'],['平台治理','应用管理','供应商密钥','模型启停','生成日志']];return <><PageHeader title="角色与权限" desc="功能权限与机构、校区、班级、学员数据范围同时生效。" prd={PRD.permissions} actions={<Button icon={Plus}>新建权限组</Button>}/><div className="permission-layout"><div className="panel role-list"><h2>角色/权限组</h2>{['平台超级管理员','机构管理员','老师','家长'].map((x,i)=><button className={i===2?'active':''} key={x}><ShieldCheck/><div><b>{x}</b><small>{[2,3,28,86][i]} 位用户</small></div></button>)}</div><div className="panel permission-matrix"><div className="panel-head"><div><h2>老师</h2><p>默认角色 · 仅访问被授权班级和学员</p></div><Button onClick={()=>setToast('权限配置已保存')}>保存更改</Button></div>{perms.map((g,gi)=><div className="permission-group" key={g[0]}><b>{g[0]}</b><div>{g.slice(1).map((p,pi)=><label key={p}><input type="checkbox" defaultChecked={gi<3||pi===0}/><span/>{p}</label>)}</div></div>)}</div></div></>}
function SettingsPage({setToast}){return <><PageHeader title="系统配置" desc="管理上传阈值、任务超时、数据保存和通知策略。" prd="PRD-8.3 / F-CONFIG-01"/><div className="settings-stack"><div className="panel config-section"><h2>上传与任务阈值</h2><div className="form-grid"><label>每班学员上限<input defaultValue="60"/></label><label>单任务作品图上限<input defaultValue="30"/></label><label>单任务照片上限<input defaultValue="100"/></label><label>单个视频上限（分钟）<input defaultValue="10"/></label></div></div><div className="panel config-section"><h2>数据保存与隐私</h2><div className="form-grid"><label>原始素材默认保存<select><option>365 天</option><option>180 天</option><option>长期</option></select></label><label>删除冷静期<select><option>7 天</option><option>立即删除</option><option>30 天</option></select></label></div></div><div><Button onClick={()=>setToast('系统配置已保存')}>保存配置</Button></div></div></>}

function GuidePage({navigate}){const sections=[
 ['公共认证',['登录','注册','表单校验','角色快速体验'],PRD.auth,'从登录页开始'],
 ['老师前台',['工作台','课后反馈','AI 创作','班级学员','成长档案','生成任务'],PRD.dashboard,'进入老师工作台'],
 ['核心业务流程',['课次学员','素材上传','AI 应用','生成审核','发布档案'],PRD.create,'体验完整流程'],
 ['家长前台',['首页','成长档案','授权管理','个人中心'],PRD.parent,'进入家长端'],
 ['管理后台',['运营总览','应用中心','模型供应商','老师人设','技能库','装裱设置','3D 画廊','用户','日志','档案','权限','配置'],PRD.apps,'进入管理员后台']
 ];return <><PageHeader title="原型页面与体验路径" desc="每个页面均标注 PRD 功能编号；下列入口可直接跳转体验。" prd={PRD.guide}/><div className="guide-path"><span>1 注册登录</span><ArrowRight/><span>2 选择身份</span><ArrowRight/><span>3 完成核心任务</span><ArrowRight/><span>4 验证权限差异</span><ArrowRight/><span>5 查看异常状态</span></div><div className="guide-grid">{sections.map((s,i)=><div className="guide-card" key={s[0]}><span>0{i+1}</span><h2>{s[0]}</h2><p>{s[1].join(' · ')}</p><small>{s[2]}</small><button onClick={()=>{if(i===1)navigate('dashboard');else if(i===2)navigate('create');else if(i===3)navigate('parent');else if(i===4)navigate('adminDash')}}>{s[3]}<ArrowRight/></button></div>)}</div><div className="panel page-inventory"><h2>完整页面清单（36 个页面/主要状态）</h2><div>{['登录','注册','老师工作台','课后反馈列表','创建课次','素材上传','AI 应用选择','生成进度','结果审核','发布成功','AI 创作台','生成任务','班级学员','老师端成长档案','家长首页','家长档案','授权管理','家长个人中心','运营总览','应用中心','新增应用弹窗','供应商管理','模型列表','模型池路由','老师人设','技能库','装裱设置','3D 画廊展陈','3D 画廊设置','用户管理','生成日志','后台档案','角色权限','系统配置','空状态','错误状态'].map((x,i)=><span key={x}>{String(i+1).padStart(2,'0')} {x}</span>)}</div></div></>}

function Modal({type,close,setToast,apps,setApps}){const kind=type.kind;const [error,setError]=useState('');const save=()=>{if(kind==='add-provider'){const name=document.querySelector('#provider-name')?.value;if(!name)return setError('请输入供应商名称')}if(kind==='add-app'){const name=document.querySelector('#app-name')?.value;if(!name)return setError('请输入应用名称');setApps(xs=>[...xs,{id:`custom-${Date.now()}`,name,desc:'配置式外部 API 应用',icon:Package,color:'blue',status:'disabled',version:'0.1.0'}])}if(kind==='confirm-uninstall'){setApps(xs=>xs.filter(x=>x.id!==type.id))}setToast(kind==='confirm-uninstall'?'应用已卸载，历史任务和档案仍保留':'配置已保存');close()};return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal"><div className="modal-head"><div><h2>{kind==='add-app'?'新增 AI 应用':kind==='add-provider'?'新增模型供应商':kind==='invite-user'?'邀请用户':'确认卸载应用'}</h2><p>{kind==='confirm-uninstall'?'卸载后将阻止新任务，但不会删除历史数据。':'填写必要信息后可继续完善配置。'}</p></div><button className="icon-btn" onClick={close}><X/></button></div>{kind==='confirm-uninstall'?<div className="danger-note"><CircleAlert/><span>请先确保没有运行中任务，并确认机构已停用该应用。</span></div>:<div className="modal-form">{kind==='add-app'?<><label>应用名称<input id="app-name" placeholder="例如：课堂语音转写"/></label><label>能力类型<select><option>外部 API</option><option>文本生成</option><option>图片生成/编辑</option><option>视频生成</option></select></label><label>输入 Schema<textarea placeholder={'{"type":"object","properties":{...}}'}/></label></>:kind==='add-provider'?<><label>供应商名称<input id="provider-name" placeholder="例如：VisualCloud"/></label><label>供应商类型<select><option>OpenAI Compatible</option><option>图片供应商</option><option>视频供应商</option></select></label><label>API Endpoint<input placeholder="https://api.example.com/v1"/></label><label>API Key<input type="password" placeholder="仅加密保存，不会明文返回"/></label></>:<><label>手机号<input placeholder="请输入手机号"/></label><label>角色<select><option>老师</option><option>家长</option><option>管理员</option></select></label><label>数据范围<select><option>星河校区</option><option>指定班级</option><option>全平台</option></select></label></>}</div>}{error?<div className="form-error"><CircleAlert/>{error}</div>:null}<div className="modal-actions"><Button variant="secondary" onClick={close}>取消</Button><Button variant={kind==='confirm-uninstall'?'danger':'primary'} onClick={save}>{kind==='confirm-uninstall'?'确认卸载':'保存并继续'}</Button></div></div></div>}
function NotFound({navigate}){return <EmptyState icon={FolderOpen} title="页面不存在" desc="这个原型页面可能已移动。" action="返回工作台" onClick={()=>navigate('dashboard')}/>}

createRoot(document.getElementById('root')).render(<App/>);
