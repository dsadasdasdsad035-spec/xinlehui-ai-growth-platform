// 三个最基础的展示原语。原先内联在 main.jsx 里，3D 画廊这类独立页面也要用，
// 所以抽到共享模块，避免两个地方各写一份导致样式漂移。

import React from 'react';

export function PageHeader({ title, desc, prd, actions }) {
  const displayedTitle = title === '班级学员' ? '学员管理' : title === '课后工作台' ? '课后反馈工作台' : title;
  return <div className="page-head">
    <div>
      <div className="title-line"><h1>{displayedTitle}</h1><span className="prd-tag">{prd}</span></div>
      {desc ? <p>{desc}</p> : null}
    </div>
    {actions ? <div className="head-actions">{actions}</div> : null}
  </div>;
}

// `...rest` 是给「面板要给按钮挂 data-* 断言属性」用的（US-011a 的装裱参数面板）：
// 老调用方不传就一个属性都不多，行为不变。
export function Button({ children, variant = 'primary', icon: Icon, onClick, disabled = false, type = 'button', ...rest }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={variant} {...rest}>{Icon ? <Icon size={17} /> : null}{children}</button>;
}

export function Status({ value }) {
  const cls = value === '成功' || value === '已启用' || value === '正常' ? 'success'
    : value.includes('中') || value === '排队中' ? 'processing'
      : value.includes('失败') || value === '已停用' ? 'danger' : 'warning';
  return <span className={`status ${cls}`}><i />{value}</span>;
}
