# 研究基线与验证边界

日期：2026-10-26（Asia/Shanghai）。本报告是固定版本的研究，后续项目更新需重新核查。

HostHarbor 基线：`18d93337bd401af2d9c3615e206758dfcec7b7f2`，当前公开版本 0.1.0，Apache-2.0。研究开始时已有未提交的研究计划与主计划修改，均予保留。

## 参考版本

| 项目 | SHA | 默认分支 / 源码版本 | 根许可证证据 |
| --- | --- | --- | --- |
| [Samarthegde/kino-ssh-manager](https://github.com/Samarthegde/kino-ssh-manager/tree/a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51) | `a09024cc3a10e6aa150d27ba3ebc9da2c7b2cf51` | `main` / 0.9.4 | GPL-3.0-only |
| [tufantunc/ssh-mcp](https://github.com/tufantunc/ssh-mcp/tree/f84d92a9c013d63cd75c29853cdb2addb585cd4d) | `f84d92a9c013d63cd75c29853cdb2addb585cd4d` | `main` / 2.22.0 | MIT |
| [nqmn/adremote-mcp](https://github.com/nqmn/adremote-mcp/tree/96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3) | `96cd9bbaf2c39ed171e1f9d35e63aa54998d24d3` | `main` / 未见发布版本字段 | MIT |
| [xiongjiwei/mcp-ssh](https://github.com/xiongjiwei/mcp-ssh/tree/72ee8d4f92bc841bd8ac067d7702adad4ca9bd55) | `72ee8d4f92bc841bd8ac067d7702adad4ca9bd55` | `master` / 未见发布版本字段 | README 声称 MIT；检出树未见独立 LICENSE |
| [Termix-SSH/Termix](https://github.com/Termix-SSH/Termix/tree/73c15f7c58961c9b7b1c59661417527d8fbb825f) | `73c15f7c58961c9b7b1c59661417527d8fbb825f` | `main` / 26.10.5 | Apache-2.0 |

源码以浅克隆保存在用户指定的 `<github-work>/<仓库名>`，没有子模块递归拉取，没有执行安装脚本。克隆不是 HostHarbor 的依赖，也没有复制参考源码进产品。

许可证核查是候选筛选，尚不构成对所有文件和传递依赖的完整授权审查。Kino 的 package.json 与 Cargo.toml 均声明 GPL-3.0-only；本轮只提炼设计与测试场景，不把其源码并入 Apache-2.0 产品。mcp-ssh 尚需补齐授权材料，不列为可直接复制代码的候选。

## 本轮实际执行

平台：本机 macOS Apple Silicon；Node.js 24.15.0；Vitest 5.0.5。

| 验证 | 结果 | 范围与限制 |
| --- | --- | --- |
| 五个仓库的静态源码审查 | 已完成所列路径 | 阅读实现、测试与配置；不是全仓安全审计 |
| ssh-mcp 锁文件安装 | 完成 | `npm ci --ignore-scripts --no-audit --no-fund`，316 个包；未启动服务 |
| ssh-mcp 四个纯策略测试文件 | 146 / 146 通过 | 批准缓存、分类器、参数语法、分类性质；未运行其全套测试或真实 SSH |
| HostHarbor 六个相关测试文件 | 327 / 327 通过 | 宽松/辅助审批、审批等待、操作、文件及应用；使用一次性合成 SSH/SFTP fixture |
| 十条命令的分类观察 | 已记录，观察 harness 通过 | 只调用纯函数，不执行这些命令；分类结果不等同于完整授权决定 |
| Kino / Termix 图形界面、Windows / Linux 原生行为 | 未实测 | 不据此评判 UI 质量、发布包可靠性或跨平台能力 |
| 所有参考项目的生产 SSH / 大文件性能 | 未实测 | 没有连接用户已录入的服务器、读取生产凭证或调用外部 AI |

ssh-mcp 本轮测试文件：

- `test/unit/guard/approval-grants.test.ts`
- `test/unit/policy/classifier.test.ts`
- `test/unit/policy/reader-grammar.test.ts`
- `test/property/classifier.property.test.ts`（默认固定 seed `20261023`）

HostHarbor 本轮测试文件：`tests/permissive-policy.test.ts`、`tests/assisted-policy.test.ts`、`tests/approval-guidance.test.ts`、`tests/files.test.ts`、`tests/operations.test.ts`、`tests/applications.test.ts`。

可复查的本地记录在已忽略的 `work/`：

- `reference-projects-ssh-install.log`、`reference-projects-ssh-tests.log`
- `reference-projects-hostharbor-tests.log`
- `reference-projects/observations.test.ts`、`vitest.config.mjs`、`observations.log`、`command-observations.json`

在 HostHarbor 根目录重放分类观察：`./node_modules/.bin/vitest run --config work/reference-projects/vitest.config.mjs`；参考仓库须仍在本次本地目录。harness 中的命令只有字符串分类用途。原始输出不推送 GitHub；本报告只保存合成结果。

## 证据标注

“源码确认”仅指已读到指定实现；“测试确认”指本轮实际运行通过；“测试存在”不代表运行过。未找到能力写“未确认”，不推断整个项目不存在。源码与文案不一致作为维护风险记录，不扩大为未经复现的漏洞结论。

## Issue 查阅边界

本轮读取 ssh-mcp #91、#172 的公开维护讨论；Kino #22 页面抓取失败，相关行为仅依据固定 SHA 的 refresh 实现，未独立验证该 Issue 讨论。没有向任何参考仓库发消息、提交 Issue 或 PR。
