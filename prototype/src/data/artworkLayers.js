/**
 * 作品素材的**四层地址**（US-005「编辑保护：重置、一键还原与四层地址」）。
 *
 * 一幅作品从上传到成品会依次产出四个地址，各自住在自己的字段里，**任何一层都不写进别人的槽位**：
 *
 * | 层 | 字段 | 由谁产出 | 性质 |
 * |---|---|---|---|
 * | 原图 | `originalUrl` | 上传（`readFile` 写一次） | **只读**：旋转 / 裁剪 / 缩放 / 装裱都不覆盖它 |
 * | 旋转稿 | `orientedUrl` | `renderArtworkRotation` | 派生层，按 `artworkEdit.rotateDeg` 生成 |
 * | 裁剪稿 | `cleanUrl` | `extractArtworkSurfaceDetails` / `renderArtworkCrop` | 派生层，画心 |
 * | 成品图 | `framedUrl` | `renderFramedArtwork` | 派生层，装裱合成结果 |
 *
 * 两条口径（写下来免得被当 bug 修）：
 *  1. 某一层「不需要做事」时，上层地址会**原样等于**下层地址（0° 旋转不加尺寸上限 →
 *     旋转稿 = 原图；整幅裁剪 + identity → 裁剪稿 = 旋转稿）。这是「不重新编码」的优化，
 *     不是覆盖：四个地址仍然是四个独立的字段，谁也不会写进别人的槽里。
 *  2. 刷新页面后会话内素材（`blob:`）失效，四层会一起按当前 `artworkEdit` 重新生成 ——
 *     原图一旦失效就没有可再生的来源，界面上要如实提示重新选择素材（US-408 的既有口径）。
 *
 * 与 `data/artworkEdit.js` 同一套纪律：**零依赖纯函数 + 常量**，不 import 任何模块、不碰 DOM，
 * 可以直接用 Node 跑断言。界面用它渲染「四层地址」清单，验证脚本用它取指纹。
 */

/** 四层的字段名（顺序 = 生成顺序 = 界面显示顺序）。`media.artwork` 上只有这四个是「地址层」。 */
export const ARTWORK_LAYER_KEYS = ['originalUrl', 'orientedUrl', 'cleanUrl', 'framedUrl'];

/** 四层的展示元数据：标签、是否只读、一句话说明。界面与验证脚本都读这一份，不各写一遍。 */
export const ARTWORK_LAYERS = [
  {
    key: 'originalUrl',
    label: '原图',
    readonly: true,
    hint: '上传的原始素材，只读；旋转、裁剪、缩放与装裱都不会覆盖它'
  },
  {
    key: 'orientedUrl',
    label: '旋转稿',
    readonly: false,
    hint: '按本次编辑的旋转角生成（0° 且未超上限时就是原图本身，不重新编码）'
  },
  {
    key: 'cleanUrl',
    label: '裁剪稿',
    readonly: false,
    hint: '画心：手动裁剪就是老师画的框，否则是系统自动裁剪的结果'
  },
  {
    key: 'framedUrl',
    label: '成品图',
    readonly: false,
    hint: '按装裱方案合成（画框、卡纸、展签、叠加元素）'
  }
];

/** 只读层的字段名（原图）。派生层的写入一律不许碰它。 */
export const ARTWORK_READONLY_LAYER_KEYS = ARTWORK_LAYERS.filter((layer) => layer.readonly).map((layer) => layer.key);

/**
 * 地址指纹：FNV-1a 32 位，8 位十六进制。
 * 对 `data:` 地址来说它就是内容摘要（base64 正文就是全部内容），对 `blob:` 地址来说它是这一层
 * 地址的稳定标识 —— 所以界面上的说法是「指纹」，不下「内容哈希」的结论。
 */
export function artworkUrlFingerprint(url) {
  const text = typeof url === 'string' ? url : '';
  if (!text) return '';
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 四层的当前状态清单：每层含 `ready / chars / fingerprint / readonly`，界面与断言共用。 */
export function artworkLayerEntries(artwork) {
  const source = artwork && typeof artwork === 'object' ? artwork : {};
  return ARTWORK_LAYERS.map((layer) => {
    const url = typeof source[layer.key] === 'string' ? source[layer.key] : '';
    return {
      key: layer.key,
      label: layer.label,
      readonly: layer.readonly,
      hint: layer.hint,
      url,
      ready: Boolean(url),
      chars: url.length,
      fingerprint: artworkUrlFingerprint(url)
    };
  });
}

/** 已经生成了几层（界面上的「N / 4 层」）。 */
export function artworkLayerReadyCount(artwork) {
  return artworkLayerEntries(artwork).filter((entry) => entry.ready).length;
}

/** 一行摘要：`原图 · 旋转稿 · 裁剪稿（成品图未生成）`。 */
export function artworkLayerSummary(artwork) {
  const entries = artworkLayerEntries(artwork);
  const ready = entries.filter((entry) => entry.ready).map((entry) => entry.label);
  const missing = entries.filter((entry) => !entry.ready).map((entry) => entry.label);
  if (!ready.length) return '四层地址都还没生成';
  return missing.length ? `${ready.join(' · ')}（${missing.join(' / ')}未生成）` : ready.join(' · ');
}

/**
 * 把一层的产物写回作品记录：**只接受派生层的字段，原图字段一律拒绝**。
 * 这是「四层地址互不覆盖」在写入侧的实现点：任何渲染 / 编辑路径都不该（也做不到）改掉 `originalUrl`，
 * 被拒绝的字段名回报在 `blocked` 里（界面可提示、断言可检查）。重新选择素材是**新建一条记录**
 * （`readFile` 写一个新的 artwork 对象），不属于「写回」，所以不受这条限制。
 */
export function applyArtworkLayerPatch(artwork, patch = {}) {
  const base = artwork && typeof artwork === 'object' ? artwork : {};
  const next = { ...base };
  const blocked = [];
  Object.entries(patch && typeof patch === 'object' ? patch : {}).forEach(([key, value]) => {
    if (ARTWORK_READONLY_LAYER_KEYS.includes(key)) {
      blocked.push(key);
      return;
    }
    next[key] = value;
  });
  return { artwork: next, blocked };
}
