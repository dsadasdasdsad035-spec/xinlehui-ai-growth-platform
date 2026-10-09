// 示例作品：画一张「孩子会画的那种画」，再走**真实的装裱管线**做成画框。
//
// 为什么不用现成图片：仓库里没有任何真实儿童画素材，而演示画展不能是空的。
// 用 canvas 现画 + renderFramedArtwork，既不用引第三方版权素材，
// 又顺带把「作品 → 装裱 → 上墙」这条链路真的跑通了（不是贴一张假图）。

import { renderFramedArtwork } from '../services/framing';

export const DEMO_ARTWORKS = [
  { variant: 0, student: '陈一诺', title: '向着光的花', date: '2026.10.08' },
  { variant: 1, student: '林小满', title: '我家的小猫', date: '2026.10.08' },
  { variant: 2, student: '周子乐', title: '彩色的雨', date: '2026.10.08' },
  { variant: 3, student: '赵禾', title: '海底的朋友', date: '2026.10.08' },
  { variant: 4, student: '孙一然', title: '窗台上的花', date: '2026.10.08' }
];

const W = 1200;
const H = 900;

const rand = (seed) => {
  let s = seed * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
};

/** 画一张孩子风格的画（蜡笔感：粗线条、不闭合、颜色大胆）。 */
function drawChildlikeArtwork(variant = 0, seed = 7) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const rnd = rand(seed + variant * 13);
  const jitter = (amount) => (rnd() - 0.5) * amount;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const palette = ['#f4b23c', '#e8604c', '#4a9de0', '#5eb56a', '#9b6fd0', '#f0d24a', '#e8798f'];
  const pick = (i) => palette[(variant * 3 + i) % palette.length];

  // 纸面排线：让孩子的手感不那么"数字"
  ctx.strokeStyle = 'rgba(120,120,120,0.05)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 60; i += 1) {
    const x = rnd() * W, y = rnd() * H;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + jitter(40), y + jitter(40)); ctx.stroke();
  }

  const stroke = (color, width, path) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); path(); ctx.stroke();
  };
  const fillCircle = (color, x, y, r) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(x + jitter(12), y + jitter(12), r * (1 + jitter(0.18)), r * (1 + jitter(0.18)), jitter(0.5), 0, Math.PI * 2); ctx.fill();
  };

  // 地面 / 海面
  stroke(pick(3), 13, () => {
    ctx.moveTo(40, H * 0.66);
    ctx.bezierCurveTo(W * 0.3, H * 0.6 + jitter(40), W * 0.7, H * 0.72 + jitter(40), W - 40, H * 0.63);
  });

  if (variant === 0) {
    // 太阳 + 房子 + 小人 + 花
    fillCircle(pick(0), W * 0.2, H * 0.2, 78);
    stroke(pick(0), 9, () => {
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        ctx.moveTo(W * 0.2 + Math.cos(a) * 100, H * 0.2 + Math.sin(a) * 100);
        ctx.lineTo(W * 0.2 + Math.cos(a) * 140, H * 0.2 + Math.sin(a) * 140);
      }
    });
    ctx.fillStyle = '#fdf3e0'; ctx.strokeStyle = pick(1); ctx.lineWidth = 11;
    ctx.beginPath(); ctx.rect(W * 0.56, H * 0.3, 320, 300); ctx.fill(); ctx.stroke();
    ctx.fillStyle = pick(1);
    ctx.beginPath();
    ctx.moveTo(W * 0.52, H * 0.3); ctx.lineTo(W * 0.56 + 160, H * 0.16); ctx.lineTo(W * 0.56 + 320, H * 0.3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = pick(2);
    ctx.beginPath(); ctx.rect(W * 0.56 + 130, H * 0.46, 80, 145); ctx.fill();
    stroke('#3a3a3a', 10, () => { ctx.moveTo(W * 0.33, H * 0.5); ctx.lineTo(W * 0.33, H * 0.62); });
    fillCircle('#f6c9a6', W * 0.33, H * 0.45, 40);
    stroke('#3a3a3a', 10, () => {
      ctx.moveTo(W * 0.33, H * 0.62); ctx.lineTo(W * 0.28, H * 0.7); ctx.moveTo(W * 0.33, H * 0.62); ctx.lineTo(W * 0.39, H * 0.7);
      ctx.moveTo(W * 0.29, H * 0.52); ctx.lineTo(W * 0.2, H * 0.48); ctx.moveTo(W * 0.37, H * 0.52); ctx.lineTo(W * 0.45, H * 0.48);
    });
    [0.12, 0.3, 0.48, 0.72, 0.88].forEach((t, i) => {
      const x = W * t, y = H * 0.66 + jitter(20);
      stroke(pick(3), 7, () => { ctx.moveTo(x, y); ctx.lineTo(x + jitter(10), y - 70); });
      fillCircle(pick(i), x + jitter(10), y - 80, 26);
    });
  } else if (variant === 1) {
    // 一只猫
    fillCircle(pick(0), W * 0.5, H * 0.66, 170);
    fillCircle(pick(0), W * 0.5, H * 0.36, 130);
    ctx.fillStyle = pick(0);
    ctx.beginPath();
    ctx.moveTo(W * 0.5 - 110, H * 0.3); ctx.lineTo(W * 0.5 - 140, H * 0.1); ctx.lineTo(W * 0.5 - 40, H * 0.24);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W * 0.5 + 110, H * 0.3); ctx.lineTo(W * 0.5 + 140, H * 0.1); ctx.lineTo(W * 0.5 + 40, H * 0.24);
    ctx.closePath(); ctx.fill();
    fillCircle('#3a3a3a', W * 0.5 - 48, H * 0.36, 16);
    fillCircle('#3a3a3a', W * 0.5 + 48, H * 0.36, 16);
    stroke('#3a3a3a', 8, () => {
      ctx.moveTo(W * 0.5, H * 0.42); ctx.lineTo(W * 0.5 - 18, H * 0.45); ctx.moveTo(W * 0.5, H * 0.42); ctx.lineTo(W * 0.5 + 18, H * 0.45);
    });
    stroke('#3a3a3a', 6, () => {
      for (const s of [-1, 1]) for (let i = 0; i < 3; i += 1) {
        ctx.moveTo(W * 0.5 + s * 60, H * 0.44 + i * 12);
        ctx.lineTo(W * 0.5 + s * 175, H * 0.36 + i * 26);
      }
    });
    stroke(pick(3), 16, () => { ctx.moveTo(W * 0.5 + 160, H * 0.66); ctx.quadraticCurveTo(W * 0.78, H * 0.5, W * 0.8, H * 0.26); });
  } else if (variant === 2) {
    // 彩色的雨
    for (let i = 0; i < 26; i += 1) {
      const x = W * (0.06 + rnd() * 0.88), y = H * (0.08 + rnd() * 0.7);
      ctx.fillStyle = pick(i);
      ctx.beginPath(); ctx.ellipse(x, y, 20 + rnd() * 26, 14 + rnd() * 18, rnd() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = pick(2);
    ctx.beginPath(); ctx.moveTo(0, H * 0.72); ctx.quadraticCurveTo(W * 0.5, H * 0.86, W, H * 0.7); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    stroke('#ffffff', 6, () => { for (let i = 0; i < 7; i += 1) { ctx.moveTo(W * 0.1 * i + 60, H * 0.8); ctx.lineTo(W * 0.1 * i + 100, H * 0.92); } });
  } else if (variant === 3) {
    // 海底
    ctx.fillStyle = '#d9f0fb'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 24; i += 1) fillCircle('rgba(255,255,255,0.8)', W * rnd(), H * rnd() * 0.8, 8 + rnd() * 20);
    const fish = (cx, cy, r, color, dir) => {
      fillCircle(color, cx, cy, r);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx + dir * r * 0.95, cy); ctx.lineTo(cx + dir * r * 1.75, cy - r * 0.7); ctx.lineTo(cx + dir * r * 1.75, cy + r * 0.7);
      ctx.closePath(); ctx.fill();
      fillCircle('#ffffff', cx - dir * r * 0.32, cy - r * 0.22, r * 0.24);
      fillCircle('#3a3a3a', cx - dir * r * 0.32, cy - r * 0.22, r * 0.11);
    };
    fish(W * 0.32, H * 0.36, 78, pick(1), 1);
    fish(W * 0.66, H * 0.56, 58, pick(0), -1);
    fish(W * 0.5, H * 0.76, 44, pick(4), 1);
    stroke(pick(3), 20, () => { ctx.moveTo(0, H * 0.94); ctx.bezierCurveTo(W * 0.3, H * 0.86, W * 0.7, H, W, H * 0.9); });
  } else {
    // 窗台上的花
    ctx.fillStyle = '#eaf4fb'; ctx.fillRect(W * 0.08, H * 0.06, W * 0.84, H * 0.6);
    stroke('#c9a26a', 16, () => { ctx.rect(W * 0.08, H * 0.06, W * 0.84, H * 0.6); });
    stroke('#c9a26a', 12, () => { ctx.moveTo(W * 0.5, H * 0.06); ctx.lineTo(W * 0.5, H * 0.66); ctx.moveTo(W * 0.08, H * 0.36); ctx.lineTo(W * 0.92, H * 0.36); });
    fillCircle(pick(0), W * 0.78, H * 0.18, 52);
    ctx.fillStyle = pick(2);
    ctx.beginPath(); ctx.moveTo(W * 0.34, H * 0.66); ctx.lineTo(W * 0.66, H * 0.66); ctx.lineTo(W * 0.6, H * 0.88); ctx.lineTo(W * 0.4, H * 0.88); ctx.closePath(); ctx.fill();
    [0.2, 0.34, 0.5, 0.64, 0.78].forEach((t, i) => {
      const x = W * (0.36 + (t - 0.2) * 0.42), y = H * 0.66 + jitter(10);
      stroke(pick(3), 8, () => { ctx.moveTo(x, y); ctx.lineTo(x + jitter(14), y - 140); });
      fillCircle(pick(i + 1), x + jitter(14), y - 165, 42);
      fillCircle('#ffffff', x + jitter(14), y - 165, 14);
    });
  }

  return canvas.toDataURL('image/png');
}

/**
 * 生成一张「已经装裱好」的示例作品。
 * @param {object} preset 装裱预设（用它的 spec；不传就用管线默认值）
 * @param {object} demo   DEMO_ARTWORKS 里的一项
 */
export async function createDemoFramedArtwork(preset, demo) {
  const raw = drawChildlikeArtwork(demo.variant, 11 + demo.variant * 7);
  const spec = preset?.spec || {};
  return renderFramedArtwork({
    source: raw,
    spec,
    student: demo.student,
    title: demo.title,
    date: demo.date
  });
}
