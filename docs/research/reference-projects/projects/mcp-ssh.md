# mcp-ssh（xiongjiwei）

结论：结构化调用目的、目录与日志关联值得学习；持久 Shell 与宽泛命令名白名单不适合替换 HostHarbor 当前执行方式。仅静态审查，未运行 Go 测试或启动服务。

## 可借鉴

- Request 把 command、description、verified cwd、目标与 digest 分开，日志事件能关联请求、审批和执行。对我们有用的是保留“用户目标/调用目的”与实际命令两个字段，目的来自智能体时明确标为未验证说明。[请求结构](https://github.com/xiongjiwei/mcp-ssh/blob/72ee8d4f92bc841bd8ac067d7702adad4ca9bd55/session/request.go#L5)。
- webhook pending / decision 有明确超时和连接取消清理；值得补充多请求排队、过期提示的场景。[等待与清理](https://github.com/xiongjiwei/mcp-ssh/blob/72ee8d4f92bc841bd8ac067d7702adad4ca9bd55/approval/webhook.go#L37)。

## 不采用

- 每个会话持续保留 Shell，执行通过 stdin 附加 EXIT_CODE 和 sentinel，再从文本解析结束。状态串联、输出解析、超时后同步成本都不同于我们独立 exec channel。[执行包装](https://github.com/xiongjiwei/mcp-ssh/blob/72ee8d4f92bc841bd8ac067d7702adad4ca9bd55/session/session.go#L77)，[结果解析](https://github.com/xiongjiwei/mcp-ssh/blob/72ee8d4f92bc841bd8ac067d7702adad4ca9bd55/session/session.go#L106)。当前不改为持久交互式 Shell。
- Gate 从每段命令的首个单词判断白名单，遇到特定替换符号才拒绝；它不是完整 Shell 分析或只读保证。[白名单判断](https://github.com/xiongjiwei/mcp-ssh/blob/72ee8d4f92bc841bd8ac067d7702adad4ca9bd55/approval/gate.go#L47)。我们不采用这套自动放行算法。
- webhook 可配置超时放行，stdio 无审批通道时直接使用该配置。不能沿用为我们的超时处理。[超时行为](https://github.com/xiongjiwei/mcp-ssh/blob/72ee8d4f92bc841bd8ac067d7702adad4ca9bd55/approval/webhook.go#L39)。
- README 末尾写 MIT，但当前检出树未见独立 LICENSE/COPYING/NOTICE。进一步复制代码前需补齐授权依据；本轮只做设计比较，不认定代码可直接复用。
