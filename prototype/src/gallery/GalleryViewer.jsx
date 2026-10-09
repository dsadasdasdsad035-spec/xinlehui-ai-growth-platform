// 3D 画廊的 React 外壳：把「实景图 → 房间几何/贴图 → three.js 场景」这条链
// 包成一个可复用的组件，管理员预览页和展陈页共用同一个。
//
// 两段式缓存：
//  1) 重建结果（贵：边检测 + 5 张梯形矫正）按「展厅 id + 图 + 参数 + 手工框选」缓存；
//  2) three.js 场景只跟重建结果绑定，作品换了不重建场景，只重新布展。

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CircleAlert, Footprints, Maximize2, Minimize2, MousePointerClick, RotateCcw, Sparkles } from 'lucide-react';
import { reconstructGalleryRoom } from '../services/roomReconstruct';
import { createGalleryScene } from '../services/galleryScene';
import { venuePhotoSrc } from '../data/galleryVenues';

/** 重建结果缓存。key 把所有会影响几何的输入都算进去。 */
const roomCache = new Map();

function roomKey(venue) {
  if (!venue) return '';
  const photo = venue.photo || {};
  const src = venuePhotoSrc(venue) || '';
  return [
    venue.id, photo.name, photo.width, photo.height, src.length, src.slice(-28),
    JSON.stringify(venue.options || {}),
    JSON.stringify(venue.rectOverride || null)
  ].join('|');
}

/** 重建（或命中缓存）。失败时把失败的 promise 从缓存里剔掉，否则会一直复现同一个错误。 */
async function buildRoom(venue, force) {
  const key = roomKey(venue);
  const hit = roomCache.get(key);
  if (hit && !force) return hit;
  const promise = reconstructGalleryRoom({
    source: venuePhotoSrc(venue),
    options: venue.options || {},
    overrideRect: venue.rectOverride || null
  }).catch((error) => {
    if (roomCache.get(key) === promise) roomCache.delete(key);
    throw error;
  });
  roomCache.set(key, promise);
  return promise;
}

const GalleryViewer = forwardRef(function GalleryViewer({
  venue,
  artworks = [],
  initialMode = 'orbit',
  onPick,
  onStatus,
  height = 460,
  className = '',
  compact = false
}, ref) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const venueRef = useRef(venue);
  const onPickRef = useRef(onPick);
  const onStatusRef = useRef(onStatus);
  const hoverRef = useRef(null);
  const forceRef = useRef(false);
  venueRef.current = venue;
  onPickRef.current = onPick;
  onStatusRef.current = onStatus;

  const [recon, setRecon] = useState(null);
  const [phase, setPhase] = useState('idle');   // idle | rebuild | scene | ready | error
  const [error, setError] = useState('');
  const [mode, setMode] = useState(initialMode);
  const [hover, setHover] = useState(null);
  const [maxed, setMaxed] = useState(false);
  const [sceneTick, setSceneTick] = useState(0);
  const [rebuildToken, setRebuildToken] = useState(0);
  const syncRef = useRef({ artworks: null, mode: null });

  const key = useMemo(() => roomKey(venue), [venue]);
  const photoSrc = venuePhotoSrc(venue);

  useEffect(() => { onStatusRef.current?.(phase); }, [phase]);

  // 对外只暴露三个动作，够展陈页做「点缩略图跳过去看」。
  useImperativeHandle(ref, () => ({
    focusArtwork: (id) => sceneRef.current?.focusArtwork?.(id) || null,
    resetView: () => sceneRef.current?.resetView?.(),
    setMode: (next) => setMode(next)
  }), []);

  // ---- 第一段：实景图 → 房间几何与贴图
  useEffect(() => {
    const current = venueRef.current;
    if (!current || !photoSrc) {
      setRecon(null);
      setPhase(current ? 'error' : 'idle');
      if (current && !photoSrc) setError('这个展厅还没有实景图，请先在管理员后台上传。');
      return undefined;
    }
    let active = true;
    const force = forceRef.current;
    forceRef.current = false;
    setPhase('rebuild');
    setError('');
    buildRoom(current, force)
      .then((result) => { if (active) { setRecon(result); setPhase('scene'); } })
      .catch((err) => {
        if (!active) return;
        setRecon(null);
        setError(err?.message || '实景图重建失败，请换一张正对展厅的照片，或在后台手动画框指定后墙。');
        setPhase('error');
      });
    return () => { active = false; };
  }, [key, photoSrc, rebuildToken]);

  // ---- 第二段：房间 → three.js 场景
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!recon || !canvas) return undefined;
    let active = true;
    let instance = null;
    setPhase('scene');
    createGalleryScene({
      canvas,
      // 注意：这里传的是重建结果里的 room **几何对象**，不是整个重建结果
      room: recon.room,
      textures: recon.textures,
      slots: recon.slots,
      lights: recon.lights,
      artworks,
      initialMode: mode,
      onPick: (hit) => onPickRef.current?.(hit),
      onHover: (hit) => {
        // 悬停回调每次 pointermove 都会来，这里只在「换了一幅」时才 setState，避免拖动时抖。
        const id = hit?.id || null;
        if (hoverRef.current === id) return;
        hoverRef.current = id;
        setHover(hit ? { id: hit.id, student: hit.student, title: hit.title } : null);
      }
    }).then((scene) => {
      if (!active) { scene.dispose?.(); return; }
      sceneRef.current = instance = scene;
      syncRef.current = { artworks, mode };
      setPhase('ready');
      setSceneTick((value) => value + 1);
    }).catch((err) => {
      if (!active) return;
      setError(err?.message || '3D 场景初始化失败（浏览器可能不支持 WebGL）。');
      setPhase('error');
    });
    return () => {
      active = false;
      if (instance) instance.dispose?.();
      if (sceneRef.current === instance) sceneRef.current = null;
    };
    // 场景只跟房间几何绑定；作品与模式走下面的增量同步，不再重建场景。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recon]);

  // ---- 场景就绪后，作品/模式的后续变化只做增量同步
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || syncRef.current.artworks === artworks) return;
    syncRef.current.artworks = artworks;
    scene.setArtworks?.(artworks);
  }, [artworks, sceneTick]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || syncRef.current.mode === mode) return;
    syncRef.current.mode = mode;
    scene.setMode?.(mode);
  }, [mode, sceneTick]);

  // 全屏切换后画布尺寸变了，等浏览器完成布局再让场景重新测量
  useEffect(() => {
    const timer = setTimeout(() => sceneRef.current?.resize?.(), 60);
    return () => clearTimeout(timer);
  }, [maxed]);

  const busy = phase === 'rebuild' || phase === 'scene';

  return <div className={`gv-viewer ${maxed ? 'maxed' : ''} ${className}`} style={maxed ? undefined : { height }}>
    <div className="gv-stage">
      <canvas ref={canvasRef} />

      <div className="gv-badges">
        {phase === 'ready' ? <span className="gv-badge ok"><Sparkles size={13} />实景图重建 · {recon?.stats?.surfaceCount || 5} 面贴图</span> : null}
        {recon && phase === 'ready'
          ? <span className="gv-badge">房间 {recon.room.width.toFixed(1)}×{recon.room.height.toFixed(1)}×{recon.room.depth.toFixed(1)} m</span>
          : null}
        {recon && phase === 'ready' ? <span className="gv-badge">{recon.slots.length} 个槽位 · 已挂 {artworks.length} 幅</span> : null}
      </div>

      {hover && phase === 'ready'
        ? <div className="gv-hover"><MousePointerClick size={13} /><b>{hover.title || '未命名作品'}</b><span>{hover.student}</span><em>点击看细节</em></div>
        : null}

      {busy ? <div className="gv-overlay">
        <div className="gv-spinner" />
        <b>{phase === 'rebuild' ? '正在按实景图重建展厅…' : '正在搭建 3D 场景…'}</b>
        <small>{phase === 'rebuild' ? '边检测 → 梯形矫正 → 生成墙面贴图' : '加载 three.js 并把照片贴到五个面上'}</small>
      </div> : null}

      {phase === 'error' ? <div className="gv-overlay error">
        <CircleAlert size={26} />
        <b>展厅没能建起来</b>
        <small>{error}</small>
        {photoSrc ? <button className="text-link" onClick={() => { forceRef.current = true; setRebuildToken((n) => n + 1); }}>再试一次</button> : null}
      </div> : null}

      {phase === 'ready' && !artworks.length ? <div className="gv-hint">
        <Sparkles size={15} />展厅已就绪，还没有作品上墙。
      </div> : null}
    </div>

    {compact ? null : <div className="gv-hud">
      <div className="gv-modes">
        <button className={mode === 'orbit' ? 'active' : ''} onClick={() => setMode('orbit')}><Sparkles size={14} />环视</button>
        <button className={mode === 'walk' ? 'active' : ''} onClick={() => setMode('walk')}><Footprints size={14} />漫游 (WASD)</button>
      </div>
      <div className="gv-actions">
        <button onClick={() => { if (mode !== 'orbit') setMode('orbit'); sceneRef.current?.resetView?.(); }}><RotateCcw size={14} />回到入口</button>
        <button onClick={() => setMaxed((v) => !v)}>{maxed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{maxed ? '退出全屏' : '全屏'}</button>
      </div>
    </div>}
  </div>;
});

export default GalleryViewer;
