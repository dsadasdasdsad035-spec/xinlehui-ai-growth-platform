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
