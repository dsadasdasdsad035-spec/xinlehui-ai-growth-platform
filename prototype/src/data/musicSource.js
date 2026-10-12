// 授权曲源的**接口契约与规则**（[第四步 US-220b] / FR-289 ~ FR-297 的「搜索与下载入库」那一段）。
//
// 这一份是**零依赖领域层**（Node 可直跑断言），只写规则与文案；网络动作在
// `services/musicSourceApi.js`（可注入 `fetchImpl`），界面在 `admin/MusicLibraryPage.jsx`。
//
// 三条口径值得先记住：
//  ① **未配置授权曲源时只说实话、不返回假数据**：平台还没选定已签约的曲源（PRD Q10 是阻塞项），
//     此时搜索**抛错**并给出验收原文那句 `MUSIC_SOURCE_UNCONFIGURED_TEXT`（含「未配置授权曲源」），
//     界面把结果列表清空 —— 整个模块里**不存在**演示 / 假搜索结果这个结构（没有任何种子结果导出）。
//  ② **搜索入口与过滤条件是真的**：关键词 / 情绪 / 时长 / BPM 四个过滤条件在这里归一化并拼成查询串，
//     服务层照它发请求；条件非法（上低于下限）在发请求**之前**就被拦下。
//  ③ **下载入库按契约走，转码与去重是服务端的 TODO**：`MUSIC_SOURCE_IMPORT_STEPS` 写明服务端要做的
//     四步（抓取 → 探测格式 → 转码 mp3 128kbps → 计算 hash 去重），后两步标 `todo:true`；
//     下载失败的可读原因（防盗链 / 超时 / 格式不支持，FR-297）由服务端的失败码翻译而来 ——
//     客户端**不凭空编一个原因**（认不出的码就说「没有给出可识别的原因」）。
//
// 关于字段命名：应用内一律 camelCase；曲源的行里可能是 snake_case，读取时两种都认
// （`normalizeMusicSourceResult` 同时吃 `source_url` 这类写法），写出去的一律 camelCase。
import {
  normalizeMusicBpm,
  normalizeMusicDurationSec,
  normalizeMusicMood,
  normalizeMusicTrack
} from './musicTracks';

const str = value => String(value ?? '').trim();
const int = value => {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) ? num : 0;
};
const isHttpUrl = value => /^https?:\/\//i.test(str(value));

// ---------------------------------------------------------------------------
// ⓪ 曲源的配置状态与「唯一那句话」
// ---------------------------------------------------------------------------

/**
 * 「未配置授权曲源」时**唯一**那句话（验收原文点名「未配置授权曲源」）。
 * 服务层在「路由没接 / 连不上 / 服务端声明未配置」三种情形下都抛以它开头的错误，
 * 界面（管理端搜索面板）直接显示 `error.message` —— 组件里不许再写第二份。
 */
export const MUSIC_SOURCE_UNCONFIGURED_TEXT =
  '未配置授权曲源：平台还没有接入已签约的授权曲源，搜索与下载入库暂不可用；这里不返回演示或虚假的搜索结果（选定曲源并配置好之后才会有结果）。';

/** 统一的可读文案：`detail` 说清「为什么」（路由没接 / 连不上 / 服务端声明），消息仍以验收原文开头。 */
export function musicSourceUnconfiguredText(detail = '') {
  const extra = str(detail);
  return extra ? `${MUSIC_SOURCE_UNCONFIGURED_TEXT}（${extra}）` : MUSIC_SOURCE_UNCONFIGURED_TEXT;
}

/**
 * 接口未接入的如实标注（与「演示数据 · 授权曲源未接入」同一纪律，但这一块连演示数据都没有：
 * 搜索走的是真接口契约，只是曲源本身还没配）。
 */
export const MUSIC_SOURCE_UNCONNECTED_LABEL = '接口契约 · 授权曲源未接入';

/**
 * 搜索框下方**常驻**的版权提示（FR-296 的验收原文，一个字都不能改）。
 * 已入库的曲目如果带的是「来源不清的音乐」，责任就在平台 —— 这句提示必须始终在搜索框下方。
 */
export const MUSIC_SOURCE_COPYRIGHT_NOTE = '请仅下载可商用授权音乐，并保留授权凭证';

// ---------------------------------------------------------------------------
// ① 路由表与 HTTP 状态的含义（契约的一部分）
// ---------------------------------------------------------------------------

/**
 * 授权曲源的**路由表**（唯一真源）：`services/musicSourceApi.js` 按它发请求。
 * 接口语义（服务端实现时照这份写）：
 *  - 能力探测 `GET /api/music/source` → `{ configured, provider, note, transcode, dedupe }`；
 *  - 搜索 `GET /api/music/source/search?...` → `{ configured:true, tracks:[...] }`，
 *    未配置时**可以**回 `{ configured:false, tracks:[], note }`（客户端照样读成未配置）；
 *  - 下载入库 `POST /api/music/source/tracks` → 成功回 `{ track }`（或曲目对象本身，必带
 *    `trackKey / title / sourceUrl / fileKey / fileUrl / hash`），失败回非 2xx + `{ error: { code, message } }`，
 *    其中 `code` 取 `MUSIC_SOURCE_IMPORT_FAILURES` 里的三个之一（防盗链 / 超时 / 格式不支持）。
 */
export const MUSIC_SOURCE_ROUTES = {
  capability: { id: 'capability', method: 'GET', path: '/api/music/source', note: '能力探测：授权曲源配没配、转码与去重做没做' },
  search: { id: 'search', method: 'GET', path: '/api/music/source/search', note: '搜索授权曲源（关键词 / 情绪 / 时长 / BPM）' },
  import: { id: 'import', method: 'POST', path: '/api/music/source/tracks', note: '下载入库一条曲目（服务端抓取 → 转码 → 去重）' }
};
export const MUSIC_SOURCE_ROUTE_IDS = Object.keys(MUSIC_SOURCE_ROUTES);

/**
 * HTTP 状态 → 契约层的结论（**唯一真源**，与视频服务同一套纪律：一个状态只有一个含义）：
 *  - `ok`：200 / 201 / 202 —— 响应体是能力声明 / 搜索结果 / 入库结果；
 *  - `unconfigured`：0（连不上）与 404 / 405 / 501（路由没接或服务端明确说未实现）
 *    —— 一律读成「未配置授权曲源」（当前这个阶段，这两者对平台来说是同一件事）；
 *  - `rejected`：其余（400 / 403 / 409 / 415 / 500 / 502 / 503 / 504…）—— 服务在，
 *    但拒绝了这次请求；下载入库的失败码（防盗链 / 超时 / 格式不支持）走这一支，原因由响应体给出。
 */
export function musicSourceStatusVerdict(status) {
  const code = int(status);
  if (code === 200 || code === 201 || code === 202) return 'ok';
  if (code === 0 || code === 404 || code === 405 || code === 501) return 'unconfigured';
  return 'rejected';
}

// ---------------------------------------------------------------------------
// ② 搜索入口与过滤条件（关键词 / 情绪 / 时长 / BPM）
// ---------------------------------------------------------------------------

/** 四个过滤条件的字段名（表单、查询串、断言读同一份）。 */
export const MUSIC_SOURCE_FILTER_FIELDS = ['keyword', 'mood', 'durationMin', 'durationMax', 'bpmMin', 'bpmMax'];

/** 过滤条件归一化：数字字段一律整数（空 / 脏值 → 0 = 不限），关键词与情绪去空白。 */
export function createMusicSourceQuery(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    keyword: str(source.keyword),
    mood: str(source.mood),
    durationMin: normalizeMusicDurationSec(source.durationMin),
    durationMax: normalizeMusicDurationSec(source.durationMax),
    bpmMin: normalizeMusicBpm(source.bpmMin),
    bpmMax: normalizeMusicBpm(source.bpmMax)
  };
}

/** 过滤条件的可读校验（空串 = 可以搜）：下限不能大于上限（发请求前就拦下，不浪费一次往返）。 */
export function musicSourceQueryIssue(query) {
  const item = createMusicSourceQuery(query);
  if (item.durationMin && item.durationMax && item.durationMin > item.durationMax) {
    return `时长下限（${item.durationMin} 秒）不能大于上限（${item.durationMax} 秒）：请先调整过滤条件。`;
  }
  if (item.bpmMin && item.bpmMax && item.bpmMin > item.bpmMax) {
    return `BPM 下限（${item.bpmMin}）不能大于上限（${item.bpmMax}）：请先调整过滤条件。`;
  }
  return '';
}

/** 过滤条件 → 查询串（只带非空条件，固定顺序、逐项编码；空条件返回空串）。 */
export function musicSourceQueryString(query) {
  const item = createMusicSourceQuery(query);
  const pairs = [];
  const push = (key, value) => { if (value) pairs.push(`${key}=${encodeURIComponent(String(value))}`); };
  push('keyword', item.keyword);
  push('mood', item.mood);
  push('durationMin', item.durationMin);
  push('durationMax', item.durationMax);
  push('bpmMin', item.bpmMin);
  push('bpmMax', item.bpmMax);
  return pairs.join('&');
}

/** 过滤条件的一句话（界面与断言读同一份；没有任何条件时也如实说搜的是全部）。 */
export function musicSourceQuerySummary(query) {
  const item = createMusicSourceQuery(query);
  const parts = [];
  if (item.keyword) parts.push(`关键词「${item.keyword}」`);
  if (item.mood) parts.push(`情绪「${item.mood}」`);
  if (item.durationMin || item.durationMax) parts.push(`时长 ${item.durationMin || '不限'}–${item.durationMax || '不限'} 秒`);
  if (item.bpmMin || item.bpmMax) parts.push(`BPM ${item.bpmMin || '不限'}–${item.bpmMax || '不限'}`);
  return parts.length ? `过滤条件：${parts.join(' · ')}。` : '没有设置过滤条件：这次搜的是曲源里的全部曲目。';
}

// ---------------------------------------------------------------------------
// ③ 搜索结果：白名单 + 缺字段就丢掉（不猜元数据）
// ---------------------------------------------------------------------------

/**
 * 搜索结果里认的字段（其余键一律丢掉）。`sourceId` 是曲源那边的 id；`sourceUrl` 是**可抓取的
 * 来源地址**（入库时服务端按它抓取），两者都可能缺 —— 但标题与来源地址缺一条，这条结果就不能入库。
 */
export const MUSIC_SOURCE_RESULT_FIELDS = [
  'sourceId', 'title', 'artist', 'durationSec', 'bpm', 'mood', 'sourceUrl', 'sourceProvider',
  'licenseType', 'licenseProofUrl', 'licenseExpiresAt', 'commercialUse'
];

/** 一条搜索结果能不能用（空串 = 可用）：标题与 http(s) 来源地址是硬要求，缺了就如实丢掉。 */
export function musicSourceResultIssue(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '结果不是一个对象';
  if (!str(raw.title)) return '没有标题';
  const url = str(raw.sourceUrl ?? raw.source_url);
  if (!isHttpUrl(url)) return '没有可抓取的来源地址（http/https）';
  return '';
}

/** 搜索结果归一化：字段白名单 + 与曲库同一套的时长 / BPM / 情绪收敛（脏值永不抛错）。 */
export function normalizeMusicSourceResult(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const result = {
    sourceId: str(source.sourceId ?? source.source_id ?? source.id),
    title: str(source.title ?? source.name),
    artist: str(source.artist ?? source.author),
    durationSec: normalizeMusicDurationSec(source.durationSec ?? source.duration),
    bpm: normalizeMusicBpm(source.bpm),
    mood: normalizeMusicMood(source.mood),
    sourceUrl: str(source.sourceUrl ?? source.source_url),
    sourceProvider: str(source.sourceProvider ?? source.source_provider),
    licenseType: str(source.licenseType ?? source.license_type),
    licenseProofUrl: str(source.licenseProofUrl ?? source.license_proof_url),
    licenseExpiresAt: str(source.licenseExpiresAt ?? source.license_expires_at),
    commercialUse: source.commercialUse === true || source.commercial_use === true
  };
  return result;
}

/**
 * 一批搜索结果 → `{ rows, dropped, issues }`：结构不合契约的行**如实报数**并说明原因，
 * 不补默认值、不猜元数据（「不返回假数据」在这一层也成立）。
 */
export function musicSourceResults(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const rows = [];
  const issues = [];
  list.forEach((item, index) => {
    const issue = musicSourceResultIssue(item);
    if (issue) {
      issues.push(`第 ${index + 1} 条结果${issue}，已忽略。`);
      return;
    }
    rows.push(normalizeMusicSourceResult(item));
  });
  return { rows, dropped: issues.length, issues };
}

/** 搜索结果一行读数（界面渲染它，不各拼一份；三种情形同形状）。 */
export function musicSourceResultRow(raw) {
  const item = normalizeMusicSourceResult(raw);
  const meta = [
    item.artist || '作者未填',
    item.durationSec ? `${item.durationSec} 秒` : '时长未填',
    item.bpm ? `${item.bpm} BPM` : 'BPM 未填'
  ].join(' · ');
  return {
    id: item.sourceId || item.sourceUrl,
    name: item.title,
    meta,
    mood: item.mood.join(' / '),
    sourceProvider: item.sourceProvider || '曲源平台未填',
    licenseType: item.licenseType || '授权类型未填'
  };
}

export const MUSIC_SOURCE_SEARCH_EMPTY_TEXT = '还没有搜索结果：填好过滤条件后点「搜索」。';
export const MUSIC_SOURCE_NO_MATCH_TEXT = '没有找到匹配的曲目：换一组过滤条件再试。';

// ---------------------------------------------------------------------------
// ④ 下载入库：步骤契约（转码与去重是 TODO）+ 可读失败原因 + 入库结果契约
// ---------------------------------------------------------------------------

/**
 * 服务端下载入库的步骤契约（界面按它说「正在做什么」，断言按它查 TODO）。
 * 后两步标 `todo:true`：**转码（mp3 128kbps）与 hash 去重（FR-291）还没接入** ——
 * 这是本故事验收原文点名「保留 TODO 并在界面标注未接入」的那两件事。
 */
export const MUSIC_SOURCE_IMPORT_STEPS = [
  { id: 'fetch', label: '抓取源文件', todo: false },
  { id: 'probe', label: '探测文件格式', todo: false },
  { id: 'transcode', label: '转码 mp3 128kbps', todo: true },
  { id: 'dedupe', label: '计算 hash 并去重', todo: true }
];

/** 契约里仍然是 TODO 的步骤 id（服务端未接入），界面标注读它、不另写一份。 */
export const MUSIC_SOURCE_IMPORT_TODOS = MUSIC_SOURCE_IMPORT_STEPS.filter(step => step.todo).map(step => step.id);

/** 下载入库的说明（界面常驻）：说清走的是服务端契约，以及哪两步还没接入。 */
export const MUSIC_SOURCE_IMPORT_NOTE =
  '下载入库按这份契约走服务端：抓取源文件 → 探测格式 → 转码 mp3 128kbps → 计算 hash 去重；'
  + '其中**转码与去重**是服务端的 TODO（尚未接入），成功与失败都只如实回报服务端的结果。';

/** 入库请求体（白名单，一次只带这一条搜索结果的字段；snake_case 不出去）。 */
export function musicSourceImportBody(candidate) {
  const item = normalizeMusicSourceResult(candidate);
  const body = {};
  MUSIC_SOURCE_RESULT_FIELDS.forEach(field => { body[field] = item[field]; });
  return body;
}

/** 入库成功后服务端必须带回的字段（缺一项就不接受这条结果）。 */
export const MUSIC_SOURCE_IMPORT_TRACK_FIELDS = ['trackKey', 'title', 'sourceUrl', 'fileKey', 'fileUrl', 'hash'];

/**
 * 入库响应的契约判定（空串 = 成立）：
 *  - 必须是一个曲目对象，且带全 `MUSIC_SOURCE_IMPORT_TRACK_FIELDS`（hash 是 FR-291 去重用的）；
 *  - `fileUrl` 必须是 http(s)（本机地址 / base64 不是入库文件的地址）；
 *  - 返回的 `sourceUrl` 必须与这次下载的那条搜索结果**一致** —— 曲源串档比慢更糟。
 */
export function musicSourceImportTrackIssue({ track, candidate } = {}) {
  if (!track || typeof track !== 'object' || Array.isArray(track)) return '响应里没有入库后的曲目对象。';
  const item = normalizeMusicTrack(track);
  if (!item.trackKey) return '入库后的曲目缺少 trackKey（幂等键）。';
  if (!item.title) return '入库后的曲目没有标题。';
  if (!item.fileKey) return '入库后的曲目没有文件键（fileKey）。';
  if (!isHttpUrl(item.fileUrl)) return '入库后的曲目没有可用的文件地址（fileUrl 必须是 http/https）。';
  if (!item.hash) return '入库后的曲目没有文件 hash（FR-291 去重要用它）。';
  const wanted = normalizeMusicSourceResult(candidate);
  if (wanted.sourceUrl && item.sourceUrl !== wanted.sourceUrl) {
    return `返回的曲目来源与这次下载的不是同一条（下载的是 ${wanted.sourceUrl}，返回的是 ${item.sourceUrl || '(空)'}）：不接受这次结果。`;
  }
  return '';
}

/**
 * 下载失败的三类可读原因（FR-297 的验收原文：防盗链 / 超时 / 格式不支持），
 * 由服务端的失败码翻译而来；`code` 是契约里的稳定写法，`label` 是界面上的短标签。
 */
export const MUSIC_SOURCE_IMPORT_FAILURES = {
  hotlink: {
    code: 'hotlink',
    label: '防盗链',
    text: '下载失败（防盗链）：授权曲源拒绝了抓取请求（直链被防盗链拦截）——请回到曲源后台重新复制下载地址，或换一条曲目再试。'
  },
  timeout: {
    code: 'timeout',
    label: '超时',
    text: '下载失败（超时）：授权曲源在限定时间内没有响应、或文件没有传完——可以稍后重试，重试仍失败就换一条曲目。'
  },
  format: {
    code: 'format',
    label: '格式不支持',
    text: '下载失败（格式不支持）：抓到的文件不是可入库的音频（只收 mp3 / wav / m4a 这类音频）——请换一条曲目。'
  }
};
export const MUSIC_SOURCE_IMPORT_FAILURE_CODES = Object.keys(MUSIC_SOURCE_IMPORT_FAILURES);

/** 认不出失败码时的兜底说法（**不凭空编一个原因**）。 */
export const MUSIC_SOURCE_IMPORT_UNKNOWN_REASON = '曲源服务没有给出可识别的原因';

/**
 * 从失败响应体里读失败码与说明：认 `{ error: { code, message } }`（首选）
 * 与 `{ code, message }`；码不在白名单里就归为 `unknown`，说明文字原样带上。
 */
export function musicSourceFailureFromPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const error = source.error && typeof source.error === 'object' ? source.error : {};
  const code = str(error.code || source.code);
  const detail = str(
    error.message
    || (typeof source.error === 'string' ? source.error : '')
    || source.message
  );
  return {
    code: MUSIC_SOURCE_IMPORT_FAILURE_CODES.includes(code) ? code : 'unknown',
    requestedCode: code,
    detail
  };
}

/**
 * 失败码 → 可读原因（界面直接显示这句话）；服务端给了说明就补在后面，但**不改写原因本身**。
 */
export function musicSourceFailureText(input = {}) {
  const failure = typeof input === 'string' ? { code: input } : (input && typeof input === 'object' ? input : {});
  const known = MUSIC_SOURCE_IMPORT_FAILURES[str(failure.code)];
  const detail = str(failure.detail);
  if (known) return detail ? `${known.text}（服务端说明：${detail}）` : known.text;
  return `下载失败：${detail || MUSIC_SOURCE_IMPORT_UNKNOWN_REASON}。`;
}

// ---------------------------------------------------------------------------
// ⑤ 能力探测的视图（三种状态同形状，US-204 的纪律）
// ---------------------------------------------------------------------------

/**
 * 探测结果 → 面板读数（`{ state, configured, text, provider }`）：
 *  - `checking`：还没探完（`probe` 为 null）；
 *  - `ok`：曲源已配置 —— 可以搜索与下载入库；
 *  - `unconfigured`：未配置（验收原文那句，界面直接显示）；
 *  - `error`：探到了但服务端拒绝了（不是「未配置」，如实分开说）。
 */
export function musicSourceProbeView(probe) {
  if (!probe) {
    return { state: 'checking', configured: false, text: '正在探测授权曲源…', provider: '' };
  }
  const provider = str(probe.provider);
  if (probe.configured === true) {
    return {
      state: 'ok',
      configured: true,
      text: provider ? `授权曲源已配置（${provider}）：可以搜索与下载入库。` : '授权曲源已配置：可以搜索与下载入库。',
      provider
    };
  }
  return {
    state: probe.unconfigured === false ? 'error' : 'unconfigured',
    configured: false,
    text: str(probe.message) || MUSIC_SOURCE_UNCONFIGURED_TEXT,
    provider
  };
}
