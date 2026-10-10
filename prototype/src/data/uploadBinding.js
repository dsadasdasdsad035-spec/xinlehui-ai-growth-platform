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

/** 每节课每人允许的素材数量上限：作品 1–5 幅/人（US-406b）；照片 0–10 张/人（US-009）。 */
export const UPLOAD_SLOTS_PER_STUDENT = { artwork: 5, photo: 10 };

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
 * 规范化一条素材的**归属者列表**。
 *
 * US-406a/b 里一条素材只属于一位学员（`studentId` / `studentName`）。US-009 起课堂照片需要
 * 「一张全班合影分给多位学员」，于是归属升级成 `owners` 数组；`studentId` / `studentName`
 * 保留为**第一位归属者**，旧条目与旧调用方读这两个字段仍然正确（向后兼容）。
 *
 * 永不抛错：非数组、字符串（旧数据的姓名数组）、缺字段都能收敛。
 */
export function normalizeOwners(source = {}) {
  const input = source && typeof source === 'object' ? source : {};
  const raw = Array.isArray(input.owners) ? input.owners : [];
  const list = raw
    .map(item => (typeof item === 'string'
      ? { studentId: '', studentName: String(item).trim() }
      : { studentId: String(item?.studentId || '').trim(), studentName: String(item?.studentName || '').trim() }))
    .filter(item => item.studentId || item.studentName);
  const primaryId = String(input.studentId || '').trim();
  const primaryName = String(input.studentName || '').trim();
  if (primaryId || primaryName) {
    const exists = list.some(item => (primaryId ? item.studentId === primaryId : item.studentName === primaryName));
    if (!exists) list.unshift({ studentId: primaryId, studentName: primaryName });
  }
  // 去重：同一位学员只留一次（有 studentId 时按 id，缺 id 时按姓名）。
  const seen = new Set();
  return list.filter(item => {
    const key = item.studentId || `name:${item.studentName}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 这条素材是否属于这位学员：先比 studentId，再退回姓名（兼容没有 id 的旧条目/临时学员）。
 * 共用素材（owners 多于一人）对每一位归属者都返回 true，所以「一张合影分给多人」在
 * 每位学员的上传位里都会出现。
 */
export function entryOwnsParticipant(entry, participant) {
  if (!entry || !participant?.name) return false;
  const studentId = String(participant.studentId || '').trim();
  const name = String(participant.name || '').trim();
  return normalizeOwners(entry).some(owner => {
    if (studentId && owner.studentId === studentId) return true;
    // 条目上没写 studentId 时，只有姓名能对上才算这位学员的；仍然不猜。
    return !owner.studentId && Boolean(name) && owner.studentName === name;
  });
}

/**
 * 规范化一条上传素材。缺字段补默认值、永不抛错（与 normalizeLesson 同一套纪律）。
 * `studentId` 为空表示「还没绑定学员」，这是合法状态，不要用姓名或顺序去填。
 */
export function createUploadEntry(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const kind = normalizeUploadKind(source.kind);
  const owners = normalizeOwners(source);
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
    // 第一位归属者（向后兼容字段）；完整归属看 owners。
    studentId: owners[0]?.studentId || '',
    // 绑定当时记下的姓名：即使这位学员后来被移出 participants，展签也还能显示真实姓名。
    studentName: owners[0]?.studentName || '',
    // 完整归属者列表：一人一份时长度为 1，全班合影之类的共用素材可以有多位。
    owners,
    // 作品名。US-406a 阶段默认取本次课题，US-406b 起由老师逐幅填写；照片不使用该字段。
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
 * 共用素材（owners 多于一人）会同时记进每一位归属者的 id 列表。
 */
export function applyUploadBindings(participants = [], entries = []) {
  const bound = (entries || []).map(entry => createUploadEntry(entry)).filter(entry => entry.owners.length);
  if (!bound.length) return participants || [];
  return (participants || []).map(participant => {
    if (!participant?.name) return participant;
    const mine = bound.filter(entry => entryOwnsParticipant(entry, participant));
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
 * 按条目重建 participants 上某个 kind 的 id 列表（US-009 的「分配/取消分配」后调用）。
 *
 * `applyUploadBindings` 只做「追加」，适合「刚上传了一批」；而把一张照片**改**分配给另一批
 * 学员时必须能**摘掉**旧归属，否则 participant 上会留下指向这张照片的悬空 id（展签会按它认人）。
 * 这里以本次会话的条目列表为唯一真源，整体重算，天然不会悬空。
 */
export function syncUploadBindings(participants = [], items = [], kind = 'photo') {
  const wanted = normalizeUploadKind(kind);
  const field = UPLOAD_ID_FIELDS[wanted];
  const entries = (items || []).map(entry => createUploadEntry(entry))
    .filter(entry => entry.kind === wanted && entry.owners.length);
  return (participants || []).map(participant => {
    if (!participant?.name) return participant;
    const ids = entries.filter(entry => entryOwnsParticipant(entry, participant)).map(entry => entry.uploadId);
    const current = Array.isArray(participant[field]) ? participant[field] : [];
    if (current.length === ids.length && current.every((id, index) => id === ids[index])) return participant;
    return { ...participant, [field]: ids };
  });
}

/**
 * 这条（共用）素材的归属者：优先用 participants 里的真实行（姓名以名单为准），
 * 找不到就用条目上记下的姓名。**没有归属就返回空数组**，绝不做顺序推断。
 */
export function ownersOfUpload(upload, participants = []) {
  const entry = createUploadEntry(upload);
  const list = participants || [];
  return entry.owners.map(owner => {
    const found = (owner.studentId && list.find(item => String(item?.studentId || '').trim() === owner.studentId))
      || (owner.studentName && list.find(item => item?.name && item.name === owner.studentName));
    return found
      ? { studentId: found.studentId || owner.studentId, name: found.name }
      : { studentId: owner.studentId, name: owner.studentName };
  }).filter(owner => owner.studentId || owner.name);
}

/**
 * 这幅素材属于谁：先按 participant.artworkIds / photoIds 里有没有这个 uploadId 认人，
 * 再退回条目上记录的归属。**没有绑定就返回 null**，绝不做顺序推断。
 * 共用素材返回第一位归属者（需要完整名单时用 ownersOfUpload）。
 */
export function participantOfUpload(upload, participants = []) {
  const entry = createUploadEntry(upload);
  const idField = UPLOAD_ID_FIELDS[entry.kind];
  const list = participants || [];
  const byRecordedId = list.find(item => (item?.[idField] || []).includes(entry.uploadId));
  if (byRecordedId) return byRecordedId;
  for (const owner of entry.owners) {
    const found = (owner.studentId && list.find(item => String(item?.studentId || '').trim() === owner.studentId))
      || (owner.studentName && list.find(item => item?.name && item.name === owner.studentName));
    if (found) return found;
  }
  return null;
}

/**
 * 展签数据：真实学员姓名 + 真实作品名 + 课次日期。
 * 未绑定时 studentName 为空串（界面据此显示「未绑定学员」，而不是拿别人的名字顶上）。
 * 共用素材（全班合影）的 studentName 是所有归属者的顿号连接，`shared` 标出它是多人共用。
 */
export function uploadPlaque(upload, participants = [], { fallbackTitle = '', fallbackDate = '' } = {}) {
  const entry = createUploadEntry(upload);
  const owners = ownersOfUpload(entry, participants);
  const names = owners.map(owner => owner.name).filter(Boolean);
  return {
    uploadId: entry.uploadId,
    studentId: owners[0]?.studentId || entry.studentId || '',
    studentName: names.join('、') || entry.studentName || '',
    ownerNames: names,
    shared: names.length > 1,
    title: entry.title || String(fallbackTitle || '').trim() || '',
    date: String(fallbackDate || '').trim(),
    bound: Boolean(names.length)
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

/**
 * 某位学员在某个 kind 下已经上传的条目（保持传入顺序，供缩略图列表直接渲染）。
 * 归属判断走 `entryOwnsParticipant`：一人一份看 studentId/姓名，共用素材（合影）对每位归属者都算。
 */
export function uploadsOfParticipant(items = [], participant = {}, kind = 'artwork') {
  const wanted = normalizeUploadKind(kind);
  return (items || []).filter(item => normalizeUploadKind(item?.kind) === wanted && entryOwnsParticipant(item, participant));
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

// ---- 课堂照片按学员绑定（US-009）---------------------------------------------------
// 照片与作品**分开管理**：作品走「学员作品上传位」（必选，1–5 幅/人），照片走「学员课堂照片
// 上传位」（**选填**，0–10 张/人）。照片多出一个作品没有的诉求：**一张全班合影分给多位学员**，
// 所以条目从「单人归属」升级成 `owners` 多人归属（见 normalizeOwners）。

/**
 * 把一批文件创建成**共用素材**：同一份文件同时归属给的这批学员（全班合影）。
 *
 * 与 `bindFilesToStudent` 的区别：那条路是「一人一行、各选各的」；这条路是一次选一张，
 * 分给多位学员。默认只分给**到场学员**（缺课的孩子本次不在课堂上，合影里也不该算他），
 * `options.includeAbsent: true` 才会连缺课学员一起分。每位学员的名额照常占用，已经满 10 张的
 * 学员会被跳过并在 `skipped` 里回报（不能因为一张合影就让某个孩子超出上限）。
 */
export function bindSharedFiles(files = [], participants = [], options = {}) {
  const list = Array.from(files || []);
  const kind = normalizeUploadKind(options.kind);
  const title = String(options.title || '').trim();
  const max = maxSlotsPerStudent(kind, options.maxPerStudent);
  const existing = options.existing || [];
  const toUrl = typeof options.toUrl === 'function'
    ? options.toUrl
    : (file => (file && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : ''));
  const eligible = options.includeAbsent
    ? (participants || []).filter(item => item?.name)
    : attendedParticipants(participants);
  const accepted = eligible.filter(item => uploadsOfParticipant(existing, item, kind).length < max);
  const skipped = eligible.filter(item => !accepted.includes(item)).map(item => item.name);
  if (!accepted.length) {
    return { entries: [], owners: 0, accepted: 0, skipped, max, idField: UPLOAD_ID_FIELDS[kind] };
  }
  const owners = accepted.map(item => ({ studentId: String(item.studentId || '').trim(), studentName: String(item.name || '').trim() }));
  const entries = list.map(file => createUploadEntry({
    kind,
    name: file?.name,
    type: file?.type,
    size: file?.size,
    url: toUrl(file),
    title,
    owners
  }));
  return { entries, owners: owners.length, accepted: entries.length, skipped, max, idField: UPLOAD_ID_FIELDS[kind] };
}

/**
 * 把一条素材的归属**改成**指定的这批学员（US-009 的「分给其他学员 / 一张合影分给多人」）。
 *
 * 与 `applyUploadBindings` 的「追加」不同，这里是**整体替换**归属，所以调用方必须紧接着
 * `syncUploadBindings` 重建 participants 上的 id 列表，否则会留下指向这条素材的悬空 id。
 * 目标为空表示「取消全部分配」（条目变成未绑定，界面上会明说）。
 *
 * @returns {{items: Array, owners: number, rejected: string[], max: number}}
 *          rejected 是「名额已满所以没能分到」的学员姓名。
 */
export function setUploadOwners(items = [], uploadId = '', targets = [], options = {}) {
  const target = String(uploadId || '').trim();
  const list = (items || []).map(item => createUploadEntry(item));
  const entry = list.find(item => item.uploadId === target);
  if (!entry) return { items: items || [], owners: 0, rejected: [], max: maxSlotsPerStudent(options.kind) };
  const max = maxSlotsPerStudent(entry.kind, options.maxPerStudent);
  const others = list.filter(item => item.uploadId !== target);
  const wanted = (targets || []).filter(item => item?.name);
  const accepted = wanted.filter(item => uploadsOfParticipant(others, item, entry.kind).length < max);
  const rejected = wanted.filter(item => !accepted.includes(item)).map(item => item.name);
  const owners = accepted.map(item => ({ studentId: String(item.studentId || '').trim(), studentName: String(item.name || '').trim() }));
  return {
    items: list.map(item => (item.uploadId === target
      ? createUploadEntry({ ...item, owners, studentId: '', studentName: '' })
      : item)),
    owners: owners.length,
    rejected,
    max
  };
}

/**
 * 课堂照片按学员分组，**包含一张都没有的学员**（`uploads` 为空数组）。
 * 后续步骤（第二步装裱墙、第三步素材墙）用它渲染，才能「没有照片的孩子显示占位」——
 * 直接铺平已上传的照片会让照片顺序整体前移，看起来像是别人家的照片。
 */
export function participantPhotoGroups(participants = [], items = [], options = {}) {
  const kind = normalizeUploadKind(options.kind || 'photo');
  const wanted = kind;
  const source = options.includeAbsent
    ? (participants || []).filter(item => item?.name)
    : attendedParticipants(participants);
  return source.map(participant => ({
    participant,
    uploads: (items || []).filter(item => normalizeUploadKind(item?.kind) === wanted && entryOwnsParticipant(item, participant))
  }));
}

/** 一张照片分给了哪几位学员（界面上显示「共用 · N 人」时用它）。 */
export function sharedOwnerNames(upload, participants = []) {
  return ownersOfUpload(upload, participants).map(owner => owner.name).filter(Boolean);
}
