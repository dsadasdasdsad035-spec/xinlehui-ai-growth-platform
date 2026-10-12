import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const matched = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (matched && !process.env[matched[1]]) process.env[matched[1]] = matched[2].replace(/^['"]|['"]$/g, '');
  }
}

const port = Number(process.env.AI_API_PORT || 8787);
const arkBaseUrl = (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
const arkModel = process.env.ARK_VISION_MODEL || 'doubao-1-5-vision-pro-32k-250328';
const arkImageModel = process.env.ARK_IMAGE_MODEL || '';
const corsOrigin = process.env.WEB_ORIGIN || 'http://127.0.0.1:5173';
const maxJsonBytes = 1024 * 1024;
const maxImageBytes = Number(process.env.MEDIA_MAX_IMAGE_BYTES || 20 * 1024 * 1024);
// The development adapter deliberately keeps material only in RAM. Configure an object-storage
// adapter before any deployment; video uploads are not accepted by this safe local adapter.
const media = new Map();
// 归档素材（[第四步 US-203]）：与 `media` 同一套纪律 —— **只驻留内存**、不落服务端本地磁盘。
// 它模拟的是「私有对象存储」那条通道的位置，但如实声明自己不是持久落点。
const archiveMedia = new Map();
const tasks = new Map();
const parentSessions = new Map();
// 点评轨迹的审计存储（[第三步 US-112]）：**只驻留内存**（与儿童素材同一条纪律 ——
// 轨迹本身按 `data/reviewTrace.js` 的守卫不含素材正文，也不落服务端本地磁盘）。
const reviewTraces = new Map();
const reviewTraceLimit = 500;
const managementFile = path.join(dirname, 'data', 'student-management.json');
const feedbackRecordsFile = path.join(dirname, 'data', 'feedback-records.json');
// 儿童素材的存储落点（[第二步 US-013] / FR-46）：开发适配器只声明「内存」这一个落点。
// 任何把素材写到本机磁盘的实现都不允许（学员/班级档案是另一类数据，见 managementFile）。
const childMediaStorageSink = 'memory-development-only';
const childMediaStoragePolicy = {
  sink: childMediaStorageSink,
  allowedSinks: ['session-memory', 'private-object-storage'],
  forbiddenSinks: ['server-local-disk', 'public-bucket'],
  auth: {
    roleHeader: 'X-Actor-Role',
    consentHeader: 'X-Media-Consent',
    requiredRole: 'teacher',
    requiredConsent: 'granted'
  },
  credentialsToClient: ['publishableKey'],
  note: '开发适配器只在内存里持有儿童素材，不落服务端本地磁盘；生产环境必须换成私有对象存储（带鉴权、服务端签名）。',
  // 归档素材的写入通道（[第四步 US-203]）：开发适配器没有对象存储，如实声明「非持久地址」。
  archiveMedia: {
    endpoint: '/api/archive-media',
    storage: childMediaStorageSink,
    persistent: false,
    objectStorageConfigured: false,
    note: '归档素材走同一条鉴权通道；本地地址是 http、进程重启即清空 —— 客户端据此降级为本地持久副本。'
  }
};
const managementSeed = {
  students: [
    { name: '陈一诺', birthDate: '2019-04-18', className: '周六创意绘画 2 班', guardianName: '陈一诺妈妈', guardianPhone: '', expect: '希望孩子更自信地表达自己的想法。' },
    { name: '林小满', birthDate: '2018-08-12', className: '周六创意绘画 2 班', guardianName: '', guardianPhone: '', expect: '' },
    { name: '赵禾', birthDate: '2019-02-06', className: '周六创意绘画 2 班', guardianName: '', guardianPhone: '', expect: '' }
  ],
  classes: [
    { id: 'class-sat-2', name: '周六创意绘画 2 班', course: '创意绘画', schedule: '每周六 10:00–11:30', teacher: '林晓老师', capacity: 18 },
    { id: 'class-color', name: '色彩启蒙班', course: '色彩启蒙', schedule: '每周日 14:00–15:30', teacher: '林晓老师', capacity: 12 }
  ]
};

function send(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    // `X-Media-Storage-Key` 是归档素材写入（[第四步 US-203] `/api/archive-media`）带的建议键：
    // 少一个头会让预检失败、请求根本发不出去（上传被静默降级成 pending），所以它必须在白名单里。
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Actor-Role, X-Actor-Id, X-Media-Consent, X-Media-Kind, X-Media-Name, X-Media-Storage-Key',
    'Access-Control-Max-Age': '600',
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, error) { return send(response, status, { error }); }

function requestContext(request) {
  return {
    role: String(request.headers['x-actor-role'] || ''),
    consent: String(request.headers['x-media-consent'] || '')
  };
}

function requireTeacherWithConsent(request, response) {
  const { role, consent } = requestContext(request);
  if (role !== 'teacher') { sendError(response, 403, 'Only a teacher can submit child media.'); return false; }
  if (consent !== 'granted') { sendError(response, 403, 'Guardian consent is required before submitting media.'); return false; }
  return true;
}

function requireTeacher(request, response) {
  if (requestContext(request).role !== 'teacher') { sendError(response, 403, 'Only a teacher can manage students and classes.'); return false; }
  return true;
}

// 轨迹查询与提交的**服务端主体判定**（[第三步 US-112] / FR-114）：
//   · 带上有效的家长会话令牌 → 403（家长会话不能查询点评轨迹，服务端直接拒绝，不看界面）；
//   · `X-Actor-Role: parent` → 403；缺身份 / 其他角色 → 401；
//   · 老师只会拿到**自己经手**的轨迹（按 `X-Actor-Id` 过滤），管理员可看本存储里的全部。
function requireTraceAudience(request, response) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) {
    const session = parentSessions.get(token);
    if (session && session.expiresAt >= Date.now()) {
      sendError(response, 403, '家长会话不能查询点评轨迹：轨迹只对老师与管理员开放。');
      return '';
    }
    // 带了令牌但这一层认不出的会话：**不可能是老师 / 管理员的凭据** → 一样拒绝
    // （家长端的会话令牌由云端签发，开发适配器只负责「不认就不放行」这一条 fail-safe）。
    sendError(response, 403, '无法验证的会话不能查询点评轨迹：轨迹只对老师与管理员开放。');
    return '';
  }
  const { role } = requestContext(request);
  if (role === 'parent') { sendError(response, 403, '家长会话不能查询点评轨迹：轨迹只对老师与管理员开放。'); return ''; }
  if (role !== 'admin' && role !== 'teacher') { sendError(response, 401, '查询点评轨迹需要老师或管理员身份。'); return ''; }
  return role;
}

const traceText = (value) => (value === null || value === undefined ? '' : String(value).trim());

/** 头里的身份串（百分号编码；解不开就原样用 —— 宁可当成认不出的身份，也不猜）。 */
function decodeHeaderValue(raw) {
  const text = String(raw || '');
  if (!text) return '';
  try { return decodeURIComponent(text).trim(); } catch { return text.trim(); }
}

/** 轨迹正文里不允许出现素材正文（与 `data/reviewTrace.js` 的守卫同一条纪律，服务端再核一次）。 */
function tracePayloadHasMedia(payload) {
  const text = JSON.stringify(payload || {});
  return /(data:image\/|;base64,|blob:)/i.test(text);
}

/** 收到的一条轨迹 → 存储行（snake_case 列只放检索键，整条按白名单进 payload）。 */
function sanitizeTraceRow(raw) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const traceKey = traceText(row.trace_key || payload.traceId).slice(0, 120);
  if (!traceKey) throw Object.assign(new Error('点评轨迹缺少 trace_key。'), { status: 400 });
  if (tracePayloadHasMedia(payload)) throw Object.assign(new Error('点评轨迹不能包含素材正文（data URL / base64 / blob:）。'), { status: 400 });
  return {
    trace_key: traceKey,
    task: traceText(row.task || payload.task).slice(0, 60),
    student_id: traceText(row.student_id || payload.studentId).slice(0, 80),
    student_name: traceText(row.student_name || payload.studentName).slice(0, 80),
    lesson_id: traceText(row.lesson_id || payload.lessonId).slice(0, 120),
    teacher_id: traceText(row.teacher_id || payload.teacherId).slice(0, 120),
    teacher_name: traceText(row.teacher_name || payload.teacherName).slice(0, 80),
    org_id: traceText(row.org_id || payload.orgId).slice(0, 80),
    model: traceText(row.model || payload.model).slice(0, 80),
    status: traceText(row.status || payload.status).slice(0, 30),
    created_at: traceText(row.created_at || payload.createdAt).slice(0, 40),
    payload
  };
}

// 日期键与客户端同一口径：带时间的 ISO 时间戳按**本地时间**折算（UTC 戳直接切前 10 位会差一天）。
const traceDay = (value) => {
  const text = traceText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  const pad = (input) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 服务端筛选（与客户端 `filterReviewTraces` 同一组维度；空串 = 该维度不过滤）。 */
function filterTraceStore(filters, { role, actorId }) {
  const student = traceText(filters.student);
  const teacher = traceText(filters.teacher);
  const model = traceText(filters.model);
  const status = traceText(filters.status);
  const from = traceText(filters.from);
  const to = traceText(filters.to);
  return [...reviewTraces.values()]
    .filter((row) => {
      // 老师只看自己经手的：身份串对不上就不返回（拿不到身份串时返回空，fail-safe）。
      if (role === 'teacher') {
        if (!actorId || row.teacher_id !== actorId) return false;
      }
      if (student && !(row.student_name.includes(student) || row.student_id.includes(student))) return false;
      if (teacher && !(row.teacher_name.includes(teacher) || row.teacher_id.includes(teacher))) return false;
      if (model && row.model.toLowerCase() !== model.toLowerCase()) return false;
      if (status && row.status !== status) return false;
      const day = traceDay(row.created_at);
      if (from && (!day || day < from)) return false;
      if (to && (!day || day > to)) return false;
      return true;
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, reviewTraceLimit);
}

function parentStudentNames(request, response) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = parentSessions.get(token);
  if (!session || session.expiresAt < Date.now()) { sendError(response, 401, 'A valid parent session is required.'); return undefined; }
  return session.studentNames;
}

function loadManagement() {
  try {
    const saved = JSON.parse(fs.readFileSync(managementFile, 'utf8'));
    if (Array.isArray(saved.students) && Array.isArray(saved.classes)) return saved;
  } catch { /* First use and malformed local data both return the safe seed. */ }
  return managementSeed;
}

function saveManagement(value) {
  if (!Array.isArray(value?.students) || !Array.isArray(value?.classes)) throw Object.assign(new Error('Invalid student-management data.'), { status: 400 });
  fs.mkdirSync(path.dirname(managementFile), { recursive: true });
  const safe = {
    students: value.students.map(item => ({ name: String(item.name || '').slice(0, 80), birthDate: String(item.birthDate || '').slice(0, 24), className: String(item.className || '').slice(0, 100), guardianName: String(item.guardianName || '').slice(0, 80), guardianPhone: String(item.guardianPhone || '').slice(0, 40), expect: String(item.expect || '').slice(0, 1000) })).filter(item => item.name),
    classes: value.classes.map(item => ({ id: String(item.id || crypto.randomUUID()), name: String(item.name || '').slice(0, 100), course: String(item.course || '').slice(0, 80), schedule: String(item.schedule || '').slice(0, 100), teacher: String(item.teacher || '').slice(0, 80), capacity: Math.max(1, Math.min(200, Number(item.capacity) || 1)) })).filter(item => item.name)
  };
  fs.writeFileSync(managementFile, JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}

function loadFeedbackRecords() {
  try {
    const saved = JSON.parse(fs.readFileSync(feedbackRecordsFile, 'utf8'));
    if (Array.isArray(saved)) return saved;
  } catch { /* The first save creates the local development store. */ }
  return [];
}

function saveFeedbackRecords(records) {
  if (!Array.isArray(records)) throw Object.assign(new Error('Invalid feedback records.'), { status: 400 });
  const safe = records.slice(0, 3000).map(record => ({
    id: String(record.id || crypto.randomUUID()).slice(0, 120),
    student: String(record.student || '').slice(0, 80),
    className: String(record.className || '').slice(0, 100),
    date: String(record.date || '').slice(0, 24),
    title: String(record.title || '未命名作品').slice(0, 160),
    status: String(record.status || '已归档').slice(0, 30),
    mode: String(record.mode || '').slice(0, 30),
    subject: String(record.subject || '').slice(0, 100),
    artworkName: String(record.artworkName || '').slice(0, 200),
    photoName: String(record.photoName || '').slice(0, 200),
    videoName: String(record.videoName || '').slice(0, 200),
    artworkUrl: /^https?:\/\//.test(String(record.artworkUrl || '')) ? String(record.artworkUrl).slice(0, 2000) : '',
    photoUrl: /^https?:\/\//.test(String(record.photoUrl || '')) ? String(record.photoUrl).slice(0, 2000) : '',
    videoUrl: /^https?:\/\//.test(String(record.videoUrl || '')) ? String(record.videoUrl).slice(0, 2000) : '',
    artworkSource: String(record.artworkSource || '').slice(0, 60),
    photoSource: String(record.photoSource || '').slice(0, 60),
    reviews: Object.fromEntries(Object.entries(record.reviews || {}).slice(0, 8).map(([key, value]) => [String(key).slice(0, 40), String(value || '').slice(0, 2000)]))
  })).filter(record => record.id && record.student);
  fs.mkdirSync(path.dirname(feedbackRecordsFile), { recursive: true });
  fs.writeFileSync(feedbackRecordsFile, JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(Object.assign(new Error('Media is too large for the local development adapter.'), { status: 413 })); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function readJson(request) {
  const body = await readBody(request, maxJsonBytes);
  try { return JSON.parse(body.toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON request body.'), { status: 400 }); }
}

function validateMedia(kind, contentType, size) {
  const allowed = {
    artwork: new Set(['image/jpeg', 'image/png', 'image/webp']),
    photo: new Set(['image/jpeg', 'image/png', 'image/webp']),
    video: new Set(['video/mp4', 'video/quicktime', 'video/webm'])
  };
  if (!allowed[kind]?.has(contentType)) throw Object.assign(new Error('Unsupported media type.'), { status: 415 });
  if (kind === 'video') throw Object.assign(new Error('Video upload needs the production object-storage adapter and is disabled in local memory mode.'), { status: 503 });
  if (!size) throw Object.assign(new Error('An empty file cannot be uploaded.'), { status: 400 });
}

function mediaAsDataUrl(id) {
  const item = media.get(id);
  if (!item) return undefined;
  return `data:${item.contentType};base64,${item.bytes.toString('base64')}`;
}

function createTask(type, mediaId) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const task = { id, type, mediaId, status: 'queued', createdAt: now, updatedAt: now };
  tasks.set(id, task);
  queueMicrotask(() => { task.status = 'ready'; task.updatedAt = new Date().toISOString(); });
  return task;
}

function createPrompt({ subject = 'General art', keywords = [], studentName = 'Student', teacherObservation = '', hasArtwork, hasPhoto, hasVideo, artworkEvidence = {} }) {
  const colorRule = artworkEvidence.hasColor
    ? 'Visible color is present. Mention color only when it is actually visible in the attached artwork.'
    : 'No sufficient visible color evidence was detected. Do NOT mention color, hue, warm/cool contrast, light/dark, shading, coloring, or color hierarchy anywhere in the review.';
  return `You are an art-education growth coach. Create a warm, evidence-based draft lesson review in Chinese for a teacher to edit.\n\nRules:\n- Use only observable evidence from supplied material and teacher notes. Do not infer unseen classroom details.\n- ${colorRule}\n- If a feature is not visibly supported (composition, material, detail, classroom behavior), omit it rather than guessing.\n- Do not label or diagnose the child. The “inner state” section must be framed as a developmental observation, not a psychological conclusion.\n- Parent advice must be 1–2 specific, practical actions.\n- Return JSON only, no Markdown.\n\nLesson information:\n- Student: ${studentName}\n- Subject: ${subject}\n- Materials: artwork=${hasArtwork ? 'yes' : 'no'}, photo=${hasPhoto ? 'yes' : 'no'}, video=${hasVideo ? 'yes' : 'no'}\n- Artwork evidence: visible marks=${artworkEvidence.visibleMarks ? 'yes' : 'not confirmed'}, color=${artworkEvidence.hasColor ? 'present' : 'not confirmed'}\n- Teacher observation: ${teacherObservation || 'not provided'}\n- Focus keywords: ${keywords.length ? keywords.join('、') : 'not selected'}\n\nReturn this exact shape:\n{"evidence":["verifiable evidence 1","verifiable evidence 2"],"reviews":{"美术能力":"80-150 Chinese characters","上课状态":"60-120 Chinese characters; state limits if evidence is missing","行为能力":"60-120 Chinese characters; observable behavior only","内在状态":"60-120 Chinese characters; developmental observation only, no diagnosis","家长建议":"80-150 Chinese characters; 1-2 practical actions"}}`;
}

async function generateReview(input) {
  if (!process.env.ARK_API_KEY) return { mode: 'draft', message: 'ARK_API_KEY is not configured; the editable local draft remains available.' };
  const content = [{ type: 'text', text: createPrompt(input) }];
  const artworkDataUrl = input.artworkId ? mediaAsDataUrl(input.artworkId) : input.artworkDataUrl;
  const photoDataUrl = input.photoId ? mediaAsDataUrl(input.photoId) : input.photoDataUrl;
  if (artworkDataUrl) content.push({ type: 'image_url', image_url: { url: artworkDataUrl } });
  if (photoDataUrl) content.push({ type: 'image_url', image_url: { url: photoDataUrl } });
  const result = await fetch(`${arkBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: arkModel, temperature: 0.35, response_format: { type: 'json_object' }, messages: [{ role: 'user', content }] })
  });
  if (!result.ok) throw new Error(`Ark request failed (HTTP ${result.status}). Check the server key, endpoint and balance.`);
  const json = await result.json();
  const output = json?.choices?.[0]?.message?.content;
  if (!output) throw new Error('The AI provider returned no usable review.');
  try { return { mode: 'ai', ...JSON.parse(output) }; }
  catch { throw new Error('The AI provider returned an invalid review format.'); }
}

function artworkPreservationPrompt() {
  return '将输入的儿童手绘作品处理为展览级高清数字作品图：自动裁切并移除拍摄环境、桌面、纸张外边缘、阴影与杂物；完整保留原作品的全部线条、颜色、构图、笔触、文字和细节。不要新增、删除、重绘、补画或改变任何作品元素；不要出现相框、双层边框、桌面、手、墙面、水印或文字覆盖。输出纯净白色卡纸上的完整原作画心，高保真、写实、细腻。';
}

async function generateArtworkImage({ artworkId }) {
  if (!arkImageModel) return { mode: 'local', message: 'ARK_IMAGE_MODEL is not configured; the local non-destructive artwork extraction remains active.' };
  const image = mediaAsDataUrl(artworkId);
  if (!image) throw Object.assign(new Error('Artwork was not found or has expired.'), { status: 404 });
  const result = await fetch(`${arkBaseUrl}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: arkImageModel,
      prompt: artworkPreservationPrompt(),
      image: [image],
      response_format: 'b64_json',
      watermark: false
    })
  });
  if (!result.ok) throw new Error(`Doubao image request failed (HTTP ${result.status}). Check ARK_IMAGE_MODEL is an enabled image endpoint.`);
  const json = await result.json();
  const data = json?.data?.[0];
  if (data?.b64_json) return { mode: 'ai', imageUrl: `data:image/png;base64,${data.b64_json}`, model: json.model || arkImageModel };
  if (data?.url) return { mode: 'ai', imageUrl: data.url, model: json.model || arkImageModel };
  throw new Error('Doubao image provider returned no usable image.');
}

http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {});
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { ok: true, configured: Boolean(process.env.ARK_API_KEY), model: arkModel, storage: childMediaStorageSink });
    // 儿童素材的存储策略（[第二步 US-013]）：服务端自己声明落点与鉴权要求，
    // 客户端（`services/mediaStorage.js`）拿 `/health` 的 storage 字段与这份声明复核。
    if (request.method === 'GET' && url.pathname === '/api/compliance/storage-policy') return send(response, 200, childMediaStoragePolicy);
    if (request.method === 'GET' && url.pathname === '/api/management') {
      if (!requireTeacher(request, response)) return;
      return send(response, 200, loadManagement());
    }
    if (request.method === 'PUT' && url.pathname === '/api/management') {
      if (!requireTeacher(request, response)) return;
      return send(response, 200, saveManagement(await readJson(request)));
    }
    if (request.method === 'GET' && url.pathname === '/api/feedback-records') {
      if (!requireTeacher(request, response)) return;
      return send(response, 200, { records: loadFeedbackRecords() });
    }
    if (request.method === 'PUT' && url.pathname === '/api/feedback-records') {
      if (!requireTeacher(request, response)) return;
      const { records } = await readJson(request);
      return send(response, 200, { records: saveFeedbackRecords(records) });
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/parent-session') {
      const { phone, code } = await readJson(request);
      if (!/^1\d{10}$/.test(String(phone || ''))) return sendError(response, 400, 'A valid phone is required.');
      // Development-only verification. Production must replace this with a verified SMS provider callback.
      if (String(code || '') !== '123456') return sendError(response, 401, 'Invalid verification code.');
      const studentNames = loadManagement().students.filter(item => item.guardianPhone === phone).map(item => item.name);
      if (!studentNames.length) return sendError(response, 403, 'This phone is not bound to a student archive.');
      const token = crypto.randomUUID();
      parentSessions.set(token, { studentNames, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
      return send(response, 201, { token, studentNames, expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() });
    }
    if (request.method === 'GET' && url.pathname === '/api/parent/feedback-records') {
      const names = parentStudentNames(request, response);
      if (!names) return;
      return send(response, 200, { records: loadFeedbackRecords().filter(record => names.includes(record.student)) });
    }
    // 点评轨迹（[第三步 US-112]）：查询与提交都先过 `requireTraceAudience` ——
    // 家长会话在这里被**直接拒绝**（403），不看界面有没有入口。
    if (request.method === 'GET' && url.pathname === '/api/review-traces') {
      const role = requireTraceAudience(request, response);
      if (!role) return;
      // 身份串在头里是百分号编码的（HTTP 头只安全承载 ASCII，原型里的老师身份是中文姓名）。
      const actorId = decodeHeaderValue(request.headers['x-actor-id']);
      const traces = filterTraceStore({
        student: url.searchParams.get('student') || '',
        teacher: url.searchParams.get('teacher') || '',
        model: url.searchParams.get('model') || '',
        status: url.searchParams.get('status') || '',
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || ''
      }, { role, actorId });
      return send(response, 200, { traces, count: traces.length, audience: role });
    }
    if (request.method === 'POST' && url.pathname === '/api/review-traces') {
      const role = requireTraceAudience(request, response);
      if (!role) return;
      const row = sanitizeTraceRow(await readJson(request));
      reviewTraces.set(row.trace_key, row);
      if (reviewTraces.size > reviewTraceLimit) {
        const oldest = [...reviewTraces.values()].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).slice(0, reviewTraces.size - reviewTraceLimit);
        oldest.forEach((item) => reviewTraces.delete(item.trace_key));
      }
      return send(response, 201, { saved: true, traceKey: row.trace_key });
    }
    if (request.method === 'POST' && url.pathname === '/api/media') {
      if (!requireTeacherWithConsent(request, response)) return;
      const kind = String(request.headers['x-media-kind'] || '');
      const contentType = String(request.headers['content-type'] || '').split(';')[0].toLowerCase();
      const bytes = await readBody(request, maxImageBytes);
      validateMedia(kind, contentType, bytes.length);
      const id = crypto.randomUUID();
      const rawName = String(request.headers['x-media-name'] || 'untitled').slice(0, 180);
      let name = rawName;
      try { name = decodeURIComponent(rawName); } catch { /* keep a safe raw filename */ }
      const item = { id, kind, contentType, name, size: bytes.length, bytes, createdAt: new Date().toISOString() };
      media.set(id, item);
      return send(response, 201, { id: item.id, kind: item.kind, name: item.name, type: item.contentType, size: item.size, storage: 'memory-development-only' });
    }
    const mediaMatch = url.pathname.match(/^\/api\/media\/([\w-]+)$/);
    if (mediaMatch && request.method === 'DELETE') {
      if (!requireTeacherWithConsent(request, response)) return;
      media.delete(mediaMatch[1]);
      return send(response, 200, { deleted: true });
    }
    // 归档素材的持久化落点（[第四步 US-203]）。开发适配器**没有对象存储**，所以它如实
    // 声明「内存 + 非持久地址（http://127.0.0.1）」而不是假装成功：客户端 `services/archiveMediaApi.js`
    // 会拿 `storage` 与 `url` 过两道闸门（落点合格 / 必须 https），于是本地跑出来的结果是
    // `local`（降级为本地持久副本 + 界面上标注），生产接上私有对象存储后才会是 `synced`。
    if (request.method === 'POST' && url.pathname === '/api/archive-media') {
      if (!requireTeacherWithConsent(request, response)) return;
      const kind = String(request.headers['x-media-kind'] || '');
      const contentType = String(request.headers['content-type'] || '').split(';')[0].toLowerCase();
      const bytes = await readBody(request, maxImageBytes);
      validateMedia(kind, contentType, bytes.length);
      const requestedKey = String(request.headers['x-media-storage-key'] || '').replace(/[^\w./-]/g, '').slice(0, 180);
      const id = crypto.randomUUID();
      const storageKey = requestedKey || `archive/${kind || 'media'}/${id}`;
      const item = { id, kind, contentType, size: bytes.length, bytes, storageKey, createdAt: new Date().toISOString() };
      archiveMedia.set(id, item);
      return send(response, 201, {
        id: item.id,
        kind: item.kind,
        size: item.size,
        storageKey,
        url: `${url.protocol}//${url.host}/api/archive-media/${item.id}`,
        storage: childMediaStorageSink,
        persistent: false,
        note: '本地开发适配器没有对象存储：素材只在内存里、地址不是 https，属非持久地址；归档时客户端会降级为本地持久副本并在界面标注。'
      });
    }
    const archiveMediaMatch = url.pathname.match(/^\/api\/archive-media\/([\w-]+)$/);
    if (archiveMediaMatch && request.method === 'GET') {
      // 生产口径是「私有桶 + 服务端签名」；本地开发适配器只是把内存里的字节按 id 回放，
      // 方便 curl / 浏览器核对这次上传真的到了服务端。重启进程即清空（不落本地磁盘，FR-46）。
      const item = archiveMedia.get(archiveMediaMatch[1]);
      if (!item) return sendError(response, 404, 'Archive media was not found or has expired.');
      response.writeHead(200, { 'Content-Type': item.contentType, 'Content-Length': item.bytes.length, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      response.end(item.bytes);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/tasks') {
      if (!requireTeacherWithConsent(request, response)) return;
      const { type, mediaId } = await readJson(request);
      if (!media.has(mediaId)) return sendError(response, 404, 'Media was not found or has expired.');
      return send(response, 202, { task: createTask(type, mediaId) });
    }
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([\w-]+)$/);
    if (taskMatch && request.method === 'GET') {
      if (!requireTeacherWithConsent(request, response)) return;
      const task = tasks.get(taskMatch[1]);
      return task ? send(response, 200, { task }) : sendError(response, 404, 'Task was not found.');
    }
    if (request.method === 'POST' && url.pathname === '/api/reviews/generate') {
      if (!requireTeacherWithConsent(request, response)) return;
      const input = await readJson(request);
      if (input.artworkId && !media.has(input.artworkId)) return sendError(response, 404, 'Artwork was not found or has expired.');
      if (input.photoId && !media.has(input.photoId)) return sendError(response, 404, 'Photo was not found or has expired.');
      return send(response, 200, await generateReview(input));
    }
    if (request.method === 'POST' && url.pathname === '/api/artwork/generate') {
      if (!requireTeacherWithConsent(request, response)) return;
      const { artworkId } = await readJson(request);
      if (!artworkId || !media.has(artworkId)) return sendError(response, 404, 'Artwork was not found or has expired.');
      if (!process.env.ARK_API_KEY) return sendError(response, 503, 'ARK_API_KEY is not configured on the server.');
      return send(response, 200, await generateArtworkImage({ artworkId }));
    }
    return sendError(response, 404, 'Not found');
  } catch (error) {
    return sendError(response, error.status || 400, error.message || 'Request failed.');
  }
}).listen(port, '127.0.0.1', () => console.log(`Xinlehui AI service listening at http://127.0.0.1:${port}`));
