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
- **US-002a 起内置 4 套预设的渲染结果有意改变**（它们显式带 `lighting`，本故事开始绘制）。
  持久的向后兼容承诺是：**v1 平面 spec**、以及**没有显式 `frame.lighting` 的 v2 spec**，渲染逐像素不变。
  复核兼容性时不要拿「内置预设」当 v1 基准（US-016 的 4 套预设 v1↔v2 逐像素断言自本故事起失效是预期的）。
- **v2 的叠加元素（`watermark.*` / `signature` / `date` / 印章）默认 `visible: false`**：v1 本来不画
  任何叠加元素，默认 true 会让「迁移过来的老模板」凭空多出 `{机构名}` 水印。是否绘制由面板显式开启
  （US-003a/003b/003c），**不要为了省事把默认值改成 true**。
- `src/data/framingPresets.js` 的内置预设已是 v2，且**故意省略 watermark / signature / date 三组**
  （字段可选，缺省即 v1 行为）。该 data 模块保持**零依赖**（不 import services），以便 Node 直跑断言。
- 状态机：`art.rotateDeg` 只允许 **0 / 90**（模板级）；任意角度微调属于单幅作品的 `artworkEdit`（US-004），
  不进模板。`date.source` = `lesson | today | manual`，`date.format` 三种白名单；所有位置是九宫格枚举
  + `offsetX/offsetY` 比例偏移（-0.5~0.5）；尺寸与位置一律用「相对画布短边的比例」。

### 叠加元素的定位与变量替换（US-003a）

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
  「不裁剪」时白角可见）。这是 PRD 开放问题 Q6 里说的「边缘补白」问题，留待 US-004b 的裁剪框处理。

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
