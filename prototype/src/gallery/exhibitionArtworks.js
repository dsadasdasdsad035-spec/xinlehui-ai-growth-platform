// 画展作品清单 → 真正可以挂上墙的「已装裱整图」。
//
// 关键设计：画展里**不存图片数据**，只存「这幅作品从哪来」的轻量描述符。
//   - source:'record' → 指向课后反馈记录，运行时取它的 artworkUrl（画心已裁剪好的作品图）
//   - source:'demo'   → 仓库内置示例，用真实装裱管线现画（不引第三方版权素材）
//   - source:'upload' → 只有管理员手工上传才带图片数据，且存的是**作品原图**
//
// 挂上墙的那一刻才统一走 renderFramedArtwork 装裱。这么做有两个好处：
//   1) 画展那一行数据很小（十几幅作品也就几百字节），不会把 text 列撑爆；
//   2) 换一套装裱方案，整场画展的框会一起变，不会留下上一次的旧图。

import { DEMO_ARTWORKS, createDemoFramedArtwork } from './demoArtwork';
import { renderFramedArtwork } from '../services/framing';

/** 装裱结果缓存：同一幅作品 + 同一套参数只渲染一次。 */
const frameCache = new Map();
const CACHE_LIMIT = 80;

async function cached(key, produce) {
  const hit = frameCache.get(key);
  if (hit) return hit;
  const promise = produce().catch((error) => { frameCache.delete(key); throw error; });
  frameCache.set(key, promise);
  if (frameCache.size > CACHE_LIMIT) {
    // Map 保持插入顺序，丢掉最早的那一条即可
    frameCache.delete(frameCache.keys().next().value);
  }
  return promise;
}

export function clearFramedArtworkCache() { frameCache.clear(); }

const specKey = (spec = {}) => [
  spec.outer, spec.mat, spec.innerLine, spec.plaqueBg, spec.plaqueText,
  spec.outerWidthRatio, spec.matWidthRatio
].join('|');

/** 课后反馈记录里的一幅作品 → 画展条目。 */
export function artworkFromRecord(record) {
  return {
    id: `record-${record.id}`,
    source: 'record',
    recordId: record.id,
    student: record.student || '',
    title: record.title || '',
    date: record.date || ''
  };
}

/** 内置示例作品 → 画展条目（示例作品本身就是按装裱管线现画的，已含画框）。 */
export function artworkFromDemo(demo) {
  return {
    id: `demo-art-${demo.variant}`,
    source: 'demo',
    variant: demo.variant,
    student: demo.student,
    title: demo.title,
    date: demo.date
  };
}

/** 管理员手工上传的作品原图 → 画展条目。 */
export function artworkFromUpload({ imageUrl, student = '', title = '', date = '' }) {
  return {
    id: `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    source: 'upload',
    imageUrl,
    student,
    title,
    date
  };
}

export const demoArtworkEntries = () => DEMO_ARTWORKS.map(artworkFromDemo);

/** 判断一条画展条目在运行时有没有可用的素材（没有的话没必要占一个槽位）。 */
export function hasArtworkSource(entry, records = []) {
  if (!entry) return false;
  if (entry.source === 'demo') return true;
  if (entry.source === 'upload') return Boolean(entry.imageUrl);
  if (entry.source === 'record') return Boolean(records.find((r) => r.id === entry.recordId)?.artworkUrl);
  return false;
}

async function resolveOne(entry, { byId, spec }) {
  if (entry.source === 'demo') {
    const demo = DEMO_ARTWORKS.find((d) => d.variant === entry.variant) || DEMO_ARTWORKS[0];
    return cached(`demo|${demo.variant}|${specKey(spec)}`, () => createDemoFramedArtwork({ spec }, demo));
  }
  const raw = entry.source === 'record'
    ? (byId.get(entry.recordId)?.artworkUrl || '')
    : (entry.imageUrl || '');
  if (!raw) return '';
  // 用「长度 + 尾串」当图片指纹：data URL 很长，不必整串进 key。
  const fingerprint = `${raw.length}:${raw.slice(-28)}`;
  return cached(
    `${entry.id}|${specKey(spec)}|${fingerprint}`,
    () => renderFramedArtwork({
      source: raw, spec,
      student: entry.student || '', title: entry.title || '', date: entry.date || ''
    })
  );
}

/**
 * 把画展作品清单解析成可以直接交给 three.js 的图。
 * @returns {Promise<Array<{id,student,title,date,imageUrl}>>}
 */
export async function resolveExhibitionArtworks(entries, { records = [], preset = null, onProgress } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const byId = new Map((records || []).map((r) => [r.id, r]));
  const spec = preset?.spec || {};
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    onProgress?.({ done: i, total: list.length, student: entry.student || '' });
    if (!hasArtworkSource(entry, records)) continue;
    try {
      const imageUrl = await resolveOne(entry, { byId, spec });
      if (imageUrl) {
        out.push({
          id: entry.id, student: entry.student || '', title: entry.title || '',
          date: entry.date || '', source: entry.source, imageUrl
        });
      }
    } catch { /* 单幅失败不该拖垮整场画展 */ }
  }
  onProgress?.({ done: list.length, total: list.length, student: '' });
  return out;
}
