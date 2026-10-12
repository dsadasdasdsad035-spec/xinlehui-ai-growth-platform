// 海报模板的**开发自检入口**（[海报 US-302a]）。
//
// 解决的问题：数据层的 8 套内置模板是「参数」，参数写错了**构建照样通过**（`pnpm run build`
// 只看语法与依赖），只有真画一次才知道这套版式能不能出图。所以这里给一个**一次调用跑全套**的入口：
// 对每套内置模板各调用一次 `renderPoster({ spec, data, scale })`，回报是否全部返回非空 Blob、
// 有没有抛错，并附上每个占位区「画没画、为什么没画」的一行读数（读的是渲染层自己的 `plan`）。
//
// 入口挂在哪里：`main.jsx` 顶部在 `import.meta.env.DEV` 分支里把它挂到
// `window.__xinlehuiPosterSelfCheck`（与 `window.__xinlehuiFeedbackMode` 同一类只读调试钩子）。
// 出厂构建里那个分支是死代码（`import.meta.env.DEV` 被替换成 `false`），本模块因此不进 dist ——
// 「开发自检」不该是生产包的一部分，这条由 `/tmp/assert-us090.mjs` 的 dist 断言兜住。
//
// 用法（`pnpm run dev` 起服务，浏览器控制台 / 验证脚本里）：
//   await window.__xinlehuiPosterSelfCheck()        // → 报告对象
//   window.__xinlehuiPosterSelfCheckText(报告)      // → 可直接打印的多行文本
//
// 素材用现画的合成图（暖色色块 + 圆点），不依赖任何外部图片：自检要能在任何一台机器上跑，
// 而不是「先上传一张示例作品」。合成图只是**夹具**——它证明的是版式与画笔这条链路通，
// 真实作品的上图逻辑属 US-303 起的界面故事。

import { POSTER_KIND_LABELS, posterShortEdge, seedPosterTemplates } from '../data/posterTemplates';
import { renderPoster } from './poster';

/** 自检用的分享链接（假地址，只为让二维码编得出来；真实链接来自分享令牌，见 US-313）。 */
export const POSTER_SELF_CHECK_SHARE_URL = 'https://xinlehui.example.com/p/selfcheck7f3km9';

/** 自检用的样例数据：15 个变量**全部有值**，于是每套模板的每个文字位都能画出来。 */
export const POSTER_SELF_CHECK_DATA = {
  studentName: '林小满',
  artworkTitle: '向着光的花',
  period: '2026 春季学期',
  date: '2026-08-04',
  teacherName: '王老师',
  orgName: '昕乐绘美术',
  quote: '对冷暖色的对比有自己的判断，花心那几笔敢用纯色，画面很有呼吸感。',
  className: '周六 2 班',
  courseName: '创意水彩',
  summary: '一学期下来，从不敢下笔到主动尝试叠色，画面从单薄变得有层次。',
  title: '向着光的花',
  artworkCount: 9,
  lessonCount: 12,
  duration: '01:36',
  shareUrl: POSTER_SELF_CHECK_SHARE_URL
};

/** 自检样例里的作品套数（拼贴 / 作品墙模板要一格一张）。 */
const SELF_CHECK_ARTWORK_COUNT = 9;
/**
 * 单图位的 id 约定（模板里 image 占位区的两种角色）：
 *   - `artwork`（单作品）/ `cover`（视频封面、长图头图）= **一幅**代表作；
 *   - `collage`（阶段拼贴）/ `wall`（班级作品墙）= **多格**拼贴。
 * 自检按这个约定喂素材：给单图位塞 9 张会让「单作品」模板被渲染成九宫格 —— 那是**自检样例的错**，
 * 不是模板的错（本轮真踩：自检第一版对每套都喂 9 张）。
 */
const SELF_CHECK_SINGLE_IMAGE_SLOTS = ['artwork', 'cover'];
/** 自检样例的课次日期（每格标注用，与 `{日期}` 同一格式）。 */
const SELF_CHECK_DATES = [
  '2026.03.01', '2026.03.15', '2026.03.29',
  '2026.04.12', '2026.04.26', '2026.05.10',
  '2026.05.24', '2026.06.07', '2026.06.21'
];
// 样张的暖色系（金 / 赭 / 沙 / 墨绿 —— 与品牌同一色系，不出现蓝）。
const SELF_CHECK_ARTWORK_PALETTE = [
  { top: '#F4E3B8', bottom: '#CFA52E' },
  { top: '#F3EDE2', bottom: '#8D6439' },
  { top: '#EFE3C9', bottom: '#6D6559' },
  { top: '#F7EFDD', bottom: '#514A38' },
  { top: '#F1E7D6', bottom: '#A98B4E' },
  { top: '#EFE6D3', bottom: '#4F5A46' }
];

const DEFAULT_ARTWORK_SIZE = { width: 720, height: 540 };

/**
 * 合成一张「作品图」（暖色渐变底 + 一块斜向色带 + 一个圆），返回 dataURL。
 * 没有任何 canvas 能力时返回 `''`（渲染层会把这一支当作「没素材」，自检照样跑完）。
 */
export function createSelfCheckArtwork({ width = DEFAULT_ARTWORK_SIZE.width, height = DEFAULT_ARTWORK_SIZE.height, tone = 0 } = {}) {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const palette = SELF_CHECK_ARTWORK_PALETTE[Math.abs(Math.round(tone)) % SELF_CHECK_ARTWORK_PALETTE.length];
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, palette.top);
  gradient.addColorStop(1, palette.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#FBF8F2';
  ctx.beginPath();
  ctx.moveTo(canvas.width * 0.12, canvas.height * 0.82);
  ctx.lineTo(canvas.width * 0.62, canvas.height * 0.16);
  ctx.lineTo(canvas.width * 0.86, canvas.height * 0.44);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2B271F';
  ctx.beginPath();
  ctx.arc(canvas.width * 0.72, canvas.height * 0.7, Math.min(canvas.width, canvas.height) * 0.12, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL('image/png');
}

/** 合成一个「机构 Logo」（墨色圆角块 + 暖金横线），返回 dataURL；无 canvas 时返回 `''`。 */
export function createSelfCheckLogo({ width = 360, height = 120 } = {}) {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width));
  canvas.height = Math.max(2, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#2B271F';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, canvas.height * 0.24);
  ctx.fill();
  ctx.fillStyle = '#CFA52E';
  ctx.fillRect(canvas.width * 0.08, canvas.height * 0.46, canvas.width * 0.84, canvas.height * 0.12);
  return canvas.toDataURL('image/png');
}

/** 一个 image 占位区要给的条目（单图位 1 张；拼贴位按固定格数或自适应档位给）。 */
function selfCheckEntriesFor(slot) {
  if (SELF_CHECK_SINGLE_IMAGE_SLOTS.includes(slot.id)) {
    return [{ url: createSelfCheckArtwork({ tone: 0 }), caption: SELF_CHECK_DATES[0] }];
  }
  const grid = slot.grid && typeof slot.grid === 'object' ? slot.grid : {};
  const maxItems = Number.isFinite(Number(grid.maxItems)) ? Number(grid.maxItems) : 1;
  const columns = Number(grid.columns) > 0 ? Number(grid.columns) : 0;
  const rows = Number(grid.rows) > 0 ? Number(grid.rows) : 0;
  const fixed = columns > 0 && rows > 0 ? columns * rows : 0;
  const count = fixed > 0 ? fixed : Math.min(SELF_CHECK_ARTWORK_COUNT, Math.max(1, maxItems));
  return Array.from({ length: count }, (_, index) => ({
    url: createSelfCheckArtwork({ tone: index }),
    caption: SELF_CHECK_DATES[index % SELF_CHECK_DATES.length]
  }));
}

/**
 * 某套模板的自检数据：样例变量 + 按该模板的 image 位 id 组好的素材
 * （keyed 形状 —— 渲染层只把它给命中的占位区，不猜素材）。
 */
export function posterSelfCheckData(template) {
  const slots = template && template.spec && Array.isArray(template.spec.slots) ? template.spec.slots : [];
  const images = {};
  slots.forEach((slot) => {
    if (slot.type === 'image' && slot.visible !== false) images[slot.id] = selfCheckEntriesFor(slot);
  });
  return { ...POSTER_SELF_CHECK_DATA, images, logo: createSelfCheckLogo() };
}

const slotReason = (slot) => (slot.drawn ? '已绘制' : slot.reason || '未绘制');

/**
 * 跑一次全套自检：对 `templates`（默认 8 套内置模板）逐套调用 `renderPoster`。
 * **永不抛错**：某套渲染炸了只让那一套进 `failures`，其余照跑（自检的价值就在于「跑完全部再报告」）。
 *
 * 返回 `{ ok, total, checked, failed, entries[], failures[], text }`：
 *   - `ok === true` 表示每套都返回了非空 Blob 且没有异常；
 *   - `entries[]` 每套一行：`id / name / kind / kindLabel / bytes / mimeType / width / height /
 *     slots（总数 / 已绘制 / 未绘制）/ warnings / reason / error`；
 *   - `failures[]` 只列没过的（`{ id, name, message }`）。
 */
export async function runPosterSelfCheck({ templates = seedPosterTemplates, data, scale = 1 } = {}) {
  const list = Array.isArray(templates) ? templates : [];
  const entries = [];
  for (const template of list) {
    const id = (template && template.id) || '';
    const name = (template && template.name) || '';
    const kind = (template && template.kind) || '';
    const base = {
      id,
      name,
      kind,
      kindLabel: POSTER_KIND_LABELS[kind] || kind,
      bytes: 0,
      mimeType: '',
      width: 0,
      height: 0,
      slots: { total: 0, drawn: 0, hidden: 0 },
      warnings: [],
      reason: '',
      error: ''
    };
    try {
      const sample = data !== undefined ? data : posterSelfCheckData(template);
      const result = await renderPoster({ spec: template.spec, data: sample, scale });
      if (!result) {
        entries.push({ ...base, ok: false, reason: '当前环境没有 canvas（renderPoster 返回 null）' });
        continue;
      }
      const planSlots = Array.isArray(result.plan && result.plan.slots) ? result.plan.slots : [];
      const drawn = planSlots.filter((slot) => slot.drawn).length;
      const hidden = planSlots.filter((slot) => slot.drawn === false && slot.reason === 'hidden').length;
      const bytes = Number(result.bytes) || 0;
      entries.push({
        ...base,
        ok: bytes > 0,
        bytes,
        mimeType: result.mimeType || '',
        width: result.width || 0,
        height: result.height || 0,
        slots: {
          total: planSlots.length,
          drawn,
          hidden,
          // 未绘制的逐条原因（读的是渲染层的 plan，不在这里重算版式）。
          skipped: planSlots.filter((slot) => slot.drawn === false && slot.reason !== 'hidden')
            .map((slot) => `${slot.id}：${slotReason(slot)}`)
        },
        warnings: Array.isArray(result.warnings) ? result.warnings.slice() : [],
        reason: bytes > 0 ? '' : 'Blob 为空（编码失败）'
      });
    } catch (error) {
      entries.push({ ...base, ok: false, error: String((error && error.message) || error || '未知异常') });
    }
  }
  const failures = entries
    .filter((entry) => !entry.ok)
    .map((entry) => ({ id: entry.id, name: entry.name, message: entry.error || entry.reason || '未能出图' }));
  const report = {
    ok: entries.length > 0 && failures.length === 0,
    total: list.length,
    checked: entries.length,
    failed: failures.length,
    entries,
    failures
  };
  return { ...report, text: posterSelfCheckText(report) };
}

/** 报告的多行文本（控制台直接打印；一行一套模板）。 */
export function posterSelfCheckText(report) {
  const source = report && typeof report === 'object' ? report : {};
  const entries = Array.isArray(source.entries) ? source.entries : [];
  const head = `海报模板自检：${source.ok ? '全部通过' : '有问题'}（${entries.filter((entry) => entry.ok).length}/${entries.length} 套出图，非空 Blob）`;
  const lines = entries.map((entry) => {
    const size = `${entry.width}×${entry.height}`;
    const drawn = entry.slots ? `${entry.slots.drawn}/${entry.slots.total} 个占位区已绘制` : '';
    const detail = entry.ok
      ? `OK ${Math.round(entry.bytes / 1024)}KB ${size} · ${drawn}${entry.warnings.length ? ` · ${entry.warnings.length} 条警告` : ''}`
      : `失败：${entry.error || entry.reason || '未能出图'}`;
    return `  ${entry.ok ? '✓' : '✗'} ${entry.id}（${entry.name}）— ${detail}`;
  });
  const skipped = entries
    .filter((entry) => entry.ok && entry.slots && entry.slots.skipped && entry.slots.skipped.length)
    .map((entry) => `  · ${entry.id} 未绘制：${entry.slots.skipped.join('；')}`);
  return [head, ...lines, ...skipped].join('\n');
}

/** 报告里的画布短边（断言用：`kind` 对应的比例尺该是多少）。 */
export function selfCheckShortEdge(template) {
  return posterShortEdge(template && template.spec ? template.spec.canvas : undefined);
}
