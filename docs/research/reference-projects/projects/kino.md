# Kino SSH Manager

基线见 [baseline](../baseline.md)。结论：产品形态接近，值得学习桌面审批和活动预算，但凭证与执行架构不适合直接移植。证据等级以静态源码为主，未运行 Rust/Tauri 应用。

## 值得借鉴

1. **同一次批准可精确复用，并展示来源。** 有 approve_once / approve_session / deny，缓存键由主机 ID、工具与原始参数组成；再次使用仍记为 approved_for_session。用户不必反复批准同一调用。[批准与缓存](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src-tauri/src/mcp.rs#L287)，[缓存键](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src-tauri/src/mcp.rs#L1064)。
2. **审批框呈现倒计时、完整命令和队列数量。** 默认焦点落在拒绝按钮，单次批准与会话批准分开。值得学习信息层次，而非复制样式或文案。[审批组件](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src/components/ApprovalModal.tsx#L1)。
3. **把权限与活动预算分开。** 每小时调用/变更数量、单次主机数、文件大小、并发是不同约束；返回预算恢复时间。持续小操作也会累计，区别于只限制四个并发。[预算结构](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src-tauri/src/mcp_budget.rs#L32)，[启动时加载预算账本](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src-tauri/src/bin/mcp.rs#L64)。
4. **停止执行后仍能解释为什么停止。** Metadata 可继续响应，执行类调用检查 halt；不是把所有查询都变成不可用。[入口控制](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src-tauri/src/mcp.rs#L173)。
5. **受管文件写入前保存旧版本。** 设计有路径维度备份、保留数量、原文件不存在的标记，能区分“恢复旧文件”和“撤销新建”。[备份与恢复](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src-tauri/src/mcp_backup.rs#L33)。这只适用于受管写入，不能承诺任意 Shell 可回滚。

## 不能直接照搬

- **另存 MCP 凭证库。** 它从选定主机生成含 Host 对象的独立加密库，独立 MCP 二进制通过环境变量取得解锁密码。HostHarbor 已由 Core 统一持有凭证、以接入 Token 授权；不应增加一份长期凭证副本和另一套解锁配置。[导出内容](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src-tauri/src/mcp_config.rs#L125)，[解锁与启动](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src-tauri/src/bin/mcp.rs#L25)。
- **会话批准的绑定条件还不够适合我们。** 当前键未包括 cwd、凭证/配置版本、提权身份；本轮读取到的 refresh 路径更换 vault，不清除 approved 集合。不能直接把“直到进程重启”的缓存语义带过来。若复用思路，需 TTL、撤销入口和版本失效。此为指定路径的设计差异，非完整竞态漏洞复现。
- **平台与文案存在不同步。** Unix 有 socket 审批 broker，非 Unix 返回 unsupported_platform；设置组件的 guarded 说明仍写审批未接通。可借鉴能力状态由同一目录生成，避免代码已实现、界面仍旧文案。[Unix 与非 Unix 分支](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src-tauri/src/mcp_approval.rs#L152)，[设置文案](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src/components/McpSettingsPanel.tsx#L27)。
- **MCP cast 不是实时逐块录制。** 指定路径在命令返回后写入命令和整段输出，不能以同名“回放”推断等价于 HostHarbor 的分块加密时间线。[MCP cast 生成](https://github.com/Samarthegde/kino-ssh-manager/blob/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51/src-tauri/src/mcp.rs#L400)。
- 根许可证为 GPL-3.0-only，本轮不移植源码、UI 素材或测试代码。

## 对 HostHarbor 的建议

采用审批信息层次、活动预算、精确短时批准的设计思路；保留自己的统一执行服务、原生密钥保护、异步状态机和加密回放。文件备份与恢复作为后续受管变更功能研究，不先增加整套终端与多机 rollout。
