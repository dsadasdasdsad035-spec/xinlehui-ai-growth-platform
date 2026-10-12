// 课后反馈（成长档案）归档记录 —— 本地兜底数据 + 记录模型的领域规则。
//
// 一条记录 = 「某位学员的某一次课」（[第四步 US-201] / FR-201）。业务唯一键 `recordKey` 与由它
// 派生的 `id` 都是**确定性**的：同一次课重复归档得到同一条记录、同一个 id、同一个云端
// `record_key` —— 这是「重复归档 = 更新那一条」（US-202 / FR-202）能实现的前提。
//
// 四条纪律（改这个文件前先读这一节）：
//  ① `id` 不再用时间戳：`deriveRecordId(recordKey)` 由业务键派生（FNV-1a 32 位，与
//     `data/artworkLayers.js` 的地址指纹同一套算法）。**老记录保留原 id** —— 云端 `record_key`
//     就是它，换掉会凭空多出孤儿行（兼容映射只补新字段，不动老字段）。
//  ② `date` 只来自**课次日期**（`lesson.lessonDate`），不再取归档当天；`lessonDate` 字段仍保持
//     展签口径（`2026.08.04`）。两条口径的字段并存，谁也别覆盖谁。`lessonNo`（[第四步到第一步联通]
//     US-087）与课次自然键里的序号同源：视频时间线按「课次日期 + 课时序号」排序，归档时间不参与。
//  ③ `title` 只能来自真实数据（老师填的作品名 → 展签上的作品名 → 本次课题），**禁止**写死
//     「未命名作品」这类占位名（FR-205）：宁可为空，也不要一个假的作品名。
//  ④ 渲染归档列表前按 `recordKey` 去重兜底（FR-207）：`loadFeedbackRecords` 与新记录入列都过
//     `dedupeFeedbackRecords`，任何路径都不会让同一个键出现两条。
//  ⑤ 再次归档**不是**「删旧的插新的」：`applyFeedbackRecordArchive` 判同键后走
//     `updateFeedbackRecord`（id / recordKey / archivedAt 不变，version 自增、updatedAt 刷新）。
//  ⑥ 记录上的 `media`（[第四步 US-203]）是**归档素材的持久化记录**（成品图 + 修正后的照片，
//     未同步时为空数组）：类别 / 同步状态 / 持久地址 / storageKey 由 `data/archiveMedia.js` 管，
//     原图字段（`...originalUrl`）在 `createFeedbackRecord` 里被**结构守卫摘掉**（原图永不上传）。
//     素材同步成功时**不动 version / updatedAt** —— 它们记的是老师的正文改到第几版。
//
// 与 `data/lessons.js` 同一套模型：本地只是「断网 / 未开通云服务时的兜底」，云端表才是真源。
import { makeStudentId, normalizeLessonDate, normalizeLessonNo } from './lessons';
import { stripSessionMediaUrls } from './mediaValidation';
// 归档素材的持久化记录（[第四步 US-203]）：类别 / 同步状态 / 持久地址 / storageKey 的规则与
// 「原图字段不许进 payload」的结构守卫都在 data 层，这里只负责把素材清单挂到记录上。
import { normalizeArchiveMediaList, stripArchiveMediaUrls, stripOriginalMediaFields } from './archiveMedia';

const STORAGE_KEY = 'xinlehui-feedback-records-v1';

/** 记录模型版本：新记录从 1 起；同键再归档时由 `updateFeedbackRecord` 自增（US-202）。 */
export const FEEDBACK_RECORD_VERSION = 1;

/** 业务唯一键的分隔符：`lessonId::studentId` 是两段，退化键是四段，两者不会互相撞上。 */
export const FEEDBACK_RECORD_KEY_SEPARATOR = '::';

const str = value => String(value ?? '').trim();

/** FNV-1a 32 位（与 `data/artworkLayers.js` 的地址指纹同一套算法）：稳定、零依赖、够短。 */
function feedbackRecordHash(text) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * 业务唯一键（FR-201）：优先 `lessonId + studentId`（有课次实体的新记录）；
 * 没有课次时退化为 `className + date + studentId + title` 四段。
 *
 * `studentId` 缺失时由学员姓名确定性派生（与 `data/lessons.js` 的 `makeStudentId` 同一口径），
 * 所以历史记录也能算出一个**稳定**的键；`date` 一律先过 `normalizeLessonDate` ——
 * `2026.08.04` 与 `2026-08-04` 是同一天，必须得到同一个键。
 */
export function resolveRecordKey({ lessonId = '', studentId = '', student = '', className = '', date = '', title = '' } = {}) {
  const lesson = str(lessonId);
  const sid = str(studentId) || makeStudentId(student);
  if (lesson && sid) return [lesson, sid].join(FEEDBACK_RECORD_KEY_SEPARATOR);
  return [className, normalizeLessonDate(date) || str(date), sid, title]
    .map(str)
    .join(FEEDBACK_RECORD_KEY_SEPARATOR);
}

/** 由业务键派生 id（FR-203）：同一次课重复归档得到同一个 id，不再用 `feedback-${Date.now()}`。 */
export function deriveRecordId(recordKey) {
  return `feedback-${feedbackRecordHash(str(recordKey))}`;
}

/**
 * 归档记录的 title（FR-205）：**装裱展签上的作品名**优先。
 * 取值顺序：老师逐幅填写的作品名 → 模板里的展签作品名（`activeFrame.plaqueTitle`）→ 本次课题。
 * 三处都没有 → 空串：宁可为空，也不要「未命名作品」这类假的作品名。
 */
export function resolveRecordTitle({ artworkTitle = '', plaqueTitle = '', topic = '' } = {}) {
  return str(artworkTitle) || str(plaqueTitle) || str(topic);
}

/**
 * 「这一次归档会落到哪一条记录」的身份推导（[第四步 US-202] 的唯一真源）。
 *
 * `createFeedbackRecord`（写入侧）与界面（按钮文案「归档并生成分享 / 保存修改并更新档案」、
 * 「这次是同键再归档吗」的判断）都读这一份 —— 谁都不许自己再拼一次 recordKey：
 * 两处各算一遍，一边算出 `lessonId::studentId`、另一边算出退化键，就会「界面上说要更新、
 * 实际却新建了一条」。返回值里的 `id` 也一并给出（幂等更新的命中判据就是它派生自同一个键）。
 */
export function feedbackRecordIdentity({
  lessonId = '',
  studentId = '',
  student = '',
  className = '',
  lessonDate = '',
  artworkTitle = '',
  plaqueTitle = '',
  topic = ''
} = {}) {
  const lessonDateText = str(lessonDate);
  const date = normalizeLessonDate(lessonDateText) || lessonDateText;
  const title = resolveRecordTitle({ artworkTitle, plaqueTitle, topic });
  const studentKey = str(studentId) || makeStudentId(student);
  const recordKey = resolveRecordKey({ lessonId, studentId: studentKey, student, className, date, title });
  return { recordKey, id: deriveRecordId(recordKey), date, title, studentId: studentKey };
}

/**
 * 老记录的归档时间：`feedback-<毫秒>` 这类 id 里带着它，能推回来就推回来（推不出留空）。
 * 推不出来的（`seed-*` 这种演示 id）保持为空，而不是编一个时间。
 */
export function archivedAtFromId(id) {
  const matched = str(id).match(/^feedback-(\d{10,})$/);
  if (!matched) return '';
  const at = new Date(Number(matched[1]));
  return Number.isNaN(at.getTime()) ? '' : at.toISOString();
}

function normalizeRecordVersion(value) {
  const version = Math.trunc(Number(value));
  return Number.isFinite(version) && version >= 1 ? version : FEEDBACK_RECORD_VERSION;
}

/**
 * `reviews` 保留五维结构：缺课记录只有 `summary` 一条也照样保留，脏值收敛成空对象而不抛错。
 * **不动正文** —— 不裁剪、不补空维度、不排序，老师写什么就是什么。
 */
function normalizeRecordReviews(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

/**
 * 把任意来源的记录收敛成规范形状（旧记录读取的兼容映射，FR-201）：
 * 原字段一个都不丢（`...source`），只把新字段补齐 —— 缺什么补什么，读多少次结果都一样。
 */
export function normalizeFeedbackRecord(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const student = str(source.student);
  const studentId = str(source.studentId) || makeStudentId(student);
  const date = normalizeLessonDate(source.date || source.lessonDate) || str(source.date);
  const lessonId = str(source.lessonId);
  const title = str(source.title);
  const className = str(source.className);
  const recordKey = str(source.recordKey)
    || resolveRecordKey({ lessonId, studentId, student, className, date, title });
  const archivedAt = str(source.archivedAt) || archivedAtFromId(source.id);
  return {
    ...source,
    id: str(source.id) || deriveRecordId(recordKey),
    recordKey,
    lessonId,
    courseId: str(source.courseId),
    classId: str(source.classId),
    studentId,
    student,
    className,
    date,
    // 这一次课的课时序号（[第四步到第一步联通] US-087）：视频时间线按「课次日期 + 课时序号」排序读它。
    // 0 = 未知（历史记录本来就没有序号，不猜）；老记录只有 lessonId 时由课次列表补齐（`archiveResident.js`）。
    lessonNo: normalizeLessonNo(source.lessonNo),
    title,
    archivedAt,
    updatedAt: str(source.updatedAt) || archivedAt,
    version: normalizeRecordVersion(source.version),
    // 第三步推理轨迹的关联（[US-201]）：没有轨迹（缺课记录 / 老记录）时是空串。
    reviewTraceId: str(source.reviewTraceId),
    // 归档素材的持久化记录（[第四步 US-203]）：每条含类别 / 同步状态 / 持久地址 / storageKey。
    // 读盘与云端 payload 都过这一道，旧记录（没有 media）自然是空数组。
    media: normalizeArchiveMediaList(source.media),
    reviews: normalizeRecordReviews(source.reviews)
  };
}

/**
 * 按 `recordKey` 去重（FR-207 的兜底）：同一个键只留**靠前**的那一条 —— 记录列表是新在前，
 * 所以留下的是较新的那条。键为空的记录去不了重，原样保留。
 * 读盘（`loadFeedbackRecords`）与新记录入列（`archiveRecord`）都过这一道。
 */
export function dedupeFeedbackRecords(records) {
  const list = Array.isArray(records) ? records : [];
  const seen = new Set();
  const result = [];
  list.forEach(item => {
    const record = normalizeFeedbackRecord(item);
    if (record.recordKey && seen.has(record.recordKey)) return;
    if (record.recordKey) seen.add(record.recordKey);
    result.push(record);
  });
  return result;
}

/**
 * 就地更新一条记录（成品图写回 [US-008b] 走它；同键再归档 [US-202] 也走它）：
 * 刷新 `updatedAt`、`version` 自增，返回**新对象**（不改入参）。
 * `recordKey` 与 `id` 强制不变 —— 变了就不是「更新同一条」了。
 */
export function updateFeedbackRecord(record, patch = {}, { now = '' } = {}) {
  const base = normalizeFeedbackRecord(record);
  return normalizeFeedbackRecord({
    ...base,
    ...(patch && typeof patch === 'object' ? patch : {}),
    recordKey: base.recordKey,
    id: base.id,
    updatedAt: str(now) || new Date().toISOString(),
    version: base.version + 1
  });
}

const seedRecords = [
  {id:'seed-20260804',student:'陈一诺',className:'周六创意绘画 2 班',date:'2026-08-04',title:'向着光的花',status:'已归档',artworkName:'向着光的花.jpg',photoName:'课堂合影.jpg',videoName:'',reviews:{美术能力:'大胆运用冷暖对比，画面中的花朵有清晰的主次。',上课状态:'能持续投入创作，在提示后愿意继续补充细节。',行为能力:'愿意分享自己的想法，也能安静等待同伴完成。',内在状态:'本次创作呈现出积极、开放的表达愿望；这只是课堂观察，不作心理诊断。',家长建议:'今晚先请孩子讲讲画里的光，再问一个具体问题，让她把故事继续说出来。'}},
  {id:'seed-20260721',student:'陈一诺',className:'周六创意绘画 2 班',date:'2026-07-21',title:'彩色的家',status:'已归档',artworkName:'彩色的家.jpg',photoName:'课堂照片.jpg',videoName:'',reviews:{美术能力:'开始主动安排房子与天空的色彩关系。',上课状态:'进入状态比之前更快，能专注完成主要画面。',行为能力:'遇到不确定时会尝试先问老师，再继续完成。',内在状态:'画面中有清晰的个人选择，表达越来越主动。',家长建议:'可以邀请孩子说说“家里最想留住的颜色”。'}},
  {id:'seed-absence-20260714',student:'陈一诺',className:'周六创意绘画 2 班',date:'2026-07-14',title:'本次课程请假',status:'缺课',reviews:{summary:'这节课我们先为一诺轻轻留下一格空白，期待下次把创作继续完成。'}}
];
// 上面三条种子**刻意保持旧口径**（没有 lessonId / studentId / recordKey / version）：
// 它们就是「旧记录兼容映射」的活样例 —— 读进来时按 `normalizeFeedbackRecord` 补出新字段、
// 按 `className + date + studentId + title` 退化键算出稳定的 recordKey，原始字段一个都不丢。

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

export function loadFeedbackRecords(){
  const raw = typeof window === 'undefined' ? seedRecords : safeParse(window.localStorage.getItem(STORAGE_KEY), seedRecords);
  return dedupeFeedbackRecords(raw);
}

/**
 * 合并两份记录（本地镜像 + 云端，与 `mergeLessons` 同一套写法）：
 *  ① 两边先各过 `normalizeFeedbackRecord` —— 云端回来的 payload 也可能是旧口径，
 *     不归一化的话新字段在界面上就是 undefined；
 *  ② 同 id 的**本地优先**（本机刚归档、还没推上云的那条不能被云端旧记录顶掉），`reviews` 逐维合并；
 *  ③ 最后按 `date` 倒序、按 `recordKey` 去重兜底（FR-207）。
 */
export function mergeFeedbackRecords(localRecords, remoteRecords){
  const byId = new Map();
  (Array.isArray(remoteRecords) ? remoteRecords : []).forEach(item => {
    const record = normalizeFeedbackRecord(item);
    byId.set(record.id, record);
  });
  (Array.isArray(localRecords) ? localRecords : []).forEach(item => {
    const record = normalizeFeedbackRecord(item);
    const remote = byId.get(record.id);
    byId.set(record.id, remote ? { ...remote, ...record, reviews: { ...remote.reviews, ...record.reviews } } : record);
  });
  return dedupeFeedbackRecords([...byId.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))));
}

export function persistFeedbackRecords(records){
  if(typeof window === 'undefined') return;
  // 档案以处理后的作品和照片为准：线稿 / 修正图是唯一对外展示与下载素材。
  // 但**会话内 object URL（blob:）必须先清掉**：它刷新即失效，落进 localStorage 只是
  // 一条指向不存在素材的垃圾地址（US-408 的素材隐私口径）；data: URL 是归档成品，保留。
  const safe=stripSessionMediaUrls(dedupeFeedbackRecords(records));
  try { window.localStorage.setItem(STORAGE_KEY,JSON.stringify(safe)); }
  catch {
    // 配额不够时的第二档降级：连成品图（US-008b 写回的档案副本，几百 KB）一起瘦身。
    // 不瘦它的话这一句会再抛一次，异常会从 effect 里冒出去 —— 宁可少一张图也要留住记录本身。
    // [第四步 US-203] 起素材记录里的**本地持久副本**（data URL）走同一档：地址摘掉、状态降级为
    // 「图片同步中」（`stripArchiveMediaUrls`），于是家长端显示占位而不是一张不存在的图；
    // https 持久地址几乎不占空间，原样保留。
    window.localStorage.setItem(STORAGE_KEY,JSON.stringify(
      safe.map(record=>({
        ...stripArchiveMediaUrls(record),
        artworkUrl:'',
        photoUrl:'',
        videoUrl:'',
        framedArtwork:record.framedArtwork?{...record.framedArtwork,imageUrl:''}:record.framedArtwork
      }))
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

/**
 * 新建一条归档记录（[第四步 US-201]）。
 *
 * 入参里的业务上下文（lessonId / studentId / classId / courseId）与课次实体一一对应；
 * `lessonDate` 传展签口径（`2026.08.04`）或 ISO 都收 —— `date` 字段一律写成 ISO 的课次日期，
 * `lessonDate` 字段保持原样。`title` 由 `resolveRecordTitle` 从真实数据里取（见那里的说明）。
 */
export function createFeedbackRecord({
  media,
  subject,
  reviews,
  mode,
  student = '未选择学员',
  className = '未选择班级',
  studentId = '',
  classId = '',
  courseId = '',
  artworkTitle = '',
  plaqueTitle = '',
  topic = '',
  framedArtwork = null,
  archiveMedia = [],
  lessonId = '',
  lessonDate = '',
  // 课时序号（[第四步到第一步联通] US-087）：视频时间线按「课次日期 + 课时序号」排序，
  // 记录自己带着它就不必再去课次表里查一遍。缺省 0 = 未知（不猜一个序号）。
  lessonNo = 0,
  reviewTraceId = '',
  now = ''
} = {}){
  const archivedAt = str(now) || new Date().toISOString();
  const lessonDateText = str(lessonDate);
  // 业务键 / id / date / title 全部来自 `feedbackRecordIdentity`（界面的按钮文案与更新判断读同一份）。
  const identity = feedbackRecordIdentity({
    lessonId,
    studentId,
    student,
    className,
    lessonDate: lessonDateText,
    artworkTitle,
    plaqueTitle,
    topic
  });
  // 归档 payload 的结构守卫（[第四步 US-203] 第 3 条）：原图字段（`...originalUrl`）在这里被
  // **摘掉**而不是「判断一下放不放行」—— 上传通道拿到的素材只有成品图与修正后的照片副本，
  // 原图连 payload 都进不来。`archivePayloadOriginalIssue` 是断言用的复核口径（见 data/archiveMedia.js）。
  return normalizeFeedbackRecord(stripOriginalMediaFields({
    id: identity.id,
    recordKey: identity.recordKey,
    lessonId: str(lessonId),
    courseId: str(courseId),
    classId: str(classId),
    studentId: identity.studentId,
    student,
    className,
    date: identity.date,
    // 展签口径的课次日期（`2026.08.04`）：展签、文件名与成长档案的口径都读它，保持老字段含义不变。
    lessonDate: lessonDateText,
    // 课时序号（US-087）：与课次自然键（班级 + 日期 + 序号）里的那一个数字同源。
    lessonNo: normalizeLessonNo(lessonNo),
    title: identity.title,
    status: '已归档',
    mode,
    subject,
    artworkName: media.artwork?.name || '作品已上传',
    photoName: media.photo?.name || '',
    // 课后反馈已去掉视频上传，这里保留空字段只为兼容云端 payload 的既有结构。
    videoName: '',
    artworkUrl: media.artwork?.cleanUrl || media.artwork?.framedUrl || '',
    photoUrl: media.photo?.url || '',
    videoUrl: '',
    artworkSource: 'processed-linework',
    photoSource: 'processed-photo',
    // 归档素材的持久化记录（[第四步 US-203]）：成品图与修正后的照片各一条，
    // 带同步状态 / 持久地址 / storageKey —— 家长端能不能看到图取决于这里。
    media: normalizeArchiveMediaList(archiveMedia),
    archivedAt,
    updatedAt: archivedAt,
    version: FEEDBACK_RECORD_VERSION,
    reviewTraceId: str(reviewTraceId),
    // 课次上下文与成品图写回：归档时的溯源（US-008b 点名的四项就落在 framedArtwork 里）。
    framedArtwork: framedArtworkOf(media, framedArtwork),
    reviews
  }));
}

/**
 * 归档的落库动作（[第四步 US-202] / FR-202）：**同一个 `recordKey` 再次归档 = 更新那一条**。
 *
 * 入参 `incoming` 是本次归档现算出来的那条记录（`createFeedbackRecord` 的产物），
 * `records` 是当前列表：
 *  ① 列表里没有同键 → `mode: 'created'`，新记录入列（先过 `dedupeFeedbackRecords`，FR-207 的兜底）；
 *  ② 列表里有同键 → `mode: 'updated'`，走 `updateFeedbackRecord` 就地更新 ——
 *     **id / recordKey 不变**（云端 upsert 的 `record_key` 冲突键才对得上），`version` 自增、
 *     `updatedAt` 刷新，正文 / 素材 / 成品图按这一次编辑后的内容覆盖；`archivedAt` 保留第一次归档的时间。
 *
 * 界面（按钮文案、toast 里的「第 N 版」）只读返回的 `mode` / `record.version`，不自己找同键记录 ——
 * 「判定」与「写入」必须是同一次计算，否则会出现「提示说更新了、实际新建了一条」。
 */
export function applyFeedbackRecordArchive(records, incoming, { now = '' } = {}) {
  const list = Array.isArray(records) ? records : [];
  const fresh = normalizeFeedbackRecord(incoming);
  const existing = list.find(item => str(item.recordKey) === fresh.recordKey) || null;
  if (!existing) {
    return { mode: 'created', record: fresh, list: dedupeFeedbackRecords([fresh, ...list]) };
  }
  const updated = updateFeedbackRecord(existing, {
    ...fresh,
    // 第一次归档的时间不动：它是「这条记录什么时候建档」，不是「最后一次改到什么时候」。
    archivedAt: str(existing.archivedAt) || fresh.archivedAt
  }, { now });
  return {
    mode: 'updated',
    record: updated,
    // 就地替换：位置、顺序都不动（同键只可能命中一条 —— 确定性 id 与去重兜底保证的）。
    list: list.map(item => (str(item.recordKey) === updated.recordKey ? updated : normalizeFeedbackRecord(item)))
  };
}
