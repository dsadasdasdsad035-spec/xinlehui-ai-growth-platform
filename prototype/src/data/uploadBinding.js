/**
 * 上传素材 → 学员绑定（US-406a）。
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
 * 素材本体（File / object URL）不进数据模型，条目里只留 name/type/size/url 这些会话内引用。
 */

/** 素材只有这两种：作品与课堂照片（视频已从这条流程里去掉）。 */
export const UPLOAD_KINDS = ['artwork', 'photo'];

/** 每种素材在 participants 上对应的 id 列表字段。 */
export const UPLOAD_ID_FIELDS = { artwork: 'artworkIds', photo: 'photoIds' };

/** 每节课每人允许的素材数量上限（US-406a 阶段作品为 1 幅/人，US-406b 的乘上传位会放宽到 5）。 */
export const UPLOAD_SLOTS_PER_STUDENT = { artwork: 1, photo: 1 };

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
  const maxPerStudent = Number.isFinite(Number(options.maxPerStudent)) && Number(options.maxPerStudent) > 0
    ? Math.trunc(Number(options.maxPerStudent))
    : UPLOAD_SLOTS_PER_STUDENT[kind];
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
