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

## 老师端「课后反馈」第一步（班级 / 学员 / 课程 / 课次推荐）

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
- **进入下一步的门槛放在 `go()` 里**（`requireAttendedParticipant()`），不要只把按钮 `disabled`：
  disabled 的按钮没法说明「为什么不能走」。全部缺课/名单为空时要给出具体原因，并且**保留「保存课次」这条独立动作**
  （老师可以先存草稿）。到场口径 = 出席 + 补课，只有「一位到场的都没有」才拦。
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
| 参与下一步校验 | 是（`hasUploadedArtwork`） | **否** |
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
  `const [lastSessionMedia]=useState(()=>savedDraft()?.media||null)`。
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

## 容易踩的坑

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
- 旧数据兼容的写法：`normalize<X>(raw)` 永不抛错，缺字段补默认值，**无法映射的原始对象挂到 `legacy` 字段上原样保留**，
  宁可多带一个字段也不要丢数据；不要为了让旧数据「看起来完整」而编造日期或序号。

## 验证技巧（没有测试框架时的替代方案）

data 模块是零依赖的纯 ESM，可以直接用 Node 跑：`node --experimental-loader <扩展名补全 loader> <脚本>`
（Node 不会解析 Vite 风格的无扩展名相对导入，需要一个小 loader 把 `'../cloud'` 补成 `'../cloud.js'`）。
service 模块也能在 Node 里测：`cloud.database` 是**可写属性**，导入后替换成内存表替身
（builder 需要 `then()` 才能被 `await`）即可覆盖「唯一性 / 状态机 / 云端失败回落」这些关键分支。
写内存表替身时 `delete()` 必须**真的**把命中行从表里移除：只实现 `select` / `upsert`、让 `delete` 返回
一个空 thenable，会让「删除课程/课次」的断言假通过。

### 需要「真的选择文件」时的浏览器验证（US-406a 起）

`browser_*` 工具**没有 setInputFiles 能力**，`<input type=file>` 的上传路径（班级反馈的作品/照片）无法用它验证。
可行做法：用系统 Chrome 起一个**自己控制的 headless 实例**（`--remote-debugging-port=<高位端口>`），
用 Node 22+ 内置的全局 `WebSocket` 手写最小 CDP 客户端（无需装 puppeteer/playwright）：

- 选文件：`DOM.getDocument` → `DOM.querySelector` 拿 nodeId → `DOM.setFileInputFiles({nodeId, files:[绝对路径]})`，
  它会真实派发 `input` / `change`，React 的 `onChange` 正常触发（这是 Playwright 内部用的同一条通道）。
  隐藏的 `hidden` input 也能直接设。
- 点击：`Input.dispatchMouseEvent`（mousePressed + mouseReleased，坐标取 `getBoundingClientRect()` 中心）。
  `el.click()` 也行，但前者更接近真实用户。
- `<input type=date>` 的键盘输入：**段顺序是 locale 决定的**，本机 zh-CN 下是 YYYY/MM/DD；
  点最左侧是**年份段**，而且年份段会一直吞数字、**不会**在 4 位后自动跳到月份 —— 必须每段输入后发一次
  `ArrowRight`（`2026` → Right → `08` → Right → `04` 得到 `2026-08-04`）。用 `Backspace` 清空会把年份打乱成
  `80420-02-06` 这种脏值，别用。
- 这套脚本放在 `/tmp` 即可（不进仓库）：注意本机 `node`（v20）**没有全局 WebSocket**，
  要用 `~/.nvm/versions/node/v22.23.2/bin/node` 跑。
- 记完 console：`Runtime.enable` + `Log.enable`，`net::ERR_CONNECTION_REFUSED` 是本机云端不通的既有现象，
  `404` 多为 favicon / 未接的后端接口，不代表功能坏了。
