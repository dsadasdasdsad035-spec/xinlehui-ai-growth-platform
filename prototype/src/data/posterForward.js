// 微信文案与转发状态（[海报 US-311b] / FR-344 ~ FR-347）。
//
// 「海报做好了，怎么发给家长」这一块的两件事，规则全在这里（零依赖纯函数 + 常量，可 `node` 直跑断言）：
//
//  ① **微信文案**（AC1）：内容含**学员名与作品名**且**不含任何联系方式**。
//     文案本体由 `posterWechatCopyText()` 唯一产出（五类版式各一句，多作品版式如实报收录幅数 ——
//     没有单一作品名可写，不编一个）；复核由 `posterWechatChecks()` 给出可读结论，
//     「不含联系方式」**复用归档模块那一份禁词表**（`data/archiveShare.js` 的 `archiveWechatContactIssues`），
//     口径不在这里另写一套 —— 两处文案的隐私边界必须一致。
//
//  ② **转发状态**（AC2）：未转发 / 已转发 / 已撤回，**口径与归档模块一致** ——
//     直接调用 `data/shareForward.js` 的 `shareForwardView()`（同一个推导：撤回优先 > 已转发 > 未转发，
//     状态不落库、读的是令牌账上的 `sentAt` / `revokedAt`）。本模块只回答「这一张海报对应哪一条记录」，
//     再把它交给那一支；界面因此不可能出现「档案里显示已转发、弹窗里显示未转发」这种两套口径。
//
// 为什么状态要按**记录**查而不是按海报查：令牌账是按档案记录建的（`data/shareTokens.js`），
// 归档模块的分享链接与这里要发的是**同一份**东西（同一个 `/p/<token>`）。海报只是它的一个呈现面。
//
// 界面上的一次转发 = 复制微信文案（与 US-209 同一条口径：复制成功才算一次转发，渠道「微信」）；
// `posterForwardSendNote()` 把「这次有没有记成转发」如实写出来 —— 还没有分享链接时不谎报「已转发」。

import { archiveWechatContactIssues } from './archiveShare';
import { shareForwardSendNotice, shareForwardView } from './shareForward';

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = (value) => String(value === null || value === undefined ? '' : value).trim();
const count = (value) => {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
};

/** 一次转发用的渠道（与归档模块同一份枚举：`SHARE_FORWARD_CHANNELS` 里的微信）。 */
export const POSTER_FORWARD_CHANNEL = 'wechat';

// ---------------------------------------------------------------------------
// ① 微信文案（含学员名与作品名、不含任何联系方式）
// ---------------------------------------------------------------------------

export const POSTER_WECHAT_COPY_HEADING = '微信文案';
export const POSTER_WECHAT_COPY_LABEL = '复制微信文案';
export const POSTER_WECHAT_COPY_FAILED_TEXT = '复制没有成功：请手动选中上面的文案复制。';
export const POSTER_WECHAT_COPY_EMPTY_TEXT = '还没有可复制的文案：先选一张能出图的模板。';

/** 文案的隐私口径（界面常驻一句；与归档模块同一条边界）。 */
export const POSTER_WECHAT_PRIVACY_NOTE = '文案只含学员名与作品名：不含手机号、微信号、邮箱与链接，联系方式请当面或私聊另发。';

/** 文案复核通过时的一句结论（含作品名的版式与多作品版式各一句）。 */
export const POSTER_WECHAT_OK_NOTE = '文案含学员名与作品名，不含任何联系方式。';
export const POSTER_WECHAT_OK_COLLECTION_NOTE = '文案含学员名（或班级名）与收录范围，不含任何联系方式。';

/** 复制成功的一句回执（字数如实写出来，方便老师判断粘出去的是不是这一份）。 */
export function posterWechatCopyDoneText(value = '') {
  const chars = String(value === null || value === undefined ? '' : value).length;
  return chars ? `微信文案已复制（${chars} 字）：粘贴到微信发给家长即可。` : '微信文案已复制。';
}

/**
 * 这一张海报的「谁 + 哪件作品」：按版式从 plan 里取（取不到的如实为空，不编）。
 * 返回 `{ kind, subject, artwork, artworkCount, artworkRequired, recordId }`：
 *  - `subject` = 学员名（班级版式是班级名）；
 *  - `artwork` = 作品名（**只有单作品与视频封面这两支是一幅作品**，其余是多幅，作品名留空）；
 *  - `artworkCount` = 这张图上收录了几幅作品（多作品版式的文案报它）；
 *  - `artworkRequired` = 文案里**必须**出现作品名的版式（单作品 / 视频封面）—— 复核按它判；
 *  - `recordId` = 这张海报对应的归档记录（转发状态按它查令牌账）。四类版式把它放在三个不同的位置
 *    （阶段 / 长图的 `shareRecordId`、班级的 `share.recordId`、封面的 `artwork.recordId`）——
 *    这里按分支各读各的，界面与断言只看这一个出口，不自己知道「哪一支放在哪儿」。
 */
export function posterForwardNames(plan = null) {
  const value = isPlainObject(plan) ? plan : {};
  const kind = str(value.kind);
  // 四类多作品版式的记录 id 位置不完全一样：先读顶层的 `shareRecordId`，再退回 `share.recordId`。
  const shareRecordId = str(value.shareRecordId) || str(value.share && value.share.recordId);
  if (kind === 'class') {
    return {
      kind,
      subject: str(value.className),
      artwork: '',
      artworkCount: count(value.students && value.students.artworks) || count(value.batch && value.batch.artworks),
      artworkRequired: false,
      recordId: shareRecordId
    };
  }
  if (kind === 'period') {
    return {
      kind,
      subject: str(value.studentName),
      artwork: '',
      artworkCount: count(value.collage && value.collage.count) || count(value.collage && value.collage.total),
      artworkRequired: false,
      recordId: shareRecordId
    };
  }
  if (kind === 'report-long') {
    return {
      kind,
      subject: str(value.studentName),
      artwork: '',
      artworkCount: count(value.works && value.works.count) || count((value.rows || []).length),
      artworkRequired: false,
      recordId: shareRecordId
    };
  }
  if (kind === 'video-cover') {
    return {
      kind,
      subject: str(value.objectName),
      artwork: str(value.artwork && value.artwork.title),
      artworkCount: 1,
      artworkRequired: true,
      recordId: str(value.artwork && value.artwork.recordId) || str(value.video && value.video.recordId)
    };
  }
  // 单作品（默认支）：`recordId` 是这条归档记录，`artworkTitle` 是课次数据里的作品名（FR-313）。
  return {
    kind: 'single',
    subject: str(value.studentName),
    artwork: str(value.artworkTitle),
    artworkCount: 1,
    artworkRequired: true,
    recordId: str(value.recordId) || shareRecordId
  };
}

/**
 * 微信文案本体（**唯一一份**）：含学员名（班级版式是班级名）与作品名，不含任何联系方式 / 链接。
 * 多作品版式写收录幅数（没有单一作品名可写 —— 与 US-101 文件名「作品名或周期」同一条口径）。
 */
export function posterWechatCopyText(names = {}) {
  const value = isPlainObject(names) ? names : {};
  const subject = str(value.subject);
  if (!subject) return '';
  const artwork = str(value.artwork);
  const kind = str(value.kind);
  const total = count(value.artworkCount);
  if (kind === 'class') {
    const parts = [`${subject} 的班级作品墙海报做好了`];
    if (total) parts.push(`本期收录了 ${total} 幅作品`);
    return `${parts.join('，')}。您可以保存图片，也可以转发到班级群里。`;
  }
  if (kind === 'period') {
    const parts = [`${subject} 的阶段成长海报做好了`];
    if (total) parts.push(`本阶段收录 ${total} 幅作品`);
    return `${parts.join('，')}。您可以保存图片，也可以转发给家里人看看。`;
  }
  if (kind === 'report-long') {
    return total
      ? `${subject} 的成长报告长图做好了，从课堂到作品的 ${total} 节课都在里面。您可以保存图片，也可以转发给家里人看看。`
      : `${subject} 的成长报告长图做好了，从课堂到作品的变化都在里面。您可以保存图片，也可以转发给家里人看看。`;
  }
  if (kind === 'video-cover') {
    return artwork
      ? `${subject} 的成长视频封面做好了，封面用的是作品《${artwork}》。您可以保存图片，也可以转发给家里人看看。`
      : `${subject} 的成长视频封面做好了，您可以保存图片，也可以转发给家里人看看。`;
  }
  return artwork
    ? `${subject} 的作品《${artwork}》海报做好了。您可以保存图片，也可以转发给家里人看看。`
    : `${subject} 的作品海报做好了。您可以保存图片，也可以转发给家里人看看。`;
}

/**
 * 文案复核：含主体名 / 含作品名（`artworkRequired` 的版式必含）/ 不含联系方式。
 * 返回 `{ hasSubject, hasArtwork, artworkRequired, contactIssues, ok, note }` ——
 * 界面只渲染 `note`（`ok` 为假时就是第一条可读原因），断言读同一份结构。
 */
export function posterWechatChecks({ text: value = '', subject = '', artwork = '', artworkRequired = false } = {}) {
  const source = String(value === null || value === undefined ? '' : value);
  const name = str(subject);
  const work = str(artwork);
  const contactIssues = archiveWechatContactIssues(source);
  const hasSubject = Boolean(name) && source.includes(name);
  const hasArtwork = Boolean(work) && source.includes(work);
  const requiresArtwork = Boolean(artworkRequired);
  const ok = Boolean(source) && hasSubject && (!requiresArtwork || hasArtwork) && contactIssues.length === 0;
  const note = ok
    ? (requiresArtwork ? POSTER_WECHAT_OK_NOTE : POSTER_WECHAT_OK_COLLECTION_NOTE)
    : (!source
      ? POSTER_WECHAT_COPY_EMPTY_TEXT
      : (!hasSubject
        ? '文案里没有学员名：先确认这张海报归属的学员。'
        : (requiresArtwork && !hasArtwork
          ? '文案里没有作品名：这条记录还没有作品名，先补课次的作品名再转发。'
          : contactIssues[0])));
  return { hasSubject, hasArtwork, artworkRequired: requiresArtwork, contactIssues, ok, note };
}

/**
 * 复核结果的可读三行（界面逐行渲染，`data-poster-forward-check-*` 读数与断言读同一份 ——
 * 界面不自己数「有几句、哪句红」）。`required: false` 的那一行是**如实读数**：
 * 多作品版式没有单一作品名可写，文案报的是收录幅数（US-101 文件名「作品名或周期」同一条口径）。
 */
export function posterWechatCheckRows({ names = {}, checks = {} } = {}) {
  const n = isPlainObject(names) ? names : {};
  const c = isPlainObject(checks) ? checks : {};
  const requiresArtwork = Boolean(c.artworkRequired);
  const issues = Array.isArray(c.contactIssues) ? c.contactIssues : [];
  const total = count(n.artworkCount);
  const subjectLabel = str(n.kind) === 'class' ? '班级名' : '学员名';
  return [
    {
      id: 'subject',
      label: subjectLabel,
      required: true,
      ok: Boolean(c.hasSubject),
      value: str(n.subject) || '未记录',
      detail: c.hasSubject ? `文案里有这一位的主体名（${subjectLabel}）` : `文案里没有${subjectLabel}：先确认这张海报归属的${subjectLabel === '班级名' ? '班级' : '学员'}`
    },
    {
      id: 'artwork',
      label: requiresArtwork ? '作品名' : '收录范围',
      required: requiresArtwork,
      ok: requiresArtwork ? Boolean(c.hasArtwork) : Boolean(c.hasSubject),
      value: requiresArtwork
        ? (str(n.artwork) || '这条记录没有作品名')
        : (total ? `收录 ${total} 幅作品` : '多作品版式：文案报收录范围'),
      detail: requiresArtwork
        ? (c.hasArtwork ? `文案里有作品名（${str(n.artwork)}）` : '文案里没有作品名：先补课次的作品名')
        : '这套版式收录多幅作品：文案写收录幅数，不写单一作品名（那一件作品挑不出来）'
    },
    {
      id: 'contact',
      label: '联系方式',
      required: true,
      ok: issues.length === 0,
      value: issues.length ? `命中 ${issues.length} 处` : '未出现',
      detail: issues.length ? issues[0] : '手机号 / 座机 / 邮箱 / 微信 QQ / 链接都没出现（禁词表与归档模块同一份）'
    }
  ];
}

// ---------------------------------------------------------------------------
// ② 转发状态（口径与归档模块一致：同一支 `shareForwardView`）
// ---------------------------------------------------------------------------

/** 这张海报还没有对应的归档记录时的一句说明（状态仍是「未转发」，只是转发状态没有据可查）。 */
export const POSTER_FORWARD_NO_RECORD_NOTE = '这张海报还没有对应的归档记录：先把这次的课后反馈归档，转发状态才有据可查。';

/** 复制成功之后的一句补充：这一下有没有记成一次转发（没有分享链接时如实说没有）。 */
export const POSTER_FORWARD_NOT_RECORDED_NOTE = '这张海报还没有可用的分享链接，暂时没有记成「已转发」：先到分享面板生成家长分享链接，再复制一次文案就会记上。';

/**
 * 弹窗里的整份「微信文案 + 转发状态」（界面只渲染它的产物）。
 *
 * 入参：`plan`（当前这一张的 plan）+ `tokens`（令牌账）+ 可选的 `now`。
 * 状态、渠道、时间、打开次数、说明句**全部来自 `shareForwardView()`**（归档模块那一支），
 * 本模块只把「哪一条记录」换成这张海报的（`posterForwardNames().recordId`）。
 */
export function posterForwardView({ plan = null, tokens = [], now = null } = {}) {
  const names = posterForwardNames(plan);
  const status = shareForwardView({ tokens, recordId: names.recordId, now });
  const text = posterWechatCopyText(names);
  const checks = posterWechatChecks({
    text,
    subject: names.subject,
    artwork: names.artwork,
    artworkRequired: names.artworkRequired
  });
  const recordMissing = !names.recordId;
  const blocked = recordMissing
    ? POSTER_FORWARD_NO_RECORD_NOTE
    : (checks.ok ? '' : checks.note);
  return {
    ...names,
    text,
    checks,
    ok: Boolean(text) && checks.ok && !recordMissing,
    blocked,
    // 三态读数（与归档模块同形：`state` / `stateLabel` / `sent` / `revoked` / `expired` / `line` / `note`）。
    state: status.state,
    stateLabel: status.stateLabel,
    sent: status.sent,
    revoked: status.revoked,
    expired: status.expired,
    hasToken: status.hasToken,
    tokenText: status.tokenText,
    sentText: status.sentText,
    sentCount: status.sentCount,
    channel: status.channel,
    channelLabel: status.channelLabel,
    openCount: status.openCount,
    openCountText: status.openCountText,
    line: status.line,
    lineDetail: status.lineDetail,
    note: status.note
  };
}

/**
 * 复制成功之后的回执（文案回执 + 「有没有记成一次转发」）：
 *  - `recorded: true` → 沿用归档模块那一句（`shareForwardSendNotice`：渠道 + 第几次）；
 *  - `recorded: false` → 如实写明没有分享链接、状态仍是「未转发」（不谎报）。
 */
export function posterForwardSendNote({ text: value = '', recorded = false, channelLabel = '', count: times = 0 } = {}) {
  const head = posterWechatCopyDoneText(value);
  return recorded
    ? `${head} ${shareForwardSendNotice({ channelLabel, count: times })}`
    : `${head} ${POSTER_FORWARD_NOT_RECORDED_NOTE}`;
}

// ---------------------------------------------------------------------------
// ③ 两条留痕的正文（界面与断言读同一份，别各拼一遍）
// ---------------------------------------------------------------------------

/** 导出那一条留痕的 detail：格式 / 张数 / 文件名 / 尺寸。 */
export function posterExportAuditDetail({ format = '', count: pages = 0, total = 0, filename = '', width = 0, height = 0 } = {}) {
  const parts = [str(format).toUpperCase()];
  const done = count(pages);
  const all = count(total) || done;
  if (done) parts.push(`${done}/${all} 张`);
  if (str(filename)) parts.push(str(filename));
  const w = Math.trunc(Number(width));
  const h = Math.trunc(Number(height));
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) parts.push(`${w}×${h}`);
  return parts.filter(Boolean).join(' · ');
}

/** 转发那一条留痕的 detail：渠道 / 文案字数 / 这次有没有记成一次发送。 */
export function posterCopyAuditDetail({ channelLabel = '', text: value = '', recorded = false } = {}) {
  const parts = [`渠道 ${str(channelLabel) || '微信'}`];
  parts.push(`复制海报微信文案（${String(value === null || value === undefined ? '' : value).length} 字）`);
  parts.push(recorded ? '已记为一次转发' : '还没有分享链接，未记为转发');
  return parts.join(' · ');
}
