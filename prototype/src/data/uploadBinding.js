/**
 * 上传素材 → 学员绑定（US-406a / US-406b）。
 *
 * 背景：班级反馈一次可以选择多份作品/照片。旧实现把「第 index 份素材属于第
 * `index % students.length` 位学员」写死在展示层 —— 学员数一变（少于素材份数时）就会
 * 回到第一位学员，出现「张三的作品挂在李四名下」的串档，而且素材列表与学员名单
 * 本来就没有任何真实关联。
 *
 * 这里的约定：
 * - 绑定发生在**上传那一刻**，按「还没有作品位的到场学员」顺序补齐，结果写进条目本身
 *   （`studentId` / `studentName`）与 `participant.artworkIds / photoIds`；
 * - 展签只读这份绑定（`uploadPlaque`），**任何顺序取模、序号推断都不允许**；
 * - 位置不够时多出来的素材保持 `studentId === ''`（未绑定），界面上明说「未绑定学员」，
 *   宁可留白也不猜一个姓名。
 *
 * US-406b 起班级反馈的作品走「学员乘上传位」：每位学员一行、每行自己的文件选择框，
 * 上传的素材**直接绑给这一行的学员**（`bindFilesToStudent`，不再需要轮转），
 * 每行 1–5 幅、逐幅可填作品名；超过上限的份数被忽略并回报数量（`ignored`）。
 * 轮转版 `bindFilesToParticipants` 保留给「一次选多份、没有指定学员」的路径（课堂照片，US-009 接手）。
 *
 * 素材本体（File / object URL）不进数据模型，条目里只留 name/type/size/url 这些会话内引用。
 */

/** 素材只有这两种：作品与课堂照片（视频已从这条流程里去掉）。 */
export const UPLOAD_KINDS = ['artwork', 'photo'];

/** 每种素材在 participants 上对应的 id 列表字段。 */
export const UPLOAD_ID_FIELDS = { artwork: 'artworkIds', photo: 'photoIds' };

/** 每节课每人允许的素材数量上限：作品 1–5 幅/人（US-406b）；照片在 US-009 放宽到 10 张/人。 */
export const UPLOAD_SLOTS_PER_STUDENT = { artwork: 5, photo: 1 };

/** 取某个 kind 的每人上限：调用方可以显式覆盖（测试与后台配置用），非法值回落常量。 */
export function maxSlotsPerStudent(kind = 'artwork', override) {
  const value = Number(override);
  if (Number.isFinite(value) && value > 0) return Math.trunc(value);
  return UPLOAD_SLOTS_PER_STUDENT[normalizeUploadKind(kind)];
}

let uploadSeq = 0;

/**
 * 上传素材条目的主键：必须是**随机唯一** id，不能由「学员 + 文件名」派生。
 * 派生 id 会让「同一学员交了两张同名照片」被当成同一条，绑定与去重全部失效。
 */
export function makeUploadId(kind = 'artwork') {
  uploadSeq += 1;
  const prefix = UPLOAD_KINDS.includes(kind) ? kind : 'upload';
  return `${prefix}-${Date.now().toString(36)}-${uploadSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeUploadKind(kind) {
  return UPLOAD_KINDS.includes(kind) ? kind : 'artwork';
}

/**
 * 规范化一条上传素材。缺字段补默认值、永不抛错（与 normalizeLesson 同一套纪律）。
 * `studentId` 为空表示「还没绑定学员」，这是合法状态，不要用姓名或顺序去填。
 */
export function createUploadEntry(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const kind = normalizeUploadKind(source.kind);
  const studentId = String(source.studentId || '').trim();
  return {
    uploadId: String(source.uploadId || '').trim() || makeUploadId(kind),
    kind,
    name: String(source.name || '').trim() || '未命名素材',
    type: String(source.type || '').trim(),
    size: Number(source.size) || 0,
    url: String(source.url || ''),
    rotation: Number(source.rotation) || 0,
    // 照片与作品都代表完整画面，默认视作方向正确（老师仍可手动旋转）。
    orientationChecked: source.orientationChecked !== false,
    studentId,
    // 绑定当时记下的姓名：即使这位学员后来被移出 participants，展签也还能显示真实姓名。
    studentName: String(source.studentName || '').trim(),
    // 作品名。US-406a 阶段默认取本次课题，US-406b 会由老师逐幅填写。
    title: String(source.title || '').trim()
  };
}

/** 到场学员 = 出席 + 补课（与 US-405 的门槛口径一致）；缺课的孩子本次没有作品。 */
export function attendedParticipants(participants = []) {
  return (participants || [])
    .filter(item => item && item.name)
    .filter(item => item.attendance === 'present' || item.attendance === 'makeup');
}

/**
 * 把一批文件绑定给学员。
 *
 * @param files      File 列表（只需要 name/type/size；其它对象也可以）
 * @param participants 本次课次的 participants（只用「到场」的那些）
 * @param options.kind           artwork | photo
 * @param options.existing       本次会话里该 kind **已经**绑定的条目（用来算还剩几个空位）
 * @param options.title          作品名默认值（通常是本次课题）
 * @param options.maxPerStudent  每人上限，默认取 UPLOAD_SLOTS_PER_STUDENT[kind]
 * @param options.toUrl          文件 → URL（测试时可注入，默认 URL.createObjectURL）
 * @returns {{entries: Array, participants: Array, bound: number, unbound: number}}
 *          entries 是**带 studentId 的绑定结构**（不再是纯文件列表）；unbound 是没抢到位子的份数。
 */
export function bindFilesToParticipants(files = [], participants = [], options = {}) {
  const list = Array.from(files || []);
  const kind = normalizeUploadKind(options.kind);
  const idField = UPLOAD_ID_FIELDS[kind];
  const title = String(options.title || '').trim();
  const maxPerStudent = maxSlotsPerStudent(kind, options.maxPerStudent);
  const toUrl = typeof options.toUrl === 'function'
    ? options.toUrl
    : (file => (file && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : ''));

  // 空位 = 到场学员 × 每人上限 −「本次会话里已经绑过的份数」。
  // 只用 existing 统计，不读 participant.<idField>：后者可能带着往次课次/其它批次的 id，
  // 把它算进来会让老师这一批一个空位都排不到。
  const usedByStudent = new Map();
  (options.existing || []).forEach(item => {
    const entry = createUploadEntry({ ...item, kind });
    if (!entry.studentId) return;
    usedByStudent.set(entry.studentId, (usedByStudent.get(entry.studentId) || 0) + 1);
  });
  // 空位按**轮转**排列（先给每人一份，再进第二轮），不是「先把第一位学员填满」：
  // 老师一次选 N 份素材时，最自然的期待是「一人一份」，而不是前 10 张照片都归第一个孩子。
  const students = attendedParticipants(participants);
  const capacities = students.map(participant => Math.max(0, maxPerStudent - (usedByStudent.get(participant.studentId) || 0)));
  const maxCapacity = capacities.length ? Math.max(...capacities) : 0;
  const freeSlots = [];
  for (let pass = 0; pass < maxCapacity; pass += 1) {
    students.forEach((participant, index) => {
      if (pass < capacities[index]) freeSlots.push(participant);
    });
  }

  const entries = list.map((file, index) => {
    const owner = freeSlots[index] || null;
    return createUploadEntry({
      kind,
      name: file?.name,
      type: file?.type,
      size: file?.size,
      url: toUrl(file),
      title,
      studentId: owner?.studentId || '',
      studentName: owner?.name || ''
    });
  });

  return {
    entries,
    participants: applyUploadBindings(participants, entries),
    bound: entries.filter(entry => entry.studentId).length,
    unbound: entries.filter(entry => !entry.studentId).length,
    // idField 一并回传，调用方写提示语时不用再查表。
    idField
  };
}

/**
 * 把绑定结果写回 participants：条目的 uploadId 记进对应学员的 artworkIds / photoIds。
 * 展签、成长档案、海报都从这里取「这幅作品是谁的」，所以这一步不能省。
 */
export function applyUploadBindings(participants = [], entries = []) {
  const bound = (entries || []).map(entry => createUploadEntry(entry)).filter(entry => entry.studentId);
  if (!bound.length) return participants || [];
  return (participants || []).map(participant => {
    if (!participant?.name) return participant;
    const mine = bound.filter(entry => entry.studentId === participant.studentId);
    if (!mine.length) return participant;
    const next = { ...participant };
    mine.forEach(entry => {
      const field = UPLOAD_ID_FIELDS[entry.kind];
      const current = Array.isArray(next[field]) ? next[field] : [];
      if (!current.includes(entry.uploadId)) next[field] = [...current, entry.uploadId];
    });
    return next;
  });
}

/**
 * 这幅素材属于谁：先按 participant.artworkIds / photoIds 里有没有这个 uploadId 认人，
 * 再退回条目上记录的 studentId。**没有绑定就返回 null**，绝不做顺序推断。
 */
export function participantOfUpload(upload, participants = []) {
  const entry = createUploadEntry(upload);
  const idField = UPLOAD_ID_FIELDS[entry.kind];
  const list = participants || [];
  const byRecordedId = list.find(item => (item?.[idField] || []).includes(entry.uploadId));
  if (byRecordedId) return byRecordedId;
  if (!entry.studentId) return null;
  return list.find(item => item?.studentId === entry.studentId)
    || list.find(item => item?.name && item.name === entry.studentName)
    || null;
}

/**
 * 展签数据：真实学员姓名 + 真实作品名 + 课次日期。
 * 未绑定时 studentName 为空串（界面据此显示「未绑定学员」，而不是拿别人的名字顶上）。
 */
export function uploadPlaque(upload, participants = [], { fallbackTitle = '', fallbackDate = '' } = {}) {
  const entry = createUploadEntry(upload);
  const owner = participantOfUpload(entry, participants);
  return {
    uploadId: entry.uploadId,
    studentId: owner?.studentId || entry.studentId || '',
    studentName: owner?.name || entry.studentName || '',
    title: entry.title || String(fallbackTitle || '').trim() || '',
    date: String(fallbackDate || '').trim(),
    bound: Boolean(owner || entry.studentName)
  };
}

/** 给整份素材列表补上展签数据（展示层直接用 item.plaque，不再自己拼姓名/日期）。 */
export function withUploadPlaques(items = [], participants = [], options = {}) {
  return (items || []).map(item => {
    const entry = createUploadEntry(item);
    return { ...entry, plaque: uploadPlaque(entry, participants, options) };
  });
}

// ---- 学员乘上传位（US-406b）--------------------------------------------------------
// 班级反馈的作品不再「一次选多份再轮转分给学员」，而是**一人一行、每行自己的选择框**：
// 老师在这一行里选的文件，就是这一位学员的作品，不存在任何推断。下面这几个函数是那条
// 界面路径的全部领域逻辑（筛选、计数、绑定、改名、移除），展示层只做渲染。

/** 这条素材是不是属于这位学员：先比 studentId，再退回姓名（兼容没有 id 的旧条目/临时学员）。 */
function uploadBelongsToParticipant(item, participant) {
  if (!item || !participant?.name) return false;
  const studentId = String(participant.studentId || '').trim();
  const name = String(participant.name || '').trim();
  const entryStudentId = String(item.studentId || '').trim();
  const entryName = String(item.studentName || '').trim();
  if (studentId && entryStudentId === studentId) return true;
  // 条目上没写 studentId 时（旧数据），只有姓名能对上才算这位学员的；仍然不猜。
  return !entryStudentId && Boolean(name) && entryName === name;
}

/** 某位学员在某个 kind 下已经上传的条目（保持传入顺序，供缩略图列表直接渲染）。 */
export function uploadsOfParticipant(items = [], participant = {}, kind = 'artwork') {
  const wanted = normalizeUploadKind(kind);
  return (items || []).filter(item => normalizeUploadKind(item?.kind) === wanted && uploadBelongsToParticipant(item, participant));
}

/** 某位学员的用量：已上传几幅、上限几幅、还剩几个位子、是否已满。 */
export function participantSlotUsage(items = [], participant = {}, kind = 'artwork', options = {}) {
  const max = maxSlotsPerStudent(kind, options.maxPerStudent);
  const used = uploadsOfParticipant(items, participant, kind).length;
  return { used, max, remaining: Math.max(0, max - used), full: used >= max };
}

/**
 * 把一批文件绑定给**指定的**这一位学员（班级反馈的「一人一行」上传位）。
 *
 * 与 `bindFilesToParticipants` 的区别：这里不做任何轮转/分配 —— 老师在谁的格子里选的文件
 * 就是谁的作品。超过每人上限的份数直接忽略并回报数量（`ignored`），由界面提示老师重新选择；
 * 不会变成「未绑定」条目混淆视听（那些文件的归属是明确的，只是超量）。
 */
export function bindFilesToStudent(files = [], participant = {}, options = {}) {
  const list = Array.from(files || []);
  const kind = normalizeUploadKind(options.kind);
  const title = String(options.title || '').trim();
  const toUrl = typeof options.toUrl === 'function'
    ? options.toUrl
    : (file => (file && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : ''));
  const studentId = String(participant?.studentId || '').trim();
  const studentName = String(participant?.name || '').trim();
  const usage = participantSlotUsage(options.existing || [], participant, kind, { maxPerStudent: options.maxPerStudent });
  // 没有 studentId 就没有可落库的归属：宁可一份都不收，也不要写出「绑不上任何人」的素材。
  if (!studentId || !studentName) {
    return { entries: [], participants: options.participants || [], used: usage.used, max: usage.max, accepted: 0, ignored: list.length, idField: UPLOAD_ID_FIELDS[kind] };
  }
  const accepted = list.slice(0, usage.remaining);
  const entries = accepted.map(file => createUploadEntry({
    kind,
    name: file?.name,
    type: file?.type,
    size: file?.size,
    url: toUrl(file),
    // 作品名默认留空：US-406b 起由老师逐幅填写，或用界面上的「把本次课题套用为作品名」一键补默认值。
    title,
    studentId,
    studentName
  }));
  return {
    entries,
    participants: applyUploadBindings(options.participants || [], entries),
    used: usage.used,
    max: usage.max,
    accepted: entries.length,
    ignored: list.length - entries.length,
    idField: UPLOAD_ID_FIELDS[kind]
  };
}

/** 改一条素材的字段（目前只用于逐幅填写作品名）。主键是随机唯一的 uploadId，不做自然键匹配。 */
export function updateUploadEntry(items = [], uploadId = '', patch = {}) {
  const target = String(uploadId || '').trim();
  if (!target) return items || [];
  return (items || []).map(item => (String(item?.uploadId || '').trim() === target ? createUploadEntry({ ...item, ...patch }) : item));
}

/** 移除一条素材（保留其余条目与顺序）。 */
export function removeUploadEntry(items = [], uploadId = '') {
  const target = String(uploadId || '').trim();
  if (!target) return items || [];
  return (items || []).filter(item => String(item?.uploadId || '').trim() !== target);
}

/**
 * 把 uploadId 从 participants 的 artworkIds / photoIds 里摘掉（移除素材时必须一起做，
 * 否则 participant 上会留着一个指向不存在素材的 id，展签/成长档案会按它去认人）。
 */
export function detachUploadBinding(participants = [], uploadId = '', kind = 'artwork') {
  const target = String(uploadId || '').trim();
  if (!target) return participants || [];
  const field = UPLOAD_ID_FIELDS[normalizeUploadKind(kind)];
  return (participants || []).map(item => {
    if (!Array.isArray(item?.[field]) || !item[field].includes(target)) return item;
    return { ...item, [field]: item[field].filter(id => id !== target) };
  });
}

/**
 * 一键把默认作品名套用到素材上（US-406b 的「把本次课题套用为作品名」）。
 * 默认**只填空标题**：老师已经手填过的名字不能被一次批量动作悄悄覆盖。
 * `options.onlyEmpty: false` 才会全部改写（留作将来「强制重刷」的入口）。
 */
export function applyDefaultTitles(items = [], title = '', options = {}) {
  const fallback = String(title || '').trim();
  const onlyEmpty = options.onlyEmpty !== false;
  const kind = options.kind ? normalizeUploadKind(options.kind) : '';
  let changed = 0;
  const entries = (items || []).map(item => {
    const entry = createUploadEntry(item);
    if (!fallback) return item;
    if (kind && entry.kind !== kind) return item;
    if (entry.title === fallback) return item;
    if (onlyEmpty && entry.title) return item;
    changed += 1;
    return { ...item, title: fallback };
  });
  return { entries, changed };
}

/** 一位作品都还没有上传的到场学员（界面顶部的「还有 N 位学员未上传作品」）。 */
export function participantsMissingUpload(participants = [], items = [], kind = 'artwork') {
  return attendedParticipants(participants).filter(participant => !uploadsOfParticipant(items, participant, kind).length);
}

/**
 * 上传位列表要渲染哪些学员：**到场学员**都有位置（出席 + 补课），另外把「已经上传过素材、
 * 但后来被标成缺课或移出名单」的学员也保留一行 —— 否则那份素材在界面上再也改不了作品名、
 * 也删不掉，老师只能整页刷新重来。
 */
export function uploadSlotParticipants(participants = [], items = [], kind = 'artwork') {
  const attended = attendedParticipants(participants);
  const seen = new Set(attended.map(item => String(item.studentId || '').trim()));
  const extra = (participants || []).filter(item => item?.name
    && !seen.has(String(item.studentId || '').trim())
    && uploadsOfParticipant(items, item, kind).length);
  return [...attended, ...extra];
}
