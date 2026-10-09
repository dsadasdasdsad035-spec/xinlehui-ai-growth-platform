// 3D 画廊的展厅地点（venue）与画展（exhibition）本地兜底数据。
//
// 与其它模块同一套模型：本地只是"断网/未开通云服务时的兜底"，云端表才是真源。
// 字段形状与云端 gallery_venues / gallery_exhibitions 一一对应。
//
// 关于实景图：云的 storage 端点在当前匿名模式下不可用（缺用户凭证，401 且不带 CORS 头），
// 所以实景图以 data URL 的形式存进 photo_blob（text 列）。一张 1536×1024 的 JPEG
// 约 280KB，转 base64 后约 380KB，远在 text 列的安全范围内。

import defaultHallPhoto from '../assets/gallery/gallery-hall-default.jpg';

const VENUE_KEY = 'xinlehui-gallery-venues-v1';
const EXHIBITION_KEY = 'xinlehui-gallery-exhibitions-v1';

// 拍摄/重建参数：默认值对「站在走廊里正对后墙、眼高约 1.6m 的手机主摄」有效。
// 管理员可以在展厅设置里逐项微调，重建结果会立刻跟着变。
export const DEFAULT_VENUE_OPTIONS = {
  hfovDeg: 66,
  eyeHeight: 1.6,
  hangingHeight: 1.55,
  slotPitch: 1.1
};

export const VENUE_OPTION_FIELDS = [
  { key: 'hfovDeg', label: '镜头水平视场角', unit: '°', min: 30, max: 110, step: 1,
    hint: '手机主摄/24mm 广角大致 65°~75°。数值越大，画面里能装下的横向范围越宽、房间会被算得越小。' },
  { key: 'eyeHeight', label: '拍摄眼高', unit: 'm', min: 0.8, max: 2.4, step: 0.01,
    hint: '相机离地高度。它决定整间展厅的绝对尺度：调高 10%，房间整体也会大 10%。' },
  { key: 'hangingHeight', label: '作品挂高（画心中心）', unit: 'm', min: 0.8, max: 2.6, step: 0.01,
    hint: '美术馆惯例是画心中心离地 1.5~1.6m。' },
  { key: 'slotPitch', label: '槽位间距', unit: 'm', min: 0.6, max: 4, step: 0.05,
    hint: '决定每面墙能挂几幅、单幅最大宽度。儿童作品建议 1.0~1.4m。' }
];

export const seedGalleryVenues = [
  {
    id: 'venue-main-hall',
    name: '主展厅 · 一层长廊',
    location: '星河校区 · 一层',
    description: '长进深展厅，两侧壁灯洗墙，天花一条轨道射灯。适合班级群展与学期汇报展。',
    photo: { url: defaultHallPhoto, blob: '', name: 'gallery-hall-default.jpg', width: 1536, height: 1024 },
    options: { ...DEFAULT_VENUE_OPTIONS },
    rectOverride: null,
    detection: {},
    room: {},
    enabled: true,
    builtin: true,
    sortOrder: 1,
    updatedAt: ''
  }
];

export const seedGalleryExhibitions = [
  {
    id: 'exhibition-autumn-2026',
    title: '向着光的花 · 秋季作品展',
    subtitle: '第二届少儿绘画年度展',
    venueId: 'venue-main-hall',
    description: '把一学期里孩子们最满意的作品装裱后集中上墙，家长可以走进 3D 展厅逐幅看展。',
    startDate: '2026.10.01',
    endDate: '2026.11.30',
    artworks: [],
    layout: {},
    status: 'open',
    enabled: true,
    sortOrder: 1,
    updatedAt: ''
  }
];

export function createEmptyGalleryVenue() {
  return {
    id: `venue-${Date.now().toString(36)}`,
    name: '新展厅',
    location: '',
    description: '',
    photo: { url: '', blob: '', name: '', width: 0, height: 0 },
    options: { ...DEFAULT_VENUE_OPTIONS },
    rectOverride: null,
    detection: {},
    room: {},
    enabled: true,
    builtin: false,
    sortOrder: 50,
    updatedAt: ''
  };
}

export function createEmptyGalleryExhibition() {
  return {
    id: `exhibition-${Date.now().toString(36)}`,
    title: '新画展',
    subtitle: '',
    venueId: seedGalleryVenues[0]?.id || '',
    description: '',
    startDate: '',
    endDate: '',
    artworks: [],
    layout: {},
    status: 'draft',
    enabled: true,
    sortOrder: 50,
    updatedAt: ''
  };
}

/** 实景图的可显示地址：优先用管理员上传的 blob，其次用资源地址。 */
export const venuePhotoSrc = (venue) => venue?.photo?.blob || venue?.photo?.url || '';

const safeParse = (value, fallback) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };

/**
 * 云端那条如果没带实景图，就回落到内置资源。
 * 内置展厅刻意不在库里存图（避免把构建 hash 写进库），所以这一步是必要的。
 */
const withSeedPhoto = (item, seedItem) => {
  if (!seedItem) return item;
  if (venuePhotoSrc(item)) return item;
  return { ...item, photo: { ...(item.photo || {}), url: seedItem.photo?.url || '' } };
};

/**
 * 合并「云端/本地保存的列表」与内置种子条目。
 *
 * 两个必须注意的点：
 *  1) 云端那条常常没有实景图（内置展厅刻意不把构建期路径写进库），要回落到内置资源；
 *  2) **结果必须按 sortOrder 重新排序**。只做 Map 合并的话，云端独有的条目会排在最前、
 *     内置的「主展厅」被挤到末尾 —— 后台默认选中的就成了一间没图的空展厅。
 */
const bySortOrder = (a, b) => (
  Number(a?.sortOrder ?? 90) - Number(b?.sortOrder ?? 90)
) || String(a?.id || '').localeCompare(String(b?.id || ''));

const mergeWithSeed = (saved, seed) => {
  if (!Array.isArray(saved)) return [...seed].sort(bySortOrder);
  const seedById = new Map(seed.map((item) => [item.id, item]));
  // 内置条目始终保留（用户可能清过本地缓存），云端数据按 id 覆盖
  const byId = new Map(saved.map((item) => [item.id, withSeedPhoto(item, seedById.get(item.id))]));
  seed.forEach((item) => { if (!byId.has(item.id)) byId.set(item.id, item); });
  return [...byId.values()].sort(bySortOrder);
};

export function loadGalleryVenues() {
  if (typeof window === 'undefined') return seedGalleryVenues;
  const saved = safeParse(window.localStorage.getItem(VENUE_KEY), null);
  return mergeWithSeed(saved, seedGalleryVenues);
}

export function persistGalleryVenues(list) {
  if (typeof window === 'undefined') return;
  // 内置展厅的 blob 可能很大，本地缓存只留可序列化的必要字段
  try { window.localStorage.setItem(VENUE_KEY, JSON.stringify(list)); } catch { /* 配额满就跳过，云端仍是真源 */ }
}

/**
 * **云端回来的列表也必须过一遍这里的合并。**
 * 内置展厅刻意不把实景图写进库（存的是构建期带 hash 的路径，下次构建就失效），
 * 所以库里那条的 photo 是空的。如果云端一回来就直接 setState 顶掉本地数据，
 * 内置展厅就会变成"没有实景图"，整个 3D 画廊直接建不起来。
 */
export function hydrateGalleryVenues(list) {
  return mergeWithSeed(list, seedGalleryVenues);
}

export function loadGalleryExhibitions() {
  if (typeof window === 'undefined') return seedGalleryExhibitions;
  const saved = safeParse(window.localStorage.getItem(EXHIBITION_KEY), null);
  return mergeWithSeed(saved, seedGalleryExhibitions);
}

export function persistGalleryExhibitions(list) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(EXHIBITION_KEY, JSON.stringify(list)); } catch { /* 同上 */ }
}

/** 画展同样要在云端数据回来时补上内置条目。 */
export function hydrateGalleryExhibitions(list) {
  return mergeWithSeed(list, seedGalleryExhibitions);
}
