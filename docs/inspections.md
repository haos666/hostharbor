# 服务器巡检 / Server inspections

本地开发版功能，尚未随 v0.1.0 下载包发布。入口：**服务器 → 机器人图标 → 巡检 Tab**；同一窗口的 **报告 Tab** 查看历史结果。

## 创建和维护手册

每台服务器有一份当前 Markdown 手册。从未保存时，打开页面自动展示默认清单（不会自动保存或执行），点击“编辑清单”修改并保存。也可点击“AI 分析”，明确同意发送已保存的系统类型、服务及目录和日志入口信息，让 AI 推荐检查内容和步骤。不会为生成手册执行新 SSH 查询，AI 只返回文档。生成内容先与现有内容并排预览，采用后进入编辑，最后点击“确认并保存”；不会自动覆盖人工内容。

默认清单为资源、关键服务、近期错误三项。AI 建议 3–6 项（返回超过 6 项会拒绝），只输出检查项正文，全文控制在 6,000 字符内，不生成报告、不带旧指标结论或旧证据 ID。围绕关键应用组织内容，不扩展成完整资产调查。手工编辑仍支持 1–40 个二级标题（`##`），全文最多 24,000 字符。建议写明检查对象、方法、时间窗口、正常/异常标准和证据要求。例如：

```md
# 日常巡检

## 磁盘空间
- 检查根分区及应用数据分区容量。
- 使用率超过 85% 时报告异常。
- 无法获取时记为未完成；不要删除文件。

## 应用健康
- 通过关联应用 ID 读取当前服务、部署目录和日志入口。
- 明确日志时间范围，检查运行状态及近期错误。
- 日志采样为空不能证明没有故障，不自动重启。
```

可在编辑器中勾选关联应用；模板生成的 `{{application:<UUID>}}` 引用指向本台服务器维护的应用，智能体通过 `find_applications` 读取当前选择器。手册不应重复保存易变化的运行状态、账号密码或 Token。Markdown 仅展示安全文本结构，不解释 HTML、不加载图片或外链。

保存时建立版本和摘要。档案、人工修正、应用或连接配置变化后提示复核；重新确认保存后使用新版本。保留最近 50 个手册版本供进行中的任务提交引用；报告自身也保存使用过的手册快照。手册摘要是版本标识，返回文本可能经过敏感信息过滤，不要求客户端重新计算摘要。

## 外部智能体定时执行

5 分钟仅作为清单生成时的轻量工作量参考，不拆分检查/报告时长，不规定命令数量，也不要求智能体预估每条命令的耗时。手册正文只展示具体检查项。大文件日志应先限制实际读取量（例如按字节取末尾采样），再在采样内过滤；不能先扫描整个文件再截断输出。现有文件日志工具先取末尾 256 KiB，再按行数和关键字筛选。出现异常先报告，不自动扩展调查或修复。

HostHarbor V1 不内置定时器。使用智能体客户端自己的定时任务，任务中明确目标、频率和检查范围：

> 对 {serverSelector} 执行已维护的巡检手册。先解析目标，再获取手册；按现有授权与审批执行。逐项记录结果及操作 ID，不能完成的检查记为未完成。异常仅报告，不自动修复，最后回存巡检报告。

MCP 工具：

| 工具 | 用途 |
| --- | --- |
| `list_inspection_plans` | 当前接入授权范围内的手册元数据；支持 offset/pageSize，默认 20、最多 50 |
| `get_inspection_plan(serverId)` | 取得手册、检查项 ID、手册 revision/digest、服务器版本及当前应用引用；不执行命令 |
| `submit_inspection_report` | 保存结构化报告，不执行命令、编辑手册或扩大权限 |

开始前保存手册版本/摘要、serverRevision 和开始时间。通过原有 `start_command` / `query_application_logs` 等执行，跟踪原 operation ID 并完整分页读取输出。等待审批、拒绝、接入到期、锁定、执行结果未知等边界仍有效。手册内容不能提升权限或覆盖智能体自身规则；不能为了填报告重跑未知请求。

报告必须包含本版本每一个检查项且不重复：

- `normal` 正常：至少关联同接入、同服务器、检查窗口内成功退出的非文件传输操作。
- `abnormal` 异常：至少关联检查窗口内实际派发并已结束的操作；失败退出可作为异常证据。
- `incomplete` 未完成：缺少证据、等待/拒绝审批、连接失败或结果未知；允许没有操作 ID，必须写原因。
- `not_applicable` 不适用：给出具体理由，不暗示检查通过。

报告时间使用 Unix 毫秒；检查窗口最长 24 小时、结束不晚于提交时钟 30 秒容差、最多补交 7 天内结果。服务器版本不匹配会拒绝提交；运行中更新手册时仍使用原版本，不能冒用新版本。档案/应用变化会标记报告需复核。

请求示例（全部为合成占位值，实际使用工具返回的数据）：

```json
{
  "serverId": "11111111-1111-4111-8111-111111111111",
  "serverRevision": 1,
  "planRevision": 1,
  "planDigest": "从 get_inspection_plan 返回值原样取得",
  "requestKey": "synthetic-inspection-report-001",
  "startedAt": 1800000000000,
  "finishedAt": 1800000060000,
  "summary": "合成示例：检查未完成",
  "items": [
    {"checkId": "check-1", "status": "incomplete", "finding": "合成示例：没有取得检查证据", "operationIds": []}
  ]
}
```

相同接入的同一 requestKey 只接受完全相同的报告重试，返回同一个报告 ID。请求体应小于 64 KiB，不提交原始日志或秘密。接入身份从认证信息取得，不相信客户端自行声称的名称。授权撤销、到期、范围移除或凭证库锁定时不能继续读取手册或提交新报告（明确启用锁屏后台 MCP 时沿用既有语义）。

## 查看、删除和备份

巡检手册页展示上次检查时间及异常/未完成数量。报告页提供分页列表，详情按检查项展示结论、发现、操作引用和手册快照。明确标注“智能体提交”：系统核对证据关联，不独立验证结论是否正确或 MD 是否完整执行。一个成功命令不等于业务健康证明。

每台服务器最多保留 500 份未删除报告，不自动删除；桌面可确认删除报告内容。保留去重标识，旧请求不能因此自动重建报告。服务器删除时关联手册/报告一起删除。此记录仍是本地活动资料，不是不可篡改审计。

加密备份包含当前手册及关联应用映射，不包含巡检报告历史。恢复会更新标准应用引用并提示复核，不能把恢复的历史手册当作实时确认。

## English

Development build only, not in the published v0.1.0 installers. Open **Servers → robot icon → Inspection tab**; the adjacent **Reports tab** shows history.

Unsaved servers automatically show a default checklist without saving or executing it. Edit and save it, or use **AI analysis** with explicit consent to send saved OS/service/path/log-selector context for recommended checks and steps. No new SSH collection runs. Review the side-by-side draft, apply/edit and confirm saving separately. Each level-two heading is a check (1–40); maximum document length is 24,000 characters. Application references resolve maintained IDs rather than copying stale selectors. Rendering does not interpret HTML, fetch images or load links.

AI suggestions target 3–6 checks (over 6 rejected) and a final document under 6,000 characters; manual plans retain the 40-check / 24,000-character limit. About five minutes is only a planning scope for lightweight routine checks, not a runtime deadline, minute split or command-count/timeout quota. Return check sections without goals or budget prefaces. For large file logs, bound bytes read before filtering; scanning a whole file then truncating output is not bounded input. The existing file-log tool tails 256 KiB before line/substring filtering. Do not expand an anomaly into an open-ended investigation.

Use an external agent scheduler. Resolve the intended target, call `list_inspection_plans` / `get_inspection_plan`, retain the plan revision/digest, server revision and start time, then use existing command/log tools and approvals. Reports contain every returned check ID, status, concise finding and operation references. `normal` requires successful owned operations on the same server in the inspection window; `abnormal` requires completed dispatched operations. Missing, denied, pending, connection-failed or unknown evidence must remain incomplete. Report anomalies without automatic repair. Reference validation does not independently verify conclusions or checklist completeness.

Submit through `submit_inspection_report`, reusing requestKey only for identical retries. Body limit is 64 KiB; omit raw logs and secrets. Windows are at most 24 hours, completion clock skew at most 30 seconds ahead, and submission at most 7 days later. Server revision mismatch blocks submission. Keep the originally fetched plan version if it changes mid-run; the report saves that snapshot. Recent 50 plan versions remain available. Plans do not grant execution permission or override agent rules.

View last-check counts and paginated reports in the desktop. Reports are explicitly agent-authored, with per-check findings and operation links. Up to 500 undeleted reports per server; deletion removes content while preserving retry identity. Current plans, not report history, are included in encrypted backups; restored references are remapped and require review. HostHarbor provides no built-in scheduler or automatic repair in V1.
