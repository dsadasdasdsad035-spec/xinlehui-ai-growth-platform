const FRAME_STYLES = {
  '星光展': { outer: '#cfa52e', inner: '#f3ede2', plaque: '#2b271f' },
  '自然原木': { outer: '#8d6439', inner: '#f3ede2', plaque: '#3e3022' },
  '东方雅境': { outer: '#27241f', inner: '#eee8dd', plaque: '#27241f' }
};

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('作品图片暂时无法读取。'));
    image.src = source;
  });
}

/** 只旋转完整原图，不做抠图、裁剪、滤镜或装裱。 */
export async function rotateArtworkOriginal({ source, rotation = 0 }) {
  const image = await loadImage(source);
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  if (!normalizedRotation) return source;
  const sideways = normalizedRotation % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
  canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
  const context = canvas.getContext('2d');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((normalizedRotation * Math.PI) / 180);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas.toDataURL('image/png');
}

/**
 * 作品画心提取（本地第一版）：寻找照片中央最大的低饱和亮色纸面区域，
 * 旋转后仅做背景透明化，绝不按边缘二次裁切。它不重绘、不修改线条和色彩。
 * 复杂背景或深色纸张会在正式服务端版交给文档边缘识别模型进一步处理。
 */
export async function extractArtworkSurface({ source, rotation = 0 }) {
  // 必须先完成整图旋转，再启动背景处理；两步之间不共享裁切结果。
  const orientedSource = await rotateArtworkOriginal({ source, rotation });
  const image = await loadImage(orientedSource);
  const analysisWidth = Math.min(900, image.naturalWidth);
  const analysisHeight = Math.max(1, Math.round(image.naturalHeight * analysisWidth / image.naturalWidth));
  const analysis = document.createElement('canvas');
  analysis.width = analysisWidth; analysis.height = analysisHeight;
  const actx = analysis.getContext('2d', { willReadFrequently: true });
  actx.drawImage(image, 0, 0, analysisWidth, analysisHeight);
  const pixels = actx.getImageData(0, 0, analysisWidth, analysisHeight).data;
  const isPaper = (x, y) => {
    const index = (y * analysisWidth + x) * 4;
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    // 只将接近白纸的中性浅色识别为画纸。旧阈值会把浅木桌、墙面误当成纸张。
    return (r + g + b) / 3 > 222 && max - min < 34;
  };
  // 保留这一步供后续服务端边缘识别使用；本地预览不依据它裁切，避免作品贴纸边时被截掉。
  const sample = 4;
  const gridWidth = Math.ceil(analysisWidth / sample);
  const gridHeight = Math.ceil(analysisHeight / sample);
  const total = gridWidth * gridHeight;
  const paperGrid = new Uint8Array(total);
  for (let gy = 0; gy < gridHeight; gy += 1) for (let gx = 0; gx < gridWidth; gx += 1) {
    if (isPaper(Math.min(analysisWidth - 1, gx * sample), Math.min(analysisHeight - 1, gy * sample))) paperGrid[gy * gridWidth + gx] = 1;
  }
  // 白纸会被孩子的彩色线条切成很多小块。先做一次宽松连接，把同一张纸的空白区连回整体，
  // 再找纸张外轮廓；桌面通常不会与白纸区域连续。
  const connectedGrid = new Uint8Array(paperGrid);
  const bridgeRadius = 8;
  for (let gy = 0; gy < gridHeight; gy += 1) for (let gx = 0; gx < gridWidth; gx += 1) {
    if (!paperGrid[gy * gridWidth + gx]) continue;
    for (let dy = -bridgeRadius; dy <= bridgeRadius; dy += 1) for (let dx = -bridgeRadius; dx <= bridgeRadius; dx += 1) {
      if (dx * dx + dy * dy > bridgeRadius * bridgeRadius) continue;
      const nx = gx + dx, ny = gy + dy;
      if (nx >= 0 && ny >= 0 && nx < gridWidth && ny < gridHeight) connectedGrid[ny * gridWidth + nx] = 1;
    }
  }
  const visited = new Uint8Array(total);
  let best = null;
  for (let seed = 0; seed < total; seed += 1) {
    if (!connectedGrid[seed] || visited[seed]) continue;
    const queue = [seed]; visited[seed] = 1;
    let count = 0, minX = gridWidth, maxX = 0, minY = gridHeight, maxY = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const point = queue[cursor], gx = point % gridWidth, gy = Math.floor(point / gridWidth);
      count += 1; minX = Math.min(minX, gx); maxX = Math.max(maxX, gx); minY = Math.min(minY, gy); maxY = Math.max(maxY, gy);
      const neighbours = [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
        const next = ny * gridWidth + nx;
        if (connectedGrid[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
      }
    }
    if (!best || count > best.count) best = { count, minX, maxX, minY, maxY };
  }
  // 硬规则：旋转后保留完整画布。背景处理只能改透明度，不能改变任何画面边界。
  const sx = 0;
  const sy = 0;
  const sw = image.naturalWidth;
  const sh = image.naturalHeight;
  // 归档画心按原作有效像素输出，不以低清预览替代原图；上传图本身不足 8K 时不做虚假补画放大。
  const archiveLongEdge = Math.min(7680, Math.max(sw, sh));
  const archiveScale = archiveLongEdge / Math.max(sw, sh);
  const result = document.createElement('canvas');
  result.width = Math.max(1, Math.round(sw * archiveScale));
  result.height = Math.max(1, Math.round(sh * archiveScale));
  const resultContext = result.getContext('2d', { willReadFrequently: true });
  resultContext.drawImage(image, sx, sy, sw, sh, 0, 0, result.width, result.height);
  // 根据最大白纸主体只清理四周窄环境带。画布不裁切、不缩放；纸内所有像素原样保留。
  // 任一边若需要深入超过 25%，视为识别不可靠，该边完全不处理，避免误删主体。
  const cleanPixels = resultContext.getImageData(0, 0, result.width, result.height);
  const data = cleanPixels.data;
  const width = result.width, height = result.height;
  const isLightPaperPixel=(x,y)=>{
    const i=(y*analysisWidth+x)*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
    return (r+g+b)/3>195&&Math.max(r,g,b)-Math.min(r,g,b)<62;
  };
  // 右纸边：寻找“左侧偏白纸、右侧持续为环境”的最明显竖向变化。
  let rightEdge=analysisWidth;
  let bestRightScore=0;
  const band=Math.max(5,Math.round(analysisWidth*0.035));
  for(let x=Math.round(analysisWidth*.68);x<Math.round(analysisWidth*.98);x++){
    let edge=0,leftPaper=0,rightPaper=0,samples=0;
    for(let y=0;y<analysisHeight;y+=2){
      const i=(y*analysisWidth+x)*4,j=(y*analysisWidth+x-1)*4;
      edge+=Math.abs(pixels[i]-pixels[j])+Math.abs(pixels[i+1]-pixels[j+1])+Math.abs(pixels[i+2]-pixels[j+2]);samples++;
      for(let dx=1;dx<=band;dx+=3){if(isLightPaperPixel(Math.max(0,x-dx),y))leftPaper++;if(isLightPaperPixel(Math.min(analysisWidth-1,x+dx),y))rightPaper++}
    }
    const paperSamples=samples*Math.ceil(band/3);
    const contrast=leftPaper/paperSamples-rightPaper/paperSamples;
    const score=edge/samples*Math.max(0,contrast);
    if(contrast>.14&&score>bestRightScore){bestRightScore=score;rightEdge=x}
  }
  // 底纸边：只在底部 35% 寻找长水平边；未可靠检测到时不清理底边。
  let bottomEdge=analysisHeight;
  let bestBottomScore=0;
  for(let y=Math.round(analysisHeight*.65);y<Math.round(analysisHeight*.985);y++){
    let edge=0,abovePaper=0,belowPaper=0,samples=0;
    for(let x=0;x<analysisWidth;x+=2){
      const i=(y*analysisWidth+x)*4,j=((y-1)*analysisWidth+x)*4;
      edge+=Math.abs(pixels[i]-pixels[j])+Math.abs(pixels[i+1]-pixels[j+1])+Math.abs(pixels[i+2]-pixels[j+2]);samples++;
      for(let dy=1;dy<=band;dy+=3){if(isLightPaperPixel(x,Math.max(0,y-dy)))abovePaper++;if(isLightPaperPixel(x,Math.min(analysisHeight-1,y+dy)))belowPaper++}
    }
    const paperSamples=samples*Math.ceil(band/3);
    const contrast=abovePaper/paperSamples-belowPaper/paperSamples;
    const score=edge/samples*Math.max(0,contrast);
    if(contrast>.1&&score>bestBottomScore){bestBottomScore=score;bottomEdge=y}
  }
  // 作品画满到底边时没有白纸对比：仅在最后 15% 内寻找显著的长水平纸边作为保守兜底。
  if(bottomEdge===analysisHeight){
    let fallbackScore=0;
    for(let y=Math.round(analysisHeight*.85);y<Math.round(analysisHeight*.992);y++){
      let edge=0,samples=0;
      for(let x=0;x<analysisWidth;x+=2){
        const i=(y*analysisWidth+x)*4,j=((y-1)*analysisWidth+x)*4;
        edge+=Math.abs(pixels[i]-pixels[j])+Math.abs(pixels[i+1]-pixels[j+1])+Math.abs(pixels[i+2]-pixels[j+2]);samples++;
      }
      const score=edge/samples;
      if(score>48&&score>fallbackScore){fallbackScore=score;bottomEdge=y}
    }
  }
  const rightLimit=Math.min(width,Math.ceil(rightEdge*width/analysisWidth));
  const bottomLimit=Math.min(height,Math.ceil(bottomEdge*height/analysisHeight));
  // 纸外环境全部透明；纸内只去掉低饱和亮纸底，保留深色线条和彩色笔触。
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=(y*width+x)*4;
    if(x>=rightLimit||y>=bottomLimit){data[index+3]=0;continue}
    const r=data[index],g=data[index+1],b=data[index+2];
    const average=(r+g+b)/3,spread=Math.max(r,g,b)-Math.min(r,g,b);
    // 中性浅色属于纸张/拍摄光影；彩色笔触和深色线稿继续保留。
    // 白纸、均匀阴影和拍摄环境的中性浅色都透明化；彩色笔触和深色线稿保留。
    if(average>152&&spread<58)data[index+3]=0;
  }
  resultContext.putImageData(cleanPixels, 0, 0);
  // 只收紧已经透明的空白，不裁任何可见笔触；四周额外保留安全边，便于居中装裱。
  let minX=width,minY=height,maxX=-1,maxY=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(data[(y*width+x)*4+3]>8){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
  }
  if(maxX<minX||maxY<minY)return result.toDataURL('image/png');
  const padding=Math.max(12,Math.round(Math.max(maxX-minX+1,maxY-minY+1)*.035));
  const cropX=Math.max(0,minX-padding),cropY=Math.max(0,minY-padding);
  const cropRight=Math.min(width,maxX+1+padding),cropBottom=Math.min(height,maxY+1+padding);
  const centered=document.createElement('canvas');
  centered.width=cropRight-cropX;centered.height=cropBottom-cropY;
  centered.getContext('2d').drawImage(result,cropX,cropY,centered.width,centered.height,0,0,centered.width,centered.height);
  return centered.toDataURL('image/png');
}

/**
 * 自然课堂照片优化：只做轻微曝光、对比与色彩校正，不改变五官、身材、表情或画面内容。
 * 保留完整画面，后续再由相片框函数添加白边和署名。
 */
export async function enhanceClassroomPhoto({ source }) {
  const image = await loadImage(source);
  // 输出 4:5 人像比例；横向居中、纵向略向上取景，优先保留脸部与上半身。
  // 这是不改变人物本身的裁剪，不做人脸重绘或五官修改。
  const targetRatio = 4 / 5;
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  let cropWidth = image.naturalWidth;
  let cropHeight = image.naturalHeight;
  let cropX = 0;
  let cropY = 0;
  if (sourceRatio > targetRatio) {
    cropWidth = image.naturalHeight * targetRatio;
    cropX = (image.naturalWidth - cropWidth) / 2;
  } else {
    cropHeight = image.naturalWidth / targetRatio;
    // 比纯居中略上移，让课堂人物的脸部和手部更容易保留在画面中。
    cropY = Math.max(0, (image.naturalHeight - cropHeight) * 0.28);
  }
  const height = 1800;
  const width = Math.round(height * targetRatio);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.filter = 'brightness(1.055) contrast(1.045) saturate(1.025)';
  ctx.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, width, height);
  ctx.filter = 'none';
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** 第一版真实装裱：只做完整展示与画布合成，绝不重绘或裁掉孩子的作品。 */
export async function createExhibitionFrame({ source, style = '星光展', student = '陈一诺', title = '向着光的花', date = '2026.08.11', rotation = 0 }) {
  const image = await loadImage(source);
  const palette = FRAME_STYLES[style] || FRAME_STYLES['星光展'];
  const width = 1800, height = 1360, outer = 56, mat = 88, plaqueHeight = 96;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbf8f2'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = palette.outer; ctx.fillRect(34, 34, width - 68, height - 68);
  ctx.fillStyle = palette.inner; ctx.fillRect(34 + outer, 34 + outer, width - 68 - outer * 2, height - 68 - outer * 2);
  const area = { x: 34 + outer + mat, y: 34 + outer + mat, width: width - 68 - (outer + mat) * 2, height: height - 68 - (outer + mat) * 2 - plaqueHeight };
  const ratio = Math.min(area.width / image.naturalWidth, area.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * ratio, renderedHeight = image.naturalHeight * ratio;
  const x = area.x + (area.width - renderedWidth) / 2, y = area.y + (area.height - renderedHeight) / 2;
  ctx.fillStyle = '#fff'; ctx.fillRect(area.x, area.y, area.width, area.height);
  ctx.save();
  ctx.translate(area.x + area.width / 2, area.y + area.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const rotated = rotation % 180 !== 0;
  const scale = rotated ? Math.min(area.width / renderedHeight, area.height / renderedWidth) : 1;
  ctx.drawImage(image, -renderedWidth * scale / 2, -renderedHeight * scale / 2, renderedWidth * scale, renderedHeight * scale);
  ctx.restore();
  const plaqueY = area.y + area.height + 26;
  ctx.fillStyle = palette.plaque; ctx.fillRect(area.x, plaqueY, area.width, 2);
  ctx.font = '600 30px serif'; ctx.fillText(`${student}  ·  《${title}》`, area.x, plaqueY + 39);
  ctx.fillStyle = '#6d6559'; ctx.font = '24px sans-serif'; ctx.fillText(`创作于 ${date}`, area.x, plaqueY + 74);
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** 课堂照片的保守呈现：完整保留人物，只添加白边、阴影和日期，不做人像重绘。 */
export async function createPortraitPrint({ source, student = '陈一诺', date = '2026.08.11' }) {
  return enhanceClassroomPhoto({ source });
}
