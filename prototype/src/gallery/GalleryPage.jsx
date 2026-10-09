// 展陈端的 3D 画廊：老师 / 家长 / 管理员都能走进展厅看孩子们的画展。
//
// 这里只做展示，不做维护 —— 展厅与画展都在管理员端「3D 画廊」里配置好。
// 作品框不是另画的：直接复用画展配置的装裱方案，和课后反馈里那一幅是同一个渲染管线。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Landmark, MapPin, MousePointerClick, WandSparkles } from 'lucide-react';
import { PageHeader, Button } from '../ui';
import GalleryViewer from './GalleryViewer';
import { DEMO_ARTWORKS } from './demoArtwork';
import { demoArtworkEntries, resolveExhibitionArtworks } from './exhibitionArtworks';

export default function GalleryPage({ galleryVenues = [], galleryExhibitions = [], records = [], framingPresets = [], setToast }) {
  const openExhibitions = useMemo(
    () => galleryExhibitions.filter((item) => item.status === 'open' && item.enabled !== false),
    [galleryExhibitions]
  );
  const [activeId, setActiveId] = useState('');
  const [artworks, setArtworks] = useState([]);
  const [progress, setProgress] = useState(null);
  const [picked, setPicked] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const viewerRef = useRef(null);

  useEffect(() => {
    if (!openExhibitions.length) { setActiveId(''); return; }
    if (!openExhibitions.some((item) => item.id === activeId)) setActiveId(openExhibitions[0].id);
  }, [openExhibitions, activeId]);

  const exhibition = openExhibitions.find((item) => item.id === activeId) || null;
  const venue = galleryVenues.find((item) => item.id === exhibition?.venueId)
    || galleryVenues.find((item) => item.enabled !== false) || galleryVenues[0] || null;
  const preset = framingPresets.find((item) => item.id === exhibition?.framePresetId)
    || framingPresets.find((item) => item.enabled !== false) || framingPresets[0] || null;

  const entries = demoMode ? demoArtworkEntries() : (exhibition?.artworks || []);
  const entriesKey = JSON.stringify(entries);

  useEffect(() => {
    let active = true;
    let timer = null;
    setPicked(null);
    if (!entries.length) { setArtworks([]); setProgress(null); return undefined; }
    setProgress({ done: 0, total: entries.length });
    timer = setTimeout(() => {
      resolveExhibitionArtworks(entries, {
        records, preset, onProgress: (state) => { if (active) setProgress(state); }
      }).then((list) => { if (active) { setArtworks(list); setProgress(null); } })
        .catch(() => { if (active) { setArtworks([]); setProgress(null); } });
    }, 260);
    return () => { active = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesKey, records, preset?.id, preset?.spec]);

  useEffect(() => { setDemoMode(false); }, [activeId]);

  const totalEntries = entryCountOf(exhibition) + (demoMode ? DEMO_ARTWORKS.length : 0);
  // 只要有一间展厅就把 3D 场景挂起来 —— 空展厅也让人走进去，
  // 免得看完"空展"提示、点了按钮，才开始等重建 + 装裱两段加载。
  const canShow = Boolean(venue);

  return <>
    <PageHeader
      title="3D 画廊"
      desc="走进按实景照片重建的展厅，看装裱好的作品挂在墙上。点击任意一幅，镜头会带你走近它。"
      prd="PRD-11 / F-GALLERY-01"
      actions={openExhibitions.length > 1 ? <div className="gv-ex-switch">
        {openExhibitions.map((item) => <button key={item.id} className={item.id === activeId ? 'active' : ''} onClick={() => setActiveId(item.id)}>{item.title}</button>)}
      </div> : null}
    />

    {!galleryVenues.length ? <div className="gv-blank">
      <CircleAlert size={26} /><b>还没有配置展厅</b>
      <p>请管理员先在「3D 画廊设置」里上传一张展厅实景图。</p>
    </div> : null}

    {galleryVenues.length ? <>
      <div className="gv-ex-bar">
        <div className="gv-ex-info">
          <span className="gv-ex-badge"><Landmark size={14} />{venue?.name || '未命名展厅'}</span>
          {venue?.location ? <span><MapPin size={13} />{venue.location}</span> : null}
          {exhibition ? <b>{exhibition.title}{exhibition.subtitle ? ` · ${exhibition.subtitle}` : ''}</b> : <b>{demoMode ? '示例布展（未接入正式画展）' : '尚未安排画展'}</b>}
          {exhibition?.startDate || exhibition?.endDate
            ? <em>{exhibition.startDate || '—'} ~ {exhibition.endDate || '—'}</em> : null}
        </div>
        <div className="gv-ex-actions">
          {!totalEntries ? <Button
            icon={WandSparkles}
            onClick={() => {
              setDemoMode(true);
              setToast('正在用真实装裱管线现画 5 幅示例作品，稍等片刻');
            }}
          >预览示例布展</Button> : null}
          {demoMode ? <button className="text-link" onClick={() => setDemoMode(false)}>切回正式画展</button> : null}
        </div>
      </div>

      {exhibition?.description && !demoMode ? <p className="gv-ex-desc">{exhibition.description}</p> : null}

      {!totalEntries && !progress && !demoMode ? <p className="gv-ex-desc">这场画展还没有作品上墙。管理员在「3D 画廊 → 画展布置」里把作品选进来后，这里就会挂满画。</p> : null}

      {canShow ? <div className="gv-stage-layout">
        <div className="gv-main">
          <GalleryViewer
            ref={viewerRef}
            venue={venue}
            artworks={artworks}
            height={560}
            onPick={(record) => setPicked(withImage(record, artworks))}
          />
          {progress ? <div className="gv-progress">正在装裱第 {Math.min(progress.done + 1, progress.total)} / {progress.total} 幅作品…</div> : null}
        </div>

        <aside className="gv-side">
          {picked ? <div className="gv-detail">
            {picked.imageUrl ? <img src={picked.imageUrl} alt={picked.title} /> : null}
            <b>{picked.title || '未命名作品'}</b>
            <span>{picked.student}{picked.date ? ` · ${picked.date}` : ''}</span>
            <small>展签信息来自课后反馈记录；画框由管理员配置的装裱方案渲染。</small>
          </div> : <div className="gv-detail empty">
            <MousePointerClick size={20} />
            <b>点击墙上的作品</b>
            <span>点击可以走近看，也能在下面这排里直接挑。</span>
          </div>}

          <div className="gv-section-head"><h3>展出作品</h3><small>{artworks.length} 幅</small></div>
          <div className="gv-thumbs">
            {(artworks.length ? artworks : entries).map((item) => <button
              key={item.id}
              className={picked?.id === item.id ? 'active' : ''}
              onClick={() => {
                const record = viewerRef.current?.focusArtwork(item.id);
                setPicked(withImage(record || item, artworks));
              }}
            >
              {item.imageUrl ? <img src={item.imageUrl} alt={item.title} /> : <span className="gv-thumb-loading" />}
              <b>{item.title || '未命名作品'}</b>
              <small>{item.student}</small>
            </button>)}
          </div>
        </aside>
      </div> : null}
    </> : null}
  </>;
}

/**
 * three.js 场景回传的作品记录只有几何与展签信息，没有图片地址。
 * 缩略图列表里才有 imageUrl —— 两边合一下，展签卡片才不会渲染出一个空 img。
 */
function withImage(record, artworks) {
  if (!record) return null;
  if (record.imageUrl) return record;
  const full = artworks.find((item) => item.id === record.id);
  return full ? { ...record, imageUrl: full.imageUrl } : record;
}

function entryCountOf(exhibition) {
  return (exhibition?.artworks || []).length;
}
