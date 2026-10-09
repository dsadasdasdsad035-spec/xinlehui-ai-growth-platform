// 管理员端「3D 画廊」：维护展厅地点（实景图 + 重建参数）与画展布置。
//
// 用户的两条硬要求，决定了这个页面的形态：
//   「管理员可以通过后台设置这个3D画廊，现场实景图」→ 上传实景图是主入口
//   「3D画廊的建模一定要实景图渲染」              → 每改一次图/参数，立刻重算并给出
//                                                   可核对的结果：诊断数据 + 五面矫正贴图 + 3D 预览
// 所以右侧不是"填个表单就完事"，而是所见即所得的重建工作台。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleAlert, Crosshair, ImagePlus, Landmark, MapPin, Plus, RefreshCw,
  ScanEye, Sparkles, Trash2, UploadCloud
} from 'lucide-react';
import { PageHeader, Button } from '../ui';
import { reconstructGalleryRoom } from '../services/roomReconstruct';
import {
  createEmptyGalleryExhibition, createEmptyGalleryVenue, DEFAULT_VENUE_OPTIONS,
  VENUE_OPTION_FIELDS, seedGalleryVenues, venuePhotoSrc
} from '../data/galleryVenues';
import {
  deleteRemoteGalleryExhibition, deleteRemoteGalleryVenue,
  saveRemoteGalleryExhibition, saveRemoteGalleryVenue
} from '../services/galleryVenuesApi';
import GalleryViewer from './GalleryViewer';
import {
  artworkFromRecord, artworkFromUpload, clearFramedArtworkCache,
  demoArtworkEntries, resolveExhibitionArtworks
} from './exhibitionArtworks';
import { DEMO_ARTWORKS } from './demoArtwork';
import { shrinkImageFile } from './photoFile';

const SURFACE_LABELS = { backWall: '后墙', leftWall: '左墙', rightWall: '右墙', floor: '地板', ceiling: '天花板' };
const SURFACE_ORDER = ['backWall', 'leftWall', 'rightWall', 'floor', 'ceiling'];

/** 只把几何摘要写进库 —— 贴图是几 MB 的 data URL，绝不能落盘。 */
function roomSummary(room) {
  if (!room) return {};
  return {
    version: room.version,
    width: Number(room.room.width.toFixed(2)),
    height: Number(room.room.height.toFixed(2)),
    depth: Number(room.room.depth.toFixed(2)),
    slotCount: room.slots.length,
    lightCount: room.lights.length,
    surfaceCount: room.stats.surfaceCount,
    detectSource: room.detected.source,
    confidence: Number(Number(room.detected.confidence || 0).toFixed(2))
  };
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));

/**
 * detectBackWall 的 note 是结构化数据 { verticals, horizontals }，不是字符串。
 * 直接塞进 JSX 会触发 React error #31（"object with keys {verticals, horizontals}"），
 * 整个页面会白屏 —— 所以在这里翻成人话再渲染。
 */
function detectionEdges(note) {
  if (!note || typeof note !== 'object') return [];
  const verticals = Array.isArray(note.verticals) ? note.verticals : [];
  const horizontals = Array.isArray(note.horizontals) ? note.horizontals : [];
  return [
    ['左边界', verticals[0]], ['右边界', verticals[1]],
    ['上边界', horizontals[0]], ['下边界', horizontals[1]]
  ]
    .filter(([, edge]) => edge && typeof edge === 'object')
    .map(([label, edge]) => `${label} ${edge.at} · 阶跃强度 ${edge.strength} · 信噪比 ${edge.snr}`);
}

/** 在实景图上拖出一个矩形 = 手工指定后墙范围（自动识别不准时的兜底）。 */
function RectPicker({ src, rect, editing, onChange }) {
  const boxRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const pointOf = (event) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return [0, 0];
    return [clamp01((event.clientX - box.left) / box.width), clamp01((event.clientY - box.top) / box.height)];
  };
  const down = (event) => {
    if (!editing) return;
    event.preventDefault();
    const [x, y] = pointOf(event);
    setDrag({ x0: x, y0: y, x1: x, y1: y });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event) => {
    if (!drag) return;
    const [x, y] = pointOf(event);
    setDrag((current) => ({ ...current, x1: x, y1: y }));
  };
  const up = () => {
    if (!drag) return;
    const next = {
      x0: Math.min(drag.x0, drag.x1), y0: Math.min(drag.y0, drag.y1),
      x1: Math.max(drag.x0, drag.x1), y1: Math.max(drag.y0, drag.y1)
    };
    setDrag(null);
    // 太小的框基本是误触，忽略掉
    if (next.x1 - next.x0 < 0.06 || next.y1 - next.y0 < 0.06) return;
    onChange(next);
  };
  const shown = drag
    ? { x0: Math.min(drag.x0, drag.x1), y0: Math.min(drag.y0, drag.y1), x1: Math.max(drag.x0, drag.x1), y1: Math.max(drag.y0, drag.y1) }
    : rect;

  return <div
    className={`gv-rect ${editing ? 'editing' : ''}`}
    ref={boxRef}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
  >
    <img src={src} alt="展厅实景图" draggable={false} />
    {shown ? <div className="gv-rect-box" style={{
      left: `${shown.x0 * 100}%`, top: `${shown.y0 * 100}%`,
      width: `${(shown.x1 - shown.x0) * 100}%`, height: `${(shown.y1 - shown.y0) * 100}%`
    }}><i /><i /><i /><i /></div> : null}
  </div>;
}

function VenueEditor({ venues, setVenues, setToast }) {
  const [editingId, setEditingId] = useState(venues[0]?.id || '');
  const editing = venues.find((item) => item.id === editingId) || venues[0] || null;
  const [draft, setDraft] = useState(() => (editing ? { ...editing } : null));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rectMode, setRectMode] = useState(false);
  const [room, setRoom] = useState(null);
  const [reconState, setReconState] = useState('idle');
  const [reconError, setReconError] = useState('');
  const [artworks, setArtworks] = useState([]);
  const fileRef = useRef(null);

  useEffect(() => { setDraft(editing ? { ...editing } : null); setRectMode(false); }, [editingId, venues.length]);

  const photoSrc = venuePhotoSrc(draft);
  const optionsKey = JSON.stringify(draft?.options || {});
  const rectKey = JSON.stringify(draft?.rectOverride || null);

  // 实景图 / 参数 / 手工框选 三者任一变化 → 立刻重算，并把过程展示出来
  useEffect(() => {
    if (!draft || !photoSrc) { setRoom(null); setReconState('idle'); return undefined; }
    let active = true;
    setReconState('running');
    setReconError('');
    const timer = setTimeout(() => {
      reconstructGalleryRoom({
        source: photoSrc,
        options: draft.options || {},
        overrideRect: draft.rectOverride || null
      }).then((result) => {
        if (!active) return;
        setRoom(result);
        setReconState('done');
      }).catch((error) => {
        if (!active) return;
        setRoom(null);
        setReconError(error?.message || '重建失败');
        setReconState('error');
      });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSrc, optionsKey, rectKey, draft?.id]);

  // 预览作品：复用内置示例，走真实装裱管线
  useEffect(() => {
    let active = true;
    (async () => {
      const preset = { spec: {} };
      const list = await resolveExhibitionArtworks(
        DEMO_ARTWORKS.slice(0, 5).map((demo) => ({
          id: `demo-art-${demo.variant}`, source: 'demo', variant: demo.variant,
          student: demo.student, title: demo.title, date: demo.date
        })),
        { preset }
      );
      if (active) setArtworks(list);
    })().catch(() => {});
    return () => { active = false; };
  }, []);

  const patch = (key, value) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const patchOption = (key, value) => setDraft((current) => (
    current ? { ...current, options: { ...(current.options || {}), [key]: value } } : current
  ));

  const onPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const shot = await shrinkImageFile(file, { maxEdge: 1600, quality: 0.88 });
      setDraft((current) => (current ? {
        ...current,
        photo: { url: '', blob: shot.dataUrl, name: shot.name, width: shot.width, height: shot.height },
        rectOverride: null,
        builtin: false
      } : current));
      setRectMode(false);
      setToast('实景图已替换，正在重新识别后墙与房间尺寸');
    } catch (error) {
      setToast(error?.message || '图片读取失败，请换一张 JPG / PNG。');
    } finally {
      setUploading(false);
    }
  };

  const restoreDefault = () => {
    const seed = seedGalleryVenues[0];
    setDraft((current) => (current ? { ...current, photo: { ...seed.photo }, rectOverride: null, builtin: true } : current));
    setToast('已恢复内置默认实景图');
  };

  const commit = async () => {
    if (!draft) return;
    const next = { ...draft, room: roomSummary(room), updatedAt: new Date().toISOString() };
    const list = venues.some((item) => item.id === next.id)
      ? venues.map((item) => (item.id === next.id ? next : item))
      : [...venues, next];
    setVenues(list);
    setDraft(next);
    setSaving(true);
    try { await saveRemoteGalleryVenue(next); setToast(`展厅「${next.name}」已保存，家长端即可走进这间展厅`); }
    catch { setToast('已保存到本地；云端暂未连通，稍后可重试。'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    const target = venues.find((item) => item.id === id);
    if (target?.builtin) { setToast('内置展厅不可删除，可先停用或直接替换实景图'); return; }
    const list = venues.filter((item) => item.id !== id);
    setVenues(list);
    setEditingId(list[0]?.id || '');
    try { await deleteRemoteGalleryVenue(id); setToast('展厅已删除'); }
    catch { setToast('已从本地移除，云端删除未成功。'); }
  };

  const detected = room?.detected;

  return <div className="split-page framing-settings gallery-admin">
    <div className="panel persona-list">
      <div className="panel-head"><h2>展厅地点</h2><small>{venues.length} 间</small></div>
      {venues.map((venue) => <button key={venue.id} className={venue.id === editingId ? 'active' : ''} onClick={() => setEditingId(venue.id)}>
        <span className="gv-dot" />
        <div><b>{venue.name}</b><small>{venue.location || '未填写地点'}</small></div>
        <em>{venue.builtin ? '内置' : venue.enabled === false ? '已停用' : '启用中'}</em>
      </button>)}
      <button className="gv-add" onClick={() => {
        const next = createEmptyGalleryVenue();
        setVenues([...venues, next]);
        setEditingId(next.id);
        setToast('已新增展厅，请上传一张正对展厅的实景图');
      }}><Plus size={15} />新增展厅</button>
    </div>

    <div className="panel persona-editor">
      {draft ? <>
        <div className="panel-head">
          <div><h2>{draft.name || '未命名展厅'}</h2><p>上传实景图 → 系统按照片几何重建 3D 空间 → 画展作品自动上墙。</p></div>
          <div className="row-actions">
            <button className="text-link" disabled={saving} onClick={commit}>{saving ? '保存中…' : '保存到云端'}</button>
            <button className="icon-btn danger-text" title="删除" onClick={() => remove(draft.id)}><Trash2 size={16} /></button>
          </div>
        </div>

        <div className="form-grid compact">
          <label>展厅名称<input value={draft.name || ''} onChange={(event) => patch('name', event.target.value)} /></label>
          <label>地点<input value={draft.location || ''} placeholder="例如 星河校区 · 一层" onChange={(event) => patch('location', event.target.value)} /></label>
        </div>
        <label className="persona-field">展厅说明<textarea rows={2} value={draft.description || ''} placeholder="例如：长进深展厅，两侧壁灯洗墙，天花一条轨道射灯。适合班级群展与学期汇报展。" onChange={(event) => patch('description', event.target.value)} /></label>

        <div className="gv-photo-block">
          <div className="gv-photo-main">
            {photoSrc ? <RectPicker
              src={photoSrc}
              rect={draft.rectOverride || detected?.rect || null}
              editing={rectMode}
              onChange={(rect) => { patch('rectOverride', rect); setRectMode(false); setToast('已按手工框选的后墙重算房间'); }}
            /> : <div className="gv-photo-empty"><ImagePlus size={26} /><span>还没有实景图</span><small>上传一张站在展厅里、正对后墙拍的照片</small></div>}
          </div>
          <div className="gv-photo-side">
            <div className="gv-photo-actions">
              <Button icon={UploadCloud} disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? '处理中…' : '上传实景图'}</Button>
              {draft.builtin ? <button className="text-link" onClick={restoreDefault}>恢复内置默认图</button> : null}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />

            <div className="gv-photo-meta">
              <span><MapPin size={13} />{draft.photo?.name || '内置默认实景图'}</span>
              {draft.photo?.width ? <span>{draft.photo.width} × {draft.photo.height}</span> : null}
            </div>

            <div className={`gv-rect-toggle ${rectMode ? 'on' : ''}`}>
              <button onClick={() => setRectMode((value) => !value)}><Crosshair size={15} />{rectMode ? '在图上拖出后墙范围…' : '手动画框指定后墙'}</button>
              {draft.rectOverride ? <button className="text-link" onClick={() => { patch('rectOverride', null); setToast('已恢复自动识别'); }}>清除手工框选</button> : null}
            </div>
            <p className="gv-tip">自动识别不准（例如画面里有两道深色墙缝）时，用手工框选把后墙的上下左右四条边拖准，重建会立刻跟着变。</p>

            <div className="gv-diagnose">
              <div className="gv-diagnose-head"><ScanEye size={15} />识别诊断</div>
              {reconState === 'running' ? <p className="gv-pending">正在按实景图重建…</p> : null}
              {reconState === 'error' ? <p className="gv-fail"><CircleAlert size={14} />{reconError}</p> : null}
              {reconState === 'done' && room ? <>
                <div className="gv-kv"><span>后墙来源</span><b>{detected.source === 'manual' ? '人工框选' : detected.source === 'detected' ? '自动识别' : '回退默认'}</b></div>
                <div className="gv-kv"><span>置信度</span><b>{Math.round((detected.confidence || 0) * 100)}%</b></div>
                <div className="gv-kv"><span>房间尺寸</span><b>{room.room.width.toFixed(2)} × {room.room.height.toFixed(2)} × {room.room.depth.toFixed(2)} m</b></div>
                <div className="gv-kv"><span>墙面槽位</span><b>{room.slots.length} 个</b></div>
                <div className="gv-kv"><span>识别灯位</span><b>{room.lights.length} 处</b></div>
                <div className="gv-kv"><span>耗时</span><b>{room.stats.ms} ms</b></div>
                {detectionEdges(detected.note).length ? <div className="gv-edges">
                  <span className="gv-edges-title">识别到的四条棱</span>
                  {detectionEdges(detected.note).map((line) => <span key={line}>{line}</span>)}
                </div> : null}
              </> : null}
            </div>
          </div>
        </div>

        <div className="gv-fields">
          {VENUE_OPTION_FIELDS.map((field) => <label key={field.key} className="gv-field">
            <span>{field.label}</span>
            <div>
              <input
                type="number" min={field.min} max={field.max} step={field.step}
                value={draft.options?.[field.key] ?? DEFAULT_VENUE_OPTIONS[field.key]}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  patchOption(field.key, value);
                }}
              />
              <em>{field.unit}</em>
            </div>
            <small>{field.hint}</small>
          </label>)}
        </div>

        {room ? <div className="gv-surfaces">
          <div className="gv-section-head"><h3>按实景图矫正出来的墙面贴图</h3><small>这五张就是 3D 展厅里真正贴上去的材质 —— 不是纯色，是照片本身</small></div>
          <div className="gv-surface-grid">
            {SURFACE_ORDER.map((key) => (room.textures[key] ? <figure key={key}>
              <img src={room.textures[key].url} alt={`${SURFACE_LABELS[key]}矫正贴图`} />
              <figcaption>{SURFACE_LABELS[key]}<em>{room.textures[key].width}×{room.textures[key].height}</em></figcaption>
            </figure> : null))}
          </div>
        </div> : null}

        {room ? <div className="gv-preview">
          <div className="gv-section-head"><h3>3D 预览</h3><small>示例作品按真实装裱管线现画，挂在重建出来的墙上</small></div>
          <GalleryViewer venue={draft} artworks={artworks} height={430} />
        </div> : null}

        <div className="gv-flags">
          <label className="framing-enable"><input type="checkbox" checked={draft.enabled !== false} onChange={(event) => patch('enabled', event.target.checked)} /> 在展陈端可选</label>
        </div>
      </> : <p className="persona-empty">选择左侧的一间展厅，或新增一间。</p>}
    </div>
  </div>;
}

function ExhibitionEditor({ venues, exhibitions, setExhibitions, records = [], framingPresets = [], setToast }) {
  const [editingId, setEditingId] = useState(exhibitions[0]?.id || '');
  const editing = exhibitions.find((item) => item.id === editingId) || exhibitions[0] || null;
  const [draft, setDraft] = useState(() => (editing ? { ...editing } : null));
  const [resolved, setResolved] = useState([]);
  const [progress, setProgress] = useState(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState('record');
  const uploadRef = useRef(null);

  useEffect(() => { setDraft(editing ? { ...editing } : null); }, [editingId, exhibitions.length]);

  const venue = venues.find((item) => item.id === draft?.venueId) || venues[0] || null;
  const preset = framingPresets.find((item) => item.id === draft?.framePresetId)
    || framingPresets.find((item) => item.enabled !== false) || framingPresets[0] || null;
  const artworkKey = JSON.stringify(draft?.artworks || []);
  const specKey = JSON.stringify(preset?.spec || {});
  const archivableRecords = records.filter((record) => record.artworkUrl);

  // 作品清单 / 装裱方案变了就重新布展；单幅装裱结果有缓存，来回勾选不会重复渲染
  useEffect(() => {
    if (!draft) { setResolved([]); return undefined; }
    let active = true;
    let timer = null;
    setProgress({ done: 0, total: (draft.artworks || []).length });
    timer = setTimeout(() => {
      resolveExhibitionArtworks(draft.artworks || [], {
        records, preset, onProgress: (state) => { if (active) setProgress(state); }
      }).then((list) => { if (active) { setResolved(list); setProgress(null); } })
        .catch(() => { if (active) setProgress(null); });
    }, 320);
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkKey, specKey, draft?.venueId, records]);

  const patch = (key, value) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const selected = new Set((draft?.artworks || []).map((item) => item.id));
  const toggleEntry = (entry) => {
    const list = draft?.artworks || [];
    patch('artworks', selected.has(entry.id) ? list.filter((item) => item.id !== entry.id) : [...list, entry]);
  };
  const addDemo = () => {
    const list = draft?.artworks || [];
    const ids = new Set(list.map((item) => item.id));
    patch('artworks', [...list, ...demoArtworkEntries().filter((item) => !ids.has(item.id))]);
    setToast(`已加入 ${DEMO_ARTWORKS.length} 幅示例作品`);
  };

  const onUpload = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    const added = [];
    for (const file of files) {
      try {
        const shot = await shrinkImageFile(file, { maxEdge: 1400, quality: 0.9 });
        added.push(artworkFromUpload({
          imageUrl: shot.dataUrl,
          student: file.name.replace(/\.[^.]+$/, ''),
          title: '未命名作品'
        }));
      } catch { /* 单张失败跳过 */ }
    }
    if (added.length) patch('artworks', [...(draft?.artworks || []), ...added]);
    setToast(`已加入 ${added.length} 幅本地上传作品`);
  };

  const commit = async () => {
    if (!draft) return;
    const next = { ...draft, updatedAt: new Date().toISOString() };
    const list = exhibitions.some((item) => item.id === next.id)
      ? exhibitions.map((item) => (item.id === next.id ? next : item))
      : [...exhibitions, next];
    setExhibitions(list);
    setDraft(next);
    setSaving(true);
    try { await saveRemoteGalleryExhibition(next); setToast(`画展「${next.title}」已保存，共 ${(next.artworks || []).length} 幅作品`); }
    catch { setToast('已保存到本地；云端暂未连通，稍后可重试。'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    const list = exhibitions.filter((item) => item.id !== id);
    setExhibitions(list);
    setEditingId(list[0]?.id || '');
    try { await deleteRemoteGalleryExhibition(id); setToast('画展已删除'); }
    catch { setToast('已从本地移除，云端删除未成功。'); }
  };

  const slotCount = venue?.room?.slotCount || 0;

  return <div className="split-page framing-settings gallery-admin">
    <div className="panel persona-list">
      <div className="panel-head"><h2>画展</h2><small>{exhibitions.length} 场</small></div>
      {exhibitions.map((item) => <button key={item.id} className={item.id === editingId ? 'active' : ''} onClick={() => setEditingId(item.id)}>
        <span className={`gv-dot ${item.status === 'open' ? 'on' : ''}`} />
        <div><b>{item.title}</b><small>{item.subtitle || '未填副标题'} · {(item.artworks || []).length} 幅</small></div>
        <em>{item.status === 'open' ? '展出中' : '草稿'}</em>
      </button>)}
      <button className="gv-add" onClick={() => {
        const next = createEmptyGalleryExhibition();
        setExhibitions([...exhibitions, next]);
        setEditingId(next.id);
      }}><Plus size={15} />新增画展</button>
    </div>

    <div className="panel persona-editor">
      {draft ? <>
        <div className="panel-head">
          <div><h2>{draft.title || '未命名画展'}</h2><p>选展厅 → 选作品 → 一键布展，作品会以装裱好的整张图挂上墙。</p></div>
          <div className="row-actions">
            <button className="text-link" disabled={saving} onClick={commit}>{saving ? '保存中…' : '保存到云端'}</button>
            <button className="icon-btn danger-text" title="删除" onClick={() => remove(draft.id)}><Trash2 size={16} /></button>
          </div>
        </div>

        <div className="form-grid compact">
          <label>画展名称<input value={draft.title || ''} onChange={(event) => patch('title', event.target.value)} /></label>
          <label>副标题<input value={draft.subtitle || ''} placeholder="例如 第二届少儿绘画年度展" onChange={(event) => patch('subtitle', event.target.value)} /></label>
          <label>展出展厅<select value={draft.venueId || ''} onChange={(event) => patch('venueId', event.target.value)}>
            {venues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>装裱方案<select value={draft.framePresetId || ''} onChange={(event) => patch('framePresetId', event.target.value)}>
            <option value="">跟随老师端默认装裱</option>
            {framingPresets.filter((item) => item.enabled !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>开始日期<input value={draft.startDate || ''} placeholder="2026.10.01" onChange={(event) => patch('startDate', event.target.value)} /></label>
          <label>结束日期<input value={draft.endDate || ''} placeholder="2026.11.30" onChange={(event) => patch('endDate', event.target.value)} /></label>
        </div>
        <label className="persona-field">画展导语<textarea rows={2} value={draft.description || ''} onChange={(event) => patch('description', event.target.value)} /></label>

        <div className="gv-picker">
          <div className="gv-section-head">
            <h3>选作品</h3>
            <small>已选 <b>{(draft.artworks || []).length}</b> 幅{slotCount ? ` · 这间展厅有 ${slotCount} 个槽位` : ''}</small>
          </div>
          <div className="gv-picker-tabs">
            <button className={picker === 'record' ? 'active' : ''} onClick={() => setPicker('record')}>课后反馈作品 ({archivableRecords.length})</button>
            <button className={picker === 'demo' ? 'active' : ''} onClick={() => setPicker('demo')}>示例作品 ({DEMO_ARTWORKS.length})</button>
            <button className={picker === 'upload' ? 'active' : ''} onClick={() => setPicker('upload')}>本地上传</button>
          </div>

          {picker === 'record' ? (archivableRecords.length ? <div className="gv-art-grid">
            {archivableRecords.map((record) => {
              const entry = artworkFromRecord(record);
              return <button key={record.id} className={`gv-art ${selected.has(entry.id) ? 'selected' : ''}`} onClick={() => toggleEntry(entry)}>
                <img src={record.artworkUrl} alt={record.title} />
                <b>{record.title}</b>
                <small>{record.student} · {record.date}</small>
                <em>{selected.has(entry.id) ? '已选' : '选中'}</em>
              </button>;
            })}
          </div> : <p className="persona-empty">还没有带作品的课后反馈记录。老师完成一次课后反馈后，作品会自动出现在这里。</p>) : null}

          {picker === 'demo' ? <div className="gv-art-grid">
            <div className="gv-demo-head">
              <p>仓库里没有真实儿童画素材，示例作品是用 canvas 现画、再走**真实装裱管线**做出来的，用来把画展布起来看效果。</p>
              <Button icon={Sparkles} onClick={addDemo}>全部加入</Button>
            </div>
            {DEMO_ARTWORKS.map((demo) => {
              const entry = demoArtworkEntries().find((item) => item.variant === demo.variant);
              const framed = resolved.find((item) => item.id === entry.id);
              return <button key={demo.variant} className={`gv-art ${selected.has(entry.id) ? 'selected' : ''}`} onClick={() => toggleEntry(entry)}>
                <div className="gv-art-thumb">{framed ? <img src={framed.imageUrl} alt={demo.title} /> : <span className="gv-art-loading">装裱中…</span>}</div>
                <b>{demo.title}</b>
                <small>{demo.student} · {demo.date}</small>
                <em>{selected.has(entry.id) ? '已选' : '选中'}</em>
              </button>;
            })}
          </div> : null}

          {picker === 'upload' ? <div className="gv-upload">
            <button className="gv-upload-drop" onClick={() => uploadRef.current?.click()}><UploadCloud size={22} /><b>上传作品原图</b><small>系统会用当前装裱方案给它做框，与其它作品保持一致</small></button>
            <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={onUpload} />
            {(draft.artworks || []).filter((item) => item.source === 'upload').length ? <div className="gv-art-grid">
              {(draft.artworks || []).filter((item) => item.source === 'upload').map((entry) => <button key={entry.id} className="gv-art selected" onClick={() => toggleEntry(entry)}>
                <img src={entry.imageUrl} alt={entry.title} />
                <b>{entry.title}</b><small>{entry.student}</small><em>已选</em>
              </button>)}
            </div> : null}
          </div> : null}
        </div>

        <div className="gv-booth">
          <div className="gv-section-head">
            <h3>布展预览</h3>
            <small>{progress ? `正在装裱第 ${Math.min(progress.done + 1, progress.total)} / ${progress.total} 幅…` : `已生成 ${resolved.length} 幅可上墙作品`}</small>
          </div>
          {venue ? <GalleryViewer venue={venue} artworks={resolved} height={470} /> : <p className="persona-empty">先选一间展厅。</p>}
        </div>

        <div className="gv-flags">
          <label className="framing-enable"><input type="checkbox" checked={draft.status === 'open'} onChange={(event) => patch('status', event.target.checked ? 'open' : 'draft')} /> 对外展出（老师在展陈页可见）</label>
          <button className="text-link" onClick={() => { clearFramedArtworkCache(); setToast('装裱缓存已清空，下次预览会重新生成'); }}>清空装裱缓存</button>
        </div>
      </> : <p className="persona-empty">选择左侧的一场画展，或新增一场。</p>}
    </div>
  </div>;
}

export default function GalleryAdminPage({
  galleryVenues = [], setGalleryVenues, galleryExhibitions = [], setGalleryExhibitions,
  records = [], framingPresets = [], setToast
}) {
  const [tab, setTab] = useState('venue');
  const counts = useMemo(() => ({
    venues: galleryVenues.length,
    exhibitions: galleryExhibitions.length,
    artworks: galleryExhibitions.reduce((sum, item) => sum + (item.artworks || []).length, 0)
  }), [galleryVenues, galleryExhibitions]);

  return <>
    <PageHeader
      title="3D 画廊"
      desc="上传展厅实景图，系统按照片里的真实几何重建 3D 空间；学生作品以装裱好的整张图挂上墙，家长可以走进展厅看展。"
      prd="PRD-11 / F-GALLERY-ADM-01"
      actions={<span className="gv-head-stat"><Landmark size={16} />{counts.venues} 间展厅 · {counts.exhibitions} 场画展 · {counts.artworks} 幅备用作品</span>}
    />
    <div className="gv-tabs">
      <button className={tab === 'venue' ? 'active' : ''} onClick={() => setTab('venue')}><Landmark size={15} />展厅地点</button>
      <button className={tab === 'exhibition' ? 'active' : ''} onClick={() => setTab('exhibition')}><RefreshCw size={15} />画展布置</button>
    </div>
    {tab === 'venue'
      ? <VenueEditor venues={galleryVenues} setVenues={setGalleryVenues} setToast={setToast} />
      : <ExhibitionEditor
        venues={galleryVenues} exhibitions={galleryExhibitions} setExhibitions={setGalleryExhibitions}
        records={records} framingPresets={framingPresets} setToast={setToast}
      />}
  </>;
}
