import { containsMediaPayload } from './mediaValidation.js';

/**
 * 课后反馈草稿（US-409）：**只存元数据**，不存任何孩子的素材。
 *
 * 老师的诉求是「写到一半被打断，回来不用重新选班级和学员」；而孩子的作品与课堂照片
 * 只活在当次会话里（object URL，US-408）。两件事拆开之后，草稿里能出现的字段就是固定的
 * 这几个：课次信息（班级 / 课程 / 日期 / 序号 / 课题）+ 学员选择 + 学员作品名 + 步骤。
 *
 * 三条纪律：
 * 1. 草稿的**结构**保证不含素材：`buildFeedbackDraft()` 只复制已知的标量字段，
 *    图片本体 / object URL / base64 没有任何入口进来；`persistFeedbackDraft()` 再做一次
 *    `containsMediaPayload` 兜底（防止调用方塞了别的东西）。
 * 2. 版本号对不上就**忽略**草稿（安全降级为「没有草稿」），不做半成品迁移。
 * 3. 读写**永不抛错**：localStorage 被禁用 / JSON 被写坏 / 结构不是对象，一律返回 null。
 *
 * 本模块只用显式 `.js` 扩展名 import 一个纯规则模块（mediaValidation），所以在 Node 里也能直接跑
 * （`node --input-type=module -e "import('./src/data/feedbackDraft.js')"`），不需要扩展名补全 loader。
 */

/** 草稿的存储键。v2 起草稿结构与 US-408 时期的 `{step,media}` 完全不同，所以换了键。 */
export const FEEDBACK_DRAFT_KEY = 'xinlehui-feedback-draft-v2';
/** 会话素材痕迹（只留文件名 / 类型 / 体积）：用来判断「上次选过素材、这次刷新后失效了」。 */
export const FEEDBACK_SESSION_MEDIA_KEY = 'xinlehui-feedback-session-media-v2';
/** 草稿结构版本。变更即意味着旧草稿被忽略（US-409 的「安全降级」）。 */
export const FEEDBACK_DRAFT_VERSION = 2;

/** 草稿里允许出现的字段（唯一真源）：断言时直接拿它比对，别在别处再列一份。 */
export const FEEDBACK_DRAFT_FIELDS = [
  'version', 'savedAt', 'step', 'classId', 'courseId', 'lessonDate', 'lessonNo',
  'topic', 'participants', 'artworkTitles'
];

const DRAFT_STEPS = [1, 2, 3, 4];
const ATTENDANCE_STATES = ['present', 'absent', 'makeup'];

const text = value => String(value ?? '').trim();

function positiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

/** 存储后端：允许注入（Node 断言用假 storage），默认取浏览器的 localStorage。 */
function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return typeof globalThis !== 'undefined' && globalThis.localStorage ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

function safeGet(store, key) {
  try { return store.getItem(key); } catch { return null; }
}

function safeSet(store, key, value) {
  try { store.setItem(key, value); return true; } catch { return false; }
}

function safeRemove(store, key) {
  try { store.removeItem(key); return true; } catch { return false; }
}

/** 一条参与学员：只留「谁、出席状态、是否临时学员」，不留下指向素材的 id（那些素材已经不在会话里了）。 */
export function buildDraftParticipant(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const name = text(source.name);
  if (!name) return null;
  return {
    studentId: text(source.studentId),
    name,
    attendance: ATTENDANCE_STATES.includes(source.attendance) ? source.attendance : 'present',
    temporary: source.temporary === true,
    // 素材 id 明确留空：刷新后条目已经不存在了，留着只会变成悬空引用。
    artworkIds: [],
    photoIds: []
  };
}

/** 一条学员作品名（不含素材地址）。空标题也保留：它是「这位学员交了几幅」的记录。 */
export function buildDraftTitle(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const studentName = text(source.studentName);
  const title = text(source.title);
  if (!studentName && !title) return null;
  return { studentId: text(source.studentId), studentName, title };
}

/**
 * 构造规范草稿。**纯函数、确定性输出**（不填 `savedAt` 时为空串），所以可以直接
 * `JSON.stringify` 当 effect 的依赖键用；时间戳只在真正落盘时由 `persistFeedbackDraft` 打。
 */
export function buildFeedbackDraft(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const participants = (Array.isArray(source.participants) ? source.participants : [])
    .map(buildDraftParticipant)
    .filter(Boolean);
  const artworkTitles = (Array.isArray(source.artworkTitles) ? source.artworkTitles : [])
    .map(buildDraftTitle)
    .filter(Boolean);
  const step = Number(source.step);
  return {
    version: FEEDBACK_DRAFT_VERSION,
    savedAt: text(source.savedAt),
    step: DRAFT_STEPS.includes(step) ? step : 1,
    classId: text(source.classId),
    courseId: text(source.courseId),
    lessonDate: text(source.lessonDate),
    lessonNo: positiveInt(source.lessonNo),
    topic: text(source.topic),
    participants,
    artworkTitles
  };
}

/** 没有任何值得恢复的内容（等同于「没有草稿」）。 */
export function isBlankFeedbackDraft(draft) {
  if (!draft) return true;
  return draft.step <= 1
    && !draft.classId
    && !draft.courseId
    && !draft.lessonDate
    && !draft.lessonNo
    && !draft.participants.length
    && !draft.artworkTitles.length;
}

/** 读草稿：读坏 / 版本不符 / 结构不对 / 内容为空，一律返回 null（调用方按初始态继续）。 */
export function readFeedbackDraft(storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  const rawText = safeGet(store, FEEDBACK_DRAFT_KEY);
  if (!rawText) return null;
  let raw = null;
  try { raw = JSON.parse(rawText); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  // 版本号对不上：直接忽略，不试图迁移（US-409 的「安全降级」）。
  if (Number(raw.version) !== FEEDBACK_DRAFT_VERSION) return null;
  const draft = buildFeedbackDraft(raw);
  return isBlankFeedbackDraft(draft) ? null : draft;
}

/** 写草稿：只写元数据；发现任何素材地址（兜底）就不写。返回落盘的规范对象或 null。 */
export function persistFeedbackDraft(draft, storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  const clean = buildFeedbackDraft({ ...(draft || {}), savedAt: new Date().toISOString() });
  if (containsMediaPayload(clean)) return null;
  return safeSet(store, FEEDBACK_DRAFT_KEY, JSON.stringify(clean)) ? clean : null;
}

export function clearFeedbackDraft(storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  return safeRemove(store, FEEDBACK_DRAFT_KEY);
}

/**
 * 会话素材痕迹：写入的必须是 `buildSessionMediaDraft(media)` 的产物（瘦身只在那一个收敛点做），
 * 这里只负责落盘 / 读回，并在读回时把结构收敛成 `{artwork, photo}`。
 * 它**不属于草稿**：草稿里不允许出现素材相关的键，这条记录只服务于「刷新后提示重选」。
 */
export function persistSessionMediaSnapshot(portableMedia, storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  const source = portableMedia && typeof portableMedia === 'object' ? portableMedia : {};
  const snapshot = { artwork: source.artwork || null, photo: source.photo || null };
  if (containsMediaPayload(snapshot)) return null;
  return safeSet(store, FEEDBACK_SESSION_MEDIA_KEY, JSON.stringify(snapshot)) ? snapshot : null;
}

export function readSessionMediaSnapshot(storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  const rawText = safeGet(store, FEEDBACK_SESSION_MEDIA_KEY);
  if (!rawText) return null;
  let raw = null;
  try { raw = JSON.parse(rawText); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const pick = value => {
    if (!value || typeof value !== 'object') return null;
    return { id: text(value.id), name: text(value.name), type: text(value.type), size: Number(value.size) || 0 };
  };
  const snapshot = { artwork: pick(raw.artwork), photo: pick(raw.photo) };
  return snapshot.artwork || snapshot.photo ? snapshot : null;
}

export function clearSessionMediaSnapshot(storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  return safeRemove(store, FEEDBACK_SESSION_MEDIA_KEY);
}

/**
 * 上次的反馈模式。**不额外持久化 mode 字段**，而是从 `participants` 的不变量推导：
 * 个人反馈的参与学员最多一位（US-405 的 `effectiveParticipants`），多于一位就说明上次是班级反馈。
 */
export function draftMode(draft) {
  return (draft?.participants?.length || 0) > 1 ? '班级反馈' : '个人反馈';
}

/** 上次选中的学员：参与学员只有一位时，那一位就是所选学员（个人反馈）。 */
export function draftSelectedStudent(draft) {
  const list = Array.isArray(draft?.participants) ? draft.participants : [];
  return list.length === 1 ? list[0].name : '';
}

/**
 * 恢复时的步骤。素材（作品 / 照片）随刷新失效，所以「停在第 2 步及以后」是没有意义的：
 * 那里没有作品可装裱、没有点评可生成。此时回到第一步，并在提示条里说明上次进行到第几步。
 */
export function resolveRestoredStep(draft, { hasArtwork = false } = {}) {
  const step = buildFeedbackDraft(draft).step;
  if (step <= 1) return 1;
  return hasArtwork ? step : 1;
}

/** 上次保存过的作品名（只保留非空标题，空标题没有可填回的内容）。 */
export function restoredArtworkTitles(draft) {
  return (draft?.artworkTitles || []).filter(item => text(item.title));
}

/**
 * 把上次的作品名按「学员 + 顺序」填回这次重新选择的素材上。
 *
 * 素材本身不再存在，所以只能按顺序对位：同一位学员这次选的第 1 幅接上次的第 1 个名字。
 * **只填空标题**——老师这次已经填过的名字不能被覆盖（与 `applyDefaultTitles` 同一条纪律）。
 *
 * @returns {{entries: Array, titles: Array}} entries 是填好名字的条目，titles 是还没用掉的名字
 *          （调用方据此更新待填队列，避免同一位学员第二批素材又领到同一批名字）。
 */
export function applySavedTitles(entries = [], savedTitles = [], participant = {}, { kind = 'artwork' } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const saved = Array.isArray(savedTitles) ? savedTitles : [];
  if (kind !== 'artwork' || !text(participant?.name) || !list.length || !saved.length) {
    return { entries: list, titles: saved };
  }
  const studentId = text(participant.studentId);
  const name = text(participant.name);
  const queue = saved.filter(item => {
    const savedId = text(item.studentId);
    if (studentId && savedId) return savedId === studentId;
    return text(item.studentName) === name;
  });
  if (!queue.length) return { entries: list, titles: saved };
  const consumed = new Set();
  const next = list.map(entry => {
    if (text(entry?.title)) return entry;
    const hit = queue.shift();
    if (!hit) return entry;
    consumed.add(hit);
    return { ...entry, title: hit.title };
  });
  return { entries: next, titles: saved.filter(item => !consumed.has(item)) };
}
