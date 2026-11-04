# Execution plan

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
