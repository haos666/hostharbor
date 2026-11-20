# adremote-mcp

结论：计划对象和受管变更闭环值得学习；审批信任通道、旧内容重检和崩溃恢复不能直接移植。静态源码确认，未启动 Python 服务或连接远端。

## 可借鉴

- ExecutionPlan 将目标、动作、目的摘要、风险、有效期、回滚说明与执行后验证分开，适合把审批从“一大段命令”改成“可理解的动作摘要 + 原始内容”。[计划字段](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L145)。
- 文件计划记录 original/new SHA-256 与字节数，写前备份、写后读取验证，具备受管修改的基本材料。[文件计划生成](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L2148)，[写后验证](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L435)。
- 计划持久化，状态与批准/执行时间可检查。[PlanStore](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L243)。我们已有加密持久化 operation，不再另造独立 PlanStore。

## 必须避开的设计差异

1. `ssh_approve_plan` 被注册并路由为 MCP 工具，方法按 plan_id 更新批准状态；本轮未见该方法要求独立人工凭证。因此它是工作流步骤，不能直接作为 HostHarbor 的人工批准证明。[工具注册](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L1434)，[工具路由](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L1705)，[批准实现](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L2232)。
2. original_sha256 生成时保存，但指定文件执行路径先写入、后比对 new_sha256，未使用原 hash 阻止外部修改。我们若做受管变更，须在写入前验证文件仍为批准时的版本，失败重新生成预览。[执行路径](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L435)，[实际文件写入](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L761)。这是静态路径观察，未实测并发竞态。
3. 命令执行后才写 executed 状态；指定路径未见 HostHarbor 式派发前持久化意图。不能据此复用其崩溃后重试行为。[执行与状态落盘顺序](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L413)。
4. `_remote_file_sha256` 是读取整文件再本地哈希，不是服务器侧哈希；不能用于解决我们此前大文件读回成本的问题。[文件哈希实现](https://github.com/nqmn/adremote-mcp/blob/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3/ssh_mcp_server.py#L783)。

## HostHarbor 方向

后续可设计受管文本变更：读取基线 → 脱敏 diff 预览 → 桌面审批 → 执行前重检 → 私有备份 → 写入并验证 → 明确恢复入口。任意 Shell 不自动包装成“可回滚”；本轮仅提出方案，不新增工具或远端文件副本。
