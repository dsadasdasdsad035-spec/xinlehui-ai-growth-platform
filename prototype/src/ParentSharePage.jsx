import React, { useMemo } from 'react';
import { Archive, CircleAlert, Link2 } from 'lucide-react';
import { parentShareView } from './data/parentShareView';
// 家长分享页（[第四步 US-210] / F-ARCHIVE-SHARE-01）：家长点开 `/p/<shareToken>` 看到的那一页。
//
// 这一页只做两件事：
//  ① **记一次打开**（由 App 进页面时通过 `data/shareForward.js` 的 `applyShareOpen` 落到令牌账上：
//     首次打开写 `firstOpenedAt`、每次打开 `openCount` 自增，老师端刷新后就能看到「家长看没看」）；
//  ② **渲染内容**：课次日期 / 成品作品图 / 课堂照片 / 五维点评（老师确认后的版本）+ 机构视觉 + 390px 适配。
//
// 组件里**没有任何状态判断与文案**：四种令牌状态（可用 / 已过期 / 已撤回 / 链接不存在）的整份读数、
// 内容的白名单裁剪、占位口径、打开回执与页脚说明全在 `data/parentShareView.js`（零依赖纯函数，
// 可 `node` 直跑断言）。家长端只读：这一页没有按钮、没有链接、没有输入框，也没有「复制 / 转发」入口
// —— 转发永远发生在老师那一侧（第四步的「家长分享」面板）。

export { PARENT_SHARE_OPEN_RECORDED_NOTE } from './data/parentShareView';

/** 成品作品图：有 https 持久地址就出图，否则显示「图片同步中」占位或一句说明（绝不出现破图）。 */
function ParentArtwork({ view }) {
  const state = view.artwork.url ? 'ready' : (view.artwork.placeholder ? 'placeholder' : 'empty');
  return <figure className="parent-share-artwork" data-parent-share-artwork={state} data-parent-share-artwork-status={view.artwork.placeholderText || ''}>
    {view.artwork.url
      ? <img src={view.artwork.url} alt={view.artwork.alt} data-parent-share-artwork-img="true"/>
      : <span className="parent-share-media-hold" data-parent-share-artwork-hold="true">{view.artwork.placeholderText || view.artwork.note}</span>}
    <figcaption data-parent-share-artwork-caption="true">{view.sectionTitles.artwork}{view.title ? ` · 《${view.title}》` : ''}</figcaption>
  </figure>;
}

/** 课堂照片：逐张出图；没同步到的显示占位（家长端只看得到 https 持久地址）。 */
function ParentPhotos({ view }) {
  return <section className="parent-share-photos" data-parent-share-photos={view.photos.length} data-parent-share-photo-count={view.photoCount} data-parent-share-photo-total={view.photoTotal}>
    <h2>{view.sectionTitles.photos}</h2>
    <div className="parent-share-photo-grid">
      {view.photos.map((photo, index) => (photo.url
        ? <img key={`${photo.url}-${index}`} src={photo.url} alt={photo.alt} data-parent-share-photo="true" data-parent-share-photo-index={index}/>
        : <span className="parent-share-media-hold" key={`hold-${index}`} data-parent-share-photo="placeholder" data-parent-share-photo-index={index}>{photo.placeholderText}</span>))}
    </div>
    <p className="parent-share-note" data-parent-share-photos-note="true">{view.photosNote}</p>
  </section>;
}

/** 五维点评：只有老师写了正文的维度才出现（空维度不占位、更不编一段示例文案）。 */
function ParentReviews({ view }) {
  return <section className="parent-share-reviews" data-parent-share-reviews={view.dimensionCount} data-parent-share-review-total={view.dimensionTotal}>
    <h2>{view.sectionTitles.reviews}</h2>
    {view.dimensions.length
      ? <dl>{view.dimensions.map(row => <div key={row.name} data-parent-share-dimension="true" data-parent-share-dimension-name={row.name}>
        <dt>{row.name}</dt>
        <dd>{row.text}</dd>
      </div>)}</dl>
      : <p className="parent-share-note" data-parent-share-reviews-note="true">{view.reviewsNote}</p>}
  </section>;
}

/** 缺课记录：沿用成长档案里那句温暖的话（老师写了就用老师写的）。 */
function ParentAbsence({ view }) {
  return <section className="parent-share-absence" data-parent-share-absence="true">
    <b>{view.absenceTitle}</b>
    <p>{view.absenceText}</p>
  </section>;
}

/**
 * 成片块（[第四步 US-219]）：一个**竖屏 9:16** 的播放器 + 这条成片的信息。
 *
 * 「不显示假 mp4」是结构性的：只有渲染服务的成片（https 持久地址）才有 `src`，
 * 否则 `<video>` 不设 `src`、也不渲染任何 `<source>`，上面盖一层如实的占位说明。
 * `playsinline` 是硬要求（微信内置浏览器 / iOS Safari 里点开不跳全屏）—— 属性就在这里写一次。
 */
function ParentVideo({ view }) {
  const player = view.video.player;
  return <section className="parent-share-video" data-parent-share-video="true"
    data-parent-share-video-ratio={player.ratioLabel} data-parent-share-video-ready={player.ready ? 'true' : 'false'}
    data-parent-share-video-src={player.src} data-parent-share-video-status={player.status}
    data-parent-share-video-playsinline={player.playsInline ? 'true' : 'false'} data-parent-share-video-mp4="none">
    <h2>{view.sectionTitles.video}</h2>
    <figure className="parent-share-player" style={{ aspectRatio: '9 / 16' }} data-parent-share-player="true"
      data-parent-share-player-ratio={player.ratioLabel} data-parent-share-player-src={player.src}
      data-parent-share-player-playsinline={player.playsInline ? 'true' : 'false'}>
      <video className="parent-share-player-video" playsInline webkit-playsinline="true" preload="none"
        controls={player.ready} src={player.src || undefined} data-parent-share-player-video="true"
        aria-label="成长记录成片（竖屏 9:16）"/>
      {player.ready ? null : <figcaption className="parent-share-player-hold" data-parent-share-player-hold="true">
        <b data-parent-share-player-hold-title="true">{player.placeholderTitle}</b>
        <span data-parent-share-player-hold-text="true">{player.placeholderText}</span>
      </figcaption>}
    </figure>
    <p className="parent-share-note" data-parent-share-video-note="true">{view.video.missingNote || view.video.note}</p>
    <dl className="parent-share-video-rows">{view.video.rows.map(row => <div key={row.id} data-parent-share-video-row={row.id}>
      <dt>{row.label}</dt>
      <dd data-parent-share-video-row-value="true">{row.value}</dd>
    </div>)}</dl>
  </section>;
}

export default function ParentSharePage({ token = '', tokens = [], records = [], jobs = [], open = null, consents = null, parentScope = null, serverAccess = null }) {
  // 访问判定（[第四步 US-211]）也在这一份产物里：授权撤回 / 家长范围 / 服务端拒绝都会让 `contentVisible`
  // 结构性为假（页面上不出现这个孩子的任何信息），并给出 `access.reason` 那一句。
  const view = useMemo(() => parentShareView({ tokens, token, records, jobs, open, consents, parentScope, serverAccess }), [tokens, token, records, jobs, open, consents, parentScope, serverAccess]);
  return <div className="parent-share-open" data-parent-share="true" data-parent-share-token={token} data-parent-share-state={view.state} data-parent-share-status-label={view.statusLabel} data-parent-share-found={view.found ? 'true' : 'false'} data-parent-share-active={view.active ? 'true' : 'false'} data-parent-share-content-visible={view.contentVisible ? 'true' : 'false'} data-parent-share-kind={view.video.kind} data-parent-share-is-video={view.isVideoShare ? 'true' : 'false'} data-parent-share-access={view.accessAllowed ? 'allowed' : 'blocked'} data-parent-share-access-blocked-by={view.accessBlockedBy} data-parent-share-access-reason={view.accessReason} data-parent-share-open-count={String(view.open.count)} data-parent-share-first-opened-at={view.open.firstOpenedAt} data-parent-share-first-open={view.open.first ? 'true' : 'false'} data-parent-share-record-found={view.recordFound ? 'true' : 'false'} data-parent-share-student-value={view.student} data-parent-share-lesson-date-value={view.lessonDateText} data-parent-share-dimensions-count={String(view.dimensionCount)} data-parent-share-photos-count={String(view.photos.length)} data-parent-share-read-only="true" data-parent-share-leaks={String(view.leaks.paths.length)}>
    <header className="parent-share-brand">
      <span className="prd-tag" data-parent-share-badge="true">{view.badge}</span>
      <h1>{view.brandTitle}</h1>
      <p>{view.brandTagline}</p>
      {view.student ? <p data-parent-share-student="true">{view.studentLine}</p> : null}
    </header>
    <section className={`parent-share-body is-${view.state}`} data-parent-share-status="true">
      {view.contentVisible ? <Archive size={26}/> : <CircleAlert size={26}/>}
      <b data-parent-share-headline="true">{view.headline}</b>
      <p data-parent-share-note="true">{view.note}</p>
      {view.contentVisible && view.open.recorded ? <small data-parent-share-open-note="true">{view.open.note}</small> : null}
      <small className="parent-share-link" data-parent-share-link="true"><Link2 size={13}/>分享地址：{token ? `/p/${token}` : '（没有令牌）'}</small>
    </section>
    {view.contentVisible ? <main className="parent-share-content" data-parent-share-content="true">
      {view.lessonBlockVisible ? <div className="parent-share-lesson" data-parent-share-lesson="true" data-parent-share-lesson-date={view.lessonDateText} data-parent-share-lesson-title={view.title}>
        <b data-parent-share-lesson-date-readout="true">{view.lessonDateText || '未记录课次日期'}</b>
        {view.title ? <span>《{view.title}》</span> : null}
        {view.className ? <small>{view.className}</small> : null}
      </div> : null}
      {view.recordMissingNote ? <p className="parent-share-note" data-parent-share-record-missing="true">{view.recordMissingNote}</p> : null}
      {/* 成片分享（US-219）：先出成片那一块；本条课次的图文内容只有在本机找得到记录时才展开。 */}
      {view.isVideoShare ? <>
        {view.video.present ? <ParentVideo view={view}/> : null}
        {view.recordFound ? (view.absence
          ? <ParentAbsence view={view}/>
          : <><ParentArtwork view={view}/><ParentPhotos view={view}/><ParentReviews view={view}/></>) : null}
      </> : (view.absence
        ? <ParentAbsence view={view}/>
        : <><ParentArtwork view={view}/><ParentPhotos view={view}/><ParentReviews view={view}/></>)}
      {view.archivedText ? <small className="parent-share-archived" data-parent-share-archived="true">归档于 {view.archivedText}</small> : null}
    </main> : null}
    <footer className="parent-share-foot" data-parent-share-foot="true">
      <small data-parent-share-foot-note="true">{view.footNote}</small>
      <small data-parent-share-readonly-note="true">这一页没有编辑、删除或转发入口：内容只会由老师在归档后更新。</small>
    </footer>
  </div>;
}
