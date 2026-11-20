# Execution plan

## v0.3.0 GitHub batch — 2026-11-20

- [x] Consolidate the pending v0.2.0 public-history commit and completed local features.
- [x] Bump app/MCP metadata to 0.3.0; refresh bilingual README, changelog, screenshots and upgrade notes.
- [x] Final checks, native candidate validation and public-content review (978 checks, native Core/OS/SSH/SFTP/MCP; 141 public files reviewed).
- [x] Push branch, pass both macOS CI jobs and merge to main.
- [x] Reconcile superseded PR/tracking and record delivery links.

v0.3.0 macOS DMG/ZIP/checksum assets are published after dual-architecture CI; Windows remains deferred. All older pending GitHub-delivery entries are consolidated here.

## v0.2.0 batch delivery — 2026-11-04

This source batch consolidates the previously queued backup, inspection, channel policy and pagination work. Tracking and CI outcome: [GitHub #3](https://github.com/haos666/hostharbor/issues/3). [Bilingual update notes](releases/v0.2.0.md). The historical per-feature push/PR checkboxes below are superseded by this batch.

- [x] Set package/package-lock version 0.2.0; update both READMEs, changelog and schema15 upgrade guidance.
- [x] Review the staged source tree for runtime archives, secrets and instance identifiers; only the public-history release branch is eligible for upload.
- [x] Local 939 tests/type/build and macOS arm64 native/bilingual GUI validation; CI revalidates arm64 and x64.
- Delivery branch: `haos-codex/release-0.2.0`, based only on public main. Push/PR and platform results are recorded in #3.
- Installer publication is separate; current download links remain v0.1.0. No Windows installer is included.

## Current macOS release

- [x] Local SSH credential vault, host verification and direct / jump host / SOCKS5 routes.
- [x] Scoped local MCP access, configurable command and directional file approval, operation history and replay.
- [x] SFTP single-file transfer progress, verification, limits and timeout handling.
- [x] Optional AI configuration, structured server investigation and editable application context.
- [x] Configurable system / Chinese / English UI and grouped settings.
- [x] Apache-2.0, bilingual product documentation, synthetic screenshots, brand assets and third-party notices.
- [x] macOS-only release workflow for Intel and Apple Silicon, with architecture-specific native checks.
- [x] Both architecture-specific CI jobs passed and the [release pull request](https://github.com/haos666/hostharbor/pull/2) was merged.
- [x] Published [v0.1.0](https://github.com/haos666/hostharbor/releases/tag/v0.1.0) with validated Intel / Apple Silicon DMG, ZIP and SHA-256 checksums.

## Next release

- [x] **服务器巡检 V1（2026-11-02）**：版本化 Markdown、离线模板与显式同意的 AI 草稿、三个 MCP 手册/报告工具、证据归属和幂等、报告分页/详情及最近结果、中英文与备份手册支持。928 项测试/type/build、macOS arm64 原生合成 SSH/MCP 和隔离 UI 通过。本机包已替换并重启，升级前保留 schema13 数据库及旧包。未访问真实服务器；调度由外部智能体负责，不自动修复。详见 [计划](inspection-plan.md) 和 [用法](inspections.md)。
- [ ] 下次版本批量更新巡检 GitHub Issue/PR；真实 AI 草稿质量、外部定时任务和 Intel 新增功能验收待验证。

- [x] **Output pagination repair (2026-10-30):** implemented locally with per-call eight-chunk wording, hasMore/outputComplete/outputAvailability, exact read_output resume cursors and numeric-cursor compatibility. 910 tests/type/build plus macOS arm64 native utility/MCP/synthetic SSH paging passed; no extra command execution. Cleared recordings, running empty pages, approval handoff and per-page authorization covered. No production output read or previously rejected call retried. External Codex auto-review acceptance still unverified; client tool cache may need reconnect. GitHub issue/PR queued for release batch.
- [x] Refreshed local arm64 app package and restarted after checking zero unfinished operations. Packaged Core contains the new flags/tool metadata; reopening MCP and refreshing the external client's tool cache remain user actions. Previous bundle retained locally for rollback.
- [x] **P1 encrypted backup / restore:** implemented and validated locally on 2026-10-26; not yet published. [Usage and limits](backup.md). 888 tests plus macOS arm64 native Core/OS protection/synthetic SSH restore and isolated bilingual UI flow passed. Native picker results injected in UI automation.
- [x] Local packaged-app handoff: rebuilt the arm64 application, replaced the old `release/mac-arm64/HostHarbor.app`, restarted it and verified the visible Settings → Data & integrations → Backup & restore entry. User vault remained locked; no production backup was created. Future local feature handoffs must refresh the runnable package when the user tests that package.
- [ ] **P2 SSH config import**, then **P3 per-server saved actions**: [personal workflow plan](personal-workflow-plan.md).
- [ ] Batch backup GitHub Issue/PR with scope, exclusions, preview/transaction guarantees and validation evidence; no routine push this turn.
- [ ] Windows native GUI, credential protection, notifications and packaged execution acceptance before distributing Windows installers.
- [ ] Developer ID signing / notarization when a distribution identity is available.
- [ ] Broader external MCP client acceptance and documented compatibility.

## Reference-project research

- [x] [First source-research report](research/reference-projects/README.md) completed locally on 2026-10-26: five pinned repositories, 146 reference policy tests and 327 HostHarbor tests passed; comparison and three implementation proposals recorded.
- Research proposals R1–R3 are deferred following the user's personal-product priorities. Third-party GUI, cross-platform, real-client and large-file benchmarks remain unverified. See [research plan](reference-project-research-plan.md); the selected delivery plan is [personal workflows](personal-workflow-plan.md).

Start new feature and internationalization branches from current `origin/main`. Keep their work in separate branches or worktrees, merge verified changes deliberately, and update this plan at meaningful handoffs. Use synthetic assets in all shared examples. Batch GitHub delivery rather than triggering CI for each routine iteration.

### 巡检界面整理 — 2026-11-02

服务器窗口统一为“服务器档案 / 巡检 / 报告”三个 Tab，取消巡检嵌套窗口，移除外部执行流程及底部重复说明；固定内容滚动区和编辑保存栏。切换到档案或关闭窗口时保留未保存确认。沿用现有中英文资源。928 项测试/type/build 与 macOS arm64 隔离 UI（含未保存确认、报告列表和双语最小窗口）通过；本机包同步更新，不推送 GitHub。

### 轻量巡检清单 — 2026-11-02

- [x] 未保存时直接展示共享默认模板，移除生成模板按钮；AI 按钮统一为“AI 分析”。
- [x] AI 只推荐未来检查步骤，不输出历史复核报告；缩减发送上下文，固定清单标题与精简正文，最多 6 项 / 最终 6000 字符内、最多 3 个优先服务。
- [x] 5 分钟仅约束清单生成时的轻量工作范围；不设置命令数/耗时配额。大日志先限制输入读取再筛选，受阻未完成如实记录。
- [x] 930 项测试/type/build、macOS arm64 隔离双语 UI 自动模板/编辑/保存及未保存保护通过；原生与本机包更新见项目状态，不推送 GitHub。

### 巡检加载反馈 — 2026-11-02

用内容区居中旋转动画和 AI 按钮转圈替换占位文字；覆盖层不参与文档布局，异步操作结束或失败后清除，支持减少动态效果设置。同步中英文短状态，沿用真实请求状态，不显示虚假百分比。验证完成后刷新本机 arm64 包，GitHub 批量交付。

验收：930 项检查/type/build 与 macOS arm64 延迟合成 AI 原生 UI 通过；确认旋转动画、中英文覆盖层、等待中禁用操作、失败后恢复；未发送真实 AI 请求。已更新并重启本机包。

### 移除巡检机械配额与重复目标 — 2026-11-02

去掉模板、AI 提示、MCP 指导中的 10 命令/15 秒/4+1 分钟配额与目标段；AI 仅返回检查项，Core 截取真实二级检查标题之后的正文，忽略代码围栏中的伪标题，避免追加目标造成重复。5 分钟保留为生成轻量清单的设计参考。文件日志强调先按字节采样再过滤，沿用现有尾部 256 KiB 工具，不修改通用执行超时。已保存用户清单不自动改写。GitHub 继续批量交付。

验收：931 项测试/type/build、macOS arm64 原生合成巡检/MCP 和隔离双语 UI 通过；检查项正文无目标段，重复目标回归覆盖双协议。已刷新并重启本机应用包；旧清单需重新分析并确认保存，不自动修改用户文档。

### 按接入渠道设置审批 — 2026-11-04（方案讨论，未实施）

现状核对：命令、文件审批共用全局 ApprovalPolicy；精确规则已有 profileIds 筛选，但接入没有独立完整策略。建议复用现有认证 profileId/Token 为渠道边界，旧接入继承默认策略；接入编辑可选择继承或独立审批模式/风险规则/文件方向审批/AI 建议。系统保留默认策略与全局暂停，新操作受全局暂停优先限制。渠道修改仅使自身未派发任务失效，默认修改影响继承渠道；执行前重查有效策略来源和版本，历史保留渠道与策略快照。同 Token 的多个客户端共用一个渠道，不能通过客户端自报名称区分。软件内置身份首版沿用默认策略。待用户确定方案，不变更运行时策略，不推送 GitHub。

### 渠道审批实施 — 2026-11-04

- [x] 加密的渠道完整策略/继承标记、递增修订与乐观锁；固定解锁桌面 IPC，不增加 MCP 管理权限。
- [x] 命令、提权、AI 建议、文件上传/下载和目录浏览使用统一有效策略；派发前核对来源和修订。
- [x] 渠道修改仅作废自身未派发请求；默认修改只影响继承渠道；全局暂停/恢复影响所有渠道；保留已派发操作生命周期。
- [x] 接入列表及编辑窗口入口、默认/独立标识、双语配置与日志来源；Token/安装配置保持有效。
- [x] schema15 防止旧程序忽略渠道限制；记录本机升级前副本要求。详见 [渠道审批](channel-approval.md)。
- [x] 938 项测试/type/build、macOS arm64 原生双 Token MCP/SSH 隔离、全局暂停/恢复继承、完整合成 SSH/SFTP 回归、隔离中英文配置界面通过。已确认本机无未完成操作，保留受限权限 schema14 数据库副本与旧包，刷新并重启本机包（schema15）。未连接真实服务器或修改已有渠道权限。
- [ ] GitHub 批量任务：渠道审批 Issue/PR，包含身份隔离、默认继承、全局暂停、策略变更影响范围和原生验证证据；此次不推送。

### 渠道完整配置 / 系统全局开关 — 2026-11-04

- [x] 渠道直接显示完整配置，移除继承/独立选择和列表继承标识；系统设置仅显示“全部需要审批 / 拒绝所有执行”。
- [x] 全局force仅将渠道自动放行转人工，保留渠道拒绝；全局deny优先。命令和上传/下载同步生效，控制变更覆盖全部未派发请求。
- [x] 兼容旧配置和旧暂停状态，渠道接口不能写入全局开关；更新双语、MCP说明及使用文档。
- [x] 939 项测试/type/build、macOS arm64 原生双渠道命令/文件的全局覆盖、拒绝优先、完整回归和隔离中英文 GUI 均通过。已确认无未完成任务，保留权限受限的更新前数据库与旧包，更新并重启本机程序。未访问真实服务器，未更改已有接入配置。
- [ ] 渠道完整配置/全局开关的 GitHub Issue/PR 随版本批量交付，本次不推送。

### 私钥文件路径导入 — 2026-11-07

- [x] 凭证 SSH Key 表单新增“输入路径 / Enter path”，支持绝对路径和 `~/.ssh/...`，保留选择文件和粘贴方式；导入后由用户确认保存。
- [x] Main 固定 IPC 验证主窗口和解锁状态，导入前后检查锁修订；仅读取不超过 256 KiB 的普通私钥文件，支持加密私钥稍后填写口令；不向 MCP 开放本机文件读取。
- [x] 944 项测试、type/build、macOS arm64 隔离 Electron 路径导入/错误反馈/实际保存和双语界面回归通过；合成密钥未截图。检查本机无未完成操作后刷新本地包并重启。
- [ ] 随下一批版本交付 GitHub Issue/PR，本次不推送。

### 服务器标签分类 — 2026-11-07

- [x] “最近测试”列改为标签，保留连接测试与实际结果反馈。新增全局标签管理、名称/自定义颜色、多标签绑定、未分类/指定标签筛选；列表最多显示前两个及剩余数，避免长标签撑高表格。
- [x] Core 加密保存分类目录和关联，修订校验防覆盖；不修改服务器连接修订、不取消运行操作。无 schema 升级，旧数据默认为无标签。
- [x] 加密备份导出/恢复与预览变更检查；恢复重映射新服务器、合并同名标签并保留本机颜色和已有绑定。MCP 仅返回授权服务器的标签，并支持标签查询。
- [x] 同步中英文与工具说明；948 项测试/type/build 通过，macOS arm64 隔离 Electron 实际新建/绑定/改名/改色/删除和筛选验证通过。
- [x] 完整隔离双语 GUI 回归通过并复查最终标签筛选栏/弹窗布局；本机无未完成操作，已保留旧包、刷新 arm64 应用并重启。
- [ ] GitHub Issue/PR 随后续版本批量交付，本次不推送。

### 标签工具栏位置微调 — 2026-11-07

- [x] 标签筛选与管理缩至 32px，移动到搜索左侧，与搜索框同排对齐；删除独立一行的标签控件与冗余图标。窄窗口保留整组换行，避免挤压溢出。
- [x] 948 项测试/type/build 通过。初次原生界面检查遇到同时构建导致输出目录刷新，已改为顺序运行。
- [x] 隔离中英文完整 GUI 回归通过，复查最小窗口同排对齐/无溢出截图；本机无未完成操作，保留旧包后刷新并重启应用。不推送 GitHub。

### 标签管理移至页头 — 2026-11-07

- [x] “管理标签”移至“添加服务器”左侧，两个按钮使用等宽等高布局；筛选区域只保留状态/标签筛选及搜索。
- [x] 948 项测试/type/build 及隔离中英文 GUI 回归通过，复查两按钮等宽等高；本机无未完成操作，保留旧包后更新并重启。不推送 GitHub。

### 巡检独立模块 — 2026-11-07

- [x] 左侧“服务器”下新增“巡检”，两个 Tab 为“巡检清单 / 巡检报告”；移除服务器机器人弹窗中的巡检入口，只保留档案。
- [x] 新增选择服务器，未保存时默认模板直接填入编辑表单；保留手工编辑、应用关联、AI 分析与草稿比较/确认，不要求 AI 成功才能创建。
- [x] 已保存清单列表含服务器/标签/版本/更新时间/最近结果；全局报告支持服务器、标签、结果、时间、搜索及分页，详情保留原检查项和证据快照、删除功能。
- [x] Core 解锁桌面目录查询；不修改既有清单和报告数据，不改变 MCP/审批/备份结构，无 schema 迁移。
- [x] 949 项测试/type/build 及 macOS arm64 隔离完整 GUI 流程通过：独立菜单、默认模板保存、AI 等待/失败、合成 MCP 提交、报告列表/详情、双语布局和未保存提醒。
- [x] 最终中英文清单/编辑/报告界面复查、完整隔离 GUI 回归及筛选切换清除旧目标验证通过；本机无未完成操作，保留旧包后刷新 arm64 应用并重启。
- [ ] GitHub Issue/PR 随下一版本批量交付，本次不推送。

### 巡检清单列精简 — 2026-11-07

- [x] 清单/报告列表以服务器名称为主，移除无辨识度的手册名称；编辑器移除名称输入和重复标题，内部名称字段及历史报告保持兼容。
- [x] 清单“最近巡检”拆分为状态、时间两列；未执行显示“尚未巡检 / —”，保留报告版本提示。中英文同步。
- [x] 949 项测试/type/build、隔离中英文 UI 手动保存与未保存保护通过；复查六列布局并缩短窄列标题避免拆字。本机无未完成操作，保留旧包后更新并重启。不推送 GitHub。

### 巡检独立版本列 — 2026-11-07

- [x] 清单和报告列表均新增“版本”字段；去掉服务器名和状态下方的版本副行。清单版本与检查项数量同一格、同一行显示。
- [x] 表头与版本不拆行，窄窗口仅在表格区域横向滚动，不挤压菜单或整页布局。
- [x] 949 项测试/type/build、隔离中英文完整 GUI 回归通过，已复查版本同行、表格区域滚动。本机无未完成操作，保留旧包后刷新并重启。不推送 GitHub。

### 报告仪表盘与多格式导出流程 — 2026-11-07

- [x] 保留应用内文字详情；报告列表/详情增加外部 HTML 仪表盘与导出入口，格式可选 Markdown、真实 Word (.docx)、HTML。
- [x] Main 固定 IPC 从 Core 重读保存报告，不信任 Renderer 内容/路径/URL；原生保存框、取消处理、锁修订复查、原子写入和私有预览缓存。HTML 转义与 CSP、离线无脚本；没有新增 AI/SSH/MCP 行为。
- [x] 基础 HTML 只展示原报告实际结果和计数；不编造 CPU/内存指标，提示词、三块结构化报告与图表样式后续再定。
- [x] 953 项测试/type/build、隔离原生 Main/Core 导出三格式/取消、浏览器 HTML 实际渲染、Word textutil 导入及 Quick Look 排版复查通过，使用合成报告。
- [x] 最终完整隔离双语 GUI 和报告操作布局回归通过；本机无未完成操作，保留旧包后刷新并重启 arm64 应用。
- [ ] GitHub 随大版本批量交付，不推送本次迭代。

### 巡检异常忽略与 AI 补充说明 — 2026-11-07

- [x] 异常项支持忽略本次、撤销；加密独立处理记录与修订号，不改原始证据/请求哈希/快照。总状态、清单/报告筛选及计数、详情、重新生成的 HTML/MD/Word 同步。
- [x] “今后同类情况”显式 AI 同意、仅选中检查/发现/原因、单行最多50字、预览可修改；确认后追加末尾普通说明并生成新清单版本，可同时忽略本次，事务失败回滚。
- [x] 锁定、过期草稿、并发修订、原报告删除、字符上限、模糊例外与双协议保护；不执行新 SSH，不新增自动匹配规则/审批权限。删除报告/服务器清理处理记录。
- [x] 961 项测试/type/build 通过；真实隔离 loopback SSH/MCP 异常证据、忽略/重算/撤销、合成本机 AI 草稿/追加、报告快照保留和处理后导出原生 GUI 流程通过；未接触真实服务器或用户 AI。
- [x] 最终双语布局、单行编辑和勾选对齐复查及完整原生回归通过；本机无未完成操作，保留旧包后刷新并重启 arm64 程序。
- [ ] GitHub 留待下一版本批量交付，本次不推送。

### 例外说明去除重复核验要求 — 2026-11-07

- [x] 移除例外生成提示中强制“检查和留证”的要求；短说明只写具体对象、已确认预期条件和不作为异常，不再追加重复核验/调查/确认任务。
- [x] 仍限制对象与条件范围，原巡检执行、证据关联和审批机制不变；不改写已有清单或已经生成的用户草稿。
- [x] 961 项测试/type/build 通过，已打包 work/local-exception-prompt-build/mac-arm64/HostHarbor.app；未访问真实 AI/服务器。
- [x] 初次保留未保存预览；后续确认应用已关闭，将已准备的新包切换到正式入口，未自动启动。新提示下次启动生效，旧文字不自动改写。

### 清理 macOS 重复应用入口 — 2026-11-07

- [x] 确认重复图标源于开发目录中保留的展开 `.app` 备份/测试包；当前无 HostHarbor 进程运行。
- [x] 将已准备的例外提示词修正版放到唯一运行入口 `release/mac-arm64/HostHarbor.app`；不启动应用，不改用户凭证和数据。
- [x] 29 份副本逐包 ditto 压缩，通过 unzip CRC 与 app.asar SHA-256 校验后移除展开副本并逐项注销 Launch Services。ZIP 和 manifest 保存在 `work/app-archives.noindex/2026-11-07T13-21-41-939Z/`；work 下无残留展开应用，mdfind 复查仅剩正式入口。
- [x] 更新 AGENTS.md：以后回滚版本只留压缩归档，不再堆积可被系统索引的 `.app` 备份；不重置系统全局数据库。

### 巡检报告优先 — 2026-11-08

- [x] 巡检模块将报告放在首个页签，进入模块默认查询并展示报告；清单移至第二个页签，中英文共用顺序。
- [x] npm run check 通过（类型、测试、构建）；未替换或重启本机安装包，本次不推送 GitHub。

### 巡检 HTML 仪表盘第一版 — 2026-11-08

- [x] Netdata 风格离线资源仪表、应用服务卡片、专项自定义检查；官方品牌、双语、窄屏与打印样式。单项卡片占满行，证据/清单可折叠。
- [x] 报告可选结构化指标与分类，数值/采样时间/操作证据校验；旧报告兼容，缺失显示未采集；MD/Word 同步输出指标。
- [x] 更新 MCP 报告规范与文档；966 项测试/type/build、隔离 macOS 全 GUI 查看/三格式导出回归、中英文1440/600宽度渲染和折叠/导航验收通过。未访问真实服务器，不推送 GitHub。
- [x] 新 arm64 包已保存为 `work/app-archives.noindex/HostHarbor-dashboard-20261108-arm64.zip`，CRC/app.asar SHA-256 校验通过，临时展开包已移除。
- [x] 2026-11-08: installed this feature in the latest active bundle and relaunched at the user request.

### 页面标题与锁定态模板统一 — 2026-11-08

- [x] 抽出 PageHeader 和 LockedPage，统一所有工作区标题字号/间距及私有页面锁定入口；保留锁定时工具目录浏览和系统设置入口。
- [x] 966 项测试/type/build；macOS arm64 隔离原生逐六菜单、中英文、1280×800/960×650量测标题/锁/说明/按钮位置与字号一致且锁水平居中。公共工具页签及无障碍面板关联、设置页与全部既有功能原生回归通过。
- [x] arm64 新包保存在 `work/app-archives.noindex/HostHarbor-workspace-layout-20261108-arm64.zip`；CRC/app.asar SHA-256 校验通过，移除临时展开包，包含此前仪表盘与报告优先改动。
- [x] 2026-11-08: normally quit, verified the rollback archive, installed the latest shared-layout bundle and relaunched. GitHub delivery remains batched.

### 真实巡检链路接入与本机安装 — 2026-11-08

- [x] MCP 初始化、读取清单与默认模板明确结构化报告指标；旧清单执行也能获取新规范，不改用户已保存说明。
- [x] Normally quit the app; verified rollback ZIP CRC/ASAR hash and installed ASAR markers/hash; installed release/mac-arm64/HostHarbor.app and relaunched. Installation manifest and backup are in work/app-archives.noindex; temporary bundles removed and user data preserved. No real inspection executed.
- [x] Normally quit the app; verified rollback ZIP CRC/ASAR hash and installed ASAR markers/hash; installed release/mac-arm64/HostHarbor.app and relaunched. Installation manifest and backup are in work/app-archives.noindex; temporary bundles removed and user data preserved. No real inspection executed.

### Inspection metric rejection diagnosis - 2026-11-08

- [x] Verified running application path/start time and installed ASAR hash match the latest installation; compiled schema contains section/metrics under items[], not report root.
- [ ] Client-reported "Unexpected parameter section/metrics" still needs raw tool arguments/error or refreshed client schema to distinguish cached client validation from wrong nesting. No server/schema compatibility changes or report resubmission performed on the basis of a screenshot alone.

### Dashboard background exploration - 2026-11-08

- [x] Source-level checks on the latest user-provided HTML: structured gauges present, no horizontal overflow at 1440px. Full visual audit blocked by browser file: URL policy; no bypass or real-report image upload.
- [x] Generated three standalone background concepts with built-in imagegen; saved assets and review limits in work/ui-background-review/. No production code changes.
- [ ] User selection and later background integration; complete visual review requires an accessible screenshot/capture route.

### Report background presets - 2026-11-08

- [x] General settings: report appearance with all three selected image backgrounds and original dark option; persistent cosmetic preference, bilingual UI.
- [x] Main applies trusted bundled artwork to newly opened/exported offline HTML only; report data/layout and MD/Word remain unchanged. Three optimized trusted JPEG assets are embedded; print output suppresses backgrounds.
- [x] 969 checks/type/build pass. Isolated native settings selection for all presets, bilingual minimum-window layouts, persistence across app restart and Main-generated HTML with selected embedded background verified. No production report or server data used.
- [x] Normally quit and installed the new arm64 bundle at the sole active entry after rollback ZIP/CRC/ASAR verification; temporary bundles removed. Installation manifest: work/app-archives.noindex/report-style-install.json. GitHub delivery remains batched.

### Compact unlock prompt - 2026-11-08

- [x] Remove the visible password label only from the unlock dialog, retain an accessible input name and tighten padding/form/action spacing.
- [x] 969 checks/type/build pass. Native bilingual verification confirms no visible password label, retained accessible name, 20px dialog padding and 16px form/action gaps; screenshots reviewed. Updated/relaunched the local arm64 app after verified rollback archival; manifest: work/app-archives.noindex/unlock-compact-install.json. No GitHub push.

### Four complete report themes - 2026-11-08

- [x] Preserve existing preset IDs; implement default pointer dashboard, aurora sidebar/rings, grid compact bars/two-column console and nebula cover/semicircles with identical report content and operations.
- [x] Settings now show actual synthetic-rendered complete theme thumbnails and descriptions in Chinese/English; offline report documentation updated. Existing enum/preference IDs retained.
- [x] 970 checks/type/build pass, including all-theme finding/review/metric/evidence retention. Populated and legacy reports render without overflow in both locales at 1440/600 widths (32 combinations); navigation/evidence controls checked. Print-specific layout/colors updated. Isolated native settings previews/persistence and real Main open/export of the same report in all themes pass.
- [x] Verified rollback ZIP and installed latest arm64 app at the sole active entry, preserving user data/selection; restarted and removed temporary expanded bundle. Manifest: work/app-archives.noindex/complete-themes-install.json. No GitHub push.


## 2026-11-20 本地迭代：接入选择、共享代理与标签布局
- [x] 智能体接入新增服务器搜索、搜索结果全选/取消，保留范围外选择。
- [x] SOCKS5 代理集中管理与引用；兼容旧配置，修改时原子更新关联服务器并失效审批/连接；被引用时禁止删除。
- [x] 标签选择紧凑横向行；同步中英文与备份兼容。
- [x] npm run check、macOS 本地验收；GitHub Issue/PR 随下次发布批次更新。

本次本机交付已完成：975 项检查、隔离原生三阶段验收通过；更新并启动 macOS arm64 应用，旧包 ZIP 回滚验证通过。未推送 GitHub，Issue/PR 随后续发布批次处理。


## 2026-11-20 · 统一悬浮操作反馈
- [x] 页面/设置/巡检的短期操作结果迁移到共享悬浮提示，显示和消失均不占页面布局。
- [x] 成功自动收起、错误手动关闭、悬停/键盘阅读暂停倒计时；对话框内外可见可操作。
- [x] 保留输入校验和持久状态说明；双语与原生布局不跳动验收，更新本机应用。
- GitHub Issue/PR 待下一次发布批次。

悬浮反馈交付：975 项自动检查、隔离原生三阶段验收通过；macOS arm64 应用已更新启动，回滚 ZIP 完整性与新包哈希校验通过。未推送 GitHub。


## 2026-11-20 · 标签下拉菜单被后台刷新关闭
- 根因：每 2 秒服务器轮询产生新数组，触发标签重新加载并短暂 disabled，原生下拉菜单随之关闭。
- [x] 标签刷新依赖改为服务器 ID 集合及锁定代次，保留真实新增/删除后的同步。
- [x] 原生回归跨越轮询周期验证控件不被禁用、菜单选择保持可用；npm run check；更新本机应用。
- GitHub Issue/PR 随后续发布批次处理。

标签下拉修复交付完成：975 项检查及原生三阶段回归通过，本机应用已更新启动；安装记录 work/app-archives.noindex/tag-select-install.json，旧包 ZIP 与新包 ASAR 验证通过。


## 2026-11-20 · 自选标签快捷选项卡
- [x] 移除服务器页凭证绑定状态选项卡，改为“全部”及最多 4 个自选标签，与完整下拉共用筛选状态。
- [x] 标签管理“加入选项卡”，Core 校验最多 4 个；兼容旧目录，备份恢复保留本机偏好且不突破上限。
- [x] 双语、长名称/窄窗口、保存/移除/上下限/备份验收及本机应用更新。
- GitHub Issue/PR 待后续发布批次。

快捷标签选项卡本机交付完成：978 项检查、原生三阶段验收通过；已更新启动应用，ZIP 回滚及 ASAR 验证通过。未推送 GitHub。


## 2026-11-20 · 文件设置紧凑布局与开关修复
- [x] 移除文件设置居中窄卡片和多余嵌套留白；目录/校验一行，大小/超时三列，调整输入高度和间距。
- [x] 开关显式清除普通输入框 padding，固定 38×22 轨道与 14×14 圆点，核验两种状态。
- [x] 中英文及窗口宽度的原生截图验收，npm run check，更新本机应用；GitHub 随发布批次处理。

交付收尾改进：UI 小改动完成规定 check 与相关原生验收后，直接交付；不因无关检查继续追加整套回归。原生测试命令的运行中/完成、打包完成/已安装分别报告，退出后及时完成安装与最终回复。

2026-11-20 release candidate: [tracking #5](https://github.com/haos666/hostharbor/issues/5) consolidates #3/#4 and all pending local GitHub handoffs. Final app/MCP version 0.3.0; 978 checks plus native Core validation passed. Public-content/link scan passed; only origin/main ancestry will be pushed. Next: release PR, both macOS CI jobs, then merge. Installer publication remains separate.

2026-11-20 delivery complete: [PR #6](https://github.com/haos666/hostharbor/pull/6) merged (f463cd78e18711761e1ecdb016be8a996bccb4c8); v0.3.0 tag and [macOS release](https://github.com/haos666/hostharbor/releases/tag/v0.3.0) published. [Both CI jobs](https://github.com/haos666/hostharbor/actions/runs/44703013580) passed; downloaded installer checksums match CI manifests. Six release assets, bilingual README/downloads, changelog and upgrade notes are synchronized. PR #4 is superseded and all earlier pending GitHub delivery is consolidated into #5. Final docs-only follow-up records outcomes without repeating runtime tests/CI.
