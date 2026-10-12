import React, { useMemo } from 'react';
import { Archive, CircleAlert, Link2 } from 'lucide-react';
import { resolveShareToken } from './data/shareTokens';
// 家长分享页（[第四步 US-209] 的「打开」路径 / F-ARCHIVE-SHARE-01）。
//
// 家长打开 `/p/<shareToken>` 时走到这里。本组件只做两件事：
//  ① **记一次打开**（由 App 在进页面时通过 `data/shareForward.js` 的 `applyShareOpen` 落到令牌账上）——
//     首次打开写 `firstOpenedAt`，每次打开 `openCount` 自增，老师端刷新后就能看到「家长看没看」；
//  ② 按令牌状态给一句**温和**的说明（可用 / 已过期 / 已撤回 / 链接不存在），判据全部来自
//     `data/shareTokens.js` 的 `resolveShareToken`（家长端唯一的查询入口）—— 本文件不写第二套状态判断。
//
// 已知边界：页面**内容**（课次日期、成品作品图、课堂照片、五维点评、机构视觉与 390px 适配）是
// US-210 的范围（`tasks/prd-archive-share.md` 的 US-210）；本轮先把「打开记录」这条链路打通，
// 页面只呈现状态与打开回执，绝不假装内容已经齐全。家长端只读：没有任何编辑、删除或转发入口。

/** 打开成功时的一行回执（老师端看不到这句话，它是给家长看的）。 */
export const PARENT_SHARE_OPEN_RECORDED_NOTE = '这次打开已经记录下来：老师能看到这份分享有没有被打开过。';

export default function ParentSharePage({ token = '', tokens = [], open = null }) {
  const resolved = useMemo(() => resolveShareToken(tokens, token), [tokens, token]);
  const record = resolved.record;
  const active = resolved.active;
  const first = Boolean(open && open.first);
  const openCount = record ? Number(record.openCount) || 0 : 0;
  const student = record ? record.student : '';
  // 可用时给一句「内容会在这里呈现」，打不开时**只**给状态那一句温和的说明（判据在 shareTokens）。
  const headline = active ? '这份成长档案已经打开' : '分享链接暂时打不开';
  const stateNote = active
    ? '作品、课堂照片与老师确认后的点评会在这个分享页里呈现。'
    : resolved.message;
  return <div className="parent-share-open" data-parent-share="true" data-parent-share-token={token} data-parent-share-state={resolved.status} data-parent-share-found={resolved.found ? 'true' : 'false'} data-parent-share-active={active ? 'true' : 'false'} data-parent-share-open-count={String(openCount)} data-parent-share-first-opened-at={record ? record.firstOpenedAt : ''} data-parent-share-first-open={first ? 'true' : 'false'}>
    <header className="parent-share-brand">
      <span className="prd-tag">US-209 · 分享打开记录</span>
      <h1>昕乐绘 · 成长档案分享</h1>
      {student ? <p data-parent-share-student="true">{student} 的成长档案{record && record.lessonDate ? ` · ${record.lessonDate}` : ''}</p> : null}
    </header>
    <section className="parent-share-body">
      {active ? <Archive size={26}/> : <CircleAlert size={26}/>}
      <b data-parent-share-headline="true">{headline}</b>
      <p data-parent-share-note="true">{stateNote}</p>
      {active ? <small data-parent-share-open-note="true">{PARENT_SHARE_OPEN_RECORDED_NOTE}</small> : null}
      <small className="parent-share-link" data-parent-share-link="true"><Link2 size={13}/>分享地址：{token ? `/p/${token}` : '（没有令牌）'}</small>
    </section>
  </div>;
}
