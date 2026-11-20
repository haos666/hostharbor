# ssh-mcp（tufantunc）

结论：本轮最有工程借鉴价值的是批准缓存的失效方式、性质测试、结构化拒绝原因及传输阶段控制；不能把整套分类器当作更安全、误报更少的替代品。固定版本及测试范围见 [baseline](../baseline.md)。

## 已确认的可借鉴内容

1. **短时批准与策略代数绑定。** ApprovalGrants 按 profile、完整命令文本、分类做 SHA-256 键，TTL 到期或 generation 变化立即失效，默认可关闭。管线在等待期间发生 reload 时重新评估。缓存模块相关测试本轮通过。[缓存实现](https://github.com/tufantunc/ssh-mcp/blob/f84d92a9c013d63cd75c29853cdb2addb585cd4d/src/guard/approval-grants.ts#L35)，[批准与版本复查](https://github.com/tufantunc/ssh-mcp/blob/f84d92a9c013d63cd75c29853cdb2addb585cd4d/src/tools/pipeline.ts#L101)。
2. **拒绝原因可以细到具体单词。** 分类输出区分 grammar 与 metacharacter 拒绝，便于解释是哪个参数/结构导致不能自动处理，而非统一“高风险”。[拒绝解释](https://github.com/tufantunc/ssh-mcp/blob/f84d92a9c013d63cd75c29853cdb2addb585cd4d/src/policy/classifier.ts#L3220)。我们已有 queryAnalysis，宜补齐结构化原因与 UI/MCP 一致展示，不另起第二套审批引擎。
3. **用性质测试覆盖变体。** 测试包括组合不降级、包裹命令不降级、大小写/可执行文件后缀变体、深层替换有界、结果确定性，并固定 seed 可复现。本轮含此文件共 146 项测试通过。[性质测试](https://github.com/tufantunc/ssh-mcp/blob/f84d92a9c013d63cd75c29853cdb2addb585cd4d/test/property/classifier.property.test.ts#L27)，[种子策略](https://github.com/tufantunc/ssh-mcp/blob/f84d92a9c013d63cd75c29853cdb2addb585cd4d/test/property/fc-seed.ts#L1)。
4. **审批不可用与用户拒绝分开。** elicitation 不支持、超时、传输失败等有独立说明，避免用户从未收到提示却被记成拒绝。[客户端审批处理](https://github.com/tufantunc/ssh-mcp/blob/f84d92a9c013d63cd75c29853cdb2addb585cd4d/src/guard/elicitation.ts#L43)。我们仍保留桌面审批，不把客户端 elicitation 变成必需条件。
5. **总工作量与瞬时速率分开。** CommandQuota 是 profile 维度滑动窗口，拒绝不继续扣预算，返回 retryAt。[配额实现](https://github.com/tufantunc/ssh-mcp/blob/f84d92a9c013d63cd75c29853cdb2addb585cd4d/src/policy/quota.ts#L23)。注意该模块账本为进程内 Map，不能照搬为跨重启额度承诺。
6. **SFTP 以无进展时间控制步骤。** 临时文件发布分别处理 overwrite 与 no-overwrite，部分服务器不支持所需扩展时明确失败。[传输边界](https://github.com/tufantunc/ssh-mcp/blob/f84d92a9c013d63cd75c29853cdb2addb585cd4d/src/ssh/sftp.ts#L54)，[发布策略](https://github.com/tufantunc/ssh-mcp/blob/f84d92a9c013d63cd75c29853cdb2addb585cd4d/src/ssh/sftp.ts#L374)。HostHarbor 已有 idle/total、临时文件与校验进度，应补兼容测试，不能列为全新待开发功能。
7. **只有未派发的 channel 打开可以有限重试。** 代码明确不重试已发送命令，也不在断线后自动重建状态。[重试边界](https://github.com/tufantunc/ssh-mcp/blob/f84d92a9c013d63cd75c29853cdb2addb585cd4d/src/ssh/channel-retry.ts#L17)。该概念可补入未来嵌入式 SSH 兼容性测试；本轮未实测 Dropbear。

## 本轮观察与限制

十条合成命令只调用 classifyCommand 和 HostHarbor evaluatePolicy，不执行命令。分类标签与审批 action 是不同层次，不作直接胜负比较。

- 组合查询、带绝对路径的版本查询在 ssh-mcp 中为 safe，不能解读为“已证明只读”。
- `rm /srv/fixture-app/stale.log` 在该版本分类为 safe，HostHarbor 宽松模式要求审批。两者产品策略不同，不能直接替换分类器来满足“删除转人工”的用户偏好。
- HostHarbor 辅助模式对 locale export 组合要求人工，宽松模式允许；说明需按模式解释，而非继续把辅助模式无限放宽。
- ssh-mcp 仍以整条 MCP 请求等待客户端审批，本轮未验证真实客户端超时；不替换我们已有异步 operation ID / get_operation。
- 146 个测试不是其全量测试，更不是安全性证明。未运行其 SSH、真实客户端或 GUI 验收。

## 复用决定

MIT 使小型通用模块成为进一步授权核查的候选，但缓存键缺少本项目要求的 cwd、提权及资产版本等条件；暂不整段复制。优先独立实现适配设计，测试场景按合成 fixture 重写。若以后直接引入代码，另记文件 SHA、版权和许可证，并更新第三方声明。

## 相关维护记录交叉检查

- [Issue #91](https://github.com/tufantunc/ssh-mcp/issues/91)：早期 CLI 快速启动路径的角色/分组默认组合导致 sudo 被拒；维护者确认回归。这是历史问题，不能据此声称当前版本仍故障。对我们有用的教训是：接入默认值也要端到端验收，并在审批中显示实际采用的策略来源，不能只展示一个模糊角色名。
- [Issue #172](https://github.com/tufantunc/ssh-mcp/issues/172)：静态扫描建议与可利用漏洞明确分开，人工核实误报后再提出加固。我们的报告同样将静态观察、测试确认和未验证风险分开，不把审查路径上的疑点直接发布为漏洞结论。
