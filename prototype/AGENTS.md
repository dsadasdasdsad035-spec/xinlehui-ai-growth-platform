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
- **静默的 `try/catch` 会吞掉编程错误**：`catch{/* 渲染失败：保持占位 */}` 这类「容错」写法会让
  `ReferenceError`（拼错的常量 / 没导入的标识符）表现成「功能一直不出效果」，而控制台一个错都没有。
  容错的 catch 至少要把失败原因落到界面或 state 上（US-007 的 `overlayPreviewError`），
  否则调试时只能靠打补丁数 `toDataURL` 才知道「那段代码到底跑没跑」。
- **`pnpm run build` 不检查未定义的标识符**：渲染里引用一个没定义的变量（本轮 `saveImageStrategy`）
  构建完全正常，直到浏览器渲染到那一行才 `ReferenceError`，React 直接把整棵树卸载成白屏。
  这类错误只有「真的把页面点到那一步」才会暴露 —— UI 故事的最小验证是把改动的界面**渲染出来**
  （截图 + 断言），不要只看构建与 Node 断言。
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
