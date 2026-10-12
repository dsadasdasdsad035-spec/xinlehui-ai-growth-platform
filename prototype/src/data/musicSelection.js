// 背景音乐选用与版权闸门（[第四步 US-221] / F-ARCHIVE-MUSIC-02 / FR-294 ~ FR-300）—— 零依赖领域层，
// Node 可直跑断言。这一份是**老师端选音乐**的唯一真源：
//
//  ① **能选的曲目只有一种**：授权已确认（`confirmed`）且未过期（FR-294）。判据不是这里另写的一套
//     `if (status === 'confirmed')`，而是管理端曲库的 `musicTrackAvailability()`（同一份口径）——
//     `pending` / 已到期 / 已停用的曲目在老师端**结构上拿不到**（`selectableMusicTracks` 不返回它们）。
//
//  ② **静音是默认值**（FR-298）：`musicSelectionDefault()` 就是静音，`normalizeMusicSelection` 在
//     缺字段时也落回静音（fail-safe：没记录过就用不上版权有疑的音乐）。于是「成片记录」里永远
//     有一个明确的结论：静音，或某一首曲目 + 它的授权凭证快照。
//
//  ③ **成片记录曲目 id 与授权凭证快照**（FR-295，支持事后举证）：`musicJobMusicFromSelection()`
//     产出的形状（`muted / trackId / title / source / sourceProvider / licenseType / licenseProofUrl /
//     expiresAt / licenseStatus / capturedAt / disposition`）就是写进 `video_jobs.specSnapshot.music`
//     的那一份 —— 管理端曲库的「引用范围」也按 `specSnapshot.music.trackId` 认得它（US-220a 已认这条写法）。
//
//  ④ **混音配置**（FR-299）：1.5 秒淡入 / 2 秒淡出 / 音量归一化收在 `MUSIC_MIX_CONFIG`，
//     `musicMixPlan()` 把它翻译成渲染服务要执行的滤镜串（静音时什么都不做）。将来接渲染服务时
//     读同一份，不另配一套参数。
//
//  ⑤ **授权到期提示与处置**（FR-300）：成片记录里的曲目到期后，界面给验收原文那句提示
//     （`MUSIC_LICENSE_EXPIRED_NOTICE`，全文只此一份），老师选择「更换音乐」或「静音」后写一条
//     处置记录（`musicDispositionRecord`）—— 能写进成片记录时写进去，任务还在队列里就记在
//     这一版的选择上，如实说明它会用在下一版。
//
// 与管理端同一套纪律：视图函数**所有状态返回同形状字段**（US-204 的白屏坑），界面只渲染产物。

import { formatArchiveTime } from './archiveSummary';
import { normalizeLessonDate } from './lessons';
import {
  MUSIC_LICENSE_STATUSES,
  findMusicTrackByKey,
  musicLicenseState,
  musicLicenseStatusLabel,
  musicTrackAvailability,
  musicTrackDisplayName,
  normalizeMusicExpiresAt,
  normalizeMusicTrack,
  sortMusicTracks,
  musicToday
} from './musicTracks';

const str = value => String(value ?? '').trim();
const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// ---------------------------------------------------------------------------
// ⓪ 文案（区块名 / 规则 / 提示 —— 界面与断言读同一份，组件里不抄第二份）
// ---------------------------------------------------------------------------

export const MUSIC_SELECTION_SECTION_TITLE = '背景音乐（授权闸门）';
export const MUSIC_SELECTION_SECTION_DESC = '老师端只出现「已确认授权且未过期」的曲目：待确认或已到期的曲目在这里看不见。默认静音 —— 选一首音乐是一次明确的选择。';

/** 静音这一行的文案（默认值，验收第 3 条）。 */
export const MUSIC_MUTE_ID = 'mute';
export const MUSIC_MUTE_TITLE = '静音（默认）';
export const MUSIC_MUTE_OPTION_TEXT = '静音（默认）：不使用背景音乐，成片输出无音轨或静音轨。';
export const MUSIC_MUTE_NOTE = '静音：不做淡入淡出与音量归一化，成片输出无音轨或静音轨（FR-299 在有音乐时执行）。';

/** 授权到期时的那句提示（验收原文：FR-300）。**只在这一处写**，界面 import 它。 */
export const MUSIC_LICENSE_EXPIRED_NOTICE = '音乐授权已到期，建议更换或静音。';

/**
 * 记录里的曲目**授权被收回 / 停用 / 曲目被删**时的提示（与到期分开说，不把「没到期」说成「已到期」）：
 * 处置动作与到期那条一样是两个（更换音乐 / 静音），所以两句都指向同一条处置路径。
 */
export const MUSIC_RECORD_REVOKED_NOTICE = '记录里的曲目现在不可用（授权被改回待确认 / 已停用 / 曲目已删除）：建议更换或静音，并记录处置结果。';

/**
 * 已有成片记录、这一次的选择与记录不同（换了曲子 / 改成静音）时的那句实话：
 * **成片记录不因再次提交而改写**（举证材料要稳定），新选择用在下一版成片（US-222 的重新生成）。
 */
export const MUSIC_RESUBMIT_KEEPS_RECORD_NOTE = '这条任务已有成片记录：记录里的曲目与授权凭证快照不会被这次提交改写（举证材料要稳定）；这次的选择会用在下一版成片。';

/**
 * 再次进入页面时，记录里的曲目已经不可选（授权失效 / 曲目被删）→ 本片选择**回到默认静音**，
 * 但记录里的证据一个字都不动；界面用这一句说明「为什么现在是静音」。
 */
export const MUSIC_RESTORE_MUTED_NOTE = '记录里的曲目现在不可选，本片已回到默认静音：可以重新选一首，或直接静音成片（处置结果会记进成片记录）。';

/** 处置动作（两个：换一首，或改为静音）。 */
export const MUSIC_DISPOSITION_ACTIONS = {
  switch: { id: 'switch', label: '更换音乐' },
  mute: { id: 'mute', label: '静音' }
};
export const MUSIC_DISPOSITION_ACTION_IDS = Object.keys(MUSIC_DISPOSITION_ACTIONS);
export const MUSIC_DISPOSITION_TITLE = '处置结果';
export const MUSIC_DISPOSITION_NOTE = '授权到期的提示与处置会记在成片记录里（后台据此举证：谁在什么时候改成了什么）。';

/** 成片记录那一块的文案（验收第 2 条：曲目 id 与授权凭证快照）。 */
export const MUSIC_RECORD_TITLE = '成片记录的音乐（授权凭证快照）';
export const MUSIC_RECORD_MISSING_TEXT = '这条任务还没有音乐记录（老任务，或还没提交过任务）。';
export const MUSIC_RECORD_MUTED_TEXT = '静音：这条成片没有使用任何曲目。';

/** 没有可选曲目时的两句（曲库为空 / 全都不可选，两种原因分开说）。 */
export const MUSIC_LIBRARY_EMPTY_TEXT = '音乐库还是空的：管理员在音乐库入库并确认授权后，可选音乐才会出现在这里。';
export const MUSIC_NOTHING_SELECTABLE_TEXT = '音乐库里还没有「已确认授权且未过期」的曲目：先请管理员在音乐库确认授权，或直接静音成片。';

/** 「本片选用」这一行的标签（选中的到底是什么，一眼看到）。 */
export const MUSIC_SELECTION_TITLE = '本片选用';
export const MUSIC_MIX_SECTION_TITLE = '混音配置';
export const MUSIC_MIX_NOTE = '混音由渲染服务执行：音乐淡入 1.5 秒、淡出 2 秒，并做一次音量归一化；静音时这三件都不做。';

// ---------------------------------------------------------------------------
// ① 混音配置（FR-299）：1.5 秒淡入 / 2 秒淡出 / 音量归一化
// ---------------------------------------------------------------------------

/**
 * 混音参数（**唯一真源**）：将来渲染服务执行的那条滤镜链由它拼出来，界面读数也读它。
 * `normalizeFilter` 是 ffmpeg `loudnorm` 的口径（I=-16 LUFS / TP=-1.5 dBTP / LRA=11）。
 */
export const MUSIC_MIX_CONFIG = Object.freeze({
  fadeInSec: 1.5,
  fadeOutSec: 2,
  normalize: true,
  normalizeFilter: 'loudnorm=I=-16:TP=-1.5:LRA=11'
});

const trimNumber = value => String(Math.round(num(value) * 100) / 100);

/**
 * 混音计划：`{ muted, fadeInSec, fadeOutSec, normalize, totalSec, fadeOutStartSec, filter, filterParts, note }`。
 *  - 有音乐：`filter` = `afade=t=in:st=0:d=1.5,afade=t=out:st=<时长−2>:d=2,loudnorm=…`；
 *  - 静音：三个数字都是 0 / false，`filter` 是空串（**不做任何混音处理**，输出无音轨或静音轨）。
 * 所有状态返回同一组字段（静音与有音乐各一行读数都不会少字段）。
 */
export function musicMixPlan({ durationSec = 0, muted = true } = {}) {
  const totalSec = Math.max(0, num(durationSec));
  const { fadeInSec, fadeOutSec, normalize, normalizeFilter } = MUSIC_MIX_CONFIG;
  if (muted) {
    return {
      muted: true,
      fadeInSec: 0,
      fadeOutSec: 0,
      normalize: false,
      totalSec,
      fadeOutStartSec: 0,
      filter: '',
      filterParts: [],
      note: MUSIC_MUTE_NOTE
    };
  }
  const fadeOutStartSec = Math.max(0, totalSec - fadeOutSec);
  const filterParts = [
    `afade=t=in:st=0:d=${trimNumber(fadeInSec)}`,
    `afade=t=out:st=${trimNumber(fadeOutStartSec)}:d=${trimNumber(fadeOutSec)}`
  ];
  if (normalize) filterParts.push(normalizeFilter);
  return {
    muted: false,
    fadeInSec,
    fadeOutSec,
    normalize: Boolean(normalize),
    totalSec,
    fadeOutStartSec,
    filter: filterParts.join(','),
    filterParts,
    note: MUSIC_MIX_NOTE
  };
}

/** 混音读数的行（静音与有音乐各四行，字段同形状）。 */
export function musicMixRows(plan) {
  const mix = plan && typeof plan === 'object' ? plan : musicMixPlan();
  if (mix.muted) {
    return [
      { id: 'muted', label: '音乐轨', value: '静音', detail: MUSIC_MUTE_NOTE },
      { id: 'fadeIn', label: '淡入', value: '不做（静音）', detail: '静音成片没有音乐轨，不做淡入。' },
      { id: 'fadeOut', label: '淡出', value: '不做（静音）', detail: '静音成片没有音乐轨，不做淡出。' },
      { id: 'normalize', label: '音量归一化', value: '不做（静音）', detail: '没有音乐轨就没有可归一化的音量。' }
    ];
  }
  return [
    { id: 'fadeIn', label: '淡入', value: `${mix.fadeInSec} 秒`, detail: `音乐从 0 秒起在 ${mix.fadeInSec} 秒内升到设定音量。` },
    {
      id: 'fadeOut',
      label: '淡出',
      value: `${mix.fadeOutSec} 秒`,
      detail: mix.totalSec > 0
        ? `结尾 ${mix.fadeOutSec} 秒淡出（本条预估时长 ${Math.round(mix.totalSec)} 秒 → 从第 ${trimNumber(mix.fadeOutStartSec)} 秒起）。`
        : `结尾 ${mix.fadeOutSec} 秒淡出（成片时长确定后才有起点）。`
    },
    { id: 'normalize', label: '音量归一化', value: MUSIC_MIX_CONFIG.normalizeFilter, detail: '与其他音轨做一次整体响度归一化，避免不同曲目忽大忽小。' }
  ];
}

// ---------------------------------------------------------------------------
// ② 可选的曲目（FR-294）：只有 confirmed 且未过期
// ---------------------------------------------------------------------------

/**
 * 老师端能看到的曲目（**唯一判据**是管理端的 `musicTrackAvailability()`）：
 * `pending` / 已到期 / 已停用一律不返回 —— 「不可见」是结构性的，不是渲染时判断。
 */
export function selectableMusicTracks(tracks, { today = '' } = {}) {
  return sortMusicTracks(tracks).filter(track => musicTrackAvailability(track, { today }).available);
}

/** 曲库读数：库里一共几首、其中老师端可选几首（`hidden` 只用于断言口径，界面不说名单）。 */
export function musicLibraryCounts(tracks, { today = '' } = {}) {
  const list = sortMusicTracks(tracks);
  const available = list.filter(track => musicTrackAvailability(track, { today }).available);
  return { total: list.length, selectable: available.length, hidden: list.length - available.length };
}

/** 可选的曲目行（界面渲染它；字段一次给全，列表与断言读同一份）。 */
export function musicSelectionRows(tracks, { today = '', selection = null } = {}) {
  const current = normalizeMusicSelection(selection);
  return selectableMusicTracks(tracks, { today }).map(track => {
    const snapshot = musicLicenseSnapshot(track, { today });
    const meta = [
      track.artist || '作者未填',
      track.durationSec ? `${track.durationSec} 秒` : '时长未填',
      track.bpm ? `${track.bpm} BPM` : 'BPM 未填'
    ].join(' · ');
    return {
      trackKey: track.trackKey,
      title: musicTrackDisplayName(track),
      artist: track.artist,
      meta,
      mood: track.mood.join(' / '),
      sourceProvider: track.sourceProvider || '来源平台未填',
      licenseType: snapshot.licenseType || '授权类型未标注',
      expiresAt: snapshot.expiresAt,
      expiresText: snapshot.expiresAt ? `授权至 ${snapshot.expiresAt}` : '未标注到期日',
      licenseStatusLabel: musicLicenseStatusLabel(snapshot.licenseStatus),
      selected: !current.muted && current.trackId === track.trackKey,
      snapshot
    };
  });
}

// ---------------------------------------------------------------------------
// ③ 授权凭证快照与「本片选用」（FR-295）
// ---------------------------------------------------------------------------

/** 授权凭证快照的字段清单（验收点名的四项：标题 / 来源 / 授权类型 / 到期日 + 曲目 id）。 */
export const MUSIC_LICENSE_SNAPSHOT_FIELDS = [
  'trackId', 'title', 'source', 'sourceProvider', 'licenseType', 'licenseProofUrl', 'expiresAt', 'licenseStatus', 'capturedAt'
];

/** 快照归一化：字段一次给全（缺失一路落空串，永不抛错）。 */
export function normalizeMusicLicenseSnapshot(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    trackId: str(source.trackId),
    title: str(source.title),
    source: str(source.source ?? source.sourceUrl),
    sourceProvider: str(source.sourceProvider),
    licenseType: str(source.licenseType),
    licenseProofUrl: str(source.licenseProofUrl),
    expiresAt: normalizeMusicExpiresAt(source.expiresAt),
    licenseStatus: str(source.licenseStatus),
    capturedAt: str(source.capturedAt)
  };
}

/**
 * 由曲目生成授权凭证快照（记录那一刻的生效状态）：`title` 标题 / `source` 来源地址 /
 * `sourceProvider` 来源平台 / `licenseType` 授权类型 / `licenseProofUrl` 凭证 / `expiresAt` 到期日。
 * 到期状态按 `today` 推导 —— 快照里写的是**记录那一刻**的结论，之后到期不影响这份快照的存在。
 */
export function musicLicenseSnapshot(track, { today = '', capturedAt = '' } = {}) {
  const item = normalizeMusicTrack(track);
  const state = musicLicenseState(item, { today });
  return normalizeMusicLicenseSnapshot({
    trackId: item.trackKey,
    title: item.title || musicTrackDisplayName(item),
    source: item.sourceUrl,
    sourceProvider: item.sourceProvider,
    licenseType: item.licenseType,
    licenseProofUrl: item.licenseProofUrl,
    expiresAt: item.licenseExpiresAt,
    licenseStatus: state.status,
    capturedAt
  });
}

/** 快照是否已到期（到期日**当天仍可用**，过了那一天算到期；库里写着 `expired` 也当场算到期）。 */
export function musicSnapshotExpired(snapshot, { today = '' } = {}) {
  const expiresAt = normalizeMusicExpiresAt(snapshot?.expiresAt);
  if (!expiresAt) return str(snapshot?.licenseStatus) === MUSIC_LICENSE_STATUSES.expired;
  const reference = normalizeMusicExpiresAt(today) || musicToday();
  return expiresAt < reference;
}

/** 快照上「到期日」那一句人话。 */
export function musicSnapshotExpiryText(snapshot) {
  const expiresAt = normalizeMusicExpiresAt(snapshot?.expiresAt);
  if (!expiresAt) return '未标注到期日（按授权类型人工确认）';
  return `授权有效期至 ${expiresAt}`;
}

// ---------------------------------------------------------------------------
// ④ 本片的选择（默认静音）
// ---------------------------------------------------------------------------

/** 默认选择 = 静音（FR-298）。 */
export function musicSelectionDefault() {
  return { muted: true, trackId: '', snapshot: null, disposition: null };
}

/** 归一化一条选择：缺字段一律落回静音（`muted` 为 true 时清空曲目与快照，口径只此一处）。 */
export function normalizeMusicSelection(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const requestedMuted = source.muted === undefined ? true : source.muted !== false;
  const snapshot = source.snapshot && typeof source.snapshot === 'object' ? normalizeMusicLicenseSnapshot(source.snapshot) : null;
  const trackId = str(source.trackId) || (snapshot ? snapshot.trackId : '');
  const muted = requestedMuted || !trackId;
  return {
    muted,
    trackId: muted ? '' : trackId,
    snapshot: muted ? null : snapshot,
    disposition: normalizeMusicDisposition(source.disposition)
  };
}

/** 选用某一首（只有可选的曲目才该走到这里；曲目 id 为空时原样返回 —— 不假装选了）。 */
export function musicSelectionWithTrack(selection, track, { today = '', capturedAt = '' } = {}) {
  const current = normalizeMusicSelection(selection);
  const item = normalizeMusicTrack(track);
  if (!item.trackKey) return current;
  return {
    ...current,
    muted: false,
    trackId: item.trackKey,
    snapshot: musicLicenseSnapshot(item, { today, capturedAt })
  };
}

/** 改为静音（保留处置记录）。 */
export function musicSelectionMuted(selection) {
  const current = normalizeMusicSelection(selection);
  return { ...current, muted: true, trackId: '', snapshot: null };
}

/**
 * 由**成片记录里的 music** 反推「本片选用」（换对象 / 重新进入页面时把记录里的选择带回界面）：
 * 记录里是静音就回静音，记录了曲目就连授权凭证快照一起带回；老任务（没有 music）回默认静音。
 *
 * `tracks` 传进来时**再验一次可用性**（推荐传当前曲库）：记录里的曲目现在已经不可选
 * （授权被改回待确认 / 到期 / 停用，或曲目被删）就**不把它带回界面** —— 回到默认静音，
 * 由「到期 / 不可用」提示与两个处置动作引导老师重新决定。否则会出现「界面还带着一首
 * 已经没授权的曲子，老师点一下提交又把它写进新记录」这种绕过闸门的情形。
 */
export function musicSelectionFromJobMusic(music, { tracks = null, today = '' } = {}) {
  const record = normalizeMusicJobMusic(music);
  if (!record) return musicSelectionDefault();
  if (record.muted) return { ...musicSelectionDefault(), disposition: record.disposition };
  if (Array.isArray(tracks)) {
    const available = selectableMusicTracks(tracks, { today }).some(item => item.trackKey === record.trackId);
    if (!available) return { ...musicSelectionDefault(), disposition: record.disposition };
  }
  return {
    muted: false,
    trackId: record.trackId,
    snapshot: normalizeMusicLicenseSnapshot({ ...record }),
    disposition: record.disposition
  };
}

/**
 * 选一首（界面唯一的选曲入口）：`{ ok, selection, issue, row }`。
 * 曲目不在可选清单里（授权未确认 / 已到期 / 已停用 / 不存在）时**不改选择**，给可读原因 ——
 * 界面不许自己从曲库里捞一首就能选上。
 */
export function musicSelectionPick({ selection, tracks = [], trackKey = '', today = '', capturedAt = '' } = {}) {
  const key = str(trackKey);
  const track = selectableMusicTracks(tracks, { today }).find(item => item.trackKey === key) || null;
  if (!track) {
    return {
      ok: false,
      selection: normalizeMusicSelection(selection),
      issue: '这首曲目不在可选清单里（授权未确认 / 已到期 / 已停用）：老师端选不到它。',
      row: null
    };
  }
  const next = musicSelectionWithTrack(selection, track, { today, capturedAt });
  const row = musicSelectionRows(tracks, { today, selection: next }).find(item => item.trackKey === key) || null;
  return { ok: true, selection: next, issue: '', row };
}

/** 处置动作的 id 归一化（认不出的动作一律 null，不编一个「默认处置」）。 */
export function normalizeMusicDispositionAction(value) {
  const id = str(value);
  return MUSIC_DISPOSITION_ACTION_IDS.includes(id) ? id : '';
}

/**
 * 处置记录（FR-300 的「记录处置结果」）：`{ action, actionLabel, trackId, trackTitle, at, atText, by, note }`。
 * 只有两个动作（`switch` / `mute`）；动作认不出时返回 null（调用方不会记一条没有动作的处置）。
 */
export function normalizeMusicDisposition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = normalizeMusicDispositionAction(raw.action);
  if (!action) return null;
  const at = str(raw.at);
  return {
    action,
    actionLabel: MUSIC_DISPOSITION_ACTIONS[action].label,
    trackId: str(raw.trackId),
    trackTitle: str(raw.trackTitle),
    at,
    atText: formatArchiveTime(at),
    by: str(raw.by),
    note: str(raw.note)
  };
}

/** 造一条处置记录（写入侧与断言读同一份）。 */
export function musicDispositionRecord({ action, trackId = '', trackTitle = '', at = '', by = '', note = '' } = {}) {
  return normalizeMusicDisposition({ action, trackId, trackTitle, at, by, note });
}

/** 把处置记录挂在选择上（界面上的「处置结果」一行读它）。 */
export function applyMusicDisposition(selection, disposition) {
  const current = normalizeMusicSelection(selection);
  const record = normalizeMusicDisposition(disposition);
  return { ...current, disposition: record };
}

/** 处置结果的一句话（界面上那行字；`null` 时返回空串 —— 没有处置就不出声）。 */
export function musicDispositionText(disposition) {
  const record = normalizeMusicDisposition(disposition);
  if (!record) return '';
  const target = record.action === MUSIC_DISPOSITION_ACTIONS.mute.id
    ? '已改为静音'
    : `已更换为「${record.trackTitle || record.trackId || '另一首曲目'}」`;
  const when = record.atText ? ` · ${record.atText}` : '';
  const who = record.by ? ` · 操作人 ${record.by}` : '';
  const why = record.note ? ` · ${record.note}` : '';
  return `${record.actionLabel}：${target}${when}${who}${why}`;
}

// ---------------------------------------------------------------------------
// ⑤ 写进成片记录的那一份（`video_jobs.specSnapshot.music`，FR-288 / FR-295）
// ---------------------------------------------------------------------------

/** 成片记录里 music 的字段清单（白名单；白名单之外的键一律丢掉）。 */
export const MUSIC_JOB_MUSIC_FIELDS = [
  'muted', 'trackId', 'title', 'source', 'sourceProvider', 'licenseType', 'licenseProofUrl',
  'expiresAt', 'licenseStatus', 'capturedAt', 'disposition'
];

/**
 * 这次的「本片选用」与已有的成片记录是不是同一个结论（`trackId` 或静音与否变了就算变了）。
 * 界面用它给一句实话：**成片记录不因再次提交而改写**（举证材料要稳定），
 * 换音乐属于「重新生成一版」（US-222）—— 这里只把「这次的选择会用在下一版」说清楚。
 */
export function musicJobMusicDiffers(recorded, submitted) {
  const left = normalizeMusicJobMusic(recorded);
  const right = normalizeMusicJobMusic(submitted);
  if (!left && !right) return false;
  if (!left || !right) return true;
  return left.muted !== right.muted || left.trackId !== right.trackId;
}

/** 归一化成片记录里的 music（不是对象 → null：老记录没有这一项，不假装有）。 */
export function normalizeMusicJobMusic(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const muted = raw.muted !== false && !str(raw.trackId);
  const snapshot = normalizeMusicLicenseSnapshot(raw);
  return {
    muted,
    trackId: muted ? '' : snapshot.trackId,
    title: muted ? '' : snapshot.title,
    source: muted ? '' : snapshot.source,
    sourceProvider: muted ? '' : snapshot.sourceProvider,
    licenseType: muted ? '' : snapshot.licenseType,
    licenseProofUrl: muted ? '' : snapshot.licenseProofUrl,
    expiresAt: muted ? '' : snapshot.expiresAt,
    licenseStatus: muted ? '' : snapshot.licenseStatus,
    capturedAt: str(raw.capturedAt),
    disposition: normalizeMusicDisposition(raw.disposition)
  };
}

/**
 * 由「本片选用」生成成片记录里的 music（提交任务时写进 `specSnapshot`）：
 * 静音 → `{ muted:true, …全空… }`（明确记录「这条成片不用音乐」）；选了曲目 → id + 授权凭证快照。
 */
export function musicJobMusicFromSelection(selection, { today = '', capturedAt = '' } = {}) {
  const current = normalizeMusicSelection(selection);
  if (current.muted || !current.trackId) {
    return normalizeMusicJobMusic({ muted: true, capturedAt, disposition: current.disposition });
  }
  const snapshot = current.snapshot || normalizeMusicLicenseSnapshot({ trackId: current.trackId });
  return normalizeMusicJobMusic({ muted: false, ...snapshot, capturedAt, disposition: current.disposition });
}

/** 成片记录里 music 的读数（**所有状态同形状**；`present:false` 时其余字段给空值，不是少字段）。 */
export function musicRecordedView(music, { today = '' } = {}) {
  const record = normalizeMusicJobMusic(music);
  if (!record) {
    return {
      present: false,
      muted: true,
      trackId: '',
      title: '',
      source: '',
      sourceProvider: '',
      licenseType: '',
      licenseProofUrl: '',
      expiresAt: '',
      licenseStatus: '',
      statusLabel: '',
      capturedAt: '',
      expired: false,
      expiresText: '',
      note: MUSIC_RECORD_MISSING_TEXT,
      notice: '',
      disposition: null,
      rows: [
        { id: 'trackId', label: '曲目 id', value: '未记录' },
        { id: 'title', label: '标题', value: '未记录' },
        { id: 'source', label: '来源', value: '未记录' },
        { id: 'licenseType', label: '授权类型', value: '未记录' },
        { id: 'expiresAt', label: '到期日', value: '未记录' }
      ]
    };
  }
  const expiresText = musicSnapshotExpiryText(record);
  const expired = !record.muted && musicSnapshotExpired(record, { today });
  return {
    present: true,
    muted: record.muted,
    trackId: record.trackId,
    title: record.title,
    source: record.source,
    sourceProvider: record.sourceProvider,
    licenseType: record.licenseType,
    licenseProofUrl: record.licenseProofUrl,
    expiresAt: record.expiresAt,
    licenseStatus: record.licenseStatus,
    statusLabel: record.licenseStatus ? musicLicenseStatusLabel(record.licenseStatus) : '',
    capturedAt: record.capturedAt,
    expired,
    expiresText,
    note: record.muted ? MUSIC_RECORD_MUTED_TEXT : (expired ? MUSIC_LICENSE_EXPIRED_NOTICE : `授权在有效期内（${expiresText}）。`),
    notice: expired ? MUSIC_LICENSE_EXPIRED_NOTICE : '',
    disposition: record.disposition,
    rows: record.muted
      ? [
        { id: 'trackId', label: '曲目 id', value: '静音（未使用曲目）' },
        { id: 'title', label: '标题', value: '静音（未使用曲目）' },
        { id: 'source', label: '来源', value: '—' },
        { id: 'licenseType', label: '授权类型', value: '—' },
        { id: 'expiresAt', label: '到期日', value: '—' }
      ]
      : [
        { id: 'trackId', label: '曲目 id', value: record.trackId || '未记录' },
        { id: 'title', label: '标题', value: record.title || '未记录' },
        { id: 'source', label: '来源', value: record.source || '未记录' },
        { id: 'licenseType', label: '授权类型', value: record.licenseType || '未标注' },
        { id: 'expiresAt', label: '到期日', value: record.expiresAt || '未标注' }
      ]
  };
}

// ---------------------------------------------------------------------------
// ⑥ 整块面板的视图产物（所有状态同形状）
// ---------------------------------------------------------------------------

/**
 * 「背景音乐」面板的视图产物。参数：
 *  - `selection`：本片选用（默认静音；来自面板 state）；
 *  - `tracks`：曲库（`musicTracks` state）；
 *  - `today`：参照日期（默认今天，断言可注入）；
 *  - `jobMusic`：这条任务（jobKey 命中的那条）成片记录里的 music（没有任务 → null）；
 *  - `durationSec`：这条成片的预估时长（混音读数里的淡出起点用它，没有就给 0）；
 *  - `actorName`：处置记录里的操作人（会话里的老师姓名）。
 */
export function musicSelectionView({ selection, tracks = [], today = '', jobMusic = null, durationSec = 0, actorName = '' } = {}) {
  const current = normalizeMusicSelection(selection);
  const counts = musicLibraryCounts(tracks, { today });
  const rows = musicSelectionRows(tracks, { today, selection: current });
  const recorded = musicRecordedView(jobMusic, { today });
  // 记录里的曲目**现在**是什么状态（曲库还在的话）：管理员把授权改回 pending / 标成到期 / 停用，
  // 都算「这条记录用的曲子已经不该再用」的信号；曲目被删也一样。
  const liveTrack = recorded.present && recorded.trackId ? findMusicTrackByKey(tracks, recorded.trackId) : null;
  const liveState = liveTrack ? musicLicenseState(liveTrack, { today }) : null;
  const expired = recorded.present && !recorded.muted
    && (musicSnapshotExpired(recorded, { today }) || (liveState ? liveState.status === MUSIC_LICENSE_STATUSES.expired : false));
  const revoked = recorded.present && !recorded.muted && !expired
    && (!liveTrack || liveState.status === MUSIC_LICENSE_STATUSES.pending || liveTrack.enabled === false);
  const notice = expired ? MUSIC_LICENSE_EXPIRED_NOTICE : (revoked ? MUSIC_RECORD_REVOKED_NOTICE : '');
  // 记录里的曲目已经不可选 → 界面的本片选择回到静音（`musicSelectionFromJobMusic` 的同一口径），
  // 用一句话说清「为什么现在显示静音」（否则老师以为记录被清掉了）。
  const restoreNote = recorded.present && !recorded.muted && current.muted ? MUSIC_RESTORE_MUTED_NOTE : '';
  const mix = musicMixPlan({ durationSec, muted: current.muted });
  const selectedRow = current.muted ? null : (rows.find(row => row.trackKey === current.trackId) || null);
  const selectionTitle = current.muted ? MUSIC_MUTE_TITLE : (selectedRow ? selectedRow.title : (current.snapshot?.title || MUSIC_MUTE_TITLE));
  const selectionNote = current.muted
    ? MUSIC_MUTE_OPTION_TEXT
    : `已选用：${selectionTitle} · ${current.snapshot?.licenseType || '授权类型未标注'} · ${musicSnapshotExpiryText(current.snapshot)}`;
  return {
    sectionTitle: MUSIC_SELECTION_SECTION_TITLE,
    sectionDesc: MUSIC_SELECTION_SECTION_DESC,
    // 本片选用
    muted: current.muted,
    trackId: current.trackId,
    selectionTitle,
    selectionNote,
    selectionSnapshot: current.snapshot,
    // 可选曲目
    rows,
    selectableCount: counts.selectable,
    libraryCount: counts.total,
    empty: rows.length === 0,
    libraryEmpty: counts.total === 0,
    emptyText: counts.total === 0 ? MUSIC_LIBRARY_EMPTY_TEXT : MUSIC_NOTHING_SELECTABLE_TEXT,
    emptyTitle: counts.total === 0 ? '音乐库还是空的' : '没有可选的曲目',
    // 成片记录（授权凭证快照）
    record: recorded,
    recordTitle: MUSIC_RECORD_TITLE,
    recordExpired: expired,
    recordRevoked: revoked,
    // 恢复说明（记录里的曲目已不可选时，本片回到静音的原因）
    restoreNote,
    // 到期 / 不可用提示与处置
    notice,
    noticeVisible: Boolean(notice),
    expiredNotice: expired,
    revokedNotice: revoked,
    disposition: current.disposition || recorded.disposition || null,
    dispositionText: musicDispositionText(current.disposition || recorded.disposition || null),
    dispositionTitle: MUSIC_DISPOSITION_TITLE,
    dispositionNote: MUSIC_DISPOSITION_NOTE,
    dispositionActions: [
      { ...MUSIC_DISPOSITION_ACTIONS.switch, allowed: rows.length > 0, issue: rows.length > 0 ? '' : MUSIC_NOTHING_SELECTABLE_TEXT },
      { ...MUSIC_DISPOSITION_ACTIONS.mute, allowed: true, issue: '' }
    ],
    // 混音配置
    mix,
    mixRows: musicMixRows(mix),
    mixTitle: MUSIC_MIX_SECTION_TITLE,
    mixNote: MUSIC_MIX_NOTE,
    // 处置记录里的操作人（界面不用它做判断，只做展示口径的透传）
    actorName: str(actorName)
  };
}
