# prototype/ —— 昕乐绘 AI 成长平台高保真原型

React + Vite 单页原型（`src/main.jsx` 是主入口，另按模块拆出 `src/gallery/`、`src/services/`、`src/data/`）。
所有需求实现都落在这个目录内，**验收底线是 `pnpm run build` 通过**。

## 常用命令

- `pnpm run build` —— 唯一的强制质量门（没有 test / lint 脚本；Vite 构建会做语法与依赖校验）。
- `pnpm run dev` —— 本地开发，访问 `http://127.0.0.1:5173`。
- `node node_modules/vite/bin/vite.js` 不要直接调 system vite：依赖都装在本目录里。

## 数据层分层（改任何业务数据前先读这一节）

每个实体都是「一份 data 模块 + 一份 service 模块」的配对：

| 关注点 | 位置 | 约定 |
|---|---|---|
| 本地兜底 + 种子数据 + 领域规则 | `src/data/<entity>.js` | 纯函数、无网络；`load<X>() / persist<X>()`、`createEmpty<X>()`、`normalize<X>()` |
| 云端表读写 | `src/services/<entity>Api.js` | `import { cloud, unwrap } from '../cloud'`，表名常量 `TABLE` |

- 云端行是 **snake_case**，应用内是 **camelCase**，转换只在 `services/*Api.js` 的 `rowTo<X>` / `<X>ToRow` 里做，
  业务代码永远不碰 snake_case。
- 幂等写入统一用 `upsert(row, { onConflict: '<x>_key' })`，天然键放 `<x>_key` 列。
- **云端是真源，本地只是兜底**：`main.jsx` 里 `useState(load<X>)` 先渲染本地数据，
  再 `loadRemote<X>().then(remote => { if (remote.length) set<X>(remote) }).catch(() => {})`。
  云端返回空数组时**不要**顶掉本地（否则演示数据消失）；云端不可用时页面必须仍能跑。
- 读接口要给「云端失败 → 回落本地」的兜底（见 `services/lessonApi.js` 的 `loadAllLessons`）；
  写接口要**先写本地镜像再推云端**，云端失败时数据不丢，只是提示同步失败。
- 素材（图片地址、object URL、base64）不进数据模型，只存 id 或 http(s) 地址引用（`feedbackRecordsApi.js` 的 `httpOnly`）。

## 容易踩的坑

- **唯一性不能用 id 派生**：如果实体主键是「自然键的纯函数」，那么冲突检测会退化成「两条记录 id 相同」，
  永远发现不了重复，upsert 还会静默覆盖前一条。主键用随机唯一 id（如 `makeUniqueLessonId()`），
  自然键（`classId + lessonDate + lessonNo`）单独做唯一性校验。
- **只有被 import 的模块才会进构建**。新建了 data/service 模块却没人引用时，`pnpm run build`
  不会编译它，等于没验证。新模块至少要在 `main.jsx` 里接上 state / effect 走一遍。
- 时间戳用 `??` 而不是 `||` 兜底：显式空串表示「历史数据本来就没有」，不要偷偷填 `now`。
- 日期一律归一成 `YYYY-MM-DD` 再比较；旧数据里有 `2026.08.04` / ISO 串 / `Date` 混用。
- 旧数据兼容的写法：`normalize<X>(raw)` 永不抛错，缺字段补默认值，**无法映射的原始对象挂到 `legacy` 字段上原样保留**，
  宁可多带一个字段也不要丢数据；不要为了让旧数据「看起来完整」而编造日期或序号。

## 验证技巧（没有测试框架时的替代方案）

data 模块是零依赖的纯 ESM，可以直接用 Node 跑：`node --experimental-loader <扩展名补全 loader> <脚本>`
（Node 不会解析 Vite 风格的无扩展名相对导入，需要一个小 loader 把 `'../cloud'` 补成 `'../cloud.js'`）。
service 模块也能在 Node 里测：`cloud.database` 是**可写属性**，导入后替换成内存表替身
（builder 需要 `then()` 才能被 `await`）即可覆盖「唯一性 / 状态机 / 云端失败回落」这些关键分支。
