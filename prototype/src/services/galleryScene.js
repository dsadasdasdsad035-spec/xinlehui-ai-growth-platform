// 实景照片重建出来的 3D 展厅。
//
// 五个面（后墙 / 左墙 / 右墙 / 地板 / 天花板）全部使用 roomReconstruct.js 从这张
// 实拍照片里"拉平"出来的贴图 —— 所以展厅材质是照片本身，不是纯色也不是凭空建模。
// 学生作品（装裱好的整张图）挂到 roomReconstruct 按真实房型均分出来的墙面槽位上。
//
// 三条必须守住的约束：
//  1) 墙面用 MeshBasicMaterial（不受光照）。贴图是实拍照片，照片里已经含有真实光照，
//     再叠一层灯光只会把它洗灰；"实景图渲染"要的就是照片原样贴上去。
//  2) 作品图用 MeshBasicMaterial，保持产品不变量「作品像素不重绘、不调色」。
//     立体感靠画框后面的实体厚度盒 + 墙面浅影来做，不靠改作品像素。
//  3) three 走动态 import。three 体积约 600KB，不能拖进主包，
//     只有真的打开 3D 画廊时才拉取。
//
// 坐标系：与 roomReconstruct 一致 —— 相机光轴为 X 原点，朝 -Z 看，Y 向上。
//   xL/xR = 左右墙，y ∈ [0, ceilingH]，z ∈ [zNear(近) , zFar(远)]

import { fitArtworkToSlot } from './roomReconstruct';

let threePromise = null;
/** 动态加载 three（只加载一次）。 */
function loadThree() {
  if (!threePromise) threePromise = import('three');
  return threePromise;
}

/** 五个面来自实景照片，nearWall 是同一张照片后墙材质的封口补面。 */
const PHOTO_SURFACES = ['backWall', 'leftWall', 'rightWall', 'floor', 'ceiling'];

/**
 * 用「贴图图像的左上/右上/右下/左下」顺序给出四个世界坐标角点。
 * 因为顶点顺序 = 默认 UV 顺序，贴图不需要任何旋转/翻转就能正着贴上去，
 * 避免了 PlaneGeometry + rotateX 那套容易搞反朝向的推导。
 */
function buildQuad(THREE, corners) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

/** 从装裱图的边缘采样出画框主色，给「厚度盒」用。失败时回退到暖金。 */
async function sampleFrameColor(THREE, image, fallback = '#cfa52e') {
  try {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const band = 3;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const edge = Math.min(x, y, size - 1 - x, size - 1 - y) < band;
        if (!edge) continue;
        const i = (y * size + x) * 4;
        // 最外圈是展墙的浅色出血，往里一圈才是金框，所以取「中带」
        const depth = Math.min(x, y, size - 1 - x, size - 1 - y);
        if (depth < band * 0.45) continue;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
      }
    }
    if (!n) return new THREE.Color(fallback);
    return new THREE.Color(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear();
  } catch {
    return new THREE.Color(fallback);
  }
}

/**
 * 建一个 3D 展厅。
 * @param {object} cfg
 * @param {HTMLCanvasElement} cfg.canvas   渲染目标
 * @param {object} cfg.room                reconstructGalleryRoom() 返回的 room
 * @param {object} cfg.textures            reconstructGalleryRoom() 返回的 textures（key → {url}）
 * @param {Array}  cfg.slots               reconstructGalleryRoom() 返回的 slots
 * @param {Array}  cfg.lights              reconstructGalleryRoom() 返回的 lights
 * @param {Array}  cfg.artworks            [{ id, student, title, date, imageUrl }]
 * @param {string} cfg.initialMode         'orbit' | 'walk'
 * @param {Function} cfg.onPick            点击作品回调 (artwork, slot)
 * @param {Function} cfg.onHover           悬停作品回调
 */
export async function createGalleryScene(cfg) {
  const {
    canvas, room, textures = {}, slots = [], lights = [], artworks = [],
    initialMode = 'orbit', onPick, onHover, clampInside = true
  } = cfg;
  const THREE = await loadThree();
  // cfg.room 要的是 reconstructGalleryRoom() 返回里的 **room 几何对象**，
  // 不是整个重建结果。传错的话 xL/zFar 全是 undefined，几何会静默变成 NaN、
  // 画布只剩背景色 —— 所以这里宁可当场报错，也不留一个"看起来在跑"的空场景。
  const geometry = cfg.room || {};
  if (!Number.isFinite(geometry.xL) || !Number.isFinite(geometry.zFar) || !Number.isFinite(geometry.height)) {
    throw new Error('createGalleryScene: cfg.room 必须是重建结果里的 room 几何对象（含 xL/xR/height/zNear/zFar）。');
  }
  const { xL, xR, height: ceilingH, zNear, zFar } = geometry;
  const width = xR - xL;
  const depth = Math.abs(zFar - zNear);
  const centerX = (xL + xR) / 2;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if ('useLegacyLights' in renderer) renderer.useLegacyLights = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b1917');

  const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 500);
  camera.position.set(centerX, room.eyeHeight || 1.6, zNear + Math.min(1.4, depth * 0.25));

  // ---- 按需渲染的状态（必须早于 resize() 的声明，否则会踩 TDZ）
  let dirty = true;
  let raf = 0;
  let lastFrame = performance.now();
  let renderUntil = 0;
  /**
   * 标记「需要重画」。holdMs > 0 时会在这段时间内保持连续渲染，
   * 用于动画/缓动结束后的余波。静置时完全不出帧，省电。
   */
  function requestRender(holdMs = 0) {
    dirty = true;
    renderUntil = Math.max(renderUntil, performance.now() + holdMs);
  }

  // ---------------------------------------------------------------- 房间
  const roomGroup = new THREE.Group();
  scene.add(roomGroup);
  const disposables = [];
  const loader = new THREE.TextureLoader();

  // 每个面按「贴图左上/右上/右下/左下」给出世界角点（顺序与矫正时的源四边形一致）
  const cornerMap = {
    backWall: [
      [xL, ceilingH, zFar], [xR, ceilingH, zFar], [xR, 0, zFar], [xL, 0, zFar]
    ],
    leftWall: [
      [xL, ceilingH, zNear], [xL, ceilingH, zFar], [xL, 0, zFar], [xL, 0, zNear]
    ],
    rightWall: [
      [xR, ceilingH, zNear], [xR, ceilingH, zFar], [xR, 0, zFar], [xR, 0, zNear]
    ],
    floor: [
      [xL, 0, zNear], [xR, 0, zNear], [xR, 0, zFar], [xL, 0, zFar]
    ],
    ceiling: [
      [xL, ceilingH, zNear], [xR, ceilingH, zNear], [xR, ceilingH, zFar], [xL, ceilingH, zFar]
    ],
    // 近端封口（补面）。照片是站在走廊里朝后墙拍的，相机背后那截墙**没有被拍到**，
    // 但重建出来的房间是有边界的：不封口的话走到尽头回头就是一片虚空。
    // 用本图后墙的材质封口 —— 同一间屋子、同一面墙、同一套踢脚线与顶线，
    // 材质仍然来自实景照片，只是位置是补的。UI 上会明确标注「补面」。
    nearWall: [
      [xR, ceilingH, zNear], [xL, ceilingH, zNear], [xL, 0, zNear], [xR, 0, zNear]
    ]
  };
  // 近端封口用后墙的贴图
  const TEXTURE_ALIAS = { nearWall: 'backWall' };

  const loadTexture = (url) => new Promise((resolve, reject) => {
    loader.load(url, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      resolve(texture);
    }, undefined, reject);
  });

  const surfaceReport = [];
  const textureCache = new Map();
  await Promise.all(Object.keys(cornerMap).map(async (key) => {
    const corners = cornerMap[key];
    const sourceKey = TEXTURE_ALIAS[key] || key;
    const entry = textures[sourceKey];
    if (!corners) return;
    let material;
    if (entry?.url) {
      try {
        let texture = textureCache.get(entry.url);
        if (!texture) {
          texture = await loadTexture(entry.url);
          textureCache.set(entry.url, texture);
          disposables.push(texture);
        }
        material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        disposables.push(material);
        surfaceReport.push({
          key, textured: true, size: [entry.width, entry.height],
          photo: PHOTO_SURFACES.includes(key), from: sourceKey
        });
      } catch {
        material = new THREE.MeshBasicMaterial({ color: '#d8d0c2', side: THREE.DoubleSide });
        disposables.push(material);
        surfaceReport.push({ key, textured: false, reason: '贴图加载失败', from: sourceKey });
      }
    } else {
      material = new THREE.MeshBasicMaterial({ color: '#b9b1a4', side: THREE.DoubleSide });
      disposables.push(material);
      surfaceReport.push({ key, textured: false, reason: '没有这个面的贴图', from: sourceKey });
    }
    const mesh = new THREE.Mesh(buildQuad(THREE, corners), material);
    mesh.name = `surface:${key}`;
    if (PHOTO_SURFACES.includes(key)) mesh.userData.photoDerived = true;
    roomGroup.add(mesh);
    disposables.push(mesh.geometry);
  }));

  // 画框的立体感需要一点点光（墙面本身不受光，所以不会破坏实拍质感）
  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const keyLight = new THREE.DirectionalLight(0xfff2dc, 1.05);
  keyLight.position.set(centerX, ceilingH - 0.2, zNear + depth * 0.35);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xdfe8ff, 0.35);
  fillLight.position.set(centerX + width * 0.4, ceilingH * 0.6, zFar + depth * 0.6);
  scene.add(fillLight);

  // 照片里识别到的筒灯：只做视觉提示（小圆片），不参与照明计算，
  // 因为墙面已经是实拍光照，再多打灯只会过曝。
  const lightDots = new THREE.Group();
  scene.add(lightDots);
  lights.forEach((item) => {
    const radius = Math.max(0.06, Math.min(0.22, (item.radius || 3) * 0.03));
    const geo = new THREE.CircleGeometry(radius, 16);
    const mat = new THREE.MeshBasicMaterial({ color: '#fff6e0', transparent: true, opacity: 0.85 });
    const dot = new THREE.Mesh(geo, mat);
    dot.position.set(item.position[0], item.position[1] - 0.005, item.position[2]);
    dot.rotation.x = Math.PI / 2;
    dot.renderOrder = 2;
    lightDots.add(dot);
    disposables.push(geo, mat);
  });

  // ---------------------------------------------------------------- 作品上墙
  const artGroup = new THREE.Group();
  scene.add(artGroup);
  const pickables = [];
  const artRecords = [];

  const disposeGroup = (group) => {
    const kill = [];
    group.traverse((node) => {
      if (node.isMesh) {
        kill.push(node.geometry);
        (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) => {
          if (m?.map) m.map.dispose();
          m?.dispose();
        });
      }
    });
    group.clear();
    kill.forEach((g) => g?.dispose());
  };

  /** 槽位中心 → 世界坐标；沿法线抬起一点，避免与墙共面 z-fighting。 */
  const slotAnchor = (slot, lift = 0.012) => ({
    x: slot.position[0] + (slot.normal?.[0] || 0) * lift,
    y: slot.position[1],
    z: slot.position[2] + (slot.normal?.[2] || 0) * lift
  });

  /**
   * 重新挂一遍作品：按「后墙 → 左墙 → 右墙」的顺序填满槽位。
   * 每个作品做成三件套：墙面浅影 + 实体厚度盒 + 装裱整图（不受光）。
   */
  const hang = async (list = []) => {
    disposeGroup(artGroup);
    pickables.length = 0;
    artRecords.length = 0;
    const usable = list.filter((item) => item && item.imageUrl);
    const count = Math.min(usable.length, slots.length);

    for (let i = 0; i < count; i += 1) {
      const artwork = usable[i];
      const slot = slots[i];
      let image;
      try {
        image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('作品图读取失败'));
          img.src = artwork.imageUrl;
        });
      } catch { continue; }

      const aspect = (image.naturalWidth || 1800) / (image.naturalHeight || 1360);
      const { width: w, height: h } = fitArtworkToSlot(aspect, slot);
      const anchor = slotAnchor(slot);
      const frameDepth = Math.max(0.025, Math.min(0.06, w * 0.035));

      const frame = new THREE.Group();
      frame.position.set(anchor.x, anchor.y, anchor.z);
      frame.rotation.y = slot.rotationY || 0;
      frame.userData.artworkId = artwork.id;
      frame.name = `artwork:${artwork.id}`;

      // 实体厚度盒：读得出来的立体感来源（正面会被作品图盖住，只露出侧边）
      const boxGeo = new THREE.BoxGeometry(w, h, frameDepth);
      const boxMat = new THREE.MeshStandardMaterial({
        color: await sampleFrameColor(THREE, image),
        roughness: 0.62, metalness: 0.18
      });
      const box = new THREE.Mesh(boxGeo, boxMat);
      box.position.z = -frameDepth / 2;
      box.castShadow = false;
      frame.add(box);

      // 墙面浅影：让画框看起来"贴"在墙上而不是浮着
      const shadowGeo = new THREE.PlaneGeometry(w * 1.06, h * 1.08);
      const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16 });
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.position.z = -frameDepth - 0.004;
      frame.add(shadow);

      // 装裱整图（含外框 / 卡纸 / 作品 / 展签），不受光，像素原样呈现
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
      const faceGeo = new THREE.PlaneGeometry(w, h);
      const faceMat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      const face = new THREE.Mesh(faceGeo, faceMat);
      face.position.z = 0.001;
      face.userData.artworkId = artwork.id;
      frame.add(face);
      pickables.push(face);

      artGroup.add(frame);
      artRecords.push({
        id: artwork.id, slotId: slot.id, wall: slot.wall,
        width: w, height: h, position: [anchor.x, anchor.y, anchor.z], rotationY: slot.rotationY || 0,
        student: artwork.student, title: artwork.title, date: artwork.date
      });
    }
    requestRender(600);
    return artRecords.slice();
  };

  // ---------------------------------------------------------------- 相机控制
  // yaw/pitch 的含义全场景统一为「相机看向哪儿」（前方向量），两种模式共用，
  // 否则缓动结束后把位姿写回 controls 时，两种模式会朝相反方向看。
  //   forward = (sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch))
  //   漫游：camera.lookAt(position + forward)
  //   环视：camera.position = target − forward · distance，再朝 target 看
  const controls = {
    mode: initialMode,
    yaw: Math.PI, pitch: 0,
    keys: new Set(),
    dragging: false,
    lastX: 0, lastY: 0,
    distance: Math.min(depth * 0.42, 6),
    target: new THREE.Vector3(centerX, room.hangingHeight || 1.55, zFar + depth * 0.35)
  };

  const forwardVector = (yaw = controls.yaw, pitch = controls.pitch, out = new THREE.Vector3()) => out.set(
    Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)
  ).normalize();

  let tween = null;
  const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2);

  /**
   * 缓动到指定机位。统一按「位置 + 注视点」来插值：
   * 这样漫游模式和环视模式共用一条路径，不用给两种模式各写一套。
   * 结束后把结果同步回 controls（yaw/pitch/distance/target），
   * 否则缓动一结束、用户再拖拽就会被旧的 yaw/pitch 拽回去。
   */
  const tweenTo = ({ position, lookAt, ms = 800 }) => {
    const toPos = new THREE.Vector3(...position);
    const toLook = new THREE.Vector3(...lookAt);
    // 终态的 yaw/pitch 必须由「朝哪看」推出（forward = look − pos）
    const forward = new THREE.Vector3().subVectors(toLook, toPos);
    const dist = Math.max(0.25, forward.length());
    forward.normalize();
    tween = {
      fromPos: camera.position.clone(),
      toPos,
      lookTarget: toLook,
      fromLook: camera.position.clone().addScaledVector(forwardVector(), Math.max(1, controls.distance)),
      endYaw: Math.atan2(forward.x, forward.z),
      endPitch: Math.asin(Math.max(-1, Math.min(1, forward.y))),
      endDistance: dist,
      endTarget: toLook.clone(),
      start: performance.now(),
      ms
    };
    requestRender(ms + 220);
  };

  const setMode = (mode) => {
    if (mode === 'orbit' && controls.mode !== 'orbit') {
      // 环视围绕一个中心点转：中心点就取当前正前方 distance 处，画面不跳。
      const f = forwardVector();
      controls.distance = Math.max(1.2, Math.min(depth * 0.6, controls.distance));
      controls.target.copy(camera.position).addScaledVector(f, controls.distance);
    }
    controls.mode = mode;
    requestRender(500);
  };

  const resetView = () => tweenTo({
    position: [centerX, room.eyeHeight || 1.6, zNear + Math.min(1.4, depth * 0.25)],
    lookAt: [centerX, room.hangingHeight || 1.55, zFar + depth * 0.35],
    ms: 700
  });

  /** 直接摆一个机位（不经过模式推导），可用于"保存封面角度"或跳转到入口。 */
  const setViewpoint = ({ position, lookAt, animated = true }) => {
    if (!position || !lookAt) return false;
    if (animated) tweenTo({ position, lookAt, ms: 700 });
    else {
      camera.position.set(...position);
      camera.lookAt(new THREE.Vector3(...lookAt));
      controls.target.set(...lookAt);
      const f = new THREE.Vector3(...lookAt).sub(new THREE.Vector3(...position));
      controls.distance = Math.max(0.25, f.length());
      f.normalize();
      controls.yaw = Math.atan2(f.x, f.z);
      controls.pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
      requestRender(300);
    }
    return true;
  };

  /** 聚焦到某件作品：站到它正前方看它。 */
  const focusArtwork = (id) => {
    const record = artRecords.find((r) => r.id === id);
    if (!record) return null;
    const normal = new THREE.Vector3(Math.sin(record.rotationY), 0, Math.cos(record.rotationY)).normalize();
    const eye = new THREE.Vector3(...record.position).addScaledVector(normal, Math.max(1.15, record.width * 1.35));
    eye.y = Math.max(1.02, record.position[1] - 0.08);
    tweenTo({ position: eye.toArray(), lookAt: record.position, ms: 850 });
    return record;
  };

  // ---- 指针交互
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;

  const hitTest = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.artworkId;
    return artRecords.find((r) => r.id === id) || null;
  };

  const onPointerDown = (event) => {
    downAt = { x: event.clientX, y: event.clientY, t: performance.now() };
    controls.dragging = true;
    controls.lastX = event.clientX;
    controls.lastY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (controls.dragging) {
      const dx = event.clientX - controls.lastX;
      const dy = event.clientY - controls.lastY;
      controls.lastX = event.clientX;
      controls.lastY = event.clientY;
      controls.yaw -= dx * 0.0042;
      controls.pitch = Math.max(-1.2, Math.min(1.2, controls.pitch - dy * 0.0034));
      requestRender(400);
      return;
    }
    if (onHover) {
      const hit = hitTest(event);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
      onHover(hit);
    }
  };
  const onPointerUp = (event) => {
    controls.dragging = false;
    if (!downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    const quick = performance.now() - downAt.t < 500;
    downAt = null;
    if (!moved && quick && onPick) {
      const hit = hitTest(event);
      if (hit) onPick(hit);
    }
  };
  const onWheel = (event) => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0011);
    if (controls.mode === 'orbit') {
      controls.distance = Math.max(0.7, Math.min(depth * 0.9, controls.distance * factor));
    } else {
      const dir = new THREE.Vector3(Math.sin(controls.yaw), 0, Math.cos(controls.yaw));
      camera.position.addScaledVector(dir, (1 - factor) * 1.6);
    }
    requestRender(400);
  };
  const onKeyDown = (event) => {
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      controls.keys.add(key);
      requestRender(600);
    }
  };
  const onKeyUp = (event) => controls.keys.delete(event.key.toLowerCase());

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', () => { controls.dragging = false; });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // ---- 尺寸
  const resize = () => {
    const parent = canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth || canvas.clientWidth || 640);
    const h = Math.max(1, parent?.clientHeight || canvas.clientHeight || 400);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender(200);
  };
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (observer && canvas.parentElement) observer.observe(canvas.parentElement);
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------- 渲染循环
  const moveCamera = (dt) => {
    const speed = 2.4 * dt;
    const keys = controls.keys;
    const forward = new THREE.Vector3(Math.sin(controls.yaw), 0, Math.cos(controls.yaw));
    // 右手系：right = forward × up（up = +Y），所以 right = (−fz, 0, fx)
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const step = new THREE.Vector3();
    if (keys.has('w') || keys.has('arrowup')) step.add(forward);
    if (keys.has('s') || keys.has('arrowdown')) step.sub(forward);
    if (keys.has('a') || keys.has('arrowleft')) step.sub(right);
    if (keys.has('d') || keys.has('arrowright')) step.add(right);
    if (step.lengthSq() > 0) {
      step.normalize().multiplyScalar(speed);
      camera.position.add(step);
      if (clampInside) {
        const pad = 0.35;
        camera.position.x = Math.max(xL + pad, Math.min(xR - pad, camera.position.x));
        camera.position.z = Math.max(zFar + pad, Math.min(zNear + pad * 0.4, camera.position.z));
        camera.position.y = Math.max(0.9, Math.min(ceilingH - 0.3, camera.position.y));
      }
      renderUntil = performance.now() + 220;
    }
    const f = forwardVector();
    if (controls.mode === 'orbit') {
      // 环视：站在 target 后方 distance 处朝 target 看（forward 指向 target）
      camera.position.copy(controls.target).addScaledVector(f, -controls.distance);
      camera.lookAt(controls.target);
    } else {
      camera.lookAt(camera.position.clone().add(f));
    }
  };

  const loop = () => {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    if (tween) {
      const k = Math.min(1, (now - tween.start) / tween.ms);
      const e = easeInOut(k);
      camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
      const look = new THREE.Vector3().lerpVectors(tween.fromLook, tween.lookTarget, e);
      camera.lookAt(look);
      dirty = true;
      if (k >= 1) {
        // 把最终位姿写回 controls，之后的拖拽/WASD 才能无缝接上
        controls.target.copy(tween.endTarget);
        controls.distance = tween.endDistance;
        controls.yaw = tween.endYaw;
        controls.pitch = tween.endPitch;
        tween = null;
      }
    } else {
      const moving = controls.keys.size > 0 || controls.dragging;
      if (moving || now < renderUntil) { moveCamera(dt); dirty = true; }
    }

    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
  };
  raf = requestAnimationFrame(loop);

  // 首帧：先布展，再按默认机位摆好
  if (artworks.length) await hang(artworks);
  moveCamera(0);
  renderer.render(scene, camera);

  return {
    THREE,
    scene,
    camera,
    renderer,
    surfaces: surfaceReport,
    artworks: () => artRecords.slice(),
    slotCount: slots.length,
    setArtworks: hang,
    hang,
    setMode,
    resetView,
    setViewpoint,
    focusArtwork,
    requestRender,
    resize,
    /** 当前机位，用于"保存封面角度"之类的后续功能 */
    getCamera: () => ({
      position: camera.position.toArray(), target: controls.target.toArray(),
      yaw: controls.yaw, pitch: controls.pitch, mode: controls.mode
    }),
    dispose() {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      disposeGroup(artGroup);
      disposeGroup(roomGroup);
      disposeGroup(lightDots);
      disposables.forEach((item) => item?.dispose?.());
      renderer.dispose();
      scene.clear();
    }
  };
}
