// 转发状态跟踪（[第四步 US-209] / F-ARCHIVE-SHARE-01）。
//
// US-208 拿到了链接与二维码，但「发过没发过、发的是哪一版、家长看没看」还没有答案。本模块是这四件事的
// **唯一真源**（零依赖纯函数 + 常量，可直接 `node` 直跑断言；令牌本体的规则仍在 `data/shareTokens.js`）：
//
//  ① **状态**：`未转发 / 已转发 / 已撤回` 三态**推导**出来的（记录里没有 `forwardStatus` 字段 ——
//     存了就会与 `sentAt` / `revokedAt` 漂移）。判据（`shareForwardStatus`）：
//     撤回优先（`revokedAt` 一有值 → 已撤回）> 有转发时间（`sentAt` → 已转发）> 未转发。
//  ② **转发四件事**（验收点名的四项）：转发时间 / 渠道（微信 · 复制链接）/ 分享版本 / 打开次数。
//     渠道是**枚举**（`SHARE_FORWARD_CHANNELS`）—— 一次转发记一个渠道 + 第几次发送（`sentCount`），
//     分享版本记的是**发送那一刻**这条档案的版本（`sentVersion`，第 N 版）。
//  ③ **家长打开**：`recordShareOpen` 记 `openCount` / `firstOpenedAt`（首次才算）/ `lastOpenedAt`；
//     家长分享页（US-210 / 本轮的 `/p/<token>` 打开路径）读 `readShareLinkToken(pathname)` 认出这条链接，
//     再由 `applyShareOpen` 落到令牌账上。**打开次数与首次打开时间只由这一条路径写**。
//  ④ **两个动作**：`重新发送`（链接不可用时先重新生成，再按上次的渠道复制一次，并记一次发送）与
//     `撤回分享`（沿用 US-208a 的二次确认，撤回后链接立即失效）。「重新发送该不该先重新生成」这个判断
//     是 `shareForwardResendPlan()` 的产物，界面不自己 if。
//
// 与 `data/archiveResident.js` / `data/archiveShare.js` 同一条纪律：**界面只渲染本模块的产物**，
// `data-share-forward-*` 读数与浏览器断言读同一份；三种状态（未转发 / 已转发 / 已撤回）返回**同形状**的字段
// （US-204 的白屏坑：少给一个字段就会在渲染期炸成白屏，而 `pnpm run build` 全绿）。

import {
  SHARE_LINK_PREFIX,
  SHARE_TOKEN_STATUS,
  formatShareTokenTime,
  normalizeShareTokenRecord,
  shareTokenStatus,
  shareTokensOfRecord
} from './shareTokens';

const text = value => String(value === null || value === undefined ? '' : value).trim();
const count = value => {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
};

// ---------------------------------------------------------------------------
// ① 状态与渠道
// ---------------------------------------------------------------------------

/** 三种转发状态（验收原文的三个词就是标签，`SHARE_FORWARD_STATE_LABELS`）。 */
export const SHARE_FORWARD_STATES = {
  idle: 'idle',
  sent: 'sent',
  revoked: 'revoked'
};

export const SHARE_FORWARD_STATE_LABELS = {
  [SHARE_FORWARD_STATES.idle]: '未转发',
  [SHARE_FORWARD_STATES.sent]: '已转发',
  [SHARE_FORWARD_STATES.revoked]: '已撤回'
};

/**
 * 转发的两个渠道（验收点名：微信 / 复制链接）。
 * `action` 是老师点的那一个动作（复制微信文案 / 复制链接）—— 界面按它分发，不自己映射渠道。
 */
export const SHARE_FORWARD_CHANNELS = [
  { id: 'wechat', label: '微信', action: 'copy-wechat', hint: '复制微信文案后发给家长' },
  { id: 'link', label: '复制链接', action: 'copy-link', hint: '复制分享链接后粘贴给家长' }
];

/** 没记录渠道时的默认渠道（「重新发送」沿用上次的渠道，没有上次就用它）。 */
export const SHARE_FORWARD_CHANNEL_DEFAULT = 'wechat';

/** 渠道收敛：非法 / 空 → 空串（记录里的脏渠道不冒充合法渠道）。 */
export function normalizeShareForwardChannel(value) {
  const id = text(value);
  return SHARE_FORWARD_CHANNELS.some(channel => channel.id === id) ? id : '';
}

/** 渠道中文名（未知渠道给空串 —— 界面显示「未记录渠道」，不编一个）。 */
export function shareForwardChannelLabel(value) {
  const id = normalizeShareForwardChannel(value);
  return (SHARE_FORWARD_CHANNELS.find(channel => channel.id === id) || {}).label || '';
}

/** 渠道对应的动作 id（「重新发送」按它决定复制哪一份内容）。 */
export function shareForwardChannelAction(value) {
  const id = normalizeShareForwardChannel(value) || SHARE_FORWARD_CHANNEL_DEFAULT;
  return (SHARE_FORWARD_CHANNELS.find(channel => channel.id === id) || {}).action || 'copy-wechat';
}

/**
 * 三态判据（**推导，不落库**）：撤回优先 > 已转发 > 未转发。
 * 返回 `{ id, label, sent, revoked, opened }` —— `opened` 是「家长打开过没有」的便捷读数。
 */
export function shareForwardStatus(record) {
  const item = normalizeShareTokenRecord(record);
  const revoked = Boolean(item && item.revokedAt);
  const sent = Boolean(item && item.sentAt);
  const id = revoked
    ? SHARE_FORWARD_STATES.revoked
    : (sent ? SHARE_FORWARD_STATES.sent : SHARE_FORWARD_STATES.idle);
  return {
    id,
    label: SHARE_FORWARD_STATE_LABELS[id],
    sent,
    revoked,
    opened: Boolean(item && item.openCount > 0)
  };
}

// ---------------------------------------------------------------------------
// ② 写入侧：记一次发送 / 记一次打开
// ---------------------------------------------------------------------------

/** 记一次发送（写入侧）：渠道收敛 + 第几次发送自增 + 发送时刻 + 发送时的档案版本。 */
export function recordShareSend(record, { channel, at, by, version } = {}) {
  const item = normalizeShareTokenRecord(record);
  if (!item) return null;
  const options = { channel, at, by, version };
  const sentAt = options.at ? new Date(options.at).toISOString() : new Date().toISOString();
  const sentVersion = Math.trunc(Number(options.version));
  return normalizeShareTokenRecord({
    ...item,
    channel: normalizeShareForwardChannel(options.channel) || item.channel || SHARE_FORWARD_CHANNEL_DEFAULT,
    sentAt,
    sentCount: count(item.sentCount) + 1,
    sentVersion: Number.isFinite(sentVersion) && sentVersion > 0 ? sentVersion : count(item.sentVersion),
    sentBy: text(options.by) || item.sentBy
  });
}

/**
 * 记一次打开（家长分享页唯一写入口）：次数自增；**首次打开时间只写一次**（后续打开不改它）。
 * `first` 在读的时候由调用方比对（写入前 `firstOpenedAt` 为空 = 这次是首次）。
 */
export function recordShareOpen(record, { at } = {}) {
  const item = normalizeShareTokenRecord(record);
  if (!item) return null;
  const openedAt = at ? new Date(at).toISOString() : new Date().toISOString();
  return normalizeShareTokenRecord({
    ...item,
    firstOpenedAt: item.firstOpenedAt || openedAt,
    lastOpenedAt: openedAt,
    openCount: count(item.openCount) + 1
  });
}

/** 用令牌本体在账上换一条（找不到就原样返回；`replace` 在 `data/shareTokens.js` 里）。 */
function replaceByToken(tokens, token, next) {
  const list = (Array.isArray(tokens) ? tokens : []).map(normalizeShareTokenRecord).filter(Boolean);
  const index = list.findIndex(item => item.token === token);
  if (index === -1) return { tokens: list, replaced: false };
  const updated = list.slice();
  updated[index] = next;
  return { tokens: updated, replaced: true };
}

/**
 * 账上记一次发送：`applyShareSend(tokens, token, {channel, at, version})`
 * → `{ tokens, record, changed }`（令牌不存在时 `changed: false`，一个字节都不动）。
 */
export function applyShareSend(tokens, token, input = {}) {
  const wanted = text(token);
  const list = (Array.isArray(tokens) ? tokens : []).map(normalizeShareTokenRecord).filter(Boolean);
  const current = wanted ? list.find(item => item.token === wanted) || null : null;
  if (!current) return { tokens: list, record: null, changed: false };
  const next = recordShareSend(current, input);
  if (!next) return { tokens: list, record: null, changed: false };
  const { tokens: updated } = replaceByToken(list, wanted, next);
  return { tokens: updated, record: next, changed: true };
}

/**
 * 账上记一次打开：`applyShareOpen(tokens, token, {at})`
 * → `{ tokens, record, changed, found, first }`。
 * **`first` = 这一次是不是首次打开**（写入前没有 `firstOpenedAt`）—— 家长页据此说一句不同的话。
 */
export function applyShareOpen(tokens, token, { at } = {}) {
  const wanted = text(token);
  const list = (Array.isArray(tokens) ? tokens : []).map(normalizeShareTokenRecord).filter(Boolean);
  const current = wanted ? list.find(item => item.token === wanted) || null : null;
  if (!current) return { tokens: list, record: null, changed: false, found: false, first: false };
  const first = !current.firstOpenedAt;
  const next = recordShareOpen(current, { at });
  const { tokens: updated } = replaceByToken(list, wanted, next);
  return { tokens: updated, record: next, changed: true, found: true, first };
}

/**
 * 从地址里认出分享链接（`/p/<shareToken>`）：家长分享页与「打开记录」的唯一入口。
 * 只解析前缀与第一段路径，**不做强度校验** —— 链接对不对由查询层（`resolveShareToken`）负责。
 */
export function readShareLinkToken(pathname) {
  const path = text(pathname);
  if (!path || !path.startsWith(SHARE_LINK_PREFIX)) return '';
  return text(path.slice(SHARE_LINK_PREFIX.length).split('/')[0]);
}

// ---------------------------------------------------------------------------
// ③ 老师端视图（第四步的状态块 + 档案列表的那一行，读同一份产物）
// ---------------------------------------------------------------------------

/** 四项读数的顺序真源（第四步的状态块按它逐行渲染）。 */
export const SHARE_FORWARD_ROWS = [
  { id: 'sentAt', label: '转发时间' },
  { id: 'channel', label: '渠道' },
  { id: 'version', label: '分享版本' },
  { id: 'opens', label: '打开次数' }
];

export const SHARE_FORWARD_EMPTY_SENT_TEXT = '还没有转发';
export const SHARE_FORWARD_EMPTY_CHANNEL_TEXT = '未记录渠道';
export const SHARE_FORWARD_NO_OPEN_TEXT = '家长还没有打开过这条分享';

/** 状态块的一句话说明（三种状态各一句，外加「已转发但链接过期」的提醒）。 */
export const SHARE_FORWARD_IDLE_NOTE = '还没有转发给家长：复制微信文案或复制链接后，这里会记下转发时间、渠道与打开次数。';
export const SHARE_FORWARD_SENT_NOTE = '已经转发给家长；家长打开分享页后，这里会记下打开次数与首次打开时间。';
export const SHARE_FORWARD_REVOKED_NOTE = '这条分享已撤回：链接立即失效；要再发一次就点「重新发送」，会生成新的分享链接。';
export const SHARE_FORWARD_EXPIRED_NOTE = '链接已过期：家长再打开会被挡下；要再发一次就点「重新发送」，会生成新的分享链接。';
export const SHARE_FORWARD_BLOCKED_NOTE = '先归档并取得家长查看授权，才能转发给家长。';

/** 两个动作的文案（界面不各写一份）。 */
export const SHARE_FORWARD_RESEND_LABEL = '重新发送';

/** 记一次发送之后的回执（渠道 + 第几次 + 有没有顺带重新生成链接）。 */
export function shareForwardSendNotice({ channelLabel = '', count: times = 0, regenerated = false } = {}) {
  const label = text(channelLabel);
  const parts = ['已记录转发'];
  if (label) parts.push(`渠道 ${label}`);
  if (count(times) > 1) parts.push(`第 ${count(times)} 次发送`);
  if (regenerated) parts.push('并已生成新的分享链接');
  return `${parts.join(' · ')}。`;
}

/** 打开读数的两句话（详情行与档案列表那一行共用一份口径）。 */
export function shareForwardOpenText(record) {
  const item = normalizeShareTokenRecord(record);
  const opens = item ? count(item.openCount) : 0;
  if (!opens) return SHARE_FORWARD_NO_OPEN_TEXT;
  const first = formatShareTokenTime(item.firstOpenedAt);
  return first ? `打开 ${opens} 次 · 首次 ${first}` : `打开 ${opens} 次`;
}

/**
 * 老师端的整份转发状态视图（第四步的状态块与档案列表的行读同一份）。
 *
 * 入参：`tokens`（令牌账）+ `recordId`（这条档案）+ 可选的 `record`（档案本体，读它兜底分享版本）。
 * **三种状态返回同一组字段**（`rows` 也同形状）—— 界面无条件渲染它的产物。
 */
export function shareForwardView({ tokens = [], recordId = '', record = null, now = null } = {}) {
  const history = shareTokensOfRecord(tokens, recordId);
  const shown = history[0] || null;
  const status = shareForwardStatus(shown);
  const tokenStatus = shown ? shareTokenStatus(shown, now) : SHARE_TOKEN_STATUS.invalid;
  const recordVersion = Math.trunc(Number(record && record.version));
  const sentVersion = shown ? (count(shown.sentVersion) || count(shown.version)) : 0;
  const versionLabel = sentVersion > 0
    ? `第 ${sentVersion} 版`
    : (Number.isFinite(recordVersion) && recordVersion > 0 ? `第 ${recordVersion} 版` : '');
  const sentText = shown ? formatShareTokenTime(shown.sentAt) : '';
  const channelLabel = shown ? shareForwardChannelLabel(shown.channel) : '';
  const channelHint = channelLabel
    ? (SHARE_FORWARD_CHANNELS.find(channel => channel.id === normalizeShareForwardChannel(shown.channel)) || {}).hint || ''
    : '';
  const openCount = shown ? count(shown.openCount) : 0;
  const firstOpenedText = shown ? formatShareTokenTime(shown.firstOpenedAt) : '';
  const lastOpenedText = shown ? formatShareTokenTime(shown.lastOpenedAt) : '';
  const expired = tokenStatus === SHARE_TOKEN_STATUS.expired;
  const actions = shown
    ? SHARE_FORWARD_CHANNELS.map(channel => ({
      ...channel,
      count: channel.id === normalizeShareForwardChannel(shown.channel) ? count(shown.sentCount) : 0
    }))
    : SHARE_FORWARD_CHANNELS.map(channel => ({ ...channel, count: 0 }));
  const channelCounts = {};
  actions.forEach(channel => { channelCounts[channel.id] = channel.count; });
  const rows = [
    {
      id: 'sentAt',
      label: '转发时间',
      value: sentText || SHARE_FORWARD_EMPTY_SENT_TEXT,
      detail: status.sent ? `最近一次发送${count(shown.sentCount) > 1 ? `（共 ${count(shown.sentCount)} 次）` : ''}` : '还没有发送记录',
      ok: status.sent
    },
    {
      id: 'channel',
      label: '渠道',
      value: channelLabel || SHARE_FORWARD_EMPTY_CHANNEL_TEXT,
      detail: channelHint || '微信 / 复制链接两个渠道，这里记最近一次用的那一个',
      ok: Boolean(channelLabel)
    },
    {
      id: 'version',
      label: '分享版本',
      value: versionLabel || '—',
      detail: status.sent ? '转发时这条档案的版本' : '这次要分享的版本',
      ok: Boolean(versionLabel)
    },
    {
      id: 'opens',
      label: '打开次数',
      value: `${openCount} 次`,
      detail: firstOpenedText ? `首次打开 ${firstOpenedText}${lastOpenedText && lastOpenedText !== firstOpenedText ? ` · 最近 ${lastOpenedText}` : ''}` : SHARE_FORWARD_NO_OPEN_TEXT,
      ok: openCount > 0
    }
  ];
  const note = status.revoked
    ? SHARE_FORWARD_REVOKED_NOTE
    : (expired
      ? SHARE_FORWARD_EXPIRED_NOTE
      : (status.sent ? SHARE_FORWARD_SENT_NOTE : SHARE_FORWARD_IDLE_NOTE));
  // 档案列表那一行的紧凑读数：状态 + 渠道 + 时间 + 打开次数（四件事都在，缺的如实省略）。
  const lineParts = [status.label];
  if (channelLabel) lineParts.push(channelLabel);
  if (sentText) lineParts.push(sentText);
  lineParts.push(openCount ? `打开 ${openCount} 次` : '未被打开');  return {
    state: status.id,
    stateLabel: status.label,
    sent: status.sent,
    revoked: status.revoked,
    expired,
    hasToken: Boolean(shown),
    tokenText: shown ? shown.token : '',
    historyCount: history.length,
    sentAt: shown ? shown.sentAt : '',
    sentText,
    sentCount: shown ? count(shown.sentCount) : 0,
    channel: shown ? normalizeShareForwardChannel(shown.channel) : '',
    channelLabel,
    channelCounts,
    version: sentVersion || (Number.isFinite(recordVersion) && recordVersion > 0 ? recordVersion : 0),
    versionLabel: versionLabel || '—',
    openCount,
    openCountText: `${openCount} 次`,
    opened: openCount > 0,
    firstOpenedAt: shown ? shown.firstOpenedAt : '',
    firstOpenedText,
    lastOpenedText,
    rows,
    note,
    resendLabel: SHARE_FORWARD_RESEND_LABEL,
    // 列表那一行 / 状态条（第四步不展开也能看到）读的紧凑读数：
    // `line` 是整句，`lineDetail` 是状态之后的细节（界面把状态单独加粗时用）。
    line: lineParts.join(' · '),
    lineDetail: lineParts.slice(1).join(' · ')
  };
}

/**
 * 「重新发送」的执行计划（动作该怎么做只由这里判断，界面不自己 if）：
 *  - `allowed: false` → 原因原样带出来（没归档 / 家长未授权）；
 *  - `regenerate: true` → 当前链接不可用（没有 / 已过期 / 已撤回），**先重新生成再发**；
 *  - `channel` / `action` → 沿用上次的渠道（没有上次就用默认渠道），界面按 `action` 复制对应内容。
 */
export function shareForwardResendPlan({ forward = {}, gate = {}, record = null } = {}) {
  const view = forward && typeof forward === 'object' ? forward : {};
  const gateView = gate && typeof gate === 'object' ? gate : {};
  const channel = normalizeShareForwardChannel(view.channel) || SHARE_FORWARD_CHANNEL_DEFAULT;
  const channelLabel = shareForwardChannelLabel(channel);
  const base = {
    allowed: false,
    channel,
    channelLabel,
    action: shareForwardChannelAction(channel),
    regenerate: false,
    label: SHARE_FORWARD_RESEND_LABEL,
    reason: '',
    note: ''
  };
  if (!record) return { ...base, reason: '先归档再转发给家长。' };
  if (!gateView.allowed) {
    return {
      ...base,
      reason: text(gateView.reason) || SHARE_FORWARD_BLOCKED_NOTE,
      note: text(gateView.note) || SHARE_FORWARD_BLOCKED_NOTE
    };
  }
  const regenerate = Boolean(view.revoked) || Boolean(view.expired) || !view.hasToken;
  return {
    ...base,
    allowed: true,
    regenerate,
    note: regenerate ? '当前分享链接不可用：重新发送会先生成新的分享链接。' : '沿用上一次的渠道，再复制一次可以发送给家长。'
  };
}
