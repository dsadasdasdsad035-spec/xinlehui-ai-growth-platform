import { cloud, unwrap } from '../cloud';

// 3D 画廊的云端数据层：展厅地点（venue）与画展（exhibition）。
// 与其它表同一套「一所机构共享一份工作区」模型，venue_key / exhibition_key 做幂等键。
const VENUE_TABLE = 'gallery_venues';
const EXHIBITION_TABLE = 'gallery_exhibitions';

const asObject = (value, fallback = {}) => (value && typeof value === 'object' && !Array.isArray(value) ? value : fallback);

function rowToVenue(row) {
  const raw = row.photo_blob || '';
  // data URL = 管理员上传的实景图；其它字符串 = 资源地址（内置展厅走这条）
  const isUpload = raw.startsWith('data:');
  return {
    id: row.venue_key,
    name: row.name || '未命名展厅',
    location: row.location || '',
    description: row.description || '',
    photo: {
      blob: isUpload ? raw : '',
      url: isUpload ? '' : raw,
      name: row.photo_name || '',
      width: Number(row.photo_width) || 0,
      height: Number(row.photo_height) || 0
    },
    options: asObject(row.options),
    rectOverride: row.rect_override && typeof row.rect_override === 'object' ? row.rect_override : null,
    detection: asObject(row.detection),
    room: asObject(row.room),
    enabled: row.enabled !== false,
    builtin: row.builtin === true,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 90,
    updatedAt: row.updated_at || ''
  };
}

function venueToRow(venue) {
  // 内置展厅用的是打包进来的默认实景图：**不要把带 hash 的构建路径写进库**，
  // 否则下次构建换了 hash，库里那条就指向不存在的文件了。
  // 库里留空，前端读取时回落到内置资源（见 data/galleryVenues.js 的 mergeWithSeed）。
  const raw = venue?.photo?.blob || (venue?.builtin ? '' : (venue?.photo?.url || ''));
  return {
    venue_key: String(venue.id),
    name: venue.name || '未命名展厅',
    location: venue.location || '',
    description: venue.description || '',
    photo_blob: raw || null,
    photo_name: venue?.photo?.name || '',
    photo_width: Number(venue?.photo?.width) || 0,
    photo_height: Number(venue?.photo?.height) || 0,
    options: venue.options || {},
    rect_override: venue.rectOverride || null,
    detection: venue.detection || {},
    room: venue.room || {},
    enabled: venue.enabled !== false,
    builtin: venue.builtin === true,
    sort_order: Number.isFinite(venue.sortOrder) ? venue.sortOrder : 90
  };
}

export async function loadRemoteGalleryVenues() {
  const rows = unwrap(await cloud.database.from(VENUE_TABLE).select('*'));
  return rows.map(rowToVenue).sort((a, b) => a.sortOrder - b.sortOrder || String(a.id).localeCompare(String(b.id)));
}

export async function saveRemoteGalleryVenue(venue) {
  unwrap(await cloud.database.from(VENUE_TABLE).upsert(venueToRow(venue), { onConflict: 'venue_key' }));
  return venue;
}

export async function deleteRemoteGalleryVenue(id) {
  unwrap(await cloud.database.from(VENUE_TABLE).delete().eq('venue_key', String(id)));
  return id;
}

function rowToExhibition(row) {
  return {
    id: row.exhibition_key,
    title: row.title || '未命名画展',
    subtitle: row.subtitle || '',
    venueId: row.venue_key || '',
    description: row.description || '',
    startDate: row.start_date || '',
    endDate: row.end_date || '',
    artworks: Array.isArray(row.artworks) ? row.artworks : [],
    layout: asObject(row.layout),
    status: row.status || 'draft',
    enabled: row.enabled !== false,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 90,
    updatedAt: row.updated_at || ''
  };
}

function exhibitionToRow(exhibition) {
  return {
    exhibition_key: String(exhibition.id),
    title: exhibition.title || '未命名画展',
    subtitle: exhibition.subtitle || '',
    venue_key: exhibition.venueId || '',
    description: exhibition.description || '',
    start_date: exhibition.startDate || '',
    end_date: exhibition.endDate || '',
    artworks: Array.isArray(exhibition.artworks) ? exhibition.artworks : [],
    layout: exhibition.layout || {},
    status: exhibition.status || 'draft',
    enabled: exhibition.enabled !== false,
    sort_order: Number.isFinite(exhibition.sortOrder) ? exhibition.sortOrder : 90
  };
}

export async function loadRemoteGalleryExhibitions() {
  const rows = unwrap(await cloud.database.from(EXHIBITION_TABLE).select('*'));
  return rows.map(rowToExhibition).sort((a, b) => a.sortOrder - b.sortOrder || String(a.id).localeCompare(String(b.id)));
}

export async function saveRemoteGalleryExhibition(exhibition) {
  unwrap(await cloud.database.from(EXHIBITION_TABLE).upsert(exhibitionToRow(exhibition), { onConflict: 'exhibition_key' }));
  return exhibition;
}

export async function deleteRemoteGalleryExhibition(id) {
  unwrap(await cloud.database.from(EXHIBITION_TABLE).delete().eq('exhibition_key', String(id)));
  return id;
}
