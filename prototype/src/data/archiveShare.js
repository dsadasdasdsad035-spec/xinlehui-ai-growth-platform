// 分享二维码 + 分享内容边界的唯一真源（[第四步 US-208b] / F-ARCHIVE-SHARE-01）。
//
// 第四步的「转发给家长」在 US-208a 拿到了链接（`/p/<shareToken>`，可撤回、有有效期）之后，
// 还需要三件事，本模块是这三件事的判据所在（零依赖纯函数 + 常量，可直接 `node` 直跑断言）：
//
//  ① **分享二维码**：把 `/p/<token>` 编成二维码要放进两张图（界面预览 + 老师下载的 PNG）。
//     编码与绘制**复用装裱水印那一支**（`services/qrCode.js` 的编码器 + `services/framing.js` 的
//     二维码画笔 `paintQrMatrixToCanvas`，与「印在孩子作品上的二维码」同一条路径），
//     本模块只定**口径**：纠错等级、画布边长、静区模块数、文件名、说明文字。
//     `shareQrBoxRatio()` 保证「二维码方框 + 四周静区」正好铺满画布 —— 静区不够的二维码
//     识别器会读不稳（PRD 的二维码能力验证口径见 prototype/AGENTS.md）。
//     **没有可用链接时不给码**（`shareQrPayload().ready === false`）：绝不生成一个扫不开的图案。
//
//  ② **微信文案的文案校验**（US-208 第 4 条：含学员名与课次日期，不含联系方式）：
//     文案本体仍由 `data/archiveSummary.js` 的 `archiveWechatCopyText()` 生成（只有一份），
//     本模块给它配一个**可断言的复核口径** —— 学员名在不在、课次日期在不在、
//     有没有混进手机号 / 座机 / 邮箱 / 微信 QQ 之类的联系方式或链接。
//
//  ③ **分享内容边界**（US-208 第 5 条：只包含成品素材与老师确认后的点评）：
//     `archiveSharePayload()` 用**白名单字段现拼**出家长端真正会读的那一份数据
//     （成品素材取 `record.media` 里已持久化的条目、点评只取五维白名单维度），
//     `archiveShareLeaks()` 是配套的复核口径：递归找不该出现的键
//     （原图 / 轨迹 / 提示词 / 记忆文件）与「记录里的轨迹 id 混进了分享数据」。
//     与 `data/archiveMedia.js` 的 `archivePayloadOriginalIssue()` 同一条纪律：
//     **写入侧的正解不是「判断一下」，而是结构上就放不进来**；这里额外给断言一个可读的点名。

import { ARCHIVE_MEDIA_PHOTO_LIMIT, findOriginalMediaPaths, isPersistentMediaUrl, normalizeArchiveMediaList } from './archiveMedia';
import { artworkExportDateText, artworkExportSizeText, sanitizeArtworkExportSegment } from './artworkExport';
import { REVIEW_DIMENSION_NAMES } from './reviewDetailPanel';
import { shareTokenUrl } from './shareTokens';

const text = value => String(value === null || value === undefined ? '' : value).trim();

// ---------------------------------------------------------------------------
// ① 分享二维码
// ---------------------------------------------------------------------------

/** 纠错等级：M（约 15% 冗余，屏幕展示 / 打印 / 拍照场景的常规选择，与装裱水印同一档）。 */
export const ARCHIVE_SHARE_QR_ECC = 'M';

/** 画布边长（界面预览与下载共用一份口径）：640px 足够最长的分享链接（版本 10 = 57 模块 + 静区）。 */
export const ARCHIVE_SHARE_QR_CANVAS_SIZE = 640;

/** 静区（quiet zone）宽度，单位是**模块**：ISO/IEC 18004 要求 ≥ 4，少了识别器会时灵时不灵。 */
export const ARCHIVE_SHARE_QR_QUIET_MODULES = 4;

/** 二维码图片格式（PNG：无损，放大到印刷尺寸也不糊；直接存相册就能发）。 */
export const ARCHIVE_SHARE_QR_FORMAT = 'png';

/** 文件名后缀（`学员名_课次日期_成长档案二维码.png`；空片段不参与拼接）。 */
export const ARCHIVE_SHARE_QR_SUFFIX = '成长档案二维码';

/** 没有可用链接时的说明（下载 / 复制链接两个动作都用它，界面不各写一份）。 */
export const ARCHIVE_SHARE_QR_BLOCKED_NOTE = '先生成家长分享链接，再下载二维码 —— 链接撤回或过期后，二维码会一并失效。';

/** 二维码旁边的常驻说明（撤回 / 过期与二维码的关系，老师要有预期）。 */
export const ARCHIVE_SHARE_QR_INVALID_NOTE = '链接撤回或过期后，这个二维码会同时失效，家长再扫码会看到「该分享已撤回」。';

/** 三个动作的按钮文案与回执（「复制微信文案」那一份在 data/archiveSummary.js，不在这里重复）。 */
export const ARCHIVE_SHARE_COPY_LINK_LABEL = '复制链接';
export const ARCHIVE_SHARE_COPY_LINK_DONE = '分享链接已复制，可以直接粘贴给家长。';
export const ARCHIVE_SHARE_COPY_LINK_FAILED = '复制没有成功：请手动选中上面的链接复制。';
export const ARCHIVE_SHARE_DOWNLOAD_QR_LABEL = '下载二维码';

/** 下载成功的一句回执（文件名与体积都如实写出来，与「保存图片」同一套说法）。 */
export function shareQrDownloadText(filename = '', bytes = 0) {
  const name = text(filename) || `${ARCHIVE_SHARE_QR_SUFFIX}.${ARCHIVE_SHARE_QR_FORMAT}`;
  return `二维码已保存「${name}」（${artworkExportSizeText(bytes)}）到「下载」文件夹，可以直接发到家长群。`;
}

/** 长按保存（iOS / 微信内置浏览器）的一句回执：图就在面板上，不谎报「已下载」。 */
export const ARCHIVE_SHARE_QR_LONG_PRESS_NOTE = '当前浏览器不执行文件下载：长按面板上的二维码图片 → 「保存图片」，即可存到相册。';

/**
 * 分享二维码要编码的内容（`/p/<shareToken>` 的完整地址）。
 * 返回 `{ token, url, ready, reason }`：**没有令牌就没有 URL**，`ready: false` 时调用方不画码。
 */
export function shareQrPayload({ token = '', origin = '' } = {}) {
  const value = text(token);
  const url = value ? shareTokenUrl(value, { origin }) : '';
  return {
    token: value,
    url,
    ready: Boolean(value && url),
    reason: value && url ? '' : ARCHIVE_SHARE_QR_BLOCKED_NOTE
  };
}

/**
 * 二维码方框（不含静区）占画布短边的比例：`modules / (modules + 2 × quiet)`。
 * 于是静区正好落满画布四边 —— 既不多留白（浪费像素），也不少留白（识别不稳）。
 */
export function shareQrBoxRatio(moduleCount, quietModules = ARCHIVE_SHARE_QR_QUIET_MODULES) {
  const modules = Math.round(Number(moduleCount));
  const quiet = Math.max(0, Math.round(Number(quietModules)));
  if (!Number.isFinite(modules) || modules <= 0 || !Number.isFinite(quiet)) return 0.8;
  return modules / (modules + quiet * 2);
}

/** 二维码下方的说明文字（学员名只在这里出现一次；没有学员名时不编造）。 */
export function shareQrCaption(student = '') {
  const name = text(student);
  return name ? `扫码打开 ${name} 的成长档案分享页` : '扫码打开成长档案分享页';
}

/**
 * 二维码文件名：`{学员名}_{课次日期}_成长档案二维码.png`。
 * 空格与非法字符的处理复用「保存图片」那一套（`sanitizeArtworkExportSegment` / 课次日期收敛），
 * 空片段（没选学员 / 没课次日期）不参与拼接 —— 不生成 `__成长档案二维码.png` 这种名字。
 */
export function shareQrFilename({ student = '', lessonDate = '', format = ARCHIVE_SHARE_QR_FORMAT } = {}) {
  const extension = sanitizeArtworkExportSegment(format).toLowerCase() || ARCHIVE_SHARE_QR_FORMAT;
  const segments = [student, artworkExportDateText(lessonDate)].map(sanitizeArtworkExportSegment).filter(Boolean);
  return [...segments, ARCHIVE_SHARE_QR_SUFFIX].join('_') + `.${extension}`;
}

/** 面板上的一句话说明（编码 / 静区 / 绘制同源三件事，别在界面各写一份）。 */
export function shareQrRulesText() {
  return `二维码与装裱水印共用同一套编码与绘制能力：纠错等级 ${ARCHIVE_SHARE_QR_ECC}、四周 ${ARCHIVE_SHARE_QR_QUIET_MODULES} 模块静区、${ARCHIVE_SHARE_QR_FORMAT.toUpperCase()} 输出；链接撤回或过期后二维码一并失效。`;
}

// ---------------------------------------------------------------------------
// ② 微信文案的复核口径（含学员名与课次日期、不含联系方式）
// ---------------------------------------------------------------------------

/**
 * 文案里**不允许出现**的东西（US-208 第 4 条「不含联系方式」的实现点）。
 * 链接也一并禁掉：分享靠二维码与「复制链接」两个显式动作，文案里塞 URL 会绕过
 * 「内容边界」那套白名单（老口径的断言也是「不含联系方式 / URL」）。
 */
export const ARCHIVE_SHARE_WECHAT_FORBIDDEN = [
  { id: 'mobile', label: '手机号', pattern: /(?:^|\D)1[3-9]\d{9}(?:\D|$)/ },
  { id: 'landline', label: '座机号码', pattern: /(?:^|\D)0\d{2,3}-?\d{7,8}(?:\D|$)/ },
  { id: 'email', label: '邮箱地址', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { id: 'im', label: '微信 / QQ 等联系方式', pattern: /(微信号|微信|QQ|qq|钉钉|电话|手机号|联系方式)\s*[:：]?\s*[A-Za-z0-9_-]{3,}/ },
  { id: 'url', label: '链接地址', pattern: /(?:https?:\/\/|www\.)/i }
];

/**
 * 扫一遍文案里有没有联系方式 / 链接，返回可读原因数组（空数组 = 干净）。
 * 判据按**命中哪一类**给，界面与断言读同一份标签。
 */
export function archiveWechatContactIssues(value) {
  const source = String(value ?? '');
  if (!source) return [];
  return ARCHIVE_SHARE_WECHAT_FORBIDDEN
    .filter(rule => rule.pattern.test(source))
    .map(rule => `文案里出现了${rule.label}：分享文案只写学员名、课次日期与「看得到什么」，联系方式请当面或私聊另发。`);
}

/**
 * 微信文案的三项复核（US-208 第 4 条）：含学员名、含课次日期、不含联系方式。
 * 返回 `{ hasStudent, hasLessonDate, contactIssues, ok, note }` —— 界面只渲染 `note`，
 * 断言读同一份结构（`ok` 为假时 `note` 就是第一条可读原因，不给笼统的「请检查文案」）。
 */
export function archiveWechatTextChecks({ text: value = '', student = '', lessonDate = '' } = {}) {
  const source = String(value ?? '');
  const name = text(student);
  const date = text(lessonDate);
  const contactIssues = archiveWechatContactIssues(source);
  const hasStudent = Boolean(name) && source.includes(name);
  const hasLessonDate = Boolean(date) && source.includes(date);
  const ok = Boolean(source) && hasStudent && hasLessonDate && contactIssues.length === 0;
  const note = ok
    ? '文案含学员名与课次日期，不含任何联系方式。'
    : (!source
      ? '还没有可复制的文案：先归档并完成家长授权。'
      : (!hasStudent
        ? '文案里没有学员名：先确认这条档案归属的学员。'
        : (!hasLessonDate
          ? '文案里没有课次日期：先确认课次日期再转发。'
          : contactIssues[0])));
  return { hasStudent, hasLessonDate, contactIssues, ok, note };
}

// ---------------------------------------------------------------------------
// ③ 分享内容边界（只分享成品素材与老师确认后的点评）
// ---------------------------------------------------------------------------

/**
 * 分享内容里**绝不允许出现**的键（`archiveSharePayload` 的白名单之外，这里再兜一道）。
 * 三类点名：原图（`/original/i`）、推理轨迹（`trace`）、内部提示词（`prompt` / `reasoning` /
 * `memory` / `agentfile` / `skill` / `system`）。键名命中即算泄漏 —— 值长什么样都不影响判断。
 */
export const ARCHIVE_SHARE_FORBIDDEN_KEY_PATTERN = /(original|trace|prompt|reasoning|memory|agentfile|agent_file|skill|system)/i;

/** 不分享的三类内容（界面逐行列出，让老师在转发前看得见边界）。 */
export const ARCHIVE_SHARE_EXCLUDED_FIELDS = [
  { id: 'original', label: '原图', note: '原图（originalUrl）永不上传，分享里只有老师确认过的成品素材。' },
  { id: 'trace', label: '推理轨迹', note: '大模型的推理轨迹与提示词工程只留在老师的审计台，不进分享内容。' },
  { id: 'prompt', label: '内部提示词与记忆文件', note: '系统提示词、技能清单、agent.md 与记忆文件属于内部实现，家长端看不到。' }
];

/** 递归找出不该分享的键（与 `findOriginalMediaPaths` 同一个写法：只看键名，不看值）。 */
export function findShareForbiddenPaths(payload, prefix = '') {
  const paths = [];
  if (!payload || typeof payload !== 'object') return paths;
  Object.entries(payload).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (ARCHIVE_SHARE_FORBIDDEN_KEY_PATTERN.test(key)) paths.push(path);
    if (value && typeof value === 'object' && !Array.isArray(value)) paths.push(...findShareForbiddenPaths(value, path));
    else if (Array.isArray(value)) value.forEach((item, index) => paths.push(...findShareForbiddenPaths(item, `${path}[${index}]`)));
  });
  return paths;
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null) || '';
  } catch {
    return '';
  }
}

/**
 * 分享出去的那一份数据（家长分享页 US-210 唯一的读取入口）。
 *
 * **只用白名单字段现拼，绝不 `...record`**：原图地址（`media[].originalUrl` / `artworkUrl`
 * 里的原始素材）、推理轨迹 id（`reviewTraceId`）、模板与提示词（记录里本来就没有）一个都进不来。
 * `url` 是完整分享地址（二维码与「复制链接」编码的就是它，两处同源）。
 */
export function archiveSharePayload({ record = null, token = '', origin = '' } = {}) {
  const source = record && typeof record === 'object' ? record : null;
  const qr = shareQrPayload({ token, origin });
  const media = normalizeArchiveMediaList(source ? source.media : []);
  const shareMediaEntry = item => ({
    kind: item.kind,
    name: item.name,
    url: item.url,
    status: item.status,
    storageKey: item.storageKey,
    // 只有 https 的持久地址在家长设备上真的打得开；本地副本会在分享页显示占位（US-203 的口径）。
    persistent: isPersistentMediaUrl(item.url)
  });
  const artwork = media.filter(item => item.kind === 'artwork').map(shareMediaEntry);
  const photos = media.filter(item => item.kind === 'photo').slice(0, ARCHIVE_MEDIA_PHOTO_LIMIT).map(shareMediaEntry);
  // 点评只取**五维白名单维度**的正文：记录里混进别的键（脏数据 / 将来的新字段）也不会跟着分享出去。
  const reviews = {};
  const sourceReviews = source && source.reviews && typeof source.reviews === 'object' ? source.reviews : {};
  REVIEW_DIMENSION_NAMES.forEach(name => {
    const value = text(sourceReviews[name]);
    if (value) reviews[name] = value;
  });
  const version = Math.trunc(Number(source?.version));
  return {
    kind: 'archive-share',
    version: 1,
    token: qr.token,
    url: qr.url,
    student: text(source?.student),
    studentId: text(source?.studentId),
    className: text(source?.className),
    lessonDate: text(source?.lessonDate) || text(source?.date),
    title: text(source?.title),
    mode: text(source?.mode),
    archivedAt: text(source?.archivedAt),
    recordVersion: Number.isFinite(version) && version > 0 ? version : 1,
    media: { artwork, photos },
    reviews,
    reviewConfirmed: Object.keys(reviews).length > 0
  };
}

/**
 * 分享内容的泄漏复核（断言与界面读数用；写入侧靠白名单，不靠这个函数拦）。
 * 返回 `{ paths, clean, issue }`：
 *  - `paths` = 分享数据里命中的禁字段位置 + 归档记录里的原图字段位置；
 *  - 另外做一次**值级**复核：记录上的推理轨迹 id 不允许出现在分享数据的 JSON 里（id 泄漏即等于轨迹可关联）。
 */
export function archiveShareLeaks({ payload = null, record = null } = {}) {
  const paths = findShareForbiddenPaths(payload);
  findOriginalMediaPaths(record).forEach(path => paths.push(`归档记录.${path}`));
  const traceId = text(record?.reviewTraceId);
  const json = safeJson(payload);
  if (traceId && json.includes(traceId)) paths.push('reviewTraceId（轨迹 id 出现在分享数据里）');
  const issue = paths.length
    ? `分享内容里出现了不该分享的字段（${paths.slice(0, 5).join('、')}）：只分享成品素材与老师确认后的点评。`
    : '';
  return { paths, clean: paths.length === 0, issue };
}

/**
 * 第四步「分享内容边界」面板的整份视图。**所有状态返回同一组字段**（界面无条件渲染它的产物；
 * 缺一个字段就会在渲染期炸成白屏，US-204 真踩过）。
 *
 * 返回 `{ ok, state, rows, excluded, leaks, payload, payloadChars, note }`：
 *  - `rows` = 会被分享的三行（成品素材 / 老师确认后的点评 / 课次信息），每行带 `ok` 与 `blocking`；
 *  - `excluded` = 不会被分享的三类（原图 / 推理轨迹 / 内部提示词），老师一眼能看到边界；
 *  - `ok` = 边界干净（无泄漏）+ 有成品素材 + 有点评 —— 缺素材或缺点评时如实为假并给可读原因。
 */
export function archiveShareBoundaryView({ record = null, review = null, token = '', origin = '' } = {}) {
  const payload = archiveSharePayload({ record, token, origin });
  const leaks = archiveShareLeaks({ payload, record });
  const entries = [...payload.media.artwork, ...payload.media.photos];
  const persistent = entries.filter(item => item.persistent).length;
  const localOnly = entries.length - persistent;
  const missing = entries.filter(item => !item.url).length;
  const reviewDimensions = Object.keys(payload.reviews).length;
  const artworkCountText = `装裱成品图 ${payload.media.artwork.length} 张 · 课堂照片 ${payload.media.photos.length} 张`;
  const artworkRow = {
    id: 'artwork',
    label: '成品素材',
    value: entries.length ? artworkCountText : '还没有成品素材',
    detail: entries.length
      ? `${persistent ? `${persistent} 张已同步到对象存储` : '暂未同步到对象存储'}${localOnly ? ` · ${localOnly} 张仅本地留存` : ''}${missing ? ` · ${missing} 张待补` : ''}`
      : '归档时上传失败或还没接入对象存储，家长端会显示「图片同步中」占位。',
    ok: entries.some(item => Boolean(item.url)),
    blocking: true
  };
  const reviewRow = {
    id: 'reviews',
    label: '老师确认后的点评',
    value: reviewDimensions ? `五维点评 ${reviewDimensions}/${REVIEW_DIMENSION_NAMES.length} 维` : '还没有可分享的点评',
    detail: text(review?.detail) || (reviewDimensions ? '只有老师确认过的正文才会分享出去。' : '回到第三步生成点评并确认后再转发。'),
    ok: reviewDimensions > 0,
    blocking: true
  };
  const lessonRow = {
    id: 'lesson',
    label: '课次信息',
    value: `${payload.student || '未记录学员'} · ${payload.lessonDate || '未记录课次日期'}${payload.title ? ` · 《${payload.title}》` : ''}`,
    detail: payload.token ? `分享令牌关联这条档案（第 ${payload.recordVersion} 版）` : '还没有分享链接',
    ok: Boolean(payload.student && payload.lessonDate && payload.token),
    blocking: false
  };
  const rows = [artworkRow, reviewRow, lessonRow];
  const ok = leaks.clean && artworkRow.ok && reviewRow.ok;
  const note = ok
    ? '已按白名单裁剪：只分享成品素材与老师确认后的点评；原图、推理轨迹与内部提示词都不在其中。'
    : (leaks.issue
      || (!artworkRow.ok ? '这次归档还没有可分享的成品素材：家长端会显示「图片同步中」占位，先重试素材同步。'
        : '点评还没有确认：回到第三步生成五维点评并确认后再转发。'));
  return {
    ok,
    state: ok ? 'ok' : 'warn',
    rows,
    excluded: ARCHIVE_SHARE_EXCLUDED_FIELDS,
    leaks,
    payload,
    payloadChars: safeJson(payload).length,
    note
  };
}
