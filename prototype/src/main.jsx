import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Archive, ArrowLeft, ArrowRight, Bell, BookOpen, Boxes, Check, ChevronDown,
  CircleAlert, CircleCheck, Clock3, Download, FileText, Film, FolderOpen, Frame,
  GraduationCap, Image, Landmark, LayoutDashboard, LogOut, Menu, MessageSquareText, MoreHorizontal,
  Package, PanelLeftClose, Plus, RefreshCw, RotateCcw, RotateCw, Save, Search, Settings, ShieldAlert, ShieldCheck, Sparkles,
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
import { DEFAULT_FRAME_SPEC, frameSpecView, generateFrameSpec, normalizeFrameSpec } from './services/frameSpec';
import { REVIEW_MODEL, describeReviewError, readableFromRawJson, streamArtworkReview } from './services/llmReview';
import { keywordCandidatesPrompt, keywordCategoriesFor, keywordOptionsFor, orderKeywords, pickSupportedKeywords } from './data/reviewKeywords';
// 三个基础展示原语抽到 ui.jsx，3D 画廊页与主文件共用同一份
import { Button, PageHeader, Status } from './ui';
import { hydrateGalleryExhibitions, hydrateGalleryVenues, loadGalleryExhibitions, loadGalleryVenues, persistGalleryExhibitions, persistGalleryVenues } from './data/galleryVenues';
import { loadRemoteGalleryExhibitions, loadRemoteGalleryVenues } from './services/galleryVenuesApi';
// 课次（lesson）是后续四步流程的唯一上下文实体：本地兜底 + 云端 lessons 表为真源。
// 课次日期与课时序号的唯一性校验（US-404）走 data 层的 findLessonConflict，读写走 services/lessonApi。
import { ATTENDANCE_LABELS, ATTENDANCE_STATES, createParticipant, findLessonConflict, formatLessonDateDots, loadLessons, mergeLessons, normalizeLessonDate, persistLessons } from './data/lessons';
// 上传素材与学员的绑定（US-406a / US-406b / US-009）：展签只读这份绑定，不做任何顺序取模推断。
// US-406b 起班级反馈的作品走「学员乘上传位」（bindFilesToStudent：在谁的格子里选的就是谁的作品）；
// US-009 起课堂照片也有自己的「学员课堂照片上传位」（0–10 张/人、选填），并支持一张合影分给多人。
import {
  applyDefaultTitles, attendedParticipants, bindFilesToParticipants,
  bindFilesToStudent, bindSharedFiles, detachUploadBinding, participantPhotoGroups,
  participantSlotUsage, participantsMissingUpload, removeUploadEntry, setUploadOwners,
  syncUploadBindings, updateUploadEntry, uploadSlotParticipants, uploadsOfParticipant, withUploadPlaques,
  UPLOAD_SLOTS_PER_STUDENT
} from './data/uploadBinding';
// 上传准入规则与素材隐私（US-408）：格式白名单 / 10MB / 长边 3000px 降采样 /
// 素材只走会话内 object URL。规则是纯函数（可直接 Node 断言），浏览器侧的执行在 mediaIntake。
import { buildSessionMediaDraft, mediaRulesText, screenMediaFiles, validateMediaFile } from './data/mediaValidation';
// 课后反馈草稿（US-409）：只落元数据（课次信息 + 学员选择 + 作品名），
// 图片本体 / object URL / base64 一律不进 localStorage；恢复时安全降级、永不抛错。
import {
  applySavedTitles, buildFeedbackDraft, clearFeedbackDraft, clearSessionMediaSnapshot,
  draftMode, draftSelectedStudent, persistFeedbackDraft, persistSessionMediaSnapshot,
  readFeedbackDraft, readSessionMediaSnapshot, resolveRestoredStep, restoredArtworkTitles
} from './data/feedbackDraft';
// 第一步进入下一步的前置校验（US-410）：必填项清单与「具体原因」文案的唯一真源，
// 界面的校验清单与 go() 的拦截都读同一份结果（零依赖纯函数，可直接 Node 断言）。
import { evaluateIntake } from './data/lessonReadiness';
// 家长授权状态（US-411）：第一步的「未完成查看授权」提示与后续转发前置校验共用的唯一来源。
import { consentSummaryOf, loadConsents } from './data/consent';
// 录入页移动端与性能（US-413）：缩略图长边上限 / 44px 可点区域 / 20 人以上按出席折叠分组 / 录入用时。
// 规则与文案是零依赖纯函数（可直接 Node 断言），浏览器侧的执行在 services/mediaIntake。
import {
  groupSlotRows, intakePaceSummary, shouldGroupSlotRows, thumbnailPendingLabel
} from './data/intakePerformance';
import { createThumbnail, downsampleImageFile, resolveMediaTypes, revokeMediaEntries, revokeMediaUrl, scheduleMediaTask } from './services/mediaIntake';
import { createLesson, loadRemoteLessons, updateLesson } from './services/lessonApi';
// 课程库（course）是课题的来源：课次上的 courseId 指向一门课程，课题按课时序号从 syllabus 取。
import { findCourseById, loadCourses, persistCourses, resolveCourseId, resolveSyllabusTopic, selectableCourses } from './data/courses';
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

// 缩略图还没生成好时列表里的占位（US-413）：一个 8x8 的透明 SVG，只有几十字节。
// **不能**用原图当占位 —— 22 位学员的 3000px 原图一起进列表，解码内存与滚动帧率都会塌。
const INTAKE_THUMB_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3C/svg%3E";

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
        <PageRouter {...{page,role,navigate,setToast,setModal,apps,setApps,tasks,setTasks,demoState,setDemoState,records,setRecords,parentStudent,parentStudents,parentPhone,parentSession,setParentStudent,teacherProfiles,setTeacherProfiles,framingPresets,setFramingPresets,skillLibrary,setSkillLibrary,galleryVenues,setGalleryVenues,galleryExhibitions,setGalleryExhibitions,lessons,setLessons,courses,setCourses}}/>
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

/**
 * 班级名单 → 本次课次的参与学员（US-405）。
 * 默认全部出席；已经在名单里标记过的学员保留原出席状态，避免「全选 / 反选 / 换班回来」时
 * 把老师刚标记的缺课又抹成出席。**只产出内存里的 participants，不回写班级名单。**
 */
function rosterParticipants(students,previous=[]){
  return (students||[]).map(item=>{
    const existed=(previous||[]).find(entry=>entry.name===item.name);
    return createParticipant({name:item.name,attendance:existed?.attendance||'present'});
  });
}

/**
 * 参与学员的稳定指纹（US-409）：草稿要不要落盘的判据之一 ——
 * 与班级初始名单完全一致时说明老师还没动过学员选择，这份草稿没有恢复价值。
 */
function participantSignature(list){
  return (list||[]).map(item=>`${item?.name||''}:${item?.attendance||''}:${item?.temporary?'1':'0'}`).join('|');
}

/**
 * 学员在「照片分配」界面里的稳定 key：优先 studentId，临时学员（没有 id）退回姓名。
 * 不能用行号 —— 勾选过程中名单顺序一变（切班/标缺课）就会选错人。
 */
function participantKey(item){
  const id=String(item?.studentId||'').trim();
  return id||`name:${String(item?.name||'').trim()}`;
}

/**
 * 学员乘上传位列表的渲染容器（US-413）。
 *
 * 学员数**不超过** ROSTER_GROUP_THRESHOLD（20）时就是一条平铺列表（US-406b 的既有行为）；
 * 超过时按出席状态折叠分组 —— 组头写明本组人数与「还有 N 位未上传」，老师不用展开就能定位到
 * 还没录完的那一组，20+ 人的班在手机上也能单手完成录入。
 * 分组的顺序、每组人数、每组待办数全部来自 `data/intakePerformance.js` 的 `groupSlotRows`（纯函数）。
 */
function IntakeSlotGroups({listKey,rows,collapsedKeys,onToggle,renderRow,className=''}){
  if(!shouldGroupSlotRows(rows.length)) return <div className={`intake-upload-slot-list ${className}`.trim()}>{rows.map(renderRow)}</div>;
  return <div className={`intake-upload-slot-list grouped ${className}`.trim()} data-slot-groups={listKey}>
    {groupSlotRows(rows).map(group=>{
      const key=`${listKey}:${group.key}`;
      const collapsed=collapsedKeys.includes(key);
      return <section key={key} className={`intake-slot-group${collapsed?' collapsed':''}`} data-group={group.key}>
        <button type="button" className="intake-slot-group-head" aria-expanded={!collapsed} onClick={()=>onToggle(key)}>
          <ChevronDown size={14} className={collapsed?'closed':''}/>
          <b>{group.label}</b>
          <span>{group.total} 人</span>
          {group.pending?<em>还有 {group.pending} 位未上传</em>:<em className="done">已全部上传</em>}
        </button>
        {collapsed?null:<div className="intake-slot-group-body">{group.rows.map(renderRow)}</div>}
      </section>;
    })}
  </div>;
}

function TeacherFlowV2({navigate,setToast,setRecords,framingPresets=[],teacherProfiles=[],skillLibrary=[],courses=[],lessons=[],setLessons=()=>{},role='teacher'}){
  const management=loadStudentManagement();
  const availableClasses=management.classes||[];
  // 当前登录老师：原型阶段只有一个老师身份（见 roleMeta.teacher），班级数据里存的是老师姓名。
  const currentTeacherName=roleMeta.teacher.name;
  // ---- 草稿恢复（US-409）----------------------------------------------------------
  // 草稿快照**只在首次渲染读一次**：本组件挂载后立刻会跑「写草稿」effect，
  // 用当前（初始）状态覆盖那条记录，读晚了就永远看不到上次的草稿。
  // 它只含元数据（课次信息 + 学员选择 + 作品名），没有任何素材地址。
  const [initialDraft]=useState(()=>readFeedbackDraft());
  // 历史班级可能没有 teacher 字段（旧数据/本机遗留），算作自己的班，否则页面会看起来是空的。
  const myClasses=availableClasses.filter(item=>!item.teacher||item.teacher===currentTeacherName);
  // 「新建草稿」与无草稿进入时的初始班级：我带的第一个班。
  const defaultClassId=myClasses[0]?.id||'';
  // 默认只显示当前老师带的班；「全部班级」开关服务于代课、教研听课与新老师接手（PRD Q8）。
  // 草稿里的班级若是别人名下的班，先把范围切到「全部班级」，否则 selectedClass 找不到、看起来像没恢复。
  const [showAllClasses,setShowAllClasses]=useState(()=>Boolean(initialDraft?.classId)
    &&availableClasses.some(item=>item.id===initialDraft.classId)
    &&!myClasses.some(item=>item.id===initialDraft.classId));
  const visibleClasses=showAllClasses?availableClasses:myClasses;
  const [selectedClassId,setSelectedClassId]=useState(()=>{
    const restored=String(initialDraft?.classId||'');
    return restored&&availableClasses.some(item=>item.id===restored)?restored:defaultClassId;
  });
  // selectedClass 只认当前可见列表里的班级：切回「我带的班」时不会残留别的老师的班。
  const selectedClass=visibleClasses.find(item=>item.id===selectedClassId)||null;
  const classStudents=management.students.filter(item=>item.className===selectedClass?.name);
  // 恢复草稿时把上次选中的学员带回：个人反馈的参与学员只有一位，那一位就是所选学员。
  const [selectedStudentName,setSelectedStudentName]=useState(()=>{
    const restored=draftSelectedStudent(initialDraft);
    if(restored&&classStudents.some(item=>item.name===restored)) return restored;
    return classStudents[0]?.name||'';
  });
  // 不再回落到「第一个学员」：切换班级后必须是显式的空选择，否则会跨班串档。
  const selectedStudent=classStudents.find(item=>item.name===selectedStudentName)||null;
  const selectedStudentLabel=selectedStudent?.name||'未选择学员';
  const selectedClassLabel=selectedClass?.name||'未选择班级';
  // 草稿恢复提示的细节（US-409）：上次进行到第几步、恢复了哪次课。用草稿里存的值渲染，
  // 这样「课题」等字段即便后来课程库改了，也能如实说明上次存的是什么。
  const draftRestoreDetail=initialDraft
    ? `${initialDraft.step>1?`上次进行到第 ${initialDraft.step} 步（素材已随刷新失效，已回到第一步）。`:''}已恢复：${selectedClassLabel}${initialDraft.lessonDate?` · ${initialDraft.lessonDate}`:''}${initialDraft.lessonNo?` · 第 ${initialDraft.lessonNo} 次课`:''}${initialDraft.topic?`《${initialDraft.topic}》`:''}。作品与课堂照片只在当次会话内有效，请重新选择原始素材。`
    : '';
  // 「上次进入流程时有没有选过素材」同样只在**首次渲染**读一次（与草稿分开两条键：
  // 草稿里不允许出现素材相关的字段，这条痕迹只服务于「刷新后提示重新选择原始素材」）。
  const [lastSessionMedia]=useState(()=>readSessionMediaSnapshot());
  // 恢复草稿的提示条（可关闭）与「上次保存的作品名」待填队列（详见 feedbackDraft.js）。
  const [draftRestored,setDraftRestored]=useState(()=>Boolean(initialDraft));
  const [pendingTitles,setPendingTitles]=useState(()=>restoredArtworkTitles(initialDraft));
  // 素材随刷新失效：草稿里 step>1 的会话回到第一步（那里没有作品可装裱/点评），
  // 提示条会说明上次进行到第几步，避免老师以为「流程跳回去了」。
  const [step,setStep]=useState(()=>resolveRestoredStep(initialDraft));
  // 上次是个人还是班级反馈不额外持久化，由 participants 的不变量推导（多于一位 = 班级反馈）。
  const [mode,setMode]=useState(()=>draftMode(initialDraft));
  // frame 存的是云端装裱预设的 id，不再是写死的样式名。
  const [frame,setFrame]=useState('');
  const enabledFrames=framingPresets.filter(item=>item.enabled!==false);
  const activeFrame=enabledFrames.find(item=>item.id===frame)||enabledFrames[0]||null;
  const activeFrameId=activeFrame?.id||'';
  const [subject,setSubject]=useState('通用美术');
  const [media,setMedia]=useState({artwork:null,photo:null});
  const [batchUploads,setBatchUploads]=useState({artwork:[],photo:[]});
  const [uploadState,setUploadState]=useState({artwork:'idle',photo:'idle'});
  // 上传准入的持久提示（被拒的文件、降采样说明）—— 用内联文案而不是只弹 toast：
  // toast 2.6 秒就消失，老师来不及看清「哪一份被跳过、为什么」。
  const [mediaIntakeNotice,setMediaIntakeNotice]=useState('');
  // 刷新后素材失效的提示可以被手动关掉（关掉只影响本次会话，刷新后重来）。
  const [mediaLostDismissed,setMediaLostDismissed]=useState(false);
  // 上次会话选过素材、这次会话里没有：说明素材已经随刷新失效（object URL 只活在当次会话）。
  const lostSessionMedia=Boolean((lastSessionMedia?.artwork&&!media.artwork)||(lastSessionMedia?.photo&&!media.photo));
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
  // 乘上传位：每位学员一个隐藏的 <input type=file>，按 studentId 存 ref（不能用行号，删行/换班后会错位）。
  const artworkSlotInputs=useRef({});
  // 课堂照片上传位（US-009）：同样一人一个 input，另外单独一个 input 给「全班合影」。
  const photoSlotInputs=useRef({});
  const sharedPhotoInput=useRef(null);
  // 正在「分给多位学员」的那张照片（uploadId）与勾选到的学员 key 集合。
  const [photoAssignId,setPhotoAssignId]=useState('');
  const [photoAssignSelection,setPhotoAssignSelection]=useState([]);
  // ---- 录入页移动端与性能（US-413）-----------------------------------------------
  // 上传位列表的折叠分组：学员数 > 20 时按出席状态分组，key 形如「artwork:absent」。
  const [collapsedSlotGroups,setCollapsedSlotGroups]=useState([]);
  // 还在空闲时段生成缩略图的张数（列表先生成小图，生成过程不阻塞输入）。
  const [thumbPendingCount,setThumbPendingCount]=useState(0);
  // 本次录入的开始时刻：进入流程那一刻。用时不靠定时器刷整页（全页每秒重渲染是性能反模式），
  // 只在素材发生变化的那些操作里重算一次。
  const intakeStartedAtRef=useRef(Date.now());
  const [intakeElapsedSeconds,setIntakeElapsedSeconds]=useState(0);
  const steps=[['创建信息','选择对象并上传素材'],['智能装裱','完成作品与照片的裁剪装裱'],['五维点评','依据素材完成温暖点评'],['归档转发','形成一次完整课后反馈']];
  // 课程下拉的数据源是课程库（停用课程不进可选列表）。班级上的 course 存的是课程名，要经 resolveCourseId 换算。
  const courseOptions=selectableCourses(courses);
  const classCourseId=resolveCourseId(courses,selectedClass?.course);
  const classCourseName=String(selectedClass?.course||'').trim();
  const [selectedCourseId,setSelectedCourseId]=useState(()=>String(initialDraft?.courseId||''));
  // 选中的课程被停用或不在课程库里时，回落到本班课程，再回落到第一门可选课程。
  const activeCourseId=courseOptions.some(item=>item.courseId===selectedCourseId)
    ? selectedCourseId
    : (courseOptions.some(item=>item.courseId===classCourseId)?classCourseId:courseOptions[0]?.courseId||'');
  // 推荐课时序号 = 该班该课程已归档课次数 + 1（见 prd-lesson-intake US-403/US-404）；课题取分课时课题，取不到回落默认课题。
  const archivedLessonCount=selectedClass&&activeCourseId
    ? lessons.filter(item=>item.classId===selectedClass.id&&item.courseId===activeCourseId&&item.status==='archived').length
    : 0;
  const recommendedLessonNo=archivedLessonCount+1;
  const recommendedTopic=resolveSyllabusTopic(findCourseById(courses,activeCourseId),recommendedLessonNo);
  // ---- 课次日期与课时序号（US-404）------------------------------------------------
  // 这两项是第一步的必填项，也是下游唯一的日期来源：展签、成长档案、阶段报告都取 lessonDate。
  const todayDate=normalizeLessonDate(new Date());
  // 草稿恢复的日期照用（补录过的过去日期不能被打回今天）；没有草稿时才默认今天。
  const [lessonDate,setLessonDate]=useState(()=>String(initialDraft?.lessonDate||'')||normalizeLessonDate(new Date()));
  // 序号可以手改；手改过之后不再被推荐值顶掉（lessonNoDirty 置真），换班/换课时归零重新跟随推荐值。
  // 草稿里的序号算「老师显式定过的值」（lessonNoDirty 置真），否则会被推荐值顶掉。
  const [lessonNoInput,setLessonNoInput]=useState(()=>initialDraft?.lessonNo?String(initialDraft.lessonNo):'');
  const [lessonNoDirty,setLessonNoDirty]=useState(()=>Boolean(initialDraft?.lessonNo));
  // 未来日期（预排课）与「同日已有课次」都要二次确认；换日期或换序号后必须重新确认一次。
  const [futureDateConfirmed,setFutureDateConfirmed]=useState(false);
  const [sameDayConfirmed,setSameDayConfirmed]=useState(false);
  // 保存前的确认条（未来日期 / 同日已有课次 / 重复创建）与保存结果提示。
  const [lessonConfirm,setLessonConfirm]=useState(null);
  const [lessonSaveState,setLessonSaveState]=useState({status:'idle',message:''});
  // 已保存课次的 id：同一份草稿再次保存走更新，不会重复创建同一次课。
  // 恢复草稿时按「班级 + 日期 + 序号」从本地课次里找回它 —— 否则刷新后同一个自然键
  // 会被自己的上一条记录判成冲突（「该班该日期已有第 N 次课」），而老师其实是在改同一次课。
  const [currentLessonId,setCurrentLessonId]=useState(()=>{
    const draft=initialDraft;
    if(!draft?.classId||!draft.lessonDate||!draft.lessonNo) return '';
    const hit=lessons.find(item=>item.classId===draft.classId&&item.lessonDate===draft.lessonDate&&item.lessonNo===draft.lessonNo);
    return hit?.lessonId||'';
  });
  const lessonNoValue=Number(lessonNoInput);
  const lessonNoValid=Number.isInteger(lessonNoValue)&&lessonNoValue>0;
  const isFutureLessonDate=Boolean(lessonDate)&&lessonDate>todayDate;
  const canUpdateLesson=Boolean(currentLessonId&&lessons.some(item=>item.lessonId===currentLessonId));
  // 唯一键是 classId + lessonDate + lessonNo：同一天已有哪些序号、哪个序号被占用，都在这里现算。
  // 冲突检查要排除「正在编辑的这一条」（它自己不算撞车），但「已有第 N 次课」的提示要把该日期全部课次算进去。
  const classDateLessons=selectedClass&&lessonDate
    ? lessons.filter(item=>item.classId===selectedClass.id&&item.lessonDate===lessonDate)
    : [];
  const sameDayLessons=classDateLessons.filter(item=>item.lessonId!==currentLessonId);
  const sameDayNos=sameDayLessons.map(item=>item.lessonNo).filter(no=>no>0).sort((a,b)=>a-b);
  const sameDayAllNos=classDateLessons.map(item=>item.lessonNo).filter(no=>no>0).sort((a,b)=>a-b);
  const sameDayMaxNo=sameDayAllNos.length?Math.max(...sameDayAllNos):0;
  const sameDayNextNo=sameDayMaxNo+1;
  const lessonNoConflict=lessonNoValid
    ? sameDayLessons.find(item=>item.lessonNo===lessonNoValue)||null
    : null;
  // 课题跟随「实际填写的课时序号」取分课时课题，取不到回落到课程默认课题。
  const lessonTopic=resolveSyllabusTopic(findCourseById(courses,activeCourseId),lessonNoValue||0);
  // 展签、海报与成长档案上的日期都取课次日期（补录上节课时不能显示成今天）。
  const lessonDateDots=formatLessonDateDots(lessonDate);
  // 推荐值 = 该班该课程已归档课次数 + 1（US-403/US-404 的规则）；没手改过就一直跟随。
  useEffect(()=>{
    if(lessonNoDirty) return;
    setLessonNoInput(recommendedLessonNo>0?String(recommendedLessonNo):'');
  },[recommendedLessonNo,lessonNoDirty]);
  // ---- 参与学员与出席状态（US-405）------------------------------------------------
  // participants 只描述「本次课次」，缺课学员也要留在里面（成长档案需要缺课留白）。
  // 保存课次时才写进 lesson.participants，**不回写班级名单**：临时加入的插班/试听因此不污染名单。
  // 草稿恢复时直接带回上次的学员选择与出席标记（素材 id 已在草稿里清空，不会留下悬空引用）。
  const [participants,setParticipants]=useState(()=>{
    const restored=(initialDraft?.participants||[]).map(createParticipant).filter(item=>item.name);
    return restored.length?restored:rosterParticipants(classStudents);
  });
  const [temporaryName,setTemporaryName]=useState('');
  const [participantNotice,setParticipantNotice]=useState('');
  // 个人反馈只记录选中的那一位；班级反馈记录整份名单里被勾选的孩子。
  const effectiveParticipants=mode==='个人反馈'
    ? (selectedStudentName?[participants.find(item=>item.name===selectedStudentName)||createParticipant({name:selectedStudentName})]:[])
    : participants;
  const selectedParticipant=effectiveParticipants.find(item=>item.name===selectedStudentName)||null;
  const participantStats={
    roster:classStudents.length,
    present:effectiveParticipants.filter(item=>item.attendance==='present').length,
    absent:effectiveParticipants.filter(item=>item.attendance==='absent').length,
    makeup:effectiveParticipants.filter(item=>item.attendance==='makeup').length,
    temporary:effectiveParticipants.filter(item=>item.temporary).length
  };
  // ---- 家长授权状态提示（US-411）---------------------------------------------------
  // 「查看授权」是**转发给家长**的前置条件，不是录入 / 归档的前置条件：这里只提示、不拦截，
  // 也不进入 US-410 的六项前置校验。授权状态只有一份来源（data/consent.js，F-CONSENT-01），
  // 第四步转发前的硬校验（US-208 / FR-222）读的也是它。
  const [consents]=useState(()=>loadConsents());
  const [consentExpanded,setConsentExpanded]=useState(false);
  // 所选学员 = 当前模式的参与学员（个人反馈只有选中的那一位，班级反馈是勾选名单）。
  // 没有记录的学员（临时加入的试听学员）按「未完成授权」算，界面会写明「未登记授权」。
  const consentSummary=consentSummaryOf(effectiveParticipants,consents);
  // 第三步班级素材墙的展签数据：姓名/作品名/日期都来自真实绑定与课次日期（US-406a）。
  const classMosaicArtworks=withUploadPlaques(batchUploads.artwork,effectiveParticipants,{fallbackTitle:lessonTopic,fallbackDate:lessonDateDots});
  const classMosaicPhotos=withUploadPlaques(batchUploads.photo,effectiveParticipants,{fallbackTitle:lessonTopic,fallbackDate:lessonDateDots});
  // ---- 学员乘上传位（US-406b）------------------------------------------------------
  // 班级反馈：按到场学员一人一行渲染上传位，每行 1–5 幅作品。上传绑定发生在**行内**——
  // 老师在谁的格子里选的文件就是谁的作品，所以这条路不需要轮转，也不会串档（US-406a 的教训）。
  // 个人反馈沿用单一上传位（media.artwork），绑定是隐式的（等于选中的那位学员），不渲染这个列表。
  const classArtworkItems=batchUploads.artwork;
  // 渲染哪些行：到场学员都要有；另外保留「已上传过素材但被标成缺课」的学员，
  // 否则那份素材在界面上再也改不了作品名、删不掉（见 uploadSlotParticipants 的说明）。
  const artworkSlotRows=mode==='班级反馈'
    ? uploadSlotParticipants(effectiveParticipants,classArtworkItems,'artwork').map(participant=>({
      participant,
      attended:participant.attendance==='present'||participant.attendance==='makeup',
      usage:participantSlotUsage(classArtworkItems,participant,'artwork'),
      uploads:uploadsOfParticipant(classArtworkItems,participant,'artwork')
    }))
    : [];
  // 顶部「还有 N 位学员未上传作品」：只数到场学员（缺课的孩子本来就不该有作品）。
  const missingArtworkCount=participantsMissingUpload(effectiveParticipants,classArtworkItems,'artwork').length;
  // 录入节奏（US-413）：只算**到场**学员（缺课的孩子不该有作品），完成 = 这位学员已有 ≥1 幅。
  // 界面上的「已录入 N/M · 用时」就是验收里「18 位学员各 1 幅在 3 分钟内」的那个数字。
  const artworkPaceTotal=artworkSlotRows.filter(row=>row.attended).length;
  const artworkPaceDone=artworkSlotRows.filter(row=>row.attended&&row.usage.used>0).length;
  const artworkPaceText=intakePaceSummary({total:artworkPaceTotal,done:artworkPaceDone,elapsedSeconds:intakeElapsedSeconds});
  const thumbPendingText=thumbnailPendingLabel(thumbPendingCount);
  // ---- 学员课堂照片上传位（US-009）-------------------------------------------------
  // 照片与作品**分开管理**：作品必选（1–5 幅/人），照片选填（0–10 张/人）。
  // 照片额外支持「一张合影分给多位学员」：条目上带 owners 多人归属（见 data/uploadBinding 的 normalizeOwners）。
  const classPhotoItems=batchUploads.photo;
  const photoSlotRows=mode==='班级反馈'
    ? uploadSlotParticipants(effectiveParticipants,classPhotoItems,'photo').map(participant=>({
      participant,
      attended:participant.attendance==='present'||participant.attendance==='makeup',
      usage:participantSlotUsage(classPhotoItems,participant,'photo'),
      uploads:uploadsOfParticipant(classPhotoItems,participant,'photo')
    }))
    : [];
  // 「还有 N 位学员未上传课堂照片」只用于提示，照片是选填项，不参与进入下一步的校验。
  const missingPhotoCount=participantsMissingUpload(effectiveParticipants,classPhotoItems,'photo').length;
  // 没有出现在任何学员行里的照片（取消全部分配、或归属的学员已被移出名单）。
  // 这类照片不会进展签，但**必须仍然可见可处理** —— 否则它就成了界面上删不掉的幽灵素材。
  const renderedPhotoIds=new Set(photoSlotRows.flatMap(row=>row.uploads.map(item=>item.uploadId)));
  const unassignedPhotos=classPhotoItems.filter(item=>!renderedPhotoIds.has(item.uploadId));
  // 第二步/第三步按学员分组渲染照片：**没有照片的学员也在分组里**（占位），照片不会整体前移错位。
  // 分组用的是**带展签的条目**（classMosaicPhotos），而不是 batchUploads.photo 的原始条目 ——
  // 否则第三步的展签读不到 plaque，共用照片会退化成只显示第一位学员的姓名。
  const photoGroups=participantPhotoGroups(effectiveParticipants,classMosaicPhotos);
  const assigningPhoto=photoAssignId?classPhotoItems.find(item=>item.uploadId===photoAssignId)||null:null;
  // 可被分配照片的学员 = 到场学员（缺课的孩子本次不在课堂上，合影里也不该算他）。
  const photoAssignTargets=attendedParticipants(effectiveParticipants);
  // 「到场」= 出席 + 补课；只有一位到场的都没有（全部缺课/未勾选任何人）才拦住进入下一步。
  const attendedCount=participantStats.present+participantStats.makeup;
  // 换班：清空已选学员、把课程刷新回本班课程、课次上下文重置（避免跨班串档）。
  const selectClass=(classId)=>{
    const next=availableClasses.find(item=>item.id===classId)||null;
    const nextStudents=management.students.filter(item=>item.className===next?.name);
    // 换班同时换素材上下文（US-406b）：已上传的作品绑定的是上一个班的孩子，
    // 带到新班只会让展签显示别人班的孩子，所以整批清掉并明确提示老师重新上传。
    if(batchUploads.artwork.length||batchUploads.photo.length||media.artwork||media.photo){
      // 会话素材地址一并回收：换班后这些 object URL 不再有任何用途（US-408）。
      revokeMediaEntries(batchUploads.artwork);
      revokeMediaEntries(batchUploads.photo);
      revokeMediaUrl(media.artwork?.url);
      revokeMediaUrl(media.photo?.url);
      setBatchUploads({artwork:[],photo:[]});
      setMedia({artwork:null,photo:null});
      setMediaIntakeNotice('');
      setToast('已切换班级：上一个班级的素材已清空（素材只在当次会话内有效），请在新班级重新选择原始素材。');
    }
    setSelectedClassId(next?.id||'');
    setSelectedStudentName('');
    // 换班等于换名单：参与学员按新班级重建（默认全部出席），临时学员不跨班保留。
    setParticipants(rosterParticipants(nextStudents));
    setTemporaryName('');
    setParticipantNotice('');
    // 换班同时关掉「分给多人」面板：勾的是上一个班的学员，带过来会分配错人（US-009）。
    setPhotoAssignId('');
    setPhotoAssignSelection([]);
    setSelectedCourseId(resolveCourseId(courses,next?.course));
    setArchived(false);
    setCurrentLessonId('');
    setLessonNoDirty(false);
    setFutureDateConfirmed(false);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    setLessonSaveState({status:'idle',message:''});
  };
  // 换课：课程变了课次也变了，序号回到「该班该课程」的推荐值。
  const selectCourse=(courseId)=>{
    setSelectedCourseId(courseId);
    setCurrentLessonId('');
    setLessonNoDirty(false);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    setLessonSaveState({status:'idle',message:''});
  };
  const selectClassScope=(next)=>{
    if(next===showAllClasses) return;
    setShowAllClasses(next);
    const list=next?availableClasses:myClasses;
    // 切回「我带的班」时，若当前班级不属于自己，自动落到列表里的第一个班。
    if(!list.some(item=>item.id===selectedClassId)) selectClass(list[0]?.id||'');
  };
  // 切换反馈模式：两种模式的「谁是本次参与者」来源不同（个人=选中学员，班级=勾选名单），
  // 所以临时学员输入与拦截提示都要清掉，避免把上一个模式的名单带过来。
  const selectMode=(next)=>{
    if(next===mode) return;
    setMode(next);
    setTemporaryName('');
    setParticipantNotice('');
    setPhotoAssignId('');
    setPhotoAssignSelection([]);
  };
  // ---- 出席名单的维护（US-405）----------------------------------------------------
  const toggleParticipant=(name)=>{
    setParticipants(current=>current.some(item=>item.name===name)
      ? current.filter(item=>item.name!==name)
      : [...current,createParticipant({name})]);
    setParticipantNotice('');
  };
  // 标记状态即视为「参与本次课次」：缺课/补课不需要先勾选再选状态。
  const setParticipantAttendance=(name,attendance)=>{
    setParticipants(current=>current.some(item=>item.name===name)
      ? current.map(item=>item.name===name?{...item,attendance}:item)
      : [...current,createParticipant({name,attendance})]);
    setParticipantNotice('');
  };
  const removeParticipant=(name)=>setParticipants(current=>current.filter(item=>item.name!==name));
  // 全选 / 反选只作用于本班名单：临时加入的学员是老师显式加的，不能被这两个按钮顺手清掉（只有「清空」会）。
  const selectAllParticipants=()=>{
    setParticipants(current=>[...rosterParticipants(classStudents,current),...current.filter(item=>item.temporary)]);
    setParticipantNotice('');
  };
  const invertParticipants=()=>{
    setParticipants(current=>{
      const kept=current.filter(item=>item.temporary);
      const inverted=rosterParticipants(classStudents,current).filter(item=>!current.some(entry=>entry.name===item.name));
      return [...inverted,...kept];
    });
    setParticipantNotice('');
  };
  const clearParticipants=()=>{setParticipants([]);setParticipantNotice('')};
  const addTemporaryParticipant=()=>{
    const name=String(temporaryName||'').trim();
    if(!name) return;
    if(participants.some(item=>item.name===name)){setToast(`「${name}」已经在本次课次的名单里了。`);return;}
    // 只进本次课次的 participants，不调用 persistStudentManagement —— 班级名单保持不变。
    setParticipants(current=>[...current,createParticipant({name,temporary:true})]);
    setTemporaryName('');
    setParticipantNotice('');
    setToast(`已把「${name}」临时加入本次课次（只写入本次课次，不回写班级名单）。`);
  };
  // 「至少一位到场学员」及其他五项前置校验统一走 data/lessonReadiness.js（US-410）：
  // go() 拦截时会把 attendance 那一条的具体原因写进 participantNotice（就地贴在这块面板上方），
  // 不再单独维护一份文案。
  const clearLessonSaveState=()=>setLessonSaveState(previous=>previous.status==='saving'?previous:{status:'idle',message:''});
  const selectLessonDate=(value)=>{
    setLessonDate(normalizeLessonDate(value));
    // 换日期等于换课次上下文：未来日期与同日课次的确认都要重来一次。
    setFutureDateConfirmed(false);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    clearLessonSaveState();
  };
  const selectLessonNo=(value)=>{
    setLessonNoInput(String(value??'').replace(/[^\d]/g,''));
    setLessonNoDirty(true);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    clearLessonSaveState();
  };
  const useRecommendedLessonNo=()=>{
    setLessonNoInput(recommendedLessonNo>0?String(recommendedLessonNo):'');
    setLessonNoDirty(false);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    clearLessonSaveState();
  };
  const useSameDayNextLessonNo=()=>selectLessonNo(String(sameDayNextNo));
  // 唯一键撞车时给出的修复动作：改成同一天的下一个序号。
  const applyConflictNextLessonNo=()=>selectLessonNo(String((lessonNoConflict?.lessonNo||0)+1));
  /**
   * 保存课次：日期与序号必填，唯一键 classId + lessonDate + lessonNo 班内唯一。
   * 未来日期与「同日已有课次」都要二次确认（futureOk / sameOk），重复创建直接拒绝并给出可读提示。
   */
  const performLessonSave=async({futureOk=false,sameOk=false}={})=>{
    if(!selectedClass){setToast('请先选择班级，再保存课次。');return;}
    if(!activeCourseId){setToast('请先选择课程，再保存课次。');return;}
    if(!lessonDate){setToast('课次日期为必填项，请先选择日期。');return;}
    if(!lessonNoValid){setToast('课时序号为必填正整数，请填写后再保存。');return;}
    if(lessonNoConflict){
      const message=`该班 ${lessonDate} 已有第 ${lessonNoConflict.lessonNo} 次课，请修改课时序号后再保存。`;
      setLessonConfirm({kind:'conflict',message,action:`改为第 ${lessonNoConflict.lessonNo+1} 次课`});
      setLessonSaveState({status:'error',message});
      return;
    }
    if(!futureOk&&isFutureLessonDate){
      setLessonConfirm({kind:'future',message:`课次日期 ${lessonDate} 在今天（${todayDate}）之后，确认按未来日期创建课次？`,action:'确认使用未来日期'});
      return;
    }
    if(!sameOk&&sameDayNos.length){
      setLessonConfirm({kind:'same-day',message:`该班该日期已有第 ${sameDayNos.join('、')} 次课，是否创建第 ${lessonNoValue} 次课？`,action:`确认创建第 ${lessonNoValue} 次课`});
      return;
    }
    setLessonConfirm(null);
    setLessonSaveState({status:'saving',message:'正在保存课次…'});
    const patch={classId:selectedClass.id,courseId:activeCourseId,lessonDate,lessonNo:lessonNoValue,topic:lessonTopic||'',teacherId:selectedClass.teacher||currentTeacherName,participants:effectiveParticipants};
    const settleSaved=(lesson)=>{
      setLessons(list=>mergeLessons([lesson],list));
      setCurrentLessonId(lesson.lessonId);
      setLessonNoInput(String(lesson.lessonNo));
      // 显式保存过的序号必须留住，不能再被推荐值顶掉；同一天已有课次的确认也不再重复问。
      setLessonNoDirty(true);
      setSameDayConfirmed(true);
    };
    try{
      // 注意：createLesson / updateLesson 是「先写本地镜像再推云端」，云端不通时**会抛错**，
      // 所以收尾逻辑不能只写在 await 之后，catch 里必须按唯一键把本地镜像找回来。
      const saved=canUpdateLesson
        ? await updateLesson(currentLessonId,patch,{existingLessons:lessons})
        : await createLesson(patch,{existingLessons:lessons});
      settleSaved(saved);
      setLessonSaveState({status:'saved',message:`已保存：第 ${saved.lessonNo} 次课 · ${saved.lessonDate}`});
      setToast(`课次已保存：第 ${saved.lessonNo} 次课 · ${saved.lessonDate}`);
    }catch{
      // 云端失败时本地镜像里已经有这条课次（saveLesson 先落本地再推云端）：
      // 按唯一键读回来并进 state，否则下一次 persistLessons 会用旧列表覆盖镜像（US-003 的教训），
      // 而且下次保存会因为拿不到 lessonId 而重复创建同一次课。
      const mirrored=loadLessons();
      setLessons(list=>mergeLessons(mirrored,list));
      const persisted=mirrored.find(item=>item.classId===patch.classId&&item.lessonDate===patch.lessonDate&&item.lessonNo===patch.lessonNo);
      if(persisted) settleSaved(persisted);
      // 提示只讲老师能做的事，不暴露云端原始报错（沿用 US-003 的文案口径）。
      setLessonSaveState({status:'error',message:'课次已保存在本机，云端未同步；稍后可再次点击「保存课次」重试。'});
      setToast('课次已保存在本机，云端未同步，稍后可重试。');
    }
  };
  const requestLessonSave=()=>performLessonSave({futureOk:futureDateConfirmed,sameOk:sameDayConfirmed});
  const confirmLessonAction=()=>{
    if(!lessonConfirm) return;
    if(lessonConfirm.kind==='conflict'){applyConflictNextLessonNo();return;}
    if(lessonConfirm.kind==='future') setFutureDateConfirmed(true);
    if(lessonConfirm.kind==='same-day') setSameDayConfirmed(true);
    // 未来日期与同日课次可能同时挂着：确认一个之后继续检查另一个。
    performLessonSave({
      futureOk:lessonConfirm.kind==='future'?true:futureDateConfirmed,
      sameOk:lessonConfirm.kind==='same-day'?true:sameDayConfirmed
    });
  };
  // ---- 草稿持久化（US-409）--------------------------------------------------------
  // 只落元数据：课次信息（班级 / 课程 / 日期 / 序号 / 课题）+ 学员选择 + 学员作品名 + 步骤。
  // 图片本体 / object URL / base64 没有任何入口：`buildFeedbackDraft` 只复制已知的标量字段，
  // `persistFeedbackDraft` 再用 containsMediaPayload 兜底。会话素材痕迹另存一条键（见下）。
  const draftSnapshot=buildFeedbackDraft({
    step,
    classId:selectedClass?.id||'',
    courseId:activeCourseId,
    lessonDate,
    lessonNo:lessonNoValue,
    topic:lessonTopic,
    participants:effectiveParticipants,
    artworkTitles:classArtworkItems.map(item=>({studentId:item.studentId,studentName:item.studentName,title:item.title}))
  });
  // 快照是确定性的（savedAt 由落盘时打），所以可以序列化成依赖键，避免每次渲染都写 localStorage。
  const draftSnapshotKey=JSON.stringify(draftSnapshot);
  // 只有「确实有值得恢复的内容」才写草稿：什么都还没动的初始态不落盘，
  // 于是「新建草稿」之后 localStorage 里是真的干净（而不是又存了一份初始值）。
  const draftHasContent=step>1
    ||Boolean(currentLessonId)
    ||lessonNoDirty
    ||lessonDate!==todayDate
    ||selectedClassId!==defaultClassId
    ||participantSignature(participants)!==participantSignature(rosterParticipants(classStudents))
    ||classArtworkItems.length>0
    ||classPhotoItems.length>0
    ||Boolean(media.artwork||media.photo);
  useEffect(()=>{
    if(draftHasContent){persistFeedbackDraft(draftSnapshot);return}
    // 恢复出来的内容与初始态一模一样（例如只上传过素材）→ 没有可恢复的东西，顺手清掉草稿。
    if(initialDraft) clearFeedbackDraft();
  },[draftSnapshotKey,draftHasContent]);
  // 会话素材痕迹与草稿分开存：草稿里不允许出现任何素材字段，这条记录只用来判断
  // 「上次选过素材、这次会话里没有 → 刷新后失效了」。瘦身收敛点仍是 buildSessionMediaDraft 一处。
  useEffect(()=>{persistSessionMediaSnapshot(buildSessionMediaDraft(media))},[media]);
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
  /**
   * 老师选择的文件先过准入规则，再在本机把超长边图片降采样（US-408）。
   *
   * 三条规则集中在 `data/mediaValidation.js`：
   * - 格式白名单 JPEG / PNG / WebP（非白名单拒绝并说明原因）；
   * - 单张 10MB 上限（超限跳过，**不影响同批其它文件**）；
   * - 长边 > 3000px 在本机降采样后再处理。
   *
   * 返回 `files` 是**已经可以进入绑定/上传**的文件（类型已归一化、已降采样），
   * `notice` 是可读的跳过原因与降采样说明（给内联提示 + toast 用）。
   */
  const prepareSelectedFiles=async(fileList)=>{
    const screened=screenMediaFiles(fileList);
    const notices=[];
    if(screened.message) notices.push(screened.message);
    const files=[];
    for(const file of resolveMediaTypes(screened.accepted)){
      const prepared=await downsampleImageFile(file);
      if(!prepared.ok||!prepared.file){
        notices.push(prepared.message);
        continue;
      }
      if(prepared.downsampled) notices.push(prepared.message);
      files.push(prepared.file);
    }
    return {files,rejected:screened.rejected,notice:notices.filter(Boolean).join('')};
  };
  /**
   * 会话素材的缩略图（US-413）：条目**先**进界面（有 url 就能绑定、能填作品名），
   * 缩略图挪到空闲时段生成，长边不超过 `THUMBNAIL_MAX_EDGE`（320px）；生成完成后只回填这一条的
   * `thumbUrl`，列表随即换成小图。生成过程不阻塞输入 —— 输入框、按钮、后续上传都在缩略图之前就已经可用。
   *
   * 列表在缩略图就绪前渲染占位图（**不是**原图）：22 位学员同时把 3000px 原图塞进列表会让
   * 解码内存和滚动帧率一起塌掉，这正是本故事要避免的。生成失败时才退回原图（极少见）。
   *
   * `entries[i]` 与 `files[i]` 一一对应（绑定函数按传入顺序产出条目），所以这里按顺序配对。
   */
  const scheduleThumbnails=(kind,entries,files)=>{
    const pairs=(entries||[]).map((entry,index)=>({entry,file:(files||[])[index]})).filter(item=>item.entry&&item.file);
    if(!pairs.length) return;
    setThumbPendingCount(current=>current+pairs.length);
    pairs.forEach(({entry,file})=>{
      scheduleMediaTask(async()=>{
        const thumb=await createThumbnail(file);
        setBatchUploads(current=>{
          const list=current[kind]||[];
          // 条目已经被移除 / 换班：这次生成的地址没有归属，直接回收，别留在内存里。
          if(!list.some(item=>item.uploadId===entry.uploadId)){
            if(thumb.ok&&thumb.url) revokeMediaUrl(thumb.url);
            return current;
          }
          // 生成失败时退回原图，列表不至于一直停在占位上（正常情况下不会走到这里）。
          const nextThumb=thumb.ok&&thumb.url?thumb.url:entry.url;
          return {...current,[kind]:updateUploadEntry(list,entry.uploadId,{thumbUrl:nextThumb})};
        });
        setThumbPendingCount(current=>Math.max(0,current-1));
      });
    });
  };
  /** 记一次录入节奏（US-413）：素材变化时重算用时，不用定时器刷整页。 */
  const noteIntakeProgress=()=>setIntakeElapsedSeconds(Math.max(0,Math.round((Date.now()-intakeStartedAtRef.current)/1000)));
  /** 折叠 / 展开某个出席分组（key 形如「artwork:absent」）。 */
  const toggleSlotGroup=(key)=>setCollapsedSlotGroups(current=>current.includes(key)?current.filter(item=>item!==key):[...current,key]);
  // 课后反馈只收图片：作品与课堂照片。视频已从这条工作流里去掉。
  // binding（可选）把「这份素材属于谁」写到媒体对象上：个人反馈只有一个上传位，
  // 归属是隐式的（= 选中的那位学员），US-406b 要求它就地绑定，而不是等下游去猜。
  const readFile=async(kind,file,binding={})=>{
    if(!file) return;
    // 最后一道守卫：prepareSelectedFiles 之外（例如直接调用）的选择也要过同一条规则。
    const check=validateMediaFile(file);
    if(!check.ok){
      setToast(check.message);
      return;
    }
    const previousUrl=media[kind]?.url||'';
    const url=URL.createObjectURL(file);
    // 上一个会话内地址立刻回收：object URL 只在当次会话有效，留着只是白占内存。
    revokeMediaUrl(previousUrl);
    // Show the selected file immediately. The server upload only enriches this
    // local preview for AI processing; a temporary network error must not make
    // the user think the click did nothing.
    setMedia(current=>({...current,[kind]:{id:`local-${Date.now()}`,name:file.name,url,originalUrl:url,orientedUrl:url,rotation:0,orientationConfirmed:false,processingRequested:false,type:file.type,size:file.size,storage:'local-preview',uploadStatus:'uploading',...binding}}));
    setUploadState(current=>({...current,[kind]:'uploading'}));
    try{
      const uploaded=await uploadControlledMedia(kind,file);
      setMedia(current=>({...current,[kind]:{...current[kind],...uploaded,url,storage:'controlled-memory',uploadStatus:'ready',...binding}}));
      setUploadState(current=>({...current,[kind]:'ready'}));
      setToast(`已受控上传${kind==='artwork'?'学员作品':'课堂照片'}：${file.name}`);
    }catch(error){
      setMedia(current=>({...current,[kind]:{...current[kind],uploadStatus:'local-only'}}));
      setUploadState(current=>({...current,[kind]:'local-only'}));
      setToast(`${kind==='artwork'?'作品':'照片'}已在本地预览；受控上传暂未连接，稍后可重新选择文件提交 AI。`);
    }
  };
  // 上传卡片的摘要：班级反馈下必须说清「几份素材绑定到了几位学员」，
  // 否则「未绑定」的素材会被当成正常素材，直到第三步展签上才发现。
  // 个人反馈（US-406b）只有一个上传位，摘要里明说它绑定到了哪位学员。
  const uploadSummary=(kind)=>{
    const items=batchUploads[kind];
    const single=kind==='artwork'?media.artwork:media.photo;
    const fallback=kind==='artwork'?'支持个人或按学员批量上传':'课堂人物照片，可批量上传';
    if(mode!=='班级反馈'){
      if(!single?.url) return fallback;
      const bound=single.studentName||selectedParticipant?.name||'';
      return kind==='artwork'&&bound?`${single.name} · 已自动绑定 ${bound}`:single.name;
    }
    if(kind==='artwork'&&items.length) return `本次已上传 ${items.length} 幅作品 · 按学员上传位逐幅管理`;
    if(!items.length) return single?.url?single.name:fallback;
    const bound=items.filter(item=>item.studentId).length;
    const unbound=items.length-bound;
    return `已选择 ${items.length} ${kind==='artwork'?'幅作品':'张照片'} · ${bound} 份已绑定学员${unbound?`，${unbound} 份未绑定`:''}`;
  };
  /**
   * 批量选择素材（班级反馈）。
   *
   * 返回值从「纯文件列表」改成**带 studentId 的绑定结构**：每一份素材在上传这一刻就绑定到
   * 一位具体的到场学员，绑定结果同时写回 participant.artworkIds / photoIds。
   * 空位不够时多出来的素材保持未绑定（studentId 为空）并在提示里说明，**不按序号猜姓名**。
   * 个人反馈只有一个上传位，作品在这里就地绑定到当前选中的学员，因此返回空数组。
   *
   * US-408 起这批文件先过 `prepareSelectedFiles`（格式白名单 / 10MB / 降采样）：
   * 不合格的份数被跳过并说明原因，**不影响同批其它文件**。
   */
  const readFiles=async(kind,fileList,input)=>{
    const rawFiles=Array.from(fileList||[]);
    // Clearing the native input lets a teacher choose the same photo again
    // after a failed upload or a quick correction.
    const sourceInput=input||({artwork:artworkInput,photo:photoInput}[kind]?.current);
    if(sourceInput) sourceInput.value='';
    if(!rawFiles.length) return [];
    const intake=await prepareSelectedFiles(rawFiles);
    setMediaIntakeNotice(intake.notice);
    const files=intake.files;
    if(!files.length){
      setToast(intake.notice||'没有可用的素材，请重新选择。');
      return [];
    }
    if(mode==='班级反馈'){
      const binding=bindFilesToParticipants(files,effectiveParticipants,{kind,existing:batchUploads[kind],title:lessonTopic||''});
      setBatchUploads(current=>({...current,[kind]:[...current[kind],...binding.entries]}));
      // 缩略图在空闲时段生成（US-413）：条目与输入先可用，生成过程不阻塞录入。
      scheduleThumbnails(kind,binding.entries,files);
      noteIntakeProgress();
      // 绑定要同时落到 participants 上：展签、成长档案、海报都按 artworkIds 认人。
      if(binding.bound) setParticipants(binding.participants);
      const names={artwork:'学员作品',photo:'课堂照片'};
      const unboundNote=binding.unbound?`；其中 ${binding.unbound} 份没有对应的到场学员，已标为「未绑定学员」，请核对后重选`:'';
      const bindingToast=`已添加 ${files.length} 份${names[kind]}，${binding.bound} 份已绑定学员${unboundNote}`;
      // readFile 是异步的（受控上传成功后还会再弹一条 toast），绑定结果必须最后说 ——
      // 否则老师只看到「已在本地预览」，看不到「有几份没绑定」。
      readFile(kind,files[0]).finally(()=>setToast(intake.notice?`${bindingToast}；${intake.notice}`:bindingToast));
      return binding.entries;
    }
    // 个人反馈：只有一个上传位，作品自动绑定到当前选中的这位学员（US-406b 的 AC）。
    // binding 写到 media 对象上，下游（展签/档案/海报）据此认人，不需要再靠「当前选中的是谁」猜。
    readFile(kind,files[0],kind==='artwork'?{studentId:selectedParticipant?.studentId||'',studentName:selectedParticipant?.name||''}:{})
      .finally(()=>{if(intake.notice) setToast(intake.notice)});
    return [];
  };
  // ---- 学员乘上传位的操作（US-406b）------------------------------------------------
  /**
   * 在**某位学员的上传位里**选文件：这批文件就是这个孩子的作品，直接绑给他（不做轮转）。
   * 超过每人 5 幅的份数被忽略并明确提示；受控上传仍走同一条 readFile（第一步的「已上传作品」标记、
   * 媒体状态与后续 AI 取图都依赖它）。
   * US-408：这批文件先过准入规则与降采样，不合格的份数被跳过且不影响同批其它文件。
   */
  const readStudentArtwork=async(participant,fileList,input)=>{
    const rawFiles=Array.from(fileList||[]);
    // 清空原生 input，否则同一位学员再选同一批文件不会触发 onChange。
    if(input) input.value='';
    if(!rawFiles.length||!participant?.name) return;
    const intake=await prepareSelectedFiles(rawFiles);
    setMediaIntakeNotice(intake.notice);
    if(!intake.files.length){
      setToast(intake.notice||`「${participant.name}」这次没有可用素材，请重新选择。`);
      return;
    }
    const binding=bindFilesToStudent(intake.files,participant,{kind:'artwork',existing:batchUploads.artwork,participants,title:''});
    // 草稿恢复（US-409）：上次存过的作品名按「这位学员 + 顺序」填回重新选择的素材上，
    // 只填空标题（这次手填过的名字不覆盖）。素材本体不再存在，所以只能按顺序对位。
    const restored=applySavedTitles(binding.entries,pendingTitles,participant);
    const entries=restored.entries;
    const filledCount=entries.filter(item=>String(item.title||'').trim()).length;
    if(restored.titles.length!==pendingTitles.length) setPendingTitles(restored.titles);
    if(entries.length){
      setBatchUploads(current=>({...current,artwork:[...current.artwork,...entries]}));
      // 缩略图挪到空闲时段（US-413）：这一行马上就能继续填作品名、继续传下一位学员。
      scheduleThumbnails('artwork',entries,intake.files);
      noteIntakeProgress();
      // 绑定同时写回 participant.artworkIds：展签、成长档案、海报都按它认人。
      setParticipants(binding.participants);
    }
    const overflowNote=binding.ignored?`；另有 ${binding.ignored} 幅超过每人 ${binding.max} 幅上限，已忽略，请分次或换一位学员上传`:'';
    const titleNote=filledCount?`；已填回 ${filledCount} 个上次保存的作品名`:'';
    const baseMessage=entries.length
      ? `已为「${participant.name}」添加 ${entries.length} 幅作品（共 ${binding.used+entries.length}/${binding.max} 幅）${titleNote}${overflowNote}`
      : `「${participant.name}」已达每人 ${binding.max} 幅上限${overflowNote}`;
    const message=intake.notice?`${baseMessage}；${intake.notice}`:baseMessage;
    // readFile 是异步的（受控上传成功/失败还会再弹一条 toast），绑定结果必须最后说（US-406a 的教训）。
    if(entries.length) readFile('artwork',intake.files[0]).finally(()=>setToast(message));
    else setToast(message);
  };
  /** 逐幅填写作品名：只改这一条，不动绑定与顺序。 */
  const renameArtworkTitle=(uploadId,title)=>setBatchUploads(current=>({...current,artwork:updateUploadEntry(current.artwork,uploadId,{title})}));
  /** 移除一幅作品：条目与 participant 上的 artworkId 一起摘掉，避免留下悬空引用；两个 object URL 一并回收。 */
  const removeArtwork=(uploadId)=>{
    const target=batchUploads.artwork.find(item=>item.uploadId===uploadId);
    revokeMediaUrl(target?.url);
    revokeMediaUrl(target?.thumbUrl);
    setBatchUploads(current=>({...current,artwork:removeUploadEntry(current.artwork,uploadId)}));
    setParticipants(current=>detachUploadBinding(current,uploadId,'artwork'));
  };
  /** 一键把本次课题套用为默认作品名：只填空着的作品名，不覆盖老师已经手填的名字。 */
  const applyTopicToArtworkTitles=()=>{
    const topic=String(lessonTopic||'').trim();
    if(!topic){setToast('本次课程还没有默认课题：请先到「课程库」补充，或逐幅手动填写作品名。');return;}
    const applied=applyDefaultTitles(batchUploads.artwork,topic,{kind:'artwork'});
    if(!applied.changed){setToast('每幅作品都已经有作品名了，没有被改动的条目。');return;}
    setBatchUploads(current=>({...current,artwork:applied.entries}));
    setToast(`已把《${topic}》套用为 ${applied.changed} 幅作品的默认作品名（已手填的名字保持不动）。`);
  };
  // ---- 学员课堂照片上传位（US-009）-------------------------------------------------
  /**
   * 在某位学员的照片上传位里选文件：这批照片就是这个孩子的（**不做轮转、不猜人**）。
   * 照片是选填项，超过每人 10 张的份数被忽略并明确提示。
   * 归属变化后统一用 `syncUploadBindings` 按条目重建 participants.photoIds ——
   * 因为照片支持改分配（分给多人/取消分配），只追加不重算会留下悬空 id。
   */
  const readStudentPhoto=async(participant,fileList,input)=>{
    const rawFiles=Array.from(fileList||[]);
    // 清空原生 input，否则同一位学员再选同一批照片不会触发 onChange。
    if(input) input.value='';
    if(!rawFiles.length||!participant?.name) return;
    const intake=await prepareSelectedFiles(rawFiles);
    setMediaIntakeNotice(intake.notice);
    if(!intake.files.length){
      setToast(intake.notice||`「${participant.name}」这次没有可用素材，请重新选择。`);
      return;
    }
    const binding=bindFilesToStudent(intake.files,participant,{kind:'photo',existing:classPhotoItems,participants,title:''});
    if(!binding.entries.length){
      setToast(`「${participant.name}」已达每人 ${binding.max} 张课堂照片上限，请先移除再添加。`);
      return;
    }
    const next=[...classPhotoItems,...binding.entries];
    setBatchUploads(current=>({...current,photo:next}));
    scheduleThumbnails('photo',binding.entries,intake.files);
    setParticipants(current=>syncUploadBindings(current,next,'photo'));
    const overflowNote=binding.ignored?`；另有 ${binding.ignored} 张超过每人 ${binding.max} 张上限，已忽略`:'';
    const baseMessage=`已为「${participant.name}」添加 ${binding.entries.length} 张课堂照片（共 ${binding.used+binding.entries.length}/${binding.max} 张）${overflowNote}`;
    const message=intake.notice?`${baseMessage}；${intake.notice}`:baseMessage;
    // readFile 是异步的（受控上传成功后还会再弹一条 toast），照片提示必须最后说（US-406a 的教训）。
    readFile('photo',intake.files[0],{studentId:participant.studentId||'',studentName:participant.name||''}).finally(()=>setToast(message));
  };
  /**
   * 全班合影：一次选一张（或多张）照片，**同一份文件同时归属给全部到场学员**。
   * 这是「把同一张照片分配给多位学员」最常用的入口；单张照片的细粒度分配在照片行里点「分给多人」。
   */
  const readSharedPhotos=async(fileList,input)=>{
    const rawFiles=Array.from(fileList||[]);
    if(input) input.value='';
    if(!rawFiles.length) return;
    const intake=await prepareSelectedFiles(rawFiles);
    setMediaIntakeNotice(intake.notice);
    if(!intake.files.length){
      setToast(intake.notice||'没有可用的素材，请重新选择。');
      return;
    }
    const binding=bindSharedFiles(intake.files,effectiveParticipants,{kind:'photo',existing:classPhotoItems});
    if(!binding.entries.length){
      setToast(photoAssignTargets.length?'全班学员的课堂照片都已达每人 10 张上限，无法再添加合影。':'本次课次还没有到场的学员，请先在上方标记出席状态。');
      return;
    }
    const next=[...classPhotoItems,...binding.entries];
    setBatchUploads(current=>({...current,photo:next}));
    scheduleThumbnails('photo',binding.entries,intake.files);
    setParticipants(current=>syncUploadBindings(current,next,'photo'));
    const skippedNote=binding.skipped.length?`；${binding.skipped.join('、')} 已满 10 张，未分到这张合影`:'';
    const baseMessage=`已添加 ${binding.entries.length} 张全班合影，同一张分给 ${binding.owners} 位到场学员${skippedNote}`;
    const message=intake.notice?`${baseMessage}；${intake.notice}`:baseMessage;
    readFile('photo',intake.files[0],{}).finally(()=>setToast(message));
  };
  /** 移除一张课堂照片：条目与所有归属者的 photoIds 一起摘掉（照片可能是多人共用）；两个 object URL 一并回收。 */
  const removePhoto=(uploadId)=>{
    const target=classPhotoItems.find(item=>item.uploadId===uploadId);
    revokeMediaUrl(target?.url);
    revokeMediaUrl(target?.thumbUrl);
    const next=removeUploadEntry(classPhotoItems,uploadId);
    setBatchUploads(current=>({...current,photo:next}));
    setParticipants(current=>syncUploadBindings(current,next,'photo'));
    if(photoAssignId===uploadId){setPhotoAssignId('');setPhotoAssignSelection([]);}
  };
  /** 打开某张照片的「分给多位学员」面板，勾选状态预置为它当前的归属者。 */
  const openPhotoAssign=(uploadId)=>{
    const entry=classPhotoItems.find(item=>item.uploadId===uploadId);
    setPhotoAssignId(uploadId);
    setPhotoAssignSelection((entry?.owners||[]).map(owner=>participantKey(owner)));
    setToast('勾选这张照片要分给的学员，然后点「保存分配」。');
  };
  const cancelPhotoAssign=()=>{setPhotoAssignId('');setPhotoAssignSelection([])};
  const togglePhotoAssignTarget=(key)=>setPhotoAssignSelection(current=>current.includes(key)?current.filter(item=>item!==key):[...current,key]);
  const selectAllPhotoAssignTargets=()=>setPhotoAssignSelection(photoAssignTargets.map(participantKey));
  /** 保存分配：整体替换这张照片的归属，再按条目重建 participants.photoIds（不会留下悬空 id）。 */
  const confirmPhotoAssign=()=>{
    if(!assigningPhoto) return;
    const targets=photoAssignTargets.filter(item=>photoAssignSelection.includes(participantKey(item)));
    const result=setUploadOwners(classPhotoItems,assigningPhoto.uploadId,targets);
    setBatchUploads(current=>({...current,photo:result.items}));
    setParticipants(current=>syncUploadBindings(current,result.items,'photo'));
    setPhotoAssignId('');
    setPhotoAssignSelection([]);
    const rejectedNote=result.rejected.length?`；${result.rejected.join('、')} 已满 ${result.max} 张，未分到这张照片`:'';
    setToast(result.owners
      ? `这张照片已分给 ${result.owners} 位学员${rejectedNote}`
      : `已取消这张照片的全部分配，${assigningPhoto.name} 现在没有归属${rejectedNote}`);
  };
  const hasUploadedArtwork=Boolean(media.artwork?.url);
  const hasProcessedArtwork=Boolean(media.artwork?.cleanUrl&&media.artwork?.cleanAlgorithm===ARTWORK_CLEAN_ALGORITHM);
  // ---- 进入第二步的前置校验（US-410）-----------------------------------------------
  // 六项必填：班级 / 课程 / 课次日期 / 课时序号 / 至少一位出席学员 / 至少一幅作品。
  // 判定与「具体原因」文案的唯一真源是 data/lessonReadiness.js（零依赖纯函数），
  // 界面的校验清单与 go() 的拦截读同一份结果，不会出现「按钮说不行、其实能走」的漂移。
  // 作品数：班级反馈数上传位里已绑定的条目；个人反馈只有 media.artwork 这一个上传位。
  const intakeArtworkCount=mode==='班级反馈'?classArtworkItems.length:(hasUploadedArtwork?1:0);
  const intakeReadiness=evaluateIntake({
    classId:selectedClass?.id||'',
    classCount:availableClasses.length,
    courseId:activeCourseId,
    courseCount:courseOptions.length,
    lessonDate,
    lessonNoValid,
    mode,
    attendedCount,
    artworkCount:intakeArtworkCount
  });
  // 用来在点评区标注「这几段评语是哪位人设写出来的」。
  const activeProfileLabel=(teacherProfiles.find(item=>item.id===activeProfileId)||teacherProfiles[0])?.name||'默认人设';
  const go=(next)=>{
    // 第一步 → 第二步的前置校验（US-410）：六项任缺一项都**停在第一步**，一个 state 都不改，
    // 已填的班级/课程/日期/序号/学员/素材原样保留（「不跳步、不丢失已填内容」）。
    // 按钮本身在校验不通过时是 disabled 的，这里再拦一道：顶部流程导航（FlowStepper）也能直接调 go()。
    // 提示必须给**具体原因**（如「还没有上传任何学员作品」），不是笼统的「请完善信息」。
    if(next>=2&&!intakeReadiness.ok){
      const attendanceBlocked=intakeReadiness.checks.find(check=>check.id==='attendance');
      if(attendanceBlocked&&!attendanceBlocked.ok) setParticipantNotice(attendanceBlocked.reason);
      setToast(`${intakeReadiness.summary}。具体原因见下方「进入下一步的校验清单」。`);
      return;
    }
    if(next>=3&&!hasProcessedArtwork){setToast('作品正在自动处理，请等待作品裁剪完成后再进入五维点评。');return}
    if(next>=4&&(!hasProcessedArtwork||!reviewGenerated)){setToast('请等待作品点评生成完成后再归档。');return}
    setStep(next);
    if(next===2){
      if(hasProcessedArtwork){setFramingState('ready');return;}
      setMedia(current=>({...current,artwork:{...current.artwork,orientationConfirmed:true,processingRequested:true,framedStyle:'',cleanUrl:null,cleanAlgorithm:null,framedUrl:null}}));
      setFramingState('processing');
    }
  };
  /**
   * 新建草稿（US-409）：清空**全部**草稿元数据与会话素材，回到第一步初始态。
   * 这里的「初始态」= 无草稿进入时的状态：我带的第一个班 + 本班课程 + 今天 + 推荐序号 + 本班名单，
   * 个人反馈模式、未选学员。清完 localStorage 后写入 effect 不会立刻又存一份（见 draftHasContent）。
   */
  const resetDraft=()=>{
    clearFeedbackDraft();
    clearSessionMediaSnapshot();
    revokeMediaEntries(batchUploads.artwork);
    revokeMediaEntries(batchUploads.photo);
    revokeMediaUrl(media.artwork?.url);
    revokeMediaUrl(media.photo?.url);
    setMedia({artwork:null,photo:null});
    setBatchUploads({artwork:[],photo:[]});
    setMediaIntakeNotice('');
    setMediaLostDismissed(false);
    // 录入节奏与折叠分组也回到初始态（US-413）：新草稿的用时从零开始。
    intakeStartedAtRef.current=Date.now();
    setIntakeElapsedSeconds(0);
    setCollapsedSlotGroups([]);
    setThumbPendingCount(0);
    setReviews(reviewDefaults);
    setKeywords([]);
    setAiKeywords([]);
    setLocalDraftUsed(false);
    setKeywordDirty(false);
    setArchived(false);
    setReviewGenerated(false);
    setStep(1);
    setShowAllClasses(false);
    setSelectedClassId(defaultClassId);
    setSelectedStudentName('');
    setSelectedCourseId(resolveCourseId(courses,myClasses[0]?.course));
    setMode('个人反馈');
    setLessonDate(todayDate);
    setLessonNoDirty(false);
    setFutureDateConfirmed(false);
    setSameDayConfirmed(false);
    setLessonConfirm(null);
    setLessonSaveState({status:'idle',message:''});
    setCurrentLessonId('');
    setParticipants(rosterParticipants(management.students.filter(item=>item.className===myClasses[0]?.name)));
    setTemporaryName('');
    setParticipantNotice('');
    setPhotoAssignId('');
    setPhotoAssignSelection([]);
    setDraftRestored(false);
    setPendingTitles([]);
    setToast('已新建一份课后反馈草稿');
  };
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
  // 照片按学员分组渲染后，「第 N 张」的下标不再等于 batchUploads.photo 的下标（同一张合影出现在多人行里），
  // 所以照片旋转一律按 uploadId 定位，不按序号。
  const rotateUploadEntry=(kind,uploadId)=>setBatchUploads(current=>({...current,[kind]:current[kind].map(item=>item.uploadId===uploadId?{...item,rotation:((item.rotation||0)+90)%360,orientationChecked:false}:item)}));
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
  // 第一步的「家长授权状态提示」（US-411 / F-INTAKE-CONSENT-01）。
  // 非阻断：所选学员里有「未完成查看授权」的孩子时提示一句并列出姓名，全部已授权时**不渲染**
  // （避免噪音）。按钮是唯一入口动作，不影响「进入智能装裱」与「保存课次」的可用性。
  const consentNoticeField=consentSummary.hasUnauthorized?(
    <div className="intake-consent">
      <div className="intake-consent-head">
        <ShieldAlert size={14}/>
        <div>
          <b>{consentSummary.message}</b>
          <small>授权只影响「转发给家长」这一步；本次录入、装裱、点评与归档都不受影响，可以先完成、授权后补。</small>
        </div>
        <button type="button" className="text-link" onClick={()=>setConsentExpanded(value=>!value)}>{consentExpanded?'收起名单':`查看是哪 ${consentSummary.unauthorizedCount} 位`}</button>
      </div>
      {consentExpanded?<ul className="intake-consent-list">
        {consentSummary.items.map(item=><li key={item.studentId||item.name}>
          <b>{item.name}{item.temporary?<span className="tag">临时</span>:null}</b>
          <em className={item.status}>{item.statusLabel}</em>
          <small>{item.guardianName?`监护人：${item.guardianName}`:'还没有登记监护人联系方式'}</small>
        </li>)}
      </ul>:null}
      <div className="intake-consent-actions">
        <Button variant="secondary" icon={ShieldCheck} onClick={()=>navigate('authorization')}>去授权管理</Button>
        <small>{consentSummary.unregisteredCount?`其中 ${consentSummary.unregisteredCount} 位还没有授权记录（如临时加入的试听学员），请在「授权管理」先登记家长授权。`:'请家长在家长端完成查看授权，或联系机构管理员处理。'}</small>
      </div>
    </div>
  ):null;
  // 第一步的「参与学员与出席状态」面板（US-405）。
  // 名单来自班级名单；缺课学员仍写进 lesson.participants，只是 attendance='absent'（成长档案需要缺课留白）。
  // 临时加入的插班/试听只进本次课次，绝不回写班级名单。
  const attendanceButtons=(participant)=>(
    <div className="intake-attendance" role="group" aria-label={`${participant.name} 的出席状态`}>
      {ATTENDANCE_STATES.map(state=>(
        <button key={state} type="button" className={`${participant.attendance===state?'active':''} ${state}`} onClick={()=>setParticipantAttendance(participant.name,state)}>{ATTENDANCE_LABELS[state]}</button>
      ))}
    </div>
  );
  const participantField=selectedClass&&classStudents.length?(
    <div className="intake-participants">
      <div className="intake-participants-head">
        <b>参与学员与出席状态</b>
        <small>{mode==='班级反馈'?'缺课学员仍会写进本次课次，供成长档案生成缺课留白':'个人反馈只把选中的这位学员写进本次课次'}</small>
      </div>
      {mode==='班级反馈'?<div className="intake-participants-actions">
        <button type="button" onClick={selectAllParticipants}>全选本班 {classStudents.length} 人</button>
        <button type="button" onClick={invertParticipants}>反选</button>
        <button type="button" onClick={clearParticipants}>清空</button>
      </div>:null}
      <div className="intake-participants-stats">
        <span>本班 <b>{participantStats.roster}</b> 人</span>
        <span>出席 <b>{participantStats.present}</b></span>
        <span>缺课 <b>{participantStats.absent}</b></span>
        <span>补课 <b>{participantStats.makeup}</b></span>
        {participantStats.temporary?<span>临时学员 <b>{participantStats.temporary}</b></span>:null}
      </div>
      {mode==='班级反馈'?<>
        <div className="intake-participant-list">
          {classStudents.map(item=>{
            const participant=participants.find(entry=>entry.name===item.name)||null;
            return <div key={item.name} className={`intake-participant ${participant?'':'off'}`}>
              <label>
                <input type="checkbox" checked={Boolean(participant)} onChange={()=>toggleParticipant(item.name)} aria-label={`${item.name} 参与本次课次`}/>
                <span>{item.name}</span>
              </label>
              {participant?attendanceButtons(participant):<span className="intake-participant-note">未参与本次课次</span>}
            </div>;
          })}
          {participants.filter(item=>item.temporary).map(participant=><div key={`temporary-${participant.name}`} className="intake-participant temporary">
            <label><span className="tag">临时</span><span>{participant.name}</span></label>
            {attendanceButtons(participant)}
            <button type="button" className="text-link muted" onClick={()=>removeParticipant(participant.name)}>移除</button>
          </div>)}
        </div>
        <div className="intake-attendant-add">
          <input type="text" value={temporaryName} placeholder="临时加入非本班学员（插班 / 试听）" onChange={event=>setTemporaryName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();addTemporaryParticipant()}}}/>
          <button type="button" onClick={addTemporaryParticipant} disabled={!String(temporaryName||'').trim()}>加入本次课次</button>
          <small>只写入本次课次，不回写班级名单</small>
        </div>
      </>:null}
      {mode==='个人反馈'&&selectedParticipant?<div className="intake-participant-list">
        <div className="intake-participant">
          <label><span>{selectedParticipant.name}</span></label>
          {attendanceButtons(selectedParticipant)}
        </div>
      </div>:null}
      {mode==='个人反馈'&&!selectedStudent?<p className="intake-hint">请先在上方「选择学员」，再标记这位孩子的出席状态。</p>:null}
      {participantNotice?<p className="intake-lesson-warn">{participantNotice}</p>:null}
      <small className="intake-participants-foot">改动出席名单后请点「保存课次」，把它写进本次课次。</small>
    </div>
  ):null;
  // 第一步的「学员乘上传位」列表（US-406b）。
  // 班级反馈按到场学员一人一行：每行 1–5 幅作品，上传即绑定到这一行的学员（不做任何顺序推断），
  // 逐幅可填作品名、可单独移除；顶上一键把本次课题套用为默认作品名，并提示还有几位没有作品。
  const artworkSlotField=mode==='班级反馈'?(
    <div className="intake-upload-slots">
      <div className="intake-upload-slots-head">
        <b>学员作品上传位</b>
        <small>每位到场学员 1–5 幅，上传后逐幅填写作品名</small>
        <button type="button" onClick={applyTopicToArtworkTitles} disabled={!classArtworkItems.length}>把本次课题套用为作品名</button>
      </div>
      <p className={missingArtworkCount?'intake-upload-pending':'intake-upload-pending ok'}>
        {!artworkSlotRows.length
          ? '本次课次还没有到场的学员：请先在上方标记出席状态，再按学员上传作品。'
          : (missingArtworkCount?`还有 ${missingArtworkCount} 位学员未上传作品`:`本班 ${artworkSlotRows.length} 位到场学员都已有作品`)}
      </p>
      {artworkPaceTotal?<div
        className={`intake-upload-perf${artworkPaceDone>=artworkPaceTotal?' done':''}`}
        data-intake-pace
        data-intake-done={artworkPaceDone}
        data-intake-total={artworkPaceTotal}
        data-intake-elapsed={intakeElapsedSeconds}
        data-intake-thumb-pending={thumbPendingCount}
      >
        <Clock3 size={13}/>
        <span className="intake-upload-pace">{artworkPaceText}</span>
        {thumbPendingText?<em className="intake-thumb-pending">{thumbPendingText}</em>:null}
      </div>:null}
      {artworkSlotRows.length?<IntakeSlotGroups
        listKey="artwork"
        rows={artworkSlotRows}
        collapsedKeys={collapsedSlotGroups}
        onToggle={toggleSlotGroup}
        renderRow={row=>(
          <div key={row.participant.studentId} className={`intake-upload-slot${row.usage.full?' full':''}${row.attended?'':' absent'}`}>
            <div className="intake-upload-slot-head">
              <label>
                <b>{row.participant.name}</b>
                {row.attended?<span className="tag muted">{ATTENDANCE_LABELS[row.participant.attendance]}</span>:<span className="tag">本次标记为缺课</span>}
              </label>
              <span className="intake-upload-count">已上传 <b>{row.usage.used}</b>/{row.usage.max} 幅</span>
              <input
                ref={element=>{artworkSlotInputs.current[row.participant.studentId]=element}}
                type="file" accept="image/jpeg,image/png,image/webp" hidden multiple
                onChange={event=>readStudentArtwork(row.participant,event.target.files,event.currentTarget)}
              />
              <button type="button" className="intake-upload-add" disabled={row.usage.full} onClick={()=>artworkSlotInputs.current[row.participant.studentId]?.click()}>
                {row.usage.full?`已达每人 ${row.usage.max} 幅上限`:'添加作品'}
              </button>
            </div>
            {row.uploads.length?<div className="intake-upload-items">
              {row.uploads.map((entry,index)=>(
                <figure key={entry.uploadId} data-thumb={entry.thumbUrl?'ready':'pending'}>
                  {/* 列表只渲染缩略图（≤320px，US-413）：生成期间显示占位，绝不把原图塞进列表 */}
                  <img src={entry.thumbUrl||INTAKE_THUMB_PLACEHOLDER} alt={`${row.participant.name}的作品`}/>
                  <div>
                    <input
                      type="text" value={entry.title||''}
                      placeholder="作品名（可点上方套用本次课题）"
                      aria-label={`${row.participant.name} 第 ${index+1} 幅作品的作品名`}
                      onChange={event=>renameArtworkTitle(entry.uploadId,event.target.value)}
                    />
                    <small>{entry.name}</small>
                  </div>
                  <button type="button" className="text-link muted" title="移除这幅作品" onClick={()=>removeArtwork(entry.uploadId)}>
                    <Trash2 size={12}/>移除
                  </button>
                </figure>
              ))}
            </div>:<p className="intake-upload-empty">这位学员还没有上传作品</p>}
          </div>
        )}
      />:null}
      <small className="intake-upload-foot">归属在上传那一刻就写进这位学员名下（展签、成长档案、海报都读这份绑定）；改班不会把作品带过去，请在新班级重新上传。</small>
    </div>
  ):null;
  // 第一步的「学员课堂照片上传位」（US-009）。
  // 与作品上传位**分开管理**：照片选填（0–10 张/人），不参与进入下一步的校验；
  // 另外支持「一张照片分给多位学员」—— 顶上「上传全班合影」一次分给全部到场学员，
  // 单张也可以在照片行里点「分给多人」逐人勾选（例如一位孩子和同伴的合照）。
  const photoSlotField=mode==='班级反馈'?(
    <div className="intake-upload-slots photo-slots">
      <div className="intake-upload-slots-head">
        <b>学员课堂照片上传位</b>
        <small>每位到场学员 0–10 张 · <em>选填</em>，不影响进入下一步</small>
        <input
          ref={sharedPhotoInput}
          type="file" accept="image/jpeg,image/png,image/webp" hidden multiple
          onChange={event=>readSharedPhotos(event.target.files,event.currentTarget)}
        />
        <button type="button" onClick={()=>sharedPhotoInput.current?.click()} disabled={!photoAssignTargets.length}>
          上传全班合影（同一张分给全班）
        </button>
      </div>
      <p className={missingPhotoCount?'intake-upload-pending':'intake-upload-pending ok'}>
        {!photoSlotRows.length
          ? '本次课次还没有到场的学员：请先在上方标记出席状态，再按学员上传课堂照片（也可以跳过）。'
          : (missingPhotoCount
            ? `还有 ${missingPhotoCount} 位学员未上传课堂照片（选填，可以继续下一步）`
            : `本班 ${photoSlotRows.length} 位到场学员都已有课堂照片（已收录 ${classPhotoItems.length} 张）`)}
      </p>
      {photoSlotRows.length?<IntakeSlotGroups
        listKey="photo"
        className="photo-slots-list"
        rows={photoSlotRows}
        collapsedKeys={collapsedSlotGroups}
        onToggle={toggleSlotGroup}
        renderRow={row=>(
          <div key={participantKey(row.participant)} className={`intake-upload-slot${row.usage.full?' full':''}${row.attended?'':' absent'}`}>
            <div className="intake-upload-slot-head">
              <label>
                <b>{row.participant.name}</b>
                {row.attended?<span className="tag muted">{ATTENDANCE_LABELS[row.participant.attendance]}</span>:<span className="tag">本次标记为缺课</span>}
              </label>
              <span className="intake-upload-count">已上传 <b>{row.usage.used}</b>/{row.usage.max} 张</span>
              <input
                ref={element=>{photoSlotInputs.current[participantKey(row.participant)]=element}}
                type="file" accept="image/jpeg,image/png,image/webp" hidden multiple
                onChange={event=>readStudentPhoto(row.participant,event.target.files,event.currentTarget)}
              />
              <button type="button" className="intake-upload-add" disabled={row.usage.full} onClick={()=>photoSlotInputs.current[participantKey(row.participant)]?.click()}>
                {row.usage.full?`已达每人 ${row.usage.max} 张上限`:'添加照片'}
              </button>
            </div>
            {row.uploads.length?<div className="intake-upload-items photo-items">
              {row.uploads.map(entry=>(
                <figure key={entry.uploadId} data-thumb={entry.thumbUrl?'ready':'pending'}>
                  <img src={entry.thumbUrl||INTAKE_THUMB_PLACEHOLDER} alt={`${row.participant.name}的课堂照片`} style={{transform:`rotate(${entry.rotation||0}deg)`}}/>
                  <div>
                    <small className="photo-name">{entry.name}</small>
                    <small className={entry.owners.length>1?'photo-shared':'photo-owner'}>
                      {entry.owners.length>1
                        ? `共用 · 已分给 ${entry.owners.length} 位学员：${entry.owners.map(owner=>owner.studentName).join('、')}`
                        : '仅这位学员'}
                    </small>
                  </div>
                  <button type="button" className="text-link" title="把这张照片分给多位学员" onClick={()=>openPhotoAssign(entry.uploadId)}>分给多人</button>
                  <button type="button" className="text-link muted" title="移除这张照片" onClick={()=>removePhoto(entry.uploadId)}>
                    <Trash2 size={12}/>移除
                  </button>
                </figure>
              ))}
            </div>:<p className="intake-upload-empty">这位学员还没有课堂照片（选填，可留空）</p>}
          </div>
        )}
      />:null}
      {unassignedPhotos.length?<div className="intake-photo-orphans">
        <div className="intake-photo-orphans-head">
          <b>还没有归属的照片（{unassignedPhotos.length} 张）</b>
          <small>这些照片不会出现在展签与成长档案里；请分给学员，或直接移除。</small>
        </div>
        <div className="intake-upload-items photo-items">
          {unassignedPhotos.map(entry=>(
            <figure key={entry.uploadId}>
              <img src={entry.url} alt={entry.name} style={{transform:`rotate(${entry.rotation||0}deg)`}}/>
              <div>
                <small className="photo-name">{entry.name}</small>
                <small className="photo-owner">未归属任何学员</small>
              </div>
              <button type="button" className="text-link" title="把这张照片分给学员" onClick={()=>openPhotoAssign(entry.uploadId)}>分给多人</button>
              <button type="button" className="text-link muted" title="移除这张照片" onClick={()=>removePhoto(entry.uploadId)}>
                <Trash2 size={12}/>移除
              </button>
            </figure>
          ))}
        </div>
      </div>:null}
      {assigningPhoto?<div className="intake-photo-assign">
        <div className="intake-photo-assign-head">
          <img src={assigningPhoto.url} alt={assigningPhoto.name}/>
          <div>
            <b>把「{assigningPhoto.name}」分给哪些学员？</b>
            <small>同一张照片可以分给多位学员（例如全班合影）。取消全部勾选就表示这张照片不归属于任何学员。</small>
          </div>
        </div>
        <div className="intake-photo-assign-targets">
          {photoAssignTargets.length
            ? photoAssignTargets.map(item=>{
              const key=participantKey(item);
              return <label key={key} className={photoAssignSelection.includes(key)?'on':''}>
                <input type="checkbox" checked={photoAssignSelection.includes(key)} onChange={()=>togglePhotoAssignTarget(key)}/>
                <span>{item.name}</span>
              </label>;
            })
            : <small>本次没有到场的学员：请在「参与学员与出席状态」里先标记出席。</small>}
        </div>
        <div className="intake-photo-assign-actions">
          <button type="button" className="text-link" onClick={selectAllPhotoAssignTargets} disabled={!photoAssignTargets.length}>全班都分</button>
          <button type="button" className="text-link muted" onClick={()=>setPhotoAssignSelection([])}>全部取消</button>
          <button type="button" className="intake-upload-add" onClick={confirmPhotoAssign}>保存分配（{photoAssignSelection.length} 位学员）</button>
          <button type="button" className="text-link muted" onClick={cancelPhotoAssign}>放弃修改</button>
        </div>
      </div>:null}
      <small className="intake-upload-foot">课堂照片是选填项，每位学员 0–10 张；归属在上传或分配那一刻写进这些学员名下，展签与成长档案都读这份绑定。没有照片的学员在后续步骤显示占位。</small>
    </div>
  ):null;
  // 第一步的「课次日期 + 课时序号」面板（US-404）：两项必填，日期默认今天、序号默认推荐值。
  // 唯一键 classId + lessonDate + lessonNo 在保存时校验；未来日期与同日已有课次都要二次确认。
  const lessonScheduleField=activeCourseId?(
    <div className="intake-lesson-form">
      <div className="intake-lesson-head">
        <b>课次日期与课时序号</b>
        <small>下游展签、成长档案与阶段报告都取这里的日期</small>
      </div>
      <div className="intake-lesson-fields">
        <label>课次日期 <em>必填</em>
          <input type="date" value={lessonDate} onChange={event=>selectLessonDate(event.target.value)}/>
        </label>
        <label>课时序号 <em>必填</em>
          <input type="number" min="1" step="1" inputMode="numeric" placeholder="例如 13" value={lessonNoInput} onChange={event=>selectLessonNo(event.target.value)}/>
        </label>
      </div>
      <div className="intake-lesson-actions">
        <button type="button" className="text-link" onClick={()=>selectLessonDate(todayDate)}>用今天（{todayDate}）</button>
        <button type="button" className="text-link" onClick={useRecommendedLessonNo}>用推荐值（第 {recommendedLessonNo} 次）</button>
        <small>推荐值 = 该班该课程已归档 {archivedLessonCount} 次 + 1{recommendedTopic?` · 课题《${recommendedTopic}》`:''}</small>
      </div>
      {isFutureLessonDate?<p className={futureDateConfirmed?'intake-lesson-note ok':'intake-lesson-warn'}>
        {futureDateConfirmed?`已二次确认使用未来日期 ${lessonDate}（预排课）`:`${lessonDate} 在今天（${todayDate}）之后：未来日期需二次确认后才能保存`}
      </p>:null}
      {lessonNoConflict?<p className="intake-lesson-warn">
        该班 {lessonDate} 已有第 {lessonNoConflict.lessonNo} 次课，请修改课时序号后再保存。
        <button type="button" className="text-link" onClick={applyConflictNextLessonNo}>改为第 {lessonNoConflict.lessonNo+1} 次课</button>
      </p>:null}
      {!lessonNoConflict&&sameDayNos.length?(
        lessonNoValue>sameDayMaxNo
          ?<p className="intake-lesson-note ok">第 {lessonNoValue} 次课在该日期仍是空位；保存时会再确认一次。</p>
          :<p className="intake-lesson-note">
            该班该日期已有第 {sameDayAllNos.join('、')} 次课，是否创建第 {sameDayNextNo} 次？
            <button type="button" className="text-link" onClick={useSameDayNextLessonNo}>改用第 {sameDayNextNo} 次课</button>
          </p>
      ):null}
      <div className="intake-lesson-preview">
        <span>本次课次</span>
        <b>{lessonNoValid?`第 ${lessonNoValue} 次课`:'待填写课时序号'}</b>
        <small>{lessonDate||'待选择课次日期'} · {lessonTopic?`课题《${lessonTopic}》`:'该课程还没有默认课题，可先到课程库补充'}</small>
      </div>
      {lessonConfirm?<div className="intake-lesson-confirm">
        <span>{lessonConfirm.message}</span>
        <div>
          <button type="button" className="text-link" onClick={confirmLessonAction}>{lessonConfirm.action}</button>
          <button type="button" className="text-link muted" onClick={()=>setLessonConfirm(null)}>{lessonConfirm.kind==='conflict'?'知道了':'取消'}</button>
        </div>
      </div>:null}
      {lessonSaveState.status!=='idle'&&!lessonConfirm?<p className={lessonSaveState.status==='error'?'intake-lesson-warn':'intake-lesson-note ok'}>{lessonSaveState.message}</p>:null}
    </div>
  ):null;
  // 第一步底部的「进入下一步的校验清单」（US-410）：逐项列出六项必填，缺哪项就写清**具体原因**
  // （如「还没有上传任何学员作品」），不做「请完善信息」这种笼统提示。校验不通过时「进入智能装裱」
  // 按钮 disabled，但「保存课次」仍然可用 —— 保存草稿与进入下一步是两个独立动作，互不覆盖。
  const intakeReadinessPanel=(
    <div className={`intake-readiness ${intakeReadiness.ok?'ready':'blocked'}`}>
      <div className="intake-readiness-head">
        {intakeReadiness.ok?<CircleCheck size={14}/>:<ShieldAlert size={14}/>}
        <b>{intakeReadiness.ok?'前置校验已全部通过，可以进入智能装裱':`进入智能装裱前还差 ${intakeReadiness.failedCount} 项：${intakeReadiness.failedLabels.join('、')}`}</b>
        <small>共 {intakeReadiness.total} 项必填 · 已完成 {intakeReadiness.passedCount} 项</small>
      </div>
      <ul className="intake-readiness-list">
        {intakeReadiness.checks.map(check=><li key={check.id} className={check.ok?'ok':'todo'}>
          <span className="intake-readiness-mark">{check.ok?<Check size={12}/>:<X size={12}/>}</span>
          <div><b>{check.label}</b>{check.ok?null:<small>{check.reason}</small>}</div>
        </li>)}
      </ul>
      {intakeReadiness.ok?null:<p className="intake-readiness-note">校验没通过也可以先点「保存课次」把这次课次存成草稿：保存草稿与进入下一步是两个独立动作，互不覆盖 —— 不会跳步，也不会清掉已填内容。</p>}
    </div>
  );
  return <><PageHeader title="课后反馈" desc="每一个环节都可随时进入，当前进度会同步保留。" prd="课后反馈工作流"/>
    <section className="feedback-flow-v2">
      <FlowStepper steps={steps} step={step} flags={[intakeReadiness.ok,hasProcessedArtwork,reviewGenerated,archived]} onGo={go}/>
      <div className="scene-status"><span>当前进行：{steps[step-1][0]}</span><button onClick={()=>go(Math.max(1,step-1))} disabled={step===1}>反馈上一步</button></div>
      {reviewStream.open?<ReviewStreamPanel stream={reviewStream} profiles={teacherProfiles} activeProfileId={activeProfileId} setActiveProfileId={setActiveProfileId} onStart={startCloudReview} onStop={stopCloudReview} onLocalDraft={fillLocalDraft} onClose={()=>setReviewStream(current=>({...current,open:false}))}/>:null}
      {step===3&&!reviewStream.open?<ReviewLaunchPanel profiles={teacherProfiles} skillLibrary={skillLibrary} activeProfileId={activeProfileId} setActiveProfileId={setActiveProfileId} onStart={startCloudReview} onLocalDraft={fillLocalDraft} draftReady={reviewGenerated} localDraftUsed={localDraftUsed} keywordCount={keywords.length} hasArtwork={Boolean(media.artwork?.cleanUrl||media.artwork?.originalUrl)}/>:null}
      {step===2&&mode==='班级反馈'?<ClassFramingWall artworks={batchUploads.artwork} photos={batchUploads.photo} photoGroups={photoGroups} onRotate={index=>rotateBatchItem('artwork',index)} onRotatePhotoEntry={uploadId=>rotateUploadEntry('photo',uploadId)}/>:null}
      {step===1?<section className="scene-panel"><div className="scene-heading"><span>第一步</span><h2>创建课后反馈信息</h2><p>先确定服务对象，再同步收集本节课素材。素材只在本次操作中保留。</p></div>{draftRestored?<div className="intake-draft-restored"><Clock3 size={14}/><div><b>已恢复上次的课次信息；素材需重新选择</b><small>{draftRestoreDetail}</small></div>{pendingTitles.length?<em>已保留 {pendingTitles.length} 个作品名，「学员作品上传位」里重新选择素材后自动填回</em>:null}<button type="button" className="text-link" onClick={()=>setDraftRestored(false)}>知道了</button></div>:null}<div className="feedback-mode"><button className={mode==='个人反馈'?'selected':''} onClick={()=>selectMode('个人反馈')}>个人反馈<small>为一位孩子完成反馈</small></button><button className={mode==='班级反馈'?'selected':''} onClick={()=>selectMode('班级反馈')}>班级反馈<small>批量处理全班素材</small></button></div>{availableClasses.length?<div className="intake-scope"><span>班级范围</span><div className="intake-scope-switch"><button type="button" className={showAllClasses?'':'active'} onClick={()=>selectClassScope(false)}>我带的班（{myClasses.length}）</button><button type="button" className={showAllClasses?'active':''} onClick={()=>selectClassScope(true)}>全部班级（{availableClasses.length}）</button></div><small>当前登录老师：{currentTeacherName}</small></div>:null}{visibleClasses.length?<div className="task-form"><label>选择班级<select value={selectedClassId} onChange={event=>selectClass(event.target.value)}>{visibleClasses.map(item=><option key={item.id} value={item.id}>{item.name}{item.teacher?`（${item.teacher}）`:''}</option>)}</select></label><label>选择学员<select value={mode==='班级反馈'?'__class__':selectedStudentName} disabled={mode==='班级反馈'} onChange={event=>{setSelectedStudentName(event.target.value);setArchived(false)}}>{mode==='班级反馈'?<option value="__class__">本班全部学员（{classStudents.length}人）</option>:<><option value="">请选择学员</option>{classStudents.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</>}</select></label>{courseOptions.length?<label>选择课程<select value={activeCourseId} onChange={event=>selectCourse(event.target.value)}>{courseOptions.map(item=><option key={item.courseId} value={item.courseId}>{item.name}{item.courseId===classCourseId?' · 本班课程':''}</option>)}</select></label>:<div className="intake-course-empty"><b>课程库暂时没有可选课程</b><p>{classCourseName?`本班课程「${classCourseName}」不在可选课程里，可能已被停用。`:'课程由机构管理员在「课程库」中维护。'}</p>{role==='admin'?<Button variant="secondary" onClick={()=>navigate('courseLibrary')}>去课程库添加课程</Button>:<small>请联系机构管理员在「课程库」中新增或启用课程。</small>}</div>}{lessonScheduleField}{participantField}{consentNoticeField}{mediaIntakeNotice?<p className="intake-media-notice"><ShieldAlert size={14}/><span>{mediaIntakeNotice}</span></p>:null}</div>:<div className="intake-empty"><Users size={26}/><b>{showAllClasses?'机构里还没有任何班级':'还没有属于你的班级'}</b><p>{showAllClasses?'请先在「学员管理」中新建班级，再回到这里创建课后反馈。':'可以切到「全部班级」确认是否存在其他老师名下的班级，或先去「学员管理」新建班级。'}</p><div className="intake-empty-actions">{showAllClasses?null:<button type="button" className="text-link" onClick={()=>selectClassScope(true)}>查看全部班级</button>}<Button onClick={()=>navigate('classes')}>去学员管理添加班级</Button></div></div>}{mode==='个人反馈'&&selectedClass&&!classStudents.length?<p className="intake-hint">该班级还没有学员，请先在「学员管理」里导入名单，再创建课后反馈。</p>:null}{artworkSlotField}{photoSlotField}{mode==='个人反馈'?<div className="sync-upload"><div className={media.artwork?.url?'has-file':''}><Frame/><b>学员作品 <em>必选</em></b><small>{uploadSummary('artwork')}</small><input ref={artworkInput} type="file" accept="image/jpeg,image/png,image/webp" hidden multiple={mode==='班级反馈'} onChange={e=>readFiles('artwork',e.target.files,e.currentTarget)}/><button onClick={()=>artworkInput.current?.click()}>{media.artwork?.url?'已上传 · 重新选择':'上传作品'}</button></div><div className={media.photo?.url?'has-file':''}><Image/><b>学员照片 <em>选填</em></b><small>{uploadSummary('photo')}</small><input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden multiple={mode==='班级反馈'} onChange={e=>readFiles('photo',e.target.files,e.currentTarget)}/><button onClick={()=>photoInput.current?.click()}>{media.photo?.url?'已上传 · 重新选择':'上传照片'}</button></div></div>:null}{lostSessionMedia&&!mediaLostDismissed?<div className="intake-media-lost"><ShieldAlert size={14}/><div><b>上次选择的素材已失效</b><small>作品与课堂照片只在当次会话里有效（只使用会话内 object URL，不写入 localStorage / IndexedDB）。页面刷新或重新进入后，请重新选择原始素材。</small></div><button type="button" className="text-link" onClick={()=>setMediaLostDismissed(true)}>知道了</button></div>:null}<div className="upload-privacy-note"><ShieldCheck size={14}/>{mediaRulesText(UPLOAD_SLOTS_PER_STUDENT)}</div>{intakeReadinessPanel}<div className="scene-actions"><Button variant="secondary" onClick={resetDraft}>新建草稿</Button><Button variant="secondary" icon={Save} disabled={!activeCourseId||lessonSaveState.status==='saving'} onClick={requestLessonSave}>{lessonSaveState.status==='saving'?'保存中…':'保存课次'}</Button><Button icon={ArrowRight} disabled={!intakeReadiness.ok} onClick={()=>go(2)}>进入智能装裱</Button></div></section>:null}
      {step===2?<section className="scene-panel studio-task"><div className="scene-heading"><span>第二步</span><h2>智能装裱</h2><p>先旋转完整原图并确认方向；确认后自动裁掉纸外的桌面、地面与背景，只保留作品本身。装裱方案（画框、卡纸、展签、日期与署名）由管理员在「装裱设置」中统一维护，这里直接选用。</p></div><div className="media-process"><article><div className={`mini-frame uploaded-art${media.artwork?.framedUrl?' framed-preview':''}`}>{media.artwork?.url?<><img src={media.artwork.framedUrl||media.artwork.cleanUrl||media.artwork.orientedUrl||media.artwork.originalUrl} alt={media.artwork.framedUrl?`已按「${activeFrame?.name||'默认装裱'}」完成装裱的作品`:media.artwork.cleanUrl?'已裁掉纸外背景、只保留作品本身':'等待确认方向的完整原图'}/>{media.artwork?.framedUrl?<span className="framed-badge">{activeFrame?.name||'默认装裱'}</span>:null}<div className="frame-rotate-controls" aria-label="旋转作品"><button type="button" title="向左旋转 90°" aria-label="向左旋转作品" disabled={framingState==='rotating'||framingState==='processing'} onClick={()=>rotatePersonalArtwork(-1)}><RotateCcw size={18}/></button><button type="button" title="向右旋转 90°" aria-label="向右旋转作品" disabled={framingState==='rotating'||framingState==='processing'} onClick={()=>rotatePersonalArtwork(1)}><RotateCw size={18}/></button></div></>:'✺'}</div><div><b>学员作品</b><p>{framingState==='processing'?(media.artwork?.cleanUrl?'正在按当前装裱方案合成装裱图…':'正在裁掉纸外的桌面与地面，只保留作品本身…'):media.artwork?.framedUrl?`已装裱：${activeFrame?.name||'默认装裱'}。作品只做等比缩放与居中，不裁切主体、不重绘、不调色。`:media.artwork?.cleanUrl?'已完成作品裁剪，正在生成装裱图…':'当前仅显示完整原图；请先旋转到正确方向。'}</p>{!media.artwork?.cleanUrl?<button type="button" className="confirm-artwork-button" onClick={startArtworkCleanup} disabled={framingState==='rotating'||framingState==='processing'}>{framingState==='processing'?'正在裁剪作品…':'方向正确，开始裁剪与装裱'}</button>:null}<div className="tiny-choice">{enabledFrames.length?enabledFrames.map(item=><button key={item.id} className={activeFrameId===item.id?'active':''} disabled={framingState==='processing'} onClick={()=>setFrame(item.id)} title={item.spec?.atmosphere||item.description||item.name}>{item.name}</button>):<span className="frame-loading">正在读取装裱设置…</span>}</div></div></article><article><div className="photo-card">{media.photo?.url?<><img src={media.photo.url} alt="已自然优化的课堂照片" style={{transform:`rotate(${media.photo.rotation||0}deg)`}}/><button type="button" className="frame-rotate-button photo-rotate-button" onClick={rotatePersonalPhoto}><RefreshCw size={16}/>旋转照片</button></>:<img src={pandaMascot} alt="课堂照片占位预览"/>}</div><div><b>学员照片</b><p>{media.photo?.name||'未上传课堂照片，可返回上一步补充。'}</p></div></article></div><div className="scene-actions"><Button variant="secondary" onClick={()=>go(1)}>返回创建信息</Button><Button icon={ArrowRight} onClick={()=>go(3)}>进入五维点评</Button></div></section>:null}
      {step===3?<section className="scene-panel review-task-v2"><div className="review-media"><div className="scene-heading"><span>{mode==='班级反馈'?'本班课后素材':'本次课素材'}</span><h2>{mode==='班级反馈'?'周六创意绘画 2 班 · 班级课后反馈':`${selectedStudentLabel}${activeFrame?.plaqueTitle?` · 《${activeFrame.plaqueTitle}》`:''}`}</h2></div><div className={`review-gallery ${mode==='班级反馈'?'class-review-gallery':''}`}>{mode==='班级反馈'?<><ClassMediaMosaic items={classMosaicArtworks} kind="artwork" date={lessonDateDots} onRotate={index=>rotateBatchItem('artwork',index)}/><ClassMediaMosaic items={classMosaicPhotos} kind="photo" groups={photoGroups} date={lessonDateDots} onRotateEntry={uploadId=>rotateUploadEntry('photo',uploadId)}/></>:<><div className={`review-art exhibition-art${media.artwork?.framedUrl?' framed-art':''}`}>{media.artwork?.framedUrl?<div className="framed-art-final"><img src={media.artwork.framedUrl} alt={`${selectedStudentLabel}的作品 · ${activeFrame?.name||'装裱'}`}/>{activeFrame?.name?<span className="framed-badge">{activeFrame.name}</span>:null}</div>:<><div className="artwork-mat">{media.artwork?.url?<img src={media.artwork.cleanUrl||media.artwork.originalUrl||media.artwork.url} alt={`${selectedStudentLabel}的作品`}/>:'✺'}</div><div className="artwork-plaque"><div><b>{selectedStudentLabel}</b><span>{activeFrame?.plaqueTitle?`《${activeFrame.plaqueTitle}》`:''}</span></div><time>创作于 {(activeFrame?.plaqueDate||new Date().toISOString().slice(0,10).replace(/-/g,'.'))}</time></div></>}</div><div className="review-photo portrait-print"><div className="portrait-mat">{media.photo?.url?<img src={media.photo.url} alt="陈一诺课堂照片"/>:<img src={pandaMascot} alt="课堂照片占位"/>}</div><div className="portrait-caption">{selectedStudentLabel} · {(activeFrame?.plaqueDate||new Date().toISOString().slice(0,10).replace(/-/g,'.'))}</div></div></>}</div></div><ReviewKeywordDock visible selected={keywords} onToggle={toggleKeyword} suggested={aiKeywords} suggesting={keywordSuggesting} dirty={keywordDirty} generated={reviewGenerated}/><div className={`coach-review ${mode==='班级反馈'?'class-coach-review':''}`}><div className="scene-heading"><span>第三步</span><h2>{mode==='班级反馈'?'班级课程反馈':'五维点评'}</h2></div><select value={subject} onChange={e=>setSubject(e.target.value)}><option>通用美术</option><option>创意绘画（3-6岁）</option><option>儿童画（6-9岁）</option><option>素描（9-18岁）</option><option>速写（9-18岁）</option><option>水彩 / 水粉（7-18岁）</option><option>国画（6-18岁）</option></select><p className="evidence">{mode==='班级反馈'?'以下内容基于本节课课程设计、班级素材与老师观察生成，老师可编辑确认后发布给家长。':`下列内容由大模型生成：先读懂作品与课堂素材，再结合「${activeProfileLabel}」的人设、已启用技能与长期记忆，按五个维度分别输出评语。老师可逐条修改后再发布。`}</p>{mode==='班级反馈'?<ClassReviewContent subject={subject}/>:<><div className={`review-source ${reviewGenerated?(localDraftUsed?'local':'ai'):'pending'}`}>{reviewGenerated?(localDraftUsed?<><CircleAlert size={14}/><span>当前正文来自<strong>本地草稿模板</strong>（未调用大模型），发布前请老师逐条核对。</span></>:<><Sparkles size={14}/><span>当前正文由大模型「{activeProfileLabel}」依据人设、技能与长期记忆生成，可直接编辑。</span></>):<><Sparkles size={14}/><span>五个维度等待大模型生成：点击上方「开始生成点评」，评语会逐字写入这里。</span></>}{keywordDirty&&reviewGenerated?<em>观察词已调整，建议重新生成</em>:null}</div>{Object.entries(reviews).map(([name,copy])=><article className={`coach-card${copy?'':' is-empty'}`} key={name}><b>{name}{copy?null:<em className="review-pending">待生成</em>}</b><textarea aria-label={name} value={copy} placeholder={REVIEW_DIMENSION_HINTS[name]||''} onChange={event=>setReviews(current=>({...current,[name]:event.target.value}))}/></article>)}</>}<div className="scene-actions"><Button variant="secondary" onClick={()=>go(2)}>返回智能装裱</Button><Button icon={Archive} onClick={archiveRecord}>归档并生成分享</Button></div></div></section>:null}
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

/**
 * 第二步的班级装裱墙。
 *
 * 作品与照片**分开核对**（US-009）：作品是必选项，按上传位平铺；
 * 课堂照片是选填项，按学员分组渲染 —— **没有照片的学员也占一行并显示占位**，
 * 这样照片不会因为少了几张就整体前移，让老师误以为照片是别人家的。
 */
function ClassFramingWall({artworks=[],photos=[],photoGroups=[],onRotate,onRotatePhotoEntry}){
  const renderItems=(items,kind)=>{const rotate=kind==='artwork'?onRotate:onRotatePhotoEntry;const typeLabel=kind==='artwork'?'作品':'照片';return <div className="class-framing-scroll">{items.length?items.map((item,index)=><article className={`class-framing-item ${kind}`} key={`${kind}-${item.uploadId||item.name}-${index}`}><div className="class-framing-preview"><img src={item.url} alt={item.name} style={{transform:`rotate(${item.rotation||0}deg)`}}/><button type="button" onClick={()=>rotate?.(kind==='artwork'?index:item.uploadId)} title={`顺时针旋转${typeLabel}`}><RefreshCw size={14}/></button></div><div><b>{kind==='artwork'?'学员作品':'课堂照片'} {index+1}</b><small>{item.name}</small><em>{kind==='artwork'?'已按完整画面装裱':'已完成自然优化，可旋转校正'}</em></div></article>):<div className="class-framing-empty">本次未上传{kind==='artwork'?'学员作品':'课堂照片'}。</div>}</div>};
  const photoSection=photoGroups.length?(
    <div className="class-framing-photo-groups">
      {photoGroups.map(group=>(
        <article className={`class-framing-photo-group${group.uploads.length?'':' empty'}`} key={participantKey(group.participant)}>
          <div className="class-framing-photo-group-head">
            <b>{group.participant.name}</b>
            <small>{group.uploads.length?`${group.uploads.length} 张`:'未上传课堂照片（选填）'}</small>
          </div>
          {group.uploads.length?<div className="class-framing-photo-thumbs">
            {group.uploads.map(item=>(
              <figure key={item.uploadId}>
                <img src={item.url} alt={`${group.participant.name}的课堂照片`} style={{transform:`rotate(${item.rotation||0}deg)`}}/>
                <button type="button" onClick={()=>onRotatePhotoEntry?.(item.uploadId)} title="顺时针旋转照片"><RefreshCw size={14}/></button>
                {item.owners.length>1?<em>共用 · {item.owners.length} 人</em>:null}
              </figure>
            ))}
          </div>:<div className="class-framing-photo-placeholder"><Image size={14}/><span>本次没有这位孩子的课堂照片</span></div>}
        </article>
      ))}
    </div>
  ):renderItems(photos,'photo');
  return <section className="class-framing-wall">
    <div className="class-framing-wall-head"><div><b>本班装裱任务</b><small>作品与照片分开处理、分开核对；课堂照片按学员分组，没有照片的孩子显示占位。</small></div></div>
    <section className="class-framing-section"><div className="class-framing-section-head"><div><Frame size={16}/><b>学员作品</b></div><span>{artworks.length} 幅</span></div>{renderItems(artworks,'artwork')}</section>
    <section className="class-framing-section"><div className="class-framing-section-head"><div><Image size={16}/><b>课堂照片（按学员）</b></div><span>{photos.length} 张</span></div>{photoSection}</section>
  </section>
}

/**
 * 班级素材合展（第三步的班级反馈素材墙）。
 *
 * 展签只读 `item.plaque`（来自 data/uploadBinding 的**带绑定结构**）：姓名来自
 * participant.artworkIds/photoIds 对应的真实学员，作品名来自条目上的 title，日期来自课次日期。
 * 旧实现用 `students[index % students.length]` 猜姓名、把 `2026.08.11` 写死在组件里，
 * 素材份数多于学员数时会把同一个孩子的作品算到别人名下；US-406a 已删除这套推断。
 *
 * US-009：课堂照片传 `groups`（按学员分组，含没有照片的学员）时按分组铺 —— 少照片的学员
 * 显示**占位**而不是让后面的照片前移错位；一张合影出现在多位学员的分组里，展签写明是共用。
 */
function ClassMediaMosaic({items=[],kind='artwork',groups=null,onRotate,onRotateEntry,date=''}){
  const label=kind==='artwork'?'班级作品合展':'班级课堂瞬间';
  const plaqueDate=String(date||'').trim();
  const captionOf=item=>{
    const plaque=item.plaque||{};
    const student=String(plaque.studentName||item.studentName||'').trim();
    const title=String(plaque.title||item.title||'').trim();
    const parts=kind==='artwork'
      ? [student||'未绑定学员',title?`《${title}》`:'',plaqueDate]
      : [student||'未绑定学员',plaque.shared?'（共用照片）':'',plaqueDate];
    return parts.filter(Boolean).join(' · ');
  };
  const figureOf=(item,index,keyPrefix='')=>(
    <figure key={`${keyPrefix}${item.uploadId||`${item.name}-${index}`}`}>
      <img src={item.url} alt={item.name} style={{transform:`rotate(${item.rotation||0}deg)`}}/>
      {kind==='artwork'?<span className="orientation-note">{item.orientationChecked?'已自动校正':'已手动旋转'}</span>:null}
      <button className="rotate-work" type="button" title={`顺时针旋转${kind==='artwork'?'作品':'照片'}`} onClick={()=>{if(onRotateEntry)onRotateEntry(item.uploadId);else onRotate?.(index)}}><RefreshCw size={12}/></button>
      <figcaption className={item.plaque?.studentName||item.studentName?'':'unbound'}>{captionOf(item)}</figcaption>
    </figure>
  );
  const grouped=Array.isArray(groups)&&groups.length;
  const placeholderCount=grouped?groups.filter(group=>!group.uploads.length).length:0;
  const body=grouped
    ? groups.flatMap(group=>{
      // 同一张共用照片会出现在多行分组里，key 必须带上分组前缀，否则 React 会报重复 key 并可能复用错节点。
      const prefix=`${participantKey(group.participant)}-`;
      const rows=group.uploads.map((item,index)=>figureOf(item,index,prefix));
      if(!rows.length){
        rows.push(<figure key={`empty-${participantKey(group.participant)}`} className="mosaic-placeholder">
          <div><Image size={14}/><span>{group.participant.name}</span><small>本次未上传课堂照片（选填）</small></div>
        </figure>);
      }
      return rows;
    })
    : (items.length?items.map((item,index)=>figureOf(item,index)):<div className="mosaic-empty"><Frame/><span>等待班级素材上传</span></div>);
  return <div className={`class-media-mosaic ${kind}`}>{body}<div className="mosaic-label"><b>{label}</b><small>已收录 {items.length} 份{placeholderCount?` · ${placeholderCount} 位学员暂无照片，显示占位`:''}</small></div></div>;
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
  // 面板只认识 v1 平面字段，这里统一取视图：老预设（v1）原样、v2 预设映射成平面值。
  const draftSpec=frameSpecView(draft?.spec);

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
          <span className="frame-dot" style={{background:frameSpecView(preset.spec).outer||'#cfa52e'}}/>
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
          {draftSpec?<div className="framing-spec">
            <div className="framing-preview"><img src={preview} alt={`${draft.name}装裱预览`}/><small>预览使用占位作品，实际渲染时替换为学员作品</small></div>
            <div className="framing-spec-fields">
              <div className="spec-row"><span>外框</span><i style={{background:draftSpec.outer}}/><code>{draftSpec.outer}</code><em>宽 {Math.round((draftSpec.outerWidthRatio||0)*1000)/10}%</em></div>
              <div className="spec-row"><span>卡纸</span><i style={{background:draftSpec.mat}}/><code>{draftSpec.mat}</code><em>宽 {Math.round((draftSpec.matWidthRatio||0)*1000)/10}%</em></div>
              <div className="spec-row"><span>分隔线</span>{draftSpec.innerLine?<><i style={{background:draftSpec.innerLine}}/><code>{draftSpec.innerLine}</code></>:<em>无</em>}</div>
              <div className="spec-row"><span>展签</span><i style={{background:draftSpec.plaqueBg}}/><code>{draftSpec.plaqueBg}</code><em>文字 {draftSpec.plaqueText}</em></div>
              <div className="spec-row"><span>字体</span><code>{draftSpec.plaqueFontFamily}</code><em>字距 {draftSpec.plaqueLetterSpacing}</em></div>
              {draftSpec.atmosphere?<p className="spec-note">氛围：{draftSpec.atmosphere}</p>:null}
              {draftSpec.rationale?<p className="spec-note">理由：{draftSpec.rationale}</p>:null}
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
 // 「课次表单」全站只有一份实现：`TeacherFlowV2`（第一步创建信息 / 后续装裱·点评·归档都在这个组件里）。
 // 旧的 CreateFlow 向导（StepLesson/StepUpload/StepApps/StepGenerate/StepSuccess）已删除，
 // `create` 这个路由 id 保留下来只作为别名，供工作台 / 课后反馈列表 / AI 创作台的历史入口复用同一组件。
 const map={dashboard:TeacherWelcome,teacherFlow:TeacherFlowV2,create:TeacherFlowV2,lessons:LessonsPage,ai:TeacherAIWorkspace,tasks:TasksPage,progress:ProgressBoard,classes:StudentArchiveData,growthCenter:PersonalGrowthCenter,archives:GrowthArchiveData,parent:ParentHomeFamily,parentInsight:ParentInsight,parentArchive:ParentArchiveFamily,authorization:AuthorizationPage,profile:ProfilePage,adminDash:AdminDashboard,apps:AppsPage,providers:ProvidersPage,teacherPersona:TeacherPersonaPage,skillLibrary:SkillLibraryPage,courseLibrary:CourseLibraryPage,framingSettings:FramingSettingsPage,galleryAdmin:GalleryAdminPage,gallery:GalleryPage,users:UsersPage,logs:LogsPage,archiveAdmin:ArchiveAdmin,permissions:PermissionsPage,settings:SettingsPage,guide:GuidePage};
 if(ADMIN_ONLY_PAGES.includes(props.page)&&props.role!=='admin'){
   const Fallback=props.role==='parent'?ParentHomeFamily:TeacherWelcome;
   return <Fallback {...props}/>;
 }
 const C=map[props.page]||NotFound; return <C {...props}/>;
}

function AIAppCard({app,onClick,admin=false,onToggle,onUninstall}){const Icon=app.icon;return <div className="app-card"><div className={`app-icon ${app.color}`}><Icon/></div><div className="app-copy"><h3>{app.name}</h3><p>{app.desc}</p>{admin?<small>v{app.version}</small>:null}</div>{admin?<div className="app-admin-actions"><Status value={app.status==='enabled'?'已启用':'已停用'}/><button className="icon-btn" onClick={onToggle} title="启停"><RefreshCw size={16}/></button><button className="icon-btn danger-text" onClick={onUninstall} title="卸载"><Trash2 size={16}/></button></div>:<button className="circle-go" onClick={onClick}><ArrowRight size={17}/></button>}</div>}

function TaskTable({tasks,onView,title='生成任务'}){return <section className="panel table-panel"><div className="panel-head"><h2>{title}</h2><button className="text-link" onClick={onView}>查看全部</button></div><div className="table-scroll"><table><thead><tr><th>任务</th><th>对象</th><th>AI 应用</th><th>实际模型</th><th>状态</th><th>耗时/进度</th><th></th></tr></thead><tbody>{tasks.map(t=><tr key={t.id}><td><b>{t.title}</b><small>{t.id}</small></td><td>{t.student}</td><td>{t.app}</td><td>{t.model}</td><td><Status value={t.status}/></td><td>{t.time}</td><td><button className="icon-btn"><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table></div></section>}

function LessonsPage({navigate,demoState,setDemoState}){const lessons=[['08 月 04 日','梵高的向日葵','周六创意绘画 2 班','18/18','待制作'],['08 月 03 日','色彩的情绪','色彩启蒙班','12/12','已发布'],['08 月 02 日','城市线描','大师创想班','14/15','已发布'],['07 月 27 日','海底世界','周六创意绘画 2 班','18/18','已归档']];return <><PageHeader title="课后反馈" desc="以课次为单位组织素材、AI 生成、审核发布和档案沉淀。" prd={PRD.lessons} actions={<Button icon={Plus} onClick={()=>navigate('create')}>新建课后反馈</Button>}/><DemoStateSwitch value={demoState} setValue={setDemoState}/>{demoState==='empty'?<EmptyState icon={BookOpen} title="还没有课后反馈" desc="创建第一节课次并上传作品后，就能体验完整 AI 工作流。" action="创建课后反馈" onClick={()=>navigate('create')}/>:demoState==='error'?<ErrorState onRetry={()=>setDemoState('normal')}/>:<div className="panel list-panel"><div className="filters"><div className="search-field"><Search size={16}/><input placeholder="搜索课程或班级"/></div><select><option>全部状态</option><option>待制作</option><option>已发布</option></select><select><option>全部班级</option><option>周六创意绘画 2 班</option></select></div>{lessons.map((l,i)=><button className="lesson-row" key={l[0]+l[1]} onClick={()=>i===0?navigate('create'):navigate('archives')}><div className="date-block"><b>{l[0].split(' ')[2]}</b><span>{l[0].slice(0,5)}</span></div><div className="lesson-main"><b>{l[1]}</b><span>{l[2]}</span></div><span>{l[3]} 人已关联</span><Status value={l[4]}/><ArrowRight size={18}/></button>)}</div>}</>}

function DemoStateSwitch({value,setValue}){return <div className="state-switch"><span>状态预览</span>{[['normal','正常'],['empty','空状态'],['error','错误']].map(([k,v])=><button className={value===k?'active':''} key={k} onClick={()=>setValue(k)}>{v}</button>)}</div>}
function EmptyState({icon:Icon,title,desc,action,onClick}){return <div className="empty"><span><Icon size={30}/></span><h2>{title}</h2><p>{desc}</p>{action?<Button onClick={onClick}>{action}</Button>:null}</div>}
function ErrorState({onRetry}){return <div className="empty error-state"><span><CircleAlert size={30}/></span><h2>加载失败</h2><p>网络似乎开了小差，数据没有成功返回。</p><Button icon={RefreshCw} onClick={onRetry}>重新加载</Button></div>}

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
