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

## 课程库与课题来源（course ↔ lesson）

- 课题（lesson.topic）的默认值来自课程库：`resolveSyllabusTopic(course, lessonNo)` 先查 `course.syllabus`
  里同 `lessonNo` 的条目，查不到才回落 `course.defaultTopic`；来源可用 `resolveSyllabusEntry().fromSyllabus` 区分。
- **`enabled: false` 只作用于「可选列表」，不作用于「显示」**：老师端选课用 `selectableCourses()` / `loadSelectableCourses()`，
  但历史课次要显示课程名时必须走不过滤的 `findCourseById()` / `resolveLessonCourseName()`，
  否则课程一停用，旧课次的课程名就变成空白。
- 班级数据（`data/studentManagement.js` 的 `class.course`）存的是**课程名**而不是 courseId，
  要拿 id 去关联课次时走 `resolveCourseId(list, value)`（先按 id 查、再按名字查）。
- 新建课程主键用随机的 `makeUniqueCourseId()`；`makeCourseIdFromName()` 的确定性派生只用于读取没有 id 的旧数据。

## 归档记录（feedback_records）的模型与规则（[第四步 US-201]）

一条记录 = **「某位学员的某一次课」**。`data/feedbackRecords.js` 是记录模型的唯一真源（零依赖纯函数，
可 `node` 直跑断言），`services/feedbackRecordsApi.js` 只做 snake_case 行映射。

- **业务唯一键 `recordKey`**：优先 `lessonId::studentId`（两段）；没有课次实体时退化为
  `className::date::studentId::title`（四段）。`studentId` 缺省由姓名确定性派生
  （`lessons.js` 的 `makeStudentId`），`date` 一律先过 `normalizeLessonDate` ——
  `2026.08.04` 与 `2026-08-04` 必须得到同一个键。
- **`id` 由 `recordKey` 派生**：`deriveRecordId(recordKey)` = `feedback-<FNV-1a 8 位十六进制>`，
  与业务键一一对应。同一次课重复归档 → 同一个 `id` → 同一个云端 `record_key`（幂等 upsert 的基础）。
  老记录**保留原 id**（换掉会凭空多出云端孤儿行）。
- **两条日期口径并存，别互相覆盖**：`date` = 课次日期的 ISO（**不是归档当天**）；
  `lessonDate` = 展签口径 `2026.08.04`（US-008b 的既有断言按它校验）。
- **`title` 只能来自真实数据**（`resolveRecordTitle`：老师填的作品名 → 模板的 `plaqueTitle` → 本次课题），
  **禁止**写死「未命名作品」这类占位名（FR-205）。
- 其余字段：`lessonId / courseId / classId / studentId / archivedAt / updatedAt / version` 与
  `reviewTraceId`（关联第三步落盘的推理轨迹，`xinlehui-review-traces-v1` 里按 `recordId` 回指）。
- **读盘一律过 `normalizeFeedbackRecord`**（`loadFeedbackRecords` / `mergeFeedbackRecords` 都调它）：
  旧记录补出新字段、原字段一个都不丢。云端 payload 也要过这一道，否则新字段在界面上是 undefined。
- **按 `recordKey` 去重兜底**（`dedupeFeedbackRecords`，FR-207）：读盘、新记录入列、写盘都过它 ——
  确定性 id 意味着同一个键只该有一条记录。渲染侧的兜底在 `App` 里：
  `const archivedRecords = useMemo(()=>dedupeFeedbackRecords(records),[records])` 传给 `PageRouter`
  （消费方：成长档案 / 学员档案 / 家长端 / 模板引用统计），`setRecords` 仍然改原始 state。
- 就地更新记录走 `updateFeedbackRecord(record, patch)`：`recordKey`/`id` 不变、`updatedAt` 刷新、
  `version` 自增（成品图写回 US-008b 与同键再归档共用这一个入口）。
- **同键再归档 = 更新那一条（[第四步 US-202]）**：落库动作收在 `applyFeedbackRecordArchive(records, incoming)`
  —— 列表里没有同键就 `{mode:'created'}`（新记录入列，先过去重），有同键就 `{mode:'updated'}` 走
  `updateFeedbackRecord`（`id`/`recordKey`/`archivedAt` 不变，`version` 自增、`updatedAt` 刷新，
  正文/素材/成品图按这一次的内容覆盖），列表**就地替换**、顺序不动。
  界面的按钮文案、`data-archive-mode`、toast 里的「第 N 版」只读它的结论，**不自己找同键记录**
  （判定与写入必须是同一次计算，否则会出现「提示说更新了、实际新建了一条」）。
- **「这次归档落到哪一条」的唯一真源是 `feedbackRecordIdentity({…})`**（`recordKey` / `id` / `date` / `title`）：
  `createFeedbackRecord`（写入侧）与界面（按钮 `data-archive-mode`）都读它。谁都不许自己再拼一次
  `recordKey` —— 两处各算一遍，一边 `lessonId::studentId`、一边退化键，就会出现「界面说要更新、实际新建」。
- **按钮文案读的是本次会话的 `archived`，写入语义读的是「列表里有没有同键记录」**（两件事，别混）：
  文案按验收原文「未归档 → 归档并生成分享 / 已归档 → 保存修改并更新档案」；
  `data-archive-mode` 永远是 `update`（同键记录在网表/镜像里已经存在，会就地更新）或 `create`。
  典型分歧场景：老师刷新后再录入同一次课（`archived` 回到 false 但记录还在）—— 文案会说「归档并生成分享」，
  点下去照样更新那一条（`version` 自增，toast 会说「第 N 版」），不会凭空多出一条。
- **更新路径与首次归档走同一条完成路径**：都 `go(4)`（第四步面板上有「进入成长档案」）；
  区别只在 toast —— 更新是「档案已更新（第 N 版）」+ 一个「查看档案」动作（见下）并额外提交一份推理轨迹
  （正文改过 → 这一版的推理过程值得留档）。
- **全局 toast 现在支持一个可选动作**：`setToast(text, {label, onClick})`（`App` 里 `toastAction` state）。
  普通的 `setToast('…')` 会把旧动作清掉（否则上一条提示的按钮会挂在下一条提示上）；带动作的 toast
  存活 6.5 秒（普通 2.6 秒），渲染成 `.toast-action` + `data-toast-action="<label>"`。
- `data/feedbackRecords.js` 的三条 `seedRecords` **刻意保持旧口径**（无新字段）：它们是兼容映射的活样例，
  别顺手给它们补上 `lessonId` 之类的新字段。
- **`App` 里的 hook 一律放在登录页那条提前 `return` 之前**（US-202 真踩）：新加的
  `useMemo(()=>dedupeFeedbackRecords(records))` 写在 `if(!auth) return <AuthScreen/>` **之后**，
  登录那一次渲染就变成「比上一次多一个 hook」，React 直接抛错、整页白屏（`#root` 有内容但只剩错误栈），
  而 `pnpm run build` 与静态检查全绿。诊断信号：脚本点「我是老师」之后 `.sidebar nav button` 永远不出现 +
  `Runtime.exceptionThrown` 里那条 hook 数量不匹配。

### 归档素材的持久化与降级（[第四步 US-203]）

一条归档记录除了正文，还要带**持久地址的图**给家长看（老师端的素材本来是会话内 `blob:`，刷新即失效、
家长端根本取不到）。规则全在 `data/archiveMedia.js`（零依赖），网络 / 画布动作在 `services/archiveMediaApi.js`。

- **四种状态，唯一真源**：`synced`（私有对象存储的 https 地址 + `storageKey`）/ `local`（对象存储未接入，
  降级为**本机持久副本** = data URL）/ `pending`（上传没成功，可重试）/ `missing`（连副本都没有）。
  界面、断言、云端映射都读 `ARCHIVE_MEDIA_STATUSES`，谁都不许自己写字符串。
- **「哪种地址能用」是纯函数产物**：`persistentMediaUrlIssue()` 只认 `https://`（`http://` 含本地适配器的
  127.0.0.1、`blob:`、`data:` 一律不算持久）；`archiveMediaView(entry,{surface})` 给出
  `{url, placeholder, placeholderText}` —— 老师端（`teacher`）本机副本也渲染，家长 / 云端口径
  （`parent`/`cloud`）**只渲染 https，其余一律「图片同步中」占位**（状态也按云端口径收敛成 `pending`）。
  界面只渲染这份产物，不自己判断地址前缀，所以不会出现破图。
- **原图永不上传 = 结构守卫，不是「判断一下」**：`stripOriginalMediaFields()` 在 `createFeedbackRecord`
  里把键名命中 `/original/i` 的字段整个摘掉（`archivePayloadOriginalIssue()` 是断言 / 读数的复核口径）；
  候选素材由 `archiveMediaCandidates()` 只从「成品图 + 修正后的照片」里取（旋转角交给同步层烘进副本像素）。
- **云端只放行 https**：`services/feedbackRecordsApi.js` 的 `toRow` 里 `media: cloudArchiveMedia(record.media)`
  —— https 保留（带 storageKey），其余**地址丢掉、只留一条 `pending` 占位**（家长端要据此显示占位而不是
  一片空白）。`artworkUrl/photoUrl` 那条老口径（`httpOnly`）保持不变。
- **素材同步不动 `version` / `updatedAt`**：`applyArchiveMediaSync()` 只换 `media`。那两个字段记的是
  「老师的正文改到第几版」—— 同步成功不该让「档案已更新（第 N 版）」谎报一次改稿。
  重试入口只调用 `retryArchiveMediaRecord(record)`（老师端第四步 / 管理端清单共用同一份实现）。
- **降级也是正常结果，但要标注**：开发适配器（`server/index.mjs` 的 `POST /api/archive-media`）没有对象存储，
  它如实返回 `storage: 'memory-development-only' + persistent: false` 与一个 **http** 地址 —— 客户端据此
  判成 `local` 并写明「仅本地留存（对象存储未接入）」，而不是假装同步成功。接替替身上传器（`syncArchiveMediaEntry(x,{uploader})`）
  可以走通 `synced` 一路（https + storageKey + `private-object-storage`）。
- **不阻断归档**：整条通道 `永不抛错`，`Promise.race` + `AbortController` 双保险做超时（替身上传器不理会
  signal 也不会把归档挂在 await 上）；材料塞不下时 `stripArchiveMediaUrls()` 摘掉非 https 的本地副本并把状态
  降级为 `pending`（配额兜底，见 `persistFeedbackRecords`）。
- **入口与消费点**：归档时在 `archiveRecord` 里现算候选（**必须在回调里算**，见下面的 TDZ 坑）；
  第四步面板 `.archive-media-sync`（`data-archive-media-*`）显示状态 + 重试；管理端「档案管理」页有
  「素材同步失败」清单（`pendingArchiveMediaRecords`）；老师端的学员档案（`StudentArchiveData` 的课程记录）
  优先渲染 `record.media` 的持久地址，家长端时间线渲染占位。

#### 两个真踩的坑（US-203）

- **渲染期读「后面才定义的 const」= TDZ 白屏，而 `pnpm run build` 全绿**：归档素材的候选要先看
  `writeBackFresh / writeBackRecord`（定义在组件 body 靠后位置的派生值）。把它们写在渲染路径上，
  一进「课后反馈」就抛 `ReferenceError: Cannot access 'writeBackFresh' before initialization`，
  整页白屏 + `Runtime.exceptionThrown`（症状与 US-202 的 hook 数不匹配很像，但报的是 TDZ）。
  **判据**：只有在回调（`archiveRecord` 被点的那一刻）里读它们才安全 —— 组件 body 里读任何「靠后定义的
  const」都要先问一句「这句到底在渲染期跑、还是在回调里跑」。
- **给开发适配器加新请求头，必须同步 `Access-Control-Allow-Headers`**：`POST /api/archive-media` 带了
  `X-Media-Storage-Key`，白名单里没有它 → 浏览器预检失败、请求根本没发出去，功能**静默**降级成
  `pending`（`lastError` 里才有原因，界面上只看到「图片同步中」）。加头时同步改
  `server/index.mjs` 的 `send()` 白名单，并用 curl 复核两条 403（缺身份 / 缺授权）与一条 201。

## 第四步「归档状态 + 转发」（[第四步 US-204] / F-ARCHIVE-01）

> **第四步只回答两件事**：存好了没（归档摘要）、发出去了没（转发准备）。两件事的判据全在
> `src/data/archiveSummary.js`（零依赖以外的依赖只是 `consent.js` / `reviewDetailPanel.js` /
> `reviewTrace.js` 这几份纯数据模块，可 `node` 直跑断言）：组件只渲染它的产物，
> `data-archive-*` / `data-share-*` 属性与浏览器断言读同一份，**摘要字段齐全是结构性的**。

- **`archiveStepView({record, fallback, media, trace})`** 是第四步的整份视图。`record` 必须是
  **已经落库的那条记录**（`currentRecordId` 命中的那一条），不是会话里的临时产物。
  - `state`：`archived`（有记录）/ `incomplete`（没有记录）。**未归档时如实写「还没有写入成长档案」+ 具体原因**
    （缺作品 / 缺点评 / 还没点归档），绝不显示「已完成」。
  - `rows`：验收点名的七项（`ARCHIVE_SUMMARY_FIELDS` 是顺序真源）—— 学员 / 课次日期 / 作品名 /
    归档时间 / 版本号 / 素材同步状态 / 点评状态；两种状态都给全七行。
  - `ok` = 这一项正不正常；`blocking` = 缺了它算不算「摘要不全」。**素材同步状态不 blocking**
    （US-203 的口径：对象存储未接入只是降级为本地留存），它只进 `warnings`；`missing` 只收 blocking 的缺项。
  - 点评状态：个人反馈按五维逐维计数 + 「推理轨迹已留档（成功）」；班级反馈按**记录是否落库**判定
    （归档前置校验保证过「本次点评已生成」），没落库时不替老师声称已确认。
- **`archiveForwardView({step, consent, student, lessonDate, title})`** 是「转发给家长」面板的三态：
  `incomplete`（先归档）/ `blocked`（家长未完成查看授权 → 阻止转发 + 「去授权管理」入口，
  照 US-208 第 3 条）/ `ready`（内容清单 + 微信文案）。
  - 授权读 `data/consent.js` 的 `findConsent(loadConsents(), {name, studentId})`：**与 US-411 第一步的提示、
    US-208 转发前的硬校验同一份来源**，不要在这里另写一套判断；没有授权记录的学员 fail-safe 算未授权。
  - 微信文案含学员名 + 课次日期、不含联系方式；链接与二维码归 US-208（`ARCHIVE_SHARE_LINK_NOTE`
    如实说明未接入，不给假回执）。
- **第四步的界面（`main.jsx` 的 `step===4`）**：`.archive-summary` 七行摘要 + `.archive-media-sync`
  （US-203 的素材面板）+ 按需展开的 `.archive-share` 转发面板；主操作三个 ——
  **返回修改点评** / **转发给家长** / **进入成长档案**。正文那一句统一写
  `作品、课堂照片与五维点评已经写入成长档案。`（`assert-us108a` 有源码级断言，别改这句）；
  归档回执同样以「已写入成长档案：…」开头（更新路径仍是「档案已更新（第 N 版）」，有脚本断言）。
- **「返回修改点评 → 再归档 = 就地更新」**：`archiveRecord` 读 `applyFeedbackRecordArchive` 的结论，
  同键走 `updateFeedbackRecord`（version 自增、id / recordKey / archivedAt 不变），两种模式都 `go(4)`，
  只差 toast 文案 —— 这是 US-202 的既有口径，第四步的摘要因此天然显示第 N 版与「最近更新」时间。
- **旧档案实现已清空**：`CourseLearningTimeline` / `StageReviewSummary` / `GrowthArchiveBuilder*` /
  `AcademicAssessment*` / `LearningRadar*` / `OnlineExhibition` / `StudentArchiveHub*` / `StudentAssessment` /
  `ArchivesPage` / `ParentArchive` / `ParentHome` / `Timeline` 全部删除（US-204 第 6 条），
  全站只剩 `GrowthArchiveData`（成长档案页）+ `StudentArchiveData`（学员档案页）这一份实现。
  **删改这一族时先 grep 全 `src/` 确认没有活引用**（它们只服务于彼此，删一个就要连带删它的专用小组件）。
  已知边界：这些组件的 CSS 规则（`.timeline` / `.holistic-radar` / `.learning-radar` / `.student-archive-hub` 等）
  仍留在样式表里（不影响功能，`parent-timeline` 这类前缀相近的类仍在用，清理时不要按前缀盲删）。

#### 两个真踩的坑（US-204）

- **`archiveStepView` 的返回值里少一个字段 = 渲染期白屏，而 `pnpm run build` 全绿**：第四步的两块面板
  （`archiveSummaryField` / `archiveShareField`）在组件 body 里**无条件计算**，`data-archive-summary-missing
  ={archiveStep.missing.join(',')}` 一旦在某个状态拿到 `undefined` 就整页炸掉（现象：点「课后反馈」白屏、
  只留 `Runtime.exceptionThrown`）。**两种状态的返回结构必须同形状**（`missing` / `warnings` / `blockers`
  都要给），验证脚本要覆盖「未归档就点第四步」这条路径。
- **流程状态是会话内的**：离开「课后反馈」页再回来会重挂载 `TeacherFlowV2`（素材与 `currentRecordId` 归零、
  草稿把班级/学员带回来但从第一步重来）。想在第四步上做 UI 断言（390px、转发面板）**必须在离开之前做完**；
  第二轮的浏览器验证要显式把班级与学员再选一遍（「新建草稿」回到未选学员的初始态），别假设第一轮选中的学员还在。
  （US-208a 补充：**再走一次流程要真的换页** —— 点同一个侧边栏项（已在「课后反馈」页）不会重新挂载，
  还停在第四步；先点「进度看板」再点「课后反馈」才回到第一步。）

## 家长分享令牌（[第四步 US-208a] / F-ARCHIVE-SHARE-01）

> 老师要把这一次的成长记录发给家长，链接形如 `/p/<shareToken>`。令牌的**唯一真源**是
> `src/data/shareTokens.js`（零依赖纯函数 + 常量，可 `node` 直跑断言），推云端在
> `src/services/shareTokensApi.js`（表 `share_tokens`，按 `token_key`（= 令牌本体）幂等 upsert；
> 表还没建时只落本机镜像 —— 与审计日志 / 阶段报告同一套兜底口径）。令牌账挂在 **App 层**
> （`shareTokens` state），因为读它的不止第四步：档案列表的转发状态（US-209）与家长分享页（US-210）读同一份。

- **令牌 = 24 字节密码学随机 → 拒绝采样映射到 57 个「无易混字符（0/O/1/l/I）」的字母表 → 32 位字符串**
  （约 187 位熵）。**拒绝采样不能省**：`256 % 57 ≠ 0`，裸取模会让字母表前 28 个字符多出一份概率。
  没有 `crypto` 的环境回落 `Math.random` 兜底（令牌生成失败比令牌不够随机更糟，且永不抛错）；
  `shareTokenStrength()` 是「长度 / 字母表 / 熵 / strong」的可断言读数，面板上也给老师看一眼。
- **状态永远推导，不落库**：`shareTokenStatus(record, now)` → `active | expired | revoked`（脏记录 `invalid`）。
  记录里**没有** `status` 字段（存了就会与 `revokedAt` / `expiresAt` 漂移，「说要撤回、链接还能开」正是这么来的）；
  **撤回优先于有效期**（`revokedAt` 一有值就立即失效）；`expiresAt` 读不出来按 `expired` 处理 ——
  不能因为数据读坏了，就把孩子的素材一直挂在老链接里。
- **默认 30 天且可配置**：`SHARE_TOKEN_DEFAULT_VALID_DAYS = 30` + `SHARE_TOKEN_VALID_DAY_OPTIONS`
  （面板下拉读它），自定义天数过 `normalizeShareTokenValidDays()` 收敛到 1~365 天；
  `shareTokenExpiresAt(createdAt, days)` 是「到期时刻 = 生成时刻 + N 天」的唯一算法。
- **生成前的授权闸门 = `shareTokenGenerationGate(archiveForwardView(...))`**：读的是第四步转发面板的产物
  （也就是 `data/consent.js` 那一份来源），**只有 `ready` 才 `allowed`**；未授权时把可读原因与
  「去授权管理」入口原样带出来。界面**不写第二套授权判断**，生成动作的第一步就是
  `if(!shareTokenGate.allowed){…return;}`（先拦，再碰数据）。
- **家长端唯一查询入口是 `resolveShareToken(tokens, token, now)`**（US-210 读它）：令牌不存在与记录是脏数据
  都归 `invalid`（对家长都一样：这个链接打不开）。US-208 验收点名的「该分享已撤回」收在
  `SHARE_TOKEN_REVOKED_PHRASE` 里**只写一次**，老师端的回执文案由它拼出来（界面源码 0 命中）。
- **`mergeShareTokens` 的方向是「撤回必须赢」**：本机记录在前、云端只补本机没有的令牌；同一个令牌两边都有时，
  只要云端撤回过而本机还没撤，就采用云端那一条 —— 在另一台设备上撤掉的链接，这台设备也必须立即失效。
  反过来（本机已撤回、云端还是旧的未撤回版本）**不能**被顶掉。
- **`ARCHIVE_SHARE_LINK_NOTE` 在 US-208a 改成「默认 30 天有效、可随时撤回」**：原文那句
  「接入后可直接发送给家长」在链接接入后就是假话。`assert-us061*` 对它的断言是「等于常量」与
  「含 `F-ARCHIVE-SHARE-01`」，所以改文案不用改脚本。

#### 真踩的坑（US-208a）

- **根节点 `data-*` 与控件选择器同名会再次咬人**（US-206 的同一类）：分享链接块的根节点
  `data-share-token-valid-days="30"` 与有效期下拉的 `data-share-token-valid-days="true"` 撞名后，
  `document.querySelector('[data-share-token-valid-days]')` 取到的是**根 div**（文档顺序在前），
  验证脚本把 `HTMLSelectElement.prototype.value` 的 setter 用到 div 上 → `TypeError: Illegal invocation`
  （报错位置在求值表达式的第 3 行，完全指不到选择器）。**根节点读数一律带后缀**（`-value`），
  控件选择器带 `="true"` 标记。
- **钉住「同一条档案」再断言令牌**：`shareTokenView({recordId})` 只认**档案记录 id**，而重新走一遍流程
  会按 `classId + lessonDate + lessonNo` 找回同一次课（`currentLessonId` 从草稿恢复，US-409）——
  于是「重新生成」这条路径必须**用同一个日期 + 同一个学员**再走一遍流程，否则落到另一条记录上、
  面板显示的是「还没有生成分享链接」（看着像令牌丢了）。

## 分享二维码 · 微信文案复核 · 分享内容边界（[第四步 US-208b] / F-ARCHIVE-SHARE-01）

> 链接（US-208a）之后的三件事，判据都在 `src/data/archiveShare.js`（零依赖纯函数 + 常量，可 `node` 直跑）；
> 画布那一半在 `src/services/shareQr.js`。**编码与绘制复用装裱水印那一支**，不要另写第二个二维码实现。

- **二维码 = 装裱水印那条路径的三段复用**：编码 `services/qrCode.js` 的 `qrMatrix()` →
  绘制 `services/framing.js` 新导出的 `paintQrMatrixToCanvas()`（内部就是 `planOverlayQr` + `paintOverlayQr`，
  白底 / 静区 / 模块取整同一套口径）→ 下载 `services/artworkExport.js` 的 `downloadArtworkExport()`。
  于是「面板上的分享二维码」与「印在孩子作品上的二维码」不可能有两种画法；改了画笔两边一起变。
- **静区是硬要求，靠比例算而不是手动留白**：`shareQrBoxRatio(modules) = modules / (modules + 2 × 4)`，
  方框 + 四周 4 模块静区**正好铺满**画布（多留白浪费像素、少留白识别器读不稳）。
  验证时按绘制计划的 `box` 反推静区宽度（`moduleSize × 4`）与 `plan.quiet` 对齐。
- **`ready: false` 就不画**：`shareQrPayload({token, origin})` 没令牌时 `url` 为空 →
  `renderShareQr()` 返回 `null` → 界面连二维码块都不渲染（**撤回 / 过期后不给扫不开的码**）。
  这与 US-003c「编不出来就不画」是同一条纪律。
- **二维码里编码的是完整地址**（`shareTokenUrl(token, {origin})`，与「复制链接」同一个值）；
  面板上同时给出 `/p/<token>` 与完整地址两个读数 —— 家长扫的是前者所在的站点，老师复制的是后者。
- **微信文案本体仍由 `data/archiveSummary.js` 的 `archiveWechatCopyText()` 生成**（只有一份），
  `data/archiveShare.js` 只配一个**复核口径**：`archiveWechatTextChecks({text, student, lessonDate})` →
  `{hasStudent, hasLessonDate, contactIssues, ok, note}`。禁项清单 `ARCHIVE_SHARE_WECHAT_FORBIDDEN`
  覆盖手机号 / 座机 / 邮箱 / 微信 QQ / 链接五类（**链接也算**：分享靠二维码与「复制链接」两个显式动作）。
  `assert-us061-browser` 的老断言 `!/(1\d{10}|https?:\/\/|@)/` 与此同一口径，所以**不要往文案里加链接**。
- **分享内容 = 白名单现拼，绝不 `...record`**：`archiveSharePayload()` 只取
  `record.media`（归档素材：成品图 + 修正后的课堂照片，US-203 已保证原图不上传）、
  `reviews` 里**五维白名单维度**的正文、学员 / 课次 / 作品名 / 令牌。
  `archiveShareLeaks({payload, record})` 是复核口径：递归找禁字段（`/original|trace|prompt|reasoning|memory|agentfile|skill|system/i`）
  + **值级复核**「记录上的 `reviewTraceId` 不许出现在分享数据的 JSON 里」+ 归档记录里的原图字段。
  写入侧靠白名单（结构上放不进来），泄漏函数是给断言与界面读数用的 —— 与 `archivePayloadOriginalIssue` 同一条纪律。
- **边界面板的三种状态返回同一组字段**（`{ok, state, rows, excluded, leaks, payload, payloadChars, note}`），
  行也同形状（`{id, label, value, detail, ok, blocking}`）—— US-204 的白屏坑就是这么来的，
  断言里专门有一条「三种状态 Object.keys 相同」。
- **`data-share-qr-*` 读数一律挂二维码块根节点**，动作按钮的读数是 `data-share-copy-link` /
  `data-share-download-qr` / `data-share-copy`（三个动作的读数名不同，别混）—— 断言里读全局
  `document.querySelector('[data-share-copy-link]')` 时要注意**块不存在时读数为 null**，
  写脚本别把 `null` 当 `false` 比（本轮真踩：`[false,false]` vs `[null,null]`）。

#### 真踩的坑（US-208b）

- **`useMemo` 里的 canvas 渲染位置要与依赖同层**：二维码只在「链接可用」时渲染，键是
  `shareQrToken = shareTokenPanel.active ? tokenText : ''`（撤回 / 过期后键变空 → 块消失）。
  把 `renderShareQr` 写在 render 里而不 memo，会在每次 state 变化时重编 + 重编码一次 PNG（640×640）。
- **分享数据里的素材地址来自 `record.media`，不是写回副本**：`record.framedArtwork.imageUrl`
  是老师本机的展示副本（常为 `data:` URL），`record.artworkUrl` 是归档前的地址 ——
  两者都不进分享数据，分享只认归档素材记录（`media[].url` + `status` + `storageKey`）。
  验证脚本因此断言「分享里的每个素材地址都出现在 `record.media` 的地址集合里」，
  而不是笼统地禁 `data:`（未接入对象存储时本地持久副本本身就是 data URL，是正常降级）。
- **长按保存不另做一套**：iOS / 微信内置浏览器不执行 blob 下载（US-008a 的判据在
  `artworkExportSaveStrategy`），但二维码**本来就在面板上显示着**（`<img src=dataUrl>`，640px），
  所以点下载只给一句「长按图片保存」的如实回执，**不复用第二步的 `saveImageSheet`**
  （那张 sheet 只在 `step===2` 渲染，且有 `step!==2` 就关掉的 effect —— 在第四步设它不会显示）。

## 转发状态跟踪（[第四步 US-209] / F-ARCHIVE-SHARE-01）

> 「发过没发过、发的是哪一版、家长看没看」的唯一真源是 `src/data/shareForward.js`（零依赖纯函数 + 常量，
> 可 `node` 直跑断言；字段仍落在 `data/shareTokens.js` 的令牌记录上）。第四步的**状态条 / 状态块**与
> 档案列表那一行读的是**同一个** `shareForwardView()` —— 界面不自己拼「未转发 / 已转发 / 已撤回」。

- **三态推导，不落库**：`shareForwardStatus(record)` → `idle`（还没有 `sentAt`）/ `sent` / `revoked`，
  **撤回优先**。记录里没有 `forwardStatus` 字段（与 US-208a 的 `status` 同一条纪律：存了就会漂移）。
- **转发四件事**（验收点名的四项）：`sentAt`（转发时间）/ `channel`（渠道，枚举只有 `wechat` 微信 · `link` 复制链接）/
  `sentVersion`（**发送那一刻**的档案版本 → 显示「第 N 版」）/ `openCount`。另有 `sentCount`（第几次，
  重新发送会累计，行说明里写「共 N 次」）。**「一次转发」= 复制成功那一下**（复制失败不记发送 ——
  不谎报已转发）；「生成链接」本身不算转发。
- **家长打开只由一条路径写**：`applyShareOpen(tokens, token, {at})` → `openCount+1`、`firstOpenedAt` **只写一次**、
  `lastOpenedAt` 每次更新。地址是 `/p/<token>`（`readShareLinkToken(pathname)` 解析），App 在
  **所有 hook 之后**按它提前 return `<ParentSharePage>`（家长页不登录、不挂侧边栏）。页面**内容**
  （作品 / 照片 / 点评 / 390px）见下一节「家长分享页（US-210）」。
- **「重新发送」的判断在 data 层**：`shareForwardResendPlan({forward, gate, record})` 给出
  `allowed / reason / regenerate / channel / action`；链接不可用（没有 / 已过期 / 已撤回）时 `regenerate: true`
  → 先生成新链接再复制（沿用上次渠道，没有上次就用默认微信）。撤回仍是 US-208a 那条二次确认路径，一字没动。
- **多标签页写同一份账：落盘前先跟镜像并一次**。`persistShareTokens(mergeShareTokens(shareTokens, loadShareTokens()))`、
  `recordForwardSend` 与重新发送的底账都是这条纪律 —— 否则另一张标签页（家长打开分享页）刚记下的
  `openCount` 会被老师这一页的旧快照写回去（本轮真踩：打开 2 次被写回 1 次）。`mergeShareTokens` 的跟踪字段
  是**只增不减**的：次数取并集、`firstOpenedAt` 取更早、`lastOpenedAt` 取更晚、发送时刻取更晚（渠道跟着那一次走），
  撤回仍然是「谁撤过用谁」。
- App 另外监听 `storage` 事件把另一张标签页的写入并回来（同浏览器多标签实时同步）；跨设备仍然靠云端
  `share_tokens` 表（表未建时只落本机镜像），**刷新页面照样读得到**（验收第 5 条）。

#### 真踩的坑（US-209）

- **`Target.createTarget(url)` 直接开家长页时，多标签写入是竞态的**：验证脚本里「家长打开 → 老师端读数」
  的断言要靠 `waitForCondition` 等收敛，别用固定 `sleep` 硬等；产品侧的解是上面的「落盘前先并镜像」。
- **档案列表那一行的断言要按课次日期选行**：`[data-archive-lesson-forward]` 每节课都有一个（缺课卡也有），
  `document.querySelector` 取到的是**第一条**（种子记录）而不是刚分享的那条 —— 选择器写成
  `[data-archive-lesson-forward][data-archive-lesson-date="YYYY-MM-DD"]`。
- **老师端侧边栏没有「成长档案」**（US-206 的既有事实）：档案列表只能从第四步点「进入成长档案」进去；
  再回第四步只能重新走一遍流程（同一个学员 + 同一个课次日期命中同一条记录，recordKey 不变、版本自增）。

## 家长分享页（[第四步 US-210] / F-ARCHIVE-SHARE-01）

> 家长点开 `/p/<shareToken>` 看到的那一页：课次日期 · 成品作品图 · 课堂照片 · 五维点评（老师确认后的版本）+
> 机构视觉（暖金 / 墨黑 / 暖白，`.parent-share-*` 在 `src/archive-enhancements.css`）。
> 组件 `src/ParentSharePage.jsx` **只渲染**（没有一句写死的文案、没有一处状态判断、没有逻辑），
> 整份读数在 `src/data/parentShareView.js`（零依赖纯函数 + 常量，可 `node` 直跑断言）。

- **只有令牌可用（active）才渲染内容**：`parentShareView` 在 `resolved.active` 为假时连学员名都不取
  （`contentVisible:false`、`student/lessonDate/title:''`、`artwork.url:''`、`dimensions:[]`）——
  撤回之后还能从页面上读到孩子的名字与作品，就等于没撤回。判据只有一份：`resolveShareToken`。
  验证脚本因此有一条「撤回后页面 HTML 里不出现学员名 / 作品名 / 日期」。
- **正文与图都走分享白名单**：正文 = `archiveSharePayload()` 的产物（点评只有五维白名单维度）；
  图 = 那一份 payload 里的素材再逐条过 `archiveMediaView(entry, {surface:'parent'})` —— 只有 https
  持久地址能显示，`data:` 本地副本与 pending 一律「图片同步中」占位。
  **不要**改用 `archiveRecordMediaView(record, …)` 取图：它会把 `record.artworkUrl`（归档前地址）与
  `record.framedArtwork.imageUrl`（老师本机的写回副本）当兜底显示出来，而这两者按 US-208b 的口径
  **不进分享数据**（「分享里的每个素材地址都出现在 record.media 的地址集合里」是既有断言）。
- **四种状态同形状**（US-204 的纪律照旧）：`parentShareStateView(status, message)` 一次给全
  `{state, headline, note}`；「打不开」的细则仍只由 `SHARE_TOKEN_PARENT_MESSAGES` 给 ——
  本模块与组件里都 0 命中 `SHARE_TOKEN_REVOKED_PHRASE` 与「过了有效期」那句。
- **只读是结构性的**：这一页没有按钮 / 链接 / 输入框（断言 `querySelectorAll('button,a,input,select,textarea').length===0`），
  组件源码里也没有 `onClick` / `navigator.clipboard` / 下载动作；视图的 `actions` 恒为空数组、`readOnly` 恒真。
- **记录从哪来**：App 把 `archivedRecords`（云端读取 + 本机镜像去重后那一份）传进组件，视图按令牌上的
  `recordId`（次选 `recordKey`）找那一条。**换一台设备**打开时内容区给一句「还没有同步到这台设备」的占位
  （原型没有服务端分享接口，这是如实降级，不编内容）。
- **`data-parent-share-*` 的老读数一个都不能改名**（US-068 的浏览器脚本直接读它们）：根节点
  `-token / -state / -found / -active / -open-count / -first-opened-at / -first-open`，子元素
  `[data-parent-share-headline] / -note / -open-note / -student / -link`。
  新读数后缀一律避开控件选择器的名字（US-206 的坑）：根节点用 `-value`（`-student-value` /
  `-lesson-date-value`）与 `-count`（`-dimensions-count` / `-photos-count`），带 `="true"` 标记的
  `[data-parent-share-content] / -lesson / -artwork / -photos / -reviews / -dimension / -absence` 只在内容区出现。

#### 真踩的坑 / 验证要点（US-210）

- **要证明「图真的显示出来了」就得给它一个真图**：对象存储接入前归档素材是 `data:` 本地副本，
  家长端按 US-203 只认 https，真机上这一页只会是「图片同步中」占位。验证脚本的做法：把镜像里那条记录的
  `media` 换成 `https://cdn.us069.test/…`，再用 CDP `Fetch.enable({patterns:[{urlPattern:'https://cdn.us069.test/*'}]})`
  + `Fetch.fulfillRequest`（body = 真 PNG 的 base64）当对象存储的替身，断言 `img.naturalWidth > 0` ——
  「页面挂上了图」与「图真的解码出来了」是两件事。
- **`Fetch` 拦截要按 sessionId 过滤**：家长页在新标签打开，而 `cdp.mjs` 的事件监听是 browser 级的
  （`on(method, (params, sessionId) => …)`），不按 `eventSessionId` 过滤会拦到别的标签的请求；
  `urlPattern` 也要收紧到那个域名，别用 `*`。
- **同一条令牌在账上只能有一条记录**：`revokeShareTokenRecord` 产出的记录与原来的 `token` 是同一个字符串，
  夹具里若把「未撤回版」和「撤回版」一起塞进 `tokens`，`resolveShareToken` 取**第一条**会读到未撤回那版
  （本轮 data 断言真踩：撤回态断言全红）。写入侧的口径是 `replaceShareToken` 就地替换、`mergeShareTokens` 撤回优先。
- **DOM 读数的相邻元素之间没有分隔符**：`.parent-share-lesson` 里日期 / 作品名 / 班级是三个相邻元素，
  `textContent` 拼出来是 `2026.09.15《圆形变变变》周六创意绘画 2 班` —— 断言按部分 `includes`，
  别写「日期 · 班级」这种带分隔符的整句。
- **页脚那句「不含原图与内部记录」会让「页面不出现原图字样」这类朴素断言误报**：断言要排除页脚
  （`text.replace(foot, '')` 之后再判），否则把一句**如实声明**当成泄漏。

## 归档的权限 · 审计 · 保留期（[第四步 US-211] / F-ARCHIVE-PERM-01）

> 「老师只能归档与转发自己班级的学员记录；家长只能查看自己孩子的记录（服务端强制校验）；
> 授权撤回后已有分享链接一并失效；归档创建/更新、分享生成、家长打开、撤回、报告生成都要留痕；
> 管理端可按学员/老师/时间/状态查转发与授权审计；归档保留期可配、到期清理先预览影响范围。」
> 四份零依赖 data 模块 + 一份服务层 + 服务端一组接口：
> `data/archiveAccess.js`（访问规则）/ `data/archiveRetention.js`（保留期与清理）/
> `data/archiveAudit.js`（管理端查询）/ `data/auditLog.js`（动作登记表，9 个归档动作）+
> `services/archiveAccessApi.js`（服务端通道）+ `server/index.mjs`（`/api/archive/share-access`、
> `/api/archive/consents`、`/api/compliance/archive-policy`）。

- **访问规则只有一份，教师端 / 家长页 / 服务端读同一套口径**：`archiveRecordAccess({viewer, management,
  student, className, record, action})` → `{allowed, reason, deniedText, scope, scopeLabel, classTeacher,
  classFound, …}`（所有分支同形状）。判定顺序：认不出身份 → 拒绝；家长 → 拒绝（只能看分享链接）；
  管理员 → 全平台；老师 → 这个班的 `class.teacher` 必须命中本人身份串。**没有 `teacher` 字段的旧班级
  与「名单里没有的班」都按 US-403 口径算自己的班**（否则老数据会让老师一夜之间不能归档），
  但 `classFound / legacy` 如实报出来。
- **分享链接的访问判定叠三层**（`archiveShareAccessView`，被拦时 `contentVisible` 结构性为假）：
  **服务端结论 > 授权撤回 > 家长范围**。授权撤回读的是授权记录本身（`shareTokenConsentIssue`：
  只有明确 `revoked` 才算 —— `pending` / 没有记录不在这里拦，那是生成前闸门的事）。
- **授权撤回 = 两件事同一次动作**：`revokeConsent`（终态，幂等，保留第一次的 `revokedAt`）+
  `revokeShareTokensForStudent`（把这位孩子名下**仍可用**的令牌一起撤掉，已撤过的不动）。
  授权状态还会推到服务端（`saveRemoteArchiveConsents`），服务端据此也判链接失效 ——
  「前端隐藏不算数」这条才成立。
- **审计动作登记表只增不改**：`AUDIT_ACTIONS` 里 9 个归档动作 + `ARCHIVE_AUDIT_ACTIONS` 清单；
  新增的字段白名单是 `recordId / objectName / version / shareToken`，每条动作的必填清单在
  `AUDIT_ACTION_REQUIRED`（面板回执读 `auditEntryMissingFields` 标缺项）。
  **操作人四件套必须按当前角色分流**：`App` 的 `archiveAuditActor` 分 admin / parent / teacher 三种，
  家长撤回授权绝不能记成老师干的（本轮真踩：沿用 `traceAuditActor` 时家长动作记成了老师）。
- **保留期的锚点是 `archivedAt`**（不是课次日期）；清理的预览与执行读**同一支纯函数**
  （`archiveCleanupPreview` / `applyArchiveRetentionCleanup`），所以不会「预览 3 条、执行删 5 条」。
  预览与执行都会把**素材张数**算进影响范围 —— 数素材时注意：记录上 `media` 是**扁平素材数组**
  （`normalizeArchiveMediaList` 的产物，每项带 `kind`），不是 `{artwork, photos}` 分组；
  分组写法只在老夹具里出现过（实现里两种都容忍）。

### 真踩的坑 / 验证要点（US-211）

- **`pnpm run build` 全绿也可能白屏**：新面板里用到一个忘了 import 的纯函数（`archiveRetentionSummary`）
  时，构建不报错、进页面直接 `ReferenceError` → 整个 `.content` 空掉。验证脚本必须**真的进这个页面**
  并把「页面异常」打出来（`Runtime.exceptionThrown`），别只看 build。
- **React 会按 fiber props 抑制禁用按钮上的 click**：`el.disabled=false; el.click()` 与 CDP 真实鼠标事件
  都进不去（连 `dispatchEvent(new MouseEvent('click'))` 也一样）。要验「拦截在 handler 里、不是只靠置灰」，
  取 fiber 上的 `onClick` 直接调一次：
  `const key=Object.keys(el).find(k=>k.startsWith('__reactProps')); el[key].onClick({preventDefault(){},stopPropagation(){}})`。
- **浏览器脚本里的每个标签页各拦一次云表**：`Network.setBlockedURLs` 是按 session 生效的。只拦主标签时，
  家长分享页那个新标签会从**云端**读回一批记录，再经 `persistFeedbackRecords` 写进同一份 localStorage ——
  后面的管理端读数会凭空多出几十条（本轮真踩：读到 33 条 + 归档被当成「更新第 2 版」）。
- **中途重进流程要处理草稿**：US-409 的草稿会把 `step` 恢复回去，`openFlow` 后页面可能停在第三步；
  要么清掉 `xinlehui-feedback-draft-v2` 再 `Page.reload`（会话状态在内存里，要重新登录），
  要么点顶部流程导航的「创建信息」回第一步再「新建草稿」。侧边栏再点一次「课后反馈」**不会**重置组件。
- **服务端夹具要复位**：`POST /api/archive/share-access` 读的是服务端自己存的授权状态
  （`server/data/archive-consents.json`，gitignored），上一轮跑脚本推上去的「已撤回」会让下一轮的
  分享页在**服务端**就被拦下。脚本开头先 `PUT /api/archive/consents` 复位、结尾再还原管理档案。
- **对象存储 / 素材地址不参与这件事**：访问判定只看身份与授权，不看素材是否能显示；
  链接能不能打开与图有没有同步是两件事（家长端仍是「图片同步中」占位）。

## 成长档案页的对象筛选（[第四步 US-205]）

> `GrowthArchiveData.jsx` 只负责渲染；可选项 / 默认选中 / 过滤 / 空态四件事全在
> `src/data/archiveTargets.js`（零依赖纯函数，可 `node` 直跑断言）。

- **`record.student === '陈一诺'` 那类写死过滤已清零**（连同写死的班级名）：对象一律来自
  `archiveTargetLists({students,classes,records})` = 学员管理名单 ∪ 记录里出现过的名字
  （名单被改过的历史记录仍然选得到）+ `resolveArchiveTargetValue(options, preferred)`（偏好 → 第一位）。
- **「未选择」不是「全部」**：`filterArchiveRecords` 在选中值为空时返回**空列表**（界面给空态）。
  串档的历史成因就是把「未选择对象」当成通配；个人按 `record.student`、班级按 `record.className`，日期升序。
- **切换对象只过滤、不重置**：`switchTarget` 只 `setTarget`，学员 / 班级切换只改选中值 ——
  **周期（`period`）与缺课筛选（`absenceFilter`）都不重置**，时间线当场跟着换（US-205 第 4 条）。
- **没有匹配记录时**渲染空态面板（US-206 起统一走 `data-archive-state-panel="empty"`，见下一节），
  入口仍是 `archiveEmptyView` 的「去创建课后反馈」→ `navigate('create')`（沿用缺课文案的温柔语气）。
- **路由参数**：`navigate(page, params)` 支持第二段（`pageParams` 随 `PageRouter` 摊给所有页面；不带参数的
  `navigate` 一律清空）。第四步「进入成长档案」与更新回执的「查看档案」都传 `{student, className}`，
  档案页因此在**进入时就默认选中刚归档的那位学员 / 那个班级**。新加页面级参数时记得同时接进 `App` 的
  `pageParams`（hook 必须放在登录页提前 `return` **之前**，US-202 的老坑）。
- 验证口径：档案页读数挂在 `data-archive-filter` / `data-archive-filter-name` / `data-archive-record-count`
  （= 对象筛选后的**总条数**，与周期无关 —— 老断言读它）上，浏览器断言用**页面内 `archiveTargets.js` /
  `archiveResident.js`** 独立重算并与 DOM 逐值比对（`assert-us062-browser.mjs`）。真机入口只有会话内的两条
  （第四步「进入成长档案」/ 更新回执「查看档案」）—— 想直接在档案页上做断言，必须在同一条会话里先归档一次。

## 成长档案的常驻视图（[第四步 US-206] / FR-206）

> 「进档案页先做一道生成选择题」被收掉了：**没有生成步骤**。概况 + 时间线在组件 body 里无条件算出来，
> 四态（加载 / 就绪 / 空 / 错误）由数据源状态决定。规则在 `src/data/archiveResident.js`
> （零依赖纯函数，可 `node` 直跑断言），组件只渲染它的产物。

- **默认档是「全部」不是「本学期」**：`ARCHIVE_PERIOD_FILTERS = ['全部','半学期','一学期','一年度']`
  （`ARCHIVE_PERIODS` 仍是三个真实周期，US-207 报告还要用）。理由：默认窗口非空会把上一年度的记录
  悄悄藏掉，与「进页面立即看到内容」冲突；`filterArchiveRecordsByPeriod(records, period, today)` 的
  窗口是「最近 N 天的**下界**」（半学期 90 / 一学期 180 / 一年度 365），**没有上界**（补录的未来课次不藏），
  **没有日期的记录留在窗口里**（读不出日期就不敢说它过期）。`today` 可注入 —— 断言与界面读同一份。
- **概况四项 = `ARCHIVE_OVERVIEW_FIELDS` 的产物**：`archiveResidentSummary(entries)` 数
  「已归档课次 / 作品（有成品图的那几节）/ 课堂照片（真的看得见的张数，占位不算）/ 最近归档时间」，
  读的是**当前筛选后**的那批课次（换筛选，概况跟着变）。四项都带 `data-archive-overview-field`。
- **一节课一张卡 = `archiveLessonEntry(record)`**：成品作品图（`media` 里的 `artwork` 持久地址优先 →
  `artworkUrl` → `framedArtwork.imageUrl`，走 `data/archiveMedia.js` 的 `archiveRecordMediaView`）、
  课堂照片列表（media photo 条目 → `photoUrl`）、五维摘要（**只列写了正文的维度**，不补空维度、
  不编示例文案）、缺课记录（保留那页温柔的话）。读数挂在卡片的
  `data-archive-lesson` / `-id` / `-date` / `-status` / `-dimensions` / `-photos` 上。
- **四态同形状**：`archiveResidentStateView({phase, view})` 对四种状态返回**同一组字段**
  （`title/desc/hint/action/retry/reset/create`）。少给一个字段就会在渲染期炸成白屏（US-204 的纪律）。
  三种动作各有 flag：`retry`（重新读取）/ `reset`（还原筛选）/ `create`（去创建课后反馈）。
- **两套「空」要分开**：一条记录都没有 → `archiveEmptyView`（US-205 的老文案 + 去创建）；
  **被筛选筛空** → `ARCHIVE_FILTERED_EMPTY_TITLE` + 点名是哪个筛选挡住了 + 「查看全部记录」还原动作。
  被筛掉的条数由视图如实报出（`hiddenByPeriod` / `hiddenByAbsence`，挂在 `data-archive-hidden-by-*` 上）。
- **数据源状态在 `main.jsx`**：`recordsSource = {phase:'loading'|'ready'|'failed'}` + `reloadRecords`
  经 `PageRouter` 的 props 传给档案页（`recordsRemoteReady` 由 `phase==='ready'` 派生，语义与原来一致）。
  读失败时**不静默**：错误态面板 + 「重新加载」，并且**本机镜像的记录照常展示**（`data-archive-local-note`
  明示来源 —— FR-142 的口径：明示，不静默降级）。加载态只有一个面板，不渲染时间线。
- **验证口径**：`assert-us063.mjs`（data 层 87 项）+ `assert-us063-browser.mjs`（浏览器 62 项，含
  用 CDP `Network.setBlockedURLs` **真造一次读失败** → 错误态 → 解开网络 + 4 秒延迟点「重新加载」→
  加载态 → 就绪）。踩过的坑：**根节点属性不能与筛选控件的选择器同名** —— 档案页根节点原来挂了
  `data-archive-period`，与下拉的 `data-archive-period="true"` 撞名，`document.querySelector`
  取到的是 `<section>`，脚本里的 `setValue` 把 select 的 value setter 用到 section 上 →
  `TypeError: Illegal invocation`（现改名 `data-archive-period-value`）。
  同理 `data-archive-lesson-dimensions` 这类读数要挂在**卡片根节点**上，别挂内层元素，否则断言读不到。

## 阶段报告（archive_reports）的实体与落库（[第四步 US-207a] / FR-235 ~ FR-238）

> 老师按学期做一份给家长看的阶段报告，**下次打开还想看到它**。规则全在 `src/data/archiveReports.js`
> （零依赖纯函数，可 `node` 直跑断言），云端行映射在 `src/services/archiveReportsApi.js`，
> 档案页只渲染它的产物（`ArchiveReportPanel`，`GrowthArchiveData.jsx`）。

- **报告键 `reportKey` = 对象（`student::` / `class::` 前缀）+ 周期 + 类型**，只由 `archiveReportKey()` 拼一次
  （界面不许再拼一遍 —— 两处各拼一次就会「提示说更新了、实际新建了一份」，与 US-201 的 `recordKey` 同一条纪律）。
  空对象名 → 空键 → 生成按钮禁用。对象名相同、一个是学员一个是班级时靠前缀区分，不会撞键。
- **周期只认三个真实周期**（半学期 / 一学期 / 一年度，`resolveArchiveReportPeriod`）：报告**没有「全部」这一档**
  —— 它必须是一个可命名的阶段（档案页的**筛选器**才有「全部」，两者不是一件事）。
  类型的三个词（成长集锦 / 作品集 / 成长记录）由 `ARCHIVE_REPORT_TYPES` 提供。
- **快照是冻结的**：`buildArchiveReportSnapshot()` 用 `archiveTargetView` + `filterArchiveRecordsByPeriod`
  聚合出「关联课次 / 作品数 / 照片数 / 缺课数 + 每节课的日期、作品名、点评维度原文」，**只留文本、
  不带素材地址**（素材不进数据模型）。历史版本回看读的是**那一版的快照**，不是拿今天的记录重算。
- **版本与历史**：`updateArchiveReport()` 让 `version` 自增，被替换的那一版整份进 `history`（最新在前，
  上限 `ARCHIVE_REPORT_VERSION_LIMIT = 6`）；`reportKey` / `id` 全程不变。更新必须传**同一个键**的快照
  —— 键的身份只由 `current` 决定（界面天然一致：快照就是按当前选中的周期 / 类型聚合的）。
- **落库状态是两层的读数**（`ARCHIVE_REPORT_STATUSES`）：`local`（已生成 · 仅本机镜像）/
  `synced`（已生成 · 已同步云端）。写入口径与全站一致：**先落本机镜像，再推云端**；推失败只改这句话、
  不假称成功、也不阻断生成。`archiveReportToRow()` 写云端时把行标成 `synced`（**行存在 = 这一版在云端**，
  写失败不会留下行）；`mergeArchiveReports` 只在两边**版本号一致**时把状态读成 `synced`，
  本机版本更新时保持原状态（否则「已同步」会被下一次读盘悄悄降级成假消息）。
- **本机镜像键 `xinlehui-archive-reports-v1`**（与归档记录 `xinlehui-feedback-records-v1` 是两套数据 ——
  这就是「删除报告不影响归档记录」的结构保证）。写不下时 `slimArchiveReportsForStorage` 先降级
  （历史版本只留「哪一版 / 什么时候 / 多少节课」、当前快照的课次明细截到 40 条）再写第二次。
- **再次进入直接展示**：`archiveReportDefaultSelection({reports,target,name})` 挑这位对象**最近生成**的那一份，
  把它的周期与类型回填给下拉 —— 档案页用一个 `appliedReportTargetRef` 只在**换了对象**时回填一次
  （老师自己切过周期 / 类型之后不许被拽回去，与 US-205 的 `appliedPreferenceRef` 同一条纪律）。
- **「更新报告」要有理由**：`archiveReportStale(report, records)` 比记录上的 `updatedAt` / `archivedAt` 与
  报告的 `generatedAt`，有更新时界面明示「归档里有比这份报告更新的内容」。判据只看时间戳，
  推不出时间的一律不算「更新了」。
- **界面钩子**（断言读这些，别读文案）：`data-archive-report-section`（区块，带 key / period / type /
  exists / stale / busy）、`data-archive-report-period-field` / `-type-field`、`data-archive-report-generate`
  （同一个按钮，`data-archive-report-action` = `create` / `update`）、`data-archive-report-annotation`
  （验收点名的「生成于 X 月 X 日 · 共 N 节课」）、`data-archive-report-fact=<id>`（四项概况）、
  `data-archive-report-history-entry=<version>` + `-history-view` / `-history-back`、`-delete` /
  `-delete-confirm` / `-delete-cancel`、`-local-note`。
- **已知边界 / 踩过的坑**：
  - 云端 `archive_reports` 表**还没建**（与 `audit_logs` 同一处境）：真机上报告只落本机镜像，
    状态如实显示「仅本机镜像」。验「已同步」那一路要**在页内打桩 `cloud.database.from`**
    （只拦 `archive_reports`、其余走原函数），断言写出的行是 snake_case 九列 + `payload`。
  - 档案页老师端的真机入口**只有流程内的那两条**（第四步「进入成长档案」/ 更新回执「查看档案」）——
    侧边栏没有「成长档案」项。浏览器断言必须在同一条会话里先归档一次；想验「重新进入」，
    就把流程再走一遍（`Page.reload` 后同理），别去找别的入口。
  - `data-archive-report-period` 挂在区块上、筛选器的周期是 `data-archive-period="true"`
    —— 别让根节点属性与控件选择器同名（US-206 的 `Illegal invocation` 老坑）。
  - 四项概况的 DOM 读数里 `label` 与 `value` 是连着的（`<span>` + `<b>` 无空格）：
    断言标签要读 `span` 的文本，不要对整块 `textContent` 用 `split(' ')`；历史行的文本里还带着
    「查看这一版」按钮的文案，断言注解要读行内的 `span`。

## 报告正文：雷达维度 / 点评原文 / 阶段总结（[第四步 US-207b] / FR-239、FR-240、FR-242）

> 报告里的**每一句话、每一个数字**都必须由归档数据聚合得出（FR-239 禁止写死的示例文案）。
> 三块正文都收在 `src/data/archiveReports.js`（零依赖纯函数），档案页只渲染它们的产物
> （`ReportDigest` / `ReportRadar` / `ReportReviewTexts`，`GrowthArchiveData.jsx`）。

- **三块产物 + 唯一真源**：`archiveReportDimensionAggregate(snapshot)` 逐维聚合（雷达轴与点评原文**共用
  这一份**，两处不许各数一遍）→ `archiveReportRadarView` / `archiveReportReviewView` / `archiveReportDigestView`。
  `archiveReportSnapshotView` 一次给全 `radar / review / digest`，`archiveReportView` 与**历史版本行**都转发同一组
  字段（历史版本回看读的是**那一版快照**的聚合结果，不是拿今天的记录重算 —— 这正是「快照」要防的事）。
- **雷达分值 = 覆盖度，不是能力打分**：五条轴取 `REVIEW_DIMENSION_NAMES`（与第三步同一份），
  `value = covered / total`（百分数）；`total` = 本阶段**有点评机会的课次**（缺课记录按档案口径没有五维、
  只有那句温柔的话，**不进分母** —— 否则缺一次课就会把每个维度都拉低）。编不出分就不编：
  没有任何原文的维度 `value = 0`、`insufficient = true`、`note = ARCHIVE_REPORT_INSUFFICIENT_TEXT`。
- **数据不足必须明说**（FR-240）：`ARCHIVE_REPORT_INSUFFICIENT_TEXT = '本阶段数据不足'` 是**唯一真源**
  （界面里连这个字符串都不许再写一遍，断言直接查界面源码里没有它）；雷达/点评原文/阶段总结三块都走同一句。
- **雷达几何在 data 层算**：`ARCHIVE_REPORT_RADAR_GEOMETRY`（viewBox 240 / 半径 88 / 四圈网格）+
  `grid / spokes / polygon / dots` 全部是 data 层的产物（界面里没有 `Math.cos` / `Math.sin`）——
  几何可以直接用 Node 断言（圆心、覆盖 100% 落在半径上、覆盖 50% 落在半径一半、数据不足时退化到圆心）。
- **点评原文**：逐维列出归档记录里的**原文 + 课次日期 + 作品名**（每维上限
  `ARCHIVE_REPORT_REVIEW_TEXT_LIMIT = 3`，最新课次在前）；缺课记录的 `reviews.summary` **不算**点评原文。
- **界面钩子**（断言读这些）：`data-archive-report-digest`（`-line` / `-insufficient` / `-covered`）、
  `data-archive-report-radar`（`-covered` / `-insufficient` / `-radar-svg` / `-radar-polygon` /
  `-radar-insufficient-note`）、`data-archive-report-radar-axis=<维度名>`（`-value` / `-axis-covered` /
  `-axis-insufficient` / `-axis-note`）、`data-archive-report-review`（`-covered` / `-insufficient` / `-texts`）、
  `data-archive-report-review-dimension=<维度名>`（`-count` / `-insufficient` / `-note`）、
  `-review-text`（`-text-date`）、`-review-empty`。
- **写死的示例报告正文已经删掉**：`main.jsx` 里的 `ArchiveStudio`（US-207b 删除）曾带着
  「美术能力 / 本学期进步点 / 下学期学习规划 / 老师寄语」那段示例文案与写死的「陈一诺 · 7岁 /
  已记录 18 次课程」—— 那是 PRD 点名的「写死的示例文案」。断言姿势：`stripComments` 后在
  `main.jsx` 里搜那几个句子（0 命中）。
- **验证口径**：DOM 读数必须等于**页面内 import 真实 data 模块**的独立重算（
  `buildArchiveReportSnapshot` + 三个 view 函数），而不是等于脚本里手抄的期望值；
  期望值只在「纯夹具、无流程归档」的用例里硬编码（例如 2 节课 + 1 节缺课的覆盖度 = 100/100/50/50/50）。

## 档案的移动端与性能：本地优先归档 + 分页窗口 + 缩略图（[第四步 US-212]）

| 关注点 | 位置 | 说明 |
|---|---|---|
| 规则（预算 / 分页窗口 / 四项结论 / 44px） | `src/data/archivePerformance.js`（零依赖，Node 可直跑） | 首屏 1000ms（50 条以内）、`ARCHIVE_TIMELINE_PAGE_SIZE`（20）、`ARCHIVE_SCROLL_MIN_FPS`（30）、`ARCHIVE_THUMB_MAX_EDGE`（320，与录入页共用 `THUMBNAIL_MAX_EDGE`）、`ARCHIVE_TAP_MIN`（= `TAP_TARGET_MIN`） |
| 同步状态机（明示同步状态） | `src/data/archiveMedia.js` 的 `archiveSyncView()` / `ARCHIVE_SYNC_PHASES` | `none / local / syncing / partial / synced` 五态，文案含「已先在本机归档」与「重试同步」的出路 |
| 浏览器侧执行 | `src/services/archivePerformance.js` + `src/services/archiveMediaApi.js` | 缩略图队列（串行 + `requestIdleCallback`）、滚动 rAF 采帧、首屏计时；`prepareLocalArchiveMedia` / `startArchiveMediaBackgroundSync` |
| 界面读数 | `main.jsx` 第四步 `archiveMediaSyncField`（`data-archive-sync-*`）、`GrowthArchiveData.jsx`（`data-archive-perf-row` / `data-archive-page-*` / `data-archive-thumb-state`） | 结论只在 data 层算，界面只渲染 |

- **弱网下归档必须「本地优先」**：归档只等 `prepareLocalArchiveMedia`（本地持久副本 + 素材记录，**一个网络
  请求都不发**），记录与副本先落库、`go(4)` 立刻完成；上传交给 `startArchiveMediaBackgroundSync` 在后台逐条
  继续（每完成一条 `setRecords` 就地更新那一条）。**别把上传 await 到归档前面** —— 弱网下那会让老师以为归档坏了
  （US-203 的 `prepareArchiveMedia` 仍保留给「一次性同步完」的调用方，归档动作已不再用它）。
  后台队列的 `remaining` 要按「还差哪几条没成功」算（`archiveMediaCanSync` 过滤后的条数），
  否则上传失败也会收在 `synced`（本轮真踩：断言当场抓到「失败却报全部同步」）。
- **两段式的图片 `src` 是「提供缩略图」的必要条件**：`<img>` 不能先挂原图 —— 浏览器的图片懒加载会在
  它自己那段距离（实测远大于 `rootMargin`）内把原图**整张解码**掉，缩略图就白生成了。正确做法：
  未就绪时挂 1×1 占位（`ARCHIVE_THUMB_PLACEHOLDER`），缩略图就绪后换成小图，外链 https（画布会被标脏、
  `toDataURL` 抛错）才退回原图懒加载（读数记 `direct`）。
- **`display:contents` 的包装元素不能被 IntersectionObserver 观察**：它没有盒子，永远不报 `isIntersecting`
  （本轮真踩：所有卡片停在 `lazy`、缩略图一张都没生成，而 `pnpm run build` 全绿）。观察对象要是 `<img>`
  自己；包装 `span` 只为布局中性（`display:contents`）与挂读数。
- **回调要 `useCallback`**，否则卡片的 `IntersectionObserver` 会随每次渲染重建（60 张图 = 60 个 observer 反复建销）。
- **超过 20 条只渲染窗口内的卡**：`archiveTimelineWindow({count,page})` 给 `{mode:'full'|'paged', visible, hidden,
  moreLabel, prevLabel}`，界面渲染 `archiveWindowEntries(view.entries, window)`；「加载更多」是往后长（时间线按日期
  升序，「回到最开始」用 `prevLabel`），**不要**改成跳页。`data-archive-timeline-count` 仍是筛选后的总条数
  （老断言读它），DOM 里的卡数是新的 `data-archive-rendered-count`。
- **首屏计时 = 数据就绪 → 提交后第一帧**（`dataAt` 在 `showTimeline && view.count > 0` 那一刻落，`paintAt` 在
  `nextFrame()` 里落，只记一次）；整块读数挂在 `data-archive-perf` / `data-archive-perf-row="<id>"`，
  `ok === null` 是「还没测到」（不要当达标）。滚动帧率用**真实滚动**（`window` 的 scroll 事件 + rAF 采帧，
  停下 400ms 收束），样本 < 4 帧不给结论。
- **验证夹具必须在 App 挂载之前进 localStorage**：`records` 是 `useState(loadFeedbackRecords)` 只在首屏读一次，
  挂载后再写会被 App 的 persist 效果原样盖掉（本轮真踩：时间线只剩 4 条 demo 记录，看着像分页坏了）。
  脚本的正确姿势：写入夹具 → `Page.reload()` → 重新登录 → 走流程。
- **挂住上传请求**是验「本地优先」的正解：CDP `Fetch.enable` + `Fetch.requestPaused` 里先**不回**（`hold`），
  归档照常在 <3 秒内完成（旧实现要等每张 8 秒超时）；再切成 `fail` 收在 `partial`，最后替身成
  `{storage:'private-object-storage', url:'https://…', storageKey}`（POST 与 OPTIONS 都要自己 fulfill，
  记得带 CORS 头）点「重试同步」→ `synced`。
- **验证方式（本故事实测）**：`pnpm run build`；Node 直跑 data + services **132 项**（分页窗口 / 四项结论 /
  同步五态 / 本地优先准备不发请求 / 后台队列的成功・失败・非持久落点・取消 / 无 DOM 降级）；
  浏览器 **80 项**（弱网挂起下 3 秒内归档 + 状态如实 + 恢复后重试到 synced；390px 第四步可点区域 ≥44×44、
  摘要单列、主操作栏贴底；51 条记录首屏 1ms、DOM 只放 20 张卡、懒加载出 320px 缩略图、加载更多到 40 张、
  真实滚动 119fps、390px 档案页控件 ≥44px、console 0 异常）；回归 US-059 46、US-060 79、US-061 98、
  US-063 62、US-064 73、US-069 86、US-070 147 全绿；截图 354~359 留档。

## 视频任务（`video_jobs`）的本机 mock 队列与状态机（[第四步 US-213a] / FR-256 ~ FR-261）

「渲染服务还没接进来，但前端不能空等」的落地：任务模型、状态机、幂等键、演示推进与全部文案收在
**零依赖数据层**，落地与定时推演在服务层，界面只渲染视图产物。

| 关注点 | 位置 | 说明 |
|---|---|---|
| 规则（状态机 / 字段 / 幂等键 / 演示推进 / 文案） | `src/data/videoJobs.js`（零依赖，Node 可直跑） | `VIDEO_JOB_STATUSES`、`VIDEO_JOB_TRANSITIONS`、`VIDEO_JOB_REQUIRED_FIELDS`、`videoJobKey()`、`videoJobAdvance()`、`videoJobView()`、`videoJobQueueView()` |
| 落地 + 推演 + 订阅 | `src/services/videoJobQueue.js` | 内存一份 `jobs` + 本机镜像 `xinlehui-video-jobs-v1`；`submit / cancel / retry / advance / resume / subscribe`；400ms 定时器只在有进行中任务时起 |
| 界面 | `GrowthArchiveData.jsx` 的 `VideoJobsPanel` / `VideoJobCard`（`data-video-jobs-*` / `data-video-job-*`） | 类型跟着「查看对象」走（个人档案 = 个人成长视频 / 班级档案 = 班级视频集锦）；面板与**每一张任务卡片**都标注「演示数据 · 视频服务未接入」 |

- **状态机只有一份表**：`VIDEO_JOB_TRANSITIONS` = `queued → rendering → done | failed | canceled`，
  再加 `failed / canceled → queued`（重试）。判据一律 `videoJobTransitionIssue(from,to)`，
  界面给不给按钮读 `videoJobActions()`（`allowed` + `issue` 同形状），服务层改状态前也过它 ——
  不许在组件里写 `if (status === 'queued')`。
- **幂等键由业务字段派生、行 id 不是**：`videoJobKey({type,studentId,classId,period})` =
  `video|type|studentId|-|period`（个人任务 `classId` 留空、班级任务 `studentId` 留空，由 `objectFields` 统一清）。
  同一 jobKey 再提交**不产生第二条任务**：`dedupeVideoJobs` 在读盘 / 写入两处兜底，服务层命中已有任务
  只返回 `{created:false}`（进行中 / 已完成原样返回，失败 / 已取消沿用它重排队、attempts 不清零）。
- **任务必填十项 + 类型相关的对象字段**：`videoJobMissingFields()` 里 `studentId / classId` 要**按类型判**
  （个人任务 `classId` 合法为空，反之亦然）—— 写成「两个都不能为空」会让个人任务永远报缺 `classId`（本轮真踩）。
- **演示队列结构上带不了成片**：`normalizeVideoJob` 把 `outputUrl / durationSec / bytes` 一律清成 `''/0/0`，
  `videoJobOutputIssue()` 是这条口径的判据。进度可以走到 100（`done`），但卡片必须写清「未产出成片」——
  「已完成」不等于「有视频」（US-213b 的契约层要在这个基础上抛「视频服务暂不可用」）。
- **进度按真实经过时间推，不按定时器攒数**：`videoJobAdvance(job,{now})` 用 `startedAt` + 模拟耗时
  （个人 8 秒 / 班级 14 秒）算百分比，因此刷新 / 关页面那段真实时间也算数；定时器只是让读数动起来，
  **没有进行中的任务就停表**（`startVideoJobQueue` 幂等、`resumeVideoJobQueue` 进页面接上）。
  硬超时仍是个人 5 分钟 / 班级 15 分钟（演示推进远快于它，但判据（`VIDEO_JOB_TIMEOUT_MS`）是真的）。
- **并发默认 2**：`advanceVideoJobQueue` 每次先按 `createdAt` 提升排队任务（提升那一刻 `attempts+1`、
  记 `startedAt`），再算进度，最后重排队列位次；取消会让排队的下一条**立刻补位**（取消后要顺手推一次）。
- **验证方式（本故事实测）**：`pnpm run build`；Node 直跑 37 项（`/tmp/assert-us072-data.mjs`，用内存 localStorage
  替身验镜像写入与读回）；浏览器 **83 项**（`/tmp/assert-us072-browser.mjs`：真实流程走到档案页 → 面板空态 →
  真点提交 → 进度自己动 → 幂等不重复 → 100% 但无成片 → 演示失败 45% 处 failed + 重试 attempts=2 →
  班级三个周期连提 = 2 渲染 + 1 排队（队列第 1 位）→ 390px ≥44px → **整页重载 + 重新登录 + 再走一遍流程**
  后任务仍在且继续跑完，`startedAt` 逐条不变、进度不倒退、没有重复）；回归 US-063 62、US-064 73、US-071 80 全绿；
  截图 360~363 留档。

### 验「刷新后继续推进」时的两个坑（本故事真踩）

- **别把「重进页面后任务都收在终态」当成一次断言**：第二次走流程只要几秒（实测 6.9 秒），
  而班级演示耗时 14 秒 —— 断言「都 done」会因为「时间还没到」而假红。正确判据是三条不依赖时序的：
  ① 任务**没有被重启**（镜像里的 `startedAt` 与刷新前逐字符相同）；② 进度不倒退；
  ③ 等它收在终态（`waitForCondition` + 60 秒超时）——第 ③ 条才是「刷新后继续跑完」。
- **`data-video-*` 读数要挂在卡片根节点上**：只挂内层 `<p>` 时，`card.getAttribute('data-video-job-demo')`
  读到 `null`（本轮假红一次）。`.video-jobs-controls` 里的 `select` 在窄屏要显式给 `min-height:44px` ——
  全局样式下它只有 18px（面板自己的 `label` 有 44px，不代表里面的控件有）。
- **CDP 脚本里带变量的选择器别用单引号**：`'[data-video-job-key="…${STUDENT}…"]'` 不会插值，
  报错是「找不到可点击元素」（本轮假红一次）；用模板字符串。

## 视频渲染服务的**契约层**（[第四步 US-213b] / FR-254 ~ FR-263）

US-213a 那份本机演示队列（上面一节）**不是**真服务：真服务的接口契约单独收在
`src/data/videoJobs.js` 的第 ⑥ 节（零依赖规则）+ `src/services/videoApi.js`（只有网络动作）。

- **四个契约函数**：`submitJob` / `getJob` / `cancelJob` / `retryJob`（`services/videoApi.js`）。
  它们与服务端未接入的关系是**抛错**：`VideoServiceError` + `unavailable:true` + 消息以
  「视频服务暂不可用」开头（`VIDEO_JOB_SERVICE_UNAVAILABLE_TEXT`，**那句话只能有一份**）。
  界面用 `isVideoServiceUnavailable(error)` 分流：可用走真服务、不可用如实告知并把演示队列标注成演示。
  **契约层不许有 mock 分支**（不许 import `services/videoJobQueue.js`、不许碰 localStorage）——
  这条纪律有断言兜着（查 `import` 行），因为它一旦破口就会出现「老师以为在出片，其实是演示」。
- **四个函数必须抛错，只有 `probeVideoService` 不抛**（巡检口径，与 `probeChildMediaSink` 一致）：
  探测给界面一个真实读数 `{ok,status,reachable,service,queue,message,checkedAt}`；
  面板上的读数是 `GrowthArchiveData.jsx` 的 `[data-video-service-state]` / `[data-video-service-text]`
  （挂载探测一次 + 「重新探测」按钮）。
- **HTTP 状态只有一个含义**（`videoServiceStatusVerdict`）：`200/201/202` = 任务；
  `404/405/501`（路由没接）与 `502/503/504`（不可达）与 `0`（连不上）= 「视频服务暂不可用」；
  其余（400/403/409/500）= 服务在但拒绝了这次请求，用它的可读原因。
  因此**「没有这条任务」必须用 `200 + {job: null}` 表达**（`getJob` 返回 `null`），
  404 只能解释成路由不存在 —— 别把 job-not-found 写成 404，那会和「未接入」撞在一起。
- **成片三件套按状态分叉**（`videoJobRemoteOutputIssue`，本故事第 3 条验收的落地）：
  `done` 必须有 **http(s) 的 `outputUrl` + `durationSec>0` + `bytes>0`**，缺一项就是契约不成立；
  其余状态必须三项全空。响应先过 `videoJobContractIssue`（必填字段 / 状态枚举 / 进度 0~100 整数）再过
  `normalizeRemoteVideoJob`（**只保留**服务端给的真实成片，`done` 之外一律清空）——
  「不得返回假成片、假时长、假封面」因此是结构性的：封面 / 缩略图 / 海报类键名
  （`VIDEO_JOB_CONTRACT_IGNORED_FIELDS`）根本不在字段白名单里，界面拿不到就不可能显示。
- **提交体只带指向信息**：`{jobKey, type, studentId, classId, period, specSnapshot, createdBy}`，
  `jobKey` 由客户端 `videoJobKey()` 派生后随请求发出（服务端按它幂等），`specSnapshot` 复用
  `videoJobSpecSnapshot()`（对象 / 周期 / 课次·作品·照片计数）—— **不发任何儿童素材**（FR-46 同口径）。
  响应里的 `jobKey` 与提交的不一致要抛错（幂等键串档比慢更糟）。
- **可注入 `fetchImpl`**：四个函数与 `probeVideoService` 都接受 `{baseUrl,timeoutMs,fetchImpl}`，
  所以 Node 断言不用真服务（`/tmp/assert-us073-data.mjs` 46 项，覆盖 404 / 连不上 / 超时 / 500 /
  谎称 done / 幂等键不符 / 封面字段被丢 / 路由表与路径编码）。路由表 `VIDEO_JOB_SERVICE_ROUTES`
  在 data 层（契约的一部分），`videoJobServicePath('job', key)` 负责百分号编码。
- **验证脚本的坑**：`await (async()=>{ … })();` 少了末尾的 `()`（写成 `});`）**不报错、也不执行**——
  断言块会静默变成空操作（本轮真踩：46 项只跑了 42 项，靠打印条数与源码条数对不上才发现）。
  写完验证脚本先对一下「打印出来的条数 == 源码里的 `ok(` + `throwsAsync(` 条数」。

## 老师端视频任务卡：入口 / 预估剩余时间 / 按 jobKey 恢复（[第四步 US-214]）

上面两节（US-213a 演示队列 + US-213b 契约层）之后，老师端看到的是**一条任务卡**：
入口在档案页「成长记录（视频）」区块里，提交后立刻进卡片，可以离开页面再回来接着看。

- **入口与文案全在数据层**：`VIDEO_JOB_SECTION_TITLE`（`成长记录（视频）`）、`VIDEO_JOB_SECTION_DESC`、
  `VIDEO_JOB_SUBMIT_LABEL`（`生成成长记录视频`，验收原文）、`VIDEO_JOB_SUBMIT_NOTE`。
  组件里不许再写一遍这些句子（验收点名的句子只能有一份）。
- **「预估剩余时间」与「成片时长」是两个概念**（US-214 第 5 条）：`videoJobEtaView(job,{now})` 五种状态
  返回同形状 `{status,known,ms,label,note}` —— `rendering` → `约 N 秒`（`known:true`）、
  `queued` → `轮到后约 N 秒`（`known:false`，**那不是「还要等 N 秒」**）、终态 → `已结束`。
  `note` 里必写「不是成片时长」：视频服务接入前成片三件套一律为空，两个时间不许被看成一个。
  剩余时间 = `videoJobRemainingMs`（`startedAt` + 模拟耗时 − 真实经过时间），离开页面那段也算数。
- **「离开页面 → 按 jobKey 恢复」的判定**：`videoJobResumed(job, resumedAt)`，`resumedAt` = 面板**挂载**时刻
  （组件里的 `sessionStartRef`），判据是「状态还在 `queued/rendering` 且 `createdAt` 早于本次进入
  `VIDEO_JOB_RESUME_TOLERANCE_MS`（1 秒）以上」。`videoJobQueueView(list,{resumedAt})` 汇总出
  `resumedCount` / `resumeSummary`，卡片上是 `data-video-job-resumed` + `VIDEO_JOB_RESUME_NOTE`。
  卡片还渲染「任务键」那一行（`job.jobKey`）—— 让「按 jobKey 恢复」在界面上看得见。
- **演示失败原因四类**（US-214 第 4 条）：`VIDEO_JOB_SIMULATE_ERROR_OPTIONS`（模型 / 字体 / 素材 / 存储，
  文案取自 `VIDEO_JOB_ERROR_CODES`），落到任务的 `simulateErrorCode` 字段（默认 `asset`，`timeout` 不在可选里：
  它由硬超时判出来）。`videoJobAdvance` 失败时按它取文案；服务层**重新排队分支**要接受本次提交的
  `simulate / simulateErrorCode`（否则界面换了原因再提交不生效）。
- **验证方式（本故事实测）**：`pnpm run build`；Node 直跑 24 项（`/tmp/assert-us074-data.mjs`：文案 / 剩余时间
  三种口径 / 恢复判定与容差 / 四类原因 / 视图同形状 / 服务层幂等与重试）；浏览器 **72 项**
  （`/tmp/assert-us074-browser.mjs`）；回归 US-072 data 37、US-072 browser 82/83、US-073 data 46、US-073 browser 37。
  **US-072 里「提交按钮文案 = 提交演示任务」那一条自本故事起失效**（按钮改名成验收原文「生成成长记录视频」），
  其余 82 项仍全绿；截图 367~371 留档。

### 验「提交 → 离开页面 → 回来恢复」时的四个坑（本故事真踩）

- **页面内 `await import('/src/services/videoJobQueue.js')` 拿到的是另一个模块实例**（Vite 给应用那份模块的
  URL 带了版本参数）：它有自己的模块级内存队列，通过它 `submitVideoJob / clearVideoJobs` **界面不会变**
  （本轮假红一次：四类失败文案都写进了那份内存，卡片上一张都没有）。队列状态一律读**界面 DOM** 或
  `localStorage` 镜像（`xinlehui-video-jobs-v1`）；要改状态就走界面。
- **演示任务跑到 45% 才失败，且只有 `failed / canceled` 才允许重新排队**：换原因重跑之前先
  `waitForCondition` 等它收在 `failed`/`canceled`，否则重复提交会被幂等命中（`created:false`，什么都不发生）。
- **恢复验证要留够时间窗**：提交 3 条**班级**任务（14 秒/条、并发 2 → 第 3 条排队），整页重载 + 重新登录 +
  再走一遍流程约 7 秒，到达时仍有进行中的任务（个人演示只有 8 秒，会假红）。断言三条不依赖时序的读数：
  任务在（按 jobKey 一条不少）、`startedAt` 未变（没重启）、进度不倒退。
- **档案页的「查看对象」必须是有记录的学员 / 班级**：`VideoJobsPanel` 挂在 `showTimeline` 分支里，
  换成没有归档记录的学员 / 班级时整块面板不渲染（本轮想用另外两位学员换 jobKey，发现面板直接没了）。

## 成片内容规则与帧清单（时间线预览）（[第四步 US-215]）

提交视频之前老师要看的那条时间线：帧序规则、每一帧的起止与字幕、成片内容边界。

| 关注点 | 位置 | 说明 |
|---|---|---|
| 规则（帧时长 / 转场 / 每 4 幅插照片 / 字幕 / 内容边界） | `src/data/videoTimeline.js`（零依赖，Node 可直跑） | `VIDEO_FRAME_DURATION_SEC`、`VIDEO_TRANSITION_SEC`、`videoSubtitleFromReview()`、`videoTimelinePlan()`、`videoTimelineView()`、`videoTimelineContentIssue()` |
| 界面 | `GrowthArchiveData.jsx` 的 `VideoTimelinePreview`（在 `VideoJobsPanel` 里、任务卡片之外） | `data-video-timeline-*` / `data-video-frame-*` / `data-video-boundary-row` |

- **帧序四条数字 + 转场一条**：片头 3 / 作品帧 3.5 / 课堂每 4 幅插 1 张 2 秒 / 片尾 4，转场统一 0.5 秒交叉淡入。
  规则与时间轴**同源**：相邻帧重叠 0.5 秒（后一帧 `startSec = 前一帧 endSec − 0.5`），
  因此 `总时长 = 各帧时长之和 − (帧数 − 1) × 0.5`（13 帧 = 42.5 − 6 = 36.5 秒）。改时长只改那份常量表。
- **每 4 幅作品后插 1 张照片，缺照片就是跳过而不是报错**：照片槽 = `floor(作品数 / 4)`，
  有限照片按顺序填槽；**占位照片不算一张照片**（渲染服务取不到），单独记 `counts.unavailablePhotos`，
  缺槽记 `counts.skippedPhotoSlots`，两者都在面板上用一句人话说明。
- **字幕只能来自归档记录里「美术能力」的那句原文**：归档前置校验保证它是老师确认过的，
  所以 `videoTimelinePlan` 只读 `entry.dimensions` 里 `VIDEO_SUBTITLE_DIMENSION` 的 `text`。
  超 24 字时**在停顿标点处截断**（`VIDEO_SUBTITLE_SOFT_BREAKS`，至少留 6 字），截出来仍是**原文字符的连续片段**：
  不补字、不改写、不加省略号。没有原文就留空 + 可读原因（**不许编一句顶上**）。
  `videoSubtitleIssue(subtitle, reviewText)` 是这条口径的判据（`includes` 逐字校验 + ≤24 字），
  界面上的 `data-video-frame-subtitle-verbatim` 与它同源。
- **素材用「渲染服务那一侧」的口径**：帧里的图**只认 https 持久地址**（`isPersistentMediaUrl`），
  本机副本（data:）在帧上如实标「图片同步中」—— 渲染服务本来就取不到它，预览不该假装取得到。
  这也让帧清单的缩略图只在素材同步成功后出现。
- **「内容不得包含原图 / 推理轨迹 / 内部提示词 / 联系方式」分两层**：
  结构层 = 帧由白名单字段现拼（`VIDEO_FRAME_FIELDS`），且禁字段键名把分享那一套**再加成片地址类**
  （`outputurl` / `mp4` / `downloadurl`）—— 「不产出 mp4」因此在字段名这一层就成立；
  复核层 = `videoTimelineContentIssue()`（键名 → 字幕逐字 → 成片文字扫联系方式）。
  联系方式的正则**复用 `data/archiveShare.js` 的 `ARCHIVE_SHARE_WECHAT_FORBIDDEN`**（别抄第二份），
  文案按视频口径另给；扫描范围只是**成片里真会出现的文字**（片头行 / 作品名 / 字幕 / 片尾寄语），
  规则说明不参与（否则「联系方式」这类词会自己命中自己）。
- **帧清单读的是「生成周期」而不是页面上的「周期筛选」**：`GrowthArchiveData` 里另算一份
  `videoEntries = archiveResidentView({..., period: videoPeriod}).entries` 传进面板 ——
  两个窗口混用一个 state 会让「只是筛一下」变成「悄悄改了要生成的东西」（US-213a 的既有口径）。
- **验证方式（本故事实测）**：`pnpm run build`；Node 直跑 **130 项**（`/tmp/assert-us075-data.mjs`：
  规则五行 / 帧序与重叠 / 照片槽与跳过 / 字幕三种情形 / 内容边界四类 / 素材闸门 / 空周期同形状 / 令牌判定）；
  浏览器 **95 项**（`/tmp/assert-us075-browser.mjs`：注入 9 条带 https 素材的归档记录 + 1 条点评里带微信的记录，
  走完整流程到档案页后逐个对象复核）；回归 US-072 data 37、US-072 browser 82/83（那条按钮文案是既有失效项）、
  US-073 data 46 + browser 37、US-071 browser 80、US-074 browser 72；截图 372~375 留档。
- **验证脚本的两个坑（本故事真踩）**：
  ① 「点评里带联系方式」的夹具**要保证那段联系方式活过 24 字截断** —— 第一版把微信写在长句末尾，
  截断后正好被剪掉，于是边界那行不点名，看起来像功能坏了（夹具问题，不是产品问题）；
  ② 帧清单的缩略图**必须放在任务卡片之外**：US-072/074 的脚本会数 `[data-video-job-card]` 里的
  `video/img/iframe/audio`（「不得显示假封面」那一条），卡片里多一张图就会假红。

## 成片时长上限与自动精选（[第四步 US-216]）

「这条片子放不下这么多作品、哪些会被舍弃」在提交之前就要看得到：两个上限、超出时的均匀取样、班级配额与手动排除。

| 关注点 | 位置 | 说明 |
|---|---|---|
| 规则（上限 / 取样 / 班级配额 / 排除） | `src/data/videoSelection.js`（零依赖，Node 可直跑） | `VIDEO_DURATION_CAP_SEC`、`videoSelectionSampleIndices()`、`videoSelectionAllocateGroups()`、`videoSelectionPlan()`、`videoSelectionView()` |
| 界面 | `GrowthArchiveData.jsx` 的 `VideoSelectionPanel`（在 `VideoJobsPanel` 里、帧清单**之前**） | `data-video-selection-*` / `data-video-selection-row*` / `data-video-selection-toggle` / `data-video-selection-student*` |

- **预估时长只有一份算法**：`videoSelectionDurationSec(entries,{type})` = `videoTimelinePlan({entries,type}).totalSec`。
  于是「精选清单上的预估时长」与「帧清单上的总时长」永远是同一个数（改帧时长只改 `videoTimeline.js`）——
  不许在数据层或界面里另写一个 `3.5 × n` 之类的公式。
- **只有超上限才取样**：`videoSelectionPlan` 先算「不取舍」的完整时长（`fullSec`），没超就**一幅都不舍弃**；
  超了就从「全收」往下找**最大的**放得下的名额 —— 照片槽有台阶（每 4 幅插 1 张），时长对名额**不是严格单调**，
  所以是逐个试（`durationOf(videoSelectionSelect(...))`）而不是二分。取样公式
  `videoSelectionSampleIndices(count,size)` = `round(i×(count−1)/(size−1))`：首末两幅必留是**结构上**成立的。
- **班级保底优先于上限**：名额不够让每位学员都上时按时间线**均匀挑学员**（不是砍掉排在后面的孩子）；
  剩下的按作品数比例分（最大余数法，某位学员的作品先分完就把余量让给别人）。极端情形「每人 1 幅都超上限」
  如实标 `overCap` + 一句人话 —— **不许靠少收某位学员来凑时长**。
- **手动排除是「先去掉再精选」，不是「隐藏一行」**：`excluded`（`entry.id` / `entry.recordKey`）从候选里
  去掉后**整条链重算**，所以「收录清单 + 预估时长 + 帧清单」三处一起变（US-216 第 5 条）。
  排除是面板的局部 state，换对象 / 换周期 / 换类型时清空 —— 它只对「某个对象的某个周期」有效，不进任务、不落库。
- **帧清单重建在「收录的那一批」上**：`VideoJobsPanel` 把 `selection.selectedEntries` 喂给 `videoTimelinePlan`。
  未超上限的周期（既有夹具都在这一档）取样结果等于全收，所以 US-075 的 95 项帧清单断言一条没动。
- **缺课记录不是一幅作品**：`isAbsence` 的条目不进候选、不占名额、也不计进「本周期共 N 幅」与 `counts.total`
  （与 US-215 的帧序同一口径），但会以 `state:'absence'` 的行如实列在清单里（没有排除开关）——
  否则老师的缺课记录会像「凭空少了一条」，也容易被算成一幅作品把名额挤掉。
- **验证方式（本故事实测）**：`pnpm run build`；Node 直跑 **146 项**（`/tmp/assert-us076-data.mjs`：
  上限与规则四条 / 取样等距与首末必留 / 班级保底与最大余数分配 / 60 幅取样到 37 幅 / 预估时长与帧清单同源 /
  手动排除重算 / 缺课不计入 / 保底超上限 / 视图七种状态同形状）；浏览器 **100 项**（`/tmp/assert-us076-browser.mjs`：
  注入「60 幅（超个人上限）+ 3 幅 + 1 条缺课（未超上限）+ 班级 100 幅（5 位学员 40/30/15/10/5 幅，超班级上限）」三个场景，
  逐个对象复核读数与帧清单、真实点击排除与恢复、提交后任务卡片仍然没有假成片、390px）；
  回归 US-075 data 130 + browser 95、US-074 data 24 + browser 72、US-072 data 37 + browser 82/83
  （那条「提交按钮文案」是 US-214 起的既有失效项）、US-073 data 46 + browser 37；截图 376~379 留档。
- **验证脚本的两个坑（本故事真踩）**：
  ① 往页面里注入的表达式**括号要对准每一个 `(`**：`[...o].find(item=>item.value==="X"))` 多一个 `)`
  在浏览器里报 `SyntaxError: Unexpected token ')'`（错误位置指在引号处、指不到多出来的那一个）；
  写完抠出来 `node --check` 一遍最快（与 US-213b 的教训同一条）。
  ② 一次注入多个场景时，**夹具班级必须与「走流程」那个班级换名字**：`walkToArchive` 造出来的那位学员
  落在他选的班级里（`周六创意绘画 2 班`），夹具再用同一个班名会让班级总数 / 配额断言整片偏掉（多一位学员、
  多一幅作品，最大余数法的分配结果就变了）。

## 个人成长视频时间线（[第四步 US-217]）

「一位孩子这个阶段的作品串起来会是什么样」在出片之前就要看得到：升序串联、缺课 1.5 秒留白卡、片头写学员与周期、成片信息（推算值带「预估」）。

| 关注点 | 位置 | 说明 |
|---|---|---|
| 编排（串联 / 留白卡 / 片头 / 成片信息 / 学员隔离） | `src/data/videoPersonal.js`（零依赖，Node 可直跑） | `videoPersonalPlan()`、`videoPersonalView()`、`videoAbsenceCardText()`、`videoPersonalInfoRows()`、`videoPersonalOwnershipIssue()` |
| 界面 | `GrowthArchiveData.jsx` 的 `VideoPersonalTimeline`（在 `VideoJobsPanel` 里、帧清单**之后**、任务卡片之外；**只在个人档案下渲染**） | `data-personal-video-*` / `data-personal-frame*` / `data-personal-absence-*` / `data-personal-info-*` / `data-personal-foreign-*` |

- **帧序、帧时长与重叠量只有一份**：个人时间线的作品/照片帧直接复用 `videoTimelinePlan`（US-215），
  起止一律走 **`videoFrameSpan(prevEndSec, durationSec, {isFirst})`**（`videoTimeline.js` 导出的共用数学）。
  新增帧种类只加 `VIDEO_FRAME_KINDS` / `VIDEO_FRAME_KIND_LABELS` / `VIDEO_FRAME_DURATION_SEC` 三处
  （留白卡 1.5 秒就是这么进的表），**不要另写一套 `durationOf()`**。
- **缺课留白卡的文案分两支**：老师缺课记录原文（`entry.absenceText` / `reviews.summary`）**≤16 字就逐字用**，
  放不下就用统一短句 `VIDEO_ABSENCE_CARD_TEXT`（沿用缺课的温和语气）—— **不删改、不编造老师的句子**，
  来源（`videoAbsenceCardText().source`）写成卡片**旁边**的旁注。卡片元素里**只放那一句话**：
  DOM 层面的「卡片文案 ≤16 字」判据是 `card.textContent.length`（时长标签放在帧头，卡片里多一个 span 就会假红）。
- **推算值必须标注「预估」，且只有一个拼装点**：`videoPersonalInfoRows()` 里把「预估」两个字拼好
  （时长、文件大小两行），界面只渲染 `value` + `estimated` 徽标 —— 组件不许自己写「预估」。
  分辨率与收录幅数是**规则与实数**（不标预估）；文件大小按 PRD 成本提示推算（每分钟 4–8 MB，5 分钟 20–40MB）。
- **「只收录该学员自己的作品」是结构性的，不是传参正确性**：面板传的是这个周期的**全部学员**记录
  （`videoScopeEntries = filterArchiveRecordsByPeriod(records, resolveArchivePeriod(videoPeriod))` + `archiveLessonEntry`），
  `videoPersonalPlan` 自己按 `entry.student` 过滤并把外人**如实报数**（`foreignEntries`）；
  读不出学员名的记录也算「不属于」（没有证据就不收录）。复核判据 `videoPersonalOwnershipIssue()` 逐帧读
  帧上的 `sourceStudent`（本故事为此把它加进 `VIDEO_FRAME_FIELDS`）—— 判据看**产物**，不去信构建过程。
- **收录清单（US-216）以作品键传进来**：`selectedKeys` 只筛作品帧（被舍弃 / 被手动排除的不排进这条时间线），
  **缺课留白卡不受它影响**（缺课本来就不进精选），界面据此说明「为什么时间线比全量少了几幅」。
  两个时长确实不同（个人时间线含留白卡），所以面板另给一句「上面的帧清单不排留白卡」的口径说明。
- **班级集锦（US-218）不属于这里**：`VideoPersonalTimeline` 只在 `!isClass` 时渲染（`personalPlan` 为 null），
  班级档案下的精选 / 帧清单 / 任务面板一字不变（班级那一块见下一节）。
- **验证方式（本故事实测）**：`pnpm run build`；Node 直跑 **122 项**（`/tmp/assert-us077-data.mjs`：
  升序串联 / 留白卡两分支与判据 / 片头拼装 / 成片信息四项与「预估」/ 学员隔离与复核判据 / 照片槽与内容边界 /
  精选联动 / 视图八种状态同形状 + `videoFrameSpan` 单元）；浏览器 **88 项**（`/tmp/assert-us077-browser.mjs`：
  注入两位学员（各 3 条 / 3 条，含两条缺课：一条短原话、一条长原话）+ 走完整流程归档一条，逐个对象复核）；
  回归 US-075 data 130 + browser 95、US-076 data 146 + browser 100、US-074 browser 72 全绿；截图 380~384 留档。
- **验证脚本的两个坑（本故事真踩）**：
  ① **截图文件名里不能有 `/`**：`382-...（时长 / 幅数 / 分辨率）.png` 会被当成路径分隔符，报
  `ENOENT ... open '.../382-第四步-成片信息（时长 /'`（错误信息只显示到斜杠前那一段，看着像目录不存在）。
  ② 走完整流程归档出来的那位学员（`陈一诺`）**也在同一个周期里**，所以「被挡下的其他学员条数」= 夹具外人 + 1；
  断言写死 3 会假红 —— 这类计数要么把流程记录算进去，要么就断言「别人一条都没进来」而不是断言总数。

## 班级视频集锦按学员分段（[第四步 US-218]）

「全班串成一条会是什么样」在出片之前就要看得到：每位学员一段、段首 1.5 秒姓名卡、本期无作品留白卡、总时长 ≤5 分钟。

| 关注点 | 位置 | 说明 |
|---|---|---|
| 编排（分段 / 姓名卡 / 留白卡 / 顺序 / 上限 / 不串档判据） | `src/data/videoClass.js`（零依赖，Node 可直跑） | `videoClassPlan()`、`videoClassView()`、`videoClassSegments()`、`videoClassNameCardTitle()`、`videoClassCrossTalkIssue()`、`videoClassMoveOrder()` |
| 界面 | `GrowthArchiveData.jsx` 的 `VideoClassTimeline`（在 `VideoJobsPanel` 里、个人时间线之后、任务卡片之外；**只在班级档案下渲染**） | `data-class-video-*` / `data-class-segment-*` / `data-class-name-card*` / `data-class-blank-card` / `data-class-order-*` / `data-class-frame-student` |

- **新增帧种类只加三处枚举**（`videoTimeline.js`）：`VIDEO_FRAME_KINDS` / `VIDEO_FRAME_KIND_LABELS` /
  `VIDEO_FRAME_DURATION_SEC`。US-218 就是照这条加进 `nameCard`（学员姓名卡）与 `blank`（本期留白卡），
  两个都是 1.5 秒；起止仍然只由 `videoFrameSpan` 算 —— 帧清单那一套规则（3 / 3.5 / 2 / 4 秒与 0.5 秒转场）
  **一个字没动**（US-075 的 130 项数据回归 + 95 项浏览器回归全绿就是这么来的）。不要另写一套时长表。
- **段号与「声明幅数」是帧上的字段**（`segmentIndex` / `declaredArtworkCount` 进了 `VIDEO_FRAME_FIELDS`）：
  `-1` = 不属于任何一段（片头 / 片尾）。姓名卡把**这一段真实收录了几幅**写在卡上（`declaredArtworkCount`），
  「姓名卡与作品不串档」的判据 `videoClassCrossTalkIssue()` 因此能**对着产物对账**（卡上数字 vs 段内真实作品帧数、
  每一帧的 `sourceStudent` vs 段首姓名卡），而不是去信构建过程。
- **顺序默认按班级名单 = `roster` 是顺序真源**：`videoClassPlan` 收 `roster`（名单）与 `order`（老师调整后的顺序）；
  分段名单 = `roster ∪ 本期有记录的学员`（名单之外的**接在后面照样各占一段**并如实报数）。这里用的是
  **未经收录清单过滤**的名单（`periodGroups`）：某位学员的作品被精选挡光之后他仍然占一段（留白卡），
  不会从时间线上凭空消失。换位算法是 `videoClassMoveOrder()`（越界原样返回，界面据此置灰按钮）。
- **上限读的是 US-216 那一份**：`VIDEO_DURATION_CAP_SEC.class`（300 秒 / 5 分钟），班级的「每人至少 1 幅（保底）+
  按作品数比例」直接复用 `videoSelectionAllocateGroups()` / `videoSelectionSampleIndices()`。修剪的判据是
  **整条编好的时间线**（姓名卡与留白卡都算进去），从「全收」往下逐档试出最大的放得下的名额；保底本身超上限时
  如实标 `overCap`（与 US-216 同一句实话：**不靠少收某位学员来凑时长**）。
- **卡片元素里只放那一句话**（US-217 的教训在这里同样成立）：姓名卡元素里只有 `姓名 · N 幅作品`，
  留白卡元素里只有文案；时长（`data-class-name-card-duration` / `data-class-blank-duration`）、
  「本段收录几幅」与来源说明都写在卡片**外面**（`data-class-name-card-note` / `data-class-blank-note`）——
  DOM 层面的「卡片文案 ≤16 字」判据才站得住。
- **班级档案下的入口数据是另外两份**（`GrowthArchiveData`）：`videoClassEntries`（这个班级 + 生成周期的记录）与
  `classRoster`（学员管理里同班的学生名 = 顺序真源）；面板自己持有 `classOrder` 局部 state（换班级清空）。
- **验证方式（本故事实测）**：`pnpm run build`（330~359ms）；Node 直跑 **166 项**（`/tmp/assert-us078-data.mjs`：
  分段与姓名卡对账 / 顺序与换位算法 / 留白卡两分支与判据 / 25 位 × 6 幅取样到上限内 / 保底超上限的实话 /
  精选联动 / 缺课不进分段 / 视图同形状 + 篡改产物的四类点名）；浏览器 **94 项**（`/tmp/assert-us078-browser.mjs`：
  注入同班 3 位学员（1 / 2 / 3 幅，含一条缺课）+ 名单里的第 4 位「本期 0 幅」+ 走完整流程归档一条，
  逐个对象复核不串档、真实点上移 / 下移 / 恢复名单顺序、390px）；回归 US-075 95、US-076 100、US-077 91、
  US-074 72 全绿；截图 386~390 留档。
- **验证脚本的两个坑（本故事真踩）**：
  ① **篡改产物做判据断言时要先复制帧对象**：`frames.map(frame => { frame.sourceStudent = 'X'; return {...frame} })`
  会把 `plan.frames` 里那个对象也改掉，后面「判据对干净产物为空」之类的断言整片连带失败（看起来像产品误报）。
  复制在前、改副本在后。
  ② **走流程归档那一条的作品名是课题名**（`圆形变变变`），不含学员姓名：想验「作品不串档」要断言
  「不含其他学员的名字」或读帧上的 `sourceStudent`，别断言作品名前缀是学员名。

## 成片预览 · 下载与分享（mock）（[第四步 US-219]）

> 「渲染服务还没接进来」在成片这一侧落成四件如实的事：竖屏 9:16 播放器占位（不显示任何假 mp4）、
> 下载与分享的「暂不可用」提示、分享页播放器带 `playsinline`、成片分享与图文分享**同一套规则**
> （授权校验 / 有效期 / 撤回）。规则与文案的唯一真源是 `src/data/videoShare.js`（零依赖纯函数，可 Node 直跑），
> 令牌本体仍是 `src/data/shareTokens.js`（新增 `kind` / `jobKey` / `period` 三个字段）。

| 关注点 | 位置 | 说明 |
|---|---|---|
| 成片三件套判据 / 播放器 / 闸门 / 令牌入参 / 两块视图 | `src/data/videoShare.js`（零依赖，Node 可直跑） | `videoOutputView`、`videoPlayerView`、`videoPreviewView`、`videoShareGateView`、`videoShareTokenInput`、`videoSharePanelView`、`videoShareBlockView` |
| 老师端面板 | `GrowthArchiveData.jsx` 的 `VideoPreviewPanel`（在 `VideoJobsPanel` 里、班级集锦**之后**、任务卡片**之前**） | `data-video-preview-*` |
| 家长页成片块 | `ParentSharePage.jsx` 的 `ParentVideo`（由 `parentShareView` 的 `video` 字段驱动） | `data-parent-share-video-*` / `data-parent-share-player-*` |
| 令牌种类 | `src/data/shareTokens.js` | `SHARE_TOKEN_KINDS` / `normalizeShareTokenKind`（缺失或脏值一律读成 `record`，老记录向后兼容） |

- **「不显示假 mp4」是结构性的**：`videoPlayerView().src` 只在「https 地址 + 正时长 + 正体积」时才有值
  （判据 `videoOutputView`，地址那一层复用 `videoJobs.js` 的 `videoJobOutputUrlIssue`，别再写第二套）；
  没成片时 `<video>` 不设 `src`、不渲染 `<source>`、不带 `controls`，上面盖一层如实占位。
  **播放器元素在「没有成片」时也要渲染**（老师端与家长页两处都带 `playsinline` + `webkit-playsinline`）——
  家长页那一条是验收点名项；渲染一个空 `<video>` 不等于显示假 mp4，断言该查 `src` / `<source>` / 面积。
- **成片分享 = 图文分享同一套规则**：生成前仍过 `shareTokenGenerationGate(archiveForwardView(...))`
  （授权来源还是 `data/consent.js`），有效期仍是 `SHARE_TOKEN_DEFAULT_VALID_DAYS`（默认 30 天 + 7/30/90 下拉），
  撤回仍走 `revokeShareTokenRecord` + `replaceShareToken` + `revokeRemoteShareToken`。
  **班级成片逐人过闸门**（`videoShareGateView` 收 `students` 数组，任一位没过就拦下并点名）——
  这是「同一个函数逐人调用」，不是第二套授权逻辑。
- **家长页的成片令牌不带 `recordId`**：成片是一条周期时间线，不是某一节课。因此
  `parentShareView` 的 `lessonBlockVisible` 在成片令牌下恒为假（否则会渲染「未记录课次日期」这种错话），
  `recordMissingNote`（图文那句「作品与点评还没同步」）也不出现 —— 成片块自己有 `missingNote`；
  撤回 / 过期后 `video.present` 结构性为假（连播放器都不渲染，页面上不出现孩子的信息）。
- **分享页的 `jobs` 从哪来**：`App` 用 `useState(()=>listVideoJobs())` 读本机镜像传给 `ParentSharePage`
  （家长页在登录之外没有别的数据源；换设备打开时找不到任务 → 播放器占位 + 一句实话，不编内容）。
- **任务卡片之外的纪律**：US-075/076 有一类断言只数 `[data-video-job-card]` 内部（不得有 video/img/iframe），
  新增的预览面板必须放在卡片**外面**，否则那类断言会假红。
- **验证方式（本故事实测）**：`pnpm run build`（330~345ms）；Node 直跑 **171 项**（`/tmp/assert-us079-data.mjs`：
  三件套判据 / 播放器三态与 playsinline / 预览动作与两句提示 / 令牌种类向后兼容 / 闸门三种拦法与班级点名 /
  面板有效期与撤回 / 分享页块白名单 + 撤回后不出现 / 图文口径回归）；浏览器 **110 项**
  （`/tmp/assert-us079-browser.mjs`：真实走流程归档一位已授权学员 → 面板读数 / 点下载与分享的不可用提示 /
  生成链接 / 撤回（二次确认）→ 家长页两块（撤回态与可用态）/ 390px / 班级成片点名）；
  回归 US-075 browser 95、US-076 browser 100、US-077 browser 91、US-078 browser 94、US-069 browser 86 全绿；
  截图 391~397 留档。
- **验证脚本的两个坑（本故事真踩）**：
  ① **上一次跑挂掉没关的 Chrome 会以旧实例作答**：`launchChrome` 只探端口 `/json/version`，
     上一次失败退出（`process.exit` 跳过 `chrome.close()`）留下的进程带着旧 profile ——
     于是「还没有任务 / 还没有生成链接」这类断言读到的是上一轮的 localStorage（假红）。
     脚本开头先探端口、占用就报错停下，并挂 `uncaughtException` 兜底关浏览器。
  ② **不要在 `outerHTML` 上找学员名或 `.mp4`**：dev 模式下 Vite 把全部 CSS 注成 `<style>`，
     而历史遗留样式里有写死的 `content:'陈一诺 · 《向着光的花》 · 2026.08.11'`；另外模板字符串里的 `\.`
     会被吃掉（`/\.mp4/` 变成 `/.mp4/`，于是 `-mp4` 这类属性名也算命中）。判据改成：
     名字查 `body.textContent`，媒体地址查 `[src],[href],[poster]` 的属性值。

## 音乐库（`music_tracks`）与授权闸门（[第四步 US-220a] / F-ARCHIVE-MUSIC-01）

> 把音乐混进发给家长的视频属于**商业使用**：来源不清的曲子一旦用上，侵权责任由平台承担。
> 所以这一块的默认状态必须是「不可用」——新建入库一律 `pending`，由管理员确认授权后才放开。

三份东西配套：

| 关注点 | 位置 |
|---|---|
| 领域规则（状态机 / 去重 / 引用范围 / 列表读数，零依赖） | `src/data/musicTracks.js` |
| 云端行读写（snake_case ↔ camelCase、白名单 payload） | `src/services/musicLibraryApi.js` |
| 管理端页面（左列表 + 右编辑） | `src/admin/MusicLibraryPage.jsx` |

- **两个构造入口别混用**：`createEmptyMusicTrack` 只做归一化（读历史记录时要原样保留 `confirmed`），
  **`createNewMusicTrack` 才是新建入库的唯一入口**（无论传什么状态都落 `pending`）。页面与服务层的新建
  只走后者 —— 用前者会让「新建入库默认 pending」这条在某个调用点上静默失效。
- **授权到期由日期推导**：`musicLicenseState()` 看 `licenseExpiresAt`（到期日当天仍可用，次日算到期），
  即使库里存的还是 `confirmed` 也读成 `expired`；老师端可选性的唯一判据是 `musicTrackAvailability()`
  （US-221 的版权闸门读同一份），不要另写一套 `if (status === 'confirmed')`。
- **引用范围（删除前必须说得清）只读原始记录行**：`musicTrackUsage()` / `musicTrackUsageIndex()` 认四种历史写法
  （`record.music.trackId`、`record.versions[].music.trackId`、`record.specSnapshot.music.trackId`、平铺 `musicTrackId`）。
  **页面的数据源必须是镜像里的原始 JSON**（`loadMusicReferenceRecords()`），不能只读 `listVideoJobs()` ——
  `normalizeVideoJob` 会把不在 `VIDEO_JOB_FIELDS` 白名单里的键丢掉，而成片选了哪首曲子正是 US-221 才补进白名单的
  字段：只读归一化产物会让这个数字永远停在 0（本轮真踩）。同一任务的多个历史版本只算**一条成片**
  （`count`），但每一处引用都进 `versionCount`（界面写「含 N 处历史版本引用」）。
- **列表行是渲染产物，不能当编辑草稿用**：`musicTrackListRow` 会把时长/BPM 拼成一句话、情绪拼成字符串，
  拿它去填表单再保存会丢掉 `licenseStatus` / `licenseExpiresAt` / `commercialUse`（表现是「一改作者，
  授权状态就被重置成待确认」——本轮真踩）。编辑值取 `musicTracks`（state）里的原始曲目，列表行只用来显示引用范围。
- **空镜像 ≠ 没有镜像**：`loadMusicTracks()` 按 `localStorage.getItem(KEY) !== null` 分叉 ——
  镜像存在但为空数组时返回**空库**。否则「删掉最后一首再刷新」会把演示曲目复活（与 `courses` 的「空即种子」口径
  不同，这里删除是验收点，故意分叉）；`musicLibraryMirrorStored()` 同样按 `null` 判断。
- **合并方向本机优先**：`loadAllMusicTracks()` = `mergeMusicTracks(本机, 云端)` —— 云表 `music_tracks` 还没建立
  （写入被 PostgREST 拒掉 DATABASE_PGRST204），本机的授权确认才是最新的，云端只补本机没有的 `trackKey`。
  与 `audit_logs` / `agent_files` / `framing_presets` 同一套兜底口径。写侧先落镜像再推云，
  云端失败时**抛出**（调用方提示「已保存到本机」但必须把这条并回 React state，否则下一轮 persist 会覆盖镜像）。
- **验收原文点名那句只能有一份**：`MUSIC_LIBRARY_DEMO_LABEL`（「演示数据 · 授权曲源未接入」）在
  `data/musicTracks.js` 里，页面 import 它 —— 搜索与下载入库（US-220b）未接入是**如实标注**而不是静默。
- **验证方式（本故事实测）**：`pnpm run build`（374~446ms）；Node 直跑 **116 项**
  （`/tmp/assert-us080-data.mjs`：字段清单 / 三个构造入口的状态口径 / 到期推导与老师端可用性 / 去重 /
  引用范围与索引逐字段一致 / 行映射与白名单 / 先落镜像再推云与云端拒写不丢数据 / 空镜像不复活种子）；
  浏览器 **55 项**（`/tmp/assert-us080-browser.mjs`：五首演示曲目的四种状态 chip、九个元数据字段可改落盘、
  授权状态/到期日/可商用勾选、停用启用、新建入库 pending（且状态框是只读 disabled 的 input）、
  空标题被拦、刷新后仍在、删除确认两条路径（0 引用与 1 引用）、去重判据、老师端看不到入口、
  0 未捕获异常 / 0 console.error）；回归 US-075/076/077/078/079 data（130/146/122/166/171）与
  US-079 browser 110 全绿；截图 398~403 留档。
- **验证脚本的两个坑（本故事真踩）**：
  ① `type=number` / `type=date` 的输入框用 `Input.insertText` 会**追加**到原值上（`92` → `9295`）：
     这类字段必须走原生 value setter + `input`/`change` 事件（与 `<select>` 同一套写法）。
  ② 演示曲目里有的**本来就勾着**「可商用」：直接 `click()` 是取消勾选。要断言「勾上之后落盘」得先读
     `.checked`，不是目标状态才点（`ensureChecked` 的写法）。

## 授权曲源的**搜索与下载入库**契约（[第四步 US-220b] / FR-289 ~ FR-297）

US-220a 解决「曲目怎么管」，这一节解决「曲目从哪来」：管理端的搜索入口与下载入库按**接口契约**实现，
曲源本身还没签约（PRD Q10 是阻塞项）——所以这一块的全部纪律是**「未配置时只说真话」**。

| 关注点 | 位置 |
|---|---|
| 规则（过滤条件 / 结果白名单 / 失败码 / 入库步骤 TODO / 文案） | `src/data/musicSource.js`（零依赖，Node 可直跑） |
| 网络动作（拼 URL / fetch / 抛错，**无 mock 分支**） | `src/services/musicSourceApi.js`（可注入 `fetchImpl`） |
| 界面（面板 + 失败清单与重试） | `src/admin/MusicLibraryPage.jsx` 的 `MusicSourcePanel` |

- **未配置授权曲源时是抛错，不是返回空结果**：`services/musicSourceApi.js` 在「0（连不上）/ 404 / 405 / 501 /
  200 但 `configured:false`」四种情形下一律抛 `MusicSourceError`（`unconfigured:true`），消息以
  `MUSIC_SOURCE_UNCONFIGURED_TEXT` 开头（含验收原文「未配置授权曲源」，并写明不返回演示或虚假搜索结果）。
  界面的结果区因此**结构上**为空 —— 全模块不存在演示 / 种子搜索结果数组（有断言查 `seed|demo|mockResults` 这类键名）。
- **HTTP 状态只有一个含义**（`musicSourceStatusVerdict`）：`200/201/202` = ok；`0/404/405/501` = 未配置；
  其余 = 服务在但拒绝了这次请求（下载失败的三类原因走这一支）。与视频服务契约层同一纪律。
- **搜索过滤条件是真入口**：`createMusicSourceQuery` 归一化四组条件（关键词 / 情绪 / 时长 / BPM 上下限），
  `musicSourceQueryString` 拼查询串（固定顺序 + 逐项编码），`musicSourceQueryIssue` 在下限大于上限时
  **发请求之前**就拦下（断言：拦下时一个请求都没发）。
- **入库结果契约有三道硬判据**（`musicSourceImportTrackIssue`）：必带 `trackKey/title/sourceUrl/fileKey/fileUrl/hash`
  六项、`fileUrl` 必须 http(s)、**返回的 `sourceUrl` 必须与这次下载的那条搜索结果一致**（曲源串档比慢更糟）。
  入库成功后走 `createNewMusicTrack`（授权状态强制 `pending`，服务端谎称 `confirmed` 也不作数）——FR-293 的闸门
  只用一份，不因为来源是「授权曲源」就放行。落库路径复用 `mirrorMusicTrackLocally`（先落本机镜像再推云）。
- **失败原因来自服务端失败码的翻译，不凭空编**（FR-297）：`MUSIC_SOURCE_IMPORT_FAILURES` 三个码
  `hotlink / timeout / format` → 防盗链 / 超时 / 格式不支持；认不出的码说
  `MUSIC_SOURCE_IMPORT_UNKNOWN_REASON`（「曲源服务没有给出可识别的原因」），服务端给的说明只作补充括号。
  界面给每条失败记录渲染「重试」按钮（`data-music-source-import-retry`，attempts 自增）。
- **转码与去重是服务端 TODO，界面上如实标注**：`MUSIC_SOURCE_IMPORT_STEPS` 四步里 `transcode`（mp3 128kbps）
  与 `dedupe`（来源 URL + hash）标 `todo:true`，面板常驻 `MUSIC_SOURCE_IMPORT_NOTE` 说「尚未接入」；
  `prototype/server/index.mjs` 的 `musicSourcePolicy` 也声明 `transcode/dedupe: { todo: true }`
  （前端与服务端说的是同一件事，改一处要改两处）。
- **常驻版权提示的唯一一份**：`MUSIC_SOURCE_COPYRIGHT_NOTE` =「请仅下载可商用授权音乐，并保留授权凭证」
  （FR-296 原文）在 data 层，页面无条件渲染在搜索框下方（`data-music-source-copyright`）——
  探测 / 搜索 / 切换曲源状态都不消失，组件里不许抄第二份。
- **本地服务端**：`GET /api/music/source` 公开声明能力（`configured:false` + 两个 TODO + 路由表）；
  `GET /api/music/source/search` 与 `POST /api/music/source/tracks` 一律 `501`
  （**不是** 200 + 空结果 —— 501 才有「未配置」这个唯一含义）。真接入时在服务端换实现，前端不动。
- **验证方式（本故事实测）**：`pnpm run build` 通过（397~446ms）；Node 直跑 **102 项**
  （`/tmp/assert-us081-data.mjs`：四组过滤条件与查询串 / 五种「未配置」路径 / 不入库坏结果 / 入库契约四道 /
  三类失败码翻译 / 版权提示唯一份 / 静态口径）；浏览器 **55 项**（`/tmp/assert-us081-browser.mjs`：
  真实页面探测到「未配置授权曲源」且结果 0 条、条件非法被拦、页面内替换 `window.fetch` 验
  「已配置」替身路径（搜索查询串逐项 / 坏结果报数 / 入库 POST / 待确认授权）、403 hotlink → 可读原因 +
  重试 attempts=2 成功、390px 无横向滚动且控件 ≥44px、console 0 异常）；回归 US-075/076/077/078/079 data
  （130/146/122/166/171）与 US-080 data 116 + browser 55、US-079 browser 110 全绿；截图 404~408 留档。
- **验证脚本的坑（本故事真踩）**：替身 `fetch` 返回的**入库 `trackKey` 不能写死常量** —— 同一替身跑两次入库
  （首次 + 重试）会带回同一个 `trackKey`，第二次把第一次那条覆盖掉，「列表里应有 N 条」的断言会少一条
  （看着像产品丢数据）。替身按 `sourceUrl` 派生 `trackKey`，或断言改成按 title 找。另外 390px 的
  ≥44px 扫描要把 `input/select` 也算进去（`min-height:44px` 得单独给 `.music-source-search input/select`，
  全局样式里它们只有 ~36px）。

## 老师端的音乐选用与版权闸门（[第四步 US-221] / F-ARCHIVE-MUSIC-02 / FR-294 ~ FR-300）

US-220a 解决「曲目怎么管」、US-220b 解决「曲目从哪来」，这一节解决「老师怎么用、出了事怎么举证」。

| 关注点 | 位置 |
|---|---|
| 领域规则（可选清单 / 静音默认 / 授权凭证快照 / 到期与处置 / 混音参数，零依赖） | `src/data/musicSelection.js` |
| 成片记录里的 music（形状 + 归一化 + 白名单） | 同上；`data/videoJobs.js` 的 `videoJobSpecSnapshot({music})` 调它 |
| 落地（提交时写进任务 + 处置回写） | `services/videoJobQueue.js`（`submitVideoJob({music})` / `recordVideoJobMusicDisposition`） |
| 界面（选用 / 记录 / 到期处置 / 混音读数） | `GrowthArchiveData.jsx` 的 `MusicSelectionPanel` |

- **可选的唯一判据是管理端的 `musicTrackAvailability()`**，不是界面里再写一遍 `if (status === 'confirmed')`：
  `selectableMusicTracks()` 只返回「已确认授权 + 未过期 + 未停用」的曲目 —— `pending` / 到期 / 停用的曲目
  在老师端**结构上拿不到**（不是渲染时隐藏）。到期日**当天仍可用**，次日算到期（与管理端同一口径）。
- **静音是默认值，且必须结构性地成立**：`musicSelectionDefault()` / `normalizeMusicSelection()` 缺字段时
  一律落回静音；界面 `useState(musicSelectionDefault)`。任何「不静音但没有 trackId」的脏数据也读成静音
  （fail-safe：宁可不出声，也不放一首来路不明的曲子）。
- **成片记录写进 `specSnapshot.music`**（`musicJobMusicFromSelection`）：静音也写一条
  `{muted:true, …空…}`（明确结论），选了曲子就写 `trackId + 标题 / 来源 / 来源平台 / 授权类型 /
  授权凭证 / 到期日 / 状态 + capturedAt`（举证四件套 + 记录时刻）。**老任务没有这一项时是 `null`**，
  不是「静音」—— 界面与断言能分开（`musicRecordedView(null).present===false`）。
- **记录里的证据不因再次操作被改写**：处置（更换音乐 / 静音）只写 `disposition`（动作 / 时间 / 操作人 /
  当时那句原因），`trackId` 与整份授权凭证快照一个字节不动；同一 jobKey 再次提交也**不改写已有记录的
  music**（举证材料要稳定），界面用 `MUSIC_RESUBMIT_KEEPS_RECORD_NOTE` 如实说明「这次的选择会用在下一版」
  —— 不静默忽略（否则老师以为换上新曲子了）。
- **记录里的曲目失效后，本片选择回到默认静音**（`musicSelectionFromJobMusic(music,{tracks})` 传当前曲库时
  再验一次可用性）：不让老师点一下提交就把已经没授权 / 已停用 / 已删除的曲子又写进新记录；界面用
  `MUSIC_RESTORE_MUTED_NOTE` 说明「为什么现在显示静音」。
- **到期与「授权被收回」是两件事，两句提示分开写**：到期（记录自己的到期日过了，或曲库那条状态是
  `expired`）→ 验收原文 `MUSIC_LICENSE_EXPIRED_NOTICE`「音乐授权已到期，建议更换或静音。」；
  授权被改回 `pending` / 停用 / 删曲 → `MUSIC_RECORD_REVOKED_NOTICE`（也指向「建议更换或静音」，
  但不把没到期说成已到期）。两句都只在 data 层写一次，界面 import。
- **混音口径只有一份**（`MUSIC_MIX_CONFIG`）：1.5 秒淡入 / 2 秒淡出 / `loudnorm=I=-16:TP=-1.5:LRA=11`；
  `musicMixPlan({durationSec,muted})` 拼出渲染服务要执行的滤镜串（静音时三件都不做、`filter` 是空串），
  界面读它的 `mixRows`。将来接渲染服务时读同一份，别在服务端另配一套参数。
- **任务指纹必须带音乐**（`videoJobSignature` 拼进 `music.trackId / disposition`）：服务层靠指纹判断
  「要不要落盘 / 通知界面」，漏了它会出现「换了曲子、界面与镜像都不动」（US-221 真踩）。
- **面板里做容器选择器时，读数 `data-*` 挂在块自己的根节点上**：`data-music-selection-mix*` 在
  `.music-selection-mix` 上、`-record-*` 在 `.music-selection-record` 上 —— 挂在最外层
  `[data-music-selection]` 之外的位置会让验证脚本读到 `null`（假红一次）。
- **验证方式（本故事实测）**：`pnpm run build` 通过（370~501ms）；Node 直跑 **130 项**
  （`/tmp/assert-us082-data.mjs`：可选性三种边界 / 静音默认值与归一化 / 快照九项 / 混音滤镜串 /
  到期与处置 / 队列写读 / 静态口径）；浏览器 **100 项**（`/tmp/assert-us082-browser.mjs`：默认静音、
  pending 与到期曲目不可见、选中后提交、记录五项逐项读出、改成 pending → 可选清单跟着变、
  按日期到期的原文提示与两个处置动作、处置不改写证据、全部到期时的空态与禁用、390px ≥44px）；
  回归 US-079 browser 110 全绿、US-073/074/075/076/077/078 browser 全绿（US-072 那 1 项
  「提交按钮文案」在 HEAD 上就已失败，属 US-214 的口径变更，与本故事无关）；截图 409~416 留档。
- **验证脚本的坑（本故事真踩）**：① 刷新会回到登录页 —— 要验「再次进入」必须把真实入口再走一遍
  （`reloadToArchive()` 重登 + `walkToArchive`），否则等 `[data-music-selection]` 永远超时；
  ② 390px 的 ≥44px 扫描要**排除 `input[type=radio]`**（点它的是外面那个 44px 的 label，
  与 US-080/081 的扫描口径一致），否则会误报 1 个过矮控件；③ 面板读的是「当前 jobKey 那条任务」的记录 ——
  想验「另一首曲子当记录」要么换生成周期（新 jobKey），要么直接改成片记录里的字段，不能只重选曲目。

## 成片的版本、更新与删除（[第四步 US-222] / FR-301 ~ FR-304）

US-213a 管「任务怎么跑」、US-219 管「成片怎么看 / 怎么分享」，这一节管「改了作品之后视频该不该重做、
谁来决定、旧版还在不在」。判据与文案全在 `src/data/videoRecords.js`（零依赖，Node 可直跑），
云端行映射在 `src/services/videoRecordsApi.js`，界面是 `GrowthArchiveData.jsx` 的 `VideoRecordPanel`。

| 关注点 | 位置 |
|---|---|
| 键 / 字段 / 更新对账 / 版本历史 / 删除 / 级联（零依赖纯函数） | `src/data/videoRecords.js` |
| 云端行读写（snake_case ↔ camelCase、白名单 payload、按 `video_key` upsert） | `src/services/videoRecordsApi.js` |
| 摘掉渲染任务记录（删除成片 / 级联时调用） | `services/videoJobQueue.js` 的 `discardVideoJob`（不是状态机的边） |
| 界面（videoKey / 版本 / 更新提示 / 历史回看 / 两步确认删除） | `GrowthArchiveData.jsx` 的 `VideoRecordPanel`（`data-video-record-*`） |
| 级联清理入口 | `main.jsx` 的 `ArchiveRetentionSection`（到期清理那一条路径） |

- **`videoKey` 与 `jobKey` 同构**：`videoRecordKey()` 直接委托 `videoJobKey()` —— 同一条成片与它的
  渲染任务永远共用同一个业务键（对象 + 周期 + 类型）。id 由 `videoKey` 派生（FNV-1a，与阶段报告同一套），
  云端按 `video_key` 幂等 upsert：重新生成是**就地改那一行**，不会多出孤儿行。
- **`sources` 是「这一版覆盖了哪些归档记录」的冻结指纹**（`videoRecordSources`）：生成那一刻每条记
  录的 `recordKey/id/updatedAt` 都进来。更新对账（`videoRecordUpdateView`）与级联删除
  （`videoRecordsCascadeRemoved`）都只读它 —— **两边读同一支取法**，口径不可能漂移。
- **「不自动重出」是结构性的**：`videoRecordUpdateView` 是**只读**函数，成片记录不因归档变化被改写；
  界面上也没有任何监听 `records` 去写记录的 effect。验收原文那句
  「有 N 幅作品已更新，建议重新生成」由 `videoRecordUpdatedHint(n)` 唯一产出（界面不许自己拼）。
  新归档 / 被移除各有各自的话（`VIDEO_RECORD_ADDED_HINT` / `VIDEO_RECORD_REMOVED_HINT`）。
- **版本只在「重新生成」时自增**：`updateVideoRecordVersion` 把被替换的那一版整份进 `history`
  （上限 6，与阶段报告同口径），`videoKey / id` 不变；再次点提交（幂等命中）**不改写记录** ——
  想要新版本必须点「重新生成」（它先 `discardVideoJob` 摘掉上一轮任务记录，再用同一个 jobKey 重排）。
- **成片三件套的判定复用 US-219**（`data/videoShare.js` 的 `videoOutputView`）：历史版本的
  「可下载」也走它 —— 渲染服务未接入时按钮禁用并给同一句「不会伪造一个 mp4」的提示，
  历史版本里同样**不编时长与体积**。
- **删除只动成片**：`removeVideoRecord` 只摘那一条（含历史版本），渲染任务记录由
  `discardVideoJob(videoKey)` 一起清掉（它接受任意状态：先取消语义再摘除，
  **不是**状态机新边 —— `VIDEO_JOB_TRANSITIONS` 一条没动）；归档记录在另一份账里，一个字节都不碰。
- **级联删除必须走同一个入口**：任何新的「删归档记录」路径都要调
  `videoRecordsCascadeRemoved(videoRecords, removedRecords)`（返回 `{kept, removed}`），
  再对 `removed` 逐条 `setVideoRecords` + `discardVideoJob` + `deleteRemoteVideoRecord`。
  目前唯一入口是管理端「到期清理」（`ArchiveRetentionSection`），回执用 `videoRecordCascadeNotice`。
- **合并方向本机优先**（`mergeVideoRecords`）：云端 `video_records` 表还没建立时写入会被 PostgREST 拒掉，
  本机镜像就是唯一副本；云端只补本机没有的 `videoKey`（否则刚重新生成的第 2 版会被云端第 1 版拉回去）。
  与 `archive_reports` / `music_tracks` 同一套兜底口径：`App` 只 `persistVideoRecords`，推云在写入动作里做。
- **验证方式（本故事实测）**：`pnpm run build` 通过（415~416ms）；Node 直跑 **29 项**
  （`/tmp/assert-us083-data.mjs`：四项必填 / videoKey 同构 / 更新对账四种分支 / 版本自增与历史上限 /
  三件套判据 / 删除 / 级联身份对账 / `discardVideoJob` / 静态口径）；浏览器 **62 项**
  （`/tmp/assert-us083-browser.mjs`：提交落第一版并逐项读出镜像、**再归档同一课 → 版本不变 + 验收原文提示**、
  重新生成 → 第 2 版 + 历史回看 + 回到最新版、删除 → 记录与任务记录一起清掉而时间线不变、
  管理员到期清理 → 级联删除 1 条成片）；回归 US-072/073/074/075/076/077/078/079/082 data 全绿、
  US-075/076/077/078/079/082 browser 全绿（US-072 browser 那 1 项「提交按钮文案」在 HEAD 上就已失败，
  属 US-214 的口径变更，与本故事无关）；截图 417~420 留档。
- **验证脚本的坑（本故事真踩）**：① 想验「同一条记录被更新」，**第二轮回第一步不能再重选班级 /
  学员** —— `selectClass` 会清掉 `currentLessonId`，再归档会按退化键新建一条记录而不是更新同一条
  （表现是 `updatedCount=0`、提示变成「新作品已归档」）。走草稿恢复路径即可（`walkToArchive({fresh:false})`
  不再点下拉）。② 删除后的回执要渲染在 `view.present` 分支**外面** —— 记录一被摘掉，界面立刻回到空态，
  分支里的 `notice` 永远不会出现（假红一次）。

## 老师端「课后反馈」第一步（班级 / 学员 / 课程 / 课次推荐）

> **课次表单全站只有一份实现 = `TeacherFlowV2`（`main.jsx`）。** 旧的 `CreateFlow` 五步向导
> （`StepLesson` / `StepUpload` / `StepApps` / `StepGenerate` / `StepSuccess`）与另外几个不可达的重复入口
> （`TeacherFlow`、`TeacherDashboard`、`LegacyTeacherDashboard`）已在 US-412 删除。
> `PageRouter` 的 `create` 与 `teacherFlow` **两个路由 id 指向同一个组件**（`create` 只是别名，
> 供工作台 / 课后反馈列表 / AI 创作台 / 导览页的历史入口继续可用）。
> 新增入口请 `navigate('teacherFlow')`；**不要再写第二份课次表单**，也不要在 `main.jsx` 里加回
> 「写死班级 / 学员 / 课程主题」的演示版表单 —— 第一步的班级、学员、课程、课次日期、序号、课题
> 全部由 `studentManagement` / `courses` / `lessons` 派生，JSX 里不允许出现学员名、作品名、日期字面量。
> 浏览器验证两条入口：侧边栏「课后反馈」= `teacherFlow`；`create` 这个 id **不在侧边栏**里，
> 从「AI助手 → 课前工作 → 任意工具卡」点进去（那张卡的 `onClick` 就是 `navigate('create')`）。

第一步的全部下拉都是 `TeacherFlowV2`（`main.jsx`）里的**受控组件**，状态是
`selectedClassId / selectedStudentName / selectedCourseId`，派生值是 `visibleClasses / classStudents / courseOptions / activeCourseId`。

- **不要再用命令式 DOM 同步**：旧实现是 `document.querySelectorAll('.feedback-flow-v2 .task-form select')`
  + `replaceChildren()` + 手动 `addEventListener('change')`。它每次渲染都重建 `<option>`，
  React 重渲染后选中项就丢/回退到写死的选项。下拉一律 `value={...} onChange={...}`。
- **当前登录老师**：原型阶段只有一个老师身份，取 `roleMeta.teacher.name`（`main.jsx` 顶部）。
  班级数据里存的是**老师姓名**（`class.teacher`），所以「我带的班」= `class.teacher === currentTeacherName`；
  没有 `teacher` 字段的历史班级算作自己的班（否则列表会看起来是空的）。
  跨老师（代课、教研听课）场景靠「我带的班 / 全部班级」开关切换，默认只看自己的班。
- **换班只走一个函数**（`selectClass`）：清空已选学员 + 把课程刷新回本班课程
  （`resolveCourseId(courses, class.course)`，因为班级上存的是课程名、课次上存的是 courseId）。
  任何「学员/课程回落到列表第一个」的兜底都会造成跨班串档，不要加。
- **课程下拉**用 `selectableCourses(courses)`（停用课程不可选）；SelectedCourseId 不在可选列表时
  回落到本班课程、再回落到第一门可选课程。UI 上给本班课程加「· 本班课程」后缀，老师才知道默认选中的是哪门。
- **课次推荐**：`lessonNo = 该班该课程已归档课次数 + 1`，`topic = resolveSyllabusTopic(course, lessonNo)`
  （先查 syllabus，取不到回落 `defaultTopic`）。纯派生值，不要存进 state 再同步。
- 无班级 / 无可选课程时渲染空态卡片 + 「去学员管理添加班级」/「去课程库」入口，
  **不要渲染空 `<select>`**。

### 课次日期与课时序号（必填 + 二次确认 + 唯一性）

第一步的 `lessonDate / lessonNoInput`（US-404）是**必填**项，也是下游唯一的日期来源；面板变量是
`lessonScheduleField`（`main.jsx` 的 `TeacherFlowV2` 内），保存走 `performLessonSave`。

- **推荐值 + 手改共存**：序号既要有推荐值又要能手改，用「纯派生推荐值 + `lessonNoDirty` 标记 + 一个同步 effect」：
  `if(lessonNoDirty) return;` 才把输入框设成推荐值。用户一改就置真；**换班 / 换课时必须置回假**
  （`selectClass` / `selectCourse` 负责），否则新班级会沿用上一个班的序号。保存成功后置真，不能让推荐值把手填的值顶掉。
- **唯一键 `classId + lessonDate + lessonNo` 的检查要分两个集合**：冲突检查用「该日期其他课次」（排除
  `currentLessonId`，自己不算撞车）；但「该班该日期已有第 N 次课，是否创建第 N+1 次？」的提示与 N+1 建议要用
  「该日期全部课次」。混用一个集合会出现「建议的 N+1 已经是别条课次」或「把自己算成冲突」。
- **二次确认用「内联提示 + `lessonConfirm` 状态」**：`performLessonSave` 每次只检查一个条件
  （冲突 → 未来日期 → 同日已有课次），不满足就 `setLessonConfirm({kind,message,action})` 并 return；
  确认按钮按 kind 置对应的 `*Confirmed` 标记后**再次**调用保存，于是条件会链式逐个确认。
  换日期 / 换序号要清掉这些标记，否则「确认」会被错误地复用到新的日期上。
- 未来日期（预排课）与同日已有课次都属二次确认项，`browser_type` 可以直接填 `<input type="date">` /
  `<input type="number">` 来验证（与原生 `<select>` 不同，见下节）。

### 参与学员与出席状态（US-405）

第一步的出席名单面板变量是 `participantField`，数据是 `participants`
（`[{studentId,name,attendance,artworkIds,photoIds,temporary}]`，`createParticipant()` 产出）。

- **`participants` 只描述本次课次，不回写班级名单**：班级名单在 `data/studentManagement.js`
  （`persistStudentManagement`）。临时加入插班/试听学员时只 `setParticipants`，**绝不要调 `persistStudentManagement`**，
  否则一次试听就被写进班级永久名单。
- **缺课学员必须留在 `participants` 里**（`attendance='absent'`），不能过滤掉：成长档案要用它生成缺课留白，
  删掉就等于「这个孩子没来过这堂课」这件事实消失了。
- **两种模式的参与者来源不同**：班级反馈 = `participants` 的勾选状态；个人反馈 = 选中的那一位
  （`effectiveParticipants` 纯派生，`participants` 里没有就临时 `createParticipant` 一个）。两者共用同一个
  `participants` state，所以切换模式走 `selectMode()`（清临时输入与拦截提示），不要再写 effect 同步。
- **「全选 / 反选」只作用于本班名单，临时学员要显式保留**（`current.filter(item=>item.temporary)`）：
  第一版 `全选` 直接 `setParticipants(rosterParticipants(classStudents))`，把老师刚加的临时学员顺手清掉了。
  只有「清空」才清掉全部。
- **换班 = 换名单**：`selectClass()` 里 `setParticipants(rosterParticipants(nextStudents))` 重建（默认全部出席），
  临时学员不跨班保留。`rosterParticipants(students, previous)` 会保留已有出席标记，避免重算时抹掉刚标的缺课。
- **进入下一步的门槛放在 `go()` 里**，不要只把按钮 `disabled`：
  disabled 的按钮没法说明「为什么不能走」。US-410 起这六项校验统一由 `data/lessonReadiness.js` 判定
  （见下节「进入下一步的前置校验」），**原因文案与拦截都读那一份结果**，这里不要再单独维护一份；
  全部缺课/名单为空时仍要保留「保存课次」这条独立动作（老师可以先存草稿）。
  到场口径 = 出席 + 补课，只有「一位到场的都没有」才拦。
- 保存课次时 `participants` 直接进 `performLessonSave` 的 patch，由 `createEmptyLesson` → `normalizeParticipants`
  收敛；`temporary` 也在 `createParticipant` 里归一化，因此插班学员不会在往返中丢掉标记。

### 上传素材与学员的绑定（US-406a）

素材归属走 `src/data/uploadBinding.js`（纯函数，无依赖，可直接用 Node 跑）：

- **绑定发生在上传那一刻，且只由绑定数据决定展示**：`bindFilesToParticipants()` 把这一批文件按
  「到场学员 × 每人上限」的**轮转**空位顺序补齐，结果写进条目本身（`studentId` / `studentName` / `title`），
  并通过 `applyUploadBindings()` 把 `uploadId` 记进 `participant.artworkIds / photoIds`。
  展签、成长档案、海报一律用 `uploadPlaque()` / `withUploadPlaques()` 读这份绑定。
- **绝不允许顺序推断姓名**：`students[index % students.length]` 这种写法在素材份数多于学员数时会把同一个孩子的作品
  算到别人名下（学员数一变就整体错位）。份数超过空位时条目保持 `studentId === ''`，界面显示「未绑定学员」
  （CSS 类 `figcaption.unbound`），**宁可留白也不猜姓名**。`US-406b` 会把它升级成「学员乘上传位」列表。
- 每条素材的主键 `uploadId` 是随机唯一 id（`makeUploadId()`），不能用「学员 + 文件名」派生：
  同一位学员交两张同名照片会被当成同一条。
- 「到场」口径与 US-405 一致（出席 + 补课）；**缺课的孩子不占作品位**（`attendedParticipants()`）。
- 展签日期一律用 `formatLessonDateDots(lessonDate)`（`data/lessons.js`）取课次日期：
  写死 `2026.08.11` 或用 `new Date()` 会让补录的上节课显示成今天。展签上的作品名在 US-406a 阶段默认取本次课题
  （`lessonTopic`），US-406b 起由老师逐幅填写。
- **展签日期只有两个来源，缺一不可**（[第二步到第一步联通] US-014）：**值** = 本次课次日期
  `lesson.lessonDate`（`main.jsx` 的 `plaqueDateText = formatOverlayDate(lessonDateDots, …)`，**没有
  `new Date()` 兜底** —— 课次日期为空时干脆不印日期行），**写法与位置** = 模板的
  `spec.plaque.dateFormat`（`DATE_FORMATS` 三选一，由 `frameSpecRenderView()` 暴露成 `plaqueDateFormat`）
  + `spec.plaque.position`。装裱模板（含云表 `plaque_date` 列）**结构上不再承载日期值**：
  `normalizeFramingPreset` 会把老记录的 `plaqueDate` 剔除，界面与面板都没有日期值输入框。
  改这一层要三处一起动，少一处的表现是「日期还是旧的写法 / 还是归档当天」：
  ① `frameSpecRenderView` 带上 `plaqueDateFormat`（顺带进渲染缓存键，少了会串图）；
  ② 所有渲染入口传 `date: formatOverlayDate(lessonDateDots, plaqueDateFormat)`
  （单幅 / 批量 / 相框缩略图 / 后台预览 / 第三步那份回落到 DOM 的展签文字）；
  ③ `data/framingPanel.js` 的覆盖矩阵与后台「展签」分组各补一个 `plaque.dateFormat` 控件，
  否则 `framingPanelMissingFields()` 当场变红。
- 上传后的提示语要说清绑定结果（几份已绑定 / 几份未绑定）：`readFiles()` 里 `readFile()` 是**异步**的，
  它成功/失败后还会再弹一条 toast，所以绑定提示必须放在 `readFile(...).finally(...)` 里最后说，
  否则老师只看到「已在本地预览」，看不到「有 1 份没绑定」。

### 学员乘上传位列表（US-406b）

班级反馈的作品不再是「一次选多份再轮转分给学员」，而是**一人一行、每行一个文件选择框**
（`artworkSlotField`，`main.jsx` 的 `TeacherFlowV2` 内）。领域逻辑全在 `data/uploadBinding.js` 里，展示层只渲染：

- `bindFilesToStudent(files, participant, {existing, participants})`：在谁的格子里选的文件就绑给谁，
  **不做任何轮转/分配**；超过每人上限（作品 `UPLOAD_SLOTS_PER_STUDENT.artwork = 5`）的份数被忽略并回报
  `ignored`，界面提示「已忽略 N 幅」。轮转版 `bindFilesToParticipants` 只留给「一次选多份、没指定学员」的
  路径（课堂照片，US-009 接手），不要把作品接回那条路。
- `participantSlotUsage` / `uploadsOfParticipant` 负责「已上传 X/5 幅」与缩略图列表；`updateUploadEntry`
  逐幅改作品名；`removeUploadEntry` 必须配 `detachUploadBinding` 一起用（条目与 `participant.artworkIds`
  同时摘掉，否则留下悬空 id，展签/成长档案会按它去认人）。
- **作品名默认留空**，靠 `withUploadPlaques({fallbackTitle: lessonTopic})` 回落本次课题；
  「把本次课题套用为作品名」走 `applyDefaultTitles(..., {onlyEmpty: true})`，**只填空标题** ——
  老师手填过的名字不能被一次批量动作覆盖。
- 顶部计数用 `participantsMissingUpload`（只数到场学员）；**要渲染的行用 `uploadSlotParticipants`**：
  到场学员 ∪「已上传过素材但被标成缺课」的学员。少了后半边，那份素材在界面上就再也改不了名、删不掉。
- 隐藏的 `<input type=file>` 按 `studentId` 存进 `artworkSlotInputs` 这个 ref map（不要用行号，删行/换班后错位）；
  选完必须 `input.value=''`，否则同一位学员再选同一批文件不会触发 `onChange`。
- **换班要清素材上下文**：`selectClass()` 里连 `batchUploads` 与 `media` 一起清空并提示「请在新班级重新上传」。
  上一个班的作品绑的是那个班的孩子，带过来只会让展签显示别人班的孩子。
- 个人反馈仍是**单一上传位**（`media.artwork`），但归属不再靠「当前选中的是谁」推断：
  `readFile(kind, file, {studentId, studentName})` 把绑定写进 media 对象，摘要显示「已自动绑定 X」。

### 课堂照片按学员绑定与「共用素材」（US-009）

课堂照片与作品**是两条独立的素材线**（各自一套上传位、各自的上限与字段），不要互相复用配置：

| | 作品 | 课堂照片 |
|---|---|---|
| 面板 | `artworkSlotField` | `photoSlotField` |
| 上限 | 1–5 幅/人（必填） | 0–10 张/人（**选填**） |
| 参与下一步校验 | 是（US-410 的六项之一，见下节） | **否** |
| 字段 | `participant.artworkIds` | `participant.photoIds` |
| 界面 | 班级反馈一人一行；个人反馈单一上传位 | 仅班级反馈一人一行；个人反馈仍是 `media.photo` 单张 |

- 上限从 `UPLOAD_SLOTS_PER_STUDENT` 取（`maxSlotsPerStudent(kind, override)`），**不要在各处写死数字**。
- **归属是一份「归属者列表」而不是单个 studentId**（US-009 起）：条目上是 `owners: [{studentId, studentName}]`，
  `studentId` / `studentName` 保留为**第一位归属者**（向后兼容旧条目与旧调用方）。判断归属一律走
  `entryOwnsParticipant(entry, participant)` 或 `uploadsOfParticipant`，**不要自己写 `item.studentId === ...`**，
  否则一张全班合影只会算在第一位学员名下。
- 三个入口，别混用：
  1. 「一人一行各选各的」→ `bindFilesToStudent`（不做轮转）；
  2. 「一张合影一次分给全部到场学员」→ `bindSharedFiles`（默认只分到场学员，满上限的学员进 `skipped`）；
  3. 「改某一张的归属」→ `setUploadOwners(items, uploadId, targets)`，**整体替换**归属。
- **改归属后必须用 `syncUploadBindings(participants, items, kind)` 重建 id 列表**，不能只靠
  `applyUploadBindings`（它只追加）。否则取消分配后 participant 上会留下指向那张照片的悬空 id，
  展签/成长档案会按它去认人。**以「本次会话的条目列表」为唯一真源整体重算**，天然不会悬空。
- 上限是**每位学员**的名额：一张共用照片会同时占用每一位归属者的名额，所以 `bindSharedFiles` /
  `setUploadOwners` 都会跳过已满的学员并回报（`skipped` / `rejected`），由界面提示老师。
- **「未归属」的照片必须仍然可见**：`photoSlotField` 里用 `unassignedPhotos`（没出现在任何学员行里的条目）
  渲染一个「还没有归属的照片」区，仍然能「分给多人」或「移除」。少了这块，一次「取消全部分配」就会让
  照片在界面上彻底消失、删都删不掉（`uploadsOfParticipant` 不再匹配任何行）。
- **分配面板的候选学员 = 到场学员**，勾选状态用 `participantKey(item)`（`studentId || 'name:'+姓名`）标识，
  **不能用行号** —— 勾选过程中名单顺序一变就选错人。换班 / 切模式要清掉 `photoAssignId` 与勾选集合。
- 后续步骤一律用 **`participantPhotoGroups(participants, items)`** 分组渲染（**包含没有照片的学员**，
  `uploads` 为空 = 占位）。把已上传的照片铺平会让顺序整体前移，看起来像是别人家的照片。
- 第三步的照片墙读 `item.plaque`，所以分组必须传**带展签的条目**（`withUploadPlaques(...)` 的产物），
  不能传 `batchUploads.photo` 的原始条目 —— 否则共用照片会退化成只显示第一位学员的姓名、也没有「共用」标记。
- 照片按学员分组后，**旋转要按 `uploadId` 定位**（`rotateUploadEntry`），不能用序号：同一张合影会出现在多行里，
  序号不等于 `batchUploads.photo` 的下标。同理，共用照片在多行里出现时，React `key` 要带分组前缀
  （`participantKey(participant) + '-' + uploadId`），否则会报重复 key。

### 上传校验与素材隐私（US-408）

准入规则集中在 `src/data/mediaValidation.js`（**零依赖纯函数，可直接 Node 跑断言**），
浏览器侧的执行（解码、canvas 降采样、object URL 回收）在 `src/services/mediaIntake.js`。

- **规则只有一份，展示层不许再写死数字**：格式白名单 `MEDIA_MIME_WHITELIST`（JPEG / PNG / WebP）、
  单张 `MAX_MEDIA_BYTES`（10MB）、长边 `MAX_LONG_EDGE`（3000px）。数量上限（作品 5 / 照片 10）的唯一真源
  仍是 `uploadBinding.js` 的 `UPLOAD_SLOTS_PER_STUDENT`，界面文案用 `mediaRulesText(UPLOAD_SLOTS_PER_STUDENT)`
  拼出来。**改任何上限只改这两处常量，不要在 JSX/提示语里写死「5 幅」「10 张」**。
- **一次选择要「逐份」判定，不合格的不能拖累整批**：`screenMediaFiles(files)` 返回
  `{accepted, rejected, message}`，`message` 是可读的跳过原因汇总（最多列 3 个文件名 + 总数）。
  老师一次选 5 张、其中 1 张超限时，其余 4 张照常进入绑定。旧实现是「只校验 `files[0]`、命中就 return」，
  批量选择时后面的文件根本不检查 —— 别退回那种写法。
- **所有选文件的入口都要先过 `prepareSelectedFiles()`**（`main.jsx` 的 `TeacherFlowV2` 内）：
  它做 ① `screenMediaFiles` ② `resolveMediaTypes`（空 MIME 按扩展名补，`image/jpg` 归一成 `image/jpeg`）
  ③ `downsampleImageFile` 逐份降采样。四个入口 `readFiles` / `readStudentArtwork` / `readStudentPhoto` /
  `readSharedPhotos` 全部是 async，**绑定与 `readFile` 都要用 `intake.files`，不能用原始 `fileList`**。
- **降采样只对长边 > 3000px 的图做**（`downsamplePlan` 纯计算）：不超过就原样返回，不重新编码。
  超过就等比画到 canvas 再 `toBlob`（PNG 保持 PNG，其余走 JPEG 质量 0.92），文件名保留。
  解码失败按「无法读取」拒收并给可读文案，**不要**悄悄退回上传超大原图。
- **`readFile` 里的校验是最后一道守卫**（直接调用时也要挡住），不要再在它里面写第二套白名单/体积判断。
- **素材只在当次会话有效**：条目的 `url` 一律是 `URL.createObjectURL(file)`。
  - 持久化草稿**必须**走 `buildSessionMediaDraft(media)`（只留 `id/name/type/size/storage`），
    它会把 `url/originalUrl/cleanUrl/framedUrl` 全部剔除（那些可能是 `blob:`，也可能是 canvas 产出的
    `data:` base64 = 图片本体）。**不要在别处再拼一份「瘦身版 media」**。
  - 条目被移除 / 换班 / 新建草稿时要 `revokeMediaUrl`（只回收 `blob:`）—— `removeArtwork` /
    `removePhoto` / `selectClass` / `resetDraft` 都已经接上，新增删除路径时别漏。
  - 归档记录落盘前用 `stripSessionMediaUrls()` 清掉 `blob:`（`data:` 归档成品保留）：
    object URL 刷新即死，写在 localStorage 里只是一条指向不存在素材的垃圾地址。
- **「刷新后素材失效」的提示要在挂载那一刻就把上次的媒体元数据读出来**：
  `const [lastSessionMedia]=useState(()=>readSessionMediaSnapshot())`（US-409 起，素材痕迹单独一条键；
  之前是 `savedDraft()?.media`）。
  写成 `const draft=savedDraft()` 再在渲染里读是**错的** —— 草稿写入 effect 一挂载就会用当前（空）的
  media 覆盖 localStorage 那条记录，读到的永远是空。`lostSessionMedia = 上次有素材 && 本次没有`，
  文案必须含「请重新选择原始素材」（US-408 的验收原文）。
- **已知边界（有意为之）**：US-408 只保证**上传会话**不落浏览器存储。归档后的成品图
  （`feedbackRecords.js` 的 `artworkUrl`，通常是 canvas 产出的 `data:` URL）仍会进 localStorage —— 那是
  成长档案的正式内容，它的存储策略属于归档 / 成长档案那组故事；改这里要先看那组故事的验收，不要顺手清空。
- 验证方式（本轮实测）：Node 直跑 `data/mediaValidation.js` 76 项断言；CDP 浏览器 33 项断言
  （真实 `DOM.setFileInputFiles` 选 3600px 大图 / 400px 小图 / PDF / 11.9MB 超限图，观察点：
  `img.naturalWidth` 是否 3000、计数是否 5/5 与 10/10、`localStorage` 里有无 `blob:`/`base64`、
  `indexedDB.databases()` 是否为空、刷新后 `.intake-media-lost` 是否出现）。

### 课后反馈草稿：只存元数据与恢复（US-409）

草稿的读写全部在 `src/data/feedbackDraft.js`（纯逻辑 + 一个显式 `.js` 扩展名的 import，
所以在 Node 里也能直接跑断言）；`main.jsx` 的 `TeacherFlowV2` 只负责把状态喂进去、把草稿读回 state。

- **两条 localStorage 键，不要合并**：
  - `xinlehui-feedback-draft-v2`（`FEEDBACK_DRAFT_KEY`）= 草稿本体，**只含元数据**：
    `version / savedAt / step / classId / courseId / lessonDate / lessonNo / topic / participants / artworkTitles`。
    字段清单的唯一真源是 `FEEDBACK_DRAFT_FIELDS`（断言直接用它对键）。
  - `xinlehui-feedback-session-media-v2`（`FEEDBACK_SESSION_MEDIA_KEY`）= 会话素材痕迹
    （只留 `id/name/type/size`），用来判断「上次选过素材、这次失效了」（US-408 的横幅）。
    素材相关字段**绝不能**进草稿键 —— 验收要求草稿 JSON 里不含图片本体 / object URL / base64。
- **草稿里不允许出现素材**是靠两层保证的：`buildFeedbackDraft` 只复制已知标量字段（结构上没入口），
  `persistFeedbackDraft` 再用 `containsMediaPayload` 兜底拒绝。改字段时两层都要过一遍。
- **版本号对不上就忽略草稿**（`Number(raw.version) !== FEEDBACK_DRAFT_VERSION` → 返回 null），
  不做半成品迁移；JSON 读坏 / localStorage 抛错 / 结构不是对象，一律返回 null，
  调用方（`useState(()=>readFeedbackDraft())`）按初始态继续。**读写永不抛错**是硬约定。
- **草稿快照只在首次渲染读一次**（`const [initialDraft]=useState(()=>readFeedbackDraft())`）：
  写草稿的 effect 一挂载就会覆盖那条记录，读晚了永远看不到上次的草稿（与 US-408 的 `lastSessionMedia` 同一坑）。
- **恢复不留悬空引用**：草稿里的 `participants` 把 `artworkIds/photoIds` 显式清空（素材条目刷新后已不存在），
  读回来时统一走 `createParticipant()` 归一化。
- **`mode` 不进草稿**，而是由 participants 的不变量推导：`draftMode()` —— 个人反馈的
  `effectiveParticipants` 至多一位，多于一位就是班级反馈。`draftSelectedStudent()` 同理（只有一位时就是所选学员）。
- **写入前先判断「有没有值得恢复的内容」**（`main.jsx` 的 `draftHasContent`）：什么都还没动的初始态不写草稿，
  否则「新建草稿」之后 localStorage 里又会立刻多出一份初始值。判据是「和初始态不一样」：
  `step>1 / 已保存课次 / 序号手改过 / 日期非今天 / 班级非默认 / 参与学员与班级名单不同 / 有素材`。
- **恢复时的 step**：素材随刷新失效，`step>1` 的草稿回到第一步（`resolveRestoredStep`），
  提示条里用草稿里存的 step 原文说明「上次进行到第几步」。
- **恢复时按自然键找回课次 id**：`currentLessonId` 不持久化（不在字段清单里），改为按
  `classId+lessonDate+lessonNo` 从本地 `lessons` 里查回来，否则刷新后保存同一个自然键会被自己的记录判成冲突。
- **作品名可以填回**：`artworkTitles` 按「学员 + 顺序」对位（`applySavedTitles`），**只填空标题**；
  填回的条目要从待填队列里扣掉（`titles` 返回值），否则同一位学员的第二批素材会再领一遍同样的名字。
- **恢复提示条的文案是验收原文**：`.intake-draft-restored` 的 `<b>` 必须含
  「已恢复上次的课次信息；素材需重新选择」（`.intake-media-lost` 是 US-408 的另一条提示，两条并存不要合并掉）。

### 进入下一步的前置校验（US-410）

第一步 → 第二步的六项必填（班级 / 课程 / 课次日期 / 课时序号 / 至少一位出席学员 / 至少一幅作品）
由 `src/data/lessonReadiness.js` 的 `evaluateIntake()` 统一判定。**零依赖纯函数**（不 import 任何模块），
所以能直接 `node /tmp/xxx.mjs` import 它跑断言。

- **规则与文案只有一份**：`INTAKE_CHECK_ORDER` / `INTAKE_CHECK_LABELS` 是校验项清单，
  缺项的具体原因（「还没有上传任何学员作品：请在…」）也在同一个文件里。
  界面的校验清单（`intakeReadinessPanel`）、`go()` 的拦截、按钮的 `disabled` 全部读
  `intakeReadiness`（`main.jsx` 里由 `evaluateIntake({...})` 得到的派生值），
  **不要**在 JSX 或 `go()` 里再写一份 `if (!xxx)` 判断，否则会出现「按钮说不行、其实能走」的漂移。
- **按钮 `disabled` 与「说清原因」要同时做**：disabled 的按钮没法解释为什么不能走，所以原因必须
  渲染在按钮旁边的 `.intake-readiness` 清单里（验收明确禁止笼统的「请完善信息」）。
  `go()` 里再拦一道是给**顶部流程导航**（`FlowStepper` 也能直接调 `go()`）兜底。
- **校验失败必须「一个 state 都不改」**：`go()` 在 `intakeReadiness.ok` 为假时立刻 `return`，
  不能 `setStep`、不能碰 `media`；否则「不跳步、不丢失已填内容」就不成立。
- **保存草稿与进入下一步是两个独立动作**：「保存课次」只受 `!activeCourseId` 与 saving 影响，
  **不要**把 `intakeReadiness.ok` 加进它的 `disabled`。校验不通过时老师仍要能把课次存成草稿
  （这是 US-405/US-410 一致的诉求）。
- **作品数按模式取不同的源**：班级反馈数 `batchUploads.artwork.length`（乘上传位里的绑定条目），
  个人反馈只有 `media.artwork` 一个上传位（`hasUploadedArtwork ? 1 : 0`）。
  照片**永远不参与**这六项校验（US-009 的选填口径）。
- `FlowStepper` 的 `flags[0]` 用 `intakeReadiness.ok`（不再只是 `hasUploadedArtwork`）：
  第一步只有六项都齐了才在顶部导航上显示「已完成 / 可点击回看」。
- 校验清单在第一步**最底部**（`.scene-actions` 之前）；浏览器截图要先把 `.intake-readiness`
  `scrollIntoView({block:'center'})`，否则截到的是视口顶部、看不见这张卡片。
- 验证方式（本轮实测）：Node 直跑 `data/lessonReadiness.js` 31 项断言；CDP 浏览器 54 项断言
  （逐项去掉作品 / 出席 / 日期 / 序号，走管理端「课程库」停用全部课程验证「课程」一项，
  覆盖截断路径、`disabled` 按钮真实点击、顶部导航点击、以及「保存课次」在两种校验状态下的可用性）。

### 家长授权状态提示与授权状态来源（US-411 / F-CONSENT-01）

`src/data/consent.js` 是**家长授权状态的唯一来源**（零依赖纯函数 + 一条 localStorage 兜底键）：
第一步的「未完成查看授权」提示（US-411 / F-INTAKE-CONSENT-01）与第四步转发前的硬校验
（US-208 / FR-222，同一份来源是它的验收之一）都必须从这里读，不要在各自的组件里再写一套判断。

- **「查看授权」只影响转发，不影响录入**：授权是「把作品/点评分享给家长」的前置条件。所以第一步的提示
  **不加进 `lessonReadiness.js` 的六项校验、不进 `go()` 的拦截、不 disable 任何按钮** ——
  老师可以先录完、先归档，家长授权后再转发（US-411 + US-410 的共同口径）。
- **提示算的是「所选学员」**：用 `effectiveParticipants`（个人反馈 = 选中的那一位，班级反馈 = 勾选名单），
  不要用 `classStudents` 全班名单，否则个人反馈会提示到别人家的孩子。
  有未授权学员时渲染，全部已授权时不渲染（US-411 的「避免噪音」）。
- **fail-safe 方向**：没有授权记录的学员（临时加入的试听学员、新登记的学员）按**未完成授权**算，
  记录里的 `viewAuthorized: true` 也不能把 `status: 'revoked'` 顶回已授权。宁可多提示一次，
  也不能把没有授权的孩子转发出去。
- **提示文案分口径**：`consentSummaryOf().message` 在只有待完成时是验收原文
  「N 位学员的家长尚未完成查看授权，发布后可能无法转发」；存在**已撤回**的记录时换成
  「…尚未完成查看授权或已撤回授权…」（撤回不等于「尚未完成」，不能糊成同一句）。
- 面板变量是 `consentNoticeField`（`main.jsx` 的 `TeacherFlowV2` 内），默认折叠只给一句摘要 + `查看是哪 N 位`，
  展开后逐条列姓名 / 状态 / 监护人；入口只有一个「去授权管理」（`navigate('authorization')`，
  目标是既有的 F-CONSENT-01 页面）。CSS 在 `flow-v2.css` 的 `.intake-consent*`（提醒色，不用错误色）。
- 入口指向的授权管理页目前仍是家长侧的静态卡片（PRD-16 / F-CONSENT-01）；**老师端在这页登记/补授权**
  属于 `prd-archive-share.md` 的转发与审计故事（US-208 / US-211），本轮没有改它，
  授权状态模块只提供读接口（`loadConsents` / `consentSummaryOf` / `unauthorizedParticipants`）。
- 验证方式（本轮实测）：Node 直跑 `data/consent.js` 59 项断言；CDP 浏览器 27 项断言（见下节脚本要点），
  覆盖「个人反馈默认不提示 / 班级反馈 2 位 / 展开只列未授权者 / 入口跳转 / 上传作品后提示仍在且可进入第二步 /
  保存课次照常 / 只剩已授权学员时提示消失 / 390px 单列与 44px 按钮」。

### 录入页移动端与性能（US-413）

规则与派生值在 `src/data/intakePerformance.js`（零依赖纯函数，可直接 Node 断言），
浏览器侧的执行（解码、canvas、空闲调度）在 `src/services/mediaIntake.js`。四件事各只有一份真源：

| 关注点 | 常量 / 纯函数 | 执行点 |
|---|---|---|
| 缩略图长边上限 320px | `THUMBNAIL_MAX_EDGE` / `thumbnailPlan()` | `mediaIntake.createThumbnail()` |
| 生成不阻塞输入 | — | `mediaIntake.scheduleMediaTask()`（`requestIdleCallback` → `setTimeout` 兜底） |
| 20 人以上按出席折叠 | `ROSTER_GROUP_THRESHOLD` / `shouldGroupSlotRows()` / `groupSlotRows()` | `main.jsx` 的 `IntakeSlotGroups` |
| 可点区域 44px | `TAP_TARGET_MIN` | `flow-v2.css` 的 `@media(max-width:430px)` |
| 18 位 ≤ 3 分钟 | `INTAKE_TARGET_SECONDS` / `intakePaceSummary()` | 第一步的 `.intake-upload-perf`（带 `data-intake-*`） |

- **列表只渲染缩略图，绝不渲染原图**：条目进 state 时 `thumbUrl` 为空，列表先渲染
  `INTAKE_THUMB_PLACEHOLDER`（8x8 透明 SVG），缩略图生成完再回填 `thumbUrl`。
  拿原图当占位（哪怕只是「等一会儿」）会把 22 张 3000px 原图同时拉进解码队列，正是本故事要避免的。
- **缩略图必须异步**：`scheduleThumbnails(kind, entries, files)` 在 `setBatchUploads` **之后**调用，
  用 `entries[i] ↔ files[i]` 顺序配对（绑定函数按传入顺序产出条目），回调里只用
  `updateUploadEntry(list, uploadId, {thumbUrl})` **回填这一条**。四处上传入口都要接上：
  `readFiles`（班级分支）/ `readStudentArtwork` / `readStudentPhoto` / `readSharedPhotos`。
- **两个 object URL 都要回收**：`revokeMediaEntries` 同时回收 `url` 与 `thumbUrl`；单条移除路径
  （`removeArtwork` / `removePhoto`）也要各回收一次。缩略图生成完时条目已被移除（换班 / 移除）的，
  回调里要先把刚生成的地址回收再 return，否则漏一份内存。
- **`createUploadEntry` 是字段白名单**：新增条目字段（如 `thumbUrl`）必须同时加进它 ——
  `updateUploadEntry` 内部走 `createUploadEntry` 重建，白名单外的字段会被静默丢掉。
- **`thumbUrl` 不进持久化**：它不在 `mediaValidation.js` 的 `DRAFT_MEDIA_FIELDS` 里，结构上就进不了草稿；
  它和 `url` 一样是会话内 object URL，刷新即失效。
- **分组阈值看「渲染出来的行数」**：`artworkSlotRows` = 到场学员 ∪「有素材却被标成缺课」的学员，
  所以给缺课学员传过作品后，即使出席人数掉到 20 以下，行数仍可能超过阈值 → 仍然分组
  （缺课组里的素材因此还能改名/删除，不会消失）。不超过阈值时 `IntakeSlotGroups` 原样平铺（US-406b 行为）。
- **录入用时不用定时器**：`intakeStartedAtRef`（进入流程那一刻）+ 素材每次变化时 `noteIntakeProgress()`。
  用 `setInterval` 每秒 `setState` 会让整个第一步（几百个节点）每秒重渲染一次，与性能诉求相反。
- **390px 的 44px 下限是 CSS 里的兜底**：`@media(max-width:430px)` 对 `.feedback-flow-v2` 下的
  button / select / input 统一 `min-height:44px;min-width:44px`（checkbox 22px，但它的 `<label>` ≥44px）。
  CSS 不能 import 常量，**改 `TAP_TARGET_MIN` 必须同步改 `flow-v2.css`**。
- **底部主操作栏是 sticky，toast 要让开**：`.scene-actions` 在 ≤430px 固定到屏幕底部（两个次要动作并排、
  主操作独占一行）；`.toast` 同时抬到 `bottom:124px` —— 否则它会盖住「进入智能装裱」并吃掉那一下点击。
- 验证方式（本轮实测）：Node 直跑 `data/intakePerformance.js` + `uploadBinding` 的 `thumbUrl` 往返共 **81 项**断言；
  CDP 浏览器 **44 项**断言（22 人班级 → 分组折叠、缩略图 pending→ready 的 MutationObserver 轨迹、
  22 位学员各 1 幅实测 3 秒 / 界面用时 9 秒、扫描 157 个可点元素的 44px、toast 不遮挡主操作、进入第二步）
  + 桌面端 3 人回归 **7 项**断言。

### 浏览器验证原生 `<select>` 的坑（重要）

DSH 的 `browser_*` 工具**没有 selectOption 能力**：`browser_type` 走的是 `locator.fill`
（对 `<select>` 直接报 "not an <input>"），headless 下点击会打开原生弹层、`ArrowDown` / `Space` / `Enter` / 滚轮
都不会改变受控 `<select>` 的值，`option` 元素也永远 not visible 点不到。
验证下拉相关需求时：用 `browser_evaluate` **只读**读取 `select.value / select.options`（读取允许，改状态不允许），
状态变化则通过真实的按钮/文本输入去制造（例如在「学员管理」里编辑班级的任课老师，再回「课后反馈」观察班级列表过滤）。
不要在验证里用 `browser_evaluate` 触发 change 事件或写 localStorage。
**例外**：`<input type="date">` / `<input type="number">` 可以用 `browser_type` 正常填充并触发 onChange，
日期、序号一类的验收直接填就行，不需要绕路。
本地兜底数据（`xinlehui-lessons-v1` 等 localStorage 键）会在验证时被写入；验证完想回到种子数据，
删掉对应键再刷新即可（`loadLessons()` 在本地为空时返回 `seedLessons`）。

**想验证「刷新后档案里的图仍能显示」这类跨刷新断言，先找一个刷新后仍然到得了的页面**（US-203 真踩）：
老师侧边栏**没有**「成长档案」入口（`archives` 只能从第四步或更新 toast 的「查看档案」进，都是会话内的），
刷新后到达不了；可行的老师端档案页面是「学员管理 → 学员 → 课程记录」（`StudentArchiveData`，读同一条
`record.media`）。管理端页面（如「档案管理」）可以用顶栏 `.role-switch` → `.role-menu button` 切身份到达，
不要点登录页（那是退出登录后再登录，会丢掉会话内的流程状态）。

## 管理端页面（admin）的接线与写入约定

新增一个管理端页面要**同时**改三处，缺一处就出问题（见 `CourseLibraryPage` / `FramingSettingsPage`）：

1. `main.jsx` 的 `navByRole.admin` —— 侧边栏入口；
2. `main.jsx` 的 `ADMIN_ONLY_PAGES` —— 非管理员访问时兜底回自己的工作台（导航里没有不代表访问不到）；

   只加导航不加这个数组，老师/家长仍能通过历史链接或导览页进来。
3. `main.jsx` 的 `PageRouter` 的 `map` —— 真正的页面映射。

页面本体放在 `src/admin/<Name>.jsx`，通过 `{...props}` 拿到 `courses / setCourses / lessons / setToast` 等；
展示原语从 `../ui` 取（`PageHeader` / `Button` / `Status`），布局复用 `styles.css` 的 `.split-page` 与
`persona-framing.css` 的 `.persona-list` / `.persona-editor` / `.persona-field`，不要另造一套。

- **写接口抛错时也要更新 state**：`save<X>` 是「先写本地镜像再推云端」，云端不通时会 throw，
  此时本地镜像其实已经落盘。调用方必须在 `catch` 里仍然把这条记录并进 React state，
  否则下一次 `persist<X>` 会用不含它的旧列表把本地镜像覆盖掉 —— 表现就是「保存成功，一刷新就没了」。
  表单校验（必填、同名）要在调用前自己判一遍，好把「填错了」和「云端没同步」分成两条提示。
- **引用范围提示要按各自的关联方式分别数**：课次持有 `courseId`，班级持有课程名（见 `class.course`），
  删除前提示「有 N 个课次引用」时两种都要查，不能只看 id 相等。
- 「新建」在点击保存前**不要**先塞进受控列表：`main.jsx` 的 `persist<X>` effect 会把 state 立刻落盘，
  半成品（没名字的课程）就会活过一次刷新。用 `isNew` 之类的外部草稿，保存成功后再并入列表。

## 相框样式选择器：样式库 / 微调 / 缩略图（US-006）

老师在第二步挑样式的那块面板（`main.jsx` 的 `TeacherFlowV2` 里变量名 `frameStylePanel`）。
三块拼图各只有一份真源：

| 关注点 | 位置 | 说明 |
|---|---|---|
| 样式库（内置 ≥8 套 + 八种长相对照表） | `data/framingPresets.js` 的 `seedFramingPresets` / `FRAME_STYLE_LOOK_PRESETS` | 内置样式是**随代码发布的资产**，spec 由 `builtinSpec()` / `styleSpec()` 构造 |
| 微调选项与叠加规则 | `data/frameStyles.js`（零依赖，可 Node 直跑） | 形状 / 材质色 / 框宽 / 卡纸开关 / 卡纸色 + `applyFrameStyleTweaks` |
| 缩略图渲染 | `services/frameThumbnails.js` | 调**同一个** `renderFramedArtwork`（1800×1360）再缩到长边 ≤320 |

- **微调不改模板、不进草稿**：老师对所选样式的调整只是「本次选用的一层补丁」
  （`effectiveFrameSpec = applyFrameStyleTweaks(activeFrame.spec, frameTweaks)`），
  不写回平台/机构/老师模板（模板写权限是 US-031「另存为我的模板」），也不进 `feedbackDraft`
  （草稿字段清单是 US-409 定的，加字段就违规）。切换款式会**重置微调**（微调属于那一套）。
- **没有微调时 `applyFrameStyleTweaks` 原样返回输入对象**（连对象都不换）：老模板的渲染一个像素不变。
  它只覆盖 `frame` / `mat` 两个分组 + `version`，其余分组（水印/落款/时间/展签）一个都不碰 ——
  混写结构在 `normalizeFrameSpecV2` 里本来就是合法输入。**换材质色必须连 `frame.lighting` 一起换**：
  色板条目自带 highlight / shadow，只换底色会在墨黑框上留下暖金高光。
- **渲染缓存键取「渲染视图」而不是模板 id**：`main.jsx` 第二步的 `activeFrameSpecKey` 现在是
  `frameSpecRenderKey(effectiveFrameSpec)`。用模板 id 当键时，微调改了 spec 却不改 id →
  成品图永远慢一拍（这是本故事最容易踩的坑）。
- **缩略图 = 真渲染的小图，不是另画一套便宜的预览**：`renderFrameStyleThumbnail()` 走完整
  `renderFramedArtwork`（与成品图同一条几何）再用 canvas 缩到 ≤320px，只把小图放进 state
  （1800px 的位图用完即弃，否则十来张全尺寸位图会把解码内存顶到几十 MB）。
  缓存键是 `frameThumbnailKey()`（渲染视图 + 作品地址指纹 + 展签变量 + 长边上限），
  串行渲染、逐张回填，**先出缩略图再出其它内容**的渐进体验靠卡片上的 CSS 预览兜底。
- **「缩略图用当前作品」在班级反馈下退化为第一幅已上传作品**（班级反馈没有单幅「当前作品」）；
  没有任何作品可渲染时卡片显示 CSS 近似预览（框色 / 框宽 / 卡纸色 / 形状），不是空白。
- **内置样式要会「补出来」**：`loadFramingPresets()` 合并本机镜像缺失的内置样式，
  云端读取路径（`main.jsx` 依赖 `[auth,role]` 那条 effect）也要走
  `mergeMissingFramingPresets(remote, 当前列表)` —— 本机的云端表就缺 `owner_key` 列、写不进去，
  只存着最早 4 套（读得出来、写不进去），只认云端列表的话新内置样式在真机上永远不出现。
  只补 **id 缺失** 的条目：既不用本机旧数据覆盖云端更新，也不会把管理端停用过的模板顶回启用。
- **验证要点**（本故事实测口径）：① 缩略图与成品图**同比例采样**几乎逐点一致（证明缩略图 = 这幅作品的渲染）；
  ② 用页面内原型补丁数 `getImageData` 调用与 `toDataURL` 的**画布尺寸**：
  裁剪路径才会 `getImageData`（`extractArtworkSurfaceDetails`），装裱路径只产出 1800×1360 ——
  「切换样式期间 `getImageData` 增量为 0 且没有非 1800×1360 的编码」就是「只重绘装裱、不重跑裁剪」的硬证据
  （只比 `cleanUrl` 字符串是**不够**的：同一份输入重跑裁剪切面会产出逐字节相同的结果）。
  ③ 想断言「点某个微调后成品图真的变了」，要选一个**与模板当前值不同**的选项 ——
  点成本身已有的颜色时渲染结果不变，等它变化会白等 40 秒。

## 水印 · 落款 · 时间面板（US-007）

老师在第二步调叠加元素的那块面板（`main.jsx` 的 `TeacherFlowV2` 里变量名 `overlayPanel`，
五张元素卡由 `overlayElementCards` / `overlayElementCard` 渲染）。三块拼图各只有一份真源：

| 关注点 | 位置 | 说明 |
|---|---|---|
| 面板规则（本故事的核心） | `data/lessonOverlays.js`（零依赖，可 Node 直跑） | 可改字段白名单 / 归一化 / 补丁合并 / 拖动换算 / 档位选项 / 课次默认值 |
| 位置枚举、标签、变量替换、时间解析 | `services/overlayLayout.js` | 绘制层与面板读同一份；本故事给它加了时间元素的 `lessonDate` 入口 |
| 素材上传准入 | `data/framingAssets.js` + `services/framingAssets.js` | 与后台 Logo / 签名图完全同一套（PNG/JPG、≤512×512、≤200KB） |

- **面板调整 = 本次选用的一层补丁**（与 US-006 的相框微调同口径）：不写回模板（模板写权限是 US-031
  「另存为我的模板」），也不进草稿（US-409 的草稿字段清单是硬约束，加字段就违规）。
  `effectiveFrameSpec = applyOverlayOverrides(frameStyleSpec, overlayOverrides)`，**没有改动时原样返回输入对象**
  → 老 v1 模板逐像素不变；有改动时只写 `watermark` / `signature` / `date` 三个分组 + `version`
  （混写结构在 `normalizeFrameSpecV2` 里合法，v2 分组优先、v1 平面字段兜底）。
- **「默认值就是对的」的落点**：时间元素 `source: 'lesson'` 读渲染入参 **`lessonDate`**（= 第一步的课次日期，
  `main.jsx` 传 `lessonDateDots`；`renderFramedArtwork` 的 `lessonDate` 缺省回落 `date`，所以老调用方一字不变）；
  落款姓名的 spec 默认值就是变量 `{老师姓名}`（渲染时替换成当前登录老师）。面板每支元素都有一行
  「渲染为 …」，用的是**与绘制层同一份** `applyOverlayVariables` / `resolveOverlayDateText` / `qrTargetSummary`
  —— 老师不必出图就知道变量会变成什么，浏览器断言也读这一行。
- **九宫格控件只有一个**：`OverlayPositionPad`（后台「装裱设置」与老师端面板共用）。点格子 = 定位（`onSelect`）；
  **在格子上按住拖动 = 改偏移**（只在对老师端传 `onOffsetChange` 时启用，后台沿用旧签名时行为一字不变）。
  拖动换算收在 `overlayDragOffsets`：拖过整块九宫格 = 0.3 偏移、方向取自 `resolveElementAnchor`
  （偏移正向朝画布内侧，所以贴右的格子往右拖 = 偏移减小）、|偏移| < 0.02 吸附成 0；
  以**按下那一刻的偏移**为基准算总位移（指针来回移动不漂移），位移 < 3px 仍算点击。
- **别让「点完格子什么都没变」**：点格子时若该元素关着、且开启后**真画得出来**（`overlayElementCanDraw`），
  顺手把它打开；画不出来的（没传 Logo / 内容是空的）只定位不开启，并用 `overlayElementBlockerText` 说明原因。
  「印章开」同理顺手打开落款（印章画在落款里，落款关着时它不会出现）。
- **实时预览没有「应用」按钮**：任何输入 → `overlayTweaks` → `effectiveFrameSpec` → 第二步装裱那段 effect
  （键是 `frameSpecRenderKey`）→ `media.artwork.framedUrl` 重画（个人反馈的预览就是这张成品图）；
  班级反馈没有单幅成品图，退化为「本班第一幅已上传作品」的实时渲染
  （`FRAME_PREVIEW_LONG_EDGE = 480`，与 US-006 缩略图共用 `frameThumbnailKey` / 同一个缓存 Map，
  maxEdge 与 lessonDate 都在键里，所以两边的条目不会撞）。
- **预览失败必须显式**（`overlayPreviewError` → 面板上「预览失败：…」）：本故事真踩过 ——
  预览渲染里引用了一个拼错的常量（`OVERLAY_PREVIEW_LONG_EDGE` vs 导入的 `FRAME_PREVIEW_LONG_EDGE`），
  `try/catch` 把 `ReferenceError` 吞掉，界面上只表现为「一直不出图」，控制台干净得像没事。
- **移动端是底部抽屉**：`.lesson-overlay-trigger`（桌面 `display:none`）打开 `.lesson-overlay-panel`
  （≤800px 时 `position:fixed` 的 bottom sheet，头/脚 sticky，九宫格 44×44px、按钮一律 ≥44px 高）。
- **验证要点**：① 拖动断言要**从目标格子中心按下**（按下即定位，方向按那一格算；从 pad 中心按下会选成
  middle-center，方向自然不同，期望值就不对）；② 期望值在页面内 `await import('/src/data/lessonOverlays.js')`
  用 `overlayDragOffsets` **独立重算**再比对；③ 「时间来源 = 课次日期」的像素证据：课次日期版与手填日期版
  在底部条带（y ≥ 1150）的指纹不同、切回课次日期后与前一版**逐字节一致**；④ 断言前先让成品图**稳定**
  （连续 3 次采样不变）再当基线 —— 否则会拿中间态当基线，得到「复位后与基线不一致」这种假失败。

## 保存图片：两档导出与保存路径（US-008a / FR-25 / FR-26）

第二步「保存图片」把成品图导出成两个**不同的分辨率口径**，规则全部集中在
`src/data/artworkExport.js`（零依赖纯函数），执行在 `src/services/artworkExport.js`：

| | 高清 PNG | 微信 JPG |
|---|---|---|
| 格式 / 质量 | `image/png` 无损 | `image/jpeg` 质量 0.85（超 1MB 按阶梯降质重编） |
| 尺寸 | 先让作品画到 **1:1**（`scale ≥ 1/ratio`），再受长边 ≤ 4000px 约束 | 画布长边收敛到 1600px（不做无意义放大） |
| 体积 | 无上限（体积随像素走） | ≤ 1MB（`ARTWORK_EXPORT_JPEG_QUALITY_LADDER` 兜底） |

- **「保留裁剪后的原始像素」是结构性质，不是观感**：`artworkExportPlan()` 用装裱几何的 `ratio`
  反推倍数（`scale ≥ 1/ratio`），返回 `keepsOriginalPixels` 作为**诚实的标记** —— 当 1:1 会顶穿
  4000px 上限（例如班级反馈直接拿手机原图当作品）时它是 `false`；界面与断言都读这一个字段，
  不要另写一套「画布够大就算保留像素」的判断。
- 渲染入口是 `renderFramedArtworkToCanvas({..., scale})`（`services/framing.js`）：画布按 scale
  放大，但**绘制坐标系仍是 1800×1360 逻辑坐标**（一次 `ctx.scale`），所以展签字号、水印位置、
  框带宽度这些「相对短边的比例」在 4000px 导出图上与成品图完全一致 —— 导出图不是「另一套版式」。
  `renderFramedArtwork` 是它的薄包装（固定 `scale: 1` + JPEG 0.92），**老调用方逐字节不变**。
- 新增档位/改规则只改 `ARTWORK_EXPORT_QUALITIES` 一处：界面按钮文案、`artworkExportRulesText()`、
  导出计划与断言全读它。文件名规则 `artworkExportFilename()` = `学员名_作品名_课次日期_装裱.{png|jpg}`：
  空格（含全角）与非法字符一律去掉、下划线是分隔符因此片段内的下划线也去掉、**空片段直接不参与拼接**
  （不会出现 `__装裱.png`），日期复用 `formatLessonDateDots`。
- 保存路径按 UA 分流（`artworkExportSaveStrategy`）：桌面 / Android 走 `<a download>`；
  **iOS 全系与微信内置浏览器会忽略 blob 下载**，因此降级为 `.save-image-sheet` 那一层
  「长按图片 → 保存图片 / 存储到照片」的提示页（页面内用 object URL 显示真图，关闭时 `revoke`）。
  判据是纯函数，验证时用 CDP `Emulation.setUserAgentOverride` 真的切 UA 就能端到端跑通两条路径。
- **本故事不写回课次**（FR-27 的 (b) 是 US-008b）：`composeArtworkExport()` 返回
  `{canvas, blob, filename, width, height, plan, qualityUsed}` 就是写回侧要的输入，别在 UI 里再渲染第二次。

## 保存图片：成品图写回作品位与溯源（US-008b / FR-27）

「保存图片」是**两件互不阻断的事**：① 下载（US-008a）；② 把成品图 + 溯源写进
**本次课后反馈的作品位**（本故事）。规则集中在 `src/data/artworkWriteBack.js`（零依赖纯函数），
DOM/canvas 部分在 `src/services/artworkWriteBack.js`，编排在 `main.jsx` 的
`performArtworkWriteBack` / `retryArtworkWriteBack`。

- **写回落在哪儿**：作品位上的 `writeBack` 子对象 —— 个人反馈是 `media.artwork`（走
  `applyWriteBackToSlot`），班级反馈是那条上传条目（走 `updateUploadEntry`，
  **因此 `writeBack` 必须留在 `createUploadEntry` 的白名单里**，否则条目一重建就被静默丢掉）。
- **写回的图是什么档**：`ARTWORK_WRITE_BACK_IMAGE` = 档案展示口径（长边 ≤1600 · JPEG 0.85，
  与微信档同参数），从**合成用的那张画布**缩出来（`encodeArtworkWriteBackImage`）。理由：
  作品位要进 localStorage（归档 → 记录 → 3D 画廊贴图），高清 PNG 的 data URL 可到 1.5MB；
  老师本机下载的母版仍按所选档位（高清 PNG 保留裁剪后的原始像素），界面上写明了这个分工。
- **四项溯源**（PRD 点名）：`specSnapshot`（当时的整份渲染视图，配 `specKey` 可复现）、
  `sourceUrl`（本次导出的底图地址 + 指纹）、`generatedAt`、`operatorId`（原型阶段 = 会话身份串
  `roleMeta.teacher.name`）。`artworkWriteBackProblem()` 把这四项当**必填**：缺任何一项都算没写好，
  走「未能同步到档案」那条路。
- **新鲜度键**（最容易踩）：`artworkWriteBackKey({specKey, sourceUrl, student, title, lessonDate,
  teacherName, orgName, rotation})` —— 装裱参数 + 底图 + **图上会印的变量**。少一项就会出现
  「改了框 / 换了学员名，档案里还是旧图」。消费点只有两个入口：`writtenBackImageUrl(slot, key)`
  与 `artworkWriteBackOf(slot)`；**过期就返回空串**，由调用方退回实时渲染 —— 旧图不许冒充新图。
- **消费点**：第三步个人反馈的 `<img>`（`reviewFramedSrc`）、班级合展的 `figureOf`（传 `writtenBackKey`）、
  归档记录（`createFeedbackRecord({framedArtwork})`）、3D 画廊（`exhibitionArtworks`：
  有 `record.framedArtwork.imageUrl` 就**直接挂这一张**，不再套画展的框 —— 否则「框里套框」；
  没写过回的老记录一字不变）。
- **已经归档过的记录要就地更新**：`currentRecordId` 记住本次归档的那条；保存图片时若它非空，
  写回同时 `setRecords(map)`。换班 / 换学员 / 换模式 / 新建草稿都要清掉它，否则会把成品图
  写到别人家的档案里。
- **写回失败不阻断下载**：`artworkWriteBackFailureText()` 给出 PRD 原文那句
  「已保存到本地，未能同步到档案…可重试」；面板上**耐用状态**（`-status`）与**最近一次尝试**
  分开报（`-slot` vs `-status`：尝试失败时 status=failed，但 slot 仍是 synced/stale）——
  两个都挂在 DOM 上，断言各读各的。重试只重跑写回（复用 `composeSaveImageExport` 同一份输入），
  **不会再下载一次**。

## 班级批量应用装裱（US-010）

带 18 人班的老师的主操作：第二步（班级反馈）的「批量应用装裱」面板选一套模板，一次应用到
本班**已上传的全部作品**；落款里的 `{学员名}` 与展签姓名按**作品所属学员**自动替换（不串名）。
三块拼图各有各的真源，别互相抄：

| 关注点 | 位置 |
|---|---|
| 目标分类（要装 / 已是最新 / 已单独调整 / 素材不可读）、状态机、进度与失败清单文案、20 秒预算、确认文案 | `data/batchFraming.js`（零依赖，Node 可直跑） |
| 「渲染一幅作品 → 档案展示口径的持久副本」 | `services/batchFraming.js`（`renderFramedArtworkToCanvas` + `encodeArtworkWriteBackImage`，与单幅保存**同一条渲染路径**） |
| 循环 / 进度 / 取消 / 失败重试 / 写回哪条素材 | `main.jsx` 的 `runBatchFraming` / `writeBatchFramedArtwork` / `retryBatchFramingItem` + `batchFramingPanel` |

- **状态判据来自作品位上的写回记录**（US-008b 的 `writeBack`）：
  `current`（上一次批量的成品图仍然新鲜，跳过不重画）/ `pending`（没装过，或参数变了）/
  `adjusted`（**已单独调整过**：记录没有 `batchId`，或**同一个参数下重算键对不上**——
  批量之后老师又改过这一幅）/ `missing`（没有可读底图）。「换一套模板再跑一次」不算单独调整
  （记录在自己的参数下仍然对得上），否则每次换模板都要确认一遍。
- **`writeBack.batchId` 是「批量 vs 单独保存」的唯一判据**：批量写回会带上批次 id，
  老师的「保存图片」不带。加字段时必须同时进 `data/artworkWriteBack.js` 的
  `ARTWORK_WRITE_BACK_FIELDS` 白名单（条目是白名单构造的，漏了就被静默丢掉）。
- **两个新鲜度键，别混用**：
  - `batchFramingTargetOf().key`（**计划键**）= 这一幅的变量 + **本次选用**的参数 →
    回答「现在要不要重画」（面板的 jobs 计数）；
  - `batchFramingDisplayKeyOf()`（**展示键**）= 这一幅的变量 + **记录自己的 `specKey`** →
    回答「作品上那张图还能不能代表它」，第二步装裱墙与第三步班级合展都读它。
  用计划键当展示键的后果：老师在面板上换一套模板**但还没应用**时，整面墙立刻标成
  「待重新装裱」；反过来改了这一幅的作品名 / 旋转时必须过期（图上印的字对不上了）。
- **落款 / 展签的姓名与作品名取作品所属学员**：`batchFramingVariablesOf` 先按条目归属、
  再回 `participants` 名单取真实姓名，**未绑定学员就是空串**（绝不猜名字，也绝不串到
  「当前选中的学员」）。批量面板上的「未绑定」单独计数。
- **串行渲染 + 取消标记**：一次只画一幅（内存里同一时刻只有一张 1800×1360 的位图），
  循环在每一幅**开始前**读 `batchFramingCancelRef` —— 取消只停掉还没开始的那些，
  已完成的成品图不回滚。面板是**内联块**（不是固定遮罩），所以批量过程中页面照常可滚动。
- **单幅失败不影响同一批的其它作品**：失败项进 `state.failures`（带这一幅的姓名与可读原因），
  「只重试这一幅」走同一个 `writeBatchFramedArtwork`；`item-ok` 会顺手把这一条从失败清单里摘掉。
- **验收里的「18 幅 ≤ 20 秒」收在 `BATCH_FRAMING_BUDGET`**（18 幅 / 20 秒，数量更多按比例放宽），
  面板显示的结论（`batchFramingBudgetVerdict`）与断言读同一份。

### 踩过的坑（本故事真踩）

- **班级反馈的上传路径也会写 `media.artwork`**（`readFile` 的本地预览），于是
  `frameThumbRefMedia = media.artwork ? null : batchUploads.artwork[0]` 在班级反馈下**永远拿到 null**：
  样式缩略图 / 水印预览 / 保存图片的**姓名与作品名会退化成模板上的展签占位**（`.title` 成了空串），
  而且保存出来的图其实是「最后一次上传的那份素材」而不是作品位那一幅。判据要**按反馈模式**取：
  `mode==='班级反馈' ? batchUploads.artwork[0] : null`。这条修完，班级反馈的「单独保存」才与
  批量装裱算得出同一个新鲜度键（US-008b 的 class 分支当时是靠模板占位恰好等于第一个学员而通过的）。
- **上传位行数来自 `participants`，不是班级名单**：`uploadSlotParticipants(effectiveParticipants, …)`
  渲染行。验证脚本里换班级名单而没清草稿（`xinlehui-feedback-draft-v2`）时，会出现
  「名单里 18 人、上传位只有 3 行」——先 `localStorage.clear()` 再写种子。
- 填作品名的输入框选择器要限定在**作品上传位容器**里
  （`.intake-upload-slots:not(.photo-slots) .intake-upload-item …`）：照片上传位与作品上传位是同一套
  行结构，直接 `.intake-upload-slot-head label b` 会一次取到两批（6 行而不是 3 行）。

### 验证要点（本故事实测口径）

- **「姓名真的印在图上」用独立重算证明**：批量完成后，用页面里**同一个** `renderBatchFramedArtwork`
  按「这一幅的底图 + 参数 + 姓名」重算一次，与写回记录的地址指纹**逐字符比**；再做一个反证——
  换成下一位学员的姓名重算，结果必须**不同**（否则「名字根本没起作用」也会通过）。
  参数从应用 state 里的模板取（fiber 探针只读，云端模板与内置模板都覆盖得到），
  展签日期与单幅口径一致（`framePlaque()` 的 `date`，US-014 起 = 课次日期按模板格式渲染）。
- 装裱墙每行都落了只读属性：`data-artwork-framed`（`none|batch|single|stale`）、
  `-writeback-student` / `-title` / `-batch` / `-fingerprint` / `-key`（记录里的键）/
  `-plan-key`（当前的每幅键）/ `-fresh` —— 「为什么判成 stale」在 DOM 里就能看出来。
- **失败注入选 `HTMLCanvasElement.prototype.toDataURL` 的第 N 次调用**（批量路径每幅一次编码），
  得到「第 2 幅失败、另两幅成功」；断言写「失败项保持上一版指纹不变 + 另两幅指纹已变 +
  重试后失败清单清空且另两幅指纹一字不变」。
- **「真的画了 18 幅」的数法**：数 `toDataURL` 的调用**尺寸**（批量副本固定 1600×1209；
  缩略图是 ≤320 的那几次，不能算进来）。
- 取消类断言放到 18 幅的场景里做（3 幅一两秒就跑完了，点击取消与完成会竞态）。

## 装裱参数 spec：v1 平面结构 / v2 分组结构

`src/services/frameSpec.js` 同时持有两代结构，动装裱参数前先确认自己在哪一代：

| | v1（已冻结） | v2（新能力只加在这里） |
|---|---|---|
| 形状 | 平面字段 `outer` / `outerWidthRatio` / `mat` / `matWidthRatio` / `innerLine` / `plaqueBg` / `plaqueText` / `plaqueFontFamily` / `plaqueLetterSpacing` / `artRotateDeg` / `atmosphere` / `rationale` | 分组 `canvas` / `frame` / `mat` / `plaque` / `watermark` / `signature` / `date` / `art`，加顶层 `version: 2` 与 `atmosphere` / `rationale` |
| 收敛器 | `normalizeFrameSpec`（后台大模型入口仍在用，**不要改**） | `normalizeFrameSpecV2`（字段全可选、脏数据不抛错、非法值收敛到 v1 行为） |
| 默认值 | `DEFAULT_FRAME_SPEC` | `DEFAULT_FRAME_SPEC_V2` |

- **渲染层读 `frameSpecRenderView(spec)`，后台面板读 `frameSpecView(spec)`**（两个入口分工不同，别混）：
  - `frameSpecView` = v1 平面视图（颜色 / 框宽 / 卡纸 / 展签 / 旋转）。v1 输入**原样返回同一个对象**
    （老模板渲染逐像素不变），v2 输入由 `frameSpecV2ToLegacy()` 映射。后台「装裱设置」面板与列表色板读它。
  - `frameSpecRenderView` = 平面视图 **+** 形状 / 圆角 / 光影 / 卡纸开关，是 `renderFramedArtwork` **唯一**的
    spec 读入口。**不要再直接 `spec.frame.shape` / `spec.outer`**，也不要在渲染函数里重新收敛一遍。
- **`frame.lighting` 只在「显式给出」时绘制**（`frameSpecRenderView` 判 `frame.lighting` 是否是对象；
  v1 平面结构一律 `lighting: null`）。理由：v1 本来不画光影，US-001a 规定「缺失字段回落 v1 行为」；
  若按 DEFAULT 补一份默认光影，一份只写了 `frame.shape` 的 v2 spec 会凭空多出渐变。
  内置 4 套预设与 `DEFAULT_FRAME_SPEC_V2` 都**显式**带 `lighting`，所以它们从 US-002a 起有体积感。
- **形状**：四种都已实现 —— `square`（直角）、`rounded`（圆角，半径 = `cornerRadiusRatio × 画布短边`）、
  `arch`（顶部半圆拱形）、`bevel`（四角斜切）。圆角半径有三条上限，缺一条就踩红线：
  ① 收敛到 `0~0.5`；② 不超过外框短边的一半；③ **内圈半径 ≤ 卡纸宽** —— 否则圆角会切进作品窗口，
  等于把孩子的画裁掉四个角。所以「加宽圆角」永远不能改动作画区域。
- **`arch` / `bevel` 的几何在 `src/services/frameShapes.js`（纯函数、零依赖，可直接 Node 断言），
  画布只在 `framing.js` 的 `buildShapedGeometry()` 里消费它**：
  - **只有 `arch` / `bevel` 走形状路径**：`buildShapedGeometry()` 对其它 shape 必须返回 `null`，
    否则 `square` / `rounded`（以及所有 v1 平面 spec）会被画成别的形状 —— 踩过的坑：漏了这个判断，
    `rounded` 与 v1 模板全被画成斜角。新增形状时先加判断，再改渲染。
  - **同心内缩**：外框 → 卡纸 → 开口三层是同一个形状向内缩 `outer` / `outer + mat`，框带才处处等宽。
    斜角要额外按 `CHAMFER_INSET_FACTOR = 2 - √2` 修正切角长度，否则斜边上的垂直框宽只有直边的 1/√2。
    `arch` 的半径上限是 `ARCH_MAX_RISE_RATIO = 0.7 × 外框高`（保证拱下仍有直边），
    `bevel` 的切角是 `BEVEL_CHAMFER_RATIO = 0.09 × 外框短边`；两者都是**渲染层常量**，不进 spec。
  - **作品只画在形状内的最大等比矩形里**（`inscribeAspectRect(shape, {aspect, top, bottom})`），
    形状内没被作品占满的部分留给白色作品底 —— 这就是「不露底」；白底按形状 `clip` 后只铺到展签上沿，
    展签也按形状 `clip` 铺满，所以形状外一个像素都不碰。**不要**把作品矩形直接画到形状的边上
    （arch 的拱顶会切掉作品四角），也不要拿固定 `area` 去顶形状。
- **光影**：`frame.lighting = { highlight, shadow, angle }`，`angle` 与 CSS `linear-gradient` 同角度语义
  （0° 朝上、90° 朝右、135° 由左上到右下），渐变起点朝光源 → 135° = 高光在左上、暗部在右下。
  渐变只铺在外框上（卡纸随后画在其内圈），**不覆盖卡纸与作品像素**。
- **用 spec 做缓存键一律走 `frameSpecRenderKey(spec)`**（= `JSON.stringify(frameSpecRenderView(spec))`）：
  `gallery/exhibitionArtworks.js` 的 `specKey` 原先手挑字段，漏一个就会让两套不同模板算出同一个键、
  画廊里互相串图（形状/光影就是这么漏掉的）。取整份渲染视图，v2 新增的影响渲染字段会自动进键
  —— 宁可多渲染一次，也不能串图。
- 收敛范围（越界收敛而不是画崩）：框宽 `0.008~0.08`、圆角 `0~0.5`、卡纸宽 `0.02~0.12`、不透明度 `0~1`、
  字号 `8~200`、面板字体走 `OVERLAY_FONT_WHITELIST` 白名单、`logo.url` / `signature.imageUrl` 只放行
  `http(s)` / `data:image` / `blob:`（**且有长度上限**，见下文「叠加元素的画笔」）。比例型范围的唯一真源是
  `FRAME_WIDTH_RATIO_RANGE` / `MAT_WIDTH_RATIO_RANGE` / `CORNER_RADIUS_RATIO_RANGE`，**收敛器与渲染层都读它、
  不要在任一侧写死数字**（v1 平面 spec 是**原样**进渲染层的，渲染层不兜住就会被 0.5 的框宽画崩）。
- **US-002a 起内置预设的渲染结果有意改变**（它们显式带 `lighting`，本故事开始绘制）；
  US-006 把内置样式库从 4 套扩到 11 套（老 4 套的 spec 一个数都没动，新增的 7 套见下一节）。
  持久的向后兼容承诺是：**v1 平面 spec**、以及**没有显式 `frame.lighting` 的 v2 spec**，渲染逐像素不变。
  复核兼容性时不要拿「内置预设」当 v1 基准（US-016 的 4 套预设 v1↔v2 逐像素断言自 US-002a 起失效是预期的）。
- **v2 的叠加元素（`watermark.*` / `signature` / `date` / 印章）默认 `visible: false`**：v1 本来不画
  任何叠加元素，默认 true 会让「迁移过来的老模板」凭空多出 `{机构名}` 水印。是否绘制由面板显式开启
  （US-003a/003b/003c），**不要为了省事把默认值改成 true**。
- `src/data/framingPresets.js` 的内置预设已是 v2，且**故意省略 watermark / signature / date 三组**
  （字段可选，缺省即 v1 行为）。该 data 模块保持**零依赖**（不 import services；跨 data 模块的
  `import { FRAME_STYLE_COLORS } from './frameStyles'` 是可以的，两边都零依赖），以便 Node 直跑断言。
- 状态机：`art.rotateDeg` 只允许 **0 / 90**（模板级）；任意角度微调属于单幅作品的 `artworkEdit`（US-004），
  不进模板。`date.source` = `lesson | today | manual`，`date.format` 三种白名单；所有位置是九宫格枚举
  + `offsetX/offsetY` 比例偏移（-0.5~0.5）；尺寸与位置一律用「相对画布短边的比例」。

### 叠加元素的定位与变量替换（US-003a）

> **控件也共用**：九宫格定位控件是 `main.jsx` 的 `OverlayPositionPad`（后台装裱设置与老师端
> 「水印 · 落款 · 时间」面板同一份）。老师端在它之上加了「按住拖动 = 微调偏移」，
> 换算规则在 `data/lessonOverlays.js` 的 `overlayDragOffsets`（见「水印 · 落款 · 时间面板（US-007）」小节）。

定位 / 偏移 / 尺寸换算 / 变量替换的**唯一真源是 `src/services/overlayLayout.js`**（零依赖纯函数，
与 `frameShapes.js` 同一口径，可直接 Node 断言）。渲染层、后台九宫格控件（US-007）与批量套用都读它，
**不要在 JSX / frameSpec 里再造一套定位**。

- 九宫格枚举 `ELEMENT_POSITIONS` 常驻 `overlayLayout.js`（九个格子 + `custom`，PRD 词汇表口径；
  `custom` = 中心锚点、供拖动微调），`frameSpec.js` 只是**重新导出**；`frameSpec` 的收敛器与定位层
  共用 `ELEMENT_OFFSET_RANGE`（-0.5~0.5）/ `clampOverlayOffset()`，**两处都不许再写 ±0.5 字面量**。
- **偏移正值一律朝画布内侧**：右下角 `0.03` = 离右边和下边各留 3% 短边，左上角也是往右下挪；
  负值把元素往画布外推（可出血）。做成「统一 +x/+y」的话，右下角的默认值会直接把元素推出画面。
- 位置与尺寸一律短边比例：`overlayShortEdge = min(宽,高)`；文本用 `resolveOverlayAnchor()`
  （直接给 `ctx.fillText` 的绘制点 + `textAlign/textBaseline`），图片 / 二维码用 `resolveOverlayBox()`，
  字号用 `resolveOverlayFontSize()`（spec 的 `fontSize` 是基准短边 `OVERLAY_BASE_SHORT_EDGE = 1360` 下的像素）。
- 变量替换 `applyOverlayVariables()`：五个变量 `{机构名}{学员名}{作品名}{老师姓名}{课次日期}`。
  **不在五个变量里的占位符保留原文**并由 `overlayVariableWarnings()` 给后台警告（FR-19）；
  **命中但上下文没值 → 空串**（空内容不绘制，不留空括号）。
- 上下文来自 `renderFramedArtwork({ orgName, student, title, teacherName, date, variables })`
  （`variables` 逐字段优先）。机构显示名的唯一来源是 `data/lessons.js` 的 `DEFAULT_ORG_NAME`；
  **改传参要同步调用点的渲染缓存键**（`main.jsx` 第二步的 `styleKey` 已含 `currentTeacherName` / `DEFAULT_ORG_NAME`）。
- **绘制门控**：只有 `visible === true` 且**已接画笔**（`DRAWN_OVERLAY_KINDS`）的元素进 `framing.js` 的
  `drawOverlayElements()`（画在最上层、位置相对整块画布短边）。US-003b 已接文字水印与机构 Logo 两支持画笔，
  二维码 / 落款 / 时间的画笔由 US-003c 接在同一门控后 —— 没有画笔的类别同样不画、也不留占位。
- 叠加元素整组进 `frameSpecRenderView()`（v1 平面 spec 是 `overlays: null`），所以水印的位置 / 内容 /
  `visible` 自动进 `frameSpecRenderKey()`：两套只有水印位置不同的模板不会共用画展缓存，**别把它摘出去**。
- canvas 验证口径：按「可见 vs 不可见」差分找墨迹外接框；字形侧边距（~4px）与 descent（~8px）让绝对位置
  差几个像素 → 绝对位置用 **±10px** 容差，比例精确性改用**两个偏移的差值**断言（±3px）。

### 叠加元素的画笔、Logo 上传与遮挡统计（US-003b）

**画笔清单是单一真源**：`overlayLayout.js` 的 `overlayElementEntries(overlays)` 把五个分组摊平成
`{ kind, element }`，`DRAWN_OVERLAY_KINDS` 声明**已经接了画笔**的类别（现在 = `watermark.text` +
`watermark.logo`）。新增一支画笔要**三处一起改**：`DRAWN_OVERLAY_KINDS`、`framing.js` 的
`drawOverlayElements()` 分支、`loadOverlayImages()` 的取图分支（图片类才需要）。绘制与遮挡统计读同一份
清单，只看其一就会出现「提示说挡住了、其实没画」或「画了但统计不到」。

- **机构 Logo 的取框走 `resolveOverlayImageBox()`**：宽度 = `widthRatio × 画布短边`，高度按图片自身比例
  算（**不拉伸、不裁切**），高度超过 `OVERLAY_IMAGE_MAX_HEIGHT_RATIO = 0.5 × 画布高` 时整体等比缩回来
  —— 不然一张 1:4 的窄长 Logo 按 0.4 的宽度比例能算出 2176px 的高，直接顶出画布。图片尺寸未知（没解码 /
  解码失败）时按**正方形**估框：宁可高估遮挡，也不要因为量不出来而漏报。
- **Logo 解码失败 / 未上传（`url` 为空）时什么都不画**（`paintOverlayImage` 直接 return），且渲染
  **不抛错**：一张坏 Logo 的失败面应该是「少了水印」，不是「没有成品图」。地址解码结果按 URL 缓存在
  `framing.js` 的 `overlayImageCache`（上限 8 条，批量渲染不重复解码）。
- **`imageUrl()`（`frameSpec.js`）的长度上限不能拍脑袋写小**：旧的 `slice(0, 2048)` 会把合规的
  data URL Logo **截断**，而截断后的 PNG 还能被解码器「部分解出来」→ 画面上是一张只有上半截的 Logo，
  全程不报错（US-003b 真踩到：2048 字符截断让 100×400 的测试图只画出上面 73%，看着像渲染有鬼）。
  现在上限取 `data/framingAssets.js` 的 `FRAMING_ASSET_DATA_URL_MAX_CHARS`（按 200KB 素材推出来），
  超过上限**丢弃**而不是截断。
- 装裱素材（机构 Logo / 手写签名 / 二维码底图）的准入规则是 `data/framingAssets.js`（**零依赖**，可 Node
  断言）：**PNG / JPG**（比儿童素材的 JPEG/PNG/WebP 更窄）、单边 ≤ `512`、体积 ≤ `200KB`，判定分两步
  —— 选文件时先判格式与体积（`screenFramingAssetFile`），**解码拿到真实宽高后再判一次**
  （`validateFramingAsset`，文件名与 MIME 都可能骗人）。浏览器侧只有 `services/framingAssets.js`：
  `readFramingAsset(file)` 返回 `{ ok, asset: { url(dataURL), width, height, size, type } , message }`。
  复核**已经存进模板**的地址要用 `validateFramingAssetDimensions`（只判尺寸）—— 拿完整判定去判它，
  「机构 Logo」这个标签没有扩展名，会一律误报「格式不支持」。
- 素材存进 spec 的是 **data URL**（`logo.url`）：`imageUrl()` 的白名单本来就放行 `data:image`，
  而 `blob:` 刷新即失效、带不上云端模板。机构 Logo 是机构资产不是儿童素材，不受「素材不进浏览器存储」约束；
  换私有对象存储（FR-22 的鉴权上传）属于合规故事。
- **「水印遮住孩子的画」的统计 = `evaluateOverlayCoverage()`（零依赖）**，三个口径：
  ① 分母是**作品主体**（`buildFramingLayout` 的 `subjectRect` = 等比缩放+居中之后作品真正占住的那块），
  不是整块画布、也不是卡纸开口 —— 压住卡纸与相框是允许的，只有压在画上的部分才算遮挡；
  ② 分子是所有元素框与主体的**交集的并集**（`unionRectArea`，容斥原理；两个水印叠在一起不该算两遍）；
  ③ 超过 `OVERLAY_COVERAGE_LIMIT = 0.15` 时 `exceeds` 为真并给可读 `message`（验收原文的 15%）。
- **`measureFramingCoverage()` 与渲染共用同一份几何**（都调 `framing.js` 的 `buildFramingLayout`）：
  面板上的百分比就是成品图上真实压住的面积。**不要**在面板侧另算一套「作品区」—— arch / bevel 分支的
  作品区是「形状内最大等比矩形」，用固定的那个 `area` 会算错。文本框由 `textPlanBox()` 从
  `planOverlayText()` 的产物推出（优先用 `measureText` 的 `actualBoundingBox*`，拿不到按 `0.8em/0.2em` 估，
  旋转的文本取轴对齐外接框）—— 它是**偏保守**的估计（略大不略小）。
- **后台「装裱设置」的水印面板写回 spec 只覆盖 `watermark` 组 + `version: 2`**（`patchWatermark`），
  老模板的 v1 平面字段（`outer` / `matWidthRatio` / `plaque*` …）一个都不动。混写结构在
  `normalizeFrameSpecV2` 里是合法输入（v2 分组优先、v1 平面字段兜底），所以「给老模板加个水印」不会
  顺手改掉它的样子 —— 这也是本机云端还存着 v1 模板时仍能演示水印的原因。
- 面板里的数值输入要**显示 draft 里的原值**（`{...specV2.watermark.logo, ...rawWatermark.logo}`），
  不要显示收敛后的值：收敛发生在渲染时，显示收敛值会让「输入 2 立刻被改成 8」→ 数字框没法正常输入。

### 落款 / 时间 / 二维码与二维码编码器（US-003c）

五类叠加元素（FR-16）在 US-003c 接齐：`DRAWN_OVERLAY_KINDS` 现在是
`watermark.text / watermark.logo / watermark.qr / signature / date`。新增画笔的纪律见上一节（三处一起改）。

- **时间**：来源 / 格式 / 前缀的枚举真源在 `overlayLayout.js`（`DATE_SOURCES` / `DATE_FORMATS` /
  `DATE_SOURCE_LABELS`，`frameSpec.js` 只是重新导出）。`resolveOverlayDateText()` 负责
  「来源 → 日期值 → `formatOverlayDate()` → 加 prefix」：`source: 'lesson'` 读 `context.lessonDate`
  （变量上下文已归一成 `YYYY.MM.DD`，所以**时间默认取本次课次日期**是默认行为，不需要额外传参），
  `'today'` 读渲染入参 `today`（缺省 `new Date()`；**测试里必须固定它**才能断言），`'manual'` 读 `manualValue`。
  `formatOverlayDate` 认不出的值**原样输出**（手填「上周三」不会被编造成某一天）；拿不到日期时整支不画。
- **落款**：`planOverlaySignature()` 一个入口管两种模式 —— `text`（姓名 `teacherName` + 寄语 `message`，
  变量可替换；两行按锚点基线排列，底排「块底 = 锚点 y」、顶排「块顶 = 锚点 y」、中排整块垂直居中）与
  `image`（手写签名图，宽度 = `signature.imageWidthRatio × 画布短边`、高度按图片比例，**不拉伸**）。
  印章是落款的一部分，由 `planOverlaySeal()` 定成「边长 = 落款字号 × 2.4、贴在落款块**内侧**」——
  内侧判据取 `resolveOverlayAnchor()` 返回的 `dirX`（贴左的落款章在右、贴右的在左），**不要把 dirX/dirY
  从返回里删掉**（少了它印章会一律跑到右边，踩过一次）。
- **二维码**：内容由后台配置（FR-23）。`watermark.qr.target` 存的是**目标键**，
  `data/qrTargets.js` 是白名单唯一真源：`normalizeQrTarget()` 对白名单之外的值（包括任意 URL）
  **一律回落默认目标**，`resolveQrTargetUrl(key, context)` 把模板（如 `…/p/{shareToken}`）解析成 URL，
  没有真实令牌时填 `QR_TARGET_SAMPLE` 的示例值并给 `ready: false` / `sample: true`（面板据此提示
  「示例链接」）。老师端没有任何「填 URL」的入口，数据层再收一道 —— 两道都要有。
- **二维码绘制**：`planOverlayQr()` 出几何（正方形码区 + 四周 `QR_QUIET_MODULES = 4` 个模块的白底静区，
  白底夹在画布内；说明文字排在白底外侧，贴底边时自动改排上方），`paintOverlayQr()` 只负责铺白底与
  逐模块 `fillRect`。**白底与静区必须有**：成品图上二维码常落在卡纸 / 展签底色上，没有白底就扫不出来；
  **模块边界要 `Math.round` 取整**，否则非整数倍缩放下相邻模块之间会出现灰缝。
- **二维码编码器在 `services/qrCode.js`（零依赖纯函数）**：byte 模式 + 版本 1–10 + 纠错等级 L/M/Q/H，
  `qrMatrix(text, { ecc, version })` 返回 `{ size, version, ecc, modules }`，**编不出来返回 `null`**
  （空文本 / 超长 / 非法参数），调用方按「这一支不画」处理 —— 绝不画一个扫不出来的假码。
  改这张 RS 分块表之前先读文件头的提示：表写错时矩阵**看起来仍然像个二维码**，只有识别器能发现。
- **后台「装裱设置」的叠加面板**：`patchOverlayGroup(group, value)` 只覆盖**这一组 + `version: 2`**
  （落款 / 时间走它，水印仍走 `patchWatermark`），老模板的 v1 平面字段一个不动；签名图上传复用
  `readFramingAsset`（PNG/JPG、≤512×512、≤200KB，与 Logo 同一套准入）。数值 / 文本框显示 **draft 原值**。

### 单幅作品的编辑状态 artworkEdit 与撤销栈（US-004a）

- 单幅作品的编辑结果是**独立对象** `artworkEdit`（`rotateDeg / crop / zoom / offsetX / offsetY`，FR-5），
  与「可复用的装裱模板 `spec`」分开存：老师摆正 / 裁了一幅画，参数不会写进机构模板（FR-39）。
  纯规则（角度算法 + 撤销栈 + 文案）在 **`src/data/artworkEdit.js`（零依赖，可 Node 断言）**，
  画布渲染在 `src/services/artworkEditor.js`。
- **旋转角口径**：`rotateDeg` 归一化到 `[0,360)`，由「90° 粗旋转 + 任意角度微调」组成。
  `fineRotationOf(deg)` = 相对**最近** 90° 整角的偏移（∈[-45,45]），微调夹在 ±15°、按 0.5° 量化；
  换 90° 时微调量跟着一起走 —— 否则「右旋 90° + 微调 3°」会被吞成 273°，界面上看不出为什么。
- **编辑态 = 草稿 + 撤销栈**：编辑期间只改 `artworkEditor.draft`（React state），点「完成编辑」才写进
  `media.artwork.artworkEdit`。于是「放弃 / 未确认退出」天然不会污染已装裱的成品（US-026 的 AC 直接成立），
  而折叠态摘要必须显示**已确认**的那一版（不是刚被丢弃的草稿）。
- **撤销栈是快照式的**：`createArtworkEditHistory / pushArtworkEditHistory / undoArtworkEditHistory /
  redoArtworkEditHistory`（上限 `ARTWORK_EDIT_HISTORY_LIMIT` = 40 步，验收要求 ≥20）。存整份 artworkEdit
  而不是每步的反操作 —— US-004b/c 的裁剪 / 缩放接进来时天然一起被撤销。两条纪律：
  ① 「没有实际变化的编辑不占一步」（否则撤销按下去画面不动）；② 到边界时返回**同一个对象**，界面据此置灰。
- **重活只在确认后跑一次**：编辑期间第二步的两段重活（`extractArtworkSurface` → `renderFramedArtwork`）
  **不跑**，只画低分辨率「旋转稿」（长边 ≤ `EDIT_PREVIEW_MAX_EDGE` = 900，120ms 合并连点）；
  否则每按一下 ±0.5° 就要重扫一遍像素。
- **四层地址**：`originalUrl`（原图，只读）→ `orientedUrl`（旋转稿）→ `cleanUrl`（裁剪稿）→
  `framedUrl`（成品图）。`renderArtworkRotation` 在 0° 时**原样返回原图地址**（不重新编码），
  90° 整数倍走高清精确路径（与旧 `rotateArtworkOriginal` 逐字节一致），任意角度则按旋转后的外接框放大画布、
  四角补白（作品一个像素都不裁）。裁剪稿的缓存判据带上 `cleanEditKey`（artworkEdit 快照键）：角度变了必重算。
- 旧数据兼容：`normalizeArtworkEdit` 仍读 `rotation` / `rotate` 两个老写法（以前的 90° 倍数角度存在
  `media.artwork.rotation` 上）；新代码不再写那个字段。
- 已知边界：任意角度旋转会在成品图上留下**补白的白角**（自动裁剪能识别出纸面时会被裁掉；识别失败回退
  「不裁剪」时白角可见）。这是 PRD 开放问题 Q6 里说的「边缘补白」问题 —— 老师现在可以用裁剪框（US-004b）
  手动把白角裁掉。

### 裁剪框：8 点拖拽 / 比例预设 / 最小 10% / 四边吸附（US-004b）

纯规则在 **`src/data/artworkCrop.js`（零依赖，可 Node 断言）**，canvas 侧的裁剪在
`services/artworkEditor.js` 的 `renderArtworkCrop`。

- **坐标口径只有一份**：`artworkEdit.crop = {x,y,w,h}` 是 **0–1 归一化**，相对「已按 `rotateDeg` 摆正后的那张图」
  （= 编辑器里显示的那张旋转稿）。预览是原图的等比缩放，所以同一份矩形既能量在预览上、也能原样裁原图。
  归一化矩形 → **像素** 比例要乘画布比例：`(w/h)·imageAspect`（`cropAspectOf`）。
- **两条画心路径共用一条下游流水线**：`artworkEdit.crop` 非空 → `renderArtworkCrop`（老师画的框就是最终边界，
  不识别纸边、不填白）；为空 → `extractArtworkSurfaceDetails`（系统识别纸边 + 填白）。两条路径的算法标识分别是
  `ARTWORK_MANUAL_CROP_ALGORITHM` / `ARTWORK_CLEAN_ALGORITHM`，`main.jsx` 的 `ARTWORK_CLEAN_ALGORITHMS`
  是「画心可用」的唯一判据 —— **新增画心来源时必须同时加进这个数组**（第二段装裱 effect 也读它，漏了就不重渲染）。
- **系统识别到的框要记账**：`extractArtworkSurfaceDetails` 除地址外还返回归一化 `crop`（识别失败/整幅回 null），
  `main.jsx` 存到 `media.artwork.cleanCropRect`。编辑器打开时以它为裁剪框的初始位置 —— 否则「系统已经裁过了」
  这件事在界面上看不见，老师第一次拖动画面就会跳。`extractArtworkSurface`（返回地址）只是它的薄包装。
- **拖动是「按位移」生效的**：`resizeCrop(crop, handle, dx, dy, opts)` / `moveCrop(crop, dx, dy, opts)` 收的是
  归一化位移，锚点规则：角把手锚定对角、边把手只驱动一个方向（另一个方向以原框中心展开）、锁比例时 `h = w·k`
  （`k = 画布比例 / 目标比例`）。三条不变量在每个分支都要成立：**四边吸附**（被拖的边进入 `CROP_SNAP_RATIO`
  = 2% 就贴齐 0/1）、**最小尺寸** `CROP_MIN_RATIO` = 10%（两个方向都要，换算出 `w` 的下限 `max(min, min/k)`）、
  **越界回弹**（一律夹在画布内；锁比例时越界要按比例缩回，不能各夹一次把比例夹歪）。
- **比例预设 `CROP_ASPECT_PRESETS`**（自由 / 1:1 / 4:3 / 3:4 / 16:9 / 原图比例）：`applyCropPreset` 按**面积不变、
  中心不变**换比例（老师点 1:1 通常只想微调取景，框子突然铺满会丢掉刚选好的区域），夹进画布后越界回弹。
  「原图比例」= 锁到画布自身比例，因此**锁着比例时裁剪框永远不可能是异比例的整幅画面**（不是 bug）。
- **拖动过程不进撤销栈**：`moveCropDrag` 只改草稿（`setArtworkCropDraft`），`endCropDrag`（松手）才
  `pushArtworkEditHistory` 一步 —— 每帧压栈会把 40 步上限在一秒内用光。2px 抖动阈值同理。
- **`cropAspect` 是纯界面态**（不进 `artworkEdit`）：`''` = 跟随框自动匹配（打开编辑器时的默认，界面上高亮真正
  对得上的那一颗），选定后就是锁定的比例；拖动时若还没显式选过就记为「自由」（否则高亮会自己跳）。
- 踩过的两个坑（都是「看起来只是位置不对」的那种）：
  - **把手要落在框内**（`left:-1px` 而不是 `-8px`）：舞台是 `overflow:hidden`，伸到框外的部分会被裁掉、
    也收不到点击 —— 裁剪框贴着画布边时（很常见）外侧的把手就抓不住了；
  - **角把手的 z-index 要高一层**（`.is-nw/.is-ne/.is-se/.is-sw{z-index:3}`）：框被拖扁/拖窄之后中间那四个
    把手会盖在角上，没有优先级就再也抓不回角。
  - 移动端（≤800px）把手放大到 24px 并**隐藏框内的尺寸标签**（一定会被把手压住，尺寸在上方读数里有一份）。

### 缩放 / 平移与两档预览（US-004c）

- **口径（只有一份，三处共用）**：缩放与平移都相对**裁剪窗口**（`artworkEdit.crop`；没裁剪过时是整幅画面）表达。
  `zoom = 1` 且 `offsetX = offsetY = 0` 是 **identity**（逐像素等于没缩放）；`zoom` 以**窗口中心**为基准缩放，
  `offsetX/offsetY` 是「窗口宽/高的比例」（正数 = 内容往右下走）。范围 0.5×–5×（`ARTWORK_ZOOM_RANGE`），
  量化到 0.01（`clampArtworkZoom`，否则读数与缓存键全是浮点噪声）。
- **偏移区间由「内容与窗口的关系」推**（`artworkOffsetBounds`）：内容比窗口大 → 区间是「刚好盖住窗口」；
  比窗口小 → 区间是「完全落在窗口内」。三个特例都落在同一个公式里：整幅 + 1× → `[0,0]`（居中，不能平移）；
  整幅 + 2× → `±0.5`；10% 窗口 + 1× → `0~9`。**于是画面上永远不会露出内容之外的空背景**。
- **夹取发生在 `normalizeArtworkEdit(raw, windowCrop)`**：第二个参数是「生效窗口」（界面显示的那一版裁剪框），
  缺省取编辑自身的 crop。它**只夹偏移、绝不写 crop** —— 把 crop 写成整幅会把「未手动裁剪（沿用系统识别）」
  偷偷变成「手动裁剪到整幅画面」，下游的纸边自动裁剪就再也不会跑了（本轮真踩：偏移函数往编辑里写了 crop）。
- **一份几何、两处消费**：`artworkImageTransform`（编辑器舞台上 `<img>` 的 inline transform）与
  `renderArtworkCrop`（画布渲染）都读 `artworkImageView / artworkContentRect`，所以「编辑器里看到的 = 成品图」。
  舞台是 `display:inline-block` + 图片自身尺寸 → 归一化坐标直接就是百分比，不必在 JS 里算像素；
  图片的 `transform-origin` 必须是**中心**（几何就是按中心推的）。
- **两档预览（节流）**：操作过程中先给低分辨率稿（长边 ≤ `EDIT_PREVIEW_MAX_EDGE` = 900，120ms 合并连点），
  **停止操作 300ms**（`ARTWORK_PREVIEW_SETTLE_MS`）后合成高清稿（长边 ≤ `EDIT_PREVIEW_HD_MAX_EDGE` = 2400）。
  高清稿按**旋转角记账**（`editorPreviewHdRef`）：缩放 / 平移不改变这张位图（舞台上是 CSS transform 即时生效），
  同一个角不重复编码；`renderArtworkRotation` 在 0° 且源图本来 ≤ maxEdge 时也不重新编码。
- **输出画布的口径没变**：裁剪稿仍是「裁剪区域的原始像素，长边 ≤ `CLEAN_MAX_EDGE`」。缩放只是把内容
  *画进*这个画布（`drawImage` 的目标矩形来自同一份几何），不是把画布放大 —— US-008a 的「高清 PNG 保留
  裁剪后的原始像素」因此仍然成立。
- **手势分工**（同一套指针事件、按 `pointerId` 记账）：把手与「未铺满的整框」= 裁剪拖拽（US-004b）；
  **画面空白处**与「已铺满整幅画面的整框」= 平移画面（框铺满时它本来就无处可移，不让位就再也拖不动画面）；
  两指 = 缩放（锚点 = 两指中点，同时按中点位移平移）；滚轮 = 以指针为锚点缩放。舞台要有 `touch-action:none`；
  双指抬起一根后剩下那根继续平移（不要留在 pinch 模式）。
- **滚轮必须用非 passive 监听**：React 的 `onWheel` 挂在 root 上且是 passive，里面 `preventDefault()`
  会被忽略（症状：缩放的同时整页跟着滚）。做法：`useEffect` 里 `stage.addEventListener('wheel', h, {passive:false})`，
  最新草稿从 `editorDraftRef` 读（监听只挂一次，别反复解绑）。
- **撤销栈节流**：手势进行中只改草稿（`setArtworkViewDraft`），**松手 / 停手 300ms 后压一步**
  （一次手势 = 一步可撤销的操作，连续滚轮的中间值不占步）；按钮缩放是「一步到位」的动作，当场压栈。
  到 0.5×/5× 边界或平移到边界时，缩放 / 平移函数返回**值不变**的编辑 → 界面按 `artworkEditSnapshotKey`
  比较后跳过（内部会重新归一化，对象不是同一个，别用 `===` 判）。
- 已知边界（有意为之）：批量（班级反馈）没有逐幅缩放平移，与 US-004b 的裁剪同一处限制。
  「重置 / 一键还原完整作品 / 四层地址保护」已由 US-005 接上，见下一节。

## 编辑保护：重置 / 回到完整作品 / 四层地址（US-005）

两个「回到已知状态」的动作 + 一层结构性的只读保证，规则都在 **`src/data/artworkEdit.js`** 与
**`src/data/artworkLayers.js`**（都是零依赖纯函数），界面只是按钮与清单。

- **重置（`resetArtworkEdit()` → `canResetArtworkEdit(edit)` 置灰）**：返回 `createArtworkEdit()`，
  也就是「这幅作品从没编辑过」。**不接收入参是刻意的** —— 重置的结果只由默认值那一处定义。
  因为它把 `crop` 变回 `null`，所以确认之后**系统纸边识别会重新跑一遍**（与 `crop: 整幅` 是两条不同的路）。
- **回到完整作品（`restoreArtworkFullFrame(edit)`）**：**保留旋转方向**，把 `crop` 显式写成整幅画面
  （`ARTWORK_FULL_FRAME`）、`zoom` 回 1×、偏移归零。写成整幅而不是 `null` 是关键：`null` 会被下游当成
  「未手动裁剪」去跑系统识别（又裁一次），而这个按钮的意思正是「我要这张完整的画，别再自动裁」。
  由于 `renderArtworkRotation` 在 0° 时不重新编码、`renderArtworkCrop` 在「整幅 + identity + 未超上限」
  时原样返回 source，**画心会逐字符等于原图地址**（一个像素都没有重编码）—— 这也是最好的断言：
  `cleanUrl === orientedUrl === originalUrl`，且成品图里能重新数到本该被裁掉的桌面像素。
- **两个动作都只改草稿**（`applyArtworkEditStep`），各占一步撤销栈（标签「重置编辑」/「回到完整作品」），
  点「完成编辑」才生效。到边界（已是默认态 / 已是整幅 + 1× 居中）时按钮置灰，
  面板上的 `data-edit-protect` 徽标写明现在是哪种状态（默认状态 / 有编辑 · 完整画面 / 已裁剪 · 已缩放平移）。
- **四层地址（`src/data/artworkLayers.js`）**：`originalUrl`（原图，**只读**）→ `orientedUrl`（旋转稿）→
  `cleanUrl`（裁剪稿）→ `framedUrl`（成品图）。`ARTWORK_LAYERS` 是层定义（标签 / 是否只读 / 一行说明）的
  唯一真源，`artworkLayerEntries(artwork)` 给界面与断言同一份清单（`ready / chars / fingerprint`），
  `artworkUrlFingerprint(url)` 是 FNV-1a 32 位（`data:` 地址时它同时是内容摘要，`blob:` 时只是地址标识 ——
  所以界面上叫「指纹」，不下「内容哈希」的结论）。
- **写入侧守卫 `applyArtworkLayerPatch(artwork, patch)`**：渲染流水线写回地址层时走它，
  **`originalUrl` 的写入一律被拒绝并回报 `blocked`**。这是「互不覆盖」在结构上的实现点
  （重新选择素材是新建一条记录，不属于写回，不受这条限制）。
- 两条口径（别当 bug 修）：① 某一层不需要做事时，上层地址会**原样等于**下层地址
  （0° 旋转 → 旋转稿 = 原图；整幅裁剪 + identity → 裁剪稿 = 旋转稿），这是「不重新编码」的优化，
  四个地址仍住在四个字段里；② 重置之后裁剪框可能还显示着**上一次那个框**
  （`cropShownRect = draft.crop || cleanCropRect`，`cleanCropRect` 是「当前画心是哪个框裁出来的」），
  确认后系统识别更新它 —— 「未手动裁剪」的含义是「确认后由系统决定」，不是「框一定要铺满」。
- **未确认退出编辑态 = 丢弃 + 提示**：判据只有 `main.jsx` 的 `hasUnconfirmedArtworkEdit()`
  （编辑器开着且草稿 ≠ 已确认那一版）。目前覆盖四条路径：点「放弃本次编辑」、**离开第二步**
  （`go()` 里，`next !== 2` 时关闭编辑器并提示）、换班（`selectClass`）、新建草稿（`resetDraft`）与
  重新上传作品（`closeArtworkEditor` 由它们调用）。提示文案统一包含「放弃未确认的编辑」，
  验证与文案断言都匹配这句。编辑态本来就是「草稿 + 撤销栈」，所以丢弃是结构性的，成品不会被污染。

## 装裱模板的三层归属：scope / ownerKey（US-001b）
模板分三层「平台（platform）/ 机构（org）/ 老师个人（teacher）」，**三层共用云端 `framing_presets`
一张表**，靠 `scope + owner_key` 区分归属，不另开表、不双写。`preset_key` 仍然是幂等 upsert 的冲突键
（三层的 id 各自唯一，所以 upsert 不会跨层互相覆盖）。

| | 位置 | 约定 |
|---|---|---|
| 层级常量与归一化 | `data/framingPresets.js` 的 `FRAMING_PRESET_SCOPES` / `normalizeFrameScope` / `normalizeFramingPreset` | 零依赖纯函数；**缺失或非法 scope 一律读成 `platform`**（老的 4 套内置预设就是全平台可见） |
| 可见性规则 | 同文件的 `presetVisibleTo` / `filterFramingPresetsForViewer` | 规则只有这一份，界面与读取都调它 |
| 云表列映射 | `services/framingPresetsApi.js` 的 `rowToPreset` / `presetToRow` | snake_case `scope` / `owner_key` ↔ camelCase `scope` / `ownerKey` |
| 读取入口 | `loadRemoteFramingPresets(viewer)` | **不传 viewer = 管理端读全量**（后台要维护每一层）；传 viewer 按 `scope + owner_key` 过滤 |

- 可见性口径：`platform` 所有人可见；`org` 要求 `ownerKey === viewer.orgId`；`teacher` 要求
  `ownerKey` 命中观察者身份。**管理端（`viewer.role === 'admin'`）读全量**，否则后台看不到别的老师的
  个人模板、也就没法清理。原型阶段的老师身份取 `roleMeta.teacher.name`（`林晓老师`），机构 id 取
  `data/lessons.js` 的 `DEFAULT_ORG_ID`；`teacherIdentityKeys()` 同时收 id 与姓名两种写法
  （业务数据里 `teacher-linxiao` 与姓名都出现过）。
- **`org` / `teacher` 模板缺 `ownerKey` 时对老师不可见**（fail-safe：宁可少显示，也不越权展示），
  所以新建个人模板必须带 `ownerKey`：`createEmptyFramingPreset({ scope: 'teacher', ownerKey: 当前老师 })`
  （US-031 的「另存为我的模板」）。`createEmptyFramingPreset()` 默认仍是 **platform**（后台「新增装裱」），
  且 `normalizeFramingPreset` 会把 platform 层的 `ownerKey` 强制清空。
- **状态里存的是「全部模板」，过滤放在消费点**：`main.jsx` 的 `framingPresets` 对管理端是全量；
  老师端在 `TeacherFlowV2` 里用 `filterFramingPresetsForViewer(framingPresets, { role:'teacher',
  teacherName: currentTeacherName, orgId: DEFAULT_ORG_ID })` 再取 `enabledFrames`。
  两层都要做：远端读取按 viewer 过滤（`loadRemoteFramingPresets(viewer)`，单独一条依赖 `[auth, role]`
  的 effect，因为它依赖登录后的角色），**本机兜底路径（云端不通时 state 就是 localStorage 镜像）只能靠
  消费点这道过滤** —— 否则换一位老师登录会看到上一位老师的个人模板。
- 「停用」（`enabled`）与「层级」（`scope`）是两个正交维度：`enabled === false` 只影响可选列表
  （老师端 `enabledFrames`），不影响管理端列表显示；层级过滤也不看 `enabled`。

## 我的模板：老师端「另存为我的模板 / 重命名 / 删除」（US-009）

面板在 `TeacherFlowV2` 的 `frameStylePanel` **底部**（相框网格 → 微调 → 「我的模板」管理块 → 「另存为我的模板」表单）。

| | 位置 | 约定 |
|---|---|---|
| 保存的分组白名单 | `data/framingPresets.js` 的 `FRAMING_PRESET_SPEC_GROUPS` | 只保留 `frame/mat/plaque/watermark/signature/date`；`art`（artworkEdit）与 v1 的 `artRotateDeg` 明确**不进模板** |
| 从渲染视图构造 spec | 同文件 `framePresetSpecFromRenderView(view)` | 入参是 `services/frameSpec.js` 的 **`frameSpecRenderView()` 输出**（渲染层真正读到的那一份）→「所见即所存」，且结构上不可能带上 artworkEdit |
| 构造个人模板 | 同文件 `buildTeacherFramingPreset({name, description, spec, viewer})` | `scope: 'teacher'` + `ownerKey = viewer.teacherName`（缺 ownerKey 对谁都不可见），id 随机唯一 |
| 写权限判据 | 同文件 `framePresetEditableBy(preset, viewer)` / `editableFramingPresets(list, viewer)` | 老师端**只有自己的个人模板**可改 / 可删；平台与机构模板返回 false（管理端 `role:'admin'` 仍为 true） |
| 命名规则 | `normalizeFramingPresetName` / `framingPresetNameIssue` | 空名与重名（同一份可见列表内）给出可读原因；重命名时用 `{ exceptId }` 排除自己 |

- **保存的就是「老师此刻看到的样式」**：`spec` 由 `frameSpecRenderView(effectiveFrameSpec)` 构造，
  所以相框 / 卡纸 / 水印 / 落款 / 时间规则都在，而单幅作品的 `artworkEdit`（旋转 / 裁剪 / 缩放）不在。
  两条已验证的推论：① 保存前后成品图**逐字节一致**（保存后清掉本次微调、切到新模板，渲染结果不变）；
  ② 老 v1 模板没有显式 `frame.lighting` 时保存结果也不写光影（否则会凭空多出一层体积感）。
- 三支叠加元素**总是**写进模板：渲染视图里没有它们时（v1 老模板）写一份 `visible:false` 的最小占位 ——
  「整组缺省」与 `visible:false` 在绘制层逐像素一致（US-003a 已证），模板的样子不会变，但验收要的
  「保存内容含水印 / 落款 / 时间」在结构上成立。
- **老师端不显示系统 / 机构模板的编辑入口**：管理块只渲染 `editableFramingPresets(...)`（= 自己的个人模板），
  网格卡片只带 `data-frame-style-mine` 标记，没有任何 platform / org 的 rename / delete 控件；
  写入侧（`saveAsMyTemplate` / `commitRenamePreset` / `removeMyPreset`）**再判一次** `framePresetEditableBy`。
  服务端的 scope 写权限校验是 US-013 的范围，这里只做界面 + 领域层两道。
- **删除只影响可选列表**：`removeMyPreset` 只从 `framingPresets` 里摘掉这一条（+ 删云端行），
  成品图是保存 / 归档时写下的独立副本（作品位 `writeBack.imageUrl` 与记录 `framedArtwork.imageUrl`），
  删除后归档记录的图**逐字符不变**（已在浏览器里按地址指纹验过）。删掉的正好是当前选用的那一套时，
  `setFrame('')` 让 `activeFrame` 回落到第一套可用模板，不留下指向不存在模板的选中态。
- 保存路径照抄其它实体的口径：先落进受控 state（`main.jsx` 的 `persistFramingPresets` effect 写本机镜像
  并补齐内置样式），再 `saveRemoteFramingPreset`；云端不通时 `catch` 里提示「已保存到本机」，
  **不把 state 回滚**（本机云端表缺 `owner_key` 列，个人模板本来就写不上去）。
- US-006 的微调与 US-007 的叠加元素仍是「本次选用的一层补丁」：保存成我的模板后会把两层补丁清掉
  （内容已经并进新模板的 spec），面板因此不再显示「已微调」。

## 管理端装裱参数面板：六组参数的覆盖矩阵与实时预览（US-011a）

后台「装裱设置」页顶部的参数区（`main.jsx` 的 `FramingSettingsPage` 里 `.framing-params`：
左侧控件、右侧 sticky 预览）。验收原文是「覆盖相框、卡纸、展签、水印、落款、时间的**全部 v2 参数**」，
靠人记一定会漏，所以这里把「覆盖了什么」变成数据：

- **覆盖矩阵是数据，不是记忆**：`data/framingPanel.js` 的 `FRAMING_PANEL_FIELDS` 列出每个 v2 叶子参数
  （点分路径与 `normalizeFrameSpecV2()` 的产物逐字对应，`{机构名}` 这类值当叶子）与它的控件类型；
  界面上的控件一律带 `data-frame-param="<路径>"`。`framingPanelMissingFields(spec)` 拿**收敛后的 v2 spec**
  逐叶子比对，空数组才算覆盖完整；面板右上角「已覆盖 N / N 个参数」的徽标与浏览器断言读同一份。
  **以后新增 v2 参数要同时补三处**：`normalizeFrameSpecV2`、`FRAMING_PANEL_FIELDS`、面板上的控件
  （漏了会被 `framingPanelMissingFields` 在浏览器断言里当场抓住）。
- **改一个字段只写一组 + version**（`framingPanelGroupSpec`）：混写结构在 v2 收敛器里是合法输入
  （v2 分组优先、v1 平面字段兜底），所以后台调相框不会动到落款，老 v1 模板也不必先迁移。
  **面板改的是内存草稿**：只有点「保存到云端」才写回 `framingPresets`。
- **光影的开关就是「有没有 `frame.lighting` 这个键」**（`framingPanelFrameGroup`）：关掉时**删掉键**，
  不是写 `lighting: null` —— 渲染层 `frameSpecRenderView` 的判据是「`frame.lighting` 是对象才算显式给出」，
  两边必须逐字对应，否则会出现「面板显示关着、画面却有渐变」。
- **预览与老师端成品图必须是同一个渲染函数**：`services/framePreview.js` 只做两件事 —— 造占位作品
  （`FRAME_PREVIEW_ARTWORK_SIZE` 900×680）与调 `renderFramedArtwork()`。任何「预览专用画法」最后都会变成
  「面板上好看、老师端不是这样」。占位作品也搬到了这个模块（原先在 `main.jsx` 里），
  这样浏览器脚本能 `await import()` 同一份来做独立重算。
- **展签的 `plaqueVisible` / `plaquePosition` 已接进绘制层**（本故事顺带补的）：`buildFramingLayout`
  用它们决定展签带占开口的哪一端（`plaqueTop` / `area.y` / shaped 的 `artTop`），关掉展签时整条带子还给
  作品区；v1 平面 spec 的渲染视图回落「显示 + 贴底」，所以老模板逐像素不变。arch / bevel 下展签带仍会被
  形状裁剪（这是有意的：宁可裁，也不能越界）。
- **窄屏**：`.framing-settings > .persona-list / .persona-editor` 需要 `min-width: 0`，否则内容的
  min-content 会把分割页那一列顶宽（表现是整个管理页横向滚动，不是参数区自己的问题）。
- `Button`（`src/ui.jsx`）现在会 `...rest` 透传额外属性 —— 面板用它给按钮挂 `data-frame-param`
  （上传类参数的控件就是按钮）。老调用方不传就一个属性都不多。

## 装裱模板库：默认 / 按课程绑定 / 启停排序 / 引用范围与变更历史（US-011b）

模板的**库级设置**在管理端「装裱设置」：左列表每行 =「选中」按钮 + 上移 / 下移 / 启停（`data-frame-library-*`），
右侧编辑区顶部是 `[data-frame-preset-admin]` 块（默认模板 / 老师端可选 / 最后变更 / 引用范围 /
按课程绑定 / 变更历史 / 删除门槛）。领域规则全在零依赖 `data/framingPresets.js`：

| 字段 | 含义 | 写入口径 |
|---|---|---|
| `isDefault` | 默认模板（同一时间只有一套；无绑定课程时老师端用它） | `setDefaultFramingPreset(list, id)`（传空 id = 取消） |
| `boundCourseTypes` | 这套模板绑定到哪些**课程**（课程 id 或课程名都收） | `bindFramingPresetCourse(preset, courseId, bound, {by, at, detail})` |
| `sortOrder` | 列表顺序（管理端上移 / 下移 = 整份重排 1..n ×10） | `moveFramingPreset(list, id, delta)` |
| `updatedBy` / `updatedAt` / `history` | 谁在什么时候改了什么 | **唯一写入口 `stampFramingPresetUpdate(preset, {by, at, action, detail})`** |

- **老师端默认选中 = 三级回落**：`resolveFramingPresetForCourse(presets, { courseId, courseName })`
  → ① 启用中且 `boundCourseTypes` 命中这门课（`source: 'course'`）→ ② `isDefault` 且启用中（`'default'`）
  → ③ 排序第一套（`'first'`）→ ④ `'empty'`。**入参要传「可见全量」而不是筛过 enabled 的列表**，
  否则解析看不到「按课程绑定的那套已被停用」，界面上就无法说明原因（停用 = 不算命中，回落默认模板，
  并把 `disabledBindingName` 带出去）。老师端面板上的只读属性：`data-frame-resolve-source` /
  `data-frame-resolved-id` / `data-frame-default-id` / `data-frame-manual-pick`，说明文字在
  `[data-frame-resolve-text]`（文案由 `framingPresetResolveText` 统一生成）。
- **老师手动选过就以老师为准**：`frame` 为空串才是「跟随默认」，`framePickedManually` 记下手动选择；
  换课程 / 换班（`[activeCourseId, selectedClassId]` 的 effect）会清掉跟随状态，按新课程重新解析。
- **删除规则 = 引用范围说了算**（`framingPresetUsage` + `framingPresetDeleteVerdict`）：引用有三个来源 ——
  ① 是默认模板；② 被 N 门课程绑定；③ **历史成品引用**（成品图写回记录里的 `presetId`，见
  `data/artworkWriteBack.js` 的 `ARTWORK_WRITE_BACK_FIELDS`；单幅保存与批量装裱写回时都会落这个字段）。
  被引用 → 只允许停用（拒绝文案必须点名「只能停用」）；没被引用 → 二次确认后才删，确认文案里也要写影响范围。
- **内置样式库可增删改**：新增样式只填参数（参数面板 + 保存到云端），删除用「删除门槛」那套规则。
  删掉的内置样式靠 `knownBuiltinIds` 快照区分「管理员删掉的」（不补回来）与「版本升级新增的」（自动补进）：
  主键 `xinlehui-framing-presets-v1` **始终保持裸数组**（外部读取方的既有假设不变，改成对象会静默打断
  `JSON.parse(...).find(...)` 的读法），快照另存 `xinlehui-framing-presets-meta-v1`。
  「恢复内置样式库」用 `restoreMissingBuiltinFramingPresets(list)`，**补回来的排在列表最后**
  （列表顺序是管理员维护的，别插回中间）。
- **合并方向：`mergeRemoteFramingPresets(remote, local)` 是「本机镜像优先」**（US-011b 起，之前是云端优先）。
  理由：云端 `framing_presets` 表还缺 `scope` / `owner_key` / `is_default` / `bound_course_types` 列，
  任何一条带新列的 row 会被 PostgREST **整条拒掉**（实测 400 `DATABASE_PGRST204`）→ 模板的写入只在
  **本机镜像**里真正落地，云端那 4 条是 2026-10-09 的旧记录。若让云端优先，管理员刚设好的
  「默认模板 / 课程绑定 / 启停 / 排序」会在下一次进入时被旧记录顶掉。云端只补「本机没有、且不是
  『本机删掉的内置样式』」的 id。等云表补上这些列、写入能成功后，把方向翻回云端优先即可（改一处）。
- **写这个页面时的两个坑**：① 编辑草稿读新字段前先过 `normalizeFramingPreset(draft)`（种子数据 / 老镜像
  里没有 `boundCourseTypes` 等字段，`draft.boundCourseTypes.length` 会直接炸掉整页）；
  ② 管理端列表行不能用 `.frame-preset-row` / `.frame-preset-notice` 这些**老师端已有**的类名
  （flow-v2.css 里那套是「我的模板」的绿色样式，会串味）—— 管理端统一用 `frame-library-*`。

## 大模型入口：自然语言 → v2 装裱参数（US-011c / FR-36）

后台「装裱设置」的「由大模型生成装裱参数」入口在 `services/frameSpec.js`，三个函数就是全部接线：

| 函数 | 职责 |
|---|---|
| `generateFrameSpecV2(description, {signal})` | 调模型。**返回信封** `{ok, model, spec, raw, report, message}`，不抛错 |
| `frameSpecGenerationReport(rawJson, spec)` | 回执：`suggestions`（形状 + 六类位置）与 `converged`（被收敛的非法枚举值） |
| `mergeGeneratedFrameSpec(current, generated)` | 把生成结果并进当前 spec：模型分组覆盖旧的，**素材地址（Logo / 签名图）保留** |

- **提示词就是要求的实现点**：`SPEC_SYSTEM_V2` / `SPEC_USER_V2` 明确要求「形状建议」（`frame.shape`，
  四选一）与「水印位置建议」（`watermark.text.position` / `watermark.logo.position`，九宫格），
  并以 v2 分组结构给出 JSON 骨架。以后验收点名的字段 = 改这两份提示词。
- **输出一律过 `normalizeFrameSpecV2`，永不抛错**：未知形状 / 越界比例 / 非法九宫格 / 白名单外字体 /
  外链二维码目标逐字段回落默认。解析也容错：`extractFrameSpecJsonText` 做**括号配平**扫描
  （不要用「第一个 `{` 到最后一个 `}`」——模型在 JSON 前后各写一句解释时会把两段拼成非法 JSON），
  `parseFrameSpecModelOutput` 解析失败返回 `null`，由 `generateFrameSpecV2` 转成 `ok:false` + 可读文案。
- **失败不阻塞保存**：`ok:false` 时 `spec` 为 `null`，面板只渲染一句红字回执并保持草稿原样；
  「保存到云端」的可用性与生成状态无关（生成只是一次参数填充，不是保存的前置条件）。
- **回执读的是「收敛后的生效值」而不是模型原值**：非法形状 `star` 在建议清单里显示 `square`（直角），
  而 `converged` 那一行才写明「模型给 star」。界面上的 `data-frame-suggestion="<路径>"` /
  `data-frame-converged="<路径>"` 就是断言的钩子。
- **素材保留 + 模式回落**（`mergeGeneratedFrameSpec`）：模型产不出图片地址，所以生成前上传的
  Logo / 签名图必须留住；模型建议 `image` 落款模式但模板上没有任何签名图时**回落文字模式** ——
  `planOverlaySignature` 对「图片模式 + 空地址」返回 `null`，不回落的话落款整块会从成品图上消失。
- **换模板要清回执**：回执描述的是「刚才那一份草稿」，`editingId` 变化（同一个 effect 里
  `setDraft` + `setGenerationReport(null)`）时要一起清掉，否则会显示上一套模板的生成结果。
- **本机开发环境里云端 LLM 是通的**（与 `database` 写不进去相反，2026-10-11 实测真实模型返回了
  arch + 水印位置且 0 处收敛）：生成类功能的验证可以装**透传替身**
  （记录 payload 后 `original.call(completions, payload)`），既抓提示词参数又让真实模型跑完整条链路。

## 装裱移动端与性能：底部抽屉 + 四项性能预算（US-012）

第二步（`TeacherFlowV2` 的 step 2）在 390px 上把「编辑 / 选框 / 调水印 / 保存」全部收进**底部抽屉**，
四项性能验收（合成耗时 / 原图加载与显示 / 拖动帧率 / 内存峰值）也在这里落地。

| 关注点 | 位置 | 说明 |
|---|---|---|
| 预算 / 手机口径 / 四项结论 | `data/framingPerformance.js`（零依赖，Node 可直跑） | `FRAMING_COMPOSE_BUDGET_MS`（桌面 800 / 手机 1500）、`EDIT_BASE_MAX_EDGE`（2400）、`EDIT_BASE_LOAD_BUDGET_MS`（2000）、`EDIT_DRAG_MIN_FPS`（30）、`FRAMING_MEMORY_BUDGET_MB`（300）、`STUDIO_DRAWER_MAX_WIDTH`（430）、`STUDIO_DRAWERS` |
| 浏览器侧的执行 | `services/framingPerformance.js` | `prepareEditBase`（编辑底图）/ `createFrameSampler`（rAF 采帧）/ `createMemorySampler`（`performance.memory` 峰值） |
| 界面上的「装裱性能」读数 | `main.jsx` 的 `framingPerfPanel` | 每行是 `[data-perf-check="compose\|edit-base\|drag-fps\|memory"]` + `data-perf-state/value/budget/text` |

- **两项预算是两套口径，别混用**：`1800px 合成`量的是第二步那一段 `renderFramedArtwork` 的实耗时
  （含底图解码 + 1800×1360 合成 + JPEG 编码），**桌面 800ms / 手机 1.5s**；`原图加载与显示`量的是
  `prepareEditBase` 的「解码原图 + 降采样 + 编码 + 底图可显示」，固定 2 秒（与设备无关）。
- **手机口径 = 三条判据任一命中**（`framingDeviceProfile`）：手机 UA /（触摸屏 + 视口 ≤800px）/ 视口 ≤430px（抽屉断点）。
  第三条是刻意的：抽屉断点本来就是视口口径，预算不跟着切档就会出现「抽屉已经切到手机、合成还按桌面 800ms 判」。
  口径**每次渲染现算**（纯函数），另用一个「口径变了才 setState」的 resize 监听触发重渲染 ——
  React 不会因为 resize 自己重渲染，但也不能每次 resize 都重渲染整个第二步（React 对同值 setState 会直接跳过）。
- **编辑拖动帧率用 rAF 采帧，不用定时器**（`createFrameSampler`）：`beginCropDrag` / `beginViewGesture` 里 `start()`，
  指针全部抬起时 `stop()`（裁剪拖拽与缩放手势共用同一个采样器，`stop()` 幂等，第二次拿到 null 就不重复记录）。
  样本 < 4 帧时 `evaluateDragFps` 给 `ok: null`（「还没量到」）—— 两帧算出来的「500fps」不能当达标证据。
- **编辑底图 = 「先降采样到长边 2400 再编辑」的落地处**：编辑器打开时先 `prepareEditBase`，
  编辑期间的实时预览（≤900）与高清稿（≤2400）都以它作源 —— 避免让 4000px 手机原图在每次微调时重复解码。
  准备期间舞台显示上一版成品图 + `.artwork-crop-preparing` 提示，**裁剪框与把手挂起**
  （`.is-preparing` 下 `pointer-events:none`）：拿旧画幅的框去拖会得到错的几何。
  `editBaseRef` 按「作品 id + 原图地址」缓存，换作品 / 换班 / 重新上传天然作废。
- **四项检查的结论只在 data 层算**：界面与断言都读 `framingPerformanceChecks().rows`，
  不要在面板或脚本里各写一套阈值；`ok === null` = 还没测到（界面显示 pending 灰字，**不能当成达标**）。
- **内存峰值只采样、不刷屏**（`createMemorySampler`）：`performance.memory` 是 Chromium 扩展，
  不支持时如实写「未提供 performance.memory」；峰值只在**抬高 ≥5MB** 时才发布到 state（定时器里 setState
  会让第二步每秒重渲染一次，与 US-413「录入用时不用定时器」同一条纪律）。
- **390px 的四个抽屉**：选框与保存各有 `.studio-drawer-trigger`（桌面 `display:none`）+ 抽屉头（把手 + 完成）；
  编辑器 `is-open` 时自己就是抽屉（头里是「完成编辑」）；水印沿用 US-007 自己的抽屉。
  收起态是 `transform:translateY(102%)` **加** `visibility:hidden`（后者顺手把里面的控件移出 tab 顺序）。
  桌面端（>430px）三块面板仍是内联的宽面板，一行行为都不变。
- **裁剪把手不要套 44px 的移动端兜底**：`.feedback-flow-v2 button` 在 ≤430px 已有 44px 下限，
  但裁剪把手是 `<span>`（24px，US-004b 定的）—— 强行拉到 44px 会把裁剪框撑坏。
- **验证方式**（本故事实测）：`pnpm run build`；Node 直跑 `data/framingPerformance.js` +
  `services/framingPerformance.js` 的可离线部分 **135 项断言**；CDP + headless Chrome **81 项断言**
  （桌面合成 22ms / 手机 67ms、4000×3000 → 2400×1800 用时 34ms、四个抽屉逐个开合、
  在抽屉里改水印与保存（手机 UA 走「长按保存」提示页）、拖动 46fps、内存峰值 102MB、
  390px 下页面与三个抽屉都不横向溢出、切回桌面后口径与内联布局都回到桌面）；
  回归 US-026 **71**、US-027 **79**、US-028 **65**、US-030 **50**、US-031 **53**、US-032 **67**、
  US-034 **106** 全绿；截图 139~144 留档。
- **已知边界**：上传通道本身会把 >3000px 的图降采样到长边 3000（US-408），所以 4000×3000 这种
  「手机原图」只会从历史数据 / 导入路径进来 —— 验收③是按服务层同一个函数（`prepareEditBase`）在页面里
  实测的（4000×3000 → 2400×1800，34ms），UI 侧用 3000×2250 走完整路径（`data-edit-base-*` 读数）。
- **写这类断言的时机坑**：编辑底图要先「解码原图 → 降采样 → 编码 → 底图可显示」才算就绪
  （实测 130~600ms，视冷热缓存而定）—— 断言必须等 `data-edit-base-status="ready"`，
  只等 `data-editor-open="true"` 会读到 `preparing`（本轮踩过，看着像功能坏了）。
  另外 `Emulation.setUserAgentOverride` 之后**要派发一次真实的 resize 事件**（真实浏览器在视口变化时会派发）
  才会重算设备口径。

## 模板写权限 · 审计日志 · 儿童素材合规（US-013）

三件事各有一个零依赖数据模块 + 一个服务模块，界面只渲染、判定一律读同一份纯函数。

| 关注点 | 位置 | 说明 |
|---|---|---|
| 三层写权限（FR-44/45） | `data/framingPermissions.js` | `FRAMING_SCOPE_WRITER`（每层的唯一可写角色）、`framingActor(viewer)`（viewer→操作人）、`framingPresetWriteIssue(preset, viewer)`（能写返回空串，否则可读原因）、`framingPermissionRows`（面板矩阵） |
| 写接口拦截（403） | `services/framingPresetsApi.js` | `assertFramingPresetWrite` / `FramingPresetWriteError`；**保存与删除都必须传 `(preset, viewer)`**（删除也是写） |
| 审计日志 | `data/auditLog.js` + `services/auditLogApi.js` | 动作 `framing.template.save` / `framing.artwork.save` / `framing.template.write-denied`；必填清单 `AUDIT_ACTION_REQUIRED`；四项 `AUDIT_TRACE_FIELDS` = 操作人 / 学员 id / 时间 / 模板 id |
| 儿童素材存储策略（FR-46） | `data/mediaStoragePolicy.js` + `services/mediaStorage.js` | `childMediaUploadHeaders`（缺鉴权抛错、不发请求）、`assertChildMediaStorage`（复核服务端声明的落点）、`probeChildMediaSink`（探 `/health`） |
| 成品图溯源（验收③） | `data/artworkWriteBack.js` | `specSnapshot` 现在是**硬要求**（`artworkWriteBackProblem` 会拒），读数用 `artworkWriteBackTraceability` / `artworkWriteBackTraceText` |

- **写权限是「仅 X 可写」，没有上层代写**：平台模板仅平台管理员、机构模板仅**本机构**管理员
  （`ownerKey === viewer.orgId`）、老师个人模板仅**本人**（`ownerKey` 命中 `teacherId` 或 `teacherName`）、
  家长端三层都只读。管理端仍然**读**全量（US-001b 的读模型不变），但平台管理员**不能**代写机构 / 老师的模板 ——
  这条是要点：`framePresetEditableBy`（US-031，老师端视角）与 `framingPresetWriteIssue`（本故事，四角色矩阵）
  是两份判据，**写入口一律读后者**。
- **界面关入口 + 服务层 403 是两道，缺一不可**：管理端对不属于本层的行关掉 上移/下移/启停/保存/删除
  （`data-frame-preset-writable` / `data-frame-draft-writable` + 只读徽标 + `FRAMING_PRESET_READONLY_NOTE` 文案），
  服务层再拦一次（`assertFramingPresetWrite` → `FramingPresetWriteError`，`status:403`、`code:'forbidden-scope-write'`）。
  服务层的判定在 `upsert/delete` **之前**，所以越权 payload 连云端都不会碰（断言：内存表替身里 `calls.length` 不变）。
- **乐观更新要在权限判定之后**：老师端 `writeTeacherPreset` / 管理端 `commit` 都是「先判 → 不过就记一条
  `outcome:'denied'` 的审计 + 可读提示 + **一个 state 都不改**」；判定失败还去 `setFramingPresets` 就会把越权结果画出来。
- **审计日志只认白名单字段**（`AUDIT_ENTRY_FIELDS`）：手机号、素材地址这类东西结构上进不来
  （断言直接 `JSON.stringify(entry)` 里搜敏感值）。本机镜像键 `xinlehui-audit-log-v1`（裸数组，最多 200 条），
  云端 `audit_logs` 表未建时写入被拒 → 只落本机（与装裱模板同一套兜底口径，读时 `mergeAuditLog` 合并）。
  `recordAudit` 在 `App` 里（本机镜像 + 云端推送），老师端用 `auditTeacherEntry` 补操作人四件套。
- **审计的「四项」不是同一套必填**：另存为我的模板没有学员（`studentId` 空是正常的），
  保存图片必须有学员（`studentId` 是那条成品图的归属）；模板 id 在「保存图片」里是「这次用的哪套」——
  老师没用模板时为空，不算缺。别把四件都写成必填（会把合规记录误判成不完整）。
  **US-111 起动作从三条扩到六条**（观察词 AI 补充的 `keyword.candidates.generate` / `.adopt` / `.discard`，
  必填 `actorId / at / templateId`）：`AUDIT_ACTION_REQUIRED` 是每条的必填清单的唯一真源；
  新动作的 detail 会渲染在管理端「权限与合规 → 审计日志」的第三条 `small` 上（`data-audit-entry-detail`，
  为「采纳了哪些词」这类「具体做了什么」加的），加动作时顺手确认那里读得出关键内容。
- **儿童素材的两条防线都在客户端这侧强制**：`childMediaUploadHeaders` 缺「老师身份 + 监护人授权」直接抛错
  （旧写法是一份写死的常量头，谁调都带）；`assertChildMediaStorage` 复核响应里的 `storage`
  —— 落到 `server-local-disk` / 公开地址 / 没登记的落点一律拒绝（服务端 `GET /health` 的 `storage`
  与 `GET /api/compliance/storage-policy` 是它的对侧声明）。
- **验证「写权限」用页面内直调服务层**（`await import('/src/services/framingPresetsApi.js')`）：
  一次拿到七种越权路径的 `{status, code, scope, message}`。**「放行」的判据不能写 `threw === false`** ——
  本机云端 `framing_presets` 缺列（`DATABASE_PGRST204`，US-011b 的既有事实）会让「合格的那几条」也抛错；
  正确判据是「没有被 `forbidden-scope-write` 拒绝」。
- **元素级截图要用文档坐标**：`Page.captureScreenshot` 的 `clip` 是**页面坐标**（不是视口坐标），
  要用 `getBoundingClientRect() + scrollX/scrollY` 并配 `captureBeyondViewport: true`，
  否则截出来是空白（本轮踩过）。
- **验证方式**（本故事实测）：`pnpm run build`；Node 直跑 data + service **147 项断言**
  （三层写权限矩阵 12 种身份组合、服务层 403、四项溯源逐项缺一被点名、存储落点与鉴权、日志白名单/上限/合并）；
  CDP + headless Chrome **93 项断言**全绿、console 0 异常（受控上传的真实响应落点 = `memory-development-only`、
  老师提交 `scope=platform` 被 403、另存为我的模板与保存图片两条审计在面板与本机镜像里四项齐全、
  管理端矩阵 / 只读入口 / 存储策略探测）；服务端另用 curl 验过三条（无鉴权 403 / 无授权 403 / 齐全 201 且
  `server/data/` 不落素材）；回归 US-027 **79**、US-030 **50**、US-031 **53**、US-032 **67**、
  US-033 **71**、US-034 **106**、US-036 **81** 全绿；截图 145~148 留档。
- **已知边界**：① 云端 `audit_logs` 表尚未建立，审计目前只在本机镜像里「真的落地」，跨设备可见要等建表；
  ② 「渲染接口」在原型里就是 `services/framingPresetsApi.js` 这一层（`cloud.database` 是它后面的库），
  真实部署时要把它搬到服务端函数里（本故事的判定函数可直接复用）；
  ③ 机构管理员角色目前只在权限层与「权限设置」页的角色组里存在，还没有机构管理员的登录入口。

## 第三步「五维点评」的 system 提示词：模块化与逐字符兼容（US-101 / F-REVIEW-PROMPT-01）

第三步生成点评的 system 提示词由**有名字、有版本、有来源、有字符数**的模块拼成。
模块名与拼装顺序的唯一真源是 `src/data/promptModules.js`（零依赖，可 Node 直跑）：
拼装本身、「加载了哪些提示词」的展示（US-103）与轨迹留档（US-102 的 `loaded.modules`）都读这一份，
**不要在 `llmReview` 或界面里另写一套模块名 / 顺序**。

- 两个入口（都在 `src/services/llmReview.js`）：
  - `buildPersonaSystemPrompt(profile, extra)` → **字符串**（向后兼容入口，`streamArtworkReview` 仍在用）；
  - `buildPersonaPrompt(profile, extra)` → `{ system, modules }`，每项含
    `id / title / content / version / source / chars / included`。
    两者的 `system` 永远相同（前者就是后者的 `.system`）。
- **目录顺序 = 老师人设分支的拼装顺序**（也是加载清单的展示顺序）：
  `base_role → identity → beliefs → tone → boundaries → agent_md → skills → memory → task
  → keyword_candidates → writing_rules → keyword_rules → output_format → subject`
  （对应 US-105 的加载顺序：agent.md → 技能 → 记忆 → 观察词候选 → 写作与输出）。
  新增模块插进 `PROMPT_MODULE_DEFS` 的对应位置，**不要另开一个顺序常量**。
- **没有老师人设时的兜底分支是另一套历史顺序**（`PROMPT_MODULE_ORDER_FALLBACK` =
  `base_role → writing_rules → keyword_candidates → keyword_rules → output_format`）：
  它是 US-101 的逐字符兼容承诺（改造前就是这个顺序），**不要为了「顺序统一」去改它**。
- **每段正文 = 「原样进入 system」的那一段**（含 `【…】` 小标题与换行）：两个分支各有一个内容表函数
  （`fallbackModuleContents` / `personaModuleContents`）。改文案只改这两处，并**同时抬高模块的 `version`**
  —— 轨迹留档靠版本复现「当时用的是哪一版」。
- **没进入本次提示词的模块也留在 `modules` 里**（`included:false`、`content:''`），排在参与拼接的模块之后，
  界面才能说明「这个模块为什么没加载」；拼接与字符数只算 `included`
  （恒等式 `assemblePromptText(modules) === system`）。
- 模块 id 必须登记在 `PROMPT_MODULE_DEFS`：`createPromptModule('未登记的 id')` **直接抛错**
  —— 未登记的 id 拼不进 system，静默兜底会让提示词悄悄少一段。
- `agent_md` 目前只有入口（不传 `extra.agentMd` 就完全不出现；位置在 `boundaries` 与 `skills` 之间）；
  加载规则、版本化与 8000 字符预算属 US-105。
- 验证方式（本轮实测）：改造**前**先抓一份 13 组输入的 system 快照，改造后逐字符比对 +
  `streamArtworkReview` 真发的 `messages[0].content` 比对；Node **172 项** + 浏览器 **15 项**断言全绿。

## 第三步「五维点评」的课次上下文：课题与课次日期（[第三步到第一步联通] US-057）

第三步点评的**课题**与**课次日期**不是界面自己编的，它们与第一步的课次实体是同一份数据：

- 领域规则全在 `src/data/reviewSubject.js`（零依赖纯函数，可 Node 直跑）。
  `reviewLessonContext()` 一次产出 `{ lessonId, classId, courseId, courseName, courseLabel,
  lessonNo, lessonDate, lessonDateDots, topic, contextSource, usesLesson, options }`；
  `resolveReviewSubject()` 产出下拉的选中值；`reviewSubjectContextNote()` 产出面板那一行说明。
  **界面下拉、点评提示词（`【本次课题】` 与 user 内容里的课次日期）与轨迹留档三处读同一份产物**，
  不要在别处再算一遍「这次课题是什么」。
- **课次实体优先，但只在自然键一致时**（`classId + lessonDate + lessonNo` 三项齐全且逐项相等）。
  对不上（换班 / 改日期 / 改序号）或这次课次还没保存时以**第一步表单**为准 ——
  否则「补录上节课」的点评会印着上一条课次的日期（US-038 修过的同一类错配）。
  判断本身是纯函数 `reviewLessonMatches()`，缺任一项一律**不认**（认不出来比认错一次课安全）。
- **下拉选项 = 本次课次的课题 + 课程库**（`课程名（年龄段）`，`selectableCourses()` 过滤停用的）。
  本次课次的那门课程即使已停用也留在列表里（历史课次不能因为课程停用就丢名字）。
  **US-057 起没有任何写死的课题 / 课程类型字符串**：新加选项只能从课程库来。
- **老师手选过就以老师为准**（`subjectPicked` + `subjectPick`，与 `lessonNoDirty` / `framePickedManually`
  同一套「派生值 + 手改标记」写法）；手选的值不在选项里（例如课程被删了）时自动落回派生值，
  受控下拉不会出现空选中。标记在**换班 / 换课 / 新建草稿**时清掉（那些动作等于换了课次上下文），
  改日期 / 改序号时保留（课题仍按课程 + 课时序号取）。
- **课次日期进提示词有两个口径**：展签口径 `2026.08.04`（`formatLessonDateDots`）进 user 提示词的那一行
  `课次日期：…` 与 `{课次日期}` 变量（`agentFileLoadout` 的 context）；ISO 口径进轨迹留档
  （`REVIEW_TRACE_FIELDS` 的 `lessonDate` → 管理端生成日志详情面板的「课次日期」）。
- `buildReviewPromptBundle()` / `streamArtworkReview()` 新增可选入参 `lessonDate`：
  **不传时那一行完全不出现**（老调用方 / 回归夹具的 user 文本逐字符不变）；日期认不出时也不印半行。
- 观察词模板的匹配输入仍是 `[本次课程名, 第三步选中的课题]`：课程库的课程名（如「色彩启蒙」）
  照样能命中绑到那门课的模板，只是「课程类型」不再是写死的字符串（见 US-109 一节）。
- 验证方式（本轮实测）：Node **70 项**断言（data 52 / 提示词 10 / 轨迹 8）+ 浏览器 **54 项**断言 +
  观察词匹配回归 **10 项**；回归 US-113 81 项、US-112 102 项全绿。**注意**：US-110a / US-110b
  当时的本机脚本依赖「在第三步下拉里选到 `通用美术` / `国画（6-18岁）`」，那些字符串已按本故事删除
  （要复现那两条回归，改为选课程库里的课程标签，例如 `色彩启蒙（4-5岁）`）。

## 第三步「五维点评」的推理轨迹 reviewTrace（US-102 / F-REVIEW-TRACE-01）

一次点评生成的全部关键信息结构化留档（模型与参数、加载清单、提示词、推理过程、输出原文、
耗时与用量、状态与错误）。唯一真源是 `src/data/reviewTrace.js`（**零依赖**，可 Node 直跑），
云端表读写是 `src/services/reviewTraceApi.js`（表名 `review_traces`，`trace_key` 幂等），
采集点在 `src/services/llmReview.js` 的 `streamArtworkReview`，提交点在 `main.jsx` 的
`commitReviewTrace`（**归档那一刻**才调用）。

- 字段（`REVIEW_TRACE_FIELDS` 白名单构造）：`traceId / parentTraceId / task / taskLabel /
  studentId / lessonId / model / timing / usage / loaded / prompts / reasoning / output /
  status / statusLabel / error / createdAt / archivedAt / recordId`。
  `recordId` 是归档时写进去的关联（哪条成长档案用了这次生成），生成期是空串。
- **timing 记的是三个独立时长**（PRD FR-104）：`firstTokenMs`（首字延迟）、`thinkingMs`
  （思考耗时 = 首字 → 正文开始）、`totalMs`（总耗时 = 入队 → 收束），外加五个时刻与
  `queueMs`（排队 = 入队 → 请求开始）。**别把「已用时」当成 totalMs** —— 那是界面秒表，
  轨迹要的是可复现的实测值，断言用 `>= 延迟量` 的口径（真实网络下不能写死等值）。
- **usage 是四项 tokens + 单次成本估算**：`REVIEW_MODEL_PRICES` 是单价的唯一真源，
  reasoning tokens 按输出价计；未登记的模型用 `REVIEW_MODEL_FALLBACK_PRICE` 并标 `priced:false`。
  **没有 token 时 `cost` 是 `null`，不要编造 0 元账单**；已有 `cost` 的旧记录不被重算
  （历史账单口径不覆盖）。
- **图片只记引用与 hash**：`buildReviewTraceAttachment` 从真正发给模型的 data URL 算出
  `bytes` + FNV-1a 8 位 `hash`（与 `artworkUrlFingerprint` 同一算法，但**不 import** 它 ——
  data 模块保持零依赖），条目里只有「附件序号 / 类型 / 角色 / 文件 id / 文件名 / mime /
  字节数 / hash」。`reviewTraceMediaViolations()` 是守卫（落盘前 `sanitizeReviewTrace` 复核），
  它只点名**值真的像素材正文**的 `dataUrl / base64 / content` 字段 ——
  提示词模块的 `content` 是合法字段（US-101），按键名点名会把 14 个模块全误判成违规。
- **失败与中止同样留档**：`status` 三种结局 `success / failed / aborted`，`reasoning` 与
  `output.raw` 保存**中止前已经拿到的部分**（不是丢掉）。错误码口径见 `reviewTraceErrorOf`：
  业务码（`error.code` / `error.error.code`）优先，没有就用调用方给的 fallback
  （流异常 `stream-error`、解析失败 `invalid-output`、老师中止 `aborted`）——
  **不要**让错误码退化成 JS 的 `Error`。
- **轨迹的生命周期只有一条**（`createReviewTrace → startReviewTrace → markReviewTraceFirstToken
  → markReviewTraceContentStart → finishReviewTrace`），全在 `streamArtworkReview` 里，
  收束（成功 / 失败 / 中止 / 解析失败四条路径）走同一个 `finishReviewTrace` 并**恰好调一次**
  `onTrace`。调用方不要再造第二份轨迹，也不要自己拼 timing。
  `startReviewTrace` 在**开始迭代流之前**调用（请求真正开始的时刻），四个 mark 函数是
  幂等的「只记第一次」。
- **生成期只驻留内存**（US-102 的隐私口径）：轨迹进 `main.jsx` 的 `reviewTraceRef`
  （以及只读调试钩子 `window.__xinlehuiReviewTrace`，与 `__xinlehuiFeedbackMode` 同类），
  归档时才 `persistReviewTrace`（本机镜像 `xinlehui-review-traces-v1`，上限 200 条）
  + `saveRemoteReviewTrace`（云端 `review_traces` 表还没建时会被拒，只影响跨设备可见）。
  **换班 / 换学员 / 换模式 / 新建草稿必须 `clearReviewTrace()`** —— 留着上一位学员的轨迹，
  下一次归档会把别人家的点评详情一起交上去（与 `currentRecordId` 同一套清理纪律）。
- `parentTraceId` 由调用方给：重新生成时传上一次的 `traceId`，于是「成功 → 中止 → 失败」
  是一条可追的链（US-107b 的两次对比读它）。
- 验证方式（本轮实测）：Node 直跑 `data/reviewTrace.js` **114 项** + 服务层（替身云模型，
  覆盖成功 / 失败 / 中止 / 解析失败 + 云端行列映射与落库前隐私复核）**70 项**；
  用 `git show HEAD:...llmReview.js` 取改动前的入口跑 **58 项**提示词逐字符回归；
  浏览器 **61 项**（headless Chrome + CDP：登录 → 上传真实 PNG → 裁剪装裱 → 第三步，
  用同一个 ESM 单例替换 `cloud.llm.chat.completions.create`，断言「生成后未落盘 →
  归档后镜像里有轨迹且带 recordId」、重新生成的 parentTraceId 链、中止 / 失败两种收束）；
  截图 157 / 158 留档。

## 第三步「五维点评」的本次点评详情面板（US-103a 折叠态 / US-103b 六分区与导出）

第三步的「本次点评详情」面板**默认折叠**：平时只占一行摘要，点摘要行才展开六个分区
（推理过程 / 加载清单 / 提示词 / 模型与参数 / 用量与耗时 / 输出原文）。摘要文本、实时状态、
六个分区的内容与「复制全部 / 导出」文本的唯一真源是 `src/data/reviewDetailPanel.js`
（纯函数、不碰 DOM / 网络；只 import 同层的 data 模块复用格式口径，可 Node 直跑断言），
界面（`main.jsx` 的 `ReviewDetailPanel`）不自己拼字符串。

- 折叠态摘要 = `reviewDetailSummary({ loaded, model, phase, elapsedMs, reasoningChars, content, message })`：
  `已加载 agent.md v3 · 5 项技能 · 1 个记忆文件 · 观察词模板 v1 · 模型 glm-5.3-flash · 已用时 12.3 秒 ·
  思考 480 字 · 正文 2/5 维 · 312 字`。生成中写「已用时」，收束后写「共 N 秒」；失败再接
  「生成失败：<可读文案>」，老师停止接「已停止生成」。
- **「加载了什么」必须来自提示词拼装处的那一份数据**：`startCloudReview` 里先 `buildPersonaPrompt(...)`
  拿 `modules`，再 `reviewDetailLoaded({ modules, skills, memory, keywordTerms, keywordGroups })` 落进
  `reviewLoaded` state —— 与真正发出去的 system 是同一个函数的产物，不要在面板里另推一套。
  `items` 每项带 `included` 与没加载的原因（加载清单直接渲染它，`reviewDetailLoadedRows` 归一成一行文案）；
  `modules` 项不进摘要（14 项太长），它只出现在展开后的「提示词模块」子清单里。
- **正文进度按维度解析流式半成品 JSON**（`reviewContentProgress`）：维度键已出现但字符串未闭合也算
  「已落笔」，字数是已收到的部分；`ratio` 让「5/5 维」与「进度条满格」同时成立（写完的维度各占一格、
  正在写的那一维按字数补）。维度名与顺序的唯一真源是 `REVIEW_DIMENSION_NAMES`：
  `llmReview.js` 的 `DIMENSION_SPEC`（提示词与解析）与 `main.jsx` 的 `reviewDefaults`（五个编辑区）
  都从它派生 —— 改维度名只改这一处。
- **面板状态与流内容分开**：`reviewStream = { phase, reasoning, content, message, startedAt, elapsedMs }`
  只管内容与阶段，折叠与否是 `reviewDetailOpen`（默认 `false`）。**折叠只影响渲染**（正文 DOM 整个不渲染），
  所以「折叠后再展开不丢内容、也不重新请求模型」是结构上的结论；`data-detail-requests`
  （`reviewRequests`，每次 `startCloudReview` +1）是这条的读数探针，别删。
- **秒表按 `startedAt` 推算**（每 1 秒 tick 一次 `elapsedMs`），不要累加：折叠/展开、切步骤回来都不会
  算丢或算重；收束（成功 / 失败 / 停止）时把 `elapsedMs` 冻在 `Date.now() - startedAt`，此后不再涨。
- **推理过程不做打字机缓冲**：`<pre data-detail-reasoning>` 直接渲染推理增量，模型来一段就长一段
  （缓冲会吞掉 / 滞后内容，也难断言）；`data-detail-reasoning-chars` 是当前字数，等于文本长度。
- 面板只挂在**第三步**（`step===3 && phase!=='idle' && reviewDetailSurfaceAllowed({surface:teacher-flow, role})`），
  跟随 `reviewStream.phase` 出现，生成前完全不渲染。
  「停止生成」把 phase 写成 `'stopped'`（**不是**回到 `idle`）：已停止要能显示出来，停止前的增量也要留着。
  `ReviewLaunchPanel` 在生成中把「开始生成点评」置灰、人设选择器禁用，避免误触重启（重启入口是面板上的
  「重新生成」）。

### 六分区与「复制全部 / 导出」（US-103b / FR-110、FR-113、FR-114）

- **一份载荷喂六个分区 + 两种导出**：`reviewDetailPayload({ phase, student, lessonDate, model, params,
  requests, message, loaded, prompt, reasoning, output, usage, timing, traceId, taskLabel, exportedAt })`
  返回 `{ version, exportedAt, meta, sections[6], mediaSafe, mediaViolations }`；
  `reviewDetailMarkdown(payload)` / `reviewDetailJsonText(payload)` 与「复制全部」读**同一份载荷**，
  所以「界面上看到什么」与「导出里有什么」不可能漂移。界面只做 `sectionOf(key)` 取分区再渲染。
- **分区键与标题只写一次**：`REVIEW_DETAIL_SECTIONS`（顺序 = 界面顺序 = 导出顺序），
  界面用 `data-detail-section="<key>"` 渲染，验证脚本按同一份顺序断言。
- **「面板上看到的就是实际用的」靠同源，不靠人工对齐**：`services/llmReview.js` 的
  `REVIEW_MODEL_PARAMS`（stream / response_format / stream_options / reasoning_effort / temperature）
  是**真实请求参数**的唯一真源，调用点展开它、面板读它；`buildReviewPromptBundle(...)` 返回
  `{ system, user, modules, attachments }`，`streamArtworkReview` 内部与 `main.jsx` 的面板读**同一个纯函数**
  （`user` 只有文字、`attachments` 只有引用与 hash，图片正文结构上进不来）。
- **用量 / 耗时 / 输出原文以轨迹为准**：`onTrace` 落一份**渲染副本** `reviewTracePanel`（ref 仍只管归档留档），
  面板的「用量与耗时」「输出原文」优先读它，生成中回落读流式增量；
  时长文案走 `reviewTraceSecondsText`、素材体积走 `artworkExportSizeText`，不要再写第二套格式函数。
- **导出时间戳按一次生成冻结**（`exportedAtRef`，`requests` 变化时重置）：否则同一份内容两次导出会因为
  `new Date()` 不同而出现「复制全部 ≠ 导出 Markdown」；冻结后两者必须**逐字符相同**（浏览器断言就是这么比的）。
- **家长端与家长分享页不存在入口**（FR-114）：`REVIEW_DETAIL_SURFACES` +
  `reviewDetailSurfaceAllowed({ surface, role })` 是唯一判据（只有 `teacher-flow` + 非家长角色放行），
  界面渲染前问它、验证脚本在家长端每个页面上问同一份。以后新增「家长分享页」时必须复用这个函数，
  不要另写 `if (role==='parent')`。
- **导出/复制里不许出现素材正文**：载荷自带 `mediaSafe` / `mediaViolations`
  （复用 `reviewTraceMediaViolations` 的同一条守卫），导出与复制都只是字符串搬运；
  文件名 `点评详情_<学员>_<课次日期>.{md,json}` 复用 `sanitizeArtworkExportSegment` / `artworkExportDateText`
  （与「保存图片」同一套文件名纪律）。
- **只读 DOM 探针是验收的读数**：`data-review-detail-surface`、`data-detail-open`、`data-detail-sections`
  （=6）、`data-detail-section` / `-title`、`data-detail-loaded-item` / `-included`、`data-detail-module` /
  `-included`、`data-detail-prompt-system` / `-user`（+ `-chars`）、`data-detail-attachment`、
  `data-detail-model`、`data-detail-param`、`data-detail-token` / `-timing`（`data-detail-value` 给原始值）、
  `data-detail-cost`、`data-detail-output` / `-chars` / `-parse`、`data-detail-copy-state`、
  `data-detail-export-state`。新增分区请沿用这套命名。
- 验证方式（本轮实测）：Node 直跑 `data/reviewDetailPanel.js` **26 项**（六分区 / 加载清单行 / 附件引用 /
  参数行 / 用量与耗时 / 解析状态 / Markdown 与 JSON 往返 / 文件名 / 界面白名单 / 脏输入容错 / 确定性）
  + 服务层 **16 项**（`REVIEW_MODEL_PARAMS` 与 HEAD 内联参数逐字段一致、5 组输入「真发 payload 逐字段一致」、
  面板提示词 = 真发 messages）+ 回归（US-102 数据 114 / 服务 70、US-101 提示词 172、trace 58）；
  浏览器 **51 项**（headless Chrome + CDP + 替身：折叠态不渲染正文 DOM → 生成 → 展开六分区逐项对照
  真发 payload / 轨迹 → 剪贴板「复制全部」→ 真实落盘导出 JSON 与 Markdown（内容与剪贴板逐字符相同）→
  折叠再展开不丢内容且不重新请求 → 390px → 家长端逐页扫描无入口 → 0 异常），截图 165~169 留档；
  US-103a 的 52 项浏览器断言作为回归全绿。


## 第三步「五维点评」的移动端与流式渲染性能（US-113）

六项预算（批量 flush 100ms / 展开折叠 100ms / 主线程长任务 200ms / 长推理 10000 字 / 手风琴 430px /
内存 300MB）的唯一真源是 `src/data/reviewStreamPerformance.js`（零依赖、可 Node 直跑）；
浏览器侧的执行（增量缓冲、长任务观测、响应计时、滚动测量、内存采样）在
`src/services/reviewStreamPerformance.js`。界面的「点评性能」读数面板、浏览器断言与 Node 断言
读的都是 `reviewPerformanceChecks()` 的同一份 `rows` —— **不要在面板或脚本里另写一套阈值**。

- **推理 / 正文增量按 ≥100ms 批量 flush**：`createReviewStreamBuffer()` 接在
  `streamArtworkReview` 的 `onReasoning` / `onContent` 上（`main.jsx` 的 `startCloudReview`），
  逐 chunk 进来的只是攒着（`push*`），距上次渲染够 `intervalMs` 才写 state；到点未渲染的登记一次
  补渲染（多个 chunk 只登记一次）。**首字立刻渲染**（第一次 push 就是开头），收尾（成功 / 失败 / 中止）
  在 `finally` 里 `flushNow('settle')` + `stop()`，并把原始计数交给 `setReviewStreamStats`。
  被新一次生成顶掉的那一代由 `reviewStreamBufferRef.current===streamBuffer` 拦住，绝不回写界面。
- **「还没 flush 过」不能用 0 当哨兵**（本轮真踩，Node 断言当场抓到）：注入时钟 / 相对时间下第一次
  flush 就发生在 0，`if(!lastFlushAt)` 会让**每一次 push 都立刻渲染** —— 逐 chunk 渲染的 bug 原样回来。
  服务层用 `lastFlushAt = null` 表示「还没 flush 过」。
- **收尾补渲染不计入「相邻渲染间隔」**：settle 那一次可能紧跟最后一次周期渲染（实测差 1ms），
  算进去会把「流结束」误判成「渲染太快」。`reviewStreamFlushStats({chunks,times,reasons})` 因此
  只对 `push` / `timer` 两类算间隔（`cadenceGaps` / `intervalOk`），`settleFlushes` 单列并在文案里写明。
  「不逐 chunk」的判据是 `batched = chunks > 1 && flushCount < chunks`。
- **摘要里的「已用时」按 `startedAt` 当场推算**（`ReviewDetailPanel` 的 `elapsedMs`），不再只读 1 秒一次的
  tick：批量 flush 之后渲染节奏本来就是 ≥100ms 一次，只读 tick 会让读数卡在上一秒（US-103a 的
  「已用时随时间增长」断言会因此变红）。收束后仍读冻住的 `stream.elapsedMs`（共 N 秒）。
- **响应时间 = 点一下 → 界面提交**（`createResponseProbe`：点击处 `start()`，`useEffect` 里 `end()`；
  面板展开收起与分区手风琴共用一个探针，报最慢的一次）。验证脚本用 `MutationObserver` 独立量同一个时刻
  （微任务回调 = DOM 改完的那一刻）。**注意**：headless Chromium 里首次挂载 / 首次卸载整块正文本体要现算
  这套子树的样式（实测 60~70ms 提交 + 首帧 ~150ms 的一次性开销，272 个节点），二次起 5~17ms；
  读数里如实分开记这两件事，别把「首帧慢」当成「React 慢」。
- **长推理（>10000 字）展开后可滚动**：面板量自己那个 `<pre>` 的 `scrollHeight / clientHeight`
  （`measureReasoningScroll`）后报给上层；键里带上 `requests`，重新生成后会重报一次（否则读数会停在
  「等展开后量一次滚动区」）。`scrollable` 为 null（折叠中 / 量不到）时这一行给 `ok: null`，不写成
  「滚不动」。
- **390px 六个分区走手风琴**：`reviewAccordionMode({viewportWidth})`（≤430px）+ `reviewSectionOpenPlan()`
  （手风琴只展开第一个分区，桌面六个平铺）+ `toggleReviewSection()`（手风琴同时只展开一个，允许六个全收起）。
  展开集合住在 `TeacherFlowV2` 的 `reviewOpenSections`（视口口径一变就重置成该口径的初始计划）。
  每个分区：只有 `accordion` 为真时标题才是按钮（`data-detail-section-toggle`），正文本体包在
  `data-detail-section-body` 里、收起时挂 `hidden`（**DOM 还在**，所以文案 / 导出断言不受影响；
  「折叠态不挂载正文 DOM」指的是面板整体折叠那一条）。桌面端不渲染标题按钮，六个分区与 US-103b 一字不变。
- **读数探针**：面板根 `data-review-perf` / `-measured` / `-total` / `-all-ok` / `-summary`，
  批量 flush 的原始证据 `data-review-flush-chunks` / `-count` / `-batched` / `-per-flush` / `-min-gap` /
  `-max-gap` / `-interval-ok` / `-settle`，六行 `data-review-perf-row="<id>"` + `-state`（ok/over/pending）。
  只读调试钩子 `window.__xinlehuiReviewStream={flush,thread}`（原始 flush 时刻与观测方式，供脚本独立重算）。
- **验证方式（本轮实测）**：`pnpm run build` 通过；Node 直跑 `data/reviewStreamPerformance.js` +
  `services/reviewStreamPerformance.js` **143 项**（常量 / flush 延迟 / 批量读数与结论 / 响应 / 长任务 /
  长推理 / 手风琴计划与切换 / 六项汇总 / 零依赖检查 / **注入时钟下的缓冲批量行为**）；
  浏览器 **81 项**（headless Chrome + CDP + 慢速与快速两种替身：折叠态不挂载正文 DOM → 批量 flush 的
  间隔与次数（收尾补渲染单列）→ 长任务（产品与脚本各测一次）→ 12600 字推理滚动 → 展开折叠响应提交 →
  内存峰值 → 快速流批量倍数 → 桌面六分区平铺回归 → 390px 手风琴逐个展开 + 44px + 不横向溢出 → 0 异常），
  截图 242~244 留档；回归 US-103a 浏览器 52、US-103b 浏览器 51、US-107b 浏览器 63、US-112 浏览器 101 全绿。


## 第三步「五维点评」的技能加载清单（US-104 / F-REVIEW-SKILL-01）

「这次点评用了哪几项技能、没用上的又是为什么」的唯一真源是 `src/data/skillLibrary.js` 的
`skillLoadout({ skillKeys, library, legacySkills })`（零依赖，可 Node 直跑）。它**同时**产出三样东西：
① 加载清单的逐项行 `rows`（全部技能 + `included` + 没加载的原因 + 进入提示词的原文片段）、
② 提示词里【已启用技能】段落的正文 `content`（空串 = 这个模块不出现）、③ 计数 `counts`。
面板 / 提示词 / 断言四处读的都是它 —— **不要在任何一处再按 `enabled` 过滤一遍**
（一处按 enabled 过滤、另一处忘了，就会出现「清单说没加载、提示词里却有」）。

- `services/llmReview.js` 的 `personaModuleContents` 用 `loadout.content` 拼技能段落（改造前是内联
  `skills.map(...)`，两种写法输出**逐字符一致**，14 组输入的回归断言就是比这个）；`extra.skillLoadout`
  可注入同一份产物 —— `main.jsx` 的 `startCloudReview` 就是这么做的（一次计算同时喂
  `buildPersonaPrompt` 与 `reviewDetailLoaded`）。
- **未加载原因三种，判定优先级：库中停用 > 未被人设勾选**（库的维护动作更该被看见）；人设勾了、库里
  没有的 id 单独补一行并点名「技能 id 在库中不存在」；旧数据里**内嵌**的技能对象（不在库里但真的进了
  提示词）也补一行，来源标「人设内嵌（旧数据）」。少的这三类，「清单 vs 提示词」就对不上了。
- **`chars` 是技能描述的字符数**（与加载清单「技能 · N 项 · M 字」同一口径，只对已加载的求和）；
  一整行是 `lineChars` / `excerpt`（`- 技能名：描述`）。原文片段必须**逐字符**取自
  `skillPromptLine()`：浏览器断言就是 `system.includes(excerpt)` + 「清单里已加载的片段拼起来 == 提示词段落」。
- `data/reviewDetailPanel.js` 只做展示归一：`reviewDetailSkillRows()` 接受 `skillLoadout()` 产物或
  **已经解析好的技能数组**（老调用方 / 断言夹具）。数组分支要**先认已有的 `reasonKey` / `included`** ——
  一律当成「已加载」会把停用项画成已加载（本轮真踩）。载荷的 `loaded` 分区新增
  `skills / skillsIncluded / skillsTotal / skillsEmpty / skillsNote`，Markdown 导出多一节
  「技能清单（N/M 项已加载）」，一项都没勾时结算 `SKILL_EMPTY_TEXT`「本次未启用任何技能」。
- **面板读数（验收探针）**：`data-detail-skills`（+ `-included` / `-total` / `-empty`）、
  `data-detail-skills-note`、`data-detail-skill`（= id）/ `-included` / `-reason`
  （`included | not-selected | disabled | missing`）/ `-category` / `-source` / `-chars`，
  每行 `<details>` 里的 `data-detail-skill-excerpt`。
- **验证要点**：停用技能后要**重新生成**才能看到新清单（清单来自生成开始时那一次拼装）。
  切身份必须用**顶栏「切换体验身份」**（同一会话、不刷新）：刷新会让挂载时那批云端读取
  （`src/main.jsx` 的 `loadRemoteSkillLibrary()` / `loadRemoteTeacherProfiles()`，deps 为 `[]`）
  把刚改的本机改动顶掉。断言「停用同步到云端」要**轮询**（写入是异步的，直接读会读到旧值）；
  技能行的细节列在 390px 下要能被压窄换行（`flex: none` + 长文案会把面板顶出横向滚动条）。
- 验证方式（本轮实测）：Node 直跑 `data/skillLibrary.js` + `data/reviewDetailPanel.js` **26 项**；
  与 HEAD 版 `llmReview.js` 比对 14 组输入 **43 项**（system 逐字符 + modules 逐字段 + 注入等价）；
  回归 US-103b 数据 26 / 服务 16、US-102 数据 114 / 服务 70 / 提示词 58、US-101 提示词 172 全绿；
  浏览器 **38 项**（headless Chrome + CDP，替身替换云端 LLM：管理端停用 → 同一会话切身份 → 第三步
  → 生成 → 5 行清单 / 4+1 计数 / 停用原因 / 片段与 system 逐字符同源 / 轨迹同一份 / 缺 id 点名 /
  全部取消勾选后的空态 / 390px / 0 异常），截图 170~172 留档。

## 第三步「五维点评」的 agent.md 与记忆文件加载规则（US-105 / F-REVIEW-PROMPT-02）

「这次点评加载了哪些 agent.md 与记忆文件、为什么、截断在哪」的**唯一真源**是
`src/data/agentFiles.js`（零依赖，可 Node 直跑）。它**同时**产出：① 按固定顺序的九步加载记录 `steps`、
② 逐文件清单 `rows`（全部候选 + 未加载原因 + 进入提示词的正文 `body`）、③ 两段正文
`agentMdContent`（→ `agent_md` 模块）与 `memoryContent`（→ `memory` 模块）、④ 预算与截断读数、
⑤ `versionSet` / `loadoutHash`（版本指纹）。提示词、面板清单、轨迹留档、断言读的都是它，
**不要在任何一处再按 `enabled` / scope 过滤一遍**。

- 加载顺序（`AGENT_FILE_LOAD_ORDER`，九步，顺序一字不改）：平台 agent.md → 机构 agent.md →
  老师 agent.md → **技能模块** → 学员记忆 → 班级记忆 → 机构记忆 → 观察词模板候选 → 写作要求与输出格式。
  后三步不加载文件，只登记「这一步归属哪个提示词模块」（`module` / `modules`，断言盯着它们必须
  登记在 `data/promptModules.js` 的 `PROMPT_MODULE_DEFS` 里，且相对顺序是 `PROMPT_MODULE_IDS` 的子序列）。
- 生效范围：`scopeRef` 为空 = **层级通用**（该层级下任何课次都加载）；否则必须精确命中上下文
  （机构 / 老师 / 班级 / 学员的 **id 或姓名**；学员层级另认 `student-<姓名>` 这种派生 id 形态，
  与 `data/lessons.js` 的 `makeStudentId()` 同一口径）。认不出范围的脏数据**一律不命中**
  （宁可少加载，也不能把别的机构的记忆塞进提示词）。平台级永远命中；`scopeRef` 不参与平台级判定。
- 同层级排序（可复现的判据，`compareAgentFiles`）：**相关度（精确命中 > 层级通用）→ 最近更新 → 排序号 → id**；
  每层最多 `AGENT_FILE_MAX_PER_LEVEL`（5）个，超出的标「超出同层级上限」。
- 总量上限 `AGENT_FILE_CHAR_LIMIT`（8000 字符，覆盖 agent.md + 记忆文件的**正文之和**，不含文件之间的
  分隔空行）：**按加载顺序分配预算** —— 排在后面的文件先被截断，甚至整份丢弃（`over-budget`）。
  截断位置的口径：`row.truncatedAt` = 该文件真正进提示词的字符数；`truncation.at` / `summary.truncatedAt`
  = 全部文件进提示词的总字符数（在这之后的正文都没进去）。
- 每个**已加载**文件带 `version` / `chars`（替换后的正文长度）/ `includedChars` / `hash`
  （**原始正文**的 sha256 前 16 位）/ `renderedHash`（替换后正文的 sha256 前 16 位）。
  sha256 是本模块内的纯 JS 实现（`sha256Hex`，UTF-8 + 代理对与 Node `crypto` 逐字符一致）——
  data 层不引入依赖，所以没有用 `crypto.subtle`（它是异步的，拼提示词是同步的）。
- 变量替换（`renderAgentFileContent`）覆盖 `{学员名} {班级名} {老师姓名} {课次日期}`，
  口径与「水印落款」的变量替换一致：**未命中的变量保留原文**（`agentFileVariableWarnings` 给告警），
  命中但没值替换成空串。替换后的正文才是 `body`（面板上看到的就是它）。
- **停用 / 删除的文件不进新轨迹，历史轨迹仍可复现**：只有 `included` 的行带 `body`；
  停用 / 超限的行在面板清单里说明原因（没有 version / chars / hash / body）。
  轨迹（`reviewTrace.loaded.files` + `loaded.agentFiles` 摘要）落档后，`agentFileTraceReplay(trace)`
  **只读轨迹**就能还原当时的正文 —— 文件后来被改 / 被停用 / 被删都不影响审计复现。
- 调用点（`main.jsx` 的 `startCloudReview`）：一次 `agentFileLoadout({ files: loadAgentFiles(), context })`
  同时喂 `buildPersonaPrompt`（`extra.agentFiles`）与 `reviewDetailLoaded({ agentFiles })`，
  并把 `agentFileLoad.files` / `.summary` 放进轨迹种子。文件库**每次生成都重读**，所以管理端改完文件
  下一次生成就生效（不需要刷新页面）。
- 提示词口径：`agent_md` 模块 = `【agent.md】\n` + 三层正文（`\n\n` 拼接）；`memory` 模块 =
  `【长期记忆（本班本阶段，点评时必须结合并回访）】\n` + 三类记忆正文。**本次一个记忆文件都没加载到时
  才回落** `profile.memory`（人设里那段旧「大模型记忆」），没传 `agentFiles` 时行为与改造前逐字符一致
  （`extra.agentMd` 仍是 `agent_md` 的旧入口）。
- 面板读数（验收探针）：`data-detail-agentfiles`（+ `-included` / `-total` / `-limit` / `-per-level` /
  `-chars` / `-truncated` / `-truncated-at` / `-loadout-hash`）、`data-detail-agentfiles-note`（九步顺序 +
  预算 + 截断位置）、每行 `data-detail-agentfile`（= 文件 id）/ `-included` / `-reason`
  （`included | truncated | disabled | per-level-cap | over-budget | empty`）/ `-scope` / `-version` /
  `-chars` / `-included-chars` / `-hash` / `-truncated(-at)`，行内文案 `data-detail-agentfile-state` /
  `-detail`，正文在 `data-detail-agentfile-text`。
- 行内文案（`stateText` / `bodyNote`）在 `data/reviewDetailPanel.js` 里生成，**不要在 JSX 里现场拼**：
  嵌套模板字符串写在 JSX 表达式里会被解析器拒掉（US-105 真踩，构建报
  `Expected } but found )`，指针落在 `</small>` 上，看不出是模板字符串的问题）。
- 验证方式（本轮实测）：Node 直跑 `data/agentFiles.js` + 轨迹 + 面板/导出 **53 项**全绿
  （sha256 与 Node crypto 对齐 / 九步顺序与提示词模块序列一致 / 范围与排序 / 每层 5 个 /
  8000 字预算与截断位置 / 变量替换 / 同样版本同样提示词 / 停用与历史复现）；
  与 HEAD 版 `llmReview.js` 比对 **6 组**输入 system 逐字符一致；
  回归 US-104 数据 26 / 提示词 43、US-103b 数据 26 / 服务 16 全绿（US-103a 的「零依赖」那条是既有失效）；
  浏览器 **41 项**（headless Chrome + CDP，替身替换云端 LLM：生成 → 六行清单 / 两段正文与 system 同源 /
  轨迹留档 + 复现 / 同样版本两次生成逐字符相同 / 停用一个文件 + 塞 9000 字记忆后截断在 8000 字且停用文件
  不进新轨迹 / 390px / 0 异常），截图 173~175 留档。

## 管理端「Agent 指令与记忆」：CRUD 与版本（US-106a / F-REVIEW-PROMPT-02）

页面 = `src/admin/AgentFilesPage.jsx`（左列表按「类型 × 生效范围」六组 + 右侧 Markdown 编辑 / 预览 /
版本历史）。领域规则**只有一个写侧真源** `src/data/agentFileAdmin.js`（零依赖，可 Node 直跑），
读侧仍是 `src/data/agentFiles.js`（顺序 / 匹配 / 预算 / 变量替换 / normalize）。
接线与其他管理端页一样是**三处**（`navByRole.admin` 里 key = `agentFiles`、`ADMIN_ONLY_PAGES`、
`PageRouter.map`），另外 `PageRouter` 的 props 里多了 `agentFiles / setAgentFiles / adminName`。

- **每一次写入都是一版**：新建写 v1，保存 / 启停 / 复制为副本 / 回滚都 `+1` 并留一版**带正文的快照**
  与一条变更历史。理由不是「形式统一」，而是**停用一份 agent.md 与改它的正文同样影响下一次点评**，
  轨迹里的版本指纹（`versionSet` / `loadoutHash`）要能区分「停用前 / 停用后」。
  代价是重复点「保存」也会 +1 —— 验收原文就是「每保存一次 version 自增」，别自作聪明地跳过。
- **`stampAgentFileVersion()` 是 `version` / `versions` / `history` / `updatedBy` / `updatedAt` 的唯一写入口**：
  页面里手改这四个字段必然与快照漂移。同一版本号再写一次是**覆盖**该快照（种子里补出来的占位不会重复），
  快照的 `chars` / `hash` 由正文现算 —— 正文是唯一真源，不信存下来的数字。
- **「保存」的基准必须是上一次落盘的那一条，不是已经改过的草稿**：`saveAgentFileRecord(record, patch)`
  里的「改动：…」是 `record` 与 `patch` 比出来的。传草稿进去会永远得到「正文未改动」（本故事真踩，
  浏览器断言当场抓出来：v2 的正文确实变了、历史却写「正文未改动」）。页面里的写法是
  `saveAgentFileRecord(isNew ? draft : editing, 草稿字段, { by, at })`。
- **回滚产生新版本、永不改写历史**（与 US-053 的观察词模板同一口径）：回滚到 v3 = 「v3 的正文 + 新的版本号」，
  `versions` 里 v1..vN 一条不删；认不出的版本号 → 原样返回，一个字段都不动。
- **老数据（没有 `versions`）也要能查看 / 对比 / 回滚**：`agentFileVersions()` 按当前正文补一份**当前版本**
  的快照（标 `initial`，只写事实：正文 + 版本号 + 已有的 `updatedAt`），但**不补还没保存的新草稿**（v0）——
  界面据空数组显示「保存后才有版本历史」。
- **`normalizeAgentFile()` 现在带 `updatedBy / versions / history`**（读侧一律带上，老师端只读
  id/kind/scope/name/version/enabled/content，多出来的字段是惰性的）；脏数据（`versions: 'nope'`、
  `history: [null]`、空条目）一律读成空数组 / 丢弃，历史与快照都有上限（30 / 50，超出丢最旧的）。
- **合并方向：本机镜像优先**（`mergeAgentFiles(remote, local)`）。云端 `agent_files` 表还没建、
  或表里缺 `versions / history / updated_by` 列时，带新列的整条写入会被 PostgREST 拒掉，
  改动只在本机镜像里落地 —— 让云端顶掉本机会把刚存的版本历史弄丢（与 US-011b 的 framing_presets 同一条教训）。
  云端只补「本机没有的 id」。
- **Markdown 预览不引第三方库、也不产出 HTML 字符串**：`src/data/markdown.js`（零依赖）把正文解析成
  **结构化块**（heading / paragraph / list / ordered / quote / code / hr，行内只认 `**加粗**` 与 `` `代码` ``），
  页面用 React 渲染这些块 —— 不需要 `dangerouslySetInnerHTML`，正文里写 `<script>` 也只是一段文字。
  段落保留换行（`text` 里带 `\n` + 预览 `white-space: pre-wrap`），中文排版才不会被合并成一行。
- **验收探针**（浏览器断言读这些，不要按文案猜）：页面 `.agent-files-page`（`data-agent-file-current` /
  `-current-version` / `-dirty` / `-unsaved`）；分组 `data-agent-file-group`（`agent-md:platform` …
  `memory:org`，另有 `other` 兜底组）/ `-group-count`；列表行 `data-agent-file-id` / `-row-version` /
  `-row-enabled` / `-row-updated`；编辑 `data-agent-file-editor` / `-chars` / `-stats` /
  `-variable-count` / `-variable`（插变量按钮）/ `-unknown-variables` / `-over-budget`；
  动作 `data-agent-file-save` / `-toggle` / `-duplicate` / `-compare=` / `-rollback=`；
  版本行 `data-agent-file-version-row`（= `vN`）/ `-version-action`（`initial|create|save|enable|disable|copy|rollback`）/
  `-version-current` / `-version-chars` / `-version-hash`；对比 `data-agent-file-diff` / `-diff-summary` /
  `data-agent-file-diff-line`（`same|add|remove`）；引用范围 `data-agent-file-reference`（历史轨迹条数）。
- **「保存」按钮在云端推送期间是 `disabled`**（`saving`），而本机镜像那一条**更早**落地 ——
  验证脚本不能在「本机镜像已经有新版本」的瞬间就点第二次保存（点击会被丢掉，本故事真踩）。
  正确写法：等 `[data-agent-file-save]` 回到可用（`await settle()`）再继续，并用
  `data-agent-file-current-version` 断言编辑器的版本，而不是只读 localStorage。
- **已知边界**：云端 `agent_files` 表未建立（写入只落本机镜像，跨设备可见待云表）；
  父需求 US-106 里的「平台 / 机构 / 老师三层的写权限矩阵」没有落在本故事（`prd.json` 的 US-106a
  验收没有这一条），要收紧时在 `data/agentFileAdmin.js` 里加一个 `agentFileWriteIssue(record, viewer)`
  纯函数，界面与服务层读同一份（照 `data/framingPermissions.js` 的形状）。
- 验证方式（本轮实测）：Node 直跑 `agentFileAdmin.js` + `markdown.js` **153 项**断言全绿；
  回归 US-105 数据 53 / US-104 数据 26 / US-103b 数据 26 + 服务 16 / US-102 提示词 58 全绿；
  浏览器（headless Chrome + CDP）**65 项**全绿、页面 0 未捕获异常 / 0 console error ——
  六组分组与份数、新建 → v1、编辑 → v2（改动清单与快照 hash）、预览与字符数实时、变量插入与未知占位符告警、
  v1↔草稿逐行 diff 与独立重算一致、回滚 → 新版本 + 历史不删、启停 → v4 且老师端不再加载、
  复制为副本（新 id / 名称去重）、刷新后仍在、删除的引用范围提示、老数据补当前快照、390px 单列与 44px；
  截图 176~178 留档。

## 管理端「Agent 指令与记忆」：拼装预览与敏感内容校验（US-106b）

两个新模块 + 页面上一块面板：**拼装预览**（选一位学员与一节课 → 实时显示会发出去的 system 提示词）
与**敏感内容校验**（正文含手机号 / 微信号 / QQ 号 / 邮箱时阻断写入）。页面仍是 `src/admin/AgentFilesPage.jsx`。

- **预览必须调老师端那两个函数，不许自己拼**（验收原文「拼装预览与老师端实际加载使用同一个拼装函数」）：
  页面里就是 `agentFileLoadout()`（`data/agentFiles.js`）+ `buildPersonaPrompt()`（`services/llmReview.js`），
  与 `main.jsx` 的 `startCloudReview` 逐字同参。页面**不得**出现 `【agent.md】` / `【长期记忆` 这类段落字面量
  （浏览器断言会去 fetch 页面源码点名这两件事），也不得自己按 `enabled` / scope 过滤一遍文件。
- `src/data/agentFilePreview.js`（零依赖，只 import 同层 `lessons.js`）= 界面到上下文的翻译：
  课次候选（`sortLessons` 顺序、没有日期的脏数据不进候选）、学员候选（`participants` → `studentId` 用
  `makeStudentId()` 口径）、`agentFilePreviewContext()`、下拉标签 / 上下文一句话 / 空态文案、
  `agentFilePreviewTargetForFile()`（打开「学员记忆（陈一诺）」时预览自动停在她所在的课）。
  **上下文的九个键要与 `main.jsx` 的 `startCloudReview` 保持一致**（机构 id/名、老师 id/姓名、
  班级 id/名、学员 id/姓名、课次日期）—— 那边改了这里要跟着改，预览的断言会拿面板上的
  `data-agent-file-preview-*-id/-name` 独立重算一次并**逐字符**比 system。
  课次日期用 `formatLessonDateDots()`（`2026.08.11`，与老师端传的同一个口径）；观察词候选用
  `keywordCandidatesPrompt('个人反馈')`（选一位学员 = 个人反馈分支）。
- **预览文件库 = 已保存的文件库 + 编辑器当前草稿**（`isNew` 时追加），所以改一个字预览就变；
  面板上写清当前是「含未保存的改动」还是「按已保存的文件库拼装」（`data-agent-file-preview-source`）。
  老师端的真源仍是 `loadAgentFiles()`（本机镜像；`agent_files` 云表未建）。
- **没有人设时预览走兜底分支**（`agent.md` / 记忆文件不进 system）—— 与老师端行为一致，面板上如实说明，
  不要为了「预览好看」而伪造一个人设。
- `src/data/agentFileSensitive.js`（零依赖）= 「什么算联系方式、怎么给可读提示」的唯一真源：
  四条规则（微信号 / QQ 号 / 手机号 / 邮箱，顺序即报告顺序），手机号额外做**边界校验**
  （前后不紧邻数字、去分隔符后必须 11 位或 86+11 位），`wxid_` / 「微信号」/「加微信」/ 显式冒号
  多种写法都认。同一段文字被多条规则命中时**只报一次**（按靠前规则 + 重叠区间去重）。
- **提示里一律遮蔽、连所在行也遮蔽**：`maskSensitiveText()` 按长度分档（≥11 位露头 3 尾 4，
  8~10 位露头尾各 2，≤7 位露头尾各 1，邮箱只露前两位 + 域名）；`scanAgentFileSensitive()` 还会
  从后往前把**全部命中**替换一遍得到 `maskedText`，每行的 `lineText` 取自它 ——
  否则「一行里既有微信号又有邮箱」时，微信号那一行会把邮箱原样带出来（本轮真踩，浏览器断言抓住）。
  带捕获组的规则（微信号 / QQ）只把**账号本身**当片段（`hit.value` / `hit.masked`），
  命中 `微信：abc12345` 的报告是 `微信号（ab****45）` 而不是把「微信：」也当成号码。
- **闸门点：三条会「把正文写成一个新版本」的路径** —— `save`（保存）、`duplicate`（复制为副本）、
  `rollback`（回滚到某一版，用该版快照的正文判）。三处共用页面里的 `contentBlocked(content, 动作名)`：
  被拦时**不落库、不推云端、不改 state**，只 `setNotice(agentFileSensitiveIssue(...))`（文案里点明动作名）。
  「停用 / 启用」不写正文，因此不校验。判据要的是「版本与快照都没动」——浏览器断言同时查
  `version` / `content` / `versions.length` 三项，而不是只看版本号。
- **验收探针**：面板 `[data-agent-file-assembly]`（`data-agent-file-preview-lesson/-student/-profile/-dirty/
  -summary/-chars/-loadout-hash` + 九个上下文字段 `-org-id / -org-name / -teacher-id / -teacher-name /
  -class-id / -class-name / -student-name / -lesson-date`）、下拉 `[data-agent-file-preview-lesson-select]` /
  `[data-agent-file-preview-student-select]`、上下文 `[data-agent-file-preview-context]`、
  来源 `[data-agent-file-preview-source]`（`draft|saved`）、逐文件行 `[data-agent-file-preview-file]`
  （`-included` / `-reason`，行文案复用 `agentFileRowText`）、正文 `[data-agent-file-preview-system]`；
  敏感块 `[data-agent-file-sensitive]`（`-rules` / `-lines`）、逐行 `[data-agent-file-sensitive-row]` /
  `-line`、读数 `[data-agent-file-sensitive-note]`、提示 `[data-agent-file-notice]`。
- **拼装预览面板在 `.agent-files-page` 之外**（它是并排布局之后的整块），所以 430px 下那条
  「可点区域 ≥44px」的规则要单独补一遍（`.agent-file-assembly select/button`），否则 390px 断言会红。
- 验证方式（本轮实测）：Node 直跑两个新模块 **109 项**断言全绿（四条规则的正例与误报例、边界与
  11 位校验、重叠去重、行号与遮蔽、四动作文案、课次/学员候选与回退、上下文九键、上下文一句话、
  跟着文件选目标、空态与脏输入、七份种子正文全干净）；回归 US-106a 数据 153 全绿、
  US-044（= US-105）数据 53 全绿；浏览器（headless Chrome + CDP）**55 项**全绿、0 未捕获异常 /
  0 console error —— 面板默认选中一节课一位学员、system 与**独立重算逐字符一致**（含版本指纹）、
  换学员/换课次/改正文都实时反映、编辑器源码不含自拼段落、手机号/微信号/邮箱的实时告警与遮蔽、
  保存与复制被拦下且版本与快照都没动、改干净后保存成功、停用后预览清单标「未加载」且正文退出 system、
  390px 不横向溢出且下拉 ≥44px；另回归 US-106a 浏览器 65 项、US-044 浏览器 41 项全绿；
  截图 179~182 留档。

## 第三步「五维点评」的模型选择器与模型来源标注（US-107a / F-REVIEW-MODEL-01）

「这次点评能用哪些模型、每个模型长什么样、为什么用不了、这次到底用了哪个」的**唯一真源**是
`src/data/reviewModels.js`（零依赖纯函数，可 Node 直跑）。选项行、不可选原因、池路由命中、
老师的个人默认与轨迹里的来源标注都来自它 —— 界面只渲染 `reviewModelResolve()` 的产物
（`options` / `poolRow` / `modelId` / `source` / `choice`），**不要在组件里再过滤或排序一遍**。

- **模型 id 只有一处写死**：`REVIEW_MODEL_DEFAULT_ID`（= `services/llmReview.js` 的 `REVIEW_MODEL`，
  那边是从它导出的）。新增模型只改模型目录的种子 + `data/reviewTrace.js` 的 `REVIEW_MODEL_PRICES`
  （单价表同时喂成本估算与选择器里的「单价」那一列 —— 一个模型两个价会让人不信）。
- **可选性判据只有一个函数**（`reviewModelAvailability`）：判定顺序 = 视觉理解已启用 → 机构已授权点评
  （`reviewEnabled` 为假，或 `orgId` 非空且与登录机构不一致）→ 健康检查 → 额度。同一模型只报第一个原因，
  行上的原因文案读 `REVIEW_MODEL_REASON_LABELS`（健康检查失败 / 未授权 / 额度不足）。
- **「只列出视觉理解已启用的模型」是硬过滤，「授权 / 健康 / 额度」是置灰原因**（两条验收原话的调和）：
  `reviewModelOptions()` 的 `rows` 里**没有**非视觉模型（它们在 `excluded` 里，界面用一行脚注说明个数与原因），
  而视觉模型里不可用的那条**留在列表里置灰并写明原因** —— 悄悄消失会让老师不知道为什么用不了。
  `selectable` 子集正好等于「视觉 + 已授权 + 健康 + 额度足」，断言比的就是它。
- **池路由是选择器里的第一行**（伪 id `pool-route`，不是真实模型 id，绝不发给云端）：
  命中规则 = 可选模型里按 `poolPriority` 升序（行里必须带 `poolPriority`，否则排序退化成按 id）。
  老师选过「自动路由」也**显式存空串**（不是删条目）：两者行为一致，但语义上要能区分「选过」与「没选过」。
- **老师选的模型可能已经失效**（健康检查刚失败 / 额度用尽）：`reviewModelResolve()` 回落到池路由，
  并把「原模型 + 原因」写进 `note`，界面另有回落提示条；选择器的**选中态读 `plan.choice`**（本次实际会用的那个），
  不能读老师在 state 里的原始选择 —— 否则高亮会落在一条置灰的行上。
- **来源标注进轨迹**：`REVIEW_TRACE_FIELDS` 新增 `modelSource`（`teacher-pick` / `pool-route`，
  仅原始值，中文说法在 `REVIEW_MODEL_SOURCE_LABELS`）。`streamArtworkReview({ model, modelSource })`
  把选中的模型用于**真实请求**并原样写进轨迹；不传时模型回落到 `REVIEW_MODEL`、来源是空串（不编造）。
  详情面板的 `meta.modelSource(Label)`、`meta.modelText`（`模型 X · 模型池自动路由`）与 Markdown 导出的
  「模型来源」一行都读同一份标签表；折叠态摘要的 `reviewDetailSummary({ model, modelSource })`
  不传来源时与改造前逐字符一致。
- **落地与读取**：云端 `provider_models` / `review_model_preferences` 两张表**还没建**
  （写入会被 PostgREST 拒掉，与 `audit_logs` / `review_traces` 一样），现状是「本机镜像为准」：
  `services/reviewModelsApi.js` 只负责「云端通了就用云端的」，个人默认的合并方向是**本机镜像优先**，
  App 侧 `persistReviewModelDefaults` 的 effect 负责落盘（键 `xinlehui-review-model-default-v1`）。
- **验收探针**：`[data-review-model-picker]`（`-resolved` / `-source` / `-choice`）、
  逐行 `[data-review-model-option]`（`-selectable` / `-reason` / `-health` / `-price` / `-p95` /
  `-provider` / `-version` / `-caps`）、`[data-review-model-summary]`、`[data-review-model-plan]`、
  `[data-review-model-fallback]`、`[data-review-model-excluded]`、`[data-review-model-selected]`；
  详情面板新增 `[data-detail-model-source]`。新增读数请沿用这套命名。
- 验证方式（本轮实测）：Node 直跑 `data/reviewModels.js` + 轨迹/面板/服务层 **104 项**断言全绿
  （选项过滤与顺序、三种原因、判定优先级、池路由命中与回落、个人默认、单价覆盖、
  `modelSource` 进白名单与真发请求用的是选中模型）；回归 US-102 数据 114 / 服务 70 / 回归 58、
  US-103a 数据（2 项旧断言在 HEAD 上同样失败）、US-103b 数据 26、US-105 数据 53、US-106a 数据 153、
  US-106b 数据 109 全绿；浏览器（headless Chrome + CDP，替身云端 LLM）**39 项**全绿、0 异常 ——
  选项与纯函数**独立重算逐项一致**、置灰行真的点不动、指定模型 → 刷新后仍默认选中、
  选「自动路由」也记住（存空串）、两条路径各生成一次（替身收到的模型 + `window.__xinlehuiReviewTrace.modelSource`
  分别是 `teacher-pick` / `pool-route`）、面板「模型来源」分区与折叠态摘要都写得出来、存着的默认失效时回落池路由、
  390px 不横向溢出且行高 ≥44px；另回归 US-103a 浏览器 52、US-103b 浏览器 51、US-102 浏览器 61 全绿
  （US-102 那份脚本里的 `.review-stream-actions` 是 US-103a 重构前的旧选择器，跑之前要换成
  `.review-detail-actions`）；截图 183 / 183b / 184~188 留档。

## 第三步「五维点评」的生成中换模型与两次对比（US-107b / F-REVIEW-MODEL-01）

老师看到正文不对可以**生成中换模型**，也可以重新生成；两种都会产生**新轨迹**，新轨迹用
`parentTraceId` 关联上一次，详情面板里可以把两次的**模型 / 耗时 / 推理**放在一起看。
领域规则（对比行、差值文案、推理对照、内存小账本）全在 `src/data/reviewTraceCompare.js`（零依赖纯函数），
确认文案在 `src/data/reviewModels.js` —— 组件只渲染它们的产物。

- **选择器的三个分支**（`selectReviewModel`）：不在生成中 → 立即生效（US-107a 的老行为）；
  **生成中** → 出二次确认条（`reviewModelSwitch = { value, targetName, message }`，文案含验收原话
  「将重新生成，当前正文会被替换」），**确认前一个 state 都不改、当前生成继续跑**；
  点当前已选中的那一行 → 什么都不做（不出确认条也不重启）。确认走 `confirmReviewModelSwitch`：
  `applyReviewModelChoice` + `startCloudReview(pending.value)`。
- **`startCloudReview(overrideChoice)` 的第一个参数**：确认路径把新选择**直接传进来**（state 是异步的，
  等 `reviewModelChoice` 生效再生成会用到旧模型）。按钮 `onClick` 会把事件对象当第一个参数传进来，
  所以入口用 `typeof overrideChoice==='string'` 守卫 —— 改这个签名时别把这个守卫删了。
- **`parentTraceId` 靠两个东西才拿得到**：① `reviewRunRef = { controller, traceId, parentTraceId }` ——
  **traceId 在开始生成时就定下来**（种子里 `traceId: runTraceId` 交给 `createReviewTrace`），
  因为收束后的轨迹只在 `onTrace` 才拿得到，而「生成中换模型」要关联的正是还没收束的那一条；
  ② `reviewTraceArchiveRef` 内存小账本（≤8 条，`archiveReviewTraces` / `findArchivedTrace`）——
  上一次的轨迹可能已被新一次生成顶掉（此时它是 `aborted` 的那一条，模型 / 耗时 / 推理照样齐全）。
  两者都只驻留内存、不写 localStorage，换上下文（换班 / 换学员 / 换模式 / 新建草稿）一起清空。
- **`onTrace` 必须判断「我是不是当前那一代」**：被新一次生成顶掉的旧请求 settle 时，
  只能把它补进对比区（`reviewRunRef.current?.parentTraceId === next.traceId` 时 `setReviewCompareParent`），
  **绝不能**写 `reviewTraceRef` / `setReviewTracePanel` —— 否则被中止那一次的耗时与输出会盖住正在跑的这一条。
- **对比区是六个分区之外的第七块**（`[data-detail-compare]`，在展开的面板主体里）：它**不进**
  `payload.sections`，所以 `data-detail-sections` 仍是 6、六个分区与「复制全部 / 导出」的口径一字不变；
  没有可对比的上一次时整块不渲染（空表不如不出现）。探针：`data-compare-parent-trace` /
  `-current-trace` / `-live` / `-model-changed` / `[data-compare-summary]` / `[data-compare-row="<key>"]`
  （`-parent` / `-current` / `-delta`）/ `[data-compare-reasoning-*]`。
  只读调试钩子 `window.__xinlehuiReviewTraces`（已收束轨迹的账本）与 `window.__xinlehuiReviewTrace`
  同一类，供验证脚本做**独立重算**。
- **确认条探针**：`[data-review-model-switch]`（待切换到的 id，池路由写 `pool-route`）/ `-name` /
  `-text` / `-confirm` / `-cancel` / `[data-review-model-switch-hint]`（生成中的提示）/
  选择器上的 `data-review-model-running`。
- 验证方式（本轮实测）：Node 直跑 `data/reviewTraceCompare.js` + 文案/轨迹/服务层 **93 项**断言全绿；
  浏览器（headless Chrome + CDP，替身云端 LLM 支持 abort）**63 项**全绿、0 异常 ——
  确认前「一个请求都不多发 / 选择不变 / 生成继续」、取消后照样跑完、确认后立即重启（替身收到新模型）、
  新轨迹 `traceId` 不同且 `parentTraceId` = 上一次（aborted）、对比区 DOM 与 `reviewTraceCompare()`
  **逐项独立重算一致**、没换模型时写「未换」、390px 面板 / 对比块 / 确认条都不横向滚、换学员后基线清空；
  回归 US-103a 浏览器 52、US-103b 浏览器 51 全绿；**US-107a 的浏览器套件有 1 项被本故事取代**
  （「生成中选项不可点（避免误触换模型）」→ 现在是「可点 + 二次确认」），跑那份脚本时会红这一条；
  截图 189~194 留档。

## 第三步「五维点评」的正文只能来自大模型（US-108a / F-REVIEW-TRACE-07）

老师端第三步的正文**没有**任何离线兜底：云端失败就如实报错、正文保持为空，不许用一份本地模板拼出
「像点评的句子」让老师误以为是 AI 的结果。`reviewGenerated` 只有一处置真，落在 `startCloudReview`
里云端成功返回之后；失败 / 中止都不置真，于是既有的归档守卫（`archiveRecord` 与 `go(4)` 读
`!reviewGenerated`）自然拦下「没生成就归档」。

- **唯一置真路径**：`setReviews(current=>({...current,...result.reviews}))` 之后紧跟
  `setReviewGenerated(true)`（就在同一个 `try` 里、`}catch(error){` 之前）。新增任何
  「填正文」的入口时，**不许**顺手把 `reviewGenerated` 也点亮 —— 它能置真的条件只有一个：
  这一次云端调用成功返回了五维正文。静态判据：`setReviewGenerated(` 全站只出现两次（一次 true / 一次 false）。
- **已删除的兜底路径**：`fillLocalDraft` / `localDraftUsed` / `ReviewLaunchPanel` 的兜底按钮
  （`.local-draft-link`）/ `review-source` 的 `local` 变体与 `persona-framing.css` 里的对应规则。
  一并删掉的还有只服务于那条模板路径的「画面证据」管道：`inspectArtworkEvidence()`、`artworkEvidence`
  state 及其 effect、`keepArtworkReviewEvidenceBound()`（`COLOR_LANGUAGE` 正则）—— 它们当时是给
  模板文案挑「有色彩 / 无色彩」的措辞用的，留着只会诱导后人复活本地模板。要重新引入画面证据，
  请按新需求重写，别再挂回模板路径。
- **验收点名的 `prototype/src/p0-local-draft.css` 里其实没有本地草稿规则**（那份文件装的是
  `sync-upload` / `review-keyword-dock` / `archive-target-controls` / `.report-*` 等其它样式，
  且其中多条在 JSX 里仍在用，**`import` 不能删**）。本地草稿的真实样式在
  `persona-framing.css`（`.feedback-flow-v2 .local-draft-link` 与 `.review-source.local`），
  清理动作落在那份文件里。判断「某个兜底入口是否还有样式残留」时按选择器 grep，别按文件名猜。
- **文案残留按「概念」清**：本地草稿这条路径移除后，第四步那句「作品、课堂照片与五维点评已经同步保存到
  本地草稿」也改成「作品、课堂照片与五维点评已经写入成长档案。」（与 `prd-archive-share` 的 FR-218
  同一条口径：第四步不出现「本地草稿」）。`src/` 下（含注释）对 `fillLocalDraft` / `localDraftUsed` /
  `local-draft-link` / 「本地草稿」四个串应保持 **0 命中** —— 验证脚本用这条做静态断言。
- **验证方式**（本轮实测）：Node 静态 19 项 + 浏览器（headless Chrome + CDP，替身云端 LLM 先抛
  `gateway_timeout` 再恢复）28 项，共 **47 项全绿** —— 生成前面板只有「开始生成点评」一个主操作、
  没有本地草稿入口 / 文案；**模拟失败**后五个维度保持为空、来源标注停在 `review-source pending`、
  错误是可读文案、归档仍被拦；替身恢复后来源标注变 `review-source ai`、正文写入五维、归档不再被拦；
  390px 无横向溢出；0 未捕获异常 / 0 console error。回归：US-107b 浏览器 63/63、US-103a 浏览器 52/52、
  US-107a 数据 104、US-107b 数据 93 全绿（`/tmp/us030-verify.mjs`、`/tmp/us031-verify.mjs` 里点
  `.local-draft-link` 填正文的那两行老脚本自此失效 —— 那是被本故事取代的路径，不是回退）；
  截图 195~198 留档。

## 第三步「五维点评」的归档强校验与生成失败三动作（US-108b / F-REVIEW-TRACE-07）

归档按钮的前置校验与失败态的恢复动作都由 `src/data/reviewRecovery.js`（零依赖纯函数）说了算，
界面只渲染它的产物 —— **不要在组件里另写一份「为什么不能归档 / 失败后该怎么办」**。

- **归档强校验**：`evaluateReviewArchiveGate({ mode, reviews, generated, traceStatus })` 产出
  `{ ok, checks, blocking, reasonText, summary, headline }`。个人反馈 = 五维逐维非空 + 一条
  `trace.status === 'success'`（判据读 `reviewTracePanel?.status`，它是 ref 的渲染副本）；
  班级反馈 = 一条「本次点评已生成」（班级正文来自课程模板、不是模型输出，且换模式会
  `clearReviewTrace()`，拿轨迹卡它会把班级归档整条路堵死）。**三个消费点读同一份**：
  清单渲染（`reviewArchiveGateField`）、归档按钮的 `disabled={!reviewArchiveGate.ok}` 与
  `data-archive-block-reason`、以及 `go(4)` / `archiveRecord` 的第二道拦截（toast 用
  `reasonText` + 「完整原因见「归档前的校验清单」」）。`reasonText` 只是**第一条**没过的原因，
  完整原因在 `summary` 与面板清单里。
- **失败态三动作**：`REVIEW_RECOVERY_ACTIONS`（`retry` / `switch-model` / `later`）在
  `reviewStream.phase === 'error'` 时渲染成 `.review-recovery`。三个动作**只碰「生成」这一层**：
  重试 = 原模型 `startCloudReview()`；换模型重试 = `reviewSwitchModelTarget()` 选定的模型（或池路由）
  直接传参重启；稍后再来 = 只把 phase 收回 `idle` 并给一句「已保留…」。谁都不许在这三条路径里
  `setReviews` / `setKeywords` / `setMedia` —— 验收点名的「失败后不丢失已填写的老师补充观察」
  就靠这条结构性约束，验证脚本按「失败前后 textarea 值 / 勾选观察词 / 模型选择逐项相等」断言。
- **连续失败读数**：`reviewFailureStreak` state，`startCloudReview` 的 `catch` 里 +1（老师自己点
  「停止生成」走的是 catch 之前的 `if(controller.signal.aborted) return`，不算失败），成功一次归零，
  `clearReviewTrace()`（换班 / 换学员 / 换模式 / 新建草稿）一并清零。
  `reviewFailureStreakView({ failures, recommendation, currentModelId })` 到
  `REVIEW_FAILURE_STREAK_LIMIT`（3）次时给出「可能是模型服务波动」+ 推荐文案；
  推荐来自 `reviewModelHealthiest()`（**只从可选模型里排**：健康 ok → 近期 P95 最短 → 池优先级 /
  排序号 / id，见 `data/reviewModels.js`）。推荐的就是当前在用的那个时，文案如实说
  「当前已经在用…最健康」，不许建议老师「换」成他已经选着的模型。
- **错误文案不暴露原始错误码**：`describeReviewError()` 的兜底分支现在过一次
  `readableReviewFailureText()` —— 命中 `status code 504` / 裸 `[45]xx` / snake_case 云端码 /
  `error code` / 整句英文（连一个汉字都没有）都换成 `REVIEW_FAILURE_FALLBACK_TEXT`。
  新增任何「给老师看错误」的入口都走 `describeReviewError()`，不要直接把 `error.message` 渲染上去。
- **验证方式**（本轮实测）：`/tmp/assert-us108b.mjs` 共 **152 项全绿**（数据 / 服务 73 + 浏览器 65 +
  静态 10）。浏览器用替身云端 LLM 连造 4 次失败（先带 `code: 'gateway_timeout'`，再只给
  `Request failed with status code 504` 原文）走遍三条动作：三动作齐全且文案可读、每次失败后
  老师写下的补充观察 / 勾选观察词 / 模型选择逐项保留、第 3 次起出现「可能是模型服务波动」并推荐
  GLM 5.3 视觉 Flash、换模型重试真的把 `data-review-model-resolved` 换过去并重启生成、稍后再来只收提示、
  替身恢复后生成成功 → 校验清单全绿 / 按钮可用 / 再手动清空一维立刻被拦 → 归档成功落档（轨迹 success）。
  回归：US-108a 47/47、US-107b 浏览器 63/63、US-103a 浏览器 52/52、US-103b 浏览器 51/51、
  US-107a 数据 104、US-107b 数据 93、US-102 trace 数据 114 / 服务 70 / 浏览器 61、US-104 数据 26、
  US-105 数据 53 全绿。截图 199~204 留档。
- **被本故事取代的两条旧断言**（`/tmp/assert-us108a.mjs` 里已改成新口径）：归档按钮在未生成 / 失败时
  变成 **disabled**，点它不再触发「请先完成线稿提取和智能点评」的 toast；判据改为
  「按钮 disabled + `data-archive-block-reason` 有原因 + 清单点名轨迹失败」。

## 第三步「五维点评」的作品观察词模板（US-109 / F-REVIEW-KW-01 / FR-139 ~ FR-143）

观察词从「代码里写死的一份词表」改成「机构维护的模板」：唯一真源是
`src/data/reviewKeywordTemplates.js`（零依赖纯函数，可 Node 直跑），云端读写是
`src/services/reviewKeywordTemplatesApi.js`（表名 `review_keyword_templates`，`template_key` 幂等 upsert）。

- **一个产物喂三处**：`keywordTemplateLoadout({ templates, mode, courseTypes, ageRange, remoteFailed })`
  是老师端**唯一入口**，产出 `{ source, status, template, name, versionText, groups, groupMap,
  terms, counts, prompt, matchedBy, noteKind, noteText }`：
  面板分组（`groupMap`，顺序 = 模板 `sortOrder`）、提示词候选清单（`prompt`）、
  模型返回值校验（`terms` → `pickTemplateKeywords()` / `orderTemplateKeywords()`）三处读同一份。
  **不要在组件里 import `data/reviewKeywords.js` 再过滤一遍** —— `main.jsx` 已不再直接引用内置词表，
  静态断言盯着「主文件里 0 处 `pickSupportedKeywords` / `keywordCategoriesFor`」。
  `pickSupportedKeywords / orderKeywords / keywordCategoriesPrompt` 只是**老入口**（回归夹具与
  内置兜底用），内部已收敛到 `pickSupportedFromOptions / orderFromOptions`。
- **平台默认模板 v1 = 首次上线导入**（FR-140）：`PLATFORM_DEFAULT_KEYWORD_TEMPLATES` 由
  `keywordTemplateFromCategories(PERSONAL_KEYWORD_CATEGORIES, …)` 的**同一个构造器**生成，
  所以「8 组 48 词 / 6 组 36 词逐字一致」是结构性成立的；守卫是
  `keywordTemplateVerbatimIssues()`（空数组 = 一致，断言直接调它，不要另写比较逻辑）。
  导入落点有两处：`loadReviewKeywordTemplates()` 在**本机镜像为空 / 读坏时返回种子**（这是「首次上线」
  的定义），`main.jsx` 在首次渲染用 `reviewKeywordTemplateMirrorStored()` 判定并**幂等推一次云端**
  （表不存在时抛错被吞掉，只影响跨设备可见）。
- **匹配口径唯一**（FR-141）：`resolveReviewKeywordTemplate(templates, { mode, courseTypes, ageRange })`
  —— 先按模式筛（启用 + 有生效词条 + 每条**已配置的**约束都命中），命中的按分数取最高
  （课程类型 2 分、年龄段 1 分），都没命中用该模式标 `isDefault` 的那一套；没有标默认的用排序第一套
  （并把这件事写进 `reasonText`）。**约束没命中的模板不算合格候选**（不硬塞给它，直接退到默认模板）。
  课程类型 / 年龄段匹配都放宽到「相等或互相包含 / 区间重叠」（课程库存「国画」、界面写「国画（6-18岁）」），
  当前上下文为空时按「没命中」处理（fail-safe）。`main.jsx` 传的候选课程类型是
  `[课程库里的课程名, 第三步选中的课程类型]`，年龄段取课程库的 `ageRange`。
- **降级必须可见**（FR-142）：`noteKind` 两种 —— `builtin`（一套可用模板都没有 → 回落内置兜底词表，
  `noteText` 就是验收原文「当前使用内置兜底词表（模板未连通）…」）、`mirror`（云端不通但本机有模板镜像，
  文案点名**用的是哪一套含版本**）。两者都渲染在 `.review-keyword-template` 里
  （`data-keyword-template-note` / `data-keyword-template-note-text`），**任何一种降级都不许静默**。
- **模板版本进轨迹**：`buildPersonaPrompt(profile, { keywordCandidates, keywordTemplate })` 的
  `keyword_template` 元信息让 `keyword_candidates` 模块带上模板的 `version`（`v2`）与
  `source`（`观察词模板 · <模板名>` / `内置兜底词表（模板未连通）`）—— 于是「这一次用的是哪一版模板」
  在详情面板与轨迹留档里可复现。**不传 `keywordTemplate` 时输出与改造前逐字符 / 逐字段一致**
  （字符串正文 → 目录里的默认 `v1` / `观察词模板`），US-102 的 13 组输入逐字符回归仍然全绿。
- **合并方向与其它新表一致**：`mergeReviewKeywordTemplates` **本机镜像优先**（云端表还没建、带新列的写入
  会被 PostgREST 整条拒掉），云端只补本机没有的 `templateKey`。
- **验证方式**（本轮实测）：`/tmp/assert-us109.mjs` **150 项**（导入逐字一致 / 归一化 / 排序启停 /
  匹配与优先级 / 兜底明示 / 模板外词丢弃 / 提示词模块版本 / 镜像读写 / 服务层行列映射与首次上线导入 /
  源码静态），`/tmp/assert-us109-browser.mjs` **52 项**（四个 pass：平台默认 v1 + 云端不通的 `mirror` 明示 +
  模板外词被丢弃 → 改一个词条（版本自增 v2）+ 刷新后老师端看到新词且 AI 能选中它 →
  没有任何可用模板时逐字显示验收原文 → 班级反馈命中班级模板）。截图 205~209 留档。
  回归：US-107a 数据 104、US-107b 数据 93 / 浏览器 63、US-102 trace 数据 114 / 服务 70 /
  提示词 58（13 组逐字符）/ 浏览器 61、US-103a 浏览器 52、US-103b 浏览器 51、US-108a 47、US-108b 152、
  US-106a 浏览器 65、US-106b 浏览器 55 全绿。

### 验证脚本里的两个口径（US-109 真踩）

- **`keywordTemplateLoadout` 的 `remoteFailed` 是入参**：独立重算必须把 App 的云端状态一起传进去，
  否则重算出来的 `noteText` 是空串、与 DOM 上的「本机模板镜像」明示对不上（看起来像产品 bug）。
- **别用「旧词 / 新词」的字面量包含匹配**：改词后断言「提示词里没有旧词」时写
  `!prompt.includes('人物 / 风景')` 会被新词 `水墨人物 / 风景` 命中（假红）。判据改成
  「候选清单逐词 = 面板词条」这种**列表相等**，或断言 `!prompt.includes('：人物 /')`。

## 管理端「作品观察词模板」：分组词条维护与版本留档（US-110a / F-REVIEW-KW-01）

管理端的写侧规则全在 `src/data/reviewKeywordAdmin.js`（零依赖纯函数；与 `reviewKeywordTemplates.js`
的分工：读侧 = 容错 normalize / 老师端匹配 / 本机镜像，写侧 = 草稿形状 / 校验 / 版本自增 / 分组词条增删排序）。
页面 `src/admin/KeywordTemplatesPage.jsx` 只渲染与调用，三处接线（`navByRole.admin` /
`ADMIN_ONLY_PAGES` / `PageRouter.map`）与其它管理端页面一致。

- **编辑视图与读侧 normalize 必须分开**：读侧 `normalizeKeywordTemplateGroups()` 会把**无名分组**与
  **空词条**直接丢掉（返回 null 再 filter），这是落库要的语义；但编辑态要是也走它，
  刚点的「新增词条」空行会在下一次操作时凭空消失，校验也就永远拦不到无名分组（静默丢组）。所以
  `keywordTemplateEditGroups()` 是**编辑专用的第二份归一化**：保留停用项 / 空组名 / 空词条，只重排 `sortOrder`。
- **顺序只有一个来源**：草稿里分组 / 词条的**数组位置就是顺序**，每次改动后由 `resequenceKeywordGroups()`
  把 `sortOrder` 重写成 10、20、30…。于是「上移 / 下移 / 删除」都是普通数组操作，不存在两处顺序打架；
  老师端面板顺序（`keywordTemplateGroups` 按 `sortOrder` 排）与编辑器逐行对得上。
- **保存闸门是 `keywordTemplateSaveGate(draft)`**（`{ ok, issue, warnings }`）：重复词 / 无名分组拦截，
  空词条与「没有可用词条」只提示。页面按钮 `disabled={!gate.ok}` + 界面上**一直摆着**原因
  （`data-keyword-template-block-reason`），`save()` 里再拦一道（结构上的第二道门）。
  **归一化后重复的词跨分组也算**，判据复用 `reviewKeywords.js` 的 `normalizeKeywordText()`（空格 / 标点 / 前缀都不算差异）。
- **每次写入都记一版**：`stampKeywordTemplateVersion()` 是 `templateVersion` / `versions` / `history` /
  `updatedBy` / `updatedAt` 的**唯一写入口**（页面里 0 处 `templateVersion +`、0 处 `versions:`）。
  首次保存 = v1 + 「新建」，之后每保存一次 +1（内容没动也增，如实写「内容未改动」）；**启停同样 +1**
  （停用一套模板与改它的词条同样影响老师端命中）。快照带 `groups` 与配置字段 → US-110b 的回滚有素材。
- **版本快照必须穿过持久化**：`persistReviewKeywordTemplates` / `loadReviewKeywordTemplates` 都过
  `normalizeKeywordTemplate()`，所以 `versions` / `history` 是在**读侧模块的 normalize 里**接的
  （`normalizeKeywordTemplateSnapshots` / `normalizeKeywordTemplateHistory`）；漏接这一处，
  「保存过一版」刷新后就没了（本故事真踩：光写管理端，刷新后版本历史归零）。
- **两件库级属性的口径**（与 `framingPresets` 的既有做法对齐）：① 排序（`moveKeywordTemplate`）
  **不改内容 → 不增版本**，但改动要落本机镜像，且返回的列表**就是新顺序**（调用方 setState 后直接用）；
  ② 同模式只留一套默认（`applyKeywordTemplateDefault`），被清标记的模板不增版本。
  默认模板之间是「取 `sortOrder` 最靠前的一套」，所以「设为默认」不一定等于「老师端会选中它」，
  还要排到同模式第一位（`keywordTemplateDirty()` 与保存时的改动清单同一口径逐字段比，顺序也算改动）。

### 验证脚本里的三个口径（US-110a 真踩）

- **`saving` 期间按钮是 disabled**：启停 / 保存按钮在 commit（推云端）期间不可点，脚本必须等它回到可用
  再点，否则**点击被丢掉**、断言停在「版本没变」上（看起来像功能没生效）。
- **本机镜像落盘是 state 变化触发的**：`setDraft()` 先跑、镜像后写。改完立刻读 `localStorage` 会读到上一版；
  断言镜像内容前先 `waitForCondition` 等镜像里那一版出现。
- **配了「适用课程类型 / 年龄段」的模板在别的上下文里不是「分数低」而是「不算候选」**：
  独立重算与断言必须给**完整上下文**（课程类型 + 年龄段都要给，与老师端同参），少给一个约束就会落到默认模板
  —— 那是正确行为，不是 bug。`data-keyword-template-*` 属性族（页面根 / 编辑区 / 列表行 / 分组 / 词条）
  是断言读数的入口，新增控件时顺手补同名族属性。

## 管理端「作品观察词模板」：拖拽排序 / 复制 / 导入导出 / 回滚（US-110b / F-REVIEW-KW-01）

US-110b 给同一张页面加了四件事，写侧规则**全部落在** `data/reviewKeywordAdmin.js`（页面只渲染与调用）：

| 动作 | 唯一入口（`data/reviewKeywordAdmin.js`） | 版本 |
|---|---|---|
| 拖拽排序（同模式内换位） | `moveKeywordTemplateTo(list, key, targetKey)`（键盘上移 / 下移仍是 `moveKeywordTemplate`） | **不增**（与 `moveFramingPreset` 同一口径：只动顺序） |
| 复制为派生模板 | `duplicateKeywordTemplateRecord(record, { existing, name, courseTypes })` | 新记录 = v1（快照 action `copy`） |
| 导出 / 导入 JSON | `buildKeywordTemplateExport` / `parseKeywordTemplateImport` / `mergeKeywordTemplateImport` | 导入 = 一次写入（内容有变化的那些 +1 版） |
| 回滚到任一历史版本 | `rollbackKeywordTemplateRecord(record, version)` | 新版本 = 当前 +1（快照 action `rollback`） |

- **顺序的唯一来源仍是数组位置**：拖拽 / 上移 / 下移最后都走 `applyKeywordTemplateOrder()`（同模式的一组按位次
  重排 `sortOrder` = 10、20、30…，别的模式一个不碰）。顺序决定老师端「多套命中取哪一套」
  （`resolveReviewKeywordTemplate` 的 tie-break 与「都没标默认时取排序第一套」），所以顺序改动**立即生效**、
  但**不该增版本**（它不改词条内容）；落盘 + 推云端与上移 / 下移完全一致。
- **拖拽是指针事件，不是 HTML5 DnD**：手柄 `onPointerDown` 起手（`data-keyword-template-drag=<key>`），
  拖动期间在 **window** 上收 `pointermove/pointerup`（指针会离开手柄），落点用
  `document.elementFromPoint().closest('[data-keyword-template-pick]')` 判，松手时再算一次落点。
  拖动中页面根挂 `data-keyword-template-dragging` / `-drop-key`，落点行挂 `data-keyword-template-drop-target`
  —— 验证脚本用 CDP `Input.dispatchMouseEvent`（mousePressed → 多次 mouseMoved → mouseReleased）真拖，
  这三个属性就是「拖到哪儿了」的读数。
- **复制为派生模板的两条口径**：① **手写的名字原样用**（只有撞名才 `uniqueKeywordTemplateName` 补 ` 2`），
  没给名字才派生 `源模板名（副本）`（`copyKeywordTemplateName`，与 agent 文件的副本命名同款）；
  ② **派生课程类型留空 = 照抄源的适用范围**，填了就用填的（`parseKeywordTemplateCourseTypes` 认逗号 / 顿号 / 分号）。
  副本永远 `isDefault: false` 且排在同模式最后（不插队改变老师端命中顺序），来源写进变更历史
  （`来源：<源名> vN，派生课程类型：国画`）。复制取的是**当前编辑的内容**（先过同一道保存闸门）。
- **导出封套要有 `type`**：`{ type: 'xinlehui-review-keyword-templates', version, exportedAt, exportedBy, count, templates }`。
  `parseKeywordTemplateImport()` 靠 `type` 认出「这是谁的文件」（拿装裱 / 海报的导出文件来导入会被点名拒绝），
  同时兼容裸数组与 `{ templates }`，解析**永不抛错**，坏文件只给一句可读原因、一个字段都不改。
- **导入 = 按 `templateKey` 合并，且幂等**：本机没有 → 加入（沿用文件里的版本与历史 + 一条 `import`）；
  内容有变化 → 更新并 `+1` 一版；**内容一致 → 原样跳过**（`keywordTemplateImportUnchanged()`），
  把刚导出的文件再导一次不会让每一套都白白多出版本。报告文案把三种结果都写出来
  （`导入完成：新增 X 套，更新 Y 套，跳过 Z 套（内容一致）。`）。导入的默认模板会把同模式原默认标记清掉。
- **回滚恢复的是**那一版快照里的**整份内容**（名称 / 模式 / 适用范围 / 启停 / 默认 / 分组词条），
  写法是「版本号 +1 + 写一版 `rollback` 快照」，`versions` 一条不删；**认不出的版本号或目标就是当前版本 →
  原样返回**（`rollbackKeywordTemplateRecord` 直接 return 入参对象，一个字段都不动）。页面上当前那一版的行
  回滚按钮是 disabled 的。
- **CSS 特异度坑（本轮真踩两次）**：`.persona-list button { width: 100% }`（0,1,1）会压过只手写一个类的
  `.keyword-template-drag-handle`（0,1,0）—— 手柄会变成整行宽、把「点击选中」挤成 26px 的窄条，
  看起来像拖拽逻辑坏了。**新增列表内元素一律写成 `.keyword-template-row <元素>`（0,2,0）**；
  窄屏 44px 兜底（`@media (max-width:430px)` 里的 `.keyword-templates-page button`，0,1,1）
  **压不住它**，所以媒体查询里要**再写一遍同等特异度的选择器**（媒体查询本身不加特异度）。
- **验证要点（本故事实测）**：拖拽用真鼠标事件；导出用页面内原型补丁抓
  `URL.createObjectURL` 的 Blob（`blob.text()` 读回字节）与 `HTMLAnchorElement.prototype.click` 的
  `download` 文件名字段，再与 `keywordTemplateExportFilename` 独立重算比对；导入用真文件
  （`DOM.setFileInputFiles` 指向 /tmp 的 JSON），坏文件另写一份；「老师端顺序立即生效」用
  「同一模式两套都配了同一个课程类型（score 相等）→ 谁排第一命中谁」来做，最后真的走一遍
  第一步上传 → 第二步装裱 → 第三步，读 `.review-keyword-template` 的 `data-keyword-template-name`。
  测试**别拿名字当主键**去镜像里找记录：回滚会把名字也退回那一版，按 `templateKey` 找。

## 管理端「作品观察词模板」：用大模型补充观察词（US-111 / FR-147、FR-148）

教研不想一个字一个字想词：模型先给一批**候选**（建议分组 + 词条 + 一句推荐理由），教研在上面挑。
页面只渲染与调用，判据全在两份零依赖模块里：

| 层 | 文件 | 管什么 |
|---|---|---|
| 读侧 | `src/data/reviewKeywordTemplates.js` | 容错 normalize / 老师端匹配 / 本机镜像（US-109） |
| 写侧（手写维护） | `src/data/reviewKeywordAdmin.js` | 草稿 / 校验 / 版本自增 / 分组词条增删排序（US-110a/b） |
| 写侧（模型补充） | `src/data/reviewKeywordAi.js` | 上下文与提示词 / 候选解析 / 去重与疑似同义 / 勾选 / 采纳 / 留痕文案 |
| 服务 | `src/services/reviewKeywordAi.js` | **独立通道**的模型链调用（自己的参数表，不 import `llmReview`） |
| 界面 | `src/admin/KeywordAiPanel.jsx` | 只渲染与调用；在 `KeywordTemplatesPage` 的编辑区里，按 `draft.templateKey` 重挂载 |

- **独立通道是结构性判据，不是注释**：`services/reviewKeywordAi.js` 自带 `KEYWORD_AI_PARAMS`
  （`stream + json_object + temperature 0.6`，与点评的 `REVIEW_MODEL_PARAMS` 是两份）与自己的
  system / user 提示词（`KEYWORD_AI_SYSTEM` / `keywordAiUserPrompt`），**不 import `services/llmReview.js`**、
  不碰人设 / 技能库 / agent.md / 记忆文件。断言直接盯这两点（无 llmReview import、无 `...REVIEW_MODEL_PARAMS`）。
- **模型链：文本优先 + 换档必须点名**：`keywordAiModelPlan()` 产出 `chain` = 可用的「文本生成」模型
  （能力标签 `文本生成`）→ 通用兜底 `REVIEW_MODEL_DEFAULT_ID`。本部署实测只有 `glm-5.3-flash` 可调
  （`glm-text-max` / `qwen3-vl-plus` 返回 `request_invalid_parameter`），所以真实链是
  `glm-text-max（model-unavailable）→ glm-5.3-flash`，回执上写「文本通道模型 glm-text-max 在本部署不可用，
  已自动改用 glm-5.3-flash」。**只有 `keywordAiErrorKind === 'model-unavailable'` 才换档**；
  网络 / 超时 / 未知错误不换档（交回界面重试或换模型）。明确选了一个模型 = 钉住它（chain 只留一条）。
- **候选的判据只有一个函数**：`keywordCandidateRows(candidates, { existing })` 同时给出
  「模板内已有 → 标灰跳过」「候选内重复 → 标灰跳过」「疑似同义 → 只提示、由管理员决定」，
  行渲染、采纳与断言都读它的产物（归一化复用 `reviewKeywords.js` 的 `normalizeKeywordText()`）。
  疑似同义：包含关系必提示，否则 bigram Dice ≥ `KEYWORD_AI_SYNONYM_THRESHOLD`（0.6）；
  调低阈值会把「暖色调 / 冷色调」这类反义词误报 —— Node 夹具里有这两条守卫，改动前先跑它。
- **采纳写草稿区，不写库**：`keywordCandidateAdopt(draft, rows, selection, { targetGroup })` **只动 `groups`**
  （分组不存在就建、重复词与每组 40 上限跳过并回报），版本自增仍由 `saveKeywordTemplateRecord()` 在
  点「保存」时做（验收原文「采纳写入草稿区，确认保存后模板 version 自增」）。
  **采纳后这批候选会立刻变成「模板内已有」并全部标灰**（面板按当前草稿实时重算）——这是防重复采纳，
  不是 bug：断言写「可采纳 0 条 + 采纳按钮禁用」，别写死标灰条数。
- **生成失败不毁上一批候选**：面板把「最近一次成功的候选」（`result`）与「最近一次尝试的回执」（`receipt`）
  分成两份 state —— 失败只换回执，候选与勾选都留着；手工新增词条在同一个草稿里，完全不受影响。
  这就是「生成失败时可重试或换模型，且不阻断手工新增词条」的实现点（`data-keyword-ai-receipt` /
  `data-keyword-ai-retry` / `data-keyword-ai-model-select`）。
- **三条留痕走同一份审计日志**（`data/auditLog.js`）：`keyword.candidates.generate` / `.adopt` / `.discard`，
  必填 `actorId / at / templateId`，detail 由 `keywordAiAuditDetail()` 产出（长名单写「…等 N 个」，
  呼应 240 字上限但不静默截断）。管理端「装裱设置 → 权限与合规 → 审计日志」与面板里的「AI 补充留痕」
  读的是同一份镜像；失败的那次生成**不留痕**（没有候选就没有「候选」这条留痕，回执上给可读原因）。
- **验证要点（本故事实测）**：桩必须**同步返回异步生成器**（`for await` 不解 Promise）；抓真实请求用替换
  `cloud.llm.chat.completions.create`（页面内 `import('/src/cloud.js')` 拿同一模块实例），
  再与 `KEYWORD_AI_SYSTEM` / `keywordAiUserPrompt(...)` **逐字符**比；「判据对真实输出也生效」用
  **DOM 行回填 → 纯函数重算 → 逐行比**。注意别拿镜像当参照系：草稿与镜像在「采纳未保存」时是不同的两份，
  面板的 `existing` 读的是**草稿**。
- **验证脚本的坑**：`keywordTermAdd(draft, groupIndex)` 是**追加**到这一组末尾，删的时候要删
  `组序号:原条数` 那个索引；写死 `0:0` 会把这组的第一个真词删掉（本轮真踩，症状是后续独立重算
  的参照系与面板差一个词）。

## 点评轨迹的留档审计与隐私（US-112 / F-REVIEW-TRACE-03、FR-110、FR-114）

「轨迹留档」（US-102 写、US-103 展示）到这里变成**可审计、可清理、有权重**的一层：管理端「生成日志」
能查任意一次点评的完整轨迹，而家长端连入口都不存在、服务端还会直接拒绝家长会话的查询。
判据集中在两份模块里，界面只渲染产物：

| 关注点 | 位置 | 说明 |
|---|---|---|
| 留存期 / 披露开关 / 可见性 / 筛选 / 清理预览 | `src/data/reviewTracePolicy.js` | 零依赖纯函数 + 常量，可 Node 直跑 |
| 轨迹留档结构（含老师 / 机构 / 学员 / 参数 / 技能） | `src/data/reviewTrace.js` | 白名单构造，见下 |
| 六分区载荷（轨迹 → 老师端那套 payload） | `src/data/reviewDetailPanel.js` 的 `reviewTracePayload()` | 管理端不另拼一套文案 |
| 平台开关的遮罩 | `src/data/reviewDetailPanel.js` 的 `reviewPromptDisclosureMask()` | 界面与两种导出读同一份 |
| 管理端面板 | `src/admin/ReviewTraceLogsPanel.jsx` | 挂在 `LogsPage`（`main.jsx`）里 |
| 系统配置（保留期 + 清除预览） | `main.jsx` 的 `TraceRetentionSection` | 在 `SettingsPage` 的 `settings-stack` 里 |
| 服务端查询 / 提交通道 | `server/index.mjs` 的 `/api/review-traces` + `services/reviewTraceApi.js` | 家长会话 403 |

- **轨迹字段分两类，别混**：`reviewTrace` 原本只有 `studentId`；US-112 补了 `studentName / teacherId /
  teacherName / orgId`（**筛选与可见性都要它**）与 `params`（本次真正发出去的参数表）与
  `loaded.skills`（逐项技能行）。加字段时三处都要动：`REVIEW_TRACE_FIELDS` 白名单、`createReviewTrace`
  的归一、`services/reviewTraceApi.js` 的 `rowToTrace` / `traceToRow`（snake_case 列）。
- **「谁经手的」决定可见性**：`reviewTraceVisibleTo(trace, viewer)` 是唯一判据 —— 家长恒 false；
  平台管理员全看；机构管理员看本机构（轨迹没写机构的历史记录按本机构算）；老师必须**同机构 + 本人**
  （`actorId` 命中或姓名命中）；**没写老师的旧轨迹对老师不可见**（fail-safe，别为了「看起来有数据」放宽它）。
- **「平台开关」与「本会话能不能看」是两件事**：`reviewPromptDisclosureAllowed(policy, { role })` 里
  管理员恒 true（开关面向老师端：管理员要能审计自己关掉的是什么）。所以面板上要用
  `normalizeReviewTracePolicy(policy).allowPromptDisclosure` 单独读**开关状态**来写文案，
  拿 `promptAllowed` 写「开关当前开启/关闭」在管理端会说反（US-112 真踩，浏览器断言当场抓到）。
- **关闭披露 = 遮罩载荷，不是 `display:none`**：`reviewPromptDisclosureMask(payload, { allowed })`
  清空 prompt 分区的 `system` / `user`（字数留下），并给分区挂 `restricted` + 那句话；
  `reviewDetailMarkdown()` 认这个标记 —— 所以「界面上看不到」与「复制 / 导出里也没有」是同一份判据。
  `allowed` 为真时**原样返回同一个对象**（默认开启逐字符不变）。
- **日期筛选按本地时间折算**（真踩）：轨迹的 `createdAt` 是 `new Date().toISOString()`（UTC），
  直接 `slice(0,10)` 会把「本地今天凌晨」的记录算成昨天，管理端「按今天筛」就漏它。
  `reviewTraceDateKey()`（服务端 `traceDay` 同口径）只有**纯日期字符串**才原样取。
- **家长会话查询在服务端被拒**：`GET /api/review-traces` 先过 `requireTraceAudience()` ——
  带有效家长令牌 → 403「家长会话不能查询点评轨迹」；带**认不出的令牌**（家长端的会话令牌由云端签发，
  开发适配器验证不了）→ 同样 403（fail-safe）；`X-Actor-Role: parent` → 403；缺身份 → 401。
  客户端 `reviewTraceQueryHeaders()` 在本地也会拦住 `role === 'parent'`（不发请求），
  两条路一起才是「服务端直接拒绝 + 界面无入口」。
- **适配器上的轨迹只驻留内存**（与儿童素材同一条纪律）：`POST /api/review-traces` 落内存 Map（上限 500），
  服务端再复核一次「不含 `data:image/` / `base64` / `blob:`」；老师的查询按 `X-Actor-Id` 只返回本人经手的。
  **中文身份串要百分号编码**（HTTP 头只安全承载 ASCII，原型里的老师身份就是姓名），
  服务端用 `decodeHeaderValue()` 解。
- **复制 / 导出轨迹必须留痕**：`AUDIT_ACTIONS.traceCopy / traceExport`，必填 `actorId / at / traceId`，
  导出范围写进 `scope`（`reviewTraceAuditScopeText()` → 「导出 Markdown · 6 个分区 · 学员 陈一诺」，
  提示词受限时点名）。`AUDIT_ENTRY_FIELDS` 与 `buildAuditEntry` **两处**都要加 `traceId`
  （白名单是给云端 payload 用的，构造是显式列字段的 —— 只改一处，entry 上就没有这个字段）。
- **到期清理必须先预览影响范围**：`reviewTraceCleanupPreview()` 与 `applyReviewTraceCleanup()` 是同一份口径
  （预览说几条就删几条），预览的行要**点名**（时间 / 学员 / 模型 / 状态）；`retentionDays: 0` = 长期保留
  （预览明说「不会删除任何轨迹」）。清理写回本机镜像走 `persistReviewTraces()`（整体写，逐条过素材守卫）。
- **验证要点（本故事实测）**：管理端面板的六分区与老师端是**同一份载荷结构**，断言直接用
  `data-review-trace-section="reasoning|loaded|prompt|model|usage|output"` 数它与顺序；
  老师端那侧要**先点 `[data-detail-toggle]` 展开**（默认折叠，US-103a）——否则 `[data-detail-section]`
  根本不存在，断言会以「Cannot read properties of null」的形式炸掉（本轮真踩）。
  注入历史轨迹做清理断言时，**注入后要先回「生成日志」页**（面板在挂载时刷新 App 的轨迹账），
  否则系统配置里的预览读的是注入前的旧账，会看到「到期 0 条」。

## 视频任务的权限 · 留痕 · 保留期 · 配额 · 签名地址（[第四步 US-223] / FR-311 ~ FR-315）

US-222 管「成片怎么版本化」，这一节管「谁能碰这些成片、动过之后查不查得到、留多久、放不下怎么办、
地址能不能被转发」。五件事各有一份**零依赖数据模块**（Node 可直跑断言），界面只渲染它们的产物：

| 关注点 | 唯一真源（`src/data/`） | 界面 / 消费点 |
|---|---|---|
| 谁能提交 / 下载 / 审计 / 播放 | `videoPermissions.js`（班级归属**委托** `archiveAccess.js` 的 US-211 判据） | 老师端面板 `[data-video-access]`；管理端权限矩阵 `[data-video-permission-row]` |
| 六条留痕的构造与复核 | `videoTaskAudit.js`（动作键与必填清单在 `auditLog.js`） | `recordAudit` 的调用点全在 `GrowthArchiveData.jsx` 的视频面板 |
| 两份保留期 + 到期清理预览 | `videoRetention.js`（预览与执行读同一支纯函数） | 管理端「档案管理」的 `VideoCompliancePanel`（`data-video-retention-*` / `data-video-cleanup-*`） |
| 存储与流量配额 | `videoQuota.js`（用量与留痕同源；`videoQuotaSubmitIssue` 是唯一判据） | 老师端提交按钮的 `disabled` + `[data-video-quota]` |
| 签名临时地址 | `videoSignedUrl.js`（签名 / 有效期 / 不超过分享有效期） | 老师端 `[data-video-signed-url]`；管理端策略块 |

- **六条留痕的动作键与字段**：提交 / 完成 / 下载 / 更换音乐 / 删除成片五条是新动作
  （`video.job.submit` / `video.job.done` / `video.output.download` / `video.music.change` /
  `video.record.delete`），**分享复用图文分享的 `archive.share.generate`**（成片分享与图文分享走同一条
  令牌账，不另造一套「视频分享」）。`AUDIT_ENTRY_FIELDS` 与 `buildAuditEntry` **两处**都要有
  `jobKey / videoKey / bytes`（白名单给云端 payload 用、构造是显式列字段的 —— 只改一处字段就不落库）。
- **分享那条动作有自己的一条必填 `recordId`**（`AUDIT_ACTION_REQUIRED` 里是图文分享口径）：
  `videoAuditEntryInput` 在 `share` 存在时把成片键写进 `recordId`（延续 US-082 的 `recordId: created.jobKey`），
  否则管理的合规面板会把这条留痕标成「缺 recordId」。**复用既有动作键的新留痕，先读一眼那条动作的必填清单。**
- **「完成」只记一条**：写入口在 `GrowthArchiveData.jsx` 的一个 effect 里，判据是
  `latestAuditEntry(auditLog, video.job.done, {jobKey})` —— 刷新 / 重新进页面时任务**还是** done，
  但只靠组件内的 ref 去重会跨会话重复记（每个新实例都写一条）。**「只记一次」类留痕要拿日志本身当基线。**
- **权限判定委托，不抄第二份**：`videoTaskAccess({viewer,management,student,className,action})` 的
  「本班」那一支直接调 `archiveRecordAccess(...)`（US-211 的唯一真源）；管理员只放行 `audit`
  （可审计 ≠ 可拿孩子的视频），家长只有 `play` 且必须过 `archiveShareAccessView` 四道。
  界面矩阵（`videoTaskPermissionRows`）与断言读同一份 —— 「谁能做什么」是读数，不是描述。
- **配额把用量与留痕绑在一起**：存储 = 成片记录的 `bytes` 之和，流量 = 审计日志里
  「下载成片」**且未被拒绝**的 `bytes` 之和（本月窗口）—— 体积读不出来记 0、不虚报。
  `videoQuotaView` 的 `blocked` → `videoQuotaSubmitIssue` 给可读原因，界面禁用提交按钮读的就是它。
- **保留期两份分开配**：中间产物（任务结束时间起算）与成片（生成时间起算）各自可配到「长期保留（0）」；
  **锚点读不出来一律不清理**（宁可留着也不误删孩子的成片）；`videoRetentionPreview` 与
  `applyVideoRetentionCleanup` 是同一支纯函数 —— 「预览说几条、执行就删几条」是结构性的。
- **签名地址只判定、不签名**：`videoSignedUrlIssue` 的判据顺序是
  https（复用 `videoJobOutputUrlIssue`）→ 有签名参数 → 有有效期参数 → 没过期 → **有效期 ≤ 分享有效期**。
  比较分享到期时刻时 `shareTokenExpiresAt()` 返回的是 **ISO 串**，必须先 `Date.parse` 再比
  （直接 `Number.isFinite` 比大小会静默失效，本故事真踩）。演示队列上永远没有成片地址 →
  `videoSignedUrlView` 给 `present:false` + 一句实话，**不编一个没有有效期的公开地址**。
- **验证方式（本故事实测）**：`pnpm run build` 通过（377~404ms）；Node 直跑 **104 项**
  （`/tmp/assert-us084-data.mjs`：权限五个角色 × 四个动作、六条留痕的构造 / 复核 / 汇总、
  两份保留期与预览同源、配额用量与超限拦截、签名地址四种不合规分支）；
  浏览器 **85 项**（`/tmp/assert-us084-browser.mjs`：老师端放行 + 跨班拒绝、提交 / 完成 / 分享 /
  更换音乐 / 删除各一条留痕且最近一条读数正确、配额超限禁用提交、管理端矩阵与六条汇总、
  到期清理预览 → 执行 → 回执与留痕、长期保留不清理、390px 不横向溢出）；回归 US-070~083 data 全绿、
  US-072~079/082/083 browser 全绿（US-072 那 1 项「提交按钮文案」在 HEAD 上就已失败，属 US-214 口径变更）；
  截图 421~426 留档。

## 视频模块的移动端与弱网（[第四步 US-224] / FR-316 ~ FR-320）

四条验收（提交后可离开页面 / 锁屏回来恢复进度、播放器占位竖屏自适应并支持全屏、弱网重复点击不重复建任务、
390px 任务卡片与音乐面板不溢出）各有一份真源，界面只渲染**当场量出来的读数**：

| 关注点 | 唯一真源 | 界面 / 消费点 |
|---|---|---|
| 占位盒子尺寸（9:16、高 ≤70vh、不超容器宽）与合格判定 | `data/videoMobile.js` 的 `videoPlayerBox` / `videoPlayerFit`（CSS 里是同一套数字：`width:min(100%,calc(70vh * 9 / 16))`） | 老师端 `[data-video-preview-player]` + 读数面板 `[data-video-mobile-row="player"]` |
| 逐块横向溢出判定 + 被测量的块清单 | `data/videoMobile.js` 的 `VIDEO_MOBILE_TARGETS` / `videoOverflowReport`（页面整体那一块**用视口宽当客户宽**，`html.clientWidth` 会被内容一起撑大） | `[data-video-mobile-target]` 逐行读数（`-scroll` / `-client` / `-overflow`） |
| 六项读数与总判定 | `data/videoMobile.js` 的 `videoMobileView`（所有状态同形状；`ok:false` 时点名哪几项） | `VideoMobilePanel`（`data-video-mobile-*`），「重新测量」按钮 = 当场复量 |
| 全屏 API（标准 + webkit 两条路） | `services/videoMobile.js` 的 `videoFullscreenSupported` / `requestVideoFullscreen` / `exitVideoFullscreen` / `subscribeVideoFullscreen` | 占位元素上的 `[data-video-preview-fullscreen]`（文案 `全屏查看` / `退出全屏`） |
| 「锁屏回来补推进一次」 | `services/videoJobQueue.js` 的 `attachVideoJobVisibilityResume`（`visibilitychange` + `pageshow`）+ `data/videoMobile.js` 的 `videoJobVisibilityResumeNote` | `[data-video-mobile-visibility-resumes]` 计数 + 面板上那句话 |
| 提交锁窗（弱网重复点击） | `data/videoMobile.js` 的 `VIDEO_JOB_SUBMIT_LOCK_MS` / `VIDEO_JOB_SUBMIT_LOCK_TEXT`；**结构性保证仍是 jobKey 幂等** | 提交 / 重新生成两条入口共用 `beginSubmitLock` / `blockRepeatSubmit`，读数 `[data-video-mobile-blocked]` |

- **锁窗按 jobKey 记，不按按钮记**：同一个键在窗口内的第二次点击直接忽略并计数（回执里点名
  「同一条 jobKey 只会有一条任务，没有重复创建」）；**换周期 = 换 jobKey，不受上一次窗口影响** ——
  US-072 的并发用例就是 250ms 间隔连提三个周期，按按钮记会把那三条拦掉。
- **锁窗里不要禁用按钮**：被禁用的按钮收不到点击，就**数不出**「挡下了几次重复点击」，
  而「弱网不重复建任务」的证据正是那个数。按钮保持可点、由处理函数按键判并在面板上报数。
- **重新生成也是同一条 jobKey**：`regenerateVideo` 先过锁窗再走 `discardVideoJob` + 重排；
  连点 4 次只落地一次的表现是「成片版本 +1、attempts 从 0 数到 1」，不是 attempts 累加
  （重排会摘掉任务记录重建，所以 attempts 归 1 是正常的）。
- **`fullscreenchange` 可能永远不派发**（本故事实测，headless Chrome：`document.fullscreenElement`
  真的变了、页面级监听一个事件都收不到）。所以界面状态**不能绑死在事件上**：
 ① 点按钮时按 `requestFullscreen()/exitFullscreen()` 的结果**乐观同步**；
 ② 每次测量（挂载 / resize / 转屏 / 回到前台 / 「重新测量」）拿 DOM 的真实值**对一次账**；
 ③ 事件订阅只负责带外变化（Esc、系统控件、页面里直接调 API）。断言时也要两条都验
（浏览器层 `document.fullscreenElement` + 界面层 `data-*` 读数）。
- **「进度按真实经过时间推」的可验证口径**：任务自己记着 `startedAt` / `updatedAt`，
 用 `videoJobProgressFromElapsed(updatedAt - startedAt, mockSeconds×1000)` 独立重算应当等于卡片上的
  `data-video-job-progress`（±1）——**基线要取任务自己的时间戳**，不要取「脚本此刻的 Date.now()」：
  后台 / headless 里 `setInterval` 会被节流，按此刻重算必然对不上（US-085 第一版就这么假红一次）。
- **验证方式（本故事实测）**：`pnpm run build` 通过（396~455ms）；Node 直跑 **76 项**
  （`/tmp/assert-us085-data.mjs`：盒子数学 / 越界与容差 / 逐块溢出（含页面整体用视口宽）/ 六项读数
  与失败点名 / 恢复文案）；浏览器 **107 项**（`/tmp/assert-us085-browser.mjs`：真实鼠标手势进出全屏
  + 带外退出后对账、连点 6 次只建一条任务（挡下 5 次）、重新生成连点 4 次只 +1 版、
  锁屏 → 回到前台进度按真实时间接着算且 attempts 不重置、390px 逐块不溢出 + 横屏自适应 + 44px、
  刷新后按 jobKey 恢复）；回归 US-072~079/082/083/084 data 全绿、
  US-072 82/83（那 1 项「提交按钮文案」在 HEAD 上就已失败）、US-079 110/110、US-082 100/100、
  US-083 62/62；截图 427~434 留档。

## 归档唯一键：课次 + 学员（[第四步到第一步联通] US-414 / FR-447）

归档记录的业务唯一键是 **`lessonId::studentId`**（`data/feedbackRecords.js` 的 `resolveRecordKey`）。
它要求归档**落在一条真实课次实体上** —— 老师没点过「保存课次」也要有实体，否则键会退化成
「班级 + 日期 + 学员 + 作品名」，同一天两节课会被判成同一次更新（一条档案吃掉另一条）。

- 判定的唯一真源是 `src/data/archiveLesson.js`（零依赖纯函数）：`archiveLessonKey()` 产出课次的
  **自然键**（`班级::课次日期::课时序号`，拼法直接调 `data/lessons.js` 的 `lessonKeyOf`，不另拼一份），
  `resolveArchiveLesson()` 产出四选一：`selected`（会话里那条）/ `natural`（列表里同自然键那条）/
  `create`（归档那一刻把表单落成课次）/ `none`（没有课次 → 退化键，历史记录的可读路径）。
  写入在 `services/lessonApi.js` 的 `ensureArchiveLesson()`：判定用「会话列表 ∪ 本地镜像」，
  建之前先 `queryLessons` 问一次云端（同一次课可能已在别的设备建过 —— 认它，别留两条实体），
  新建走 `createLesson`（**不带 lessonId**，否则两条课次共用一个 id）。
- **界面读数与写入侧必须是同一份判定**：`main.jsx` 的 `archiveIdentity` / `archivedRecord` 都用
  `resolveArchiveLesson` 的结果。课次还没落库（`create`）时**不要拿退化键去碰历史记录**
  （`archiveLessonReady` 为 false → `archivedRecord = null` → 按钮如实说「新建」），
  `data-archive-record-key` 也留空 —— 那一段 `lessonId` 是归档那一刻才生成的，算不出就别假装算得出；
  按钮上另给 `data-archive-lesson-natural-key`。归档后按 `created`（**本地镜像也算**，见下）
  在 toast 里补一句「已为这次归档保存课次：第 N 次课 · …（已保存在本机）」，并在第一步面板留同一句回执。
- **本机云端的 `lessons` 表不存在**（实测 `DATABASE_PGRST205: Could not find the table 'public.lessons'`）：
  课次的所有云端读写都会**抛错**，`saveLesson` 的「先落本地镜像再推云端」因此只剩镜像这一半 ——
  课次数据以 `localStorage` 的 `xinlehui-lessons-v1` 为准。相关口径：`ensureArchiveLesson` 的
  `created` 在「云端写失败但镜像里写下来了」时**也算真**（否则那句回执永远不出现），
  另给 `remote` 标志让界面区分「已保存在本机」。别把 `created` 写成「云端成功」的意思。
- **课次自然键的判定不许用 `normalizeLesson` 的默认值补齐**：它会把缺失的日期填成今天、序号填成 1，
  于是「看起来有键」而实际是编出来的（同一天两节课在这里被合并就全白做）。`archiveLessonKey` 三样
  缺一返回空串，`none` 才是正确结论。表单改过日期 / 序号但没重新保存时**以表单为准**：
  记录上的日期 / 课题 / 班级本来就来自表单，课次实体跟着表单走才不会两个来源打架。
- 验证方式（本轮实测）：`pnpm run build` 通过（366~396ms）；Node **65 项**（`/tmp/assert-us086.mjs`：
  自然键口径 / 四种来源 / 两段键与退化键不互撞 / 同一天两节课两个键 / 旧记录 id 与退化键不变 /
  `ensureArchiveLesson` 云端可用 + 弱网镜像两条路径）；浏览器 **36 项**（`/tmp/assert-us086-browser.mjs`：
  **不点「保存课次」** 直接走完流程归档 → 课次在归档那一刻建出来且 `recordKey = lessonId::studentId`、
  再归档命中间一条（update、版本自增、记录不增加）、新建草稿后同一天第 N+1 次课 = 另建课次 + 另一个键
  （第一节课的记录版本不动）、注入无课次的历史记录 → 刷新后仍在 + 退化键与 id 不变 + 家长端渲染得出、
  console 0 报错）；回归 US-058 66/66、US-059 data 53/53 + browser 46/46、US-060 data 27/27 +
  browser 79/79、US-061 67/67、US-071 80/80 全绿；截图 435~437 留档。

## 视频时间线排序：课次日期 + 课时序号（[第四步到第一步联通] US-087 / FR-447）

个人 / 班级视频时间线的顺序**只**由课次字段决定：`lessonDate` 升序 → 同一天再按 `lessonNo` 升序。
归档时间（`archivedAt`、记录列表里的先后、谁先归档）**一个字都不参与** —— 补录上周的课次时，
它按「上周 · 第 N 次课」就位，而不是因为「刚刚才归档」被排到队尾。

- 唯一实现在 `src/data/videoTimeline.js`：`VIDEO_TIMELINE_ORDER_TEXT` / `ORDER_NOTE`（口径文案）、
  `videoTimelineOrderKey()`（日期过 `normalizeLessonDate`、序号过 `normalizeLessonNo`）、
  `compareVideoTimelineEntries()`、`orderVideoTimelineEntries()`（稳定排序，返回新数组）。
  **四处调用点全部改读它**（`videoTimelinePlan`、精选 `videoSelectionPlan`、`videoPersonalPlan`、
  `videoClassPlan`）—— 以前四处各抄一份「日期升序 + 同日按输入顺序」，改口径要改四遍。
- 排序规则的三条细节（都写在 `compareVideoTimelineEntries` 的文档里）：① 日期口径统一
  （`2026.08.04` 与 `2026-08-04` 是同一天）；② 同一天里**序号未知（0）的排在有序号的之后**
  （未知不是「第 0 次课」）；③ 日期与序号都相同（同一节课里不同学员的条目 / 都未知）时**保持原有顺序**，
  不要拿 `recordKey` / `id` 之类再排一道 —— 那会把班级成片里「同一节课多位学员」的相对次序
  换成 id 字典序，US-216/217/218 的既有夹具与断言都会被莫名搅动，而验收要的只是课次先后。
- `lessonNo` 的数据链路（一条记录怎么带上它）：
  ① 归档时写入 —— `main.jsx` 把 `archiveLesson.lesson?.lessonNo || lessonNoValue` 传给
     `createFeedbackRecord`（`data/feedbackRecords.js` 的 `normalizeFeedbackRecord` 收敛成 0 = 未知）；
  ② 归档条目 —— `data/archiveResident.js` 的 `archiveLessonEntry(record, { lessons })` 走
     `archiveEntryLessonNo()`：记录自带就用它，**老记录只有 `lessonId`** 时按 id 在课次列表里补序号，
     查不到如实 0（不猜：序号猜错会把两节课的先后排反）；条目上给 `lessonNo` / `lessonNoText`；
  ③ 帧 —— `videoTimelinePlan` 把条目的 `lessonNo` 抄到作品帧与照片帧上（`VIDEO_FRAME_FIELDS` 里有它），
     `videoFrameRow` 给 `lessonNo` / `lessonNoText` / `dateText`（`2026.08.04 · 第 12 次课`）；
  ④ 界面 —— `GrowthArchiveData.jsx` 用 `loadLessons()`（本机课次镜像，**云端没有 lessons 表**）
     把课次列表传给 `archiveResidentView({ lessons })` 与三处 `archiveLessonEntry`，
     帧行渲染 `data-*-frame-lesson-no` / `data-*-frame-date-text`，三个面板各渲染顺序读数与
     「归档先后不参与排序」那一句（`data-video-timeline-order-text` / `data-personal-order-note` /
     `data-class-frame-order-note`）。
- **真踩过的两个坑**：
  ① `archiveResidentView` 的入参 `lessons`（课次实体列表）与视图产物里的 `lessons`（筛完还看得见的
     归档记录）**同名**：直接把它当局部变量用，返回的 `lessons` 就变成了课次列表（`count` / 空态 /
     档案时间线一起错）。现在局部变量叫 `visibleRecords`，并在注释里点名这件事。
  ② 班级视频的类目筛选读 `record.className`，而第一步班级下拉的 **option 文本带「（任课老师）」**
     （`周六创意绘画 2 班（林晓老师）`）—— 拿它当 `className` 写进夹具/记录，班级面板永远筛不中
     （个人面板却看得到，很容易误判成「班级面板坏了」）。夹具里的班名要取**记录上的 className**。
- **本故事的边界**：档案页自己的「课次时间线」（`archiveResidentView` 的 `entries`，过滤在
  `data/archiveTargets.js` 的 `filterArchiveRecords`）仍是**日期升序**（同日按记录顺序），
  不按课时序号重排 —— 本故事只改视频时间线。以后要动它，先想清楚档案页与视频的窗口口径差异。
- 验证方式（本轮实测）：`pnpm run build` 通过（361~417ms）；Node 直跑 **52 项**
  （`/tmp/assert-us087.mjs`：排序键归一 / 同日两节课 / 日期优先 / 未知序号排后 / 同日期同序号保序 /
  归档时间反着设不影响 / 记录与条目的 lessonNo 链路 / 四个视图产物给出同一份顺序读数）；
  浏览器 **39 项**（`/tmp/assert-us087-browser.mjs`：真机归档两节课 → `lessonNo` 落库 +
  成长档案上「较早的历史课次在前」、**倒着注入**同一天两节课 → 界面排出 3/4、
  追加在数组最后的补录课次排在最前面、老记录（只有 `lessonId`）由课次镜像补出序号、
  班级段内同样是课次顺序、390px 不溢出、console 0 异常）；回归 US-075 95/95、US-076 100/100、
  US-077 91/91、US-078 94/94、US-079 110/110、US-059 46/46、US-060 79/79、US-071 80/80、
  US-074 72/72（首跑因机器忙超时假红，清干净 Chrome 后重跑全绿）、US-082 100/100、US-083 62/62、
  US-084 85/85、US-085 107/107、US-086 36/36 全绿；截图 438~440 留档。
- 断言脚本口径：US-077 的「串联顺序读数 / order 规则那一条」文案已随本故事改成
  `按课次日期 + 课时序号升序`（`/tmp/assert-us077-data.mjs` 三处 + `/tmp/assert-us077-browser.mjs` 一处）。

## 海报模板（poster spec v1）的数据模型与收敛（[海报 US-301a] / FR-301 ~ FR-307）

`src/data/posterTemplates.js` 是「后台改参数即出新模板」的**唯一真源**（data 层、零依赖纯函数，
可 `node` 直跑断言；渲染实现将来落在 `services/poster.js` 的 `renderPoster({ spec, data, scale })`，
预览与导出共用同一个函数、只差 `scale` —— FR-312）。与装裱是**同构的两套**：

| | 装裱 | 海报 |
|---|---|---|
| spec 形状 | v1 平面 / v2 分组（`services/frameSpec.js`） | `version / kind / canvas / background / frame / decor / slots[]` |
| 收敛器 | `normalizeFrameSpec` / `normalizeFrameSpecV2` | `normalizePosterSpec`（**永不抛错**，见下） |
| 模板记录 | `data/framingPresets.js`（`framing_presets` 表） | `data/posterTemplates.js`（`poster_templates` 表，读写 US-302b） |
| 云表读写 | `services/framingPresetsApi.js`（`preset_key`） | `services/posterTemplatesApi.js`（`template_key`，幂等初始化见下节） |
| 本机镜像 | `xinlehui-framing-presets-v1`（`load/persistFramingPresets`） | `xinlehui-poster-templates-v1`（`load/persistPosterTemplates`，同一口径） |
| 模板层级 | `scope` + `ownerKey`（US-001b） | **同一套**：`normalizeFrameScope` 直接复用，别再发明一套权限模型 |

- **比例坐标（FR-303）**：位置 `x / y`、尺寸 `w / h`、字号 `sizeRatio`、字距 `letterSpacingRatio`
  全是**相对画布短边**的比例，禁止绝对像素。单位换算只有两个入口：`posterShortEdge(canvas)` 与
  `posterRatioToPixels(value, canvas)` —— 渲染层要换算就走它们（预览 1080 宽与导出 2160 宽因此同构）。
  **长画布的 `y` 可以大于 1**（1080×1920 的画布高 = 1.778 个短边、4096 高的长图约 3.79），
  所以 `POSTER_POSITION_RATIO_RANGE.max = 4`：看到 `y: 1.62` 不是越界，别「顺手修正」它。
- **四种占位区（FR-302）**：`image`（作品图，`contain` + 白底 + `radiusRatio` + 可选 `shadow` / `border`；
  多图拼贴用同一个 slot 的 `grid`，`columns/rows = 0` 表示**自适应**：4→2×2、6–9→3×3、10–12→3×4）、
  `text`（`template` 含 `{变量}` + 字体白名单 + `sizeRatio` + `maxLines` / `lineHeight` / `letterSpacingRatio`）、
  `qrcode`（`sizeRatio` / `value` / `caption`）、`logo`（`maxWRatio` / `opacity` / 可选 `url`）。
  每类都带 `visible`（false = 完全不绘制）与 `opacity`。
- **`normalizePosterSpec` 的三条纪律**（写死的，别改）：
  ① **未知类型丢弃、其余字段回落默认值** —— `type` 不在四种里没有合理默认（画出来是错的），
  该 slot 直接丢；其余字段（含枚举）缺失**或非法**一律回落「该占位区的默认值」（`DEFAULT_POSTER_*_SLOT`）；
  ② `slots` **缺失 / 非数组** → 回落默认版式（单作品六件套），**显式空数组保持为空**（那是明确的表达）；
  ③ **永不抛错**（FR-307）：`normalizePosterSpec(undefined)` 等于 `DEFAULT_POSTER_SPEC`，
  且幂等（`normalize(normalize(x))` 深等 `normalize(x)`）。
- **字体白名单的回落口径与装裱一致**：白名单内原样；**写了但不在白名单 → `sans-serif`**；
  没写才用该占位区的默认字体（默认文字位是 `serif`）。海报只支持 `contain`：`fit: 'cover'` 会被
  收敛成 `contain`（FR-309：海报只做排版，绝不裁切孩子的作品）。
- **两处「看起来像 bug 的默认值」**：`image.border` 显式写 `null` 才是**没有边框**，不写则回落默认细边框；
  `normalizePosterSpec` 的数值收敛**不认**布尔 / 数组 / 对象（`Number(true) === 1`、`Number([]) === 0`
  会把「字段缺失」悄悄变成「一个像样的值」），只认数字与数字串。
- **内置模板数据**（AC1 的「内置模板数据」）：`seedPosterTemplates` 现在是 **8 套**（US-302a 补齐，
  见下一节），走 `builtinPosterSpec()` 构造 —— 种子过同一个收敛器，所以「内置模板一定合法」是结构保证。
  每套必须预留**二维码位与 Logo 位**（可 `visible: false`，字段要在）且二维码可见数 ≤1（FR-323 / FR-325），
  这两条与 `posterSpecIssues()` 读同一份判据。模板记录的库级字段沿用装裱：
  `enabled / builtin / isDefault / sortOrder / entryScope`（`archive | feedback | both`，US-309 用它置灰入口）。
- **文案变量（FR-304）**：`POSTER_VARIABLE_KEYS`（15 个，含验收点名的七个）是白名单真源，
  `posterTemplateVariableNames()` / `posterUnknownVariables()` 给面板与校验读数用；
  口径同装裱：**未知变量保留原文**并由校验点名，命中但上下文无值替换成空串（渲染层的事）。
- **校验读数**：`posterSpecIssues(spec)` / `posterTemplateIssues(record)` 逐项列出「被收敛了哪里」
  （越界 / 未知枚举 / 丢弃的 slot / 白名单外字体 / 未知变量 / 蓝色主视觉 / 二维码数量 / 缺 Logo 位）。
  结构级规则（缺二维码位、缺 Logo 位）**只在作者显式写了 `slots` 时检查** —— slots 缺失会回落默认版式，
  对着回落值报「缺 Logo 位」是假警报（本轮真踩，被断言抓出来）。
  「可扫性（`POSTER_QR_MIN_PIXELS = 120`）、文字溢出、越界」要真渲染一次才算得出来，属 US-311a。
- **踩过的两个「永不抛错」的坑**（fuzz 断言抓出来的，都是同一类）：
  ① **别对任意值 `Number(...)`**：`Number([Symbol()])` 会走数组 join → toString 直接抛错；
  ② **别对任意值 `String(...)`**：`String([Symbol()])`、`String(Object.create(null))` 同样抛。
  所以本模块的 `str()` 带 try/catch，`pushRangeIssue` 只对数字与数字串求值、报文案前一律过 `str()`。
  新增任何「把原值写进文案」的地方都照这个写法。
- 验证口径：`~/.nvm/versions/node/v22.23.2/bin/node --experimental-loader /tmp/zcode-ext-loader.mjs
  /tmp/assert-us088.mjs`（**39 组**：枚举真源 / data 层分层纪律 / spec 结构 / 12 组垃圾输入不抛错 /
  越界与枚举回落 / 幂等与「不修改输入」/ 比例坐标 / 内置模板合法性与几何越界 / 变量白名单 /
  校验读数 / **300 组随机嵌套脏数据 fuzz**）。本故事**没有 UI 改动**，因此不做浏览器验证；
  模块目前还没有消费点（US-301b / US-302a 接上）。

## 海报渲染引擎 `services/poster.js`（[海报 US-301b] / FR-308 ~ FR-312）

参数化模板 → canvas 的**唯一落笔处**：`renderPoster({ spec, data, scale })` 返回
`{ blob, dataURL, canvas, plan, warnings, … }`（`renderPosterToCanvas` 是它的画布层）。
预览与导出**就是这一个函数、只差 `scale`**：`scale = 1` 得 1080 宽预览、`scale = 2` 得 2160 宽导出。

- **绘制坐标系永远是 spec 的逻辑画布，最后只做一次 `ctx.scale(deviceW/logicalW, deviceH/logicalH)`**
  （与装裱 US-008a 的导出同一条口径）。于是 `plan` 里的一切（盒子 / 字号 / 二维码模块大小）
  **不随 scale 变**；设备像素只在 `plan.canvas.deviceWidth/deviceHeight` 上。断言像素时要自己乘 `scale`。
  「同一函数、只差 scale」的**证明方式**（别用逐字节相等 —— 文字抗锯齿必然不同）：
  ① 两档 `plan` 逐值相同；② 把 scale=2 的图缩回 scale=1 的尺寸后逐像素比，平均通道差 ≤ 3、
  差异 > 60 的像素占比 < 0.5%；③ 平坦区取十几对 (x, y) ↔ (2x, 2y) 采样点，通道差 ≤ 8。
- **画笔顺序**：背景 → 分隔线（decor）→ slots（按数组顺序）→ 相框（最后画，最外圈不被占位区盖住）。
  `visible: false` 的占位区**完全不进绘制层**（不画、不留空白占位）——`plan` 里如实写 `reason: 'hidden'`。
- **`plan` 是给界面与断言读的唯一读数**：每个占位区 `{ drawn, reason, box, … }`，文本带
  `lines / truncated / dropped / font / lineHeight`、图片带 `cells[]`（每格的 `box / imageBox / captionBox`）、
  二维码带 `modules / version / plate / quiet`。**别让界面反推渲染结果**，也别在组件里重算版式。
- **文本：先设 `ctx.font` 再 `measureText`**（本轮真踩：字体在测量之后才设 → `measureText` 用的是
  默认 10px sans-serif → 断行判据失效 → 长句一行铺满整张画布，plan 里 `lines.length === 1`、
  墨迹分带只有 1 条）。`layoutPosterText()` 的 `measure` 是**注入**的（浏览器给 `ctx.measureText`），
  所以换行 / 截断 / `dropped` 计数可以脱离 canvas 用假测量断言。
  口径：中文逐字测宽、拉丁词元尽量整词（放不下再逐字符硬拆）、显式 `\n` 强制换行、
  换行处吞空格、**省略号也要挤进 `maxWidth`**（放不下就继续丢字，最后可能整行只剩「…」）。
  超行时 `warnings` 追加 `posterTextOverflowWarning()`（FR-311 的「导出前溢出警告」，
  界面直接渲染这一句，不许自己拼）。
- **图片：`contain` 等比 + 居中，`drawImage` 只给目标框、不给源裁剪参数、不设任何滤镜**（FR-309）。
  白底卡片 = 圆角路径填充（可选阴影用 `ctx.shadow*` 只在这一层）→ 作品裁剪到**内圈圆角**
  （`max(0, radius - padding)`，留白足够时连这个裁剪都不发生）→ 可选边框描边（内缩 `lineWidth/2`）。
  多图拼贴：合成一个 slot 的 `grid`，档位由 `posterGridShape()` 给（4→2×2 / 6–9→3×3 / 10–12→3×4，
  **列在前**），超 `maxItems` 用 `posterEvenSample()` 按课次均匀精选；`cellCaption.visible` 时
  每格的**卡片高度会缩掉一条标注带**（所以「行距 = 格高 + 间距」而不是「卡片高 + 间距」）。
  `{ url: '' }` 是**占位格**（保留格子、不画图，FR-321 的班级占位格），占位格可以再带一句
  `placeholderText`（如「本期暂无作品」）：由 `paintPosterCellPlaceholder()` 居中写在白卡片里 ——
  只留格子不写字，家长看不出那是「还没交作品」还是「漏了」（US-305 真踩）。字号 = 格宽的
  `POSTER_CELL_PLACEHOLDER_FONT_RATIO`（0.12）、上限压在短边 3%、最多两行（超行走同一支
  `layoutPosterText`）；不带这个字段的调用方（单作品 / 阶段）渲染结果逐字节不变。
- **素材入参只有三种形状**，归一入口是纯函数 `posterImageEntries()` / `posterImagePlan(spec, data)`：
  `data.images` 字符串 / 数组 → 归**第一个 image 槽**；对象 → 按槽 id 取（没命中就不画）；
  `data.image` 是单张的便捷写法；`data.logo` 是机构 Logo（模板自带 `slot.url` 优先）。
  **分配必须在渲染前一次算好、不能写标记到 `data` 上**（早期写法用 `data.__imagesTaken`，
  第二次渲染同一个 `data` 对象时第一个槽就拿不到素材了 —— 纯函数 + 局部 flag 才是对的）。
  素材地址一律过 `posterImageUrl()` 这一把闸（`http(s)` / `data:image` / `blob`）。
- **二维码复用装裱那一支画笔**：`framing.js` 新导出 `paintQrMatrixBox(ctx, { matrix, box, plate, plateColor })`
  —— 白底 + 静区 + 模块取整（相邻模块不留灰缝）只有一份实现，装裱水印 / 分享二维码 / 海报共用。
  `plateColor` 缺省白（既有调用方行为一字不变），海报传 `slot.bg`。静区 = `QR_QUIET_MODULES`（overlayLayout 导出）。
  **编不出来就不画**（`qrMatrix()` 返回 null → `plan.reason = 'unencodable'`，绝不画假码）；
  变量解析后为空同样不画（`'empty-value'`，US-303 的「分享链接待生成」读这个 reason）。
  造「编不出来」的用例要用 **200 个汉字**：收敛器把 `qrcode.value` 截到 200 字，200 个 ASCII 仍编得出来。
- **设备尺寸封顶**：`posterCanvasScale()` 在超长图（report-long 4096 高）× 导出倍数 > 4096 时
  **统一缩**（宽高同倍率），只夹一边会把版式压变形；`scaleClamped` / `plan.canvas.clamped` 如实回报。
- **坏素材只让这一支消失**（解码失败 → `reason: 'decode-failed'`，整张海报照样出图）；
  跨域素材 `crossOrigin='anonymous'`，否则污染画布、`toBlob` 直接抛。解码结果有小缓存（≤24 张）。
- 回归口径（改动本模块时一起跑）：`US-089` Node **104 项** + 浏览器 **83 项**；`uss088` data 39 项；
  `assert-overlays.mjs`（US-028 规则层 87 项，含 `applyOverlayVariables` 的 `keys` 参数）；
  `/tmp/assert-us089-framing-regression.mjs` **7 项**（分享二维码老路径白底仍纯白 —— 改了 QR 画笔就跑它）。
- 本故事**没有 UI 消费点**（弹窗 / 五类版式入口在 US-302a、US-303 起），浏览器验证 = 页面里
  `await import('/src/services/poster.js')` 直接渲染 + 逐像素断言（合成作品图四边各有色带，
  专门验「不裁切」；中心色块验「不调色」）。截图 441 留档。

## 内置海报模板库与「开发自检入口」（[海报 US-302a] / FR-313 ~ FR-323）

**8 套内置模板**（`data/posterTemplates.js` 的 `seedPosterTemplates`，是按 `sortOrder` 排好的数组）：

| # | id | 名称 | kind | 版式特征 |
|---|---|---|---|---|
| 1 | `poster-warm-gold-single` | 暖金留白 · 单作品 | single | 金框 + 金线，一张作品占上部 55%（**唯一默认模板**） |
| 2 | `poster-ink-quiet-single` | 墨色留白 · 单作品 | single | 墨框 + 暖白底，标题居中如展签 |
| 3 | `poster-oak-period` | 原木素雅 · 阶段成长 | period | 自适应拼贴（4→2×2 / 6–9→3×3 / 10–12→3×4） |
| 4 | `poster-ink-nine-period` | 墨色九宫 · 阶段成长 | period | **固定 3×3** 九宫格，每格标课次日期 |
| 5 | `poster-ink-wall-class` | 墨色作品墙 · 班级集体 | class | 自适应作品墙（上限 30），格下标学员姓名 |
| 6 | `poster-gold-card-class` | 暖金名片 · 班级集体 | class | **固定 4×3 = 12 格**名片墙，暖沙底 + 金框 |
| 7 | `poster-ink-video-cover` | 深墨画框 · 成长视频封面 | video-cover | 深墨底衬暖白画框，含「成长记录」标题、`{时长}` 角标、`▶` 播放字符 |
| 8 | `poster-paper-report-long` | 暖白长卷 · 成长报告 | report-long | 1080×**3240**，头图 → 课程时间线 → 作品与点评 → 成长概览 → 码与落款 |

- **五类覆盖是硬约束**：`single / period / class` 各 2 套（主流场景），`video-cover / report-long` 各 1 套。
  `entryScope` 只有单作品是 `both`（课后反馈里只有一幅作品），其余一律 `archive` —— US-309 据此置灰入口。
- **image 占位区的 id 有约定**（自检样例与断言读它，新增模板照抄）：`artwork` / `cover` = **单图位**
  （一幅代表作）；`collage` / `wall` = **拼贴位**（走 `grid`）。
- **配色纪律**：只用品牌三色（`#CFA52E` / `#2B271F` / `#FBF8F2`）+ 同色系中性色（`POSTER_MUTED_COLORS`）。
  `posterIsBlueHex()` 是「不得用蓝做主视觉」的机器判据，内置模板的**每一个色值**都被它扫过。
- **加一套内置模板的姿势**：写一份 `builtinPosterSpec({...})`（只写有意为之的字段）→ 端点进
  `seedPosterTemplates`（`sortOrder` 必须等于数组下标 + 1，有断言）→ 跑 `/tmp/assert-us090.mjs`。
  四条几何纪律由断言兜住：几何在画布内（长画布的 `y` 可以 >1）、二维码 ≥120px 且可见数 =1、
  Logo 按 3:1 估高不越界、**占位区不重叠**（文字按墨迹宽度估，白名单只有「播放角标压在封面上」这一处有意重叠）。

### 开发自检入口（AC5）：`services/posterSelfCheck.js`

- **为什么需要它**：数据层的模板是参数，参数写错了 `pnpm run build` **照样绿** —— 只有真画一次才知道能不能出图。
- **入口挂法**：`main.jsx` 末尾在 `if(import.meta.env&&import.meta.env.DEV)` 里**动态 import** 并挂到
  `window.__xinlehuiPosterSelfCheck`（+ `__xinlehuiPosterSelfCheckText`）。出厂构建里 `import.meta.env.DEV`
  是 `false` → 整段是死代码，**自检不进 dist**（`grep dist -e 海报模板自检` 必须为空，断言查这一条）。
  新增 dev 钩子照这个写法：只读、catch 掉、别进生产包。
- **跑法**：`pnpm run dev` → 浏览器控制台 `await window.__xinlehuiPosterSelfCheck()` → 返回
  `{ ok, total, checked, failed, entries[], failures[], text }`；`entries[]` 每套一行
  （`bytes / mimeType / width / height / slots{drawn,total,skipped} / warnings`），`skipped` 直接读渲染层的
  `plan.reason`（**不在这里重算版式**）。
- **素材是现画的合成图**（`createSelfCheckArtwork` / `createSelfCheckLogo`，暖色色块 + 圆点）：
  自检要能在任何机器上跑，不能依赖「先上传一张示例作品」。**按位分数量**：单图位 1 张、拼贴位 9 张
  （固定网格按格数）—— 喂 9 张给单图位会把「单作品」模板渲染成九宫格（本轮真踩，是自检样例的错不是模板的错）。
- **永不抛错**：某套渲染炸了只让它进 `failures`，其余照跑（浏览器断言用一个 `Proxy` 化的假 spec 验这条）。
- **验证口径**：`/tmp/assert-us090.mjs`（Node，**26 项**：覆盖 / 命名 / 配色 / builtin / 几何 / 不重叠 /
  自检入口与文本 / 与收敛器兼容 / 反向注入校验器）+ `/tmp/assert-us090-browser.mjs`（CDP，**86 项**：
  真跑自检入口 8/8 出非空 Blob、逐套独立复算 Blob 类型与字节与画布、plan 逐位读数、成图墨迹、
  播放字符是实心三角而不是豆腐块、失败路径、8 套拼图截图 442）。回归：US-088 data 39 项（E6 已改成
  「与种子自身顺序比」，种子再长也不用改）、US-089 data 104 项、US-089 浏览器 83 项。

## 海报模板的云端读写与幂等初始化（[海报 US-302b] / FR-356、FR-357、FR-368）

`src/services/posterTemplatesApi.js` = 云表 `poster_templates` 的读写边界（与装裱
`framingPresetsApi.js` 同构，幂等键从 `preset_key` 换成 `template_key`），**data 层配一个本机镜像**。

- **列名单一来源 = `POSTER_TEMPLATE_ROW_FIELDS`（14 列）**：`rowToPosterTemplate` / `posterTemplateToRow`
  都从它派生，`POSTER_TEMPLATE_ROW_COLUMNS` 自动跟着变 —— 断言直接拿它核对 AC 点名的 14 列。
  新增一个库级字段时只改这一处 + `normalizePosterTemplate`，别在两边各抄一份 snake_case。
  `posterTemplateToRow` **14 列一个不少地写**（云表缺列会被 PostgREST 整条拒，那是调用方要处理的失败，
  不是「少写两列凑合」——少写会让「后台改了名字但库里没变」变得不可解释）。
- **「首次加载幂等写入内置模板」= `ensureBuiltinPosterTemplates()`（FR-356）**，三条口径别改：
  ① **只补不覆盖**：已存在的 `template_key` 一律跳过 —— 管理员改过的名字 / 停用 / 排序 / 默认标记
  都属于「已存在的那一条」，重复初始化不能把它们顶回出厂值（断言 C4 组专门钉这条）；
  ② **不抛错**：单条失败只记进 `failed`（`{id, message}`），其余照写 —— 初始化不该让页面打不开；
  ③ **不自己写镜像**：落盘只在 `loadPosterTemplateStore` 一处发生。
  写出去的行会盖 `updated_by = '系统初始化'`（`POSTER_TEMPLATE_SEED_OPERATOR`）与 ISO 的 `updated_at`。
- **读取入口是 `loadPosterTemplateStore()`，返回值带「降级事实」（FR-368，不许静默降级）**：
  `{ templates, source: 'cloud'|'builtin', cloudConnected, notice, seeded, seedFailed, remote, error }`。
  云端读不到时 `notice === POSTER_TEMPLATE_OFFLINE_NOTICE`（**原文「当前使用内置模板（云端未连通）」**，
  界面直接显示这一句，别在别处再抄）。**注意区分两种降级**：读得到但写不进去（云表欠列 /
  `DATABASE_PGRST204`）时仍是 `source: 'cloud'`、`notice: ''`，失败落在 `seedFailed` 里 ——
  把「写失败」也报成「云端未连通」是错的话术。
  两条路径都会把「正在用的那一份」落进本机镜像（观察结果一致，断网首访也有镜像）。
- **合并方向：本机镜像优先**（与装裱 / 音乐库同一处境）：云表还没建立时带新列的写入会被 PostgREST
  拒掉，本机那一份才是最新的；云端只补进本机没有的 `template_key`。`mergePosterTemplates(主, 入参)`
  的第一个参数赢、没有 id 的条目丢掉、同 key 只留一条 —— 「重复初始化不产生重复数据」在合并层就成立。
- **本机镜像键 `xinlehui-poster-templates-v1` 是裸数组**（与装裱主键同形状，外部读取方直接
  `JSON.parse` 拿列表）：`loadPosterTemplates()` / `persistPosterTemplates()` 在 `data/posterTemplates.js`，
  读到空 / 坏 JSON 回落 `seedPosterTemplates`，并且**每次都把缺失的内置模板补进来**（老镜像 + 新版本
  内置模板的场景）。这两个函数是本模块**唯一**碰 `window` 的地方（都先判 `typeof window === 'undefined'`，
  US-088 的 A2 断言已按这个新口径改判据：禁 `document./fetch(/services/`，`window` 只准以
  `typeof` 守卫 + `window.localStorage` 出现）。
- **写入：`savePosterTemplate` 先落本机镜像再推云端**，云端失败**抛出**（调用方提示「已保存到本机」）；
  **删除：内置模板在碰云端之前就拒**（FR-357，`posterTemplateDeleteIssue` + `PosterTemplateDeleteError`，
  只可停用）。「已被使用过的模板只允许停用」要数引用范围，属 US-312b。
- 本故事**没有 UI 消费点**（管理端「海报模板」页 = US-312a）。验证口径：`/tmp/assert-us091.mjs`
  （Node，**109 项**：data 纯函数 / 14 列双向映射 / 脏行不抛错 / 云端替身下的首次初始化 · 重复初始化 ·
  不覆盖管理员改动 · 云端不可达降级 · 写失败但读得到 · 保存与删除 · 本机镜像 / 静态卫生）+
  `/tmp/assert-us091-browser.mjs`（CDP，**12 项**：页面里 import 模块，**真云端**跑一次 store ——
  本机云端的 `poster_templates` 表还没建，实测落到 `source=builtin` + 原文案 +
  `Could not find the table 'public.poster_templates' in the schema cache`）。
  **已知边界**：那条「写入云端」的分支在当前环境下无法真机验证（表未建），只能靠云端替身断言；云表建好后
  跑一次 `/tmp/assert-us091-browser.mjs` 应变成 `source=cloud`。

## 单作品海报的数据装配与占位规则（[海报 US-303] / FR-310、FR-313、FR-318、FR-323）

一张海报 = **一份模板 spec**（`data/posterTemplates.js`）+ **一份数据**（这一节课 / 这一位学员的真实内容）。
US-303 补的是后半截，两个模块：

- `src/data/posterSingle.js`（data 层、零依赖纯函数、可 `node` 直跑断言）= 「数据从哪儿来、缺了怎么办」：
  - **内容只取归档数据**：成品图走 `archiveRecordMediaView(record, {surface:'teacher'})` —— 与成长档案 /
    家长分享页**同一支**「哪张图能显示」的判据，不在这里另判一次。
  - **日期与作品名取课次数据**：课次按 `resolveArchiveLesson()`（自然键 = 班级 + 日期 + 课时序号，与归档按钮
    同一支）**再补一路 `record.lessonId` 直查** —— 第二条让「老师事后改过课次日期」如实反映到海报上
    （US-038 口径）。都读不出来时**留空**，不用 `new Date()` 顶上。
  - **金句**：五维点评「美术能力」首句、≤30 字、逐字 —— 首句摘取与「停顿处截断」**复用视频字幕那一支**
    （`videoSubtitleFromReview(value,{maxChars})`），海报只换上限（30 对 24）与提示语；合规判据
    `posterSingleQuoteIssue(quote, 原文)` 三层（连续片段 / ≤30 字 / 没有原文必须为空）。
  - **缺件不编，而且结构上编不出来**：`posterSingleSpecPatch()` **换掉那一格的类型**（image → text、
    qrcode → text、logo → text），位置尺寸一字不动 —— 因为渲染层没有「空盒子」这个概念（图片解码失败
    只是不画，版式上留一块真空白）。于是「显示占位而不是空白方块」是结构保证，不是渲染时判断。
  - **导出门**（`posterSingleExportGate`）：作品缺失 → `allowed:false` + 原因就是验收原文
    「作品尚未同步完成」；**无有效分享不拦导出**（验收只要求作品缺失才拦）。有效分享的唯一真源是
    `shareTokenView({tokens, recordId})`（撤回 / 过期都不算有效）。
  - 版式读数 `posterSingleLayout(spec)`：`share` = 作品位高度 ÷ 画布高度，`ok` 判 50%–60%（「作品区占上部
    约 55%」的机器判据）。**两套内置单作品模板都按 55% 对齐**（US-303 顺手把「墨色留白」的 `h` 从 0.52
    改成 0.735、整条信息带下移）。
- `src/services/posterSingle.js` = 渲染与下载：`renderPosterSingle(plan,{scale})`（预览 1× = 1080×1440）
  与 `exportPosterSinglePng(plan)`（导出 2× = 2160×2880，先过导出门、再 `<a download>`）——
  预览与导出是**同一个 `renderPoster` 的两种分辨率**，不存在两套代码。
- 界面（课后反馈**第四步**）：`.poster-single` 块（`main.jsx` 的 `posterSingleField`）在归档后显示真实数据的
  1:1 预览 + 「导出 PNG」；预览随「重绘键」（学员 / 作品 / 金句 / 成品图 / 链接 / 两种占位）重跑，
  生成分享链接后同一块预览立刻重画（二维码从「分享链接待生成」变成真码）。
  **机构 Logo** 取装裱 v2 水印里配置的那张（`frameSpecRenderView(effectiveFrameSpec).overlays.watermark.logo.url`）；
  没配置时 Logo 位用机构名代替（不画假图，计划里如实写一句说明）。
- 素材与链接的判据都**不在界面里重复**：`data-poster-single-*` 上的读数全部来自 `buildPosterSinglePlan()`
  的产物（断言读同一份）。
- 验证口径：`/tmp/assert-us092.mjs`（Node，**106 项**：版式 55% / 金句首句与逐字 / 日期与作品名取课次 /
  作品缺失占位与拦截 / 无分享占位（含撤回 · 过期 · 别人的令牌）/ 机构名兜底 / 文件名规则 / 分层纪律）+
  `/tmp/assert-us092-browser.mjs`（CDP，**48 项**：空态 → 归档 → 真实数据预览 → **像素级**证明占位不是
  白底空方块 → 生成分享链接后码板出现 → 真下载 PNG（IHDR 2160×2880）、Python+OpenCV **解码二维码 =
  页面上的分享链接**、白底卡片占画布高度 54.9%、390px 44px）+ `/tmp/assert-us092-regression.mjs`
  （8 套内置模板自检 8/8 + 两套单作品版式渲染留档）。

## 阶段成长海报的周期口径与自适应拼贴（[海报 US-304] / FR-310、FR-313）

「这位学员在一个周期里的全部作品」拼成一张 1080×1920。两个模块，与单作品那一支同分工：

- `src/data/posterPeriod.js`（data 层纯函数，可 `node` 直跑）= 周期、拼贴、总结、缺件：
  - **周期口径不另写一套**：词表 / 窗口 / 过滤读 `data/archiveTargets.js`
    （`archivePeriodWindow` / `filterArchiveRecordsByPeriod`）——与成长档案页的周期筛选器同一支
    （「一学期」= 最近 180 天的**下界**，只有下界没有上界；读不出日期的记录留在窗口里）。
  - **阶段总结只从聚合来**：快照走 `buildArchiveReportSnapshot()`、句子走 `archiveReportDigestView()`
    （阶段报告那一支）；**海报上只留两句**（数字句 + 覆盖情况短句，短句取报告那句**冒号之前**的部分）。
    为什么必须短：总结位 `maxLines: 3`，把报告里「美术能力（51/52 节课）」那种逐维明细搬上去会被省略号吃掉
    （本轮真踩：53 节课的海报上省略了 70 个字）。聚合不出一句原文时写
    `ARCHIVE_REPORT_INSUFFICIENT_TEXT`「本阶段数据不足」——不套示例文案。
  - **拼贴只收有成品图的课次**（`archiveRecordMediaView(record,{surface:'teacher'})`，与档案 / 家长页
    同一支判据），素材是 keyed 形状 `data.images = { collage: [{url, caption}] }`，`caption` = 展签口径的
    课次日期；**超上限（默认 12）在本层按课次均匀精选**（`posterEvenSample`），渲染层因此收到「已经选好的
    那几幅」，`total/count/trimmed` 与那句验收原文「共 N 幅，已收录 M 幅」（`posterPeriodTrimNote`）都来自
    这里 —— 别再让渲染层与数据层各选一次。
  - **缺件补丁复用 `posterSingleSpecPatch`**：`imagePlaceholderText` 可换成「本阶段数据不足」
    （阶段拼贴位缺件时），二维码位「分享链接待生成」与 Logo 位机构名兜底**共用同一支**与同一批文案。
  - 网格档位由 `posterGridShape()` 决定（1–4 幅 2×2 / 5–9 幅 3×3 / 10–12 幅 3×4）；
    `POSTER_PERIOD_GRID_STEPS` 只是把验收要求的三档写下来给断言逐档比对（不另写一份网格实现）。
  - 模板选择：`findPosterPeriodTemplate()` 优先**自适应网格**那套内置模板
    （`poster-oak-period`；固定九宫格那套做不到 10–12 幅 → 3×4）。
- `src/services/posterPeriod.js` = 渲染与下载：`renderPosterPeriod`（预览 1× = 1080×1920）与
  `exportPosterPeriodPng`（导出 2× = 2160×3840，先过导出门再 `<a download>`）；下载那一支**复用**
  `services/posterSingle.js` 的 `downloadPosterSingleBlob`（同一支 `<a download>` + 延后回收）。
- 界面（课后反馈**第四步**，`.poster-period` 块）：周期下拉（半学期/一学期/一年度）+「每格下方标注课次
  日期」开关（默认开）+ 超上限时预览**上方**那行「共 N 幅，已收录 M 幅」+ 导出 PNG。
  学员取「正在看的归档记录 → 第一步选中的学员」（与 `shareQrStudent` 同口径）；二维码指向**周期内最新
  一条记录**的有效分享令牌（生成分享后同一块预览立刻重画成真码）。
- 验证口径：`/tmp/assert-us093.mjs`（Node，**109 项**：画布 1080×1920 / 三档网格逐档比对 / 均匀精选与
  首尾必取 / 总结两句与「本阶段数据不足」/ 周期窗口三档与窗口外不进拼贴 / 缺件三种占位 / 文件名 / 分层纪律）+
  `/tmp/assert-us093-browser.mjs`（CDP，**99 项**：两遍真机走查 —— ① 8 幅夹具 + 1 幅归档 = 9 幅 → 3×3
  逐格量几何（等宽等高 · 列间距=gap · 行间距=gap+标注行高 · 每列对齐）与像素（逐格作品墨迹 · 逐格日期墨迹 ·
  间隙干净）；② 14 幅 + 1 幅 = 15 幅 → 预览上方出现验收原文并只画 12 格（3×4）；另含周期切换、日期标注
  开关（关掉 → 格子变高、格下无墨迹）、导出 PNG 2160×3840 + 文件名、390px、console 干净）。

## 班级集体海报的学员格子、分批与占位格（[海报 US-305] / FR-315、FR-319、FR-321、FR-322）

「全班每个孩子一格」的作品墙（1080×1920）。与单作品 / 阶段两支同分工（`data` 定规则、`services` 落笔）：

- `src/data/posterClass.js`（data 层纯函数，可 `node` 直跑）= 格子 / 顺序 / 分批 / 缺件：
  - **格子从学员来，不是从作品来**（这是与阶段海报最大的区别）：顺序真源 = **班级名单**
    （`posterClassBaseOrder`：名单在前，名单之外但本期有记录的学员接在后面 —— 有记录的孩子一定占一格；
    没记录姓名的记录合成最后一格，展签写「未记录姓名」）。每位学员取本周期**最新一幅**成品图
    （`posterClassPicks`：只收有成品图的记录、按课次升序覆盖写入，留下的就是最新那一条；缺课记录没有
    成品图，只会让那一位走占位格）。「哪张图能显示」照旧读 `archiveRecordMediaView(record,{surface:'teacher'})`。
  - **本期无作品的学员保留占位格**（FR-321）：`posterClassCells` 给这一格 `{url:'', placeholderText:'本期暂无作品'}`，
    格子与展签（姓名）都在 —— **绝不跳过**，否则那位家长会以为漏掉了自己的孩子。
  - **超过上限（默认 30）不裁剪，改成分批**（FR-322）：`posterClassBatches` 按顺序每 30 位一批，
    `posterClassBatchNote` 给那句提示（含 `1of2` 页码说明），`posterClassBatchPlan(plan, n)` 用**同一份
    上下文**重建另一批（网格 / 占位 / 二维码 / Logo 都走同一条 compose，不会出现两种版式）。
    「已收录 M / 共 N」那种精选口径只属于阶段拼贴，别搬到班级墙上（那就等于少画一个孩子）。
  - **作品墙的网格由本层算好、显式写进 spec**（`posterClassWallGrid`：`columns = ceil(sqrt(n))`、
    `rows = ceil(n/columns)`；模板写死了行列且放得下就尊重模板）。为什么必须显式写：渲染层的自适应档位
    只覆盖到 12 格（2×2 / 3×3 / 3×4），30 位学员会**溢出画布**；写死行列后 `posterEvenSample` 也不会
    再精选掉人（`maxItems` 放到网格容量与本批人数的大者）。
  - **缺件补丁只给二维码位与 Logo 位**（复用 `posterSingleSpecPatch`，不传 `artworkMissing`）：
    作品墙**永远不过「图位缺件」那一支** —— 把它换成一句文案会把 30 个格子塌成一个。
    姓名标注开关（默认开）只拨墙那一格的 `cellCaption.visible`，坐标与样式一个字不改。
  - 文件名：`{班级名}_{周期}_班级海报.{png|jpg}`，分批时带页码 `_1of2`（`posterClassFilename`；
    空片段不拼接、非法字符走装裱导出那一支）。
- `src/services/posterClass.js` = 渲染与下载：`renderPosterClass`（预览 1× = 1080×1920）、
  `exportPosterClassPng`（导出 2× = 2160×3840，先过导出门）、`exportPosterClassBatches`（逐批重建
  plan → 渲染 → 下载，批间隔 `POSTER_CLASS_BATCH_DOWNLOAD_GAP_MS` 避开浏览器的连续下载节流，
  某一批失败只进 `failures`，不影响其它批次）。下载那一支复用 `services/posterSingle.js` 的
  `downloadPosterSingleBlob`。
- 界面（**成长档案页**的班级视图，`GrowthArchiveData.jsx` 的 `ClassPosterPanel`，仅 `view.isClass` 时渲染）：
  周期下拉 + 「每格下方标注学员姓名」开关 + 顺序编辑列表（上移 / 下移 / 恢复班级名单顺序，
  `posterClassMoveOrder` 以**当前生效顺序**为底，不是以名单为底）+ 批次选择（超上限时）+
  「导出第 N 批 PNG」与「分批导出全部 N 张」。班级 / 名单 / 记录 / 令牌都来自档案页已有的 state
  （`view.name` / `classRoster` / `records` / `shareTokens`）；机构 Logo 取**默认装裱模板**的水印图
  （`defaultFramingPreset` + `frameSpecRenderView().overlays.watermark.logo.url`），没配置就走 Logo 位兜底文案。
- 验证口径：`/tmp/assert-us094.mjs`（Node，**186 项**：网格 12 档逐一比对 / 名单顺序与调整 /
  代表作取最新一幅 / 占位格 / 32 位分 2 批与页码 / 装配读数 / 空态与导出门 / 分享与 Logo 补丁 /
  文件名 / 分层纪律 / 幂等与脏输入）+ `/tmp/assert-us094-browser.mjs`（CDP，**102 项**：真机走到
  成长档案的班级视图，6 位学员（5 幅唯一纯色 + 1 位占位）—— 画布 1080×1920、顶部班级名与周期、
  3×2 网格、**逐格取格心颜色确认作品与姓名不串格**、占位格里的「本期暂无作品」真的画出来了（像素）、
  顺序调整后绑定跟着换、姓名标注开关、导出 PNG 2160×3840 + 文件名、32 位学员分批（6×5、两批按钮、
  分批导出下载 2 张 `1of2`/`2of2`）、有效分享 → 底部换真二维码（码板深色模块占比）、390px、console 干净）。
- 已知边界：内置班级模板的版式（作品墙占上部、底部机构与二维码）沿用 US-302a 的参数，**底部留白较多**
  是模板 `y` 比例（相对短边）在 1920 高画布上的既有表现 —— 改版式属后台模板参数，不在本故事范围。

## 成长视频封面海报：画布比例与「时长角标跟视频状态联动」（[海报 US-306] / FR-316、FR-323、FR-345）

给「发到微信的那条视频链接」配一张封面（1080×1920，与成长视频输出口径同比例）。仍是
`data` 定规则 + `services` 落笔的分工：

- `src/data/posterVideoCover.js`（data 层纯函数，可 `node` 直跑）：
  - **画布与成长视频同比例是机器判据，不是口头约定**：`posterVideoCoverRatio(spec)` 同时给出画布比例、
    视频模块自己的输出口径（`VIDEO_PERSONAL_RENDER` = 1080×1920 · 9:16，来自 `data/videoPersonal.js`）
    与 `ok`。视频改口径，这条当场变红 —— 别在封面这一侧手写 1080/1920。
  - **时长只有一个来源：成片三件套**（`videoOutputView()`，与视频预览 / 下载 / 分享同一支判据）。
    成片记录优先（`findVideoRecord(videoRecords, videoRecordKey({…}))`），其次任务上挂的输出；
    还没有成片时角标写占位（`POSTER_VIDEO_COVER_DURATION_PLACEHOLDER` = 「待生成」）且
    `posterVideoCoverExportGate()` 拦下导出 —— **演示队列的 `normalizeVideoJob` 会把三件套清空**，
    所以「任务跑到 100%」也拿不到时长，这正是「尚未生成」的结构性保证（别去判断进度数字）。
  - **「出预览」与「能导出」是两件事**：`plan.renderable`（有对象 + 有主视觉）决定出不出预览，
    `plan.exportGate` 决定能不能下载。视频没成片时**预览照出**（角标就是占位），导出被拦 ——
    验收要的正是「看得见占位、但下载不了」；把预览也一起关掉就看不到占位了。
  - 四条叠加件的读数在 `posterVideoCoverOverlays()`（id 就是内置模板的占位区 id：`title` / `student` /
    `duration` / `play`），模板被后台改坏时如实点名缺哪一条。主视觉取**本周期最新一幅有成品图的作品**
    （读不出日期的记录不顶掉有空日期的；一条有日期的都没有时才按列表顺序取最后一条）。
  - 二维码指向**成片的有效分享令牌**（`activeVideoShareToken(tokens, jobKey, now)`，撤回 / 过期都不算数），
    没有就换成「分享链接待生成」的文字位（复用 `posterSingleSpecPatch`）。
- `src/services/posterVideoCover.js` = `renderPosterVideoCover`（预览 1×）/ `exportPosterVideoCoverPng`
  （导出 2×，先过导出门）；下载走共用的 `downloadPosterSingleBlob`。文件名 `{对象名}_{周期}_视频封面.png`。
- 界面（`GrowthArchiveData.jsx` 的 `VideoCoverPosterPanel`，挂在 `VideoJobsPanel` 里、贴着成片预览）：
  **周期沿用视频模块的「生成周期」**（同一个 `period` 传进来，面板里不再放第二个周期选择器 ——
  封面就是那条成片的封面，两者不许各说一套）；面板状态把「视频成没成片」算进去，没成片时头部的徽标写
  「待成片」而不是绿色的「已生成」（否则老师会以为视频已经好了）。
- 验证口径：`/tmp/assert-us095.mjs`（Node，**152 项**）+ `/tmp/assert-us095-browser.mjs`（CDP，**81 项**：
  真机链路走到成长档案 → 画布 1080×1920 与视频 9:16 同比例、预览真图 1080×1920、四条叠加件都真的有墨迹、
  画心盒子比例 == 素材原图比例（不拉伸）且落在盒子内、导出 2160×3840 + 文件名、切成没有成片记录的周期 →
  角标占位「时长 待生成」+ 导出禁用 + **预览照出**，切回去又放行）。

## 成长报告长图海报：高度自适应 · 单边上限 · 「先降 DPI、再分段出多张」（[海报 US-307] / FR-317、FR-324 ~ FR-326）

「把这位学员这个周期的内容做成一张能一路滑下去的长图」。仍是 `data` 定规则 + `services` 落笔的分工：

- `src/data/posterReportLong.js`（data 层纯函数，可 `node` 直跑）= 分段排版 / 分页 / 降级 / 文件名：
  - **画布 1080 宽、高度按内容算**：高度 = 各段内容块之和（封面头图 → 课程时间线 → 作品与点评摘要
    → 成长概览 → 二维码），**没有任何一处写死「长图多高」**。`layout.height` 是整张的高度、
    `page.height` 是这一张的高度。
  - **块（block）是排版与分页的唯一单位**：`buildReportBlocks()` 把内容排成一串原子块
    （封面 / 段标题 / 一行课次 / 一行作品 / 一条总结 / 码 / 落款），每块带 `height`（像素）、
    `gapAfter`（段内 `blockGap`、分段边界 `sectionGap`、最后一块 0）与**块内偏移的占位区**（`dy`）。
    `packReportBlocks()` 只在块边界上贪心分页 —— 因此**没有任何一段版式会被切一半**。
    页面合成（`composeReportPageSpec`）只做一件事：`y = (block.y + slot.dy) / 短边`。
    加一种行 / 加一段内容 = 加一个块，分页与估高自动跟上。
  - **段标题 keep-with-next**：标题块装不进当前页时，连同下一块一起挪到下一页（标题孤零零落在页尾
    会让老师以为漏了内容）。判据写在 packer 的 `need` 里（`block.kind === 'title'` 时把下一块的高度也算上）。
  - **单边上限只读真源**：`POSTER_REPORT_MAX_EDGE = POSTER_CANVAS_EDGE_RANGE.max`（别再写 4096）。
    降级顺序就是验收点名的那一条，`posterReportDegradeView()` 一个函数给全：
    高度 ≤ 上限 ÷ 导出倍数 → `none`（一张图 2×）；≤ 上限 → `dpi`（**先降 DPI**：导出 2× → 1×，仍是一张图）；
    > 上限 → `paged`（**再分段出多张**，每张 ≤ 4096，文件名 `…_长图_1of3.png`）。
    `degrade.exportScale` 是**数据层的决定**，`services` 只读它、不自己判一遍。
  - **预计高度与预计文件大小**：`layout.estimate` / `estimateText` 完全由数据层算出（不碰 canvas，
    所以「渲染前就有」）。体积经验值 `POSTER_REPORT_BYTES_PER_PIXEL = 0.15` 是真机量出来的
    （12 条记录的长图实测 0.149 bytes/px）；断言按量级比（实际落在预计的 0.5~1.6 倍）。
  - **文字折行估算**（data 层没有 canvas）：`posterReportLineCapacity(width, fontSize)` = `width / fontSize`
    （中文一字 ≈ 一个字号宽，保守），`posterReportFoldedLines()` 给出预留行数 → 写进占位区的 `maxLines`；
    渲染层仍会按 `maxLines` 截断，所以「估多了只是多留白，估少了会叠字」。验证口径：
    浏览器里断言 `plan.slots[].lines <= spec.maxLines` + 块之间不重叠。
  - **内容全部来自归档数据**（FR-326）：课次行读 `archiveLessonEntry()`（成长档案时间线那一支）、
    课题走 `resolveArchiveLesson()`（与单作品海报同一支两条路）、点评摘要走 `videoSubtitleFromReview()`
    （逐字截取，40 字上限）、成长概览走 `posterPeriodSummary()`（阶段报告聚合那一支，**不另写一份**）、
    有效分享走 `shareTokenView()`。数据不足时写 `ARCHIVE_REPORT_INSUFFICIENT_TEXT`（「本阶段数据不足」）。
    「课程时间线 / 作品与点评摘要 / 成长概览」这几句是**版式分段标题**（与模板里的分段标题同类），
    不是替内容写的话 —— 断言要把这条讲清楚（`E6` 一组）。
  - **有内容才出图**：没有学员 / 这个周期一条记录都没有 → `pages: []`（结构上就渲染不出一张空白海报），
    导出门同时拦下（原因点名「换一个周期 / 先完成课后反馈的归档」）。
- `src/services/posterReportLong.js` = 渲染与下载：`renderPosterReport(plan,{pageIndex})`（预览 1×）、
  `exportPosterReportPng(plan,{pageIndex})`（倍数读 `degrade.exportScale`）、`exportPosterReportPages(plan)`
  （逐张渲染下载、页码文件名、某张失败只进 `failures`；张间隔复用 `POSTER_CLASS_BATCH_DOWNLOAD_GAP_MS`）。
  下载走共用的 `downloadPosterSingleBlob`。
- 界面（`GrowthArchiveData.jsx` 的 `ReportLongPosterPanel`，**只在个人成长档案视图**；
  班级视图仍是 US-305 的班级作品墙）：周期下拉 + 降级说明 + 预计高度 / 预计文件大小 + 五个分段的读数 +
  可滚动的长条预览（`.poster-report-long-preview{max-height:420px;overflow-y:auto}` —— 长图既不压扁也不撑满整页）+
  出图张数选择器 + 「导出第 N 张 PNG」/「分段导出全部 N 张」。`data-poster-report-*` 上的读数全部来自
  `buildPosterReportLongPlan()` 的产物。空态给「去创建课后反馈」入口。
- **两处有意为之的取舍**（写下来免得被当成漏判）：
  ① **长图里不放 Logo 位**：Logo 的高度只有渲染时才知道（`maxWRatio` × 图片自身比例），
     放进自适应竖向排版会与下一段叠字 —— 机构标识由落款文字 `{机构名} · {老师姓名}` 承载；
  ② **逐行文案写进占位区的 `template` 字面量**：渲染层的变量上下文是整张图一份，逐行内容无法走变量。
     老师的作品名若**恰好**写了 `{日期}` 这类白名单变量名会被替换 —— 与「模板里的变量」同一口径，不另造转义。
  ③ 模板里那条固定 `y` 的装饰线（decor）在自适应高度下没有位置含义 → 挪到**头图下沿**（只有含封面的那一张画）。
- 验收口径：`/tmp/assert-us096.mjs`（Node，**113 项**）+ `/tmp/assert-us096-browser.mjs`（CDP，**88 项**：
  真机链路走到成长档案 → 12 条归档记录 → 一张 1080×3894 的图（五段都有墨迹、时间线/作品段各数出 12 行墨迹、
  块不重叠、0 溢出警告、二维码是真码）→ 24 条记录 → 分段 2 张（每张 ≤ 4096、`长图_1of2` / `长图_2of2`、
  分段导出下载 2 张）→ 390px 无横向溢出 → 班级视图不挂长图）。截图 465~469。
- **`pnpm run build` 抓不到「面板用到的常量没 import」**（本轮真踩：`POSTER_REPORT_DEFAULT_PERIOD` 漏 import →
  进成长档案页整页白屏、`#root` 为空、build 全绿）。判据：Node 断言里扫一遍面板代码块用到的
  `POSTER_REPORT_* / posterReport* / *PosterReport*` 标识符，逐个核对在 import 块里（`assert-us096.mjs` 的 I1）。
- **CDP 的 `send(method, params)` 第三个参数是 sessionId**：传 `null` 会落到**浏览器级**会话，
  `Emulation.setDeviceMetricsOverride` 在那里不存在（报 `-32601 was not found`），
  且如果调用点写了 `.catch(()=>{})` 就变成「390px 断言静默跑在 1440px 上」。只传两个参数（用默认页面会话）。
  390px 段先断言 `window.innerWidth === 390`，再断言没有横向溢出。

## 一键转发海报弹窗：模板清单 · 适用性 · 缩略图队列（[海报 US-308] / FR-327 ~ FR-334）

「点一键转发家长 → 打开弹窗，左侧选模板、右侧看 1:1 实时预览」。三层分工（沿「规则在 data / 落笔在
services / 界面只渲染产物」）：

- `src/data/posterDialog.js`（data 层纯函数，可 `node` 直跑）= 入口匹配 / 适用性 / 默认选中 / 空态 / 周期口径 / **五类版式分派**：
  - **`posterDialogObject()` 把「档案页选中的对象」解析成学员 / 班级**：学员对象带**班级归属与班级名单**
    （班级版式在个人档案里也能出图 —— 用这位学员的班级）；班级名优先查学员名单，查不到时退回记录自带的
    `className`。**别把 `false` 交给 `str()`**（`str(false)` = "false"，班级名会变成假的 —— 本轮真踩，Node 断言抓到的）。
  - **`posterDialogTemplateRows()` 是适用性的唯一真源**（三条，逐条给可读原因）：① 入口（`entryScope` 命中
    `archive` / `feedback` / `both`）；② 主体（**班级对象**下按学员生成的版式置灰；学员对象下班级版式仍可用）；
    ③ 数据（学员对象 + 班级版式但**没有班级归属** → 置灰，`buildPosterDialogPlan` 那边也不会拿学员名当班级名）。
    停用的模板（`enabled === false`）**不出现**（`selectablePosterTemplates` 过滤）。
  - **课后反馈入口的置灰文案就是验收原文**：`POSTER_DIALOG_ARCHIVE_ONLY_NOTE = '需在成长档案中生成'`
    （US-309 复用同一条）；逆向那条（只服务反馈的版式在档案入口置灰）也先立在这里。
  - **默认选中 = 模板库的 `isDefault` → 第一张单作品 → 第一张可用的**（`posterDialogSelectTemplate()`
    是选择守卫：换对象 / 换入口 / 模板被停用后老选择不适用就回落，别让界面停在「选不中的灰选项」上）。
  - **周期口径**：海报只能表达 `半学期 / 一学期 / 一年度`；档案页的周期筛选是 `全部（默认档）` 时
    `posterDialogPeriod()` 回落 `ARCHIVE_PERIOD_DEFAULT`，并由 `posterDialogPeriodNote()` 把这件事写在弹窗里
    （**不静默换周期**）。空态分两种口径：`none`（一条归档都没有 → 去创建课后反馈）/`period`
    （只是不在这个周期 → 提示换周期，并如实报「另有 N 条在其他周期」）。
  - **分派只有一份**：`buildPosterDialogPlan({kind, template, object, period, ...})` 按模板的 `kind` 交给
    `buildPosterSingle/Period/Class/VideoCover/ReportLongPlan`，`template` 一律透传（模板库选中的那一套）。
    单作品取「本周期**最近一条有成品图**的记录」（占位不该当主角）；反馈入口由调用方把本次课次放进
    `object.record`（`posterDialogSubjectRecord` 优先它）。
  - **`posterDialogPlanKey(plan)` 是预览 / 缩略图的重绘键**：五类版式的字段各不相同，按 `kind` 分别取
    （漏字段 = 「换了内容预览不动」，多算 = 白重绘，前者是错的、后者只是慢）。
  - **两条时间预算是常量**：`POSTER_DIALOG_FIRST_PREVIEW_BUDGET_MS = 3000` / `POSTER_DIALOG_SWITCH_BUDGET_MS = 300`；
    `posterDialogPerfChecks()` 只认**真量到的**（`Number(null)` 是 0 —— 用 `Number.isFinite(Number(x))` 判
    「还没测」会读成「0ms、达标」，本轮真踩）。缩略图 `POSTER_DIALOG_THUMB_SCALE = 0.25`（PRD 9.5）。
- `src/services/posterDialog.js` = **按 `kind` 分派到五支 `renderPosterX`**（最终都进同一个 `services/poster.js`
  的 `renderPoster`，预览 / 缩略图 / 导出只差 `scale`）—— 组件不该知道「哪一类用哪个渲染函数」，
  US-309 的另一处入口复用同一支分派就不会分叉出第二份渲染实现。
- `src/PosterDialog.jsx` = 弹窗本体（**两处入口共用**，别在组件里写「成长档案专属」的东西）：
  - **先预览、后缩略图**：打开弹窗先把选中模板的 1× 预览画出来，8 张 0.25× 缩略图排在它后面
    **逐张**画（`preview.phase === 'ready' || 'failed'` 之后才排队列）—— 一口气发 9 个渲染会把首张拖慢。
  - 预览区**高度固定 + 加载态**：`pending` 时显示「正在生成第一张预览… / 正在换模板…」，
    不闪白也不跳高度；换模板的耗时从**点击那一刻**记账（`perfRef.requestAt`），周期变化不算「换模板」。
  - 预览默认**整张放进框里**（max-width + max-height 等比缩小）；长图（`data-poster-dialog-selected-kind="report-long"`）
    是唯一例外：按宽度铺满 + 框内滚动（与成长报告长图面板同一口径）。≤800px 模板列表变横向滑动条。
  - 缩略图 object URL 在换模板与关闭弹窗时都要 `releasePosterDialogUrl` 回收（`thumbsRef` 记全部地址）。
- 档案页（`GrowthArchiveData.jsx`）只做三件事：`posterDialogOpen` 开合、把**当前对象 + 当前周期筛选 +
  已归档记录**传进去、以及把对象 prop `useMemo` 住（弹窗每收到新对象都会重建 8 份 plan，别让时间线
  缩略图回填这类普通重渲染白算）。「一键转发家长」不再是 `setToast(...)`。
- 验收口径：`/tmp/assert-us097.mjs`（Node，**94 项**：常量真源 / 对象解析 / 记录窗口 / 适用性 / 守卫 /
  空态 / 周期 / 8 份 plan 的真实数据 / 重绘键 / 性能读数三种口径 / **源码级分层纪律**）+ 
  `/tmp/assert-us097-browser.mjs`（CDP，**106 项**：真机链路走到成长档案 → 打开弹窗（首张预览面板 73ms、
  脚本计时 193ms，均 ≤3s）→ 8 张缩略图全部就绪（270×360 / 270×480）→ **切换 8 套模板每套都出真图**
  （画布 / 模板 id / 墨迹 0.067~0.98、39~59 个色块 / 独立重算同源）→ 换模板重绘 23~100ms（≤300ms）→
  周期跟随与回落说明 → 班级对象下 6 套置灰 → 390px 无横向溢出且可点区域 ≥44px → 空态与「去创建课后反馈」
  → 同页别的海报面板不受影响 → console 干净）。截图 470~476。
- **「去创建课后反馈」会让页面离开成长档案，而刷新后回不到档案页**（老师侧到档案的唯一入口是四步流程，
  导航状态在内存里）—— 浏览器脚本里这类「离开当前页」的用例要排在最后，别在中途 `Page.reload` 之后
  再指望能回到档案页。

### 两处入口复用同一个弹窗（[海报 US-309] / FR-327、FR-331、FR-333）

课后反馈第四步的「转发给家长」打开的**就是上面这个组件**（`main.jsx` 的 `archivePosterDialogField`），
`GrowthArchiveData.jsx` 的档案入口一个字没变。两处只差两个入参，其余全走同一份规则与同一支渲染：

- `entry={POSTER_DIALOG_ENTRY_FEEDBACK}` → `posterDialogTemplateRows()` 把六套按周期 / 多幅作品生成的
  版式（阶段 2 / 班级 2 / 封面 1 / 长图 1）置灰，原因就是验收原文「需在成长档案中生成」；两套单作品
  仍在，默认选中 `poster-warm-gold-single`（FR-313 的单作品默认口径，模板库的 `isDefault` 也是它）。
- 对象里带**本次课次的归档记录**（`{target:'个人', name, record: currentArchiveRecord, students}`）→
  `posterDialogSubjectRecord()` 命中 `object.record` 分支（`source: 'lesson'`），单作品海报的内容
  （学员 / 作品名 / 课次日期 / 美术能力金句）全部来自这条记录，**不会退回「本周期最新一条」**。
  `records / lessons / tokens / teacherName / orgName / logo / origin` 也传第四步那一份（与档案页同源）。
- **没有本次课次的归档记录时不开弹窗**（`openArchiveForwardPoster()`）：那一刻弹窗只能画「本周期最新
  一条」，数据来源就错了 —— 打开分享面板把「先归档」说清楚（US-204 的既有口径）。
- **分享面板（分享链接 / 二维码 / 微信文案 / 转发状态）另起入口**：`data-archive-share-toggle` 挂在转发
  状态条旁边的 `.archive-share-toggle` 文字链接上。第四步的主操作行仍是**三项**
  （返回修改点评 / 转发给家长 / 进入成长档案，US-204 的口径，老断言按 `.scene-actions button` 逐字比）。
- 弹窗新增两处只读读数：`data-poster-dialog-archive-only` / `-archive-only-note`（几套因入口置灰、原因
  原文是什么）与 `data-poster-dialog-record`（用的是哪一条记录）。反馈入口的周期说明由
  `posterDialogPeriodNote(value, entry)` 给出**空串**（那边没有「档案页筛选」可跟随）；
  `posterDialogEmptyView()` 在对象自带记录时直接返回非空态（补录一节很老的课次会落在默认周期窗口之外，
  按周期判会把一张有内容的图误判成空态）。
- 验收口径：`/tmp/assert-us098.mjs`（Node，**48 项**：反馈入口适用性 / 本次课次的数据来源 / 两处入口
  同一份 plan 与同一个重绘键 / 空态与周期口径 / **全仓只有一份渲染实现**（引擎定义、五支渲染函数的
  import、弹窗组件、导出文件名规则各一份）/ 源码接线）+ `/tmp/assert-us098-browser.mjs`（CDP，**53 项**：
  真机链路到第四步 → 点转发 → 弹窗 entry=feedback / 8 套里 2 套可用 6 套置灰 / 默认单作品 / 预览
  1080×1440 有墨 → **内联单作品海报与弹窗 1:1 预览逐字节相同** → 生成分享后二维码也同源 → 真导出一次
  （文件名规则 + 2× 2160×2880）→ 390px → **同一学员在两处入口的预览与 2× 渲染逐字节相同** → console 干净）。
  截图 479~483。
- 第四步的旧海报面板（`.poster-single` / `.poster-period`，US-303 / US-304）仍在原地：它们的验收面
  （导出 PNG、拼贴网格读数）还在用，且两条都走同一个 `renderPoster`（不构成第二套实现）。US-311a
  把导出搬进弹窗之后再考虑收敛它们。

### 海报的「文案与作品微调」（[海报 US-310a] / FR-335 ~ FR-339）

弹窗里贴着预览的那一块（`PosterDialog.jsx` 的 `[data-poster-tuning]`），规则全在零依赖的
`src/data/posterTuning.js`（可 `node` 直跑断言），渲染仍然走同一个 `renderPoster`。

- **可编辑项只有五项**：`POSTER_TUNING_FIELDS = title / quote / date / qrcode / artworks`
  （标题 / 金句·寄语 / 日期 / 是否显示二维码 / 收录哪些作品）。**不可编辑项是结构保证，不是界面约定**：
  `applyPosterTuning()` 只读这五个键，其它键一律进 `tuning.locked`（坐标 / 尺寸 / 字体 / 配色那一族，
  `POSTER_TUNING_LOCKED_KEYS`）或 `tuning.ignored`（陌生人键），**一个字节都不落进 spec**。
  断言口径：往入参里塞 `{x, font, color, spec}` → 逐槽 diff 只找到 `title.template` 一处变化，
  且「只改标题」与「改标题 + 塞版式键」两张图**逐字节相同**。
- **唯一会写进 spec 的字段是 `template` 与 `visible`**（`POSTER_TUNING_WRITTEN_FIELDS`）：
  标题换的是文字位的 `template`（内容），二维码开关换的是二维码位的 `visible`（显隐）——
  坐标 / 字体 / 配色 / 尺寸一个都不动。写进 `data` 的那几项（`quote` / `date` / 素材清单）属「画什么」。
- **一项可改的前提是这套版式里有承载它的位**（`posterTuningTargets()`，界面照它禁用并写原因）：
  标题位 = `id === 'title'` 的文字位（八套都有）；金句位 = `id === 'quote'`（只有单作品两套有，
  长图给的是 FR-326 的原因「内容全部来自归档数据」）；日期位 = 模板串里用到 `{日期}` 的文字位
  （单作品两套 + 暖金名片那套班级版）；二维码位 = `type === 'qrcode'` 或 `qr` / `qrPending` 占位位；
  **收录作品只在阶段 / 班级海报上可选**（`POSTER_TUNING_ARTWORK_KINDS`，PRD 原文的括注）。
- **收录清单的 id 是位置**（阶段 `work-1..N` = 拼贴每一幅、班级 `student-1..N` = 名单每一位），
  `signature` 交给界面：换模板 / 换周期 / 换对象后清单变了，界面清掉老勾选（数据层也会忽略越界 id）。
  「全选」与「留空」都等于**不覆盖**（重绘键里不出现那一段，勾掉再勾回来不会留一个假的覆盖值）；
  勾到一幅不剩时回落全收 + 界面把「取消最后一幅」的勾选框禁掉（`POSTER_TUNING_ARTWORKS_MIN_NOTE`）。
- **幂等**：`applyPosterTuning()` 把未收窄的那一份清单记在 `plan.tuning.artworkBaseEntries` 上，
  再打一次同一份微调时从它出发 —— 否则第二遍会把「已经收窄的清单」再收窄一次（本轮先踩后修）。
- **「改完即生效」不用第二个 effect**：`posterDialogPlanKey()` 的**公共段**里加了
  `str(value.tuning && value.tuning.key)`，所以「打字 → 重绘键变 → 预览 effect 重画」对五类版式都成立；
  界面里没有「应用」按钮（断言直接查面板与按钮文案）。**缩略图仍画模板本身**（不打微调）：
  老师打字时不必把 8 张 0.25× 小图重画一遍 —— 微调只作用于这一张要发的海报（预览 + 将来的导出）。
- 面板上的读数都带 `data-poster-tuning-*`：`kind / active / key / applied`（改了哪几项）、
  `available`（这套版式能改哪几项）、`locked` / `ignored`、逐项的
  `data-poster-tuning-field(-available/-value/-default/-note)`、收录清单的 `-artworks-total/-selected`
  与每一项的 `-artwork-checked`（脚本不自己数勾选框）。
- 手机端（≤800px）：面板单栏、输入框与勾选行 44px、两个文字入口（恢复默认文案 / 全选）**44×44**
  —— 只给 `min-height` 会让「全选」变成一个 20×44 的细条（本轮被断言抓到）。
- 验收口径：`/tmp/assert-us099.mjs`（Node，**90 项**：五项真源 / 五类版式的承载位 / 归一与重绘键 /
  结构守卫逐槽 diff / 落笔效果（含长图逐页）/ 不变量 / 分层纪律与源码接线）+ 
  `/tmp/assert-us099-browser.mjs`（CDP，**64 项**：真机链路到第四步 → 生成分享（二维码位要有真码）→
  弹窗里逐项改标题 / 金句 / 日期 / 二维码，每次都「预览字节变化 + 与独立重算逐字节相同」→
  「恢复默认文案」回到最初那一张（逐字节）→ 档案入口的阶段海报 3 幅收 2 幅（网格与素材同步）→
  二维码那一格的暗像素从「有」到「0」→ 390px 无溢出且控件 ≥44px → console 干净）。截图 484~490。

### 我的海报模板：另存 / 重命名 / 删除（[海报 US-310b] / FR-353、FR-354）

老师把弹窗里这张图调好之后存成**自己的模板**，下次进来自动排在最前面。三块规则都在
`src/data/posterTemplates.js`（记录层，与装裱 `data/framingPresets.js` 同一套三层语义），
界面只有 `PosterDialog.jsx` 左栏的 `[data-poster-mine]` 那一块。

- **三层归属逐条对齐装裱**（PRD 9.2 第 7 条：不发明第二套权限模型）：
  `posterTemplateVisibleTo()`（平台全员 / 机构限本机构 / **teacher 只有本人**；缺 ownerKey 一律不可见，
  fail-safe）与 `posterTemplateEditableBy()`（**看得见 ≠ 改得动**：老师只改得动自己的个人模板，
  平台与机构模板连编辑入口都不渲染）。身份串复用装裱的 `teacherIdentityKeys`（id 与姓名都收）。
- **`posterDialogTemplateRows({ …, viewer })` 是可见性的唯一入口**：先
  `filterPosterTemplatesForViewer` 再排序 —— 老师的个人模板排最前（`sortPosterTemplatesForViewer`，
  AC2「在列表上方优先展示」），其余仍按库顺序（**别去改 `sortPosterTemplates`**：那是全仓的库顺序真源，
  管理端要的是三层按排序号混排）。**不传 viewer 时按 fail-safe**（`viewer = {}`：平台模板可见，
  缺 ownerKey 的 org / teacher 模板不可见）。两处入口（成长档案 / 课后反馈第四步）都通过 `teacherName`
  （+ 可选 `teacherId` / `orgId`，缺省 `DEFAULT_ORG_ID`）构造 viewer。
- **另存的是「老师此刻看到的那一张」**（`posterPresetSpecFromPlan(plan)`，在 `data/posterTuning.js`）：
  - 底稿取 **`plan.baseSpec`**（模板自己的 spec）而不是 `plan.spec` —— 后者带着这一次的数据占位
    （「作品尚未同步完成」「分享链接待生成」、班级墙按人数算的网格），存进模板下一张图就永远是那一版。
  - **进模板的三项**（`POSTER_PRESET_SAVED_FIELDS`）：标题 / 金句 / 二维码显隐。标题与二维码显隐
    微调已经写在 spec 里；金句写在 `data.quote` 里，所以落成**字面量**（`{点评金句}` → 老师写的那一句）。
    写入白名单仍是 `template` / `visible`（US-310a 的 `POSTER_TUNING_WRITTEN_FIELDS`），坐标 / 字体 /
    配色逐槽不变（断言用逐槽 diff 证明）。
  - **不进模板的两项**：`date` —— **日期永远取课次日期**（US-038 的口径：模板只承载日期的格式与位置，
    不承载具体日期值；另存后换一堂课就是那节课的日期）；`artworks` —— 那是「这一次收哪几幅」的数据。
    回执文案由 `posterPresetSaveNote()` 唯一产出（含「不含「日期」…与「收录哪些作品」…」）。
- **保存 / 改名 / 删除都先落本机镜像 + 更新界面，再推云端**：`mirrorPosterTemplateLocally(preset)` →
  `setLibrary(loadPosterTemplates())` → `await saveRemotePosterTemplate(preset)`（失败只补一句
  「云端暂未连通，已保存到本机」）。服务层的 `savePosterTemplate` 把前两步合在一起，弹窗不用它是因为
  **不能等云端**（`poster_templates` 云表还没建立，等下去界面就不动了）。弹窗自己持有模板库
  （`useState(() => loadPosterTemplates())`），保存后直接用镜像重读 —— 「退出重进」看到的就是刚存下的。
- **模板自带的字面量会改变面板读数的口径**（US-310b 起）：`posterTuningDefaults()` 的标题与金句都取
  **画在那一格上的字**（`posterTuningSlotText()` 按变量表解出），否则占位提示会指着一个画不出来的值；
  二维码位在「模板自己把它关掉了」时**置灰并写原因**（`POSTER_TUNING_QRCODE_TEMPLATE_OFF`：覆盖只写
  `visible:false`，勾上也不会画出来）——别给一个「改了没反应」的勾选框，这是本仓的既有纪律。
- 验收口径：`/tmp/assert-us100.mjs`（Node，**74 项**：可见性 / 可编辑性 / 记录形状 / 置顶排序 /
  可保存 spec 的逐槽口径与重放一致 / 重命名删除 / 结构守卫与源码接线）+
  `/tmp/assert-us100-browser.mjs`（CDP，**63 项**：真机走到第四步 → 改标题 / 金句 / 关二维码 → 另存 →
  **保存前后预览逐字节相同** → 徽标与「我的优先」→ 空名 / 重名被拒 → 改名三处同步 → 关弹窗重进 →
  **刷新 + 重新登录 + 重新走到第四步**（镜像仍在那份 spec 一个字节没变）→ 390px → 删除后回落默认模板 →
  console 干净）。截图 491~497。

### 海报导出：PNG / JPG 与导出前三项校验（[海报 US-311a] / FR-341 ~ FR-343、FR-348）

弹窗里贴着预览的那一块（`PosterDialog.jsx` 的 `[data-poster-export]`）：老师**就地**把这张图存成文件。
规则全在零依赖的 `src/data/posterExport.js`（可 `node` 直跑断言），编排在 `src/services/posterExport.js`，
渲染仍然走同一个 `renderPoster`（预览 1× / 缩略图 0.25× / 导出 2×，只是倍数与编码档不同，FR-312）。

- **两档格式只有一份真源**：`POSTER_EXPORT_FORMATS = [{ png, quality: null }, { jpg, quality: 0.9 }]`
  ——`mimeType` / `extension` / `actionLabel` / `summary` 全在这一张表里。编码的两个 mime 常量
  （`POSTER_MIME_PNG` / `POSTER_MIME_JPEG`）**定义在数据层**，`services/poster.js` 只
  `export { … } from '../data/posterExport'`（既有调用方一字不改）——引擎里因此不再有 `'image/jpeg'`
  字面量，断言查的就是这一条（`src/(data|services)/poster*.js` 里只有数据层那一个）。
- **导出与预览是同一支分派**：`services/posterDialog.js` 里 `renderPosterDialog()`（预览 / 缩略图）与
  `renderPosterDialogExport()`（导出档：倍数按 `posterDialogExportScale()`、编码档按格式表）都交给
  **同样五支** `renderPosterX(plan, { scale, type, quality })` —— 五个渲染函数从 US-101 起转发
  `type` / `quality`（缺省 PNG）。`posterReportPageScale()` 给长图的逐页倍数（降级后 1×）。
- **三项校验读的是「真渲染一次的产物」**（FR-343）：`posterExportChecks({ rendered, gate })` 只看
  渲染结果（`rendered.plan.slots` / `rendered.spec` / `rendered.scale`）与导出门，返回
  `{ ok, rows, blocked }` —— 面板逐行渲染 `rows`、服务层照 `blocked` 决定「下不下载」。三个判据：
  ① 素材缺失 = **给了地址却没画出来**（`url:''` 的有意占位格不算，那是有意留的；**逐格判**，
  不看整格的 `drawn`）；② 二维码边长（画布短边口径的像素）≥ `POSTER_QR_MIN_PIXELS`（与将来的
  管理端校验同一份常量，`PosterDialog` 与断言都读它）；③ 文字没有 `truncated`。
  三项都是 `POSTER_EXPORT_CHECK_POLICY = block`：**校验没过就一个字节都不下载**，原因用数据层整句。
- **校验没有第二次判据**：面板上的三行读数就是预览那一次渲染算出来的（`preview.checks`），
  导出时在**导出倍数**下再跑同一个函数复核。同一份逻辑布局在 1× / 2× 下判据一致，因此不会出现
  「面板说没事、导出才拦」。
- **命名按 kind 分派**：`posterExportFilename(plan, { format, pageIndex })` 调各版式自己的
  `posterXFilename(...)`（非法字符与空格走 `sanitizeArtworkExportSegment` 那一支，页码走
  `posterClassFilename` / `posterReportFilename` 的 `1of2`）。**不要**直接用 `plan.batch.filename` /
  `page.filename` —— 那两份是数据层按 PNG 算好的，导 JPG 时会留着 `.png`。
- **导出几张由 `posterExportPages(plan)` 说**：班级 `batch.total`、长图 `pages.length`、其余 1 张；
  多张逐张「渲染 → 校验 → 交付」，中间留 `POSTER_CLASS_BATCH_DOWNLOAD_GAP_MS`（复用班级分批那一支），
  某一张没过只进 `skipped`（`blocked` 与 `renderFailed` 分开记），已交付的不回滚。
- **交付路径两条，判据在数据层**：`posterExportSaveStrategy({ userAgent, canShareFiles })` ——
  `mode`（`download` / `longpress`）复用装裱导出的 UA 判据（iOS 全系与微信内置浏览器不执行 blob
  下载），`canShare` 由调用方把 `navigator.canShare({ files })` 的真结果传进来（`services/posterExport.js`
  的 `canSharePosterFiles()`）。`longpress` 那一档**一张都不下载**，把 blob 交给界面显示
  （`[data-poster-export-longpress-image]`）+ 一句长按提示；能 `navigator.share` 时多一个「直接分享」
  （`sharePosterFiles()`，把导出的 `File` 原样交给系统分享面板）。
- 验收口径：`/tmp/assert-us101.mjs`（Node，**96 项**：两档格式与 mime 同源 / 五类版式的命名与页码 /
  三项校验的分支（含「有意占位不算缺失」「一格坏也要报」「阈值差 1px 就红」）/ 导出张数 /
  交付路径（微信·iOS·桌面）/ 回执文案 / 源码接线）+ `/tmp/assert-us101-browser.mjs`（CDP，**75 项**：
  真机走到第四步 → 面板读数 → **真导出 PNG 与 JPG 并落盘**（魔数 / 文件头尺寸 2160×2880 / 读回来解码
  有墨 / 两张 48px 缩略图逐像素比 = 同一张画面）→ 现场抓 `toBlob` 的 `(type, quality)`（PNG 无质量、
  JPG 0.9）→ 超长标题 → **不下载** + 回执点名文字位 → 改短后同一张图导出成功 → 成长档案阶段海报
  带一幅坏素材 → 不下载（预览照出）→ 微信 / iOS UA → 长按保存（不下载、出图、真分享参数）→ 390px →
  console 干净）。截图 498~505。

### 海报的微信文案与转发状态（[海报 US-311b] / FR-344 ~ FR-347）

弹窗里「导出图片」上面那一块（`PosterDialog.jsx` 的 `[data-poster-forward]`）：老师复制一段**发给家长的
微信文案**，并看到「这张海报发过没有」。规则全在零依赖的 `src/data/posterForward.js`（可 `node` 直跑断言）：

- **文案本体只有一份**：`posterWechatCopyText(names)`（五类版式各一句，含**学员名**与**作品名**；
  多作品版式写收录幅数 —— 没有单一作品名可写，与 US-101 文件名「作品名或周期」同一条口径）。
  文案由 `posterForwardNames(plan)` 先解析出「谁 + 哪件作品」：`subject`（学员名 / 班级名）、
  `artwork`（只有单作品与视频封面这两支有）、`artworkCount`、`artworkRequired`（单作品 / 封面必须含作品名）、
  `recordId`（**转发状态与留痕都按它查**）。四类版式的记录 id 放在 plan 的**三个不同位置**
  （阶段 / 长图 `shareRecordId`、班级 `share.recordId`、封面 `artwork.recordId`、单作品 `plan.recordId`）——
  只有 `posterForwardNames` 知道这件事，界面与断言读它这一个出口。
- **「不含任何联系方式」复用归档模块那一份禁词表**：`posterWechatChecks()` 调
  `data/archiveShare.js` 的 `archiveWechatContactIssues()`（手机号 / 座机 / 邮箱 / 微信 QQ / 链接），
  不在这里另写一套正则。复核三行由 `posterWechatCheckRows()` 产出（界面逐行渲染，不自己数哪一行红）；
  `required: false` 的那一行（多作品版式的「收录范围」）是**如实读数**，不是失败。
- **转发状态与归档模块同一支**：`posterForwardView({ plan, tokens })` = `posterForwardNames()` +
  **`data/shareForward.js` 的 `shareForwardView()`**（未转发 / 已转发 / 已撤回三态由令牌账推导：
  撤回优先 > `sentAt` > 未转发）。界面因此不可能出现「档案里显示已转发、弹窗里显示未转发」；
  AC2 的机器判据就是「同一份 tokens 下两支视图逐字段相同」。
- **复制成功 = 一次转发**（与 US-209 同一条口径）：`recordShareForwardSend()`（`services/shareForwardSend.js`，
  **全仓只有这一份**「并镜像 → `applyShareSend` → 推云端」的编排，第四步的 `recordForwardSend` 也调它）
  把 `sentAt` / 渠道（`wechat`）/ 第几次写在那条令牌上，状态随之推导成「已转发」。
  **令牌不在时文案照给，但如实说「没有记成已转发」**（`posterForwardSendNote` 两个分支）——
  不谎报；复制失败则一个字都不动。
- **两条留痕（AC3）**：`AUDIT_ACTIONS.posterExport` / `.posterForward`（`POSTER_AUDIT_ACTIONS`），
  必填 `actorId / at / objectName`（班级 / 长图覆盖多条记录，`recordId` 只作可选读数）。
  界面把条目里最近一条渲染成回执（`[data-poster-forward-audit*]` / `[data-poster-export-audit*]`），
  缺项由 `auditEntryMissingFields` 点名；**只有动作真的发生了才写**（导出被校验拦下 / 复制失败都不写）。
  两个动作键**没有**并进 `ARCHIVE_AUDIT_ACTIONS`（那是 US-211 面板与断言逐条读的九个归档动作）。
- 验收口径：`/tmp/assert-us102.mjs`（Node，**121 项**）+ `/tmp/assert-us102-browser.mjs`（CDP，**76 项**：
  真机归档 → 弹窗读文案 → **剪贴板逐字符等于面板那一份** → 无链接时复制「不谎报」→ 生成链接后复制
  → 状态变「已转发」且与第四步状态条 / 状态块同步 → 撤回后「已撤回」（撤回优先）→ 真导出落盘
  + 两条留痕 → 390px）。截图 506~510。

## 管理端「海报模板」：三栏（列表 · 参数面板 · 实时预览）（[海报 US-312a] / FR-355 ~ FR-359）

没有设计交付也能做出一套版式：左边选模板、中间改参数、右边用**与老师端出图同一支渲染**当场看结果。
入口在管理端侧边栏「海报模板」（`posterTemplates`：三处同名 —— `navByRole.admin` / `ADMIN_ONLY_PAGES` /
`PageRouter` 的 map，加页时三处一起改，漏一处就是「点进去是空白页」或「老师端也进得去」）。

- **`src/data/posterAdmin.js`（新，零依赖纯函数）**是这一页的全部规则，四块：
  - **库列表**：`posterAdminLibraryGroups(templates, viewer)` 按三层分组（系统 / 机构 / 老师个人，空组不出现），
    组上的 `writable` 与行上的 `writable` 都来自 `posterAdminTemplateWriteIssue()` —— 它**就是**装裱那一支
    （`data/framingPermissions.js` 的 `framingPresetWriteIssue`，PRD 9.2 第 7 条：不发明第二套权限模型）。
    本会话是**平台管理员**（`{role:'admin', adminTier:'platform'}`），所以平台层可写、机构层与老师个人层
    **可见但只读**（列表要读全量）。`posterAdminRowView()` 是行读数的唯一出口（徽标 / 画布 / 占位区数）。
  - **参数面板**：`POSTER_ADMIN_SECTION_FIELDS`（画布 / 背景 / 边框 / 装饰线）+ `POSTER_ADMIN_SLOT_FIELDS`
    （公共 + 四类占位区）是**控件描述表**（`{path,label,control,min,max,step,hint,options}`，五种控件：
    number / color / text / select / check）。界面按它渲染、把改动交给 `posterAdminSetPath()` 写草稿 ——
    页面里**没有一个写死的 spec 路径**，所以「面板覆盖了哪些参数」是可数的：
    `posterAdminPanelCoverage()` / `posterAdminPanelMissingFields()`（对 8 套内置模板逐套缺口为 0，
    断言与面板上的覆盖读数读同一份）。故意不覆盖的只有 `version` 与 `background.image`（第二期预留），
    以及 `slots.N.id`（占位区的**身份键**：渲染层按它取素材 `data.images[slot.id]`，改名等于换版式）。
  - **写入**：`posterAdminInputValue()` 的数字只认「原样能往返」的串（`String(Number(raw))===raw`），
    其余保留原文本 —— 于是 `0.` / `-` 这种打到一半的值不会被吞（「想打 0.5 结果变成 5」）；
    收敛只发生在渲染与保存时（`normalizePosterSpec`），**草稿不做收敛**。
    `posterAdminKindPatch()` 同时改模板记录的 `kind` 与 `spec.kind`（两处必须一致）；
    `posterAdminSlotTypePatch()` 换占位区类型时保留 id / 位置 / 显隐，尺寸回到该类型默认值
    （不把 `text` 的字号比例塞进 `qrcode` 的边长比例）。
  - **新增 / 复制**：`posterAdminNewTemplate()` / `posterAdminCopyTemplate()` —— 新 id 一律随机
    （`template_key` 是云端 upsert 冲突键，不能由名字派生）、名字自动去重（`posterAdminUniqueName`）、
    排序取列表最后 +1、**一律 `enabled:false` 的草稿态**（参数没确认就漏到老师端是最容易犯的错；
    验收原文也是「新增一套模板**并启用**」）。复制出来的副本落在**平台层**（本会话唯一写得动的那一层），
    `spec` 逐字段照抄（断言用 `normalizePosterSpec` 深比）。
  - **保存前读数**：`posterAdminSaveFacts()` 只把「空名 / 重名 / 缺 id」当阻塞，越界参数与未知变量
    是**如实读数**（与装裱面板同一口径：收敛不改阻塞）。
- **`src/services/posterAdminPreview.js`（新）**：合成样例素材（画布 + 斜带 + 圆点 + 序号角标，**夹具**，
  不依赖外部图片）+ 把 `posterAdminPreviewPlan()` 造的 plan 交给 `services/posterDialog.js` 的
  `renderPosterDialog()` —— 老师端弹窗预览 / 缩略图 / 导出用的**同一支分派**（FR-312），
  这一层既不画海报也不建画布以外的东西。倍数 re-export `POSTER_DIALOG_PREVIEW_SCALE`（预览 1×）。
  - 预览 plan 按**模板记录的 `kind`** 分派（老师端弹窗也是按 `template.kind` 装配的），五类版式的门字段
    （`hasRecord` / `hasStudent` / `hasClass` / `hasObject` / `pages`）都要给全；
    样例数据是 15 个变量全有值的夹具（`POSTER_ADMIN_PREVIEW_DATA`），素材按占位区 **id** 分组：
    单图位（`artwork` / `cover`）1 幅、写死行列按乘积、自适应按 `maxItems` 且**封顶 9**
    （约定与开发自检那一份一致，断言逐条比两份常量）。
  - 改一个参数就重画（`posterAdminPreviewKey(spec, kind)` 是重绘键，节流 `POSTER_ADMIN_PREVIEW_THROTTLE_MS`）。
- **`src/admin/PosterTemplatesPage.jsx`（新）**：三栏（`.poster-admin` 的 grid；≤1180px 两栏、≤800px 单列）。
  四条纪律：① 不在平台层的模板整页只读（控件 disabled + 保存不可点 + 说明「由谁维护」，
  服务层 403 是第二道）；② 草稿不收敛；③ 预览节流；④ 新增 / 复制先停用。
- **镜像的写权归这一页**：`loadPosterTemplateStore({ persist: false })` + `touchedRef` ——
  云端读回晚于用户操作时**放弃回灌**（合并方向仍是本机优先）。老师端弹窗读的是同一份本机镜像
  （`data/posterTemplates.js` 的 `loadPosterTemplates()`，同步），所以「后台存下 → 老师端重开弹窗看到」
  是同一条路；反过来让服务层 persist 就会在「刚新增还没保存」时被一份更早读到的旧列表顶掉。
- 验收口径：`/tmp/assert-us103.mjs`（Node，**145 项**：分组与写权限 / 描述表覆盖与缺口 / 深写与输入值 /
  五类版式的预览 plan 与素材分配 / 新增与复制的记录形状 / 保存前读数 / 源码接线 / 与老师端可见性口径一致）
  + `/tmp/assert-us103-browser.mjs`（CDP，**77 项**：侧边栏进页 → 三层分组与机构 / 老师只读（120 个控件逐个 disabled）→
  面板覆盖验收点名的每一类参数 → 改参数后**面板那一张图逐字节等于页面内 `renderPosterDialog()` 重算的那一张**
  （同一支分派）/ 换类型 + 用该类型默认画布 + 换占位区类型 → 新增（空名被拦）与复制副本（spec 逐字段相同）→
  启用保存 → 切老师端走一遍真机归档 → 弹窗里选到新模板 + **像素判据**（背景角点 = 管理端刚设的自定义色）→
  停用后老师端不再出现 → 390px 单列 ≥44px → console 0 error）。截图 511~515。

## 管理端海报模板：启停 / 排序 / 默认 / 适用范围 / 保存前校验 / 引用范围与留痕（[海报 US-312b] / FR-350、FR-353 ~ FR-359）

同一页（`src/admin/PosterTemplatesPage.jsx`）的第二批能力：让模板**能上线、能下线、能排顺序、能被校验**。
`src/data/posterAdmin.js` 仍是全部规则的唯一出处；`src/services/posterTemplatesApi.js` 多了一支批写入。

- **库级动作（AC1）**都在 data 层，且**全部过 `stampPosterTemplateUpdate()`**（`data/posterTemplates.js`）：
  `posterAdminSetEnabled()`（启用 / 停用，状态没变就一个字段都不动）、
  `posterAdminMoveTemplate(list, id, delta, { by, at, viewer })`（**只在同一层 scope 内**换位，按位次重排
  `(位置+1)×10`，只有被挪动的那一套进变更历史）、`posterAdminApplyDefault(list, id, { by, at, viewer })`
  （**全局唯一默认**：设为默认时把别人的标记一并清掉，传空 id = 取消默认；老师端
  `posterDialogDefaultTemplateId()` 取的就是列表里第一套 `isDefault`，所以「设成默认」在老师端**立刻**生效）。
  页面上的入口有两处：列表行上的 ↑ / ↓ / 启停（`data-poster-admin-row-up|down|toggle`）与面板上的
  「上移 / 下移 / 设为默认模板 / 删除模板」（`data-poster-admin-library-actions`）。
- **适用范围（AC2）= 两个字段 + 一句读数**：`kind`（海报类型）与 `entryScope`（成长档案 / 课后反馈 / 两处），
  读数由 `posterAdminScopeView()` 给出（`data-poster-admin-scope-*`）。真正的过滤在老师端那支既有判据里
  （`posterDialogTemplateRows`：入口命中 + 主体匹配 + 数据齐），**这一页不另写一套适用性规则**。
- **保存前三项校验（AC3）= `posterAdminPreSaveChecks(template, { data })`**，一次给出三行读数与处置：

  | 行 | 怎么算（都在 data 层，不碰 canvas） | 处置 |
  |---|---|---|
  | `bounds` 占位区越界 | 收敛后的比例坐标 × 画布短边折算；画布在「短边比例」里是 `W/短边 × H/短边`（1080×1440 = 1 × 1.333）。**高度是估算值的位（文字 / Logo）只看宽度与左上角** | **拦保存** |
  | `text` 文字可能溢出 | `posterAdminEstimatedLines()`：样例数据代入文案模板，用渲染层同一支 `estimateTextWidth()`（CJK 1em / 其余 0.55em）估行数；估算行数 > `maxLines` 即警告 | **估算警告**（PRD 9.4 原文「保存前给出估算警告」），只提示不拦 |
  | `qrcode` 二维码可扫性 | `sizeRatio × 画布短边 ≥ POSTER_QR_MIN_PIXELS`（120，**从 `posterTemplates` 取**，面板不写死） | **拦保存** |

  `posterAdminSaveFacts()` 的 `ready` 仍是「名字 / id」那一档（老口径不动），拦保存的那两句读
  `checks.blockers`；估算警告进回执。内置 8 套模板逐套**全过**（断言 A3）。
- **引用范围与删除判据（AC4 / FR-358）**：`posterAdminTemplateUsage(template, { audit })` 数**审计日志**里带
  `templateId` 的 `poster.export` / `poster.forward` 两条留痕（次数 / 最近时间 / 对象），叠加「当前是默认模板」；
  `posterAdminDeleteVerdict(template, usage)` 给 `{ allowed, kind, message, usageText }`（`kind` =
  `builtin` / `used` / `invalid` / `ok`）。**删除是两步**：先点「删除模板」摆出影响范围与判据
  （`data-poster-admin-delete-panel`，allowed 时给「确认删除」，否则给「改为停用」），再点确认。
  服务层 `deletePosterTemplate(key, { existing, usage })` 是第二道闸门（绕过界面也删不掉），
  与装裱 `framingPresetDeleteVerdict` 逐条对齐（PRD 9.2 第 7 条）。
- **留痕（AC5 / FR-359）**：`updated_by` / `updated_at` 只由 `stampPosterTemplateUpdate()` 写；
  `history`（上限 20 条）**留在记录对象与本机镜像里，不进云表** —— 云表仍是固定的 14 列
  （`POSTER_TEMPLATE_ROW_FIELDS`，断言逐字比），`posterTemplateToRow()` 不输出 `history`。
  界面读 `posterAdminHistoryRows()`（最新在前、当前那条 `isLatest`）/ `posterAdminUpdatedFacts()`。
- **批写入这一支**（`services/posterTemplatesApi.js` 的 `savePosterTemplates(list)`）：排序 / 设为默认会一次
  改动**几行**，先**一次写全本机镜像**再逐条推云端、逐条记 `failed`、**不抛错**（见下「容易踩的坑」）。
  页面只调它（`savePosterTemplates(rows)`），不自己逐条 save。
- 验收口径：`/tmp/assert-us104.mjs`（Node，**62 项**：三项校验的常量与行读数 / 反向注入能不能抓到 /
  库级动作与留痕 / 适用范围读数与老师端口径一致 / 引用范围与删除判据 / 服务层第二道 / 多行保存写全 /
  页面与 data 层的「用到的标识符都 import 过」结构守卫）
  + `/tmp/assert-us104-browser.mjs`（CDP，**83 项**：行上启停与排序真的落库 → 默认徽标搬家（同一时间只有一套）→
  保存前三项校验（二维码 46px 与作品位越界**拦保存**、超长文案**估算警告放行**）→ 适用范围改一处入口 →
  删除两步确认（未使用可删 / 被使用只能停用 / 内置只能停用）→ 老师端真机用管理端新建的版式**导出一次** →
  回管理端点删除**被拦**（影响范围点名次数与学员）→ 改为停用 → 变更历史可查看 → 390px 单列 ≥44px →
  console 0 error）。截图 516~524。

## 海报二维码与分享令牌联动（[海报 US-313]）

> 「海报上的码扫了要真能看到东西；分享撤回了，码也不该还能打开」这一条的全部判断在
> `src/data/posterShareQr.js`（零依赖纯函数 + 常量，可 `node` 直跑断言）；生成动作的编排在
> `src/services/posterShareGenerate.js`；界面多出来的只有弹窗里那一块面板（`PosterDialog.jsx` 的
> `[data-poster-share-qr]`）。四条纪律：

- **二维码内容 = 分享令牌链接**（`shareTokenUrl(token, { origin })` = `<origin>/p/<token>`）：plan 的
  `spec.slots[].type === 'qrcode'` 里写的是**模板变量** `{分享链接}`，真正被编码的那串由渲染层
  `applyPosterVariables(slot.value, posterVariableContext(plan.data))` 代入 —— 判据要读**代入之后**的值
  （直接比 `slot.value` 会看到 `{分享链接}` 这四个字，是假红）。
- **二维码位那句占位按状态分档**（撤回 / 过期不再谎报「待生成」）：文案表 `POSTER_SHARE_QR_STATE_TEXTS`
  （`none: 分享链接待生成` / `revoked: 分享已撤回` / `expired: 分享已过期`），`posterSingle.js` 的
  `POSTER_SINGLE_SHARE_PENDING_TEXT` 现在是它的 `none` 档（**单一真源**，别再写第二遍了）。
  `posterSingleSpecPatch(spec, { sharePendingText })` 是唯一入口 —— 五类版式都过它，report-long 走自己
  的块合成（`content.sharePendingText`）。**`posterShareQrPlaceholderText()` 不能用 `||` 兜底**：
  `active` 那一档的文案就是空串（可用时写占位就是错的）。
- **海报内只出现一个二维码**（AC4）：`posterShareQrGuard(spec)` 只保留 slots 里**第一个可见**的 `qrcode`，
  其余置 `visible: false`（不删除字段 —— 渲染层因此结构上画不出第二个码）；它由 `posterSingleSpecPatch`
  内部调用，所以单作品 / 阶段 / 班级 / 成片封面四支自动都有，长图本来就只有一个码（块合成）。
  `posterShareQrSpecFacts(spec)` 给读数（`visibleCount / keptId / hiddenIds`），面板与断言读同一份。
- **plan 的 `share` 段只有一个装配点**：`posterShareQrShareView({ state, stateLabel, active, tokenText, link,
  path, expiresText, daysLeft, spec })` —— 五类版式都调它，字段因此不会各写一套。`link` 是**完整地址**、
  `path` 是 `/p/<令牌>`、`expiresText` 直接取令牌账的读数（`shareTokenView` / `videoSharePanelView`），
  本模块**不另算一份日期**。
- **有效期变化时二维码不变**：二维码 payload 只依赖 `token` 本身 —— 改 `validDays` / `expiresAt` 只动
  面板上的有效期读数（`posterShareQrFacts().expiresText`），链接与码值一字不变（断言 F 里逐条比过）。
- **生成动作只有一份编排**（`services/posterShareGenerate.js`）：
  `posterShareQrGeneratePlan()` 判「要生成哪一种令牌 + 闸门过不过」→ `generatePosterShareToken()` 生成并
  返回**新的令牌数组** + 一条待写的留痕输入。图文走 `shareTokenRecordInput(record, …)`（`data/shareTokens.js`
  里新增的**唯一入参拼装点**，第四步的 `buildParentShareToken` 也改成调它）、成片走
  `videoShareTokenInput()`（`kind: 'video'` + `jobKey`，不混进图文令牌账）。闸门永远是
  `shareTokenGenerationGate` ← `archiveForwardView` ← `data/consent.js`（成片那一支走 `videoShareGateView`，
  它内部逐位学员走同一支判据）—— 弹窗**不自己判授权**，也不自己造令牌。
- 弹窗新增 props：`consents`（生成闸门要它，两处入口都传；`GrowthArchiveData.jsx` 与 `main.jsx`）。
  令牌账的写入仍归调用方（`setShareTokens(result.tokens)`），本机镜像由 App 层的 effect 落盘 —— 与
  `services/shareForwardSend.js` 同一条口径。
- **重绘键带上分享状态**：`posterShareQrPlanKey(share)` 代替原来的 `active ? link : 'no-share'` ——
  「可用 → 已撤回 / 已过期」这种状态变化也要重画（否则预览停在旧图上，码还在墙上）。
- 验收口径：`/tmp/assert-us105.mjs`（Node，**213 项**：文案真源 / 状态归一 / 只画一个二维码 /
  五类版式的 share 段与占位分档 / 生成三条路径（闸门拦下 · 生成 · 已有链接不再生成）/ 有效期变化 /
  面板读数与重绘键 / 12 组垃圾输入不抛错 / 分层纪律与源码接线）
  + `/tmp/assert-us105-browser.mjs`（CDP，**111 项**：真机链路到第四步 → 弹窗里二维码面板读数 →
  页面内用真实 data 模块重算 plan + **渲染层**的 `renderPosterDialog` 读「画了什么」（含二维码方框内的
  深色像素数）→ 点「先生成分享链接」真出码 → **扫那条链接**打开家长页看到内容 → 另一张标签页把令牌改成
  过期（App 监听 storage 当场同步）→ 面板与预览一起失效、扫码看到「已过期」→ 面板里重新生成 → 撤回 →
  再扫码看到「该分享已撤回」→ 模板里塞第二个可见二维码位只画一个 → 390px ≥44px → console 干净）。
  截图 525~534。

## 容易踩的坑

- **「出现过这个名字」不等于「消费它」：结构性判据别用子串**（US-103 真踩一条老断言）：
  US-090 的「自检模块的消费点只有 main.jsx」原来是 `source.includes('posterSelfCheck')` —— 本轮我在
  `data/posterAdmin.js` 的**注释**里引用了一句「与开发自检同一份约定」，那条断言当场假红。
  判据要写成**真的 import 点**（`from '…posterSelfCheck'` 或动态 `import('…posterSelfCheck')`）。
  同类：任何「界面不写死字段名 / 不直接调引擎 / 规则只在 data 层」的源码守卫，**先剥注释再查**
  （`stripComments()`：块注释 + 行注释），否则注释里提到的函数名与路径字面量都会假红。
- **data 层新模块的每个导出都要在 Node 里喂一份非空夹具跑一次**（US-103 真踩两次）：
  `posterAdminUnsavedTemplateIds` 用了 `posterTemplates.js` 的私有 `list()`（压根没 import 到）、
  `posterTemplateKey` 也漏了 import —— `pnpm run build` 全绿、`#root.innerHTML.length === 0`（白屏，
  `ReferenceError` 只在运行时炸）。更阴的是：**空数组夹具会让 `map` 里的 ReferenceError 漏过去**
  （`[].map(fn)` 不执行 fn）—— 遍历导出逐个调用时，夹具必须**非空**。
- **管理端页面读云端时不能让服务层顺手写镜像**（US-103 真踩，与「夹具 ↔ 云端合并竞态」同源）：
  `loadPosterTemplateStore()` 默认 `persist: true`，它 resolve 时会把**读之前**的本机列表写回镜像 ——
  与「用户在这期间刚新增 / 刚保存的那一套」形成竞态：界面看着好好的、镜像是空的、老师端弹窗里没有它。
  做法：让页面**独占**写镜像（`{ persist: false }`）+ `touchedRef` 标记「读回之前用户已经动过手」→
  直接放弃回灌（合并方向仍是本机优先）。凡是「异步读云端 + 同步给用户写」的页面都按这条走。
- **「先镜像再推云端」的循环会在第一条云端失败时中断**（US-312b 真踩，本轮的新变种）：
  排序 / 设为默认一次要改**几行**，写成 `for (const row of rows) await savePosterTemplate(row)` 时，
  第一个 `savePosterTemplate` 内部「镜像 → 云端 push」的 push 一失败就抛错跳出整个循环 ——
  **后面几行的镜像压根没写**（表现：列表顺序换了、镜像是半新半旧的、老师端按旧顺序显示）。
  做法：`services/posterTemplatesApi.js` 的 `savePosterTemplates(list)` —— **先把本机镜像一次写全**
  （`mergePosterTemplates(list, loadLocalPosterTemplates())` 一次落盘），再逐条推云端、逐条记 `failed`、
  **不抛错**。凡是「一次动作改多行」的库级操作都按这一条来（浏览器断言 `[2.2]/[3.1]` 抓到的）。
- **页面里用到的常量 / 函数必须真的 import 到，`pnpm run build` 不会告诉你**（US-312b 真踩，与
  US-103 的「私有函数没 import」同类，但这次在**页面**里）：我在 JSX 里写了 `POSTER_ADMIN_HISTORY_EMPTY`
  却漏了那一行 import → 构建全绿、`#root.innerHTML.length === 0`（白屏，`ReferenceError` 只在运行时炸）。
  判据：Node 断言里加一段**静态守卫** —— 把文件里 `POSTER_ADMIN_* / POSTER_TEMPLATE_* / posterAdmin* /
  posterTemplate*` 的**使用**集合（先剥注释、再去掉 import 语句与引号字符串）逐个查「imported ∪ declared」
  （`importedNames()` / `declaredNames()` / `usedPosterIdentifiers()`，见 `/tmp/assert-us104.mjs` 的 G6/G7）。
  这类白屏只有**浏览器回归**会第一时间抓到 —— 改完页面先跑一遍进页面的那条 CDP 脚本。
- **分享令牌账的基线不一定是空的：判据要用「增量」**（US-313 真踩）：App 挂载时会
  `loadRemoteShareTokens()` 把云端 `share_tokens` 表并回来（`main.jsx` 第 623 行），而这张表里可能留着
  **别的跑批写进去的令牌**（浏览器回归脚本与人工试用都往同一张表推）。于是「生成前账是空的」这种断言
  时红时绿；改成「生成后**增量 1** 且新那条的 `recordId` 就是这条记录」—— 判据更强也更稳。
- **分享撤回后，「撤回」按钮会消失**（US-313 写的脚本踩到）：第四步分享面板的撤回动作对的是
  `shareTokenPanel.active ? token : null` —— 令牌**已过期**时面板给的是「重新生成分享链接」而不是撤回。
  所以要验「撤回后二维码失效」，先用面板里的**重新生成**拿到一条新的可用令牌，再撤回它；
  老的那条（过期）仍然各自推算状态（断言里两条链接各扫一次：一条「已过期」、一条「该分享已撤回」）。
- **「值比框长」不是布局溢出**（US-312b 真踩一条自己写的断言）：390px 逐块量横向溢出时，
  `input` 的 `scrollWidth > clientWidth` 是**文本滚动的正常现象**（长文案、长文件名都会这样），
  它不是「块溢出了」。逐块判据要把 `INPUT / SELECT / TEXTAREA` 排掉，页面级的
  `document.documentElement.scrollWidth` 才是「有没有横向滚动条」的判据。
- **同一个概念散落在五个 plan 的五个字段名里时，只给界面留一个出口**（US-102）：
  「这张海报对应哪条归档记录」在阶段 / 长图叫 `shareRecordId`、班级叫 `share.recordId`、
  封面叫 `artwork.recordId`、单作品原本**压根没带**（本轮补上 `plan.recordId`）。
  界面与断言只管 `posterForwardNames(plan).recordId` 这一个出口 —— 否则每加一支版式就要在
  三处（转发状态 / 留痕 / 断言）各补一次分支，漏一处就是「这张图永远显示未转发」。
- **本地跑浏览器回归时，同一份脚本会因为「多一次往返」而换结果**（US-102 回归 US-068 踩到）：
  US-068 的 6 条「打开次数 = 2」断言在 headless 下**时红时绿** —— 同一份代码 4 次里 1~2 次通过；
  把 US-102 的弹窗文件整个 `git stash` 回退后**照样红**（2/2），所以它不是本轮改动引入的。
  症状是「家长第二个标签的第二次打开，在老师那一侧的本机镜像里看不到」（跨渲染进程的 localStorage
  提交时机）。判红之前先看：① 是不是只有这几条「跨标签同步」的断言红；② **单独重跑**一遍；
  ③ 顺手核对同一份脚本在改动前后是否都红 —— 别急着改产品代码（US-093 也踩过同一类）。
- **文案类功能的「合规」判据要复用已有的那一份禁词表**（US-102）：海报的微信文案与归档模块的
  微信文案是**两种文案、同一条隐私边界** —— 海报侧直接调 `archiveWechatContactIssues()`，
  不在新模块里再写一套手机号 / 邮箱正则。判据也因此可以写成「两处文案都过同一支复核」，
  改一处边界两边一起生效。
- **「这一位没事」不能用 `slot.drawn` 判，`drawn` 只表示「至少画出来一格」**（US-101 真踩）：
  海报的 image 位是**拼贴**（阶段海报一屏 3~12 格、班级墙 30 格），一格坏掉时整格的 `drawn` 仍是
  `true`。素材缺失必须**逐格判**（`cells[].url` 有地址但 `drawn !== true`）——本轮 Node 侧单格夹具
  全绿、浏览器侧一屏三格（两好一坏）才把它抓出来；反过来 `url:''` 的有意占位格（班级「本期暂无作品」）
  绝不能被算成缺失，否则正常出图会被自己的校验拦死。
- **「下载目录条数变多」不是「有没有真的下载」的判据**（US-101 真踩）：同名文件再下一遍会**覆盖成同名**
  （本轮第二次导同一张 PNG 时目录条数没变，断言以为没下载）。判据要么**先清空下载目录**再看有没有新文件，
  要么按「文件名 → mtime」认最后一个；`<a download>` 的补丁计数是页面级的、会跨用例累积，
  要比的是「这一次导出前后的差值」。
- **给同一份服务文件加第二支分派，会让「数调用次数」的老断言假红**（US-101 改了 US-097 / US-098 两条）：
  `services/posterDialog.js` 多了导出档那一支之后，`renderPosterX(` 的出现次数从 5 变 10、
  `import { renderPosterSingle } from './posterSingle'` 也变成了带常量的多条 import 形状。
  改判据而不是删断言：前者换成「**去重后**正好是五类版式」，后者换成「五支渲染函数各自从自己的模块
  import + 这一层不建画布」。同类的「数个数」断言都该写成「集合」而不是「次数」。
- **「另存下来的东西」要不要跟着图走，先问一句「下一张海报还用得上吗」**（US-310b）：
  同一次调整里的五项，结局分了三类 —— 标题 / 金句 / 二维码显隐进模板（所见即所存），
  日期**不进模板**（US-038 早就定了「模板只承载日期的格式与位置」；把某一天固定进模板会与展签口径打架），
  收录哪些作品也不进（那是这一次的名单）。存错的判据很隐蔽：图是对的，但下一张海报会印上上个孩子的日期。
- **模板里存成字面量之后，面板的「默认值读数」也要跟着改口径**（US-310b 真踩一次）：
  `posterTuningDefaults()` 原先直接读 `plan.quote.text`（点评原文）与 `value.dateDots`（课次日期）——
  另存出来的模板把文案存成了字面量，图上画的是模板里那一句，读数却还指着点评原文，
  占位提示当场变成一个画不出来的值。判据：**读数按变量表解出「那一格上的字」**
  （`posterTuningSlotText()`），并让旧断言（US-099 的 E6 就是这一条）继续成立 ——
  同一份输入下解出来的值必须与从前逐字符相同。
- **模板自己关掉了某支元素时，别给它一个「勾了也不会画」的勾选框**（US-310b）：
  二维码的覆盖只写 `visible:false`（关得掉、开不回来），所以「模板本身没画码」的那种模板上，
  勾选框置灰并写清原因（`POSTER_TUNING_QRCODE_TEMPLATE_OFF`）。这与「没有这个位」分开说：
  一个换模板就能改，一个换哪套都一样。
- **`attachToPage()` 返回后页面可能还没导航提交**（US-099 连踩两次）：CDP 的 `Target.createTarget`
  建完标签页就返回，此时文档还是 `about:blank` —— 脚本第一句 `localStorage.clear()` 会抛
  `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied`（表现得像
  「产品坏了」，实际是竞态）。做法：attach 之后先
  `waitForCondition('location.origin===<app origin> && document.readyState!=="loading"')` 再碰页面状态。
- **「每次渲染后量一次」的测量签名里不能有时间戳**（US-224 真踩）：`useEffect(()=>{measure()})`
  （无依赖数组）+ 签名内含 `new Date().toISOString()` 时，每次测量都「有新值」→ `setState` →
  渲染 → 再测量 → **Maximum update depth exceeded** 的死循环（页面直接卡死，`Runtime.evaluate` 超时）。
  签名只能用**会真的影响结论的字段**（视口 / 测到的盒子 / 逐块宽高）。同一个坑还有第二种表现：
  「口径变了才 setState」的判据必须是可比较的稳定值，不是「这一次算的对象」。
- **`fullscreenchange` 不是全屏状态的可靠真源**（US-224 实测：headless Chrome 里
  `document.fullscreenElement` 变了但一个事件都不派发）。凡是「浏览器之外还有一份界面状态」的能力
  （全屏 / 可见性 / 锁屏 / 媒体播放），都要**动作结果乐观同步 + 定期拿 DOM 对账**，事件只做带外变化。
- **回归 / 验证脚本跑之前先清干净进程**（US-224 实测）：上一次被中断的 Chrome（`Google Chrome for
  Testing` 主进程）会拖满 CPU，表现是**随机**的「等待条件超时 / Runtime.evaluate 超时 / 页面像卡死」，
  很容易被误判成产品 bug。`pkill -9 -f "Google Chrome for Testing"` 之后再跑。
- **往 `localStorage` 直塞夹具的脚本与 App 的云端合并有竞态**（US-098 实测）：`main.jsx` 有一条
  `useEffect(()=>{persistFeedbackRecords(records); if(recordsRemoteReady) saveRemoteFeedbackRecords(records)},[records,recordsRemoteReady])`
  —— 脚本写完夹具镜像、还没 `Page.reload` 时，云表读取完成（`recordsRemoteReady` false→true）会
  触发这条 effect，用 App **内存里的那批 records** 覆写刚写进去的夹具（表现：第二遍夹具少了 6 条，
  断言全线红，重跑又全绿）。判据：`localStorage.getItem('xinlehui-feedback-records-v1')` 里的
  `feedback-us093-fix-*` 条数与脚本注入的条数不一致。脚本侧要**等云表读完再写夹具**
  （或写完立刻 reload），别把这类偶发红当成产品 bug。

- **派生值（`const x = f(state)`）必须排在被它读的 state 之后**（US-108b 真踩）：把
  `evaluateReviewArchiveGate({… generated: reviewGenerated …})` 放在
  `const [reviewGenerated,setReviewGenerated]=useState(false)` **之前**，运行时报
  `ReferenceError: Cannot access 'reviewGenerated' before initialization`，**整页白屏**
  （`#root` 为空、任何导航都渲染不出来），而 `pnpm run build` 照样通过。诊断信号：
  `document.getElementById('root').innerHTML.length === 0` + CDP 的
  `Runtime.exceptionThrown` 里那条 ReferenceError。修法是把 **state 声明提前**，不是把派生值
  挪到 return 附近（`go()` 这类更早定义的函数体要读它，挪后面会换成另一个 TDZ）。

- **`<table>` 会撑宽 grid 父容器**（US-107b 真踩）：`width: 100%` + `table-layout: fixed` + 单元格
  `overflow-wrap: anywhere` 都不够 —— 表格的 `min-width: auto` 在 Chrome 里给出一个**与内容无关的宽下限**
  （本轮实测空表也是 880px），而 grid item 的自动最小尺寸会把这个下限传给轨道，于是 390px 下面板
  `scrollWidth` 溢出 582px（页面不横向滚、面板内部被裁，肉眼容易漏掉）。
  修法：表格显式 `min-width: 0`。同类：`white-space: nowrap` 的文本片段（本轮推理开头片段）也会贡献
  min-content 把容器撑到 600px+，窄屏要么允许折行、要么给块级容器 `overflow: hidden`。
  **验证时量的是 `panel.scrollWidth - panel.clientWidth`**（不是 `document.scrollWidth`）—— 后者是 0 也照样有问题。
- **`window.__xinlehuiReviewTrace` 在「新一次生成本身」不会清空**（US-107b 真踩）：它是上一次 `onTrace` 写下的
  收束轨迹，于是脚本里「等本次收束」的判据 `window.__xinlehuiReviewTrace.status!=='running'` 会**立刻返回上一次的结果**
  —— 本轮两个探针都被它骗过（误判「parentTraceId 是空的」「对比区没渲染」，其实只是读早了）。
  可靠信号：等 `(window.__xinlehuiReviewTraces||[]).length === N`（账本每次 settle 都会加），
  或者先记下本次开跑前的 traceId 再比。
- **写接口抛错时「await 之后就没了」**：`save<X>/create<X>/update<X>` 是「先写本地镜像再推云端」，
  云端不通时 `unwrap` 会 **throw**，于是 `const saved = await create<X>(...)` 后面的每一行都不会执行 ——
  既拿不到返回值，也来不及记住新记录的 id、把 `saved` 并进 state。三条纪律：
  ① 收尾逻辑（并入 state、记住 id）要抽成一个函数，成功分支与 `catch` 分支都能调用；
  ② `catch` 里按**自然键**从 `load<X>()`（本地镜像）把刚落盘的那条找回来当返回值；
  ③ 别把「已保存到本机」的收尾只写在 `await` 之后 —— 那条路径在云端不通的开发机上永远走不到。
- **唯一性不能用 id 派生**：如果实体主键是「自然键的纯函数」，那么冲突检测会退化成「两条记录 id 相同」，
  永远发现不了重复，upsert 还会静默覆盖前一条。主键用随机唯一 id（如 `makeUniqueLessonId()`），
  自然键（`classId + lessonDate + lessonNo`）单独做唯一性校验。
- **只有被 import 的模块才会进构建**。新建了 data/service 模块却没人引用时，`pnpm run build`
  不会编译它，等于没验证。新模块至少要在 `main.jsx` 里接上 state / effect 走一遍。
- 时间戳用 `??` 而不是 `||` 兜底：显式空串表示「历史数据本来就没有」，不要偷偷填 `now`。
- 日期一律归一成 `YYYY-MM-DD` 再比较；旧数据里有 `2026.08.04` / ISO 串 / `Date` 混用。
- **静默的 `try/catch` 会吞掉编程错误**：`catch{/* 渲染失败：保持占位 */}` 这类「容错」写法会让
  `ReferenceError`（拼错的常量 / 没导入的标识符）表现成「功能一直不出效果」，而控制台一个错都没有。
  容错的 catch 至少要把失败原因落到界面或 state 上（US-007 的 `overlayPreviewError`），
  否则调试时只能靠打补丁数 `toDataURL` 才知道「那段代码到底跑没跑」。
- **`pnpm run build` 不检查未定义的标识符**：渲染里引用一个没定义的变量（本轮 `saveImageStrategy`）
  构建完全正常，直到浏览器渲染到那一行才 `ReferenceError`，React 直接把整棵树卸载成白屏。
  这类错误只有「真的把页面点到那一步」才会暴露 —— UI 故事的最小验证是把改动的界面**渲染出来**
  （截图 + 断言），不要只看构建与 Node 断言。
  「用了但没 import」的变体同样只在运行时炸（US-223 真踩：`normalizeVideoRetentionPolicy` 只写了调用、
  没进 import 列表，构建 404ms 通过、点进管理端才 `ReferenceError`）—— 新增一组 import 时，
  **把新代码里出现的每个标识符对着 import 行数一遍**；写完立刻在浏览器里把那块面板渲染一次。
- **改了 `localStorage` 镜像 ≠ 界面会变**：模块级内存（`services/videoJobQueue.js` 的队列）与 `App` 的
  各份 `useState`（本机镜像读进来的）都是**挂载时读一次**，只改镜像再重进页面仍是旧值。
  验证脚本要注入夹具时只有两条路：**走界面点**（最可靠），或改完镜像 `Page.reload` + 重新登录 +
  重新走到那个页面（US-223 的 `reloadAndWalk()` / `reloadAdminArchive()` 就是这个形状）。
  反过来，页面内 `await import('/src/...')` 拿到的是另一个模块实例（US-214），改它的内存状态界面一动不动。
- **「本班老师」这类归属闸门不止一道入口**：US-211 的 `archiveRecordAccess` 不只管
  「能不能看档案」，它也是归档动作本身的门 —— 把某个班的任课老师改成别人来验「跨班被拒」，
  连**归档流程**都会被拦（老师只能归档自己班的记录），于是档案页根本进不去（US-223 的验证脚本真踩）。
  验这类拒绝时要么挑一个不被它拦住的路径（新加一个「别人的班」并把对象挂过去），要么把这段检查
  放到脚本最后。个人模式（`className` 为空）按同一份判据算「自己的班」—— 想验拒绝必须构造出非空班级。
  **改完 `main.jsx` 先跑一遍静态自查再进浏览器**（US-012 又踩了一次：`evaluateMemoryPeak` 忘了加进
  import 列表，第一步整页白屏、构建照样过）：不需要装 eslint，拿一段 20 行 Python 把
  「用到的名字」与「import 绑定 + const/let/function 声明（含解构）」比对即可 ——
  `grep -o` 出形如 `evaluate[A-Z]\w*` / `EDIT_\w+` / `framing\w+` 的标识符逐个对，比白屏之后二分定位便宜得多。
- **异步事件处理器里的 `ReferenceError` 连 console 都不报**（US-009 真踩）：把 import 里的函数改了名、
  却漏改调用点（`framePresetNameProblem` → `framingPresetNameIssue`），于是 `onClick` 的 `async`
  处理器在 `await` 之前就抛错 —— 表现是「按钮点了完全没反应」，DOM 无变化、**console 无报错**、
  build 通过（不检查未定义全局）。定位手段：在页面里装 `window.addEventListener('unhandledrejection', …)`
  收集 rejection（普通 `console.error` 探针抓不到），或直接读按钮 fiber 的 `__reactProps$…` 确认 `onClick` 在。
  改函数名时用**词界全局替换**并回读一遍所有调用点。
- **构建偶发 `[MISSING_EXPORT]`：模块单独打包时导出明明存在**（US-009 实测 `framePresetNameProblem`）：
  rolldown 对某个具体标识符报「not exported by src/data/xxx.js」，但直接 `rolldown({input:'src/data/xxx.js'})`
  打印出的 `exports` 列表里有它，Node 也能 import。**换一个名字立刻就好**（本故事改成
  `framingPresetNameIssue`）。遇到这种「导出明明在、构建说没有」的情况，别去改导出语法，
  先换标识符名再验一次。
- **装裱模板的合并方向已翻转（US-011b 起）**：`mergeRemoteFramingPresets(remote, local)` 是
  **本机镜像优先**，云端只补「本机没有的 id」。原因是云表缺 `scope` / `owner_key` / `is_default` /
  `bound_course_types` 列、带新列的写入会被整条拒掉（400 `DATABASE_PGRST204`），模板改动只在本机落地。
  所以后台改模板 → 老师端看得见（刷新也在）；反过来说，**想让改动同步到别的设备目前做不到**，
  这是云表补列之前的口径。旧写法（「要挑一套不在云端表里的模板」）已不成立。
- **JSX 里少一个 `<` 会报成完全无关的 `Expected } but found Identifier`**（US-106b 真踩，耗了大半个
  iteration）：`<div className="x">{CircleAlert size={16}/>{notice}</div>` 里丢掉那个 `<`，报错行指向
  外层 `{notice ? <div …` 那个容器、列位置落在一个属性名上，信息是「Expected `}` but found `Identifier`」——
  看起来像 oxc 的 JSX 解析器坏了。更坑的是**错误行会跟着文件里的行数一起挪**：删掉报错那一行，错误就跳到
  「下一个 `{…}` 容器」（`{versionRows.map(...)}` 等），于是「挨个删块」的二分永远是红的、看起来处处都错。
  正确的排查顺序：① 拿一份**确定能过**的版本（`git stash` / 只加一块）做基线；② 用
  `createServer({server:{middlewareMode:true}}).transformRequest('/src/x.jsx')` 在 Node 里拿精确的
  行列号（比全量 build 快得多，也是唯一能一眼看出「报错位置其实是 JSX 子节点位置」的手段）；
  ③ 比字节时别只 `diff` 行文本，用 `difflib.SequenceMatcher` 看 opcodes（本轮真正的差异就是
  一个 `{` ↔ `<`，行文本打印出来一模一样）。
  顺手记一条：`diff` 输出被 `head -N` 截断会让你误判「只有空行差异」——比字节之前先确认没截断。
- 旧数据兼容的写法：`normalize<X>(raw)` 永不抛错，缺字段补默认值，**无法映射的原始对象挂到 `legacy` 字段上原样保留**，
  宁可多带一个字段也不要丢数据；不要为了让旧数据「看起来完整」而编造日期或序号。
- **`Page.captureScreenshot` + `captureBeyondViewport`（fullPage）在「长页面 + 流式重渲染」时会挂 30 秒**
  （US-108b 实测，且 `git stash` 到 HEAD 版本同样挂 —— 是环境问题不是回归）：第三步展开点评详情、
  模型正在流式写正文时，页面高度 5000~6000px，`captureBeyondViewport: true` 直接超时；
  同一页面在 idle 状态（3300px）0.7 秒就截完。验证脚本默认用**视口截图**，需要长图时按块分段截
  （或先 `scrollIntoView` 再截视口）。判断「截图挂起是不是自己改坏的」：先把改动 `git stash`
  跑同一条路径，两边都挂就是环境。

## 验证技巧（没有测试框架时的替代方案）

data 模块是零依赖的纯 ESM，可以直接用 Node 跑：`node --experimental-loader <扩展名补全 loader> <脚本>`
（Node 不会解析 Vite 风格的无扩展名相对导入，需要一个小 loader 把 `'../cloud'` 补成 `'../cloud.js'`）。
service 模块也能在 Node 里测：`cloud.database` 是**可写属性**，导入后替换成内存表替身
（builder 需要 `then()` 才能被 `await`）即可覆盖「唯一性 / 状态机 / 云端失败回落」这些关键分支。
写内存表替身时 `delete()` 必须**真的**把命中行从表里移除：只实现 `select` / `upsert`、让 `delete` 返回
一个空 thenable，会让「删除课程/课次」的断言假通过。

### 证明「提示词逐字符不变」（重构类改动，US-101 起）

- **基线要在改代码之前抓**：`buildPersonaSystemPrompt` 是纯函数，先跑一个脚本把多组输入
  （兜底分支 / 完整人设 / 只有名字 / 老式内嵌技能 / 停用技能 / 空 keywordScope …）的 system 输出落成 JSON，
  改完再跑同一份输入逐字符比对（用 `git stash` 事后抓也行，顺序反过来更省事）。
- **服务层也能在 Node 里跑**：`services/llmReview.js` 只 import `cloud` 与 data 模块，
  配上扩展名补全 loader 就能直接 import；把 `cloud.llm.chat.completions.create` 换成
  **异步生成器替身**（同一个 ESM 单例，直接赋值即可）就能抓到「真正发给模型的 `messages`」——
  这是「调用方不传新参数时提示词逐字符一致」的硬证据，比只比纯函数产物更强（把调用点也覆盖了）。
  替身记得 `yield` 一段合法 JSON 与一条 `usage`，顺带断言解析结果不变。
- 浏览器里再核一遍：`await import('/src/services/llmReview.js')` 拿页面内的实现重算同一组输入，
  与 Node 侧基线比对 —— 证明构建产物没有第二套行为。

### 需要「真的选择文件」时的浏览器验证（US-406a 起）

`browser_*` 工具**没有 setInputFiles 能力**，`<input type=file>` 的上传路径（班级反馈的作品/照片）无法用它验证。
可行做法：用系统 Chrome 起一个**自己控制的 headless 实例**（`--remote-debugging-port=<高位端口>`），
用 Node 22+ 内置的全局 `WebSocket` 手写最小 CDP 客户端（无需装 puppeteer/playwright）：

- 选文件：`DOM.getDocument` → `DOM.querySelector` 拿 nodeId → `DOM.setFileInputFiles({nodeId, files:[绝对路径]})`，
  它会真实派发 `input` / `change`，React 的 `onChange` 正常触发（这是 Playwright 内部用的同一条通道）。
  隐藏的 `hidden` input 也能直接设。更短的等价写法：`Runtime.evaluate`（`returnByValue:false`）拿到
  元素的 `objectId` 直接 `DOM.setFileInputFiles({objectId, files})`，省掉 `getDocument` / `querySelector` 两步。
- **Ralph 迭代里 `agent.browsers` 不可用**（子代理环境直接报 "Browser is not available in subagent"），
  所以浏览器验收一律走这一节的「自控 headless Chrome + 手写 CDP」。本机 `node` v20.20 **加
  `--experimental-websocket` 就有全局 `WebSocket`**（v22 不用加），Chrome 二进制可以直接用
  puppeteer 的缓存：`~/.cache/puppeteer/chrome/mac_arm-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
  （不必装 puppeteer 包；`chrome-headless-shell` 也在同一层缓存里）。
- **React 的 onClick 用 `el.click()` 就能触发**（headless 下实测可靠）：`Runtime.evaluate` 里
  `[...document.querySelectorAll(sel)].find(...).click()`，比 `Input.dispatchMouseEvent` 少踩
  「元素在视口外 / 点击落点被遮挡」两个坑。文本匹配要分清包含与精确：侧边栏 `课后反馈工作台`
  以 `课后反馈` 开头，导航必须用 `textContent.trim()===目标` 的精确匹配。
- 点击：`Input.dispatchMouseEvent`（mousePressed + mouseReleased，坐标取 `getBoundingClientRect()` 中心）。
  `el.click()` 也行，但前者更接近真实用户。
- `<input type=date>` 的键盘输入：**段顺序是 locale 决定的**，本机 zh-CN 下是 YYYY/MM/DD；
  点最左侧是**年份段**，而且年份段会一直吞数字、**不会**在 4 位后自动跳到月份 —— 必须每段输入后发一次
  `ArrowRight`（`2026` → Right → `08` → Right → `04` 得到 `2026-08-04`）。用 `Backspace` 清空会把年份打乱成
  `80420-02-06` 这种脏值，别用。
- 这套脚本放在 `/tmp` 即可（不进仓库）：注意本机 `node`（v20）**没有全局 WebSocket**，
  要用 `~/.nvm/versions/node/v22.23.2/bin/node` 跑。
- **填 `<input type=date|number|text>` 用 `locator.fill()` 的等价写法，不要用 `Input.insertText`**：
  裸 CDP 下 `Input.insertText` 连打字符都进不去日期输入框（试过整串、也试过分段 + `ArrowRight`，值都不变），
  `Meta+A` 也不生效（于是 insertText 变成追加：`3` → `312`）。可行做法是用**原型上的 value setter**
  绕过 React 的 value tracker，再派发真实的 `input`/`change`：
  `Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set.call(el,v)` —— 这正是 Playwright
  `fill()` 内部做的事，所以与「`browser_type` 能填 date/number」的既有结论一致。
- **刷新会回到登录页**（登录态只存在内存里），所以脚本里每次 `Page.reload()` 之后都要重新
  「快速体验 → 老师」再点侧边栏目标页，否则后面所有选择器都会拿到 null（本故事第一版就卡在这里）。
- 记完 console：`Runtime.enable` + `Log.enable`，`net::ERR_CONNECTION_REFUSED` 是本机云端不通的既有现象，
  `404` 多为 favicon / 未接的后端接口，不代表功能坏了。本机云端还会对 `lessons` / `courses` 表返回
  **404**（`.cloud/database/rest/...`，表未配置），过滤 console 报错时要连这一类一起排除。
- **CDP 的连接端点要选对**：`/json/version` 给的是 **browser target**，对它发 `Page.enable` 会报
  `'Page.enable' wasn't found`；要从 `/json/list` 里挑 `type === 'page'` 的那条 `webSocketDebuggerUrl`。
- **点击前先 `scrollIntoView`**：`Input.dispatchMouseEvent` 用的是视口坐标，元素在视口外时点击会落空
  （表现为「点了没反应 / waitFor 超时」）。滚到 `{block:'center'}` 再取 `getBoundingClientRect()` 中心。
- 侧边栏导航按钮用**精确文本**匹配：`课后反馈工作台` 以 `课后反馈` 开头，`startsWith` 会点到工作台。
- 页面里跳走再回来（例如点「去授权管理」再回「课后反馈」）时：`TeacherFlowV2` 重新挂载，
  **mode 不进草稿**（US-409 口径）、纯初始态也不会写草稿，所以脚本要重新点一次「班级反馈」再断言提示，
  不要以为状态会原样回来。
- 登录页的类名是 `.auth-shell`（不是 `.auth-screen`）。
- **`Emulation.setDeviceMetricsOverride` 会留在 page target 上**（脚本退出、新开 WebSocket 连同一个 page
  也还在）：跑手机视口的脚本时**每次开头都显式设置目标视口**，别依赖上一次的状态。反过来，≤820px 时
  侧边栏是 off-canvas（`transform:translateX(-100%)`，rect 是负数），**登录与侧边栏导航要在桌面视口做完**，
  再切到 390px 做录入页验收（切视口不会重新挂载组件）。
- **点击落点要在点击前用 `elementFromPoint` 复核**：`scrollIntoView({block:'center'})` 之后立刻取
  `getBoundingClientRect()` 再点，会在页面还在滚动 / 列表还在长高时点到别的元素（表现为「点了没反应」，
  静默失败）。做法：`scrollIntoView` → 等 ~400ms → 重新取 rect → 用 `elementFromPoint` 确认落点是目标
  （或其后代）→ 再派发鼠标事件，落点不对就重试。
- **`textContent` 拼接后元素之间没有空格**（间距是 CSS gap 给的）：组头渲染出的是 `出席22 人还有 22 位未上传`，
  断言用 `/出席\s*22\s*人/` 这类写法，别写 `'出席 22 人'` 的精确匹配。
- 想证明「异步生成没有阻塞输入」时，可以在页面里装一个 **MutationObserver 记录中间态**
  （`window.__intakeTrace`：每次 DOM 变化时记下 pending/ready 数量、已上传计数、待生成图片的 naturalWidth），
  断言「条目与输入已可用、缩略图还没好」这个中间态真实出现过，比固定 sleep 可靠得多。

### 验证「二维码里装的是什么」（US-313 起，装配侧）

海报 / 装裱的图不落地就没法解码（仓库里只有**编码器**，没有解码实现），所以「码扫出来的到底是什么」
用三段判据拼出来，缺一段都不算：

1. **装配**：plan 的 `qrcode` 占位区 `value`（模板变量）经 **渲染层同一支**
   `applyPosterVariables(slot.value, posterVariableContext(plan.data))` 代入 —— 这一串就是喂给编码器的 payload，
   断言它**逐字符等于**那条分享链接（`shareTokenUrl(token, { origin })`）。
2. **绘制**：把 plan 交给 `services/posterDialog.js` 的 `renderPosterDialog()`（预览用的那一支），
   从 `rendered.plan.slots` 读「真的画出来了没有」：`type:'qrcode' && drawn===true`、`modules > 0`、
   `reason:'hidden'`（被唯一二维码收敛掉的）；再在 `rendered.canvas` 上按 `slot.box` 取 `getImageData`，
   数深色像素（真画了码才有几百个以上的墨点 —— 空白方框或占位文字都不会是这个量级）。
3. **打开**：用第 1 步得到的那条 URL 新开一个标签页看家长页（扫码的等价判据）——
   「可用 → 有内容」「撤回 → 该分享已撤回」「过期 → 已过期」三态各断言一次。

### 证明 canvas 渲染「逐像素一致」（重构 / 兼容类改动）

- **别在 Node 里比对渲染**（没有 canvas）。起一个自己控制的 headless Chrome，注意加软渲染参数
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`：否则 headless 里 WebGL 不可用，
  3D 画廊会报 `THREE.WebGLRenderer: Error creating WebGL context`（看起来像功能坏了，其实是启动参数问题）。
- 页面里 `await import('/src/services/framing.js')` 拿到的是**与 app 同一个模块实例**，
  可以直接调 `renderFramedArtwork`。测试图用 canvas 现画（固定坐标/颜色）→ `toDataURL('image/png')`，
  这样不依赖任何素材文件。
- 比对分两层：① 先比 data URL 字符串（同一份 spec 的 JPEG 编码是确定的，相等即逐字节相同）；
  ② 不等时再解码回 canvas 用 `getImageData` 逐像素计数差异，好报告「差了多少像素」而不是只报 false。
- **`specKey` 这类缓存键要用「渲染时真正读到的视图」**：现在直接走 `frameSpecRenderKey(spec)`（整份
  `frameSpecRenderView`）。验证时对两套只有形状/光影不同的模板各跑一次 `resolveExhibitionArtworks`，
  断言产出的 `imageUrl` 不相同（同一模板两次调用则相同）。
- **JPEG 是有损的，断言分两种口径，别混**：
  - **「逐像素 0 差异」只用于「同一编码器下两个渲染之间」的内部区域**：两份渲染在某个 8×8 块内的源像素
    完全相同 → 解码结果完全相同。但块跨越两个区域边界时（相邻像素不同）解码值会变，所以比较区域要
    **内缩 12~24px**（色度二次采样是 16×16）。踩过的坑：拿整个 `matRect` 比「光影是否碰到卡纸」，
    边界那一圈与相框共用 JPEG 块，报出 1.8 万像素假差异；内缩 12px 后为 0。
  - **颜色 / 与「现画参照图」比对一律用容差**（`sqrt(ΔR²+ΔG²+ΔB²) ≤ 24`）：JPEG 会把 `#8D6439`
    解成 `#8A6237`，精确字符串比较必假失败。
- **证明「作品像素只做等比缩放 + 居中、不裁切/不调色」用几何而不是像素比对**：给测试图四周画一条
  10px 深色描边，然后在卡纸窗口内找「深色描边的最外接框」= 作品实画区域，与
  `min(area.w/imgW, area.h/imgH)` 算出的期望矩形比（±2px）；再取作品内一个已知颜色的点断言色差。
  这比「和参照图逐像素比」可靠（后者要穿过 JPEG 有损）。
- **基线要在改动前用「同一张测试图」抓**：先在 HEAD 上跑一遍基线脚本存 JSON，再改代码跑对照。
  踩过的坑：基线脚本与验证脚本各写了一份 `buildTestImage`（一份带深色描边、一份不带），
  源图不同 → 所有基线断言假失败。测试图构造器要**两份脚本逐行一致**（或直接从同一个文件读）。
- **跨会话的 canvas 渲染不是逐字节可比的**：换一次 page load，抗锯齿 / 光栅化的边界像素就会变 ——
  实测「同一份代码」两次抓的 v1 基线也能差 18 万像素、JPEG 长度差 3~4KB；`sameTwice` 在同一会话里为
  true，跨会话就为 false。所以**不要在两次脚本运行之间比 dataURL**。可靠做法（US-002b 起）：
  把 HEAD 版实现临时复制成同目录的兄弟文件（`git show HEAD:src/services/framing.js >
  src/services/__legacy_framing.js`，同目录才能解析 `'./frameSpec'`），在**同一次页面加载**里
  `await import()` 新旧两个模块、对同一张测试图逐字节比，验完删掉临时文件。
- **证明「输出仍是 JPEG 质量 0.92」比对比表**：canvas → JPEG 的**量化表（DQT）只由质量决定**。
  解析 dataURL 里的 `0xFFDB` 段，与「把结果重画回 canvas 再 `toDataURL('image/jpeg', q)`」的 DQT 比：
  q=0.92 时必须逐字节相同，且与 q=0.85 不同（后者证明该判据真的有效）。
- console 里的既有噪音：本机云端不通的 `net::ERR` / `404`、后台装裱预览 `<img src={preview}>` 初始为 `''`
  触发的 React `An empty string ("") was passed to the src attribute` 警告。这些在 HEAD 上就有，
  过滤时要写清楚「是既有噪音」，不要当成新引入的问题放过去。

### 验证「图片类水印画到哪」（US-003b 起）

- 用**纯色测试图**（canvas 现画的 data URL）当 Logo：与「不含该元素」的基线差分出的墨迹外接框就是
  `drawImage` 的目标框，可直接与 `resolveOverlayImageBox()` 的期望框比。判据写「墨迹**落在**期望框内
  （±2px）+ 覆盖 ≥ 期望宽高 − 3.6px」比「四边逐一对齐」稳 —— JPEG 会让最外 1~2px 掉出阈值（90）。
- 纯色图上再画一个小方块（比如左上角蓝块）就能一次证明**等比 + 不镜像**：断言墨迹里的对应位置是蓝色。
- 透明度要按「与底色的混合值」判（0.5 不透明度时像素是两个颜色的中值），不要用「有/无」的二值判据。
- **data URL 长于 ~2KB 的图片先怀疑「被长度上限截断」**，再怀疑渲染：截断后的 PNG/JPEG 往往还能解出上面
  一截，症状是「图片只有上半部分」而**没有任何报错**（US-003b 真踩到 `imageUrl()` 的 `slice(0, 2048)`）。
- 九宫格位置断言要**跑满 9 个位置 + custom**：只测一两个位置时，「偏移方向」类错误（正值朝外）也可能碰巧
  落在画面内而不被发现。

### 验证「二维码画得对不对、扫不扫得出来」（US-003c 起）

二维码是**唯一一种「画错了也看不出来」的元素**：模块错几个，人眼完全无法分辨，只有识别器能发现。
所以验证分三层，缺一层都可能放过真 bug：

1. **独立识别器回读**（最强）：把模块矩阵按 6 倍放大 + 4 模块静区渲染成位图，用 OpenCV 的
   `cv2.QRCodeDetector()` / `cv2.QRCodeDetectorAruco()` 解码，断言文本**逐字符等于**输入。
   本机 Python 有 cv2（5.0），不需要装任何 QR 库。
   - **`QRCodeDetector` 在个别（版本 × 等级 × 内容）组合上会「定位失败」**（返回空串）而矩阵其实是对的：
     多试几个缩放 / 静区尺寸，并**同时用 `QRCodeDetectorAruco`** 交叉验证 —— 本轮 4 个「失败」全是
     缩放 6 / 静区 4 下的定位问题，换 Aruco 或换缩放即通过。别把它们当成编码器 bug 去改表。
2. **码字级断言**（能定位到「哪一段错了」）：写一个小的「矩阵 → 码字」提取器（按格式信息里的掩码反掩码，
   再按 QR 的蛇形顺序读数），断言 ① 数据码字等于**独立算出的规范序列**（模式指示符 + 字符数 + UTF-8 字节 +
   终结符 + EC/11 补位，多块版本要**按块**比对，交错后的序列前缀不是数据段）；② 每个块的纠错码字满足
   **RS 校验子为 0**（另用一套独立的 GF(256) 实现算综合除法）。③ 码字总数等于标准的总码字数表。
3. **渲染像素断言**（页面内，证明「画笔把矩阵画对了」）：把成品图解码回 canvas，按
   `box.x + (col+0.5)*moduleSize` 采样**每个模块的中心像素**，与 `qrMatrix()` 的 `modules` 逐格比对
   （深色 < 110 亮度、浅色 > 150，命中率 ≥ 99%）；再断言白底静区是白的、墨迹外接框落在计划框内。

其它两条口径：

- **参考实现的两个坑**：OpenCV 的 `QRCodeEncoder` 会**忽略** `QRCodeEncoder_Params` 里的 version /
  correction_level（请求 1 版给你 2 版），矩阵与规范实现逐字节不同，**不能当逐格参照**；
  Python 的 `segno` 在「数据刚好落在码字边界」时会**多补一个 0x00 码字**（`write_padding_bits` 里
  `8 - (length % 8)` 在整除时补了 8 位），于是它的补位段与规范不一致。两者都只能用来**交叉验证**，
  判据必须是「识别器能不能读回原文」。
- **改 RS 分块表时先跑「容量交叉校验」**：把 `qrDataCodewords(version, ecc)` 与标准的数据码字数表
  （版本 1–10 × 四级，40 个数）逐项比，再检查「数据码字 + 纠错码字 × 块数 == 总码字数」。表里写错一个
  数字不会让矩阵报错，只会让那一个组合扫不出来。
- **放码位置有两个易错点**：① 校正图案（alignment）必须画在**定时图案之前**（v7 起校正图案的中心会落在
  第 6 行 / 第 6 列，顺序反了整块会被定时图案「占位」掉，症状是 v1–v6 正常、v7+ 全灭）；
  ② 掩码公式的 i/j 是 **行 / 列**（`i%2` 是行方向、`j%3` 是列方向），写反了矩阵照样「像二维码」。

### 验证「编辑器旋转 / 撤销重做」（US-004a 起）

- **只读地看 React state**（不想为验证往产品代码里塞全局变量）：从 `document.querySelector('.feedback-flow-v2')`
  的 `__reactFiber$*` 往上找到 `TeacherFlowV2`，遍历 `memoizedState` 钩子链表按**形状**认领
  （如 `{artwork, photo}` = `media`）。**必须排除同形状的兄弟 state**：`batchUploads`（`{artwork:[],photo:[]}`）
  与 `uploadState`（`{artwork:'uploading'}`）都会被粗判据命中，症状是「读到的 originalUrl 哈希其实是页面 HTML 的」。
  判据写成「`artwork` 是 `null` 或普通对象」最稳。
- **旋转的几何断言**：上传一张**左半幅纯蓝、右半幅纯绿**的测试图（`/tmp/us023-fixtures.mjs` 用 zlib 现画 PNG），
  把当前预览 `<img>` 解码回 canvas 后在象限中心采样：顺时针 90° 后蓝色应在**上半幅**，逆时针在**下半幅**，
  0° 时回到左半幅。比「dataURL 变了没」可靠得多，还能顺带断言画布尺寸（900×600 ⇄ 600×900）。
- **「原图只读」的可判定做法**：编辑前后各 `fetch(originalUrl)` 取字节算一个累加 / FNV 哈希并比对，
  同时在页面里断言地址字符串本身没变（blob: 地址会话内仍可 fetch）。
- **连续点击几十次**（微调到 ±15° 边界、撤销 25 步）：脚本按 ~45ms 间隔派发鼠标事件即可（React 的函数式
  setState 不会丢），但**每次点击前重新取 rect 并跳过 disabled 的那一次** —— 到边界后按钮会置灰，
  「点了没反应」是设计而不是 bug（断言「第 31 次点击时按钮已 disabled」）。
- `Input.insertText` 填不进 `<input type=date>` 是已知的；**原生 `<select>` 可以**用「原型 value setter +
  真实 `input`/`change` 事件」来选（Playwright `selectOption` 的同款做法，见本文件上面的用例），
  个人反馈必须先选学员才能进第二步（否则「至少一位出席学员」这关过不去）。
- 历史栈被**上限截断**后，「一直撤销」回到的是**最老的保留那一版**（不是初始态）：断言要按 limit 设计，
  想验证「撤销回初始」就重开编辑器拿一个干净的历史栈（本故事的 88 项断言就是这么排的）。

### 验证「裁剪框拖拽」（US-004b 起）

- **`Input.dispatchMouseEvent` 用的是视口坐标**：裁剪舞台在长页面底部时，`mousePressed` 落在视口外 →
  **没有任何元素收到 pointerdown**，表现为「拖了完全没反应」。做法：每次拖拽前 `scrollIntoView({block:'center'})`
  + 等 400ms + 取 rect，再用 `document.elementFromPoint(按下点)` **复核**落点是不是目标把手（不是就重试 / 报错）。
  按下之后再滚动不影响（指针捕获会把 move/up 一直送到捕获元素）。
- **拖拽按位移生效，所以断言要写「相对位移」**：起点是**把手中心**（不是框边），把目标写成
  `start + delta × 舞台尺寸`，期望值就是 `before ± delta`（±1px 量化误差）。写成「拖到舞台的 25% 处，
  所以 x=0.25」会系统性偏掉一个「把手半径 / 舞台宽」（本轮真踩了，偏了 0.015 看着像产品 bug）。
- **比例锁是全局状态**：「还原成整幅画面」这类脚本 helper 必须**先点一次「自由」**再拖 —— 锁着 1:1 的框
  永远不可能是 1.5 比例的整幅画面，helper 会一直「拖不动」（产品行为正确，是脚本的锅）。
- 每个把手都要单独验一遍**方向性**（从整幅画面向内拖 5%）：`nw` 只动 x+/y+/w-/h-、`e` 只动 w-……
  这比「尺寸变了没」更能抓住锚点写错（例如 nw 把右下角也一起挪了）。
- **吸附要双向验**：进吸附区（位移 0.012）时 `x === 0` 精确贴齐，出吸附区（位移 0.045）时 `x ≈ 0.045`
  —— 只验「贴齐」的话，把吸附去掉、只留越界夹紧也能通过（夹紧同样给出 0）。
- **最小 10% 的极限拖拽**：把手拖到舞台外面（`dx = -1.2`）也不会出问题，夹紧逻辑会把它顶在 10%；
  换成「拖到 5% 处」是验不到 10% 的（位移只有 45%）。
- 「画心真的按框裁了」用**内容**证：测试图（900×600）画成四个象限（左上蓝 / 右上绿 / 左下橙 / 右下红），
  确认裁剪后把 `media.artwork.cleanUrl` 解码回 canvas，在 5×5 网格上采样，把每个采样点的**相对位置**换算回
  原图坐标（`nx = crop.x + fx·crop.w`）算出期望颜色再比 —— 期望值由**实际**裁剪框推出来，所以拖动结果
  与意图有偏差也不会假失败（跳过贴近象限边界的采样点即可）。

### 验证「编辑器缩放平移」（US-004c 起）

- 夹具用 **1800×1200**（四象限纯色）：长边 1800 > 两档上限，所以低分辨率稿（≤900）与高清稿（≤2400）
  在 `img.naturalWidth` 上**可区分**（900 vs 1800）；900×600 的夹具两档都是它自己，验不出节流。
- **两档预览是时序行为**：在页面里装一个采样探针（每 30ms 记 `data-editor-preview-mode` + `naturalWidth`，
  存 `window.__us004cTraceResult`），并用页面内**同步** `.click()` 触发操作（不要用 `Input.dispatchMouseEvent`
  —— 脚本里的 `scrollIntoView + sleep(400)` 会让「操作时刻」偏移几百毫秒，300ms 的窗口量不准），
  紧跟着打一个 mark（`__us004cMarkNow()`）。判据：低分辨率帧出现在操作后 <300ms（跟手），
  高清帧出现在操作后 ≥300ms（**不是**「两帧间隔 300ms」—— 高清计时从操作那一刻起算）。
- **期望值要独立重算，别抄 data 层的公式**：本轮把窗口几何在脚本里重写了一遍，结果多乘了一次 crop
  （`nx = crop.x + u·crop.w`），看起来像产品 bug（25 个采样点里 5 个颜色不对）。正确口径：
  输出图 = 裁剪窗口，`u = (fx - content.x)/content.w` **就是**画面坐标（窗口坐标与画面坐标是同一个归一化系）。
  另一个安全的做法是**服务层直调**：页面里 `await import('/src/services/artworkEditor.js')` 拿到与 app 同一个
  模块实例，用明确的参数（crop / zoom / offset）跑几组 `renderArtworkCrop`，与 UI 状态无关地证几何。
- **拖拽断言永远写「位移差值」**：前面的操作会留下非零偏移，写绝对值必假失败（本轮真实踩到，差值恰好对得上）。
  方向断言也要按实际参数推（缩放 5× 时同样 0.1 的窗口平移只让画面坐标动 0.1/5）。
- **每次取点 / 拖拽前重新量舞台 rect**：`clickSelector` 内部会 `scrollIntoView({block:'center'})`，
  视口位置会变（本轮出现「x 对、y 错」—— 页面滚了 249px，水平不动所以只有 y 偏）。
- **越界夹紧用多次小拖动累加**：一次拖 4 个舞台宽会拖出视口，`Input.dispatchMouseEvent` 的落点可能根本不派发
  （表现：偏移停在半路，看着像夹紧没生效）；改成 14 次 ±0.15 舞台宽的小拖动，最终必须精确停在 `±(zoom-1)/2`。
- **双指（最省事的一条路）**：`Input.dispatchTouchEvent`（touchStart 两个点 → 多次 touchMove → touchEnd）
  **真的能用**，headless Chrome 会合成 pointer 事件（本轮实测通过）。但两指落点要在**裁剪框之外的画面**上，
  或者先把裁剪框还原成整幅画面 —— 否则第一根手指会被裁剪框的 `move` 把手接走，变成拖裁剪框（非常像
  「双指缩放坏了」）。真实触摸这条路失败时再退回页面内合成 `PointerEvent`（`pointerId` 用两个不同的值）。
- 面板上的 `data-editor-*` 只读属性是为断言准备的：`data-editor-zoom`（舞台上的归一化值）、
  `data-editor-offset`（`x,y`，4 位小数）、`data-editor-preview-mode`（low|hd）、
  `data-editor-preview-edge`（当前档位的长边上限）、`data-crop-rect`（裁剪框）、
  `[data-edit-view]`（`1.25× 缩放 · 已平移` 文案）。`<img>` 上的 transform 也能读（`__us004cImageCoordAt`
  就是把它反解成画面坐标，用来验证「锚点下的画面不动」）。

### 验证「编辑保护与四层地址」（US-005 起）

- **DOM 只读属性优先于 React fiber 探针**：`host[__reactFiber$…]` 那条链取到的是**这个 DOM 节点所属的那一次
  提交**，setState 之后它可能仍指着**上一次提交**的 fiber——同一段脚本里有些读是新的、有些读是旧的
  （本轮真踩：点「重置」后 fiber 读到的还是重置前的草稿，看着像产品 bug，而 DOM 上的裁剪摘要已经是新的）。
  纪律：草稿 / 已确认这一类**会频繁变的状态**一律断言 DOM 属性；fiber 探针只用于「本来就不变或极少变」
  的字段（`originalUrl` / `cleanUrl` / `framedUrl` / `artworkEdit`），且要配一条 DOM 侧的交叉断言。
- 为此面板新增了三个只读属性（都在 `.artwork-editor` 根节点上，值可跨折叠 / 编辑两态读）：
  `data-shown-crop`（当前展示的那一版裁剪框 `x,y,w,h`，未手动裁剪时是字符串 `none`）、
  `data-shown-zoom`、`data-shown-offset`；另外 `data-edit-crop`（中文摘要，`未手动裁剪（沿用系统识别）` /
  `已还原为完整作品` / `已裁剪 62%×78%`）与 `data-edit-protect`（编辑保护现状徽标）适合做**语义**断言。
- **「回到完整作品」的最强证明是地址相等**：0° 旋转 + 整幅裁剪 + 未超上限时，旋转稿与裁剪稿都是
  **原图地址本身**（不重新编码），所以断言 `cleanUrl === orientedUrl === originalUrl` 比逐像素比对干净得多；
  再配一条**内容**证：夹具做成「深蓝桌面边框（各边 12%）+ 浅色画纸 + 四象限色块」，
  在成品图上按 40×40 网格数「深蓝像素」——系统自动裁剪后是 0，`回到完整作品` 后是 300+，
  `重置` 后回到 0（本轮实测 `0 / 346 / 0`，一次就把三个状态区分开）。
- **确定性重算 ≠ 覆盖**：`重置` 之后流水线会用同一份输入重跑，产物与**基线逐字节相同**（指纹回到基线值）。
  断言要写成「完整画面那一阶段与基线不同 + 重置后回到基线」，写成「派生层指纹必须一直变」会假失败。
- 四层地址清单的断言口径：`[data-artwork-layers]` 上四行 `[data-artwork-layer="originalUrl|…"]`，每行
  `data-layer-ready` / `data-layer-readonly`（只有原图是 `true`）/ `data-layer-fingerprint`；
  指纹要拿 `window.__us026strHash(url)`（页面内重算同一套 FNV）**交叉验证**，别直接信 DOM 里的值。
- 守卫函数要在**真实运行中的应用模块实例**上验：`await import('/src/data/artworkLayers.js')` 然后
  `applyArtworkLayerPatch({originalUrl:'ORIG'},{originalUrl:'HACKED'})` → 值不变 + `blocked:['originalUrl']`。

### 验证「导出 / 下载」类功能（US-008a 起）

- **下载是真的假的，靠打补丁数**：页面内给 `HTMLAnchorElement.prototype.click` 打补丁记录
  `{download, href}`、给 `HTMLCanvasElement.prototype.toBlob` / `toDataURL` 记录
  `{type, quality, width, height}`（`PNG` 的质量参数必须是 `null`）。判据写成
  「`toBlob` 只被调用一次 + 画布尺寸 = 计划尺寸 + `<a download>` 的文件名 = 面板预览的名字」，
  比只断言「有个 toast 说保存成功」强得多 —— 假下载（`console.log('已保存')`）也能弹出 toast。
- **下载到的字节要能读回来**：`downloadArtworkExport` 里的 object URL 是**延后 30s 回收**的，
  所以断言里可以 `await fetch(window.__dw[0].href)` 拿回 blob，再解码比尺寸、采样颜色、
  算 SHA-256（两条路径各自解码比尺寸、采样颜色、算 SHA-256）；「同一份输入重跑两次产物逐字节相同」
  用 `crypto.subtle.digest('SHA-256', bytes)` 比对，比比长度可靠。
- **「没有被缩小」用同一特征在两图里的跨度之比来证**：夹具做成「深蓝桌面 + 米白画纸 + 四象限色块」，
  在画心与导出图里各自找**色块的外接框**，`k = 导出跨度 / 画心跨度` 就是作品在导出图里的实际缩放倍数 ——
  高清档应当 `k ≈ 1`（1:1，既没缩水也没无谓放大），微信档应当 `k < 1`。
  这比「拿裁剪检测器算出来的尺寸去比 bbox」稳：检测器的边界有 ±几像素浮动，而同一个特征在两图里的
  相对跨度不受它影响。
- **UA 分支用 CDP `Emulation.setUserAgentOverride` 真跑**：切到
  `... MicroMessenger/8.0.49 ...`（微信）与 `... iPhone OS 17_5 ...`（iOS Safari）后 reload，
  断言面板标成「长按保存」、点保存后出现提示页、并且 `<a download>` 计数**保持 0**。
- **导出文件要落到磁盘再读回来**（US-103b 起）：`Browser.setDownloadBehavior
  { behavior:'allow', downloadPath }` 指到一个空目录，点导出后轮询目录（文件可能先出现但还没写完，
  所以「非空才返回」），再 `fs.readFileSync` 解析内容（JSON 直接 `JSON.parse`，Markdown 逐字符比对）；
  比用 `prototype.click` 打补丁强 —— 它证明的是「用户真能拿到文件」，补丁只能证明「调过函数」。
- **剪贴板写入要给权限并读回来**（US-103b 起）：`Browser.grantPermissions
  { permissions:['clipboardReadWrite','clipboardSanitizedWrite'], origin }`，点「复制全部」后
  `await navigator.clipboard.readText()` 与导出文件**逐字符比对**（同一次生成里两者必须完全一致 ——
  这也是「导出时间戳按一次生成冻结」这条设计的判据）。
- **「家长端不存在某个入口」要逐页扫，不要只看当前页**（US-103b 起）：登录家长身份后遍历侧边栏每一项，
  每次点击后统计 `[data-review-detail]` / `[data-detail-toggle]` / `[data-detail-section]` 与
  「复制全部」这类按钮的数量，全部为 0 才算通过；再在页面内 `await import('/src/data/…')` 直调那份
  白名单判据（`reviewDetailSurfaceAllowed`）覆盖「家长分享页」这类**还没实现的界面**。
- **headless SwiftShader 下 3D 画廊会打印 `THREE.WebGLRenderer` 的 console error**（US-103b 起）：
  这是环境限制（本机 CDP 启动参数用了 `--disable-gpu`），既有故事同样如此；
  断言「0 console error」时要按 `/WebGL|THREE\./` 过滤并如实打印过滤条数，不要为了好看把整条断言删掉。

### 只读探针读 React state 的两个坑（US-008a 起）

- **同名 key 的两个 hook 别读错**：`media = {artwork, photo}` 与 `batchUploads = {artwork: [], photo: []}`
  的 key 完全一样，遍历 `memoizedState` 取「最后一个匹配」会拿到 `batchUploads`，
  表现是「画心一直为空、装裱永远没完成」。判据要加上**值的类型**：
  `artwork === null || (typeof artwork === 'object' && !Array.isArray(artwork))`。
- **fiber 探针只读它一次写死的 state 是安全的，读会频繁变的对象要谨慎**：本轮的 `media` 在
  装裱两段 effect 里被替换多次，`host[__reactFiber$]` 与 `fiber.alternate` 都可能读到上一次提交
  （两条都读过、都是旧的）；装配上仍然能读到「上传那一刻」的 media。
  要用「最终值」做断言时，一律以 **DOM 上的只读属性**为准（本轮面板把状态落成
  `data-save-image-status/ready/strategy/filename`，断言全读它们）。

### 验证「写回 / 溯源」类功能（US-008b 起）

- 写回面板已把状态落成只读属性：`data-save-image-writeback` 上
  `-status`（最近一次尝试）/ `-slot`（作品位的耐用状态）/ `-fresh` / `-summary` / `-image`
  （成品图地址指纹）/ `-record-id`；溯源逐项是 `[data-writeback-provenance="specSnapshot|sourceUrl|generatedAt|operatorId"]`
  里的 `[data-writeback-provenance-value]`，参数快照整份 JSON 在 `[data-writeback-spec-snapshot]` 里。
- **「点评页 / 画廊用的是写回的那张图」用地址指纹判**：面板的 `-image` 与页面里
  `artworkUrlFingerprint(img.src)`（`await import('/src/data/artworkLayers.js')`，与 app 同一模块实例）
  比对；只比「有没有图」证明不了换图。第三步还落了 `data-review-artwork-source`
  （`writeback` / `framed`）与 `data-review-artwork-fingerprint`，班级合展是
  `[data-mosaic-src="writeback"]` + `[data-mosaic-written-back]` 角标。
- **写回失败注入点选 `HTMLCanvasElement.prototype.toDataURL`**：`composeArtworkExport` 只走
  `loadImage + drawImage + toBlob`，所以打补丁让 `toDataURL` 抛错时**下载仍然成功**、只有写回失败 ——
  这正是 PRD 要的那条降级。断言三件：`<a download>` 计数 +1、失败文案含
  「已保存到本地，未能同步到档案」与「可重试」、重试按钮在；然后恢复补丁点重试，
  断言 synced 且**下载计数没有二次增长**。
- **档案侧的证据读 localStorage**：`xinlehui-feedback-records-v1` 里第一条就是刚归档的记录
  （`framedArtwork.imageUrl` + 四项溯源 + `lessonId/lessonDate`）；画廊那一步用
  `await import('/src/gallery/exhibitionArtworks.js')` 调**同一个** `resolveExhibitionArtworks`，
  断言 `framedBy === 'teacher'`（写回图直接挂）与对照组 `framedBy === 'exhibition'`（老记录行为不变）。
- 跑这类脚本前先 `localStorage.clear()` + reload：上一跑留下的草稿 / 课次 / 归档会让
  「保存前是 idle」这类断言读成上一轮的状态（本轮真踩，第一次跑挂了这一条）。

### 验证「参数面板 = 真实渲染」与跨会话可见（US-011a 起）

- **「预览与真实渲染是同一个函数」要这样证**：脚本自己按**同一份写入口径**推算期望 spec
  （`framingPanelGroupSpec` / `framingPanelFrameGroup` 都是零依赖纯函数，页面里 `await import()` 拿到的是
  与 app 同一个模块实例），再用 `renderFramePreview()` 重画一次，与面板 `<img>` 的 src **比字节**；
  只断言「预览变了」证明不了它用的是同一个函数（换一套画法也会变）。
- **期望 spec 要自己推算，别去 `loadFramingPresets()` 里读**：`FramingSettingsPage` 改的是内存草稿，
  只有点「保存到云端」才落库 —— 保存前从本机镜像读到的是**旧**的那一份（本轮真踩，断言整片变红）。
- **老师端缩略图的底图地址在页面里读不到**（`frameThumbSource = cleanUrl || orientedUrl || originalUrl`，
  DOM 上只有列表缩略图与成品图）。可行做法：脚本开跑前给 `HTMLCanvasElement.prototype.toDataURL` 与
  `URL.createObjectURL` 打补丁，把产出的地址收进数组；再用「四层地址」面板里
  `[data-artwork-layer="cleanUrl"]` 的 `data-layer-fingerprint` 反查 —— `artworkUrlFingerprint` 是零依赖
  纯函数，两边算同一份，命中的那个地址就是 app 用的底图。拿它 + 保存下来的 spec 重算缩略图，
  与卡片 `<img>` 逐字符比对（US-011a 用这一招把老师端缩略图钉死在「真实画心 + 保存的 spec」上）。
- **上传会造两个 blob 地址**：`downsampleImageFile` / `createThumbnail` 各 `createObjectURL` 一个探针地址并
  在 `finally` 里 revoke，所以 `createObjectURL` 记录里**第一个是已失效的探针**（加载会抛
  「作品图片暂时无法读取」），真实的那个在后面 —— 别按「第一个」取。
- **新会话可见性分三层证**：① 数据层 `loadFramingPresets()` 里那条记录的
  `frameSpecRenderKey(spec)` 与保存前逐字符相同；② 刷新后走真实路径 —— 管理端列表里有它、老师端第二步
  「相框样式」网格里有卡片（`data-frame-style-shape` / `data-frame-style-mat` 就是新 spec 的值）；
  ③ 点一下卡片断言 `data-frame-style-active` 与面板 `data-frame-active`。
- 面板自身的窄屏断言要**只量面板**：管理端整页在 390px 下本来就可能横向滚动（列表侧的既有行为），
  所以判据写成 `panel.scrollWidth <= panel.clientWidth + 1` + 面板内控件 ≥44px（复选框的 44px 落在 label 上，
  别把 checkbox 自己拉成方块）。

### 验证「大模型入口」类功能（US-011c 起）

- **替身必须是异步生成器（或透传）**：`for await (const chunk of cloud.llm.chat.completions.create(...))`
  **不会**把 Promise 解包再迭代 —— `async () => (async function*(){...})()` 立刻报
  「return value is not async iterable」（本轮真踩）。两种正确写法：
  ① 纯替身 `function stub(payload) { return streamOf(text); }`（同步返回异步生成器）；
  ② 透传替身 `function passthrough(payload) { window.__calls.push(payload); return original.call(completions, payload); }`
  —— 后者能同时拿到「提示词里到底写了什么」和「真实模型的输出」（本机 LLM 是通的，见上）。
- **「生成结束了」的判据要三条一起看**：`window.__calls.length` 增加 + 回执属性达到目标值 +
  按钮文案不再是「大模型正在设计…」。只等回执属性会读到**上一次**的回执（同一个元素，
  属性早就等于目标值 → 立即为真 → 读到旧的 message/spec）。
- **「生成结果填进了 v2 字段」分三层证**：① 回执里的 `data-frame-suggestion` 值（形状 + 六类位置）；
  ② 面板控件（`[data-frame-param="frame.shape"]` 的 `value`、`[data-overlay-pad="文字水印"]` 的
  `data-overlay-pad-position`）跟着变；③ **落库 spec 的独立重算预览与面板 `<img>` 比字节**
  （`renderFramePreview({spec: loadFramingPresets() 里那条的 spec, …})`，沿 US-011a 的口径）——
  第 ③ 条才证明生成结果真的驱动了成品图那一支渲染。
- **非法输出要断言「三件事同时成立」**：收敛后的控件值 = 默认值（`frame.shape` → `square`）、
  回执点名 `converged` 项（原值 + 生效值）、页面异常数组**长度不变**（`Runtime.exceptionThrown`
  与 `console.error` 都没新增），再加上「保存到云端」仍可点且落库成功。
- **`normalizeFrameSpecV2` 之类的收敛器要单独喂一份「全非法」夹具**：形状 `star`、九宫格
  `middle-centre`、白名单外字体、外链二维码目标、`visible: 'yes'`、越界比例一起上，
  断言逐字段落到默认值且**不抛错** —— 界面上的「一句可读文案」不能替代这一层。

### 验证「同键再归档 / 幂等更新」类功能（US-202 起）

- **「同一条记录被更新」要一次断言五件事**：`id` 不变、`recordKey` 不变、`version` 自增、
  `updatedAt > archivedAt`、`archivedAt` 保持第一次归档的时间；再加「同键只剩一条」（去重不变量）
  与「新正文写进去了、旧正文一个字没剩」（`JSON.stringify(reviews)` 里搜不到旧句子）。
- **云表是「一所机构共享一份工作区」，脚本会互相污染**（US-202 真踩两次）：
  ① 固定课次日期的脚本，第二次跑时同键记录已经躺在云表里 —— 一进第三步按钮就是「保存修改并更新档案」，
  首次归档的断言全红；② 上一轮脚本注入的脏副本也被推上云，后面的「档案里没有那条重复正文」会命中
  **别人**的那条。姿势：**每轮挑一个随机的历史日期**（`2025-MM-DD`）让 `recordKey` 天然唯一，
  注入的副本正文带上本轮标识（例如日期），断言只搜自己的标识。
- **脚本收尾要把自己写进云表的记录摘掉**：`saveRemoteFeedbackRecords(keep)` 自带「列表里没有的
  `record_key` 就删」的孤儿清理 —— 传「本轮全部记录减去我要清的那些」，云端只会删这几条，别人的不动。
  这条同时是「本轮遗留的脏数据自愈」手段（本故事顺手清掉了开发期用固定日期跑出来的那条）。
- **课次实体不在场 = 记录走四段退化键**：脚本点「保存课次」时要先处理同日已有课次 / 未来日期的确认条
  （`.intake-lesson-confirm .text-link`），否则课次不落库、`currentLessonId` 为空，
  记录的业务键会变成 `className::date::studentId::title` —— 断言「recordKey = lessonId::studentId」会红，
  而且这个退化键还能撞上别的轮次（因为它不含课次 id）。
- **按钮文案的判据是 `data-archive-mode` / `data-archive-version`，不是文案本身**：
  文案在「保留修改并更新档案 / 归档并生成分享」之间按会话的 `archived` 切换，
  老脚本（`assert-us108b.mjs`）用 `clickExact('.scene-actions button','归档并生成分享')` 点它 ——
  第一次归档那次点击仍然成立，别把它改成按 `data-archive-mode` 取第一个按钮（会点到「返回智能装裱」）。
