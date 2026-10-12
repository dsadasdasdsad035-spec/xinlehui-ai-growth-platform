// 成片地址的**带签名临时 URL**（[第四步 US-223] 第 5 条 / FR-315）。
//
// 验收原文：「成片文件地址使用带签名的临时 URL，且有效期不超过分享有效期」。
// 渲染服务的成片不做公开可猜测的地址（与 FR-46 同一条口径）：客户端只拿一个**临时签名地址**，
// 到期即失效。两条规则收在这一份零依赖模块里：
//
//  ① **签名与有效期都要在地址里**：签名参数（`sig` / `signature` / `X-Amz-Signature` …）
//     与有效期参数（`expires` / `X-Amz-Expires` + `X-Amz-Date` / `token_expires` …）缺一不可 ——
//     一个没有有效期的 https 地址等于永久公开地址，判定直接拒（`videoSignedUrlIssue`）。
//  ② **有效期不超过分享有效期**：签名到期时刻必须 ≤ 这条成片的分享令牌到期时刻。
//     签名 TTL 的上限由 `videoSignedUrlPolicy` 给出（默认 1 小时，且被分享有效期再压一道）——
//     家长手里的分享链接还有 3 天，成片地址就不能是 7 天。
//
// 本模块只做判定与读数，**不签地址**（签名在服务端，密钥不下发前端）；判定函数在界面、
// 断言与服务端收口处共用一份。

import { videoJobOutputUrlIssue } from './videoJobs';
import { SHARE_TOKEN_DEFAULT_VALID_DAYS, normalizeShareTokenValidDays, shareTokenExpiresAt } from './shareTokens';

const str = value => String(value === null || value === undefined ? '' : value).trim();
const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const DAY_MS = 24 * 60 * 60 * 1000;

/** 签名 TTL 的默认上限：1 小时（临时地址的本意是「刚够这一次播放 / 下载」）。 */
export const VIDEO_SIGNED_URL_DEFAULT_TTL_SECONDS = 3600;

/** 可选 TTL（面板与断言读同一份）。 */
export const VIDEO_SIGNED_URL_TTL_OPTIONS = [
  { seconds: 900, label: '15 分钟' },
  { seconds: 3600, label: '1 小时（默认）' },
  { seconds: 6 * 3600, label: '6 小时' },
  { seconds: 24 * 3600, label: '24 小时' }
];

/** 签名参数名（任一命中即算「带签名」）。 */
export const VIDEO_SIGNED_URL_SIGNATURE_PARAMS = ['sig', 'signature', 'x-amz-signature', 'x-amz-credential', 'x-goog-signature', 'x-signature', 'auth_key'];

/** 有效期参数名（任一命中即算「有有效期」；值是绝对秒 / 相对秒 / ISO 都认）。 */
export const VIDEO_SIGNED_URL_EXPIRY_PARAMS = ['expires', 'se', 'e', 'x-goog-expires', 'x-amz-expires', 'token_expires'];

/** 界面文案（唯一真源）。 */
export const VIDEO_SIGNED_URL_SECTION_TITLE = '成片地址：带签名的临时 URL';
export const VIDEO_SIGNED_URL_NOTE = '成片地址由渲染服务签名后下发（https + 签名参数 + 有效期），有效期默认不超过 1 小时，且永远不超过这条成片的分享有效期；密钥不下发前端。';
export const VIDEO_SIGNED_URL_EMPTY_TEXT = '还没有成片地址：渲染服务未接入，这里不显示任何假地址（也不编一个没有有效期的公开地址）。';
export const VIDEO_SIGNED_URL_DENIED_TEXT = '这个成片地址不合规：成片只能用带签名、带有效期且不超过分享有效期的临时 URL。';

/** 时间读数：「2026-10-12 20:15」（读不出来原样返回）。
 *  数值一律按**毫秒时间戳**解读 —— 与 `videoSignedUrlExpiresAt` 的返回单位一致（写死 1e12 的秒/毫秒混用
 *  会让 2026 年的时间戳显示成公元 58937 年）。 */
export function videoSignedUrlTimeText(value) {
  const text = str(value);
  if (!text) return '';
  const time = /^\d+(\.\d+)?$/.test(text) ? Number(text) : Date.parse(text);
  if (!Number.isFinite(time)) return text;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return text;
  const pad = input => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 秒数 → 人话（「15 分钟」/「1 小时」/「2 天」）。 */
export function videoSignedUrlDurationText(seconds) {
  const total = Math.max(0, Math.trunc(num(seconds)));
  if (!total) return '0 秒';
  if (total < 60) return `${total} 秒`;
  if (total < 3600) return `${Math.round(total / 60)} 分钟`;
  if (total < 86400) return total % 3600 === 0 ? `${total / 3600} 小时` : `${Math.floor(total / 3600)} 小时 ${Math.round((total % 3600) / 60)} 分钟`;
  return total % 86400 === 0 ? `${total / 86400} 天` : `${Math.round((total / 86400) * 10) / 10} 天`;
}

/** 查询串解析（大小写不敏感；同键多条取第一条）。 */
function queryParams(url) {
  const text = str(url);
  const index = text.indexOf('?');
  if (index < 0) return new Map();
  const params = new Map();
  text.slice(index + 1).split('&').forEach(pair => {
    const [rawKey, ...rest] = pair.split('=');
    const key = decodeURIComponent(str(rawKey)).toLowerCase();
    if (!key || params.has(key)) return;
    const value = rest.join('=');
    try { params.set(key, decodeURIComponent(value)); } catch { params.set(key, value); }
  });
  return params;
}

/** 地址里的签名参数（没有返回空串）。 */
export function videoSignedUrlSignature(url) {
  const params = queryParams(url);
  const found = VIDEO_SIGNED_URL_SIGNATURE_PARAMS.find(name => str(params.get(name)));
  return found ? str(params.get(found)) : '';
}

/**
 * 地址里的有效期（毫秒时间戳；认不出返回 0）。
 * 支持三种写法：
 *  - 绝对秒（`expires=1760000000` / `token_expires`）；
 *  - 相对秒（`X-Amz-Expires=3600`，起点是 `X-Amz-Date`，没有就按 `now`）；
 *  - ISO 串（`expires=2026-10-12T12:00:00Z`）。
 */
export function videoSignedUrlExpiresAt(url, now = null) {
  const params = queryParams(url);
  const base = now === null || now === undefined
    ? Date.now()
    : (now instanceof Date ? now.getTime() : (Number.isFinite(Number(now)) ? Number(now) : Date.parse(str(now)) || Date.now()));
  const relative = str(params.get('x-amz-expires'));
  if (relative) {
    const dateText = str(params.get('x-amz-date'));
    const parsedDate = dateText ? Date.parse(dateText.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')) : NaN;
    const start = Number.isFinite(parsedDate) ? parsedDate : base;
    return start + Math.max(0, num(relative)) * 1000;
  }
  const name = VIDEO_SIGNED_URL_EXPIRY_PARAMS.find(key => str(params.get(key)));
  if (!name) return 0;
  const value = str(params.get(name));
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    // 十位以上当绝对秒（2020 年之后的时间戳都 ≥ 1e9），否则当相对秒。
    return seconds >= 1e9 ? seconds * 1000 : base + seconds * 1000;
  }
  // 紧凑 ISO（`20261220T000000Z`，URL 里常见的一种写法）：先补成标准 ISO 再解析。
  const compact = value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
  const parsed = Date.parse(compact);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 签名 TTL 策略（唯一真源）：默认 1 小时，**且不超过分享有效期**（分享 30 天 → 仍然 1 小时；
 * 分享有效期被配成 1 天以下时才把签名 TTL 压下去）。返回各字段同形状，面板直接渲染。
 */
export function videoSignedUrlPolicy({ shareValidDays = SHARE_TOKEN_DEFAULT_VALID_DAYS, ttlSeconds = VIDEO_SIGNED_URL_DEFAULT_TTL_SECONDS } = {}) {
  const days = normalizeShareTokenValidDays(shareValidDays);
  const shareSeconds = days * 24 * 60 * 60;
  const requested = Math.max(1, Math.trunc(num(ttlSeconds)) || VIDEO_SIGNED_URL_DEFAULT_TTL_SECONDS);
  const ttl = Math.min(requested, shareSeconds);
  return {
    shareValidDays: days,
    shareSeconds,
    shareText: videoSignedUrlDurationText(shareSeconds),
    requestedTtlSeconds: requested,
    ttlSeconds: ttl,
    ttlText: videoSignedUrlDurationText(ttl),
    capped: requested > shareSeconds,
    note: VIDEO_SIGNED_URL_NOTE,
    text: `签名有效期 ${videoSignedUrlDurationText(ttl)}（不超过分享有效期 ${videoSignedUrlDurationText(shareSeconds)}）`
  };
}

/**
 * 成片地址的**合规判定**（空串 = 合规）。
 *
 * 判据顺序：地址本身是 https（`videoJobOutputUrlIssue` 是唯一真源）→ 有签名参数 →
 * 有有效期参数 → 未过期 → **有效期不超过分享有效期**。
 * `share` 给 `{validDays, createdAt, expiresAt}`（成片分享令牌的读数）；不给时按默认分享有效期算。
 */
export function videoSignedUrlIssue({ outputUrl = '', now = null, share = null } = {}, ) {
  const url = str(outputUrl);
  const baseIssue = videoJobOutputUrlIssue(url);
  if (baseIssue) return baseIssue;
  const signature = videoSignedUrlSignature(url);
  if (!signature) return '成片地址没有签名参数：成片只能是渲染服务签发的临时 URL（带签名参数与有效期）。';
  const expiresAt = videoSignedUrlExpiresAt(url, now);
  if (!expiresAt) return '成片地址没有有效期参数：没有有效期的地址等于永久公开地址，不接受。';
  const current = now === null || now === undefined
    ? Date.now()
    : (now instanceof Date ? now.getTime() : (Number.isFinite(Number(now)) ? Number(now) : Date.parse(str(now)) || Date.now()));
  if (expiresAt <= current) return `临时地址已过期（${videoSignedUrlTimeText(expiresAt)}）：成片地址到期即失效，请让服务端重新签名。`;
  const context = share && typeof share === 'object' ? share : {};
  // `shareTokenExpiresAt` 返回的是 **ISO 串**（不是时间戳）—— 必须 `Date.parse` 之后再比大小，
  // 否则 `Number.isFinite('2026-11-11T…')` 是 false，这条「不超过分享有效期」会**静默失效**（真踩）。
  const shareExpiresAt = str(context.expiresAt)
    ? Date.parse(str(context.expiresAt))
    : Date.parse(str(shareTokenExpiresAt(str(context.createdAt) || new Date(current).toISOString(), normalizeShareTokenValidDays(context.validDays))));
  if (Number.isFinite(shareExpiresAt) && expiresAt > shareExpiresAt) {
    return `签名有效期（至 ${videoSignedUrlTimeText(expiresAt)}）超过了分享有效期（至 ${videoSignedUrlTimeText(shareExpiresAt)}）：成片地址不能比家长手里的链接活得更久。`;
  }
  return '';
}

/**
 * 成片地址的整份视图（**所有状态同形状**；界面只渲染它）：
 * `{present, url, signed, issue, policy, expiresAt, expiresText, ttlText, rows, note}`。
 * 演示队列上（没有地址）`present:false` + 一句实话，不编地址。
 */
export function videoSignedUrlView({ outputUrl = '', share = null, now = null, shareValidDays = SHARE_TOKEN_DEFAULT_VALID_DAYS } = {}) {
  const url = str(outputUrl);
  const policy = videoSignedUrlPolicy({ shareValidDays: share && typeof share === 'object' && share.validDays ? share.validDays : shareValidDays });
  if (!url) {
    return {
      present: false,
      url: '',
      signed: false,
      issue: '',
      policy,
      expiresAt: 0,
      expiresText: '',
      ttlText: policy.ttlText,
      rows: [
        { id: 'policy', label: '签名有效期上限', value: policy.text },
        { id: 'address', label: '成片地址', value: '（没有）' }
      ],
      note: VIDEO_SIGNED_URL_EMPTY_TEXT
    };
  }
  const issue = videoSignedUrlIssue({ outputUrl: url, now, share });
  const expiresAt = videoSignedUrlExpiresAt(url, now);
  const current = now === null || now === undefined
    ? Date.now()
    : (now instanceof Date ? now.getTime() : (Number.isFinite(Number(now)) ? Number(now) : Date.parse(str(now)) || Date.now()));
  const ttlSeconds = expiresAt ? Math.max(0, Math.round((expiresAt - current) / 1000)) : 0;
  return {
    present: true,
    url,
    signed: !issue,
    issue,
    policy,
    expiresAt,
    expiresText: expiresAt ? videoSignedUrlTimeText(expiresAt) : '',
    ttlText: ttlSeconds ? videoSignedUrlDurationText(ttlSeconds) : '',
    rows: [
      { id: 'policy', label: '签名有效期上限', value: policy.text },
      { id: 'expires', label: '这条地址的有效期', value: expiresAt ? `至 ${videoSignedUrlTimeText(expiresAt)}（剩余 ${videoSignedUrlDurationText(ttlSeconds)}）` : '读不出有效期' },
      { id: 'signed', label: '签名', value: videoSignedUrlSignature(url) ? '带签名参数（由服务端签发）' : '没有签名参数' }
    ],
    note: issue ? `${VIDEO_SIGNED_URL_DENIED_TEXT}（${issue}）` : VIDEO_SIGNED_URL_NOTE
  };
}
