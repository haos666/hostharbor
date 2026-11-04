# 同场景比较与现有能力核对

日期：2026-10-26。版本与实测范围见 [baseline](baseline.md)，具体源码链接见各项目报告。

## 哪些已经具备，不再重复造

| 关注点 | HostHarbor 基线 | 本轮决策 |
| --- | --- | --- |
| 多接入、限定机器、Token 及有效期 | 已具备，接入名称不作为身份 | 保留，不换成独立 MCP 凭证库 |
| 异步任务与审批等候 | operation ID、幂等键、3 分钟后交还用户、5 分钟批准期限 | 保留，不换成整条 MCP 请求挂起等待 |
| 配置与授权失效 | 请求快照、profile/策略版本和派发前重检 | 保留；未来短时批准也必须遵循 |
| 文件阶段、限制与超时 | 固定上传目录、大小限制、idle/total、普通/完整校验、临时文件和发布状态 | 补兼容/异常测试，不宣称尚未实现 |
| 记录与回放 | 加密分块输出、相对时序、保留期与清理 | 保留，不换成命令结束后整体写 cast |
| 目标机器与应用上下文 | MCP 范围提示、服务器档案、应用别名/路径/日志来源与版本 | 继续作为产品重点，不因同类存在而删除 |
| 暂停执行 | 当前模式拒绝新执行，操作结果可查询（仍受授权和锁定策略约束） | 强化解释，不新增同义“停止”体系 |
| 防止任务无限增长 | 当前已有 4 个并发、20 个待审批、10000 条记录等上限 | 新建议仅是可选累计预算，不重复现有限制 |

本项目证据：

- [审批与幂等](https://github.com/haos666/hostharbor/blob/18d93337bd401af2d9c3615e206758dfcec7b7f2/src/core/operations/service.ts#L297)
- [版本重检](https://github.com/haos666/hostharbor/blob/18d93337bd401af2d9c3615e206758dfcec7b7f2/src/core/operations/service.ts#L395)
- [下一步引导](https://github.com/haos666/hostharbor/blob/18d93337bd401af2d9c3615e206758dfcec7b7f2/src/core/operations/guidance.ts#L5)
- [文件校验与发布](https://github.com/haos666/hostharbor/blob/18d93337bd401af2d9c3615e206758dfcec7b7f2/src/core/files/service.ts#L156)
- [档案与应用工具契约](https://github.com/haos666/hostharbor/blob/18d93337bd401af2d9c3615e206758dfcec7b7f2/src/shared/mcp-tools.ts#L21)

## 纯函数观察：不能把分类直接当成授权

以下命令从未派发；`allow/approval` 是 HostHarbor 在无自定义规则、无 AI 辅助、cwd=/ 下的策略结果；最后一列只是 ssh-mcp 的分类器标签，**不是其完整授权结果**。`safe` 不代表命令没有副作用。测试使用合成资产，政策差异不直接认定为漏洞。

| 场景 | 输入字符串 | HostHarbor 辅助 | HostHarbor 宽松 | ssh-mcp 类别 |
| --- | --- | --- | --- | --- |
| combined-query | `ss -lntp; echo '---'; docker ps --format '{{.Names}}'; systemctl list-units --type=service --state=running --no-legend --plain` | allow | allow | safe |
| locale-query | `export LC_ALL=C; printf '\n[processes]\n'; ps -eo pid,comm,args` | approval | allow | safe |
| version-path | `/usr/sbin/nginx -V 2>&1` | allow | allow | safe |
| find-query | `find -P '/srv/fixture-app' -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null &#124; head -50` | allow | allow | safe |
| routine-restart | `systemctl restart fixture-app` | approval | allow | safe |
| routine-install | `apt-get install -y jq` | approval | allow | safe |
| remove-file | `rm /srv/fixture-app/stale.log` | approval | approval | safe |
| power | `shutdown -r now` | approval | approval | destructive |
| quoted-keyword | `echo 'rm is a dangerous command'` | allow | allow | read-only |
| dynamic-interpreter | `sh -c 'printf fixture'` | approval | allow | safe |

关键判断：我们“日常运维默认通过、删除及系统电源操作转人工”的宽松策略已经能表达用户偏好。换成第三方整套分类器并不能自动减少误报或提高安全。辅助模式遇到无法重建的 export/解释器组合保留人工，有模式边界；应显示具体原因，而非让用户以为是纯查询也一律高危。

## 场景覆盖状态

| 原计划场景 | 本轮取得的证据 | 仍需验证 |
| --- | --- | --- |
| 首次接入 | Kino 独立库/密码/stdio；我们 Token/Core 的源码差异 | Kino/Termix 实际安装、首次使用、撤销联动 GUI |
| 目标歧义与全部范围 | 我们明确范围/应用索引契约；Kino 指定名称或 ID 匹配路径 | 用同一客户端端到端测歧义回复，不能只根据 instructions 判定可靠 |
| 应用诊断 | 我们应用测试通过；参考项目指定审查路径未确认同等档案模型 | 登录失败合成业务日志的真实智能体链路 |
| 复杂命令 | 十条纯函数观察；ssh-mcp 性质测试通过 | 更多业务命令与不同远端 Shell 的行为 |
| 破坏性命令 | 仅字符串分类及既有策略测试 | 不需要在真实服务器执行 |
| 审批等候 | 我们 guidance/操作测试通过；其他项目等待机制源码 | 不同客户端超时、桌面关闭与重新进入的端到端流程 |
| 提权、撤销与指纹 | 我们现有操作测试子集；对方相关源码 | 跨平台完整原生验收未做 |
| 大文件及中断 | 我们文件测试通过；对方 SFTP/哈希源码 | 相同环境下的大文件、服务器扩展兼容性、断线故障注入 |
| 历史与重启 | 本轮审查状态落盘、预算、cast 差异 | 第三方应用的完整崩溃/重启实测 |
| 中英文与窄窗口 | 读到 Termix titleKey/动作目录及 Kino 旧文案残留 | 本轮没有运行第三方 GUI，不作视觉审美结论 |

## 不跟进的方向

当前不建设持久 Shell、全量终端平台、第三方插件安装、多用户角色、云同步或多机批量 rollout。它们未必不好，但会扩大产品范围，且不直接解决这次已知痛点。
