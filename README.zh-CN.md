<picture>
  <source media="(prefers-color-scheme: dark)" srcset="resources/branding/lockup-light.svg">
  <img src="resources/branding/lockup-dark.svg" alt="HostHarbor" width="420">
</picture>

**在智能体和服务器之间，加一层本机审批、监控与操作记录。**

[English](README.md) · [下载](https://github.com/haos666/hostharbor/releases) · [MCP 接入](docs/mcp.md) · [安全说明](SECURITY.md)

HostHarbor 是一个运行在本机的服务器工作台。面向个人服务器管理：SSH 凭证留在本机，通过独立 MCP 接入开放指定服务器，集中处理命令与文件审批、执行监控、操作回放和日常巡检。

## 为日常服务器工作准备

- **本地管理凭证与连接。** 支持密码、SSH 私钥、主机指纹确认，以及直连、SSH 跳板、SOCKS5。共享 SOCKS5 代理可统一维护、供多台服务器引用；需要提权时可绑定独立 sudo 凭证。私钥支持粘贴、选择文件或直接填写路径，隐藏目录也能导入。
- **给每个智能体独立授权。** 按接入配置服务器范围、有效期和独立 Token，支持搜索服务器和批量选择搜索结果，随时修改或撤销，无需把 SSH 密码或私钥交给智能体。
- **按接入设置审批。** 每个智能体渠道单独配置命令模式、风险规则、AI 建议和上传/下载审批；系统仅保留“全部需要审批”和“拒绝所有执行”两个总开关。
- **看清执行过程和结果。** 审批中心处理待审批、执行中的操作；操作日志支持筛选、分页和文本输出回放，可设置保留时间与本地空间上限。
- **直接传输文件。** 通过 SFTP 浏览远端目录元数据、上传和下载单个文件。固定上传目录、文件大小上限、分阶段进度、独立超时与可选完整读回校验一并提供。
- **让智能体理解服务器。** 可选 AI 调查将系统资源、运行服务和部署信息整理成结构化档案；人工可维护应用别名、部署目录和日志入口，智能体无需每次从头寻找。
- **中英文随时切换。** 默认跟随系统，也可选择简体中文或 English；设置按常规、安全、数据与集成分类。
- **备份服务器资产。** 用独立密码导出 `.hhbackup`，预览依赖和冲突后选择恢复，保留已有数据。[备份说明](docs/backup.md)。
- **按标签分类服务器。** 自定义标签名称和颜色，支持多标签；最多 4 个标签可加入快捷选项卡，完整下拉与搜索保留。[标签说明](docs/server-tags.md) · [共享代理](docs/shared-proxies.md)。
- **独立管理日常巡检。** 巡检模块默认展示报告；新增时选择服务器，直接编辑预填模板，也可由 AI 分析后审阅保存。外部智能体按清单执行，提交带版本和操作引用的结构化结果。[巡检说明](docs/inspections.md)。
- **阅读、可视化与导出报告。** 应用内阅读 Markdown，浏览器打开离线 HTML 仪表盘，支持 Markdown、Word、HTML 导出。已采集的 CPU、内存、磁盘指标在上方，应用与专项检查在下方，提供 4 套完整布局和图表主题。
- **处理巡检例外。** 忽略或恢复本次单项异常，整体状态随之重算；今后同类情况可由 AI 起草 50 字内补充说明，人工确认后追加到巡检清单。

![使用合成资产的服务器工作台](docs/images/servers.png)

## 下载 macOS 版本

本次仅提供 **macOS** 安装包，请按设备架构选择。

| Mac 类型 | 下载 |
| --- | --- |
| Apple Silicon（M 系列） | [arm64 安装包](https://github.com/haos666/hostharbor/releases/download/v0.3.0/HostHarbor-0.3.0-mac-arm64.dmg) |
| Intel | [x64 安装包](https://github.com/haos666/hostharbor/releases/download/v0.3.0/HostHarbor-0.3.0-mac-x64.dmg) |

[发布页](https://github.com/haos666/hostharbor/releases/tag/v0.3.0)同时提供 ZIP 和 SHA-256 校验文件。安装包**尚未完成 Developer ID 签名及公证**，macOS 可能阻止打开。请先核对来源、发布说明和校验值，再自行决定是否通过系统安全设置打开；不要全局关闭 Gatekeeper。

Windows 安装包留到后续版本；仓库保留 Windows 相关代码，不代表本次已经完成 Windows 发布验收。

当前内置服务器调查和诊断采集主要面向 Linux 服务器；其他远端系统尚未完成同等功能验证，提交的命令需要符合远端 Shell。

## 第一次接入智能体

1. 启动应用，设置加锁密码和恢复码，单独妥善保存恢复码。
2. 添加凭证与服务器并绑定，测试连接；首次信任主机前，通过独立渠道核对显示的指纹。
3. 在“智能体接入”创建接入，选定服务器，复制安装配置。
4. 开启本地 MCP 服务，将配置安装到智能体客户端。配置含有接入 Token，请像密码一样保护。
5. 在对应接入里设置命令和文件审批策略；系统设置保留全局审批、全局拒绝两个开关。待处理请求在“审批中心”，已结束记录在“操作日志”。

MCP 使用带认证的本机回环 **Streamable HTTP**。应用和智能体客户端运行在同一台电脑上，服务器是否可达仍取决于本机网络及 VPN。详见 [MCP 接入](docs/mcp.md)、[SSH 路由](docs/ssh-routing.md)及应用内工具列表。

![使用合成数据的审批设置](docs/images/approvals.png)

## 本地存储与可选 AI

凭证和 API Key 在本机加密保存；HostHarbor 不会把 SSH 凭证上传给 AI。部分资产元数据仍以明文保存在本机数据库中。智能体可以读取获授权操作的输出，其中可能包含业务敏感内容。

AI 不是使用前提。可在设置中配置 OpenAI 兼容或 Anthropic 兼容地址、Key 与模型。主动启动服务器调查后，选定并经过过滤的服务器信息会发往该地址；过滤不能保证识别所有敏感信息，请先核对服务提供方和数据范围。详见 [AI 配置](docs/ai-settings.md)及[服务器档案](docs/server-dossier.md)。

## 使用边界

审批规则和 AI 建议不能保证任意 Shell 命令安全或只读。宽松审批是用户主动选择的默认执行授权；命令拥有远端登录账号的权限。断开 SSH 不代表远端进程已停止，结果不确定时不会自动重试。

本地操作记录不是不可篡改的企业审计系统；凭证库也无法防御所有同账号或系统被攻破的情况。本版不含自动更新、断点续传或递归目录同步。连接重要资产前，请阅读 [SECURITY.md](SECURITY.md)。

## v0.3.0 更新

本次整合此前待合并的加密备份、渠道审批，以及独立巡检模块、结构化仪表盘、报告例外处理、共享代理、标签分类和统一交互。[中英文更新与升级说明](docs/releases/v0.3.0.md) · [更新记录](CHANGELOG.md)。

![使用合成数据的离线巡检主题预览](resources/report-previews/aurora.jpg)

**v0.3.0 已提供 macOS M 系列和 Intel 安装包**，[发布页](https://github.com/haos666/hostharbor/releases/tag/v0.3.0)包含 DMG、ZIP 及分架构 SHA-256 校验文件；两种架构均已通过[发布 CI](https://github.com/haos666/hostharbor/actions/runs/44703013580)。

当前存储为 schema15，升级前保留原应用数据副本，以便使用匹配版本回退。旧报告没有指标时保持可读，不会填造数值；外部 MCP 客户端需重新连接刷新工具定义。Windows 安装包继续延期。

## 开发与贡献

需要 Node.js 24.15+（具体范围见 `package.json`）、npm；当前原生发布验收以 macOS 为准。

```sh
npm ci
npm run dev
```

```sh
npm run check
npm run test:native
npm run dist:mac:arm64
# 在 Intel Mac 上构建：
npm run dist:mac:x64
```

[贡献说明](CONTRIBUTING.md) · [架构](docs/architecture.md) · [更新记录](CHANGELOG.md)

## 开源协议

采用 [Apache-2.0](LICENSE)。依赖组件保留各自许可证，见[第三方声明](THIRD_PARTY_NOTICES.md)；许可证不授予 HostHarbor 商标权利。
