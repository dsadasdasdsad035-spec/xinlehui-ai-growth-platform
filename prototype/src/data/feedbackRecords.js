import { stripSessionMediaUrls } from './mediaValidation';

const STORAGE_KEY = 'xinlehui-feedback-records-v1';
const seedRecords = [
  {id:'seed-20260804',student:'陈一诺',className:'周六创意绘画 2 班',date:'2026-08-04',title:'向着光的花',status:'已归档',artworkName:'向着光的花.jpg',photoName:'课堂合影.jpg',videoName:'',reviews:{美术能力:'大胆运用冷暖对比，画面中的花朵有清晰的主次。',上课状态:'能持续投入创作，在提示后愿意继续补充细节。',行为能力:'愿意分享自己的想法，也能安静等待同伴完成。',内在状态:'本次创作呈现出积极、开放的表达愿望；这只是课堂观察，不作心理诊断。',家长建议:'今晚先请孩子讲讲画里的光，再问一个具体问题，让她把故事继续说出来。'}},
  {id:'seed-20260721',student:'陈一诺',className:'周六创意绘画 2 班',date:'2026-07-21',title:'彩色的家',status:'已归档',artworkName:'彩色的家.jpg',photoName:'课堂照片.jpg',videoName:'',reviews:{美术能力:'开始主动安排房子与天空的色彩关系。',上课状态:'进入状态比之前更快，能专注完成主要画面。',行为能力:'遇到不确定时会尝试先问老师，再继续完成。',内在状态:'画面中有清晰的个人选择，表达越来越主动。',家长建议:'可以邀请孩子说说“家里最想留住的颜色”。'}},
  {id:'seed-absence-20260714',student:'陈一诺',className:'周六创意绘画 2 班',date:'2026-07-14',title:'本次课程请假',status:'缺课',reviews:{summary:'这节课我们先为一诺轻轻留下一格空白，期待下次把创作继续完成。'}}
];

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

export function loadFeedbackRecords(){
  if(typeof window==='undefined') return seedRecords;
  return safeParse(window.localStorage.getItem(STORAGE_KEY), seedRecords);
}

export function persistFeedbackRecords(records){
  if(typeof window==='undefined') return;
  // 档案以处理后的作品和照片为准：线稿 / 修正图是唯一对外展示与下载素材。
  // 但**会话内 object URL（blob:）必须先清掉**：它刷新即失效，落进 localStorage 只是
  // 一条指向不存在素材的垃圾地址（US-408 的素材隐私口径）；data: URL 是归档成品，保留。
  const safe=stripSessionMediaUrls(records);
  try { window.localStorage.setItem(STORAGE_KEY,JSON.stringify(safe)); }
  catch {
    // 配额不够时的第二档降级：连成品图（US-008b 写回的档案副本，几百 KB）一起瘦身。
    // 不瘦它的话这一句会再抛一次，异常会从 effect 里冒出去 —— 宁可少一张图也要留住记录本身。
    window.localStorage.setItem(STORAGE_KEY,JSON.stringify(
      safe.map(record=>({...record,artworkUrl:'',photoUrl:'',videoUrl:'',framedArtwork:record.framedArtwork?{...record.framedArtwork,imageUrl:''}:record.framedArtwork}))
    ));
  }
}

/**
 * 记录里的「成品图写回」（US-008b）。
 *
 * 记录本身存的是**处理后的作品**（`artworkUrl` = 画心），画展挂上墙时再按画展的装裱方案现画 ——
 * 这是画展一贯的口径（见 gallery/exhibitionArtworks.js 的文件头）。老师保存过的成品图另存一份：
 * 画展遇到它就**直接挂这一张**（不再套一层框，也不会出现"框里再套一个框"），
 * 五维点评页与成长档案也读它。没写过回的记录照旧走原路，行为一字不变。
 */
function framedArtworkOf(media, framedArtwork){
  if(framedArtwork) return framedArtwork;
  const artwork=media&&typeof media==='object'?media.artwork:null;
  return artwork&&typeof artwork==='object'?artwork.writeBack||null:null;
}

export function createFeedbackRecord({media,subject,reviews,mode,student='未选择学员',className='未选择班级',framedArtwork=null,lessonId='',lessonDate=''}){
  const now=new Date();
  const date=now.toISOString().slice(0,10);
  return {
    id:`feedback-${now.getTime()}`,
    student,
    className,
    date,
    title:'未命名作品',
    status:'已归档',
    mode,
    subject,
    artworkName:media.artwork?.name||'作品已上传',
    photoName:media.photo?.name||'',
    // 课后反馈已去掉视频上传，这里保留空字段只为兼容云端 payload 的既有结构。
    videoName:'',
    artworkUrl:media.artwork?.cleanUrl||media.artwork?.framedUrl||'',
    photoUrl:media.photo?.url||'',
    videoUrl:'',
    artworkSource:'processed-linework',
    photoSource:'processed-photo',
    // 课次上下文与成品图写回：归档时的溯源（US-008b 点名的四项就落在 framedArtwork 里）。
    lessonId,
    lessonDate,
    framedArtwork:framedArtworkOf(media,framedArtwork),
    reviews,
  };
}
