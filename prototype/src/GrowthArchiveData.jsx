import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Film, Frame, Image, MessageSquareText, Sparkles } from 'lucide-react';

const formats=[['成长集锦',Image,'课程足迹、作品、照片与阶段成长总结'],['作品集',Frame,'像 H5 一样翻阅每一幅作品'],['成长记录（视频）',Film,'课堂影像、作品与老师寄语']];
const dimensions=['美术表达','观察感知','专注坚持','表达叙事','规划执行','互动协作'];

function Radar(){return <div className="report-radar"><svg viewBox="0 0 240 220" role="img" aria-label="阶段成长观察雷达图"><g className="radar-grid"><polygon points="120,16 210,68 210,152 120,204 30,152 30,68"/><polygon points="120,47 183,83 183,137 120,173 57,137 57,83"/><path d="M120 16V204M30 68L210 152M210 68L30 152"/></g><polygon className="radar-fill" points="120,42 183,82 175,142 120,167 64,142 55,85"/></svg>{dimensions.map((item,index)=><span className={`radar-label r${index}`} key={item}><b>{item}</b><em>{[82,78,76,80,70,74][index]}</em></span>)}</div>}

function GentleAbsence({lesson}){return <article className="archive-absence" key={lesson.id}><span>{lesson.date}</span><div><b>这节课，我们先为孩子轻轻留下一页。</b><p>{lesson.reviews?.summary||'老师已经把当天的主题和创作机会好好保留，等孩子回来时，会陪她自然地接上。'}</p></div></article>}

function LessonHistory({lessons}){return <section className="archive-lesson-history"><div className="archive-section-head"><span>过往作品与课堂点评</span><h3>每一次认真，都值得被连续地看见。</h3><p>这里展示的是处理后的线稿作品、修正后的课堂照片和老师点评；缺课也被温柔地留在成长记录里。</p></div><div className="history-list">{lessons.map(lesson=>lesson.status==='缺课'?<GentleAbsence lesson={lesson}/>:<article className="archive-lesson" key={lesson.id}><div className="history-art">{lesson.artworkUrl?<img src={lesson.artworkUrl} alt={`${lesson.title}线稿作品`}/>:<Frame/>}</div><div className="history-copy"><span>{lesson.date} · 《{lesson.title}》</span><p>{lesson.reviews?.美术能力||'老师已记录这节课里值得被看见的创作尝试。'}</p><small>已保存：线稿成品 · 修正照片 · 完整点评</small></div></article>)}</div><StageGrowthReview lessonCount={lessons.filter(lesson=>lesson.status!=='缺课').length}/></section>}

function StageGrowthReview({lessonCount}){
  return <section className="stage-growth-review">
    <section className="report-radar-panel stage-radar-panel"><div><span>阶段能力观察</span><h3>先从整体能力变化，读懂孩子这一学期的学习轨迹。</h3><p>雷达呈现本学期美术表达、观察感知、专注坚持、表达叙事、规划执行与互动协作的课堂发展线索。</p><small>用于课程回顾与后续教学规划。</small></div><Radar/></section>
    <header><span>阶段成长解读</span><h3>从“完成作品”，走向“有意识地表达”。</h3><p>基于本学期 {lessonCount} 节课的作品、课堂过程与老师观察整理，帮助家长看见孩子在美术学习与成长教育中的真实变化。</p></header>
    <div className="stage-position"><b>孩子当前所处阶段</b><div><strong>观察—组织—表达的初步发展期</strong><p>这是 6—8 岁儿童美术学习中常见的成长阶段：手部精细动作和持续专注逐渐更稳定，孩子会从“喜欢画”走向“想把我看到的、想到的安排出来”。此时更需要具体的观察任务、可达成的小目标和被认真倾听的表达机会。</p></div></div>
    <article className="creative-observation"><b>这一阶段的创作发展特点</b><p>孩子会开始留意形状、颜色和画面位置的关系；画到一半愿意回头补充细节，也会尝试说明“我为什么这样画”。这说明她正在把感受、观察和手上的表现连接起来。成人无需急着替她定义画得好不好，而要提供可选择、可尝试、可分享的学习环境。</p></article>
    <section className="art-learning-breakdown"><div className="art-breakdown-head"><span>美术能力收获 · 按本学期学习内容拆解</span><p>围绕色彩启蒙、造型观察、构图组织与主题表达四条学习线，记录孩子已经出现的能力基础。</p></div><div><article><b>色彩启蒙</b><p>能辨认并主动使用主色与辅助色；开始感受冷暖、深浅带来的画面变化。</p></article><article><b>造型观察</b><p>会观察主体的基本形状和局部特征，愿意用线条、重复纹样或色块补充细节。</p></article><article><b>构图组织</b><p>从“把画面画满”走向尝试安排主体位置，初步理解大小、前后和留白能带来重点。</p></article><article><b>主题表达</b><p>能围绕课堂主题加入自己的想象，并逐渐能说出画面想讲的故事和最满意的部分。</p></article></div></section>
    <div className="semester-gains"><article><span>学习行为收获</span><b>专注与调整更稳定</b><p>能在创作中停下来观察；听取提示后愿意继续修改，并能逐步完成一项任务。</p></article><article><span>表达与互动收获</span><b>愿意分享自己的选择</b><p>能用自己的话介绍画面，也开始在同伴分享中听见不同的创作方法。</p></article><article><span>本阶段突破</span><b>更愿意相信自己的表达</b><p>从担心“画得对不对”，慢慢变成愿意说“我想这样画”，自信正在一次次完成中长出来。</p></article></div>
    <section className="next-semester-plan"><div><span>下学期学习计划</span><h4>在这学期的基础上，把“看见”变成更自信的画面语言。</h4></div><div className="plan-list"><article><b>学习内容</b><p>继续练习画面的前后关系、色彩深浅和主题叙事，让孩子能更清楚地安排“画什么、先画什么、哪里最重要”。</p></article><article><b>能力培养目标</b><p>培养观察后再选择的习惯；尝试用大小、深浅、疏密表达重点；把自己的创作意图说出来。</p></article><article><b>家长配合方式</b><p>每次作品完成后，先说出一个您真实看见的细节，再问一个开放问题，例如“你最想让大家先看到哪里？”少替孩子判断好坏，多给她讲述和选择的空间。</p></article></div></section>
  </section>
}

function Flipbook({lessons,targetName}){
  const [page,setPage]=useState(0);
  const works=lessons.filter(item=>item.status!=='缺课');
  const total=works.length+3;
  const move=step=>setPage(currentPage=>Math.max(0,Math.min(total-1,currentPage+step)));
  const current=works[page-2]||{};
  const closingCopy=`在昕乐绘，我们相信每一笔尝试都值得被认真回应。这个阶段，${targetName}已经能主动安排色彩和画面细节，也越来越愿意讲述自己的想法。愿这本作品集记录的不只是完成的作品，更是孩子慢慢长出观察力、自信与表达欲的过程。`;
  const body=page===0
    ?<article className="flipbook-page flipbook-title-page"><span>昕乐绘 · 儿童艺术成长记录</span><div className="flipbook-title-mark">✦</div><h2>{targetName} 的作品集</h2><p>把每一次落笔、每一点好奇，珍藏成孩子自己的小小美术馆。</p><time>2026 · 成长档案</time></article>
    :page===1
      ?<article className="flipbook-page flipbook-preface"><span>序言 · 一起看见成长</span><h2>作品不是答案，<br/>而是孩子正在发生的表达。</h2><p>昕乐绘希望给孩子一段能够安心观察、自由尝试、勇敢表达的创作时光。老师会从作品、课堂瞬间和每一次分享里，认真看见孩子的选择，并把这些细小而真实的进步留给家长。</p><p>从下一页开始，邀请您慢慢翻阅 {targetName} 的作品，也听一听画面背后的成长故事。</p></article>
      :page===total-1
        ?<article className="flipbook-page flipbook-letter"><span>写给 {targetName} 和家长</span><h2>愿每一次创作，<br/>都成为孩子相信自己的证据。</h2><p>{closingCopy}</p><div className="letter-sign"><b>昕乐绘儿童艺术教育</b><small>陪孩子把看见的世界，画成自己的语言。</small></div></article>
        :<article className="flipbook-page"><div className="flipbook-art">{current.artworkUrl?<img src={current.artworkUrl} alt={current.title}/>:<Frame/>}</div><div><span>{targetName}</span><h2>《{current.title||'等待下一幅作品'}》</h2><time>{current.date||'—'}</time><p>{current.reviews?.美术能力||'每一幅作品都会连同老师的温暖点评，留在这里。'}</p></div></article>;
  return <section className="h5-flipbook"><div className="flipbook-cover"><span>{targetName} 的作品集</span><h3>从封面、序言到寄语，完整收藏这一阶段的成长。</h3><small>{page+1} / {total}</small></div>{body}<div className="flipbook-controls"><button disabled={!page} onClick={()=>move(-1)}><ChevronLeft/>上一页</button><button disabled={page>=total-1} onClick={()=>move(1)}>下一页<ChevronRight/></button></div></section>
}

export default function GrowthArchiveData({records,setToast}){
  const [target,setTarget]=useState('个人'); const [period,setPeriod]=useState('一学期'); const [format,setFormat]=useState('成长集锦'); const [generated,setGenerated]=useState(false);
  const lessons=useMemo(()=>records.filter(record=>target==='班级'||record.student==='陈一诺').sort((a,b)=>a.date.localeCompare(b.date)),[records,target]);
  const targetName=target==='班级'?'周六创意绘画 2 班':'陈一诺';
  const downloadAssets=()=>{
    const assets=lessons.flatMap((item,index)=>[
      item.artworkUrl&&{url:item.artworkUrl,name:`${item.date}-${item.title}-线稿作品-${index+1}.png`},
      item.photoUrl&&{url:item.photoUrl,name:`${item.date}-${item.title}-课堂照片-${index+1}.jpg`}
    ].filter(Boolean));
    assets.forEach(({url,name})=>{const link=document.createElement('a');link.href=url;link.download=name;link.click()});
    setToast(assets.length?`已开始下载 ${assets.length} 份处理后的成品素材。`:'当前档案里暂没有可下载的成品素材。');
  };
  return <><div className="page-head"><div><div className="title-line"><h1>成长档案</h1><span className="prd-tag">PRD-12 / F-ARCHIVE-01</span></div><p>把处理后的作品、照片和点评，连成孩子自己的成长轨迹。</p></div></div><section className="growth-builder archive-data-report"><div className="growth-builder-top"><div><h2>让每一次认真，都有可以回看的位置。</h2><p>成长档案只归档线稿成品、修正照片与老师确认后的点评；原始拍摄图不作为家长版素材展示。</p></div><span className="report-panda"><Sparkles/></span></div><div className="growth-controls archive-target-controls"><label>生成对象<div className="mode-switch"><button className={target==='个人'?'active':''} onClick={()=>{setTarget('个人');setGenerated(false)}}>个人成长档案</button><button className={target==='班级'?'active':''} onClick={()=>{setTarget('班级');setGenerated(false)}}>班级成长档案</button></div></label><label>生成周期<select value={period} onChange={event=>setPeriod(event.target.value)}><option>半学期</option><option>一学期</option><option>一年度</option></select></label></div><div className="archive-format-picker"><b>选择生成内容</b><div>{formats.map(([name,Icon,desc])=><button key={name} className={format===name?'active':''} onClick={()=>{setFormat(name);setGenerated(false)}}><Icon/><span><strong>{name}</strong><small>{desc}</small></span></button>)}</div></div><button className="primary" onClick={()=>{setGenerated(true);setToast(`${targetName}的${period}${format}已生成`)}}><FileText size={17}/>生成{period}{format}</button>{generated?<section className="growth-report-preview"><div className="report-title"><span>{targetName} · {period}{format}</span><h2>{format==='作品集'?'这一次的作品，正在自己的美术馆里发光。':'这一次的成长，已经被完整看见。'}</h2><p>已关联 {lessons.length} 节课程 · 成品素材与点评均来自归档后的处理结果。</p></div>{format==='作品集'?<Flipbook lessons={lessons} targetName={targetName}/>:format==='成长记录（视频）'?<div className="growth-video-hero"><Film/><b>{targetName} · {period}成长记录</b><small>将串联处理后的作品、修正照片、课堂片段和老师寄语。</small></div>:<><LessonHistory lessons={lessons}/><section className="report-radar-panel"><div><span>阶段能力观察</span><h3>把课堂中的变化，变成家长一眼看得懂的多维成长线索。</h3><p>雷达呈现美术表达、观察、专注、表达、规划与互动等课堂观察维度。</p><small>仅作教育性观察与课程规划参考，不作医学、心理或智力诊断。</small></div><Radar/></section><section className="growth-summary-plus"><div className="summary-head"><span>孩子的阶段成长总结</span><h3>成长不只在作品里，也在每一次观察、选择和表达的过程里。</h3></div><div><article><b>本阶段突破</b><p>从完成一幅作品，慢慢走向愿意讲述自己的画面选择。</p></article><article><b>下一阶段规划</b><p>继续围绕色彩层次、构图观察和主题表达安排可达成的小目标。</p></article></div></section></>}<div className="report-footer"><span>老师确认内容后，家长会收到一份只含成品素材的温暖回顾。</span><div><button onClick={downloadAssets}><Download size={17}/>下载成品</button><button className="primary" onClick={()=>setToast('家长版链接已生成，可一键转发作品、照片与点评。')}><MessageSquareText size={17}/>一键转发家长</button></div></div></section>:null}</section></>;
}
