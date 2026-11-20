# 渠道审批与全局控制 / Channel policies and global controls

本地开发版功能，尚未随 v0.1.0 发布。

## 每个接入配置完整策略

在 **智能体接入 → 对应接入 → 审批策略** 打开；接入编辑窗口也有入口。直接显示审批模式、文件上传/下载审批、风险规则、精确规则和 AI 建议，不再需要先选择继承或独立配置。

选择全部审批、辅助审批、宽松审批或暂停，修改后只影响该接入的未派发请求。开启宽松模式的授权边界保持原有确认流程；已经沿用宽松模式的旧接入，仅改变文件等配置不重复要求确认相同命令权限。配置修改无需更换 Token、地址或安装配置。

旧接入首次打开沿用此前有效配置，修改后按渠道保存，不自动放宽已有权限。历史上的默认策略保留为兼容初值，不再在设置中开放详细编辑。软件内置操作沿用兼容初值并服从全局控制。

## 系统设置只保留两个开关

- **全部需要审批**：所有接入的自动放行命令、上传和下载改为人工确认；渠道已经拒绝的操作继续拒绝，不被放宽。
- **拒绝所有执行**：拒绝所有接入的新命令和文件传输，优先于全部审批；不主动停止已派发任务。

两个都关闭时按渠道配置执行；两个都开启时拒绝优先。全局控制不扩大服务器授权、主机信任、固定上传目录或文件大小限制。目录元数据浏览不因强制审批而生成任务；全局拒绝仍阻止新目录浏览。

## 身份、已有操作和存储

渠道绑定认证后的 profileId 和 Token；多个客户端共用一个 Token 时也共用策略。客户端自报名称不能决定权限。

渠道修改仅作废自身尚未派发的待审批/排队/连接中请求，停止相关浏览与 AI 审批建议。全局开关变化影响全部接入的未派发请求，关闭开关不重新批准或重跑旧请求。执行前重检策略来源、修订和全局控制世代；历史保存决策快照。已派发任务不因审批设置变化主动断开，远端未知结果不能自动重试。

渠道策略使用绑定 profileId 的 AAD 加密保存并保留递增修订。恢复继承的旧 API 只作兼容，不提供界面入口。全局开关保存在加密全局策略中；变更事务内递增控制世代。仅解锁的桌面固定 IPC 可以编辑，没有新增 MCP 管理工具。

schema15 阻止更旧程序忽略渠道限制；全局策略新增字段也不会被旧版严格校验器当作普通策略忽略。回退需配套升级前数据库。加密资产备份继续排除授权、Token 和策略。任意 Shell 仍具有原始执行能力，宽松风险检测不构成只读保证。

## English

Open **Agent access → Approval policy** for an access profile, also available from its editor. The full mode, upload/download approval, risk/exact rules and AI advice appear immediately. There is no inheritance/custom selector. Existing access retains its previous effective configuration until edited; the legacy default is an internal compatibility seed, no longer a full settings page.

System settings contain only **Require approval for all** and **Deny all execution**. Required approval turns auto-allowed commands/uploads/downloads into manual confirmation while preserving channel denials. Deny overrides both channel permissions and global approval. Both off use channel configuration; both on deny new execution. Dispatched tasks are not canceled by these settings. Directory metadata browsing needs no approval task, but global deny blocks it.

Identity follows the authenticated Token/profileId. Policy changes need no new Token or installation configuration. Channel edits invalidate only their undispatched requests; global controls affect all channels. Pre-dispatch checks and history bind scope, revisions and global-control epoch. Old requests are never auto-approved or rerun. Server/file/host restrictions remain mandatory.

Policies are encrypted and writable only through unlocked desktop IPC, with no new MCP administration tools. Legacy inheritance remains an internal compatibility API. Schema15 and strict policy parsing prevent older binaries silently ignoring restrictions. Rollback requires the matching database snapshot. Asset backups exclude profiles, Tokens and policies.
