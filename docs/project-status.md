# Project status

## v0.3.0 release batch — 2026-11-20

Current source version: 0.3.0. This consolidates the pending v0.2.0 PR and inspection dashboards/review, tags/quick filters, shared proxies, key-path import and UI work. English/Chinese README and [upgrade notes](releases/v0.3.0.md) distinguish implemented features from published v0.1.0 downloads. Historical local handoffs remain as evidence; pending GitHub checkboxes are superseded by this batch. Final validation and delivery are recorded below.

## v0.2.0 source batch — 2026-11-04

Version metadata is 0.2.0. This batch includes encrypted asset backups, server inspection plans/reports, channel approval/global controls and output pagination repairs. [Bilingual update and upgrade notes](releases/v0.2.0.md). [Delivery tracking #3](https://github.com/haos666/hostharbor/issues/3).

Local source review covers 79 changed files with no detected credential/instance-identifier matches; 939 checks and macOS arm64 native/bilingual GUI validation are recorded below. Release CI verifies both macOS architectures. Published downloads remain v0.1.0 until a separate installer release; Windows remains deferred. The historical entries below record individual local handoffs, whose queued GitHub work is consolidated into #3.

## macOS 0.1.0

HostHarbor provides local SSH credential management, controlled MCP access, command approval, encrypted operation recording/replay, SFTP single-file transfers, optional AI server dossiers and an editable application context.

The interface supports Follow system, Simplified Chinese and English. Settings are grouped into General, Security, and Data & integrations. The application is licensed under Apache-2.0.

### Release scope

- macOS Apple Silicon (arm64) and Intel (x64).
- Unsigned, non-notarized DMG and ZIP archives, with SHA-256 checksums.
- Windows distribution is deferred; existing source support is not release certification.
- Local checks currently cover 870 tests plus native macOS utility-process, OS protection and synthetic SSH/SFTP tests.
- [Intel and Apple Silicon CI](https://github.com/haos666/hostharbor/actions/runs/40220223437) passed unit, type, build, native utility-process / OS protection / synthetic SSH-SFTP checks and architecture-specific packaging.
- The [release pull request](https://github.com/haos666/hostharbor/pull/2) is merged; [v0.1.0 downloads](https://github.com/haos666/hostharbor/releases/tag/v0.1.0) are published.

### Reference-project research

The first [source-research report](research/reference-projects/README.md) compares five pinned repositories and records three proposed improvements: approval explanations / optional exact temporary grants, policy property tests, and optional activity budgets. Local validation passed 146 reference policy tests and 327 HostHarbor tests. No product code or runtime dependency was changed. Third-party GUI, cross-platform and real-client validation remain separate follow-ups.

### Limits

No automatic updater, resumable file transfers or recursive directory synchronization. Local activity records are not tamper-proof audit records. Arbitrary shell commands are not guaranteed read-only. See [SECURITY.md](../SECURITY.md).

### Selected next work

The user selected [encrypted asset backup / restore, SSH configuration import, and per-server saved actions](personal-workflow-plan.md), in that order. Encrypted backup / restore is implemented locally on `haos-codex/encrypted-backup` (not published in v0.1.0). Settings provide password-encrypted `.hhbackup` export, bounded selection/conflict preview and transactional restore under a new master key. No MCP grants, history or global secrets are exported. [Scope and instructions](backup.md). SSH configuration import and saved actions remain planned. Earlier research proposals about approval options and activity budgets are deferred.

See [CHANGELOG.md](../CHANGELOG.md) for user-facing changes and [execution-plan.md](execution-plan.md) for next steps.

### Backup validation — 2026-10-26

888 tests, type checks and production build passed. macOS arm64 native utility IPC, independent OS-protected restore and restored synthetic SSH authentication/pin passed. Isolated real renderer/preload/Core UI flow covers short passwords, mismatch, wrong-password retry, selected import, duplicate skip and bilingual minimum-window layout; file-dialog selections are test adapters. Physical native picker interaction, Intel and Windows acceptance remain separate. No production credentials were read/exported and no real server was accessed. GitHub Issue/PR updates remain queued for the next release batch.

### Output pagination repair — 2026-10-30

Implemented locally: each read_output response returns at most eight fragments; hasMore reports a saved successor page, outputComplete reports local retained-output exhaustion, and outputAvailability distinguishes cleared recordings. Exact cursor resumes and terminal stop/inspect guidance replace conflicting instructions. Existing numeric cursors remain compatible; original recording limits and per-page authorization remain unchanged. 910 tests, type/build and macOS arm64 native utility/MCP/synthetic SSH multi-page output passed without a second command execution. No production operation output was read, and no previously rejected client call was retried. External Codex auto-review decisions are not verified or guaranteed; clients may need to refresh/reconnect tool metadata. Local package update follows validation; no GitHub push this iteration.

### Server inspections V1 — 2026-11-02

Implemented locally, not in v0.1.0 downloads: versioned editable Markdown per server, offline templates, explicitly consented AI drafts from saved context, and scoped MCP list/get/submit tools. Agent-authored reports freeze the handbook version and authenticated operation evidence, with pagination, latest-result counts and deletion. Current plans join encrypted asset backups; report history is excluded. Existing authorization and approval remain mandatory. Scheduling stays with the external agent; no automatic repair. [Usage](inspections.md).

928 tests, type/build, macOS arm64 native utility/MCP/synthetic SSH evidence flow and isolated bilingual GUI passed. AI protocols use synthetic providers; no real assets or servers were used. Refreshed and restarted the local arm64 package after confirming no unfinished operations; retained a protected pre-upgrade schema13 snapshot and old bundle. Storage is now schema14; rollback requires the matching database snapshot. Intel/Windows acceptance and real provider/client scheduling remain unverified. GitHub Issue/PR updates are queued for the next release batch.

Inspection UI follow-up (2026-11-02): dossier, inspection plan and reports share one tabbed server window. Removed redundant workflow prose; bounded content scrolling and fixed save actions remain. Unsaved changes are guarded when leaving the inspection. 928 checks and isolated macOS bilingual UI flow passed; local arm64 package refreshed.

Lightweight inspection follow-up (2026-11-02): unsaved servers automatically preview a shared default checklist; no template-generation button. AI analysis now recommends future steps, using OS/service/path context without old metrics or evidence. Checklist titles are fixed and AI introductions are removed to prevent duplicated goals; suggestions exceeding six checks are rejected and total text is bounded below 6,000 characters. Five minutes is only a planning scope; mechanical command/time quotas and budget prefaces were removed. Large log input must be bounded before filtering. Existing saved plans are preserved. 930 tests/type/build, macOS arm64 synthetic native inspection/MCP and isolated bilingual UI passed; real provider output quality remains unverified. Local arm64 package refreshed; no GitHub push.

Inspection loading feedback (2026-11-02): centered animated spinner overlay and AI-button spinner replace layout-shifting text. Localized status uses actual request state; no fabricated percentages. 930 checks and delayed synthetic AI native GUI validation passed, including animation, bilingual state and failure cleanup. Updated/restarted the local arm64 package; no real provider request or GitHub push.

Inspection checklist correction (2026-11-02): removed mechanically invented command counts, per-command timeout recommendations, minute splits and goal/budget paragraphs from templates and MCP guidance. Five minutes is a generation-time scope preference only. AI drafts are normalized to actual check sections, dropping duplicated preambles and ignoring fenced fake headings. Log guidance bounds input before filtering; existing byte-bounded file-log tools remain unchanged. 931 tests/type/build passed; native/GUI evidence and local package handoff are tracked in the execution plan. Saved user documents are preserved and require review/replacement if they contain an older generated preface.

### Channel approval policies — 2026-11-04

Implemented locally: each MCP access may inherit the default policy or configure an independent full policy, including modes, risk/exact rules, AI advice and directional file approval. Global pause overrides all channels. Commands, sudo, file metadata/transfers, pre-dispatch rechecks and history share authenticated scope/revision resolution. Changes invalidate only relevant undispatched work; existing Tokens/configuration remain valid. Built-in operations inherit defaults. Existing profiles remain inherited, with no automatic permission changes. [Usage](channel-approval.md).

938 tests/type/build, complete macOS arm64 native Core/SSH/SFTP regressions, two authenticated MCP Tokens with distinct execution outcomes/global pause/reset, and isolated bilingual minimum-window UI passed. No production servers were accessed. Refreshed/restarted the local arm64 package after checking no unfinished work and retaining a protected schema14 database snapshot plus old bundle. Schema15 prevents older binaries from ignoring independent restrictions. Intel/Windows native acceptance for this change remains unverified; GitHub Issue/PR queued for the next release batch.

### Channel detail / global controls correction — 2026-11-04

The channel policy page now shows the full policy immediately, without an inheritance/custom selector. System settings show only require-all-approval and deny-all-execution switches. Global approval covers commands and both file directions while preserving channel denials; global denial has priority. Legacy settings remain as a compatibility seed, with no automatic permission changes. Channel configuration rejects global fields; global override changes invalidate all undispatched scopes and bind a control epoch. 939 tests/type/build and native dual-Token MCP command/file override checks passed; bilingual GUI verifies both channel details and the two-switch system page. No production server access or GitHub push. Final layout verified with switches aligned beside descriptions. Local arm64 package updated and restarted after checking zero unfinished operations and retaining a protected schema15 snapshot/old bundle. Existing access permissions were preserved; Intel/Windows acceptance for this change remains unverified.

### 2026-11-07 · 私钥路径导入

凭证编辑可通过“输入路径”导入隐藏目录内的私钥，支持绝对路径与 `~/`。导入后仍需保存，不长期关联来源文件。Main 检查解锁状态、文件类型/大小与私钥格式；没有新增 MCP 文件读取能力。944 项测试/type/build 与 macOS arm64 隔离 Electron 实际导入保存通过，已刷新本机包；GitHub 留待版本批次。

### 2026-11-07 · Server classification

Implemented reusable server tags with custom names/colors, multiple assignments and tag/untagged filtering. The server list replaces the “Latest test” column while retaining connection testing and real feedback. Tag metadata is encrypted, revision-checked and separate from execution/authorization. Encrypted backups restore remapped assignments and merge same-name tags without overwriting local colors or existing server assignments. MCP exposes tags only for authorized servers. Bilingual UI/docs and 948 tests/type/build pass; isolated macOS arm64 GUI create/assign/rename/recolor/delete/filter flow passes. Full isolated bilingual GUI regression and final screenshot review passed; local arm64 package refreshed and restarted with the prior bundle retained after checking no unfinished operations. No GitHub push.

### 2026-11-07 · Standalone inspections

Inspections is now a sidebar module beneath Servers, with saved Checklists and global Reports tabs. The server robot entry only opens its dossier. New inspections select a server and open a prefilled, editable template; manual saving, optional AI analysis and draft review remain available. Desktop catalog queries add server/tag/result/time/search filters and pagination without changing the existing encrypted plans/report snapshots, MCP approval, or backup data. 949 tests/type/build and isolated macOS arm64 GUI manual-template/AI/MCP-report/detail/unsaved-guard flows passed; final bilingual layout and selection-reset acceptance passed. The local arm64 package was refreshed/restarted after checking no unfinished operations, with the prior bundle retained. No GitHub push.

### 2026-11-07 · Inspection list clarity

Inspection lists identify each checklist by server name; redundant handbook names and the editable name field are hidden while stored names/history remain compatible. Latest result and inspection time occupy separate columns. Bilingual UI/manual-save regression and 949 checks passed; local package handoff recorded in the execution plan. No GitHub push.

### 2026-11-07 · Report preview/export workflow

Saved report text viewing is retained. List/details now offer generated static HTML previews and native-save Markdown, real OOXML Word and HTML exports. Main re-fetches Core data and guards desktop lock revisions; no renderer paths/content/URLs, no AI/SSH calls or report schema changes. HTML is escaped/offline with no scripts or remote resources; preview files and exports remain readable outside the vault. 953 checks plus isolated native three-format/cancel flow, HTML rendering and macOS Word import/Quick Look verification passed with synthetic data. Resource chart/report-V2 work remains planned. Final bilingual GUI acceptance passed; the local arm64 package was refreshed/restarted after checking no unfinished operations, with the previous bundle retained. No GitHub push.

### 2026-11-07 · Inspection finding review

Per-finding desktop ignore/undo stores an encrypted revisioned overlay, preserving original report/evidence and immutable plan snapshots. Effective status/counts propagate to catalogs, details and newly generated dashboard/exports; incomplete checks remain incomplete. Optional AI-reviewed one-line exceptions (50 Unicode characters) append to the current checklist as a new version with atomic optional ignore; no new SSH or authorization changes. Stale/locked/deleted inputs and ambiguous AI results fail without a save. 961 checks plus real isolated loopback SSH/MCP anomaly evidence, local synthetic AI and native UI review/undo/append/export acceptance passed. Final bilingual/single-line/checkbox layout and native regression passed. The local arm64 package was refreshed/restarted after checking no unfinished operations, with the prior bundle retained. No GitHub push.

### 2026-11-07 · Local application duplicates

Archived 29 expanded rollback/test application bundles as ZIP files after CRC and app.asar SHA-256 verification, then removed their expanded copies and individually unregistered obsolete Launch Services entries. Archives and manifest remain under work/app-archives.noindex/. Spotlight now returns only release/mac-arm64/HostHarbor.app; no global application database reset or user data changes. Installed the previously validated exception-prompt fix at this active entry after confirming the app was closed, without launching it. AGENTS.md now requires compressed backups to prevent recurrence. No source-code change or GitHub push.

### 2026-11-08 · Inspection dashboard v1

Implemented a Netdata-inspired offline HTML dashboard with trusted inline brand/SVG gauges, CPU/memory/disk point samples, all-filesystem capacity bars, application/service cards and specialized/custom checks. Legacy reports retain unclassified checks and show missing metrics without inference. Optional per-item section/subject/metrics extend the report contract without defaults or changing old idempotency inputs; Core validates bounded numeric capacities, unique metric identities, sampling times and successful same-item command references. Agent values remain unverified interpretations of evidence. MCP descriptions/get-plan guidance and bilingual catalogs document the extension. Markdown/Word retain resource samples and references; ignores preserve findings and recompute counts. 966 checks/type/build, isolated native UI/browser/export regression and bilingual wide/narrow screenshots pass with synthetic data. Current user app is running, so the active bundle remains untouched; the prepared arm64 build is CRC/ASAR-hash verified in work/app-archives.noindex/HostHarbor-dashboard-20261108-arm64.zip, with its temporary expanded bundle removed. The next closed-app handoff remains pending. No GitHub push or real server access.

### 2026-11-08 · Consistent workspace headings and locked pages

All workspace/settings headings now use PageHeader with common typography and spacing. Private screens render one LockedPage frame instead of inheriting feature-specific sizing, margins or tab height; primary main panes share locked-state sizing/scroll ownership. Agent access retains locked public-tool browsing and accessible tab-panel references. No authentication/MCP/policy changes. 966 checks/type/build pass; isolated native macOS arm64 regression measures identical heading/lock/copy/button geometry across six primary routes in both languages at 1280×800 and 960×650, verifies horizontal centering and tab accessibility, and covers existing settings/form flows. Final screenshots reviewed. The verified prepared ZIP is work/app-archives.noindex/HostHarbor-workspace-layout-20261108-arm64.zip; temporary expanded bundle removed. Current user app was not forcibly restarted or replaced; closed-app handoff and GitHub release batch remain pending.

### 2026-11-08 - Live inspection dashboard installed

Reporting guidance is now returned by MCP initialize, get_inspection_plan (including existing saved plans) and default resource templates. Existing saved plans remain unchanged. A loopback SSH -> authenticated MCP command/output -> report submission -> encrypted persisted report -> production HTML test verifies actual returned measurements; 967 checks/type/build pass. Per user request, normally quit the app, CRC/ASAR-hash verify its rollback ZIP, verify/install the latest bundle at release/mac-arm64/HostHarbor.app and relaunch. Main/renderer/helper processes confirmed running. Installation manifest: work/app-archives.noindex/live-dashboard-install.json. Includes report-first navigation, shared locked layout and dashboard. Temporary expanded bundles removed; user data unchanged, no real server inspection or GitHub push. Reconnect MCP to refresh schemas/instructions and test a new report; historical missing metrics remain missing.

### 2026-11-08 - Report background appearance presets

Added General -> Report appearance with Default dark plus all three generated backgrounds (Mint aurora, Tech grid, Blue nebula), thumbnail selection and automatic persistence. Main owns the strict cosmetic enum store, available while locked; no custom URL/CSS/path or new MCP permissions. Three bundled JPEGs are 75-119 KiB each and embed as data URIs in newly opened/exported HTML with a dark overlay. Content/layout, report storage, metrics, Markdown/Word and previously generated files are unchanged; no fresh inspection is needed to restyle an existing saved report. Printing removes decoration. 969 checks/type/build and isolated macOS native bilingual settings/selection/restart persistence/real HTML-export integration passed. Latest arm64 app installed and restarted after normally quitting and verifying the rollback archive and new ASAR; temporary bundles removed. Manifest: work/app-archives.noindex/report-style-install.json. User data preserved; no real server access or GitHub push.

### 2026-11-08 - Compact unlock dialog

Removed the visible password label from the unlock dialog while retaining the input accessible name. Scoped styles reduce padding to 20px and form/action gaps to 16px; other security forms are unchanged. 969 checks/type/build and native bilingual dialog geometry/accessibility/cancel regression passed; screenshots reviewed. Updated and relaunched the sole local arm64 application entry after verified rollback ZIP/ASAR archival; temporary bundles removed and user data preserved. Manifest: work/app-archives.noindex/unlock-compact-install.json. No GitHub push.

### 2026-11-08 - Four complete report themes installed

Preset IDs now select full report presentations: Default pointer dashboard, Mint aurora side rail/rings, Tech grid compact bars/two work columns, and Blue nebula cover/semicircles/paired sections. All share escaped report fragments and retain facts, counts, ignore reasons, references and plan snapshots. Reports without application classification use a full-width custom section rather than a narrow empty-column layout. Narrow/print styles and missing-data behavior remain explicit. Settings display actual synthetic theme thumbnails in the current UI language, with layout descriptions. Existing saved preference IDs/data are retained; no report schema, MCP, authorization, Markdown or Word changes.

970 checks/type/build and 32 populated/legacy x locale x theme x width render combinations pass with no overflow or missing checks; native settings, thumbnail loading, persisted selection and real Main opening/exporting the same report under all four themes pass. Final screenshots reviewed. Latest arm64 app installed/relaunched after verified compressed rollback; expanded staging removed. Manifest: work/app-archives.noindex/complete-themes-install.json. Reopen an existing report after switching themes; no fresh inspection required. No user server access or GitHub push.


### 2026-11-20 · 接入搜索与共享代理

已实现接入创建/编辑的服务器搜索及当前结果全选/取消；范围外选择保留。服务器页新增“管理代理”（管理标签左侧），支持 SOCKS5 创建/编辑/删除及服务器引用，旧内联配置自动迁移。代理修改原子更新关联服务器配置/版本并失效未完成请求；在用代理禁止删除。凭证种类/使用保护、加密备份及恢复引用重映射同步完成。标签分配使用与管理标签一致的横向紧凑行，中英文同步。

验证：npm run check 975 项通过；原生隔离 Electron 验收通过接入新建/编辑、筛选批选保存、共享代理创建/选择/修改联动、双语界面及标签对齐；回环 SOCKS5/SSH 验证代理更换端口后走新路径。未访问真实服务器。GitHub 更新留待下一次发布批次，追踪见 docs/shared-proxies.md。

本机交付：已更新并启动 release/mac-arm64/HostHarbor.app，旧包 ZIP 完整性与 ASAR 哈希已校验；安装记录 work/app-archives.noindex/shared-proxies-install.json。开发目录仅保留当前可运行应用包。


### 2026-11-20 · 操作提醒不再挤动页面

新增共享 ToastProvider/Toast，统一替换服务器/凭证保存、连接测试、智能体页面错误、巡检保存与导出、通知/安全/自动锁定/AI/备份/日志存储/报告主题等短期操作反馈。巡检列表与文件浏览的页面级操作错误也使用悬浮反馈。右下角顶层提示不占页面布局；成功自动收起，错误需手动关闭；悬停/键盘聚焦暂停计时。活动对话框内可见可操作，源组件卸载清理消息。保留表单校验、任务进度、来源说明等持久信息。

验证：npm run check 975 项通过；隔离 macOS 原生验收验证出现/消失前后表格和工具栏坐标不变、成功自动关闭、错误持续保留、键盘暂停及模态顶层关闭，并回归中英文与应用重启。合成测试数据，无真实服务器访问。GitHub Issue/PR 待下次发布批次，验收范围记录于本段及 execution-plan。

本机交付已完成：安装并启动统一悬浮反馈版本，安装记录 work/app-archives.noindex/floating-feedback-install.json；旧包 ZIP 和 ASAR 哈希验证通过，开发目录仅保留当前应用包。


### 2026-11-20 · 修复标签下拉菜单自动关闭

服务器页面曾依赖每 2 秒更新的 servers 数组重新读取标签，读取期间切换 disabled 导致 macOS 原生下拉菜单关闭。现改为依赖排序后的服务器 ID 集合及解锁代次：后台相同目标轮询不再重新加载标签，真实新增/删除服务器仍刷新分类，标签编辑保存继续立即更新本地列表。未改动授权或执行策略。

回归用例跨两个实际服务器轮询周期检查下拉控件不被禁用、节点和选项不替换、选中值不丢失，并确认服务器轮询继续运行。GitHub Issue/PR 留待下次发布批次。

验收与本机交付：975 项检查通过，原生回归确认两次实时轮询无 disabled 变化、选项/值/节点保持，三阶段验收完成。已安装并启动修复版，安装记录 work/app-archives.noindex/tag-select-install.json；只保留当前展开应用，旧包 ZIP 已校验。


### 2026-11-20 · 自选标签快捷选项卡

服务器页移除“已绑定凭证 / 未绑定”筛选选项卡，保留“全部”并按标签管理中的“加入选项卡”生成最多 4 个标签快捷项（全部不占名额）。完整标签下拉保留，与快捷项共用一个筛选状态，可叠加搜索。管理器展示 0–4 名额，满额后未选项禁用、已选项可取消；改名、换色保留快捷偏好，删除标签同步移除快捷项。长名称省略并提供完整标题，双语与窄窗布局同步处理。

标签元数据新增可选 pinned 字段，旧目录无需迁移；Core schema 校验最多 4 个。加密备份包含偏好，同名标签恢复优先保留本机偏好，新标签只占用剩余快捷名额，分类目录和关联不丢弃。该偏好不影响权限、连接配置或 MCP 返回范围。GitHub Issue/PR 留待发布批次，范围与验收见 execution-plan 及 server-tags.md。

交付验收：978 项检查及隔离原生三阶段回归通过；验证四个上限、第五个禁用、下拉同步、改名偏好保留、跨页面持久化、替换名额、删除以及中英文长名称布局。本机已安装并启动，记录 work/app-archives.noindex/tag-tabs-install.json；旧包 ZIP 与新包 ASAR 校验通过，开发目录仅保留当前展开应用。


### 2026-11-20 · 文件设置紧凑布局与开关几何

文件设置移除 max-width 860px 的居中内卡片，使用文件窗口内容宽度；去除嵌套卡片留白，标题/开关/字段/底部操作统一收紧。目录和校验方式同排，大小与两个超时同排；窄屏自适应。控件高度统一为 36px。上传开关显式清除普通 input 的 padding/margin，固定 38×22 轨道、14×14 圆形滑块及两端对称位置，避免默认 padding 撑高轨道。仅调整展示，传输配置与策略不变。GitHub Issue/PR 随后续发布批次处理。

File settings handoff: 978 checks and isolated bilingual geometry acceptance passed; installed ASAR and rollback ZIP were verified. The layout-only settings fixture supplies synthetic IPC data and performs no transfer/settings save; production host verification remains intact.

### v0.3.0 release candidate validation — 2026-11-20

Tracking: [#5](https://github.com/haos666/hostharbor/issues/5), including the pending v0.2.0 work in #3/#4. Final package/MCP version is 0.3.0. Required check passed 978 tests/types/build; native Core/OS protection/synthetic SSH/SFTP/MCP passed after the version change. Existing isolated bilingual GUI acceptance covers the same implementation; no extra GUI rerun solely for documentation/version metadata. Reviewed 141 public candidate files: no runtime archives, matched credential/instance/local-user-path patterns or broken relative links. This is a scoped pattern review, not a guarantee of detecting every secret. Only public-main ancestry is included. Final arm64/x64 CI and merge links are maintained in #5; published installers remain v0.1.0 until a separate distribution release.
