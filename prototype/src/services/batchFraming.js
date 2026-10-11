// 班级批量装裱的执行层（[第二步 US-010]）：只做「必须有 DOM / canvas 能力」的那一件事 ——
// 把**一幅**作品渲染成装裱成品图的**档案持久副本**（data URL），交给上层写回那条素材。
//
// 规则（目标分类、失败文案、耗时预算、状态机）全在 `data/batchFraming.js`，这里不重复判断；
// **编排**（循环、进度、失败清单、取消、写回哪条素材）在 main.jsx 里。
//
// 一条纪律：批量与单幅保存必须渲染出**同一张画面**。两者的差别只有两处，都在这里写死：
//   - 出处是 `renderFramedArtworkToCanvas`（与「保存图片」同一个渲染函数，同一份几何）；
//   - 副本口径是 `encodeArtworkWriteBackImage`（与 US-008b 的写回同一个 `ARTWORK_WRITE_BACK_IMAGE`：
//     长边 ≤1600 · JPEG 0.85）。1800×1360 的位图用完即弃，只把小图交给上层。
// 因此不存在「批量装裱的版式与单幅不一样」这种漂移。
//
// `rotation` 是老师在这一幅上点过的展示旋转（班级反馈的条目旋转）：合成时要按它渲染，
// 否则转过 90° 的作品在成品图里还是躺着的（新鲜度键把 rotation 算在内，两者必须一致）。

import { renderFramedArtworkToCanvas } from './framing';
import { encodeArtworkWriteBackImage } from './artworkWriteBack';

/**
 * 渲染一幅作品的装裱成品图（档案展示口径的持久副本）。
 *
 * @returns {Promise<{url:string,width:number,height:number,bytes:number,canvasWidth:number,canvasHeight:number}>}
 *          失败一律抛可读错误，由调用方记进失败清单（**不影响**同一批里其它作品）。
 */
export async function renderBatchFramedArtwork({
  source,
  spec = {},
  student = '',
  title = '',
  date = '',
  lessonDate,
  rotation = 0,
  orgName = '',
  teacherName = ''
} = {}) {
  if (!source) throw new Error('这一幅作品没有可读的底图地址');
  const { canvas } = await renderFramedArtworkToCanvas({
    source,
    spec,
    student,
    title,
    date,
    lessonDate,
    rotation: Number(rotation) || 0,
    orgName,
    teacherName,
    scale: 1
  });
  const image = await encodeArtworkWriteBackImage({ canvas });
  return { ...image, canvasWidth: canvas.width, canvasHeight: canvas.height };
}
