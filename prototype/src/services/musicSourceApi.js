/**
 * 授权曲源的**契约层**（[第四步 US-220b] / FR-289 ~ FR-297 的搜索与下载入库）。
 *
 * 这一层只做网络动作：拼 URL（路由表在 `data/musicSource.js`）、发请求、按契约收口、抛可读错误。
 * **一条业务判据都不新增** —— 过滤条件 / 结果字段 / 入库结果契约 / 失败码 / 文案全部读
 * `data/musicSource.js`（零依赖纯函数，可 Node 直跑断言）。
 *
 * 四条纪律（与视频服务契约层同一套口径）：
 *   ① `searchMusicSource` / `importMusicSourceTrack` 是仅有的两个业务入口，**没有任何 mock 分支**
 *      —— 这里不许出现「曲源不在就编几条演示结果」的兜底：未配置授权曲源时**抛错**，
 *      消息以验收原文「未配置授权曲源」开头（`MUSIC_SOURCE_UNCONFIGURED_TEXT`），界面据此如实提示；
 *   ② 未配置 / 连不上 / 路由没接 → 抛 `MusicSourceError`（`unconfigured:true`）；服务端在但拒绝了
 *      这次请求 → 抛错，下载入库的失败码（防盗链 / 超时 / 格式不支持）翻译成可读原因（FR-297）；
 *   ③ 响应必须过契约：搜索要 `tracks` 数组、入库要带回 `trackKey/title/sourceUrl/fileKey/fileUrl/hash`
 *      且来源与这次下载的一致 —— 不符合就抛错，**不把半条结果交给界面**；
 *   ④ 只跟服务端说话（曲源的密钥与鉴权都在服务端，**不下发前端**）。
 *
 * TODO(服务端排期 · US-220b 的验收原文「转码与去重逻辑保留 TODO」)：
 *   下载入库的真实流程是**服务端**执行的 —— 抓取源文件 → 探测格式 → ffmpeg 转码 mp3 128kbps
 *   → 计算文件 hash 并按「来源 URL + hash」去重（FR-290 / FR-291）。这两步（transcode / dedupe）
 *   在服务端尚未实现（本层只按契约发起请求，并把服务端的失败原因如实翻译给界面）；
 *   步骤契约与 TODO 标注在 `data/musicSource.js` 的 `MUSIC_SOURCE_IMPORT_STEPS` 里，界面直接渲染它。
 */

import { CHILD_MEDIA_API_BASE } from './mediaStorage';
import {
  MUSIC_SOURCE_ROUTES,
  createMusicSourceQuery,
  musicSourceFailureFromPayload,
  musicSourceFailureText,
  musicSourceImportBody,
  musicSourceImportTrackIssue,
  musicSourceQueryIssue,
  musicSourceQueryString,
  musicSourceResultIssue,
  musicSourceResults,
  musicSourceStatusVerdict,
  musicSourceUnconfiguredText,
  normalizeMusicSourceResult
} from '../data/musicSource';
import { createNewMusicTrack } from '../data/musicTracks';
import { mirrorMusicTrackLocally } from './musicLibraryApi';

export { CHILD_MEDIA_API_BASE };

/** 搜索 / 下载入库的请求超时（毫秒）：曲源走服务端代理，卡住要如实失败、不让管理员干等。 */
export const MUSIC_SOURCE_TIMEOUT_MS = 2500;

/** 能力探测的超时（比业务请求短：探测只回答「配没配」，不该让页面等）。 */
export const MUSIC_SOURCE_PROBE_TIMEOUT_MS = 1200;

/**
 * 契约层的错误。`unconfigured` 为 true = 「授权曲源未配置 / 连不上 / 路由没接」那一类
 * （消息以验收原文开头）；其余 code：`music-source-query-invalid`（过滤条件非法，没发出去）、
 * `music-source-rejected`（曲源服务拒绝了这次请求）、`music-import-<failureCode>`（下载失败，
 * 带上 `failureCode`：hotlink / timeout / format / unknown）、`music-source-contract`（响应不符合契约）。
 */
export class MusicSourceError extends Error {
  constructor(message, { status = 0, code = 'music-source-unconfigured', unconfigured = false, failureCode = '', detail = '', payload = null } = {}) {
    super(message);
    this.name = 'MusicSourceError';
    this.status = status;
    this.code = code;
    this.unconfigured = unconfigured;
    this.failureCode = failureCode;
    this.detail = detail;
    this.payload = payload;
  }
}

/** 界面用它分流：`true` → 显示「未配置授权曲源」那句，搜索结果保持为空。 */
export function isMusicSourceUnconfigured(error) {
  return Boolean(error) && error.name === 'MusicSourceError' && error.unconfigured === true;
}

const textOf = error => String((error && error.message) || error || '').trim();
const trimText = value => String(value ?? '').trim();
const trimBase = value => String(value ?? '').trim().replace(/\/+$/, '');

function unconfiguredError(detail, { status = 0, code = 'music-source-unconfigured', cause = null } = {}) {
  const error = new MusicSourceError(musicSourceUnconfiguredText(detail), { status, code, unconfigured: true });
  if (cause) error.cause = cause;
  return error;
}

function invalidError(issue) {
  return new MusicSourceError(issue, { code: 'music-source-query-invalid' });
}

async function readJson(response) {
  if (!response || typeof response.json !== 'function') return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * 发一次契约请求（**唯一的出网口**）：路由表 → URL（可带查询串）→ fetch（带超时）→
 * 按 `musicSourceStatusVerdict` 分流。返回 `{ status, payload, url }`；`payload` 可能是 null。
 *  - `unconfigured`（0 / 404 / 405 / 501）→ 抛「未配置授权曲源」（验收原文那句）；
 *  - `rejected`（其余非 2xx）→ 抛 `music-source-rejected` 并把**响应体挂在错误上**
 *    （下载入库要靠它读失败码，见 `importMusicSourceTrack`）。
 */
async function callMusicSource({ route, query = '', body = null, baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = MUSIC_SOURCE_TIMEOUT_MS, fetchImpl = null, action = '搜索' } = {}) {
  const entry = MUSIC_SOURCE_ROUTES[trimText(route)];
  if (!entry) throw invalidError(`不认识的路由：${trimText(route) || '(空)'}。`);
  const suffix = trimText(query) ? `?${trimText(query)}` : '';
  const url = `${trimBase(baseUrl)}${entry.path}${suffix}`;
  const impl = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch === 'function' ? fetch : null);
  if (!impl) throw unconfiguredError('当前环境没有 fetch，发不出请求');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller && Number(timeoutMs) > 0 ? setTimeout(() => controller.abort(), Number(timeoutMs)) : null;
  let response = null;
  try {
    response = await impl(url, {
      method: entry.method,
      headers: { 'Content-Type': 'application/json' },
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    });
  } catch (error) {
    const aborted = Boolean(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
    throw unconfiguredError(
      aborted ? `请求超时（${timeoutMs}ms 内没有响应）` : `连不上曲源服务：${textOf(error)}`,
      { cause: error }
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  const status = Number(response && response.status) || 0;
  const payload = await readJson(response);
  const verdict = musicSourceStatusVerdict(status);
  if (verdict === 'unconfigured') {
    throw unconfiguredError(`服务端返回 ${status}（路由还没接或曲源未配置）`, { status });
  }
  if (verdict === 'rejected') {
    const reason = payload && typeof payload === 'object' ? trimText(payload.message || (payload.error && payload.error.message)) : '';
    throw new MusicSourceError(
      `授权曲源服务拒绝了这次${trimText(action) || '请求'}（HTTP ${status}）：${reason || '服务端没有给出原因。'}`,
      { status, code: 'music-source-rejected', payload }
    );
  }
  return { status, payload, url };
}

/**
 * 搜索授权曲源（关键词 / 情绪 / 时长 / BPM）。
 *  - 过滤条件非法（下限大于上限）**不发请求**（`musicSourceQueryIssue` 是判据）；
 *  - 服务端声明未配置（`configured:false`，即使 HTTP 200）也抛「未配置授权曲源」——
 *    **不返回假数据**：没有结果就是空数组，界面照实显示「没有找到」；
 *  - 响应里字段不全的结果由 `musicSourceResults` 如实丢掉并报数（`dropped`）。
 * 返回 `{ query, url, results, dropped, issues, provider }`。
 */
export async function searchMusicSource(filters = {}, options = {}) {
  const query = createMusicSourceQuery(filters);
  const issue = musicSourceQueryIssue(query);
  if (issue) throw invalidError(issue);
  const { status, payload, url } = await callMusicSource({
    ...options,
    route: 'search',
    query: musicSourceQueryString(query),
    action: '搜索'
  });
  const source = payload && typeof payload === 'object' ? payload : {};
  if (source.configured === false) {
    throw unconfiguredError(trimText(source.note || source.detail || '服务端声明：授权曲源未配置'), { status });
  }
  if (!Array.isArray(source.tracks)) {
    throw new MusicSourceError('授权曲源的响应不符合契约：没有 tracks 数组（搜索结果的形状无从确认）。', { status, code: 'music-source-contract' });
  }
  const { rows, dropped, issues } = musicSourceResults(source.tracks);
  return { query, url, results: rows, dropped, issues, provider: trimText(source.provider) };
}

/**
 * 下载入库一条搜索结果（POST 给服务端代理；服务端负责抓取 / 转码 / 去重 —— 见文件头的 TODO）。
 *  - 这条结果缺标题或来源地址 → **不发请求**（`musicSourceResultIssue`）；
 *  - 服务端失败（防盗链 / 超时 / 格式不支持）→ 抛出带可读原因的 `MusicSourceError`
 *    （`failureCode` = hotlink / timeout / format / unknown），界面显示原因并给「重试」；
 *  - 成功 → 按契约校验（含「来源必须与这次下载的一致」），把曲目**先落本机镜像**再返回；
 *    入库的曲目一律是 `pending`（`createNewMusicTrack` 是唯一入口，FR-293）——确认授权是
 *    入库之后的独立动作（US-220a 的后台按行改状态）。
 * 返回 `{ track, candidate, status }`。
 */
export async function importMusicSourceTrack(candidate, options = {}) {
  const resultIssue = musicSourceResultIssue(candidate);
  if (resultIssue) throw invalidError(`这条搜索结果不能入库：${resultIssue}。`);
  const item = normalizeMusicSourceResult(candidate);
  const body = musicSourceImportBody(item);
  let status = 0;
  let payload = null;
  try {
    ({ status, payload } = await callMusicSource({ ...options, route: 'import', body, action: '下载入库' }));
  } catch (error) {
    if (error instanceof MusicSourceError && error.code === 'music-source-rejected') {
      const failure = musicSourceFailureFromPayload(error.payload);
      throw new MusicSourceError(musicSourceFailureText(failure), {
        status: error.status,
        code: `music-import-${failure.code}`,
        failureCode: failure.code,
        detail: failure.detail
      });
    }
    throw error;
  }
  const raw = payload && typeof payload === 'object' && 'track' in payload ? payload.track : payload;
  const issue = musicSourceImportTrackIssue({ track: raw, candidate: item });
  if (issue) throw new MusicSourceError(`授权曲源的响应不符合契约：${issue}`, { status, code: 'music-source-contract' });
  const track = createNewMusicTrack(raw);
  // 先落本机镜像（云端推送由曲目那条通道自己完成，见 musicLibraryApi 的说明）。
  mirrorMusicTrackLocally(track);
  return { track, candidate: item, status };
}

/**
 * 能力探测（`GET /api/music/source`）：**永不抛错**，给界面一个真实读数 —— 授权曲源配没配。
 * 返回 `{ ok, configured, unconfigured, reachable, status, provider, message, checkedAt, baseUrl }`
 * （各状态同形状）。界面据此显示「已配置」或验收原文那句「未配置授权曲源」，
 * **不许**用「探测不到就假装能搜」这种回退。
 */
export async function probeMusicSource({ baseUrl = CHILD_MEDIA_API_BASE, timeoutMs = MUSIC_SOURCE_PROBE_TIMEOUT_MS, fetchImpl = null } = {}) {
  const checkedAt = new Date().toISOString();
  try {
    const { status, payload } = await callMusicSource({ route: 'capability', baseUrl, timeoutMs, fetchImpl, action: '探测' });
    const source = payload && typeof payload === 'object' ? payload : {};
    const provider = trimText(source.provider);
    if (source.configured === true) {
      return { ok: true, configured: true, unconfigured: false, reachable: true, status, provider, message: '', checkedAt, baseUrl };
    }
    return {
      ok: false,
      configured: false,
      unconfigured: true,
      reachable: true,
      status,
      provider,
      message: musicSourceUnconfiguredText(trimText(source.note || source.detail) || '服务端声明：授权曲源未配置'),
      checkedAt,
      baseUrl
    };
  } catch (error) {
    const status = Number(error && error.status) || 0;
    const unconfigured = isMusicSourceUnconfigured(error);
    return {
      ok: false,
      configured: false,
      unconfigured,
      reachable: status > 0,
      status,
      provider: '',
      message: textOf(error),
      checkedAt,
      baseUrl
    };
  }
}
