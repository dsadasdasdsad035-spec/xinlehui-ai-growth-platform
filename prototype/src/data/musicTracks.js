// 音乐库（`music_tracks`）—— 本地兜底数据 + 领域规则，与云端表保持同样的字段形状。
//
// [第四步 US-220a] 这一份是**音乐库的唯一真源**：曲目的元数据、授权状态（`pending / confirmed /
// expired`）、入库去重键（来源 URL + 文件 hash）与「被多少成片引用过」的判据都收在这里
// （零依赖、Node 可直跑断言），管理端页面只渲染它的产物，云端读写映射在
// `services/musicLibraryApi.js`。
//
// 三条口径值得先记住：
//  ① **新建入库默认 `pending`**（FR-293）：来源不清、授权凭证缺失的音乐一旦混进发给家长的视频，
//     侵权责任由平台承担 —— 所以默认状态必须是「不可用」，由管理员确认授权后才放开。
//     这条闸门收在 `createNewMusicTrack`（无论传什么状态都落 `pending`）；`createEmptyMusicTrack`
//     只做归一化，读历史记录时要原样保留 `confirmed`，两者别混用。
//  ② **老师端只能选 `confirmed` 且未过期的曲目**（FR-294）：`musicTrackAvailability()` 是这条规则的
//     唯一判据（US-221 的版权闸门读同一份），`pending` 曲目在老师端不可见。
//  ③ **授权到期由日期推导**：`license_expires_at` 过了今天即「已到期」，即使库里存的还是 `confirmed`
//     —— 判据只写一次（`musicLicenseState`），界面与断言读同一份。
//  另有「是否可商用」（FR-292 的最后一项）：由管理员如实标注（`commercialUse`），读取结论走
//  `musicTrackCommercialText` —— 授权没确认或已到期时不许声称可商用。
//
// 关于字段命名：应用内一律 camelCase，云端行是 snake_case，映射在 services/musicLibraryApi.js。
// PRD 的 `duration`（秒）在这里叫 `durationSec`（单位写进名字，免得「时长」两个字各人各理解）。
import { DEFAULT_ORG_ID, normalizeLessonDate } from './lessons';

const STORAGE_KEY = 'xinlehui-music-tracks-v1';

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };
const str = value => String(value ?? '').trim();

let trackKeySeq = 0;

/**
 * 新曲目的 `trackKey` 必须**唯一**，不能由标题（或来源 URL + hash）派生：
 * 同名曲目会拿到同一个 id，upsert 静默覆盖前一首，重复入库也永远查不出来。
 * 去重是另一条判据（`musicTrackDuplicateIssue`），两者别混在一起。
 */
export function makeUniqueMusicTrackKey() {
  trackKeySeq += 1;
  return `track-${Date.now().toString(36)}-${trackKeySeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 由来源地址 + hash 确定性派生一个 legacy id（只用于读取没有 trackKey 的旧数据）。 */
export function makeMusicTrackKeyFromSource({ sourceUrl = '', hash = '' } = {}) {
  const seed = `${str(sourceUrl)}|${str(hash)}`.replace(/\|+$/, '');
  return `track-legacy-${seed || 'unknown'}`;
}

// ---------------------------------------------------------------------------
// ⓪ 授权状态（FR-293）与文案
// ---------------------------------------------------------------------------

/** 三个状态（PRD 原文的词就是 id）；新建入库默认 pending。 */
export const MUSIC_LICENSE_STATUSES = {
  pending: 'pending',
  confirmed: 'confirmed',
  expired: 'expired'
};
export const MUSIC_LICENSE_STATUS_IDS = ['pending', 'confirmed', 'expired'];
export const MUSIC_LICENSE_STATUS_DEFAULT = MUSIC_LICENSE_STATUSES.pending;

export const MUSIC_LICENSE_STATUS_LABELS = {
  [MUSIC_LICENSE_STATUSES.pending]: '待确认授权',
  [MUSIC_LICENSE_STATUSES.confirmed]: '已确认授权',
  [MUSIC_LICENSE_STATUSES.expired]: '授权已到期'
};

/** 每个状态一句「现在能不能用」（界面渲染它，不各写一份）。 */
export const MUSIC_LICENSE_STATUS_NOTES = {
  [MUSIC_LICENSE_STATUSES.pending]: '还没有确认授权：老师端看不到它，也不会被任何成片选中。',
  [MUSIC_LICENSE_STATUSES.confirmed]: '授权已确认：未过期的曲目老师端可以选用。',
  [MUSIC_LICENSE_STATUSES.expired]: '授权已到期：不能再被新成片选用，建议更换或静音。'
};

/** 状态归一化：只认三个字面值，其余（含脏值）一律回落 `pending`（fail-safe：不可用）。 */
export function normalizeMusicLicenseStatus(value) {
  const text = str(value);
  return MUSIC_LICENSE_STATUS_IDS.includes(text) ? text : MUSIC_LICENSE_STATUS_DEFAULT;
}

/** 授权状态 → `Status` 组件用的中文标签。 */
export function musicLicenseStatusLabel(value) {
  return MUSIC_LICENSE_STATUS_LABELS[normalizeMusicLicenseStatus(value)] || '';
}

// ---------------------------------------------------------------------------
// ① 元数据归一化（永不抛错）
// ---------------------------------------------------------------------------

/** 时长（秒）：非负整数；缺失或非法一律 0（未知），不凭空编一个 120。 */
export function normalizeMusicDurationSec(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/** BPM：正整数；缺失或非法一律 0（未标注）。 */
export function normalizeMusicBpm(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/** 情绪标签是自由文本的**多标签**：数组、或 `温暖, 安静` / `温暖、安静` 这类字符串都认。 */
export function normalizeMusicMood(value) {
  const raw = Array.isArray(value) ? value : str(value).split(/[,，、;；|/\s]+/);
  const tags = raw.map(item => str(item)).filter(Boolean);
  return [...new Set(tags)];
}

/** 表单里的常用情绪标签备选（自由文本，normalize 不做白名单限制）。 */
export const MUSIC_MOOD_OPTIONS = ['温暖', '明亮', '活泼', '安静', '舒缓', '童趣', '梦幻', '激昂'];

/** 授权类型是自由文本（各曲源说法不一），这里只给表单一份常用备选。 */
export const MUSIC_LICENSE_TYPE_OPTIONS = ['免版税商用授权', '单独购买商用授权', '知识共享许可', '平台自建曲库', '其他（人工确认）'];

/** 常见曲源平台备选（US-220b 接入授权曲源后由服务端返回；这里只是表单提示）。 */
export const MUSIC_SOURCE_PROVIDER_OPTIONS = ['演示曲库', '平台自建曲库'];

/** 授权到期日：统一成 `YYYY-MM-DD`（与课次日期同一套归一化），空串 = 未标注到期日。 */
export function normalizeMusicExpiresAt(value) {
  return normalizeLessonDate(value);
}

/** 文件 hash：只需要「去除空格 + 小写」，不校验算法（服务端入库时算，客户端只做去重比对）。 */
export function normalizeMusicHash(value) {
  return str(value).replace(/\s+/g, '').toLowerCase();
}

/**
 * 「是否可商用」（FR-292 的最后一项）：布尔；缺失或脏值一律 `false`。
 * 与授权状态不同，它不是推导值 —— 有些授权只允许机构内部使用，所以由管理员如实标注。
 */
export function normalizeMusicCommercialUse(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = str(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

/**
 * 曲目构造的统一入口（读取旧数据 / 后台编辑草稿共用）：只做归一化，
 * **不强行改授权状态** —— `normalizeMusicTrack` 读历史记录时要原样保留 `confirmed`。
 * 「新建入库必须是 pending」这条闸门在 `createNewMusicTrack` 里，两者不要混用。
 */
export function createEmptyMusicTrack(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const now = new Date().toISOString();
  return {
    trackKey: str(source.trackKey) || makeUniqueMusicTrackKey(),
    orgId: str(source.orgId ?? source.org_id) || DEFAULT_ORG_ID,
    title: str(source.title ?? source.name),
    artist: str(source.artist ?? source.author),
    durationSec: normalizeMusicDurationSec(source.durationSec ?? source.duration),
    bpm: normalizeMusicBpm(source.bpm),
    mood: normalizeMusicMood(source.mood),
    sourceUrl: str(source.sourceUrl ?? source.source_url),
    sourceProvider: str(source.sourceProvider ?? source.source_provider),
    licenseType: str(source.licenseType ?? source.license_type),
    licenseProofUrl: str(source.licenseProofUrl ?? source.license_proof_url),
    licenseStatus: normalizeMusicLicenseStatus(source.licenseStatus ?? source.license_status),
    licenseExpiresAt: normalizeMusicExpiresAt(source.licenseExpiresAt ?? source.license_expires_at),
    commercialUse: normalizeMusicCommercialUse(source.commercialUse ?? source.commercial_use),
    fileKey: str(source.fileKey ?? source.file_key),
    fileUrl: str(source.fileUrl ?? source.file_url),
    hash: normalizeMusicHash(source.hash),
    enabled: source.enabled !== false,
    createdBy: str(source.createdBy ?? source.created_by),
    timestamps: {
      createdAt: str(source?.timestamps?.createdAt ?? source.createdAt ?? source.created_at ?? now),
      updatedAt: str(source?.timestamps?.updatedAt ?? source.updatedAt ?? source.updated_at ?? now)
    }
  };
}

/**
 * **新建入库**（FR-293 的硬口径）：无论调用方传了什么，`licenseStatus` 一律落成 `pending`。
 * 这是「来源不清、授权凭证缺失的音乐不得进老师端」在结构上的保证 —— 确认授权是入库之后的
 * 独立动作（后台按行改状态），不在这条路径里。
 */
export function createNewMusicTrack(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return createEmptyMusicTrack({ ...source, licenseStatus: MUSIC_LICENSE_STATUS_DEFAULT });
}

/** 全部字段白名单（服务层按它拼云端 payload；白名单之外的键一律丢掉）。 */
export const MUSIC_TRACK_FIELDS = [
  'trackKey', 'orgId', 'title', 'artist', 'durationSec', 'bpm', 'mood',
  'sourceUrl', 'sourceProvider', 'licenseType', 'licenseProofUrl', 'licenseStatus',
  'licenseExpiresAt', 'commercialUse', 'fileKey', 'fileUrl', 'hash', 'enabled', 'createdBy', 'timestamps'
];

/** 把任意来源的曲目数据收敛成规范形状：不报错、不丢数据；缺 trackKey 时按来源派生稳定 id。 */
export function normalizeMusicTrack(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = createEmptyMusicTrack(source);
  return {
    ...base,
    trackKey: str(source.trackKey || source.id || source.track_key)
      || makeMusicTrackKeyFromSource({ sourceUrl: base.sourceUrl, hash: base.hash })
  };
}

/** 兼容读取更新时间戳（规范形状是 timestamps，旧数据可能是平铺字段）。 */
export function musicTrackTimestamp(track, key = 'updatedAt') {
  const stamp = track?.timestamps?.[key];
  if (stamp) return String(stamp);
  return str(track?.[key]);
}

/** 显示名：标题为空时用来源文件名兜底，仍为空才说「未命名曲目」。 */
export const MUSIC_TRACK_UNNAMED_TEXT = '未命名曲目';
export function musicTrackDisplayName(track) {
  const item = normalizeMusicTrack(track);
  if (item.title) return item.title;
  const fromSource = str(item.sourceUrl).split('/').filter(Boolean).pop() || '';
  return fromSource || MUSIC_TRACK_UNNAMED_TEXT;
}

// ---------------------------------------------------------------------------
// ② 授权状态推导与「老师端能不能选」（FR-293 / FR-294）
// ---------------------------------------------------------------------------

/** 今天（`YYYY-MM-DD`）—— 所有「到期了没有」的判断都用它当参照，便于注入测试日期。 */
export function musicToday(now = Date.now()) {
  return normalizeLessonDate(new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()));
}

/**
 * 授权是否已到期：到期日**当天仍可用**，过了那一天的 0 点算到期（与「有效期含当天」的常规口径一致）。
 * 库里已经写着 `expired` 时也当场到期（那是管理员对「已到期」的处置结论）。
 */
export function musicLicenseExpired(track, { today = '' } = {}) {
  const item = normalizeMusicTrack(track);
  if (item.licenseStatus === MUSIC_LICENSE_STATUSES.expired) return true;
  const expiresAt = normalizeMusicExpiresAt(item.licenseExpiresAt);
  if (!expiresAt) return false;
  const reference = normalizeMusicExpiresAt(today) || musicToday();
  return expiresAt < reference;
}

/**
 * 曲目的**生效授权状态**（唯一判据）：`{ status, label, note, expired, confirmed, selectable, reason }`。
 * 三种状态返回同形状字段（US-204 的白屏纪律）。
 */
export function musicLicenseState(track, { today = '' } = {}) {
  const item = normalizeMusicTrack(track);
  const expired = musicLicenseExpired(item, { today });
  const status = expired
    ? MUSIC_LICENSE_STATUSES.expired
    : normalizeMusicLicenseStatus(item.licenseStatus);
  const label = MUSIC_LICENSE_STATUS_LABELS[status] || status;
  const note = MUSIC_LICENSE_STATUS_NOTES[status] || '';
  const expiredByDate = expired && normalizeMusicLicenseStatus(item.licenseStatus) !== MUSIC_LICENSE_STATUSES.expired;
  const expiresAt = normalizeMusicExpiresAt(item.licenseExpiresAt);
  return {
    trackKey: item.trackKey,
    status,
    label,
    note,
    expired,
    expiredByDate,
    expiresAt,
    confirmed: status === MUSIC_LICENSE_STATUSES.confirmed,
    selectable: status === MUSIC_LICENSE_STATUSES.confirmed && item.enabled !== false,
    reason: status === MUSIC_LICENSE_STATUSES.pending
      ? '还没有确认授权'
      : (status === MUSIC_LICENSE_STATUSES.expired ? '授权已到期' : '')
  };
}

/**
 * 老师端能不能选这首曲目（FR-294 的唯一判据，US-221 的版权闸门直接读它）。
 * `{ available, reason, state }` —— 不可用时 `reason` 是可读原因，界面照着说。
 */
export function musicTrackAvailability(track, { today = '' } = {}) {
  const item = normalizeMusicTrack(track);
  const state = musicLicenseState(item, { today });
  if (item.enabled === false) {
    return { available: false, reason: '曲目已停用：老师端不再出现，恢复启用后可再被选用。', state };
  }
  if (state.status === MUSIC_LICENSE_STATUSES.pending) {
    return { available: false, reason: '授权还没确认：老师端看不到它（确认授权后才放开）。', state };
  }
  if (state.status === MUSIC_LICENSE_STATUSES.expired) {
    return { available: false, reason: '授权已到期：不能再被新成片选用，建议更换或静音。', state };
  }
  return { available: true, reason: '', state };
}

// ---------------------------------------------------------------------------
// ③ 入库去重（FR-291）：来源 URL + 文件 hash 相同者不得重复入库
// ---------------------------------------------------------------------------

/** 在库里找同源曲目：`sourceUrl` 与 `hash` **都相同**才算同一条（只给其中一个不算）。 */
export function findMusicTrackBySource(list, { sourceUrl = '', hash = '' } = {}) {
  const url = str(sourceUrl);
  const fingerprint = normalizeMusicHash(hash);
  if (!url || !fingerprint) return null;
  return sortMusicTracks(list).find(item => item.sourceUrl === url && item.hash === fingerprint) || null;
}

/** 重复入库的可读原因（空串 = 可以入库；界面与写入侧读同一份）。 */
export function musicTrackDuplicateIssue(list, candidate) {
  const item = normalizeMusicTrack(candidate);
  const matched = findMusicTrackBySource(list, { sourceUrl: item.sourceUrl, hash: item.hash });
  if (!matched) return '';
  return `来源地址与文件 hash 都相同：库里已经有「${musicTrackDisplayName(matched)}」，同一首曲目不重复入库。`;
}

// ---------------------------------------------------------------------------
// ④ 引用范围：有多少成片引用过该曲目（验收第 3 条）
// ---------------------------------------------------------------------------

/**
 * 从一条成片记录上收集它用过的曲目 id。
 *
 * 成片记录（`video_jobs` / 成片落库）上引用曲目的写法按版本会不一样，这里**一次认全**：
 *  - 规范写法：`record.music.trackId`（US-221 起的成片记录）；
 *  - 历史版本：`record.versions[].music.trackId`（US-222 的重新生成保留历史版本）；
 *  - 服务端快照：`record.specSnapshot.music.trackId`（FR-288 的 specSnapshot 里带音乐）；
 *  - 平铺写法：`record.musicTrackId` / `record.bgmTrackId`。
 * 只认 id，不猜标题（标题会重名，id 不会）。
 */
export function musicTrackReferenceIds(record) {
  const ids = [];
  const collect = value => {
    if (!value) return;
    if (typeof value === 'string' || typeof value === 'number') { ids.push(str(value)); return; }
    if (typeof value !== 'object') return;
    const id = str(value.trackId ?? value.trackKey ?? value.id);
    if (id) ids.push(id);
  };
  const collectRecord = row => {
    if (!row || typeof row !== 'object') return;
    collect(row.music);
    collect(row.bgm);
    collect(row.musicTrackId);
    collect(row.bgmTrackId);
    collect(row?.specSnapshot?.music);
    collect(row?.specSnapshot?.bgm);
  };
  collectRecord(record);
  const versions = Array.isArray(record?.versions) ? record.versions : [];
  versions.forEach(version => collectRecord(version));
  return [...new Set(ids)];
}

/**
 * 引用范围：`{ trackKey, name, count, versionCount, references, referenced }`。
 *  - `count`：引用过它的**成片记录数**（同一任务的多个历史版本只算一条成片）；
 *  - `versionCount`：历史版本引用处数（含当前版本，界面用它说明「含 N 处历史版本」）；
 *  - `references`：逐条读数（成片名 / 版本 / 时间），界面可以列出来。
 */
export function musicTrackUsage(track, { videos = [] } = {}) {
  const id = str(normalizeMusicTrack(track).trackKey);
  const rows = (Array.isArray(videos) ? videos : []).filter(row => row && typeof row === 'object');
  const references = [];
  let versionCount = 0;
  rows.forEach(row => {
    if (!id) return;
    // 当前那一版：只读这条记录本身的字段（`versions` 交给下面单独数，避免重复计数）。
    const ownHit = musicTrackReferenceIds({ ...row, versions: [] }).includes(id);
    const versions = Array.isArray(row.versions) ? row.versions.filter(item => item && typeof item === 'object') : [];
    const hitVersions = versions.filter(version => musicTrackReferenceIds(version).includes(id));
    if (!ownHit && !hitVersions.length) return;
    const versionHits = (ownHit ? 1 : 0) + hitVersions.length;
    versionCount += versionHits;
    references.push({
      id: str(row.jobKey || row.id),
      name: str(row.specSnapshot?.objectName || row.objectName || row.title || row.studentId || row.classId),
      version: Math.max(0, Math.trunc(Number(row.version)) || 0),
      versionHits,
      createdAt: str(row.finishedAt || row.updatedAt || row.createdAt),
      produced: Boolean(str(row.outputUrl))
    });
  });
  return {
    trackKey: id,
    name: musicTrackDisplayName(track),
    count: references.length,
    versionCount,
    references,
    referenced: references.length > 0
  };
}

/** 引用范围的一句话（面板上就显示这句；没有引用时也要明确说「没有」）。 */
export function musicTrackUsageText(track, usage) {
  const info = usage || musicTrackUsage(track);
  if (!info.referenced) return `引用范围：还没有成片引用过「${info.name}」。`;
  const versionNote = info.versionCount > info.count ? `（含 ${info.versionCount} 处历史版本引用）` : '';
  return `引用范围：已有 ${info.count} 条成片引用过「${info.name}」${versionNote}。`;
}

export const MUSIC_TRACK_DELETE_NOTE = '删除后无法恢复；已经产出的成片不受影响（它们各自留了当时的授权凭证快照）。';

/**
 * 删除前的影响提示（验收第 3 条：**必须说清有多少成片引用过它**）。
 * 与装裱模板不同，曲目**允许删除**（PRD 原文「支持编辑曲目元数据、停用、删除；删除前提示…」），
 * 但被引用过时要在提示里点名数量并先建议「停用」这条更温和的路。
 */
export function musicTrackDeleteVerdict(track, usage) {
  const name = musicTrackDisplayName(track);
  const info = usage || musicTrackUsage(track);
  if (info.referenced) {
    const versionNote = info.versionCount > info.count ? `，含 ${info.versionCount} 处历史版本引用` : '';
    return {
      allowed: true,
      message: `「${name}」已被 ${info.count} 条成片引用过${versionNote}。删除后这些成片仍保留当时的授权凭证快照，但曲目本身无法再被新成片选用；如果只是不想再被选到，建议改为「停用」。${MUSIC_TRACK_DELETE_NOTE}`
    };
  }
  return {
    allowed: true,
    message: `「${name}」${musicTrackUsageText(track, info)} ${MUSIC_TRACK_DELETE_NOTE}`
  };
}

// ---------------------------------------------------------------------------
// ⑤ 列表：排序 / 删除 / 合并 / 本机镜像
// ---------------------------------------------------------------------------

/** 排序：先按标题（中文），再按 trackKey（稳定、可断言）。 */
export function sortMusicTracks(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeMusicTrack)
    .sort((a, b) => musicTrackDisplayName(a).localeCompare(musicTrackDisplayName(b), 'zh-Hans-CN')
      || a.trackKey.localeCompare(b.trackKey));
}

export function removeMusicTrack(list, trackKey) {
  const key = str(trackKey);
  return sortMusicTracks(list).filter(item => item.trackKey !== key);
}

/** 合并两份曲目列表：winner 优先（同 trackKey 覆盖 loser）。本机镜像与云端合并读它。 */
export function mergeMusicTracks(winner, loser) {
  const byKey = new Map();
  [...(Array.isArray(loser) ? loser : []), ...(Array.isArray(winner) ? winner : [])].forEach(item => {
    if (!item) return;
    const track = normalizeMusicTrack(item);
    byKey.set(track.trackKey, track);
  });
  return sortMusicTracks([...byKey.values()]);
}

/** 按 trackKey 取一条（找不到 → null）。 */
export function findMusicTrackByKey(list, trackKey) {
  const key = str(trackKey);
  if (!key) return null;
  return sortMusicTracks(list).find(item => item.trackKey === key) || null;
}

/** 列表行读数（界面直接渲染它，不各拼一份；三种状态同形状）。 */
export function musicTrackListRow(track, { today = '' } = {}) {
  const item = normalizeMusicTrack(track);
  const state = musicLicenseState(item, { today });
  const meta = [
    item.artist || '作者未填',
    item.durationSec ? `${item.durationSec} 秒` : '时长未填',
    item.bpm ? `${item.bpm} BPM` : 'BPM 未填'
  ].join(' · ');
  return {
    trackKey: item.trackKey,
    name: musicTrackDisplayName(item),
    title: item.title,
    artist: item.artist,
    meta,
    mood: item.mood.join(' / '),
    sourceProvider: item.sourceProvider || '来源平台未填',
    enabled: item.enabled !== false,
    status: state.status,
    statusLabel: item.enabled === false ? '已停用' : state.label,
    commercialText: musicTrackCommercialText(item, { today }),
    state
  };
}

/**
 * 「是否可商用」的读法（FR-292 的这一列不只是存布尔，还要能一眼看懂当前的生效结论）：
 * 授权没过时不能声称可商用 —— 与 `musicLicenseState` 读同一份状态，不另算一套。
 */
export function musicTrackCommercialText(track, { today = '' } = {}) {
  const item = normalizeMusicTrack(track);
  const state = musicLicenseState(item, { today });
  if (state.status === MUSIC_LICENSE_STATUSES.expired) {
    return item.commercialUse ? '不可再商用（授权已到期）' : '未标注可商用（授权已到期）';
  }
  if (state.status === MUSIC_LICENSE_STATUSES.pending) {
    return item.commercialUse ? '待确认（标注了可商用，授权还没确认）' : '待确认（授权未确认）';
  }
  return item.commercialUse ? '可商用（已确认授权）' : '仅限内部使用（未标注可商用）';
}

/**
 * 保存前的必填校验（空串 = 可以保存）：标题是列表里的身份，不能空着。
 * 管理端页面与写入侧读同一份 —— 与装裱模板的 `framingPresetNameIssue` 同一条纪律。
 */
export function musicTrackSaveIssue(track) {
  const item = normalizeMusicTrack(track);
  if (!item.title) return '请先填写曲目标题（列表与老师端都用它显示这首曲子）。';
  return '';
}

/**
 * 管理端列表一行：`musicTrackListRow` + 引用范围 + 删除结论（三态同形状）。
 * `videos` 是成片记录（`listVideoJobs()` 或成片落库的产物），只读不写。
 */
export function musicTrackAdminRow(track, { today = '', videos = [] } = {}) {
  const base = musicTrackListRow(track, { today });
  const usage = musicTrackUsage(track, { videos });
  return {
    ...base,
    usage,
    usageText: musicTrackUsageText(track, usage),
    deleteVerdict: musicTrackDeleteVerdict(track, usage)
  };
}

/** 管理端列表：排序后的每一行都带上引用范围与删除结论。 */
export function musicLibraryRows(list, { today = '', videos = [] } = {}) {
  const tracks = sortMusicTracks(list);
  const index = musicTrackUsageIndex(videos, tracks);
  return tracks.map(track => {
    const base = musicTrackListRow(track, { today });
    const info = index.get(base.trackKey) || {
      trackKey: base.trackKey, name: base.name, count: 0, versionCount: 0, references: [], referenced: false
    };
    return {
      ...base,
      usage: info,
      usageText: musicTrackUsageText(track, info),
      deleteVerdict: musicTrackDeleteVerdict(track, info)
    };
  });
}

/**
 * 一次遍历把「库里每一首曲目各被多少成片引用」算出来（列表里 N 首 × M 条成片时不要 N 次全表扫）。
 * 判定口径与 `musicTrackUsage` 逐字段一致：**每条成片记录只算一次**（`count`），
 * 「当前版 + 历史版」的命中处数进 `versionCount` —— 同一记录同时命中两处时不许算成两条成片。
 */
export function musicTrackUsageIndex(videos = [], tracks = []) {
  const index = new Map();
  const names = new Map(sortMusicTracks(tracks).map(item => [item.trackKey, musicTrackDisplayName(item)]));
  const bump = (id, reference) => {
    if (!id) return;
    const current = index.get(id) || {
      trackKey: id, name: names.get(id) || '', count: 0, versionCount: 0, references: [], referenced: false
    };
    current.references.push(reference);
    current.count = current.references.length;
    current.versionCount += reference.versionHits;
    current.referenced = true;
    index.set(id, current);
  };
  (Array.isArray(videos) ? videos : []).filter(row => row && typeof row === 'object').forEach(row => {
    const ownIds = musicTrackReferenceIds({ ...row, versions: [] });
    const versions = Array.isArray(row.versions) ? row.versions.filter(item => item && typeof item === 'object') : [];
    // **不去重**：同一首曲目在两个历史版本里各出现一次就是 2 处引用（`versionCount` 数的是「处」）。
    const versionIds = [];
    versions.forEach(version => musicTrackReferenceIds(version).forEach(id => versionIds.push(id)));
    const ids = new Set([...ownIds, ...versionIds]);
    if (!ids.size) return;
    const reference = {
      id: str(row.jobKey || row.id),
      name: str(row.specSnapshot?.objectName || row.objectName || row.title || row.studentId || row.classId),
      version: Math.max(0, Math.trunc(Number(row.version)) || 0),
      created: str(row.finishedAt || row.updatedAt || row.createdAt),
      produced: Boolean(str(row.outputUrl))
    };
    ids.forEach(id => bump(id, {
      ...reference,
      versionHits: (ownIds.includes(id) ? 1 : 0) + versionIds.filter(versionId => versionId === id).length
    }));
  });
  return index;
}

/** 空库时的文案。 */
export const MUSIC_TRACK_EMPTY_TEXT = '音乐库还是空的。入库的曲目默认是「待确认授权」，确认授权后老师端才可选。';

/**
 * 演示数据的来源标注（库里这几首是**本机演示曲目**，授权曲源还没接进来）；
 * 界面渲染它，不各写一份 —— 与「演示数据 · 视频服务未接入」同一条纪律。
 */
export const MUSIC_LIBRARY_DEMO_LABEL = '演示数据 · 授权曲源未接入';

/** 曲库的合规提示（搜索/入库区常驻那句的姊妹句，管理端列表底部也用）。 */
export const MUSIC_LIBRARY_LICENSE_NOTE = '请仅收录可商用授权音乐，并保留授权凭证：来源不清的音乐混进发给家长的视频属于商业使用，侵权责任由平台承担。';

// 演示曲目：覆盖「已确认 / 待确认 / 到期（按日期推导）/ 已到期（显式处置）/ 已停用」五种情形，
// 方便在管理端一眼看到授权状态的分支；来源与文件地址都是保留域名的演示地址。
export const seedMusicTracks = [
  {
    trackKey: 'track-demo-morning-forest',
    orgId: DEFAULT_ORG_ID,
    title: '晨光里的小森林',
    artist: '木野工作室',
    durationSec: 132,
    bpm: 92,
    mood: ['温暖', '安静'],
    sourceUrl: 'https://music.example.com/tracks/morning-forest',
    sourceProvider: '演示曲库',
    licenseType: '免版税商用授权',
    licenseProofUrl: 'https://music.example.com/licenses/morning-forest.pdf',
    licenseStatus: 'confirmed',
    licenseExpiresAt: '2027-06-30',
    commercialUse: true,
    fileKey: 'music/morning-forest.mp3',
    fileUrl: 'https://cdn.example.com/music/morning-forest.mp3',
    hash: 'demo1a2b3c4d5e6f',
    createdBy: '平台管理员',
    timestamps: { createdAt: '2026-08-01T02:00:00.000Z', updatedAt: '2026-08-01T02:00:00.000Z' }
  },
  {
    trackKey: 'track-demo-jump-together',
    orgId: DEFAULT_ORG_ID,
    title: '一起跳起来',
    artist: '阳光童声',
    durationSec: 108,
    bpm: 128,
    mood: ['活泼', '童趣'],
    sourceUrl: 'https://music.example.com/tracks/jump-together',
    sourceProvider: '演示曲库',
    licenseType: '免版税商用授权',
    licenseProofUrl: 'https://music.example.com/licenses/jump-together.pdf',
    licenseStatus: 'confirmed',
    licenseExpiresAt: '2026-12-31',
    commercialUse: true,
    fileKey: 'music/jump-together.mp3',
    fileUrl: 'https://cdn.example.com/music/jump-together.mp3',
    hash: 'demo2b3c4d5e6f70',
    createdBy: '平台管理员',
    timestamps: { createdAt: '2026-08-01T02:00:00.000Z', updatedAt: '2026-08-01T02:00:00.000Z' }
  },
  {
    trackKey: 'track-demo-crayon-plane',
    orgId: DEFAULT_ORG_ID,
    title: '蜡笔与纸飞机',
    artist: '木野工作室',
    durationSec: 146,
    bpm: 84,
    mood: ['童趣', '舒缓'],
    sourceUrl: 'https://music.example.com/tracks/crayon-plane',
    sourceProvider: '演示曲库',
    licenseType: '免版税商用授权',
    licenseProofUrl: '',
    // 新入库的曲目就是长这样：还没人确认过授权（`createNewMusicTrack` 的产物）。
    licenseStatus: 'pending',
    licenseExpiresAt: '',
    commercialUse: false,
    fileKey: 'music/crayon-plane.mp3',
    fileUrl: 'https://cdn.example.com/music/crayon-plane.mp3',
    hash: 'demo3c4d5e6f7081',
    createdBy: '',
    timestamps: { createdAt: '2026-09-20T02:00:00.000Z', updatedAt: '2026-09-20T02:00:00.000Z' }
  },
  {
    trackKey: 'track-demo-little-universe',
    orgId: DEFAULT_ORG_ID,
    title: '小小的宇宙',
    artist: '星野音效',
    durationSec: 155,
    bpm: 76,
    mood: ['梦幻', '舒缓'],
    sourceUrl: 'https://music.example.com/tracks/little-universe',
    sourceProvider: '演示曲库',
    licenseType: '单独购买商用授权',
    licenseProofUrl: 'https://music.example.com/licenses/little-universe.pdf',
    // 库里还写着已确认、也标了可商用，但到期日已经过去了 → `musicLicenseState` 把它读成「已到期」。
    licenseStatus: 'confirmed',
    licenseExpiresAt: '2026-01-31',
    commercialUse: true,
    fileKey: 'music/little-universe.mp3',
    fileUrl: 'https://cdn.example.com/music/little-universe.mp3',
    hash: 'demo4d5e6f708192',
    createdBy: '平台管理员',
    timestamps: { createdAt: '2026-02-10T02:00:00.000Z', updatedAt: '2026-02-10T02:00:00.000Z' }
  },
  {
    trackKey: 'track-demo-quiet-afternoon',
    orgId: DEFAULT_ORG_ID,
    title: '安静的午后',
    artist: '木野工作室',
    durationSec: 168,
    bpm: 70,
    mood: ['安静', '温暖'],
    sourceUrl: 'https://music.example.com/tracks/quiet-afternoon',
    sourceProvider: '演示曲库',
    licenseType: '知识共享许可',
    licenseProofUrl: 'https://music.example.com/licenses/quiet-afternoon.pdf',
    licenseStatus: 'expired',
    licenseExpiresAt: '2026-03-31',
    commercialUse: false,
    fileKey: 'music/quiet-afternoon.mp3',
    fileUrl: 'https://cdn.example.com/music/quiet-afternoon.mp3',
    hash: 'demo5e6f708192a3',
    // 已停用：授权到期后的处置结论是「停用」，老师端不再出现。
    enabled: false,
    createdBy: '平台管理员',
    timestamps: { createdAt: '2026-01-05T02:00:00.000Z', updatedAt: '2026-04-01T02:00:00.000Z' }
  }
].map(normalizeMusicTrack);

/**
 * 读取曲库：没有镜像（首次上线 / 手动清空过镜像键）才用演示曲目；
 * **镜像存在但为空数组时返回空库** —— 否则「删掉最后一首再刷新」会把它复活
 * （与 `courses` 的「空即种子」口径不同，这里删除是验收点，故按镜像存在与否分叉）。
 */
export function loadMusicTracks() {
  if (typeof window === 'undefined') return sortMusicTracks(seedMusicTracks);
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return sortMusicTracks(seedMusicTracks);
  const saved = safeParse(raw, null);
  if (!Array.isArray(saved)) return sortMusicTracks(seedMusicTracks);
  return sortMusicTracks(saved);
}

export function persistMusicTracks(list) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sortMusicTracks(list))); } catch { /* 配额满时静默降级，云端仍是真源 */ }
}

/** 本机镜像里有没有存过曲库（`null` = 没存过；空数组算存过）。 */
export function musicLibraryMirrorStored() {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(STORAGE_KEY) !== null; } catch { return false; }
}
