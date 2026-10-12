// 家长分享令牌（[第四步 US-208a] / F-ARCHIVE-SHARE-01）。
//
// 老师要把这一次的成长记录发给家长，链接形如 `/p/<shareToken>`。本模块是**令牌本身**的唯一真源
// （零依赖纯函数 + 常量，可直接 `node` 直跑断言；推云端在 `services/shareTokensApi.js`）：
//
//  ① **令牌随机不可猜测**：`generateShareToken()` 用 `crypto.getRandomValues` 取 24 字节
//     （192 位熵）→ 拒绝采样映射到 57 个「无易混字符」的字母表 → 32 位字符串；
//     `shareTokenStrength()` 把「长度 / 字母表 / 熵」变成可断言的读数，面板上也给老师看一眼。
//     没有 `crypto` 的环境（老 Node）回落到 `Math.random` 并如实标注 —— 绝不抛错。
//  ② **默认有效期 30 天且可配置**：`SHARE_TOKEN_DEFAULT_VALID_DAYS = 30`，
//     `SHARE_TOKEN_VALID_DAY_OPTIONS = [7, 30, 90]`（面板的「分享有效期」下拉读它，
//     自定义天数过 `normalizeShareTokenValidDays()` 收敛到 1 ~ 365 天）。
//  ③ **状态永远是推导出来的，不存**：`shareTokenStatus(record, now)` → `active | expired | revoked`
//     （记录本身是脏数据时 `invalid`）。存储里没有 `status` 字段 —— 存了就会与 `revokedAt` / `expiresAt`
//     漂移（「说要撤回、链接还能开」正是这么来的）。**撤回优先于有效期**：`revokedAt` 一有值就立即失效。
//  ④ **生成前的授权闸门**：`shareTokenGenerationGate(forward)` 读的是第四步转发面板的产物
//     （`archiveForwardView`），也就是 `data/consent.js` 那一份来源 —— **不在这里另写一套判断**，
//     未完成查看授权时 `allowed: false` 并把可读原因 + 处理入口（「去授权管理」）原样带出来。
//  ⑤ **家长端读同一份**：`resolveShareToken(tokens, token, now)` 是家长分享页（US-210）唯一的查询入口，
//     撤回 / 过期 / 令牌不存在各自有一句温和的说明（`SHARE_TOKEN_PARENT_MESSAGES`），
//     US-208 验收点名的那句撤回文案收在 `SHARE_TOKEN_REVOKED_PHRASE`，全站只写一次。
//
// 本机镜像（`loadShareTokens` / `persistShareTokens`）与云端表同一形状：云端 `share_tokens` 表还没建时
// 写入会被 PostgREST 拒掉，令牌仍落在本机镜像里（与审计日志 / 装裱模板同一套兜底口径）。

/** 本机镜像的键（主键仍是「裸数组」形状）。 */
export const SHARE_TOKEN_STORAGE_KEY = 'xinlehui-share-tokens-v1';

/** 本机镜像的上限（令牌记录很小，但也别无限增长）。 */
export const SHARE_TOKEN_LIMIT = 400;

/** 分享链接的路径前缀（验收原文的 `/p/<shareToken>`）。 */
export const SHARE_LINK_PREFIX = '/p/';

/** 默认有效期（天）与「可配置」的可选项（面板下拉读这一份）。 */
export const SHARE_TOKEN_DEFAULT_VALID_DAYS = 30;
export const SHARE_TOKEN_VALID_DAY_OPTIONS = [7, 30, 90];

/** 有效期收敛区间（天）：脏数据不抛错，收敛到区间里。 */
export const SHARE_TOKEN_VALID_DAYS_RANGE = [1, 365];

/** 令牌长度与随机字节数：24 字节 = 192 位熵 → 32 位字符（约 187 位有效熵）。 */
export const SHARE_TOKEN_LENGTH = 32;
export const SHARE_TOKEN_BYTES = 24;

/** 「短于这个长度就不算强令牌」（面板提示与断言的同一条线）。 */
export const SHARE_TOKEN_MIN_LENGTH = 16;

// 字母表去掉易混字符（0/O、1/l/I），家长手抄 / 口述链接时不至于看错。
export const SHARE_TOKEN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * 令牌的种类（[第四步 US-219]）：`record` = 图文档案分享（默认，老记录没有这个字段）、
 * `video` = 成片分享。**种类只影响分享页渲染哪一块**，有效期 / 状态 / 撤回规则一个字都不变
 * —— 成片分享与前一条共用同一份「生成闸门 + 有效期 + 撤回」。
 */
export const SHARE_TOKEN_KINDS = {
  record: 'record',
  video: 'video'
};

/** 读不出 / 缺失时的种类：老记录一律读成图文档案分享（向后兼容）。 */
export const SHARE_TOKEN_KIND_DEFAULT = SHARE_TOKEN_KINDS.record;

/** 令牌种类归一化（只认两个枚举，其余一律回落默认）。 */
export function normalizeShareTokenKind(value) {
  const kind = text(value);
  return SHARE_TOKEN_KINDS[kind] || SHARE_TOKEN_KIND_DEFAULT;
}

/** 状态枚举（`invalid` = 记录本身读不出来，例如令牌为空）。 */
export const SHARE_TOKEN_STATUS = {
  active: 'active',
  expired: 'expired',
  revoked: 'revoked',
  invalid: 'invalid'
};

/** 老师端的状态说法。 */
export const SHARE_TOKEN_STATUS_LABELS = {
  [SHARE_TOKEN_STATUS.active]: '链接可用',
  [SHARE_TOKEN_STATUS.expired]: '链接已过期',
  [SHARE_TOKEN_STATUS.revoked]: '链接已撤回',
  [SHARE_TOKEN_STATUS.invalid]: '还没有链接'
};

/**
 * 家长端的说明句（US-210 的提示页读同一份）。
 * 「已撤回」那句是 US-208 验收点名的原句，收在 `SHARE_TOKEN_REVOKED_PHRASE` 里**只写一次**，
 * 老师端的回执文案都由它拼出来（两处各写一遍，改口径时必漏一处）。
 */
export const SHARE_TOKEN_REVOKED_PHRASE = '该分享已撤回';

export const SHARE_TOKEN_PARENT_MESSAGES = {
  [SHARE_TOKEN_STATUS.active]: '',
  [SHARE_TOKEN_STATUS.expired]: '这份分享已经过了有效期，请让老师重新生成一条链接。',
  [SHARE_TOKEN_STATUS.revoked]: SHARE_TOKEN_REVOKED_PHRASE,
  [SHARE_TOKEN_STATUS.invalid]: '这个分享链接不存在或已失效，请向老师确认链接是否完整。'
};

/** 面板上的按钮与回执文案（界面不各写一份）。 */
export const SHARE_TOKEN_GENERATE_LABEL = '生成家长分享链接';
export const SHARE_TOKEN_REGENERATE_LABEL = '重新生成分享链接';
export const SHARE_TOKEN_REVOKE_LABEL = '撤回分享';
export const SHARE_TOKEN_REVOKE_CONFIRM_LABEL = '确认撤回';
export const SHARE_TOKEN_GENERATED_NOTICE = '分享链接已生成，可以直接发给家长。';
export const SHARE_TOKEN_REVOKED_NOTICE = `分享已撤回：这条链接立即失效，家长再打开会看到「${SHARE_TOKEN_REVOKED_PHRASE}」。`;
export const SHARE_TOKEN_REVOKE_NOTE = `撤回后链接立即失效：家长再打开会看到「${SHARE_TOKEN_REVOKED_PHRASE}」。`;
export const SHARE_TOKEN_VALID_DAYS_NOTE = `分享有效期默认 ${SHARE_TOKEN_DEFAULT_VALID_DAYS} 天，可按需调整（有效期由生成时刻起算）。`;
export const SHARE_TOKEN_LINK_HEADING = '家长分享链接';
export const SHARE_TOKEN_GATE_PREFIX = '生成前校验：';
export const SHARE_TOKEN_FALLBACK_BLOCK_REASON = '先完成归档并取得家长查看授权，才能生成分享链接。';

const text = value => String(value === null || value === undefined ? '' : value).trim();
const pad2 = value => String(value).padStart(2, '0');
const DAY_MS = 24 * 60 * 60 * 1000;

/** 时间入参：接受 Date / ISO 字符串 / 时间戳；读不出来时回落「现在」（永不抛错）。 */
function toTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toIso(value) {
  return new Date(toTime(value)).toISOString();
}

/** 默认随机源：优先密码学随机（「不可猜测」的实现点），没有 crypto 时返回 null。 */
function defaultRandomSource(size) {
  const webCrypto = typeof globalThis === 'undefined' ? null : globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const buffer = new Uint8Array(size);
    webCrypto.getRandomValues(buffer);
    return buffer;
  }
  return null;
}

/**
 * 取 `count` 个随机字节（0~255）。
 * `randomSource` 可注入（断言用固定序列），返回值长度不足时循环复用；
 * 随机源抛错 / 返回空时回落 `Math.random` 兜底 —— 令牌生成失败比令牌不够随机更糟。
 */
function readRandomBytes(count, randomSource) {
  const size = Math.max(1, Math.trunc(Number(count) || 0));
  const out = new Uint8Array(size);
  const source = typeof randomSource === 'function' ? randomSource : defaultRandomSource;
  try {
    const bytes = source ? source(size) : null;
    if (bytes && typeof bytes.length === 'number' && bytes.length > 0) {
      for (let index = 0; index < size; index += 1) out[index] = Number(bytes[index % bytes.length]) & 0xff;
      return out;
    }
  } catch {
    // 随机源不可用：往下走 Math.random 兜底。
  }
  for (let index = 0; index < size; index += 1) out[index] = Math.floor(Math.random() * 256);
  return out;
}

/**
 * 生成一个分享令牌（32 位、约 187 位熵）。
 * 用**拒绝采样**而不是取模：256 % 57 ≠ 0，直接取模会让字母表前 28 个字符多出一次机会。
 */
export function generateShareToken(randomSource) {
  const alphabetSize = SHARE_TOKEN_ALPHABET.length;
  // 拒绝阈值：>= 57×4 的字节丢掉（期望丢弃率 ~11%，池子给 4 倍足够）。
  const rejectAt = Math.floor(256 / alphabetSize) * alphabetSize;
  const bytes = readRandomBytes(SHARE_TOKEN_BYTES * 4, randomSource);
  let token = '';
  for (let index = 0; index < bytes.length && token.length < SHARE_TOKEN_LENGTH; index += 1) {
    const byte = bytes[index];
    if (byte < rejectAt) token += SHARE_TOKEN_ALPHABET[byte % alphabetSize];
  }
  // 极端情况下池子被丢空（随机源只给同一个字节）：兜底用取模补齐，仍然是一串随机字符。
  while (token.length < SHARE_TOKEN_LENGTH) {
    token += SHARE_TOKEN_ALPHABET[bytes[token.length % bytes.length] % alphabetSize];
  }
  return token;
}

/** 令牌强度读数（面板显示 + 断言同一条线）：`{ length, alphabet, bits, strong }`。 */
export function shareTokenStrength(token) {
  const value = text(token);
  const alphabetSize = SHARE_TOKEN_ALPHABET.length;
  const unknown = [...value].filter(char => !SHARE_TOKEN_ALPHABET.includes(char)).length;
  return {
    length: value.length,
    alphabet: alphabetSize,
    bits: Math.round(value.length * Math.log2(alphabetSize)),
    unknown,
    strong: value.length >= SHARE_TOKEN_MIN_LENGTH && unknown === 0
  };
}

/** 令牌是否长得像我们生成的（长度达标且只用白名单字母）—— 断言与自检用。 */
export function isShareTokenShaped(token) {
  return shareTokenStrength(token).strong;
}

/** 有效期（天）收敛：非数字 / 越界一律收敛到区间里，永不抛错。 */
export function normalizeShareTokenValidDays(value) {
  const [min, max] = SHARE_TOKEN_VALID_DAYS_RANGE;
  const days = Math.trunc(Number(value));
  if (!Number.isFinite(days)) return SHARE_TOKEN_DEFAULT_VALID_DAYS;
  return Math.min(max, Math.max(min, days));
}

/** 有效期文案：「30 天」/「30 天（默认）」。 */
export function shareTokenValidDaysLabel(days) {
  const value = normalizeShareTokenValidDays(days);
  return value === SHARE_TOKEN_DEFAULT_VALID_DAYS ? `${value} 天（默认）` : `${value} 天`;
}

/** 到期时刻 = 生成时刻 + N 天（ISO）。 */
export function shareTokenExpiresAt(createdAt, validDays) {
  const days = normalizeShareTokenValidDays(validDays);
  return new Date(toTime(createdAt) + days * DAY_MS).toISOString();
}

/** 分享链接（验收原文的 `/p/<shareToken>`；没有令牌时空串）。 */
export function shareTokenLink(token) {
  const value = text(token);
  return value ? `${SHARE_LINK_PREFIX}${value}` : '';
}

/**
 * 完整地址（`origin` + 分享路径）：二维码、微信文案与「复制链接」用（US-208b）。
 * `origin` 缺省时回落到浏览器当前站点（`window.location.origin`）—— Node 断言里传固定值。
 */
export function shareTokenUrl(token, { origin = '' } = {}) {
  const path = shareTokenLink(token);
  if (!path) return '';
  const base = text(origin) || (typeof window === 'undefined' ? '' : text(window.location?.origin));
  return base ? `${base.replace(/\/+$/, '')}${path}` : path;
}

/** 令牌记录里的字段白名单（构造时按它复制，别的一律丢掉）。 */
export const SHARE_TOKEN_FIELDS = [
  'token',
  'recordId',
  'recordKey',
  // 成片分享（[第四步 US-219]）：`kind` 区分图文 / 成片，`jobKey` + `period` 指出这条链接
  // 指向哪一条视频任务与哪个周期（图文分享里它们是空串）。
  'kind',
  'jobKey',
  'period',
  'orgId',
  'student',
  'studentId',
  'className',
  'lessonDate',
  'title',
  'version',
  'validDays',
  'createdAt',
  'expiresAt',
  'createdBy',
  'revokedAt',
  'revokedBy',
  // 转发状态跟踪（[第四步 US-209]）：发送渠道 / 时刻 / 第几次 / 发送时的版本，
  // 以及家长打开的次数与首次 / 最近打开时刻。**状态本身不在这里**（推导见 data/shareForward.js）。
  'channel',
  'sentAt',
  'sentCount',
  'sentVersion',
  'sentBy',
  'firstOpenedAt',
  'lastOpenedAt',
  'openCount'
];

/** 计数类字段的收敛（脏数据不抛错：非数字 / 负数一律读成 0）。 */
function counter(value) {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/** 归一化一条令牌记录；**没有令牌本体就返回 null**（它没有任何意义）。 */
export function normalizeShareTokenRecord(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const token = text(source.token);
  if (!token) return null;
  const version = Math.trunc(Number(source.version));
  return {
    token,
    recordId: text(source.recordId),
    recordKey: text(source.recordKey),
    kind: normalizeShareTokenKind(source.kind),
    jobKey: text(source.jobKey),
    period: text(source.period),
    orgId: text(source.orgId),
    student: text(source.student),
    studentId: text(source.studentId),
    className: text(source.className),
    lessonDate: text(source.lessonDate),
    title: text(source.title),
    version: Number.isFinite(version) && version > 0 ? version : 1,
    validDays: normalizeShareTokenValidDays(source.validDays),
    createdAt: text(source.createdAt),
    expiresAt: text(source.expiresAt),
    createdBy: text(source.createdBy),
    revokedAt: text(source.revokedAt),
    revokedBy: text(source.revokedBy),
    // 转发状态跟踪（US-209）：合法渠道由 `shareForward.normalizeShareForwardChannel` 在写入侧收敛，
    // 这里只做「字符串 / 计数」的粗归一化（读坏的值不冒充合法渠道，后续按「未记录渠道」显示）。
    channel: text(source.channel),
    sentAt: text(source.sentAt),
    sentCount: counter(source.sentCount),
    sentVersion: counter(source.sentVersion),
    sentBy: text(source.sentBy),
    firstOpenedAt: text(source.firstOpenedAt),
    lastOpenedAt: text(source.lastOpenedAt),
    openCount: counter(source.openCount)
  };
}

/**
 * 生成一条令牌记录（写入侧）。
 *
 * `input` = 这次分享指向哪一条档案（`recordId` / 学员 / 课次日期 / 版本 …）；
 * `options.now` 固定时间（断言用）、`options.token` / `options.random` 固定令牌（断言用）。
 */
export function createShareTokenRecord(input = {}, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const opts = options && typeof options === 'object' ? options : {};
  const createdAt = toIso(opts.now || new Date());
  const validDays = normalizeShareTokenValidDays(source.validDays ?? opts.validDays);
  return normalizeShareTokenRecord({
    token: text(opts.token) || generateShareToken(opts.random),
    recordId: source.recordId,
    recordKey: source.recordKey,
    kind: source.kind,
    jobKey: source.jobKey,
    period: source.period,
    orgId: source.orgId,
    student: source.student,
    studentId: source.studentId,
    className: source.className,
    lessonDate: source.lessonDate,
    title: source.title,
    version: source.version,
    validDays,
    createdAt,
    expiresAt: shareTokenExpiresAt(createdAt, validDays),
    createdBy: source.createdBy,
    revokedAt: '',
    revokedBy: ''
  });
}

/** 令牌状态（推导，不落库）：**撤回优先于有效期**；读不出有效期一律按失效处理。 */
export function shareTokenStatus(record, now) {
  const item = normalizeShareTokenRecord(record);
  if (!item) return SHARE_TOKEN_STATUS.invalid;
  if (item.revokedAt) return SHARE_TOKEN_STATUS.revoked;
  const expires = Date.parse(item.expiresAt);
  // 读不出有效期 = 按失效处理：不能因为数据读坏了，就把孩子的素材一直挂在网上的老链接里。
  if (!Number.isFinite(expires)) return SHARE_TOKEN_STATUS.expired;
  return expires <= toTime(now) ? SHARE_TOKEN_STATUS.expired : SHARE_TOKEN_STATUS.active;
}

export function isShareTokenActive(record, now) {
  return shareTokenStatus(record, now) === SHARE_TOKEN_STATUS.active;
}

/** 撤一条令牌（写入侧）：幂等 —— 已经撤过的保持**第一次**的撤回时间（不改写历史）。 */
export function revokeShareTokenRecord(record, options = {}) {
  const item = normalizeShareTokenRecord(record);
  if (!item) return null;
  if (item.revokedAt) return item;
  const opts = options && typeof options === 'object' ? options : {};
  return { ...item, revokedAt: toIso(opts.at || new Date()), revokedBy: text(opts.by) };
}

/** 这位学员名下的令牌（按学员名匹配；空名返回空列表 —— 不猜是哪位孩子）。 */
export function shareTokensOfStudent(tokens, student) {
  const wanted = text(student);
  const list = Array.isArray(tokens) ? tokens : [];
  if (!wanted) return [];
  return list.map(normalizeShareTokenRecord).filter(item => item && item.student === wanted);
}

/**
 * 撤回一位学员名下**所有仍可用**的令牌（[第四步 US-211] 第 3 条：家长撤回授权后，
 * 已有分享链接**一并失效**）。返回 `{tokens, revoked}` —— `revoked` 是被这一次撤掉的令牌记录
 * （已经撤过的不动、也不重复留痕：撤回必须保持第一次的时间）。
 *
 * 这是「授权撤回」那条路径的写入侧；家长端读到 `revokedAt` 就判 `revoked`（`shareTokenStatus`），
 * 因此链接立即失效，不需要再等任何一处同步。
 */
export function revokeShareTokensForStudent(tokens, student, options = {}) {
  const wanted = text(student);
  const list = (Array.isArray(tokens) ? tokens : []).map(normalizeShareTokenRecord).filter(Boolean);
  if (!wanted) return { tokens: list, revoked: [] };
  const revoked = [];
  const next = list.map(item => {
    if (item.student !== wanted || item.revokedAt) return item;
    const updated = revokeShareTokenRecord(item, options);
    if (updated) revoked.push(updated);
    return updated;
  });
  return { tokens: next, revoked };
}

/**
 * 许可证口径的「这条链接现在还能不能用」——**读侧**的一道（[第四步 US-211]）：
 * 授权撤回后即使令牌记录还没被重写（在另一台设备上撤的），家长页也要立刻打不开。
 * 只有**明确**撤回的授权才算（`pending` / 没有记录一律不在这里拦 —— 那由生成前的授权闸门负责，
 * 已经在用的链接不因为「记录缺失」被误伤）。`isViewAuthorized` 那一条 fail-safe 方向不同，别混用。
 */
export function shareTokenConsentIssue(record, consent) {
  if (!consent || typeof consent !== 'object') return '';
  const student = text(record && record.student);
  const consentName = text(consent.studentName);
  if (!student || (consentName && consentName !== student)) return '';
  return consent.status === 'revoked'
    ? SHARE_TOKEN_PARENT_MESSAGES[SHARE_TOKEN_STATUS.revoked]
    : '';
}

/** 同一条档案记录下的令牌（按生成时间倒序；时间读不出来按入参顺序）。 */
export function shareTokensOfRecord(tokens, recordId) {
  const wanted = text(recordId);
  const list = Array.isArray(tokens) ? tokens : [];
  if (!wanted) return [];
  return list
    .map(normalizeShareTokenRecord)
    .filter(item => item && item.recordId === wanted)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = Date.parse(a.item.createdAt);
      const right = Date.parse(b.item.createdAt);
      if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return right - left;
      return a.index - b.index;
    })
    .map(entry => entry.item);
}

/** 这条档案当前可用的令牌（最新的一条 active）；没有就返回 null。 */
export function activeShareTokenOfRecord(tokens, recordId, now) {
  return shareTokensOfRecord(tokens, recordId).find(item => isShareTokenActive(item, now)) || null;
}

/** 追一条令牌进列表（去重 + 上限，新的在前）。 */
export function appendShareToken(tokens, record) {
  const item = normalizeShareTokenRecord(record);
  if (!item) return Array.isArray(tokens) ? tokens.slice() : [];
  const list = (Array.isArray(tokens) ? tokens : []).map(normalizeShareTokenRecord).filter(Boolean)
    .filter(existing => existing.token !== item.token);
  return [item, ...list].slice(0, SHARE_TOKEN_LIMIT);
}

/** 按令牌替换一条（撤回就地改那一条，列表顺序不动）。 */
export function replaceShareToken(tokens, record) {
  const item = normalizeShareTokenRecord(record);
  const list = (Array.isArray(tokens) ? tokens : []).map(normalizeShareTokenRecord).filter(Boolean);
  if (!item) return list;
  const index = list.findIndex(existing => existing.token === item.token);
  if (index === -1) return [item, ...list].slice(0, SHARE_TOKEN_LIMIT);
  const next = list.slice();
  next[index] = item;
  return next;
}

/** 按令牌去重（同一条只留最新遇到的那份；顺序保持）。 */
export function dedupeShareTokens(tokens) {
  const seen = new Set();
  const list = [];
  (Array.isArray(tokens) ? tokens : []).map(normalizeShareTokenRecord).filter(Boolean).forEach(item => {
    if (seen.has(item.token)) return;
    seen.add(item.token);
    list.push(item);
  });
  return list.slice(0, SHARE_TOKEN_LIMIT);
}

/**
 * 合并两份同一个令牌的**转发跟踪字段**（US-209）：取「不漏信息」的那一侧 ——
 * 发送时刻取较晚的（渠道 / 版本跟着那一次走）、发送次数与打开次数取大、首次打开取更早、最近打开取更晚。
 * 身份字段与撤回字段由调用方决定（撤回必须赢）。
 */
function mergeShareTokenTracking(base, other) {
  const time = value => {
    const parsed = Date.parse(text(value));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const baseSent = time(base.sentAt);
  const otherSent = time(other.sentAt);
  const sentSource = baseSent === null ? other : (otherSent === null ? base : (otherSent > baseSent ? other : base));
  const earlier = (left, right) => {
    if (!left) return right;
    if (!right) return left;
    return String(left) <= String(right) ? left : right;
  };
  const later = (left, right) => {
    if (!left) return right;
    if (!right) return left;
    return String(left) >= String(right) ? left : right;
  };
  return {
    ...base,
    channel: text(sentSource.channel) || text(base.channel) || text(other.channel),
    sentAt: text(sentSource.sentAt),
    sentCount: Math.max(counter(base.sentCount), counter(other.sentCount)),
    sentVersion: counter(sentSource.sentVersion) || counter(base.sentVersion) || counter(other.sentVersion),
    sentBy: text(sentSource.sentBy) || text(base.sentBy) || text(other.sentBy),
    firstOpenedAt: earlier(text(base.firstOpenedAt), text(other.firstOpenedAt)),
    lastOpenedAt: later(text(base.lastOpenedAt), text(other.lastOpenedAt)),
    openCount: Math.max(counter(base.openCount), counter(other.openCount))
  };
}

/**
 * 合并本机镜像与云端：**撤回必须赢**（撤过的链接在哪都失效），跟踪字段取「不漏信息」的一侧。
 * 本机记录在前（云端只补本机没有的令牌）；同一个令牌两边都有时：
 *  ① 只要有一侧撤回过，就采用**撤回过**的那一侧（撤回优先于有效期与发送状态）；
 *  ② 转发次数 / 打开次数 / 首次打开时间按 `mergeShareTokenTracking` 取并集 ——
 *     在另一台设备上打开的记录，这台设备刷新后也要看得到。
 */
export function mergeShareTokens(localTokens, remoteTokens) {
  const merged = dedupeShareTokens(localTokens);
  const indexByToken = new Map(merged.map((item, index) => [item.token, index]));
  (Array.isArray(remoteTokens) ? remoteTokens : []).map(normalizeShareTokenRecord).filter(Boolean).forEach(remote => {
    const index = indexByToken.get(remote.token);
    if (index === undefined) {
      indexByToken.set(remote.token, merged.length);
      merged.push(remote);
      return;
    }
    const local = merged[index];
    if (!local.revokedAt && remote.revokedAt) {
      // 云端撤回过：撤回字段采用云端那一条，跟踪字段仍然合并（本机的打开记录不丢）。
      merged[index] = mergeShareTokenTracking({ ...local, ...remote }, local);
      return;
    }
    merged[index] = mergeShareTokenTracking(local, remote);
  });
  return merged.slice(0, SHARE_TOKEN_LIMIT);
}

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 读本机镜像（读坏 / 空 → 空列表，永不抛错）。 */
export function loadShareTokens() {
  if (typeof window === 'undefined') return [];
  return dedupeShareTokens(safeParse(window.localStorage.getItem(SHARE_TOKEN_STORAGE_KEY)));
}

/** 落本机镜像（配额不够时静默跳过：令牌已经在本机界面里，下一次写入再试）。 */
export function persistShareTokens(tokens) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SHARE_TOKEN_STORAGE_KEY, JSON.stringify(dedupeShareTokens(tokens)));
  } catch {
    /* 配额不够：不阻断分享动作。 */
  }
}

/**
 * 分享令牌的生成闸门：**读的是转发面板的产物**（`archiveForwardView`），
 * 也就是 `data/consent.js` 那一份家长授权来源 —— 不在这里另写一套授权判断。
 * 返回 `{ allowed, state, stateLabel, reason, entryLabel, note }`。
 */
export function shareTokenGenerationGate(forward = {}) {
  const view = forward && typeof forward === 'object' ? forward : {};
  const state = text(view.state);
  // 只有「可以转发给家长」才允许生成（incomplete = 还没归档，blocked = 家长未完成查看授权）。
  const allowed = state === 'ready';
  return {
    allowed,
    state,
    stateLabel: text(view.stateLabel),
    reason: allowed ? '' : (text(view.reason) || SHARE_TOKEN_FALLBACK_BLOCK_REASON),
    // 处理入口（「去授权管理」）原样带出来，界面不自己判断该给什么入口。
    entryLabel: allowed ? '' : text(view.entryLabel),
    note: allowed ? '' : `${SHARE_TOKEN_GATE_PREFIX}${text(view.reason) || SHARE_TOKEN_FALLBACK_BLOCK_REASON}`
  };
}

/** 时间读数：「2026-10-12 09:45」（读不出返回空串）。 */
export function formatShareTokenTime(value) {
  const source = text(value);
  if (!source) return '';
  const parsed = Date.parse(source);
  if (!Number.isFinite(parsed)) return '';
  const date = new Date(parsed);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 日期读数：「2026-11-11」（读不出返回空串）。 */
export function formatShareTokenDate(value) {
  return formatShareTokenTime(value).slice(0, 10);
}

/** 剩余天数（向上取整；已过期 / 读不出为 0）。 */
export function shareTokenDaysLeft(record, now) {
  const item = normalizeShareTokenRecord(record);
  if (!item) return 0;
  const expires = Date.parse(item.expiresAt);
  if (!Number.isFinite(expires)) return 0;
  return Math.max(0, Math.ceil((expires - toTime(now)) / DAY_MS));
}

/**
 * 老师端「家长分享链接」面板的整份视图（界面只渲染它的产物）。
 *
 *  - `state`：`none`（还没生成）/ `active` / `expired` / `revoked`（取这条档案**最近**的一条令牌）；
 *  - `token`：要展示的那一条（没有则 null）、`link`：`/p/<token>`、`tokenText`：令牌本体；
 *  - `expiresText` / `createdText` / `revokedText` / `daysLeftText`：可读读数；
 *  - `actionLabel`：主按钮文案（未生成 = 生成 / 已失效 = 重新生成）；
 *  - `canGenerate`：这条档案当前没有可用令牌（界面还要叠加授权闸门）。
 */
export function shareTokenView({ tokens = [], recordId = '', now = null } = {}) {
  const history = shareTokensOfRecord(tokens, recordId);
  const latest = history[0] || null;
  const active = history.find(item => isShareTokenActive(item, now)) || null;
  const shown = active || latest;
  const status = shown ? shareTokenStatus(shown, now) : SHARE_TOKEN_STATUS.invalid;
  const state = shown ? status : 'none';
  const stateLabels = { none: '还没有生成分享链接', ...SHARE_TOKEN_STATUS_LABELS };
  const expiresText = shown && shown.expiresAt
    ? (status === SHARE_TOKEN_STATUS.expired
      ? `已于 ${formatShareTokenDate(shown.expiresAt)} 过期`
      : `有效期至 ${formatShareTokenDate(shown.expiresAt)}（剩余 ${shareTokenDaysLeft(shown, now)} 天 · ${shown.validDays} 天有效期）`)
    : '';
  return {
    state,
    stateLabel: stateLabels[state] || stateLabels.none,
    status,
    token: shown,
    tokenText: shown ? shown.token : '',
    link: shown ? shareTokenLink(shown.token) : '',
    expiresText,
    createdText: shown ? formatShareTokenTime(shown.createdAt) : '',
    revokedText: shown && shown.revokedAt ? formatShareTokenTime(shown.revokedAt) : '',
    daysLeft: shown ? shareTokenDaysLeft(shown, now) : 0,
    historyCount: history.length,
    active: status === SHARE_TOKEN_STATUS.active,
    canGenerate: status !== SHARE_TOKEN_STATUS.active,
    actionLabel: state === 'none' ? SHARE_TOKEN_GENERATE_LABEL : SHARE_TOKEN_REGENERATE_LABEL
  };
}

/**
 * 家长端唯一的查询入口：按令牌找记录并判状态（US-210 的分享页读它）。
 * 返回 `{ token, found, status, statusLabel, active, record, message }` —— 令牌不存在与记录是脏数据
 * 都归到 `invalid`，两者对家长是一样的：这个链接打不开。
 */
export function resolveShareToken(tokens, token, now) {
  const wanted = text(token);
  const list = (Array.isArray(tokens) ? tokens : []).map(normalizeShareTokenRecord).filter(Boolean);
  const record = wanted ? list.find(item => item.token === wanted) || null : null;
  const status = record ? shareTokenStatus(record, now) : SHARE_TOKEN_STATUS.invalid;
  return {
    token: wanted,
    found: Boolean(record),
    status,
    statusLabel: SHARE_TOKEN_STATUS_LABELS[status] || SHARE_TOKEN_STATUS_LABELS[SHARE_TOKEN_STATUS.invalid],
    active: status === SHARE_TOKEN_STATUS.active,
    record,
    message: SHARE_TOKEN_PARENT_MESSAGES[status] || ''
  };
}

/** 面板上的一句话说明（有效期 + 撤回口径）。 */
export function shareTokenPolicyText() {
  return `分享链接默认 ${SHARE_TOKEN_DEFAULT_VALID_DAYS} 天有效（可配置），老师可随时撤回；撤回或过期后链接立即失效。`;
}
