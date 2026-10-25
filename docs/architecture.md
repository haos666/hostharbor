# HostHarbor 架构方案

状态：已确定首版方向；功能实现进度以 project-status.md 和 GitHub Issues 为准。
决策日期：2026-10-19（Asia/Shanghai）。

## 显示语言与配置资源（国际化独立分支，2026-10-26）

`src/shared/locales/zh-CN.json` 是消息键基准，`en.json` 使用相同键。`languages.json` 登记语言代码和自称名称；Vite 自动收集资源，因此添加语言仅需增加同键 JSON 文件并登记该配置，无需修改页面。消息键一经使用保持稳定，翻译内容可独立修改。共享显示运行时仅提供消息插值、语言订阅及错误码到显示文案的映射，无 Node/Electron/Core 依赖。

Main 在 `language-settings.json` 原子保存 `{locale: "system" | 支持的语言代码}`；缺省 system，旧版显式中文/英文配置原样保留。Main 从 Electron 的系统首选语言列表按顺序做完整代码、再同语种匹配，无匹配使用 English；启动和窗口重新聚焦时重新解析。读取损坏时临时采用系统语言且设置页报告存储错误，不覆盖原文件。此文件无凭证或密钥，固定的 language:get/save IPC 仅允许受信主窗口主框架，锁定时可用，返回 `{preference, locale}` 分别表示选择和实际显示语言。Main 更新托盘与后续通知，通过 language:changed 通知 Renderer 更新文案、选择项及 document.lang，日期与数字采用实际 locale。偏好失败不会触发解锁、重试远端命令或改变审批。

共享工具/风险/字段目录通过 Renderer 的静态资源适配器显示翻译，不修改协议工具名、输入字段、示例参数、Core 错误码或保存内容。用户输入、输出、AI 报告/理由、历史策略快照和证据保持原文；运行状态标签及错误码解释按显示语言呈现。语言偏好不是抵御同用户进程的安全边界。

## 目标与范围

个人安装的 macOS / Windows 桌面客户端，保管用户有权使用的 SSH 服务器凭证，并通过本机 MCP 提供授权访问、命令监控、审计和回放。网络与 VPN 使用本机已有连接；不代管 VPN。

首版不建设企业权限平台，不接数据库、不做云同步、远程 MCP、目录同步/递归文件夹传输、任意转发或持久交互式 Shell；单文件SFTP扩展见ADR-032。

## ADR-001：Electron 与 TypeScript

采用 Electron + React + TypeScript；electron-vite 构建，electron-builder 打包，npm lockfile 固定实际依赖。UI 后续按需引入 Tailwind/shadcn，终端按需引入 xterm.js；初始化不安装未使用的重依赖。

理由：UI、MCP、SSH 共用语言与类型，减少跨语言调试、打包和通信成本。接受 Electron 的体积和内存代价。Tauri 使用系统 WebView，包更小，但需要 Rust 侧实现或额外服务；目前不为包体积引入第二套业务语言。

## ADR-002：进程与模块

Renderer：React 界面、凭证录入表单、审批、操作视图。禁用 Node 集成，启用上下文隔离、沙箱和 CSP，只通过限定 preload 方法通信。

Main：窗口、托盘、单实例、应用锁定、OS 密钥保护，以及 utilityProcess 的启动/退出。所有 IPC 校验发送者与数据结构。

Core：服务器、授权、SSH、操作状态机、MCP、审计、录制与 SQLite。前端重载不应中断核心任务。业务模块通过接口依赖 OS 适配器，不直接依赖 Electron。

数据路径：UI / MCP adapter → operation service → grant/approval checks → durable execution intent → SSH adapter → recording/audit → UI / bounded MCP output。

进程隔离不是针对同用户本机攻击的完整沙箱。Core 不自动重启并重新执行已有命令。

## ADR-003：凭证库

随机 256-bit 主密钥由 Electron safeStorage 保护；凭证采用 AES-256-GCM 独立随机 nonce 加密，AAD 绑定记录 ID 与格式版本。密钥、Token、明文不写普通日志、环境变量或命令行参数。解密能力只对必要业务内部开放。

主进程通过私有 IPC 将解锁所需材料交给 Core，锁定时清理引用并尽可能清零 Buffer；不承诺 JavaScript 内存绝对擦除。macOS Keychain 与 Windows DPAPI 的安全语义不同，同用户攻击不在绝对保障范围。主密钥恢复、迁移和备份方案必须在凭证库任务中明确，不能承诺复制本地数据库即可换机恢复。

Server 与 Credential 独立，Server 引用 Credential。导入私钥后保存密文，不将明文复制到临时文件。首版支持密码、OpenSSH 私钥及其口令；SSH Agent 和交互式 MFA 后续评估。

KnownHost 独立保存主机公钥与指纹；初次使用人工确认，变化立即阻止。ssh2 必须配置 hostVerifier。关闭 Agent forwarding 和未实现的 subsystem；仅允许为已保存目标建立内部跳板通道（ADR-011），不开放通用端口转发。

## ADR-004：本机 MCP

官方 TypeScript SDK，Streamable HTTP，首版仅回环地址监听。每个 ClientProfile 独立高熵 Token，服务端保存其哈希以验证请求。Token 作为本机访问能力，发放时明确授权服务器；名称与 clientInfo 仅展示用途，不能作为认证依据。

验证 Host 和存在时的 Origin，不使用通配 CORS。无 Origin 的本机客户端仍须认证。无关 HTTP 路由不可用。不通过 URL 参数传 Token。协议与 SDK 版本在实现时对目标客户端做兼容验证，不手写协议。

工具：list_servers、start_command、get_operation、read_output、cancel_operation。工具不能传任意 host/password，不能导出凭证或修改访问策略。操作查询和输出读取也校验归属。

start_command 采用应用自己的 operation ID，不依赖客户端支持实验性 MCP Tasks。长操作异步执行，输出按 cursor 和 byte limit 读取，等待时间有上限。以 profile + request key 去重；执行状态未知时禁止自动重试。

stdio 不作为首版默认入口；有实际客户端兼容需求时加薄桥接器，共用 Core，不复制凭证与策略。

## ADR-005：执行与授权

使用 ssh2 直接运行远端命令，不拼接本机 sshpass 或 shell 命令。每条命令独立 exec channel，底层连接仅在相同授权上下文内复用；不跨 profile 混用会话。

每次请求显式提供所需工作上下文；不延续上一条命令的 cwd/env。默认非交互，无自动 sudo 输密、无持续 stdin 写入。命令输出、时长、并发和排队数量均有限额。

默认逐条审批；可对选定 profile/server 授予限时免确认。审批绑定 server ID、目标配置版本、命令、超时等不可变参数。派发前重新检查锁定、撤销、到期及配置变更。任意 Shell 不标记为只读，远端账号是最终操作权限上限。

目标状态机：submitted → awaiting_approval / queued → dispatching → running → succeeded / failed / cancel_requested / interrupted / unknown。denied、expired 为未执行终态；cancel_requested 不是确认终态。实际状态转换需按实现建立严格定义。

先持久化 dispatch intent，再发送命令。崩溃、断网、遗漏退出状态均可能使远端结果未知，不推断成功或取消，不自动重放。发送 SSH signal 后可关闭通道，但界面必须保留“未确认远端已停止”的表达。

## ADR-006：本地审计与回放

SQLite 保存元数据、授权、审批、操作和事件索引；输出保存为按操作分块的加密文件。录制数据使用独立派生/封装密钥、每块独立 nonce，记录序号、相对时间、stdout/stderr 和完整性信息。详细格式在录制任务中确定。

同一输出管线服务记录、界面与 MCP；界面可跳过显示帧，但不能静默丢失录制数据。缓冲和磁盘配额必须有限；录制故障将操作标记不完整，停止接收新操作，并按策略尝试中断。

命令参数也可能含秘密，必须考虑审计字段加密和脱敏。已知凭证脱敏采用跨 chunk 处理，不声称能识别所有秘密。默认不保存通用键盘输入。输出当作文本/终端序列，不启用自动剪贴板、任意文件或外链操作。

第一版回放是独立命令的时间线与输出播放；不等同于恢复终端内部状态，不等同于重新执行或回滚。后续 PTY 回放可评估 asciicast 格式，并记录 resize。

## ADR-007：生命周期与发布

目标行为：关闭窗口驻留托盘；显式退出停止 MCP 并尝试取消操作；应用启动锁定；锁定后拒绝新操作并尝试取消现有操作。退出前提示远端状态可能无法确认。当前骨架尚未实现这些完整行为。

生产包不能信任开发环境 URL，不加载远程脚本。macOS 签名/公证、Windows 签名、升级和凭证迁移是正式发布前的验收项。CI 构建不代表已完成真实平台的原生能力验收。

## 技术参考

- https://www.electronjs.org/docs/latest/tutorial/security/
- https://www.electronjs.org/docs/latest/api/safe-storage
- https://www.electronjs.org/docs/latest/api/utility-process
- https://github.com/mscdex/ssh2
- https://ts.sdk.modelcontextprotocol.io/
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://xtermjs.org/docs/guides/security/

## ADR-008：M1 实现与接续（2026-10-20）

- SQLite 绑定改用 `node:sqlite` 的 DatabaseSync；Node 24.15 与 Electron 内置 Node 24.22 均已验证。接口封装在 Store 中，使用 user_version 迁移、foreign_keys、FULL 同步与 DELETE journal；没有引入额外原生 ABI 绑定。阻塞读写只在 Core 进程内执行；后续高流量录制必须另做批处理设计。
- safeStorage 使用异步 API，随机主密钥保存在保护文件，凭证以独立 nonce 的 AES-256-GCM 密文保存。AAD 绑定版本、凭证 ID 和种类，库中另有加密校验标记。主进程和 Core 通过私有 IPC 传递临时密钥材料，不向 renderer 暴露。
- 已增加独立加锁密码及恢复码，见 ADR-009；主密钥不能读取时失败关闭，不自动重建覆盖。恢复依赖完整数据目录及原系统密钥环境；可移植恢复功能后续设计。
- 服务器与凭证标签、地址、用户名、主机指纹是明文元数据。UI 锁定隐藏元数据，但不承诺磁盘字段加密。
- ServerService 作为当前服务器管理与连接测试入口；未来命令和 MCP 必须接入统一操作服务，不能将此测试入口扩展为绕过审批的执行通道。
- 首次未知指纹使 SSH 握手停止，未发送认证凭证。可信渠道核对后，UI 提交有效期 5 分钟、绑定服务器 revision 的 challenge，保存 pin 后重新测试。锁定或配置变化会清空 challenge 并取消活跃测试。已保存 pin 不直接覆盖。
- 测试仅等待 SSH ready 后断开，不申请 session/exec/shell。总超时 12 秒，认证错误/超时/网络错误采用固定安全信息，不向 renderer 返回原始异常对象。MCP 仍未实现。
- core RPC 有固定业务分发与超时；preload 只开放限定方法；UI 和 Core 都不能通过此批次功能执行任意远端命令。
- 原生测试脚本仅使用临时目录和随机合成秘密；不读取已有应用凭证。已在 macOS 验证，Windows 待对应 PR CI。UI 打包测试已确认创建/解锁、凭证表单入口、锁定隐藏；未使用真实服务器或真实凭证。

## ADR-009：加锁密码与恢复码

已实现。随机主密钥保持不变；密码、恢复码分别使用独立随机 16-byte salt，经异步 scrypt（N=32768、r=8、p=3、32-byte 输出、64 MiB maxmem）派生包装密钥。AES-256-GCM 包装主密钥，AAD 绑定 envelope ID 和 password/recovery 角色。实现使用 [Node 官方 crypto API](https://nodejs.org/docs/latest-v24.x/api/crypto.html)。

版本 2 protected-key.bin 保存版本头及经 OS safeStorage 保护的包装 envelope，不保留 OS 可直接恢复的裸主密钥。Main 注入 OS 适配器和 Core RPC，纯安全模块不依赖 Electron。密码/恢复码不写配置、日志或 renderer 状态；输入仅留在表单和必要提交调用，不能保证短暂对象和字符串绝对擦除。

旧文件只在未配置密码时通过设置流程读取，先由 Core 校验主密钥（不解锁、不创建校验记录），再生成 envelope；临时文件 flush 后原子 rename 替换，提交前复查锁定代次。不保存旧文件副本。写失败或锁定竞争保留旧文件，业务访问保持锁定。新库首次密码解锁才创建数据库校验记录，避免设置失败使空库孤立。已有数据库校验而密钥文件丢失时，拒绝生成覆盖旧数据的新密钥。

正常修改验证旧密码；恢复重设验证恢复码且保留恢复码；轮换恢复码同时验证当前密码和旧恢复码。变更只重包装主密钥，成功后保持锁定。安全请求串行；验证失败使用内存中的递增等待（1–30 秒），重启会清除，不能当作防离线猜测边界。外部锁定使未完成解锁/写入失效；UI 根据锁定代次关闭安全表单。

密码和恢复码只要求非空且不能相同，不限制长度下限或字符组合；内部仅保留 1 Mi 字符输入大小上限以限制资源消耗。支持用户提供或随机生成 24-byte hex 恢复码，要求再次确认和保存确认；没有安全问题、邮件找回或后门。两者都丢失无法恢复，恢复码仍依赖原 OS 密钥环境。元数据仍为明文字段；旧备份、磁盘残留及同用户受控进程不在彻底撤销或隔离承诺内。

## ADR-010：服务器保存、可选绑定与认证反馈

SQLite user_version=2：servers.credentialId 可为 NULL，服务器可在没有凭证时先保存；非空时保留外键与删除引用约束。原子迁移复制旧服务器记录，保持 id、revision、createdAt、凭证密文及已信任主机记录。credentials 新增递增 revision，更新秘密或元数据均递增，摘要只暴露版本号。

测试连接由 Core 读取绑定凭证；未绑定时在创建 SSH Client 前拒绝。主机身份验证规则不变。UI 不因保存而自动发起网络连接；用户明确点击测试，首次需核对指纹并确认，再信任并重新测试认证。测试不申请 session/exec/shell。

前端结果仅表示一次已结束的认证测试，未持久保存，不表示持续在线。结果绑定服务器 revision 与凭证 revision，配置变化或锁定后失效；在途回调再次检查当前记录版本、锁定状态与页面代次，失效回调不恢复旧结果或主机确认。

## ADR-011：连接路径与内部转发

已实现直连、单层 SSH 跳板和 SOCKS5。服务器保存 route；跳板引用另一台已绑定凭证的直连服务器；SOCKS5 保存代理地址、端口，以及可选的代理用户名和密码凭证引用。秘密继续由 Core 解密，不进入服务器配置、MCP 或 renderer 长期状态。SQLite v3 添加 route JSON，旧数据默认直连，损坏或未知 route 失败关闭。

SSH 跳板使用 [ssh2 forwardOut](https://github.com/mscdex/ssh2) 为已保存的固定目标建立 direct-tcpip 流，再在流内进行独立 SSH 握手。跳板和目标分别认证、分别验证原有 KnownHost；未知指纹以 jump/target 角色和对应名称返回，每次人工确认都关闭本次连接，再显式继续。禁止自引用、嵌套跳板、引用不存在的服务器或未绑定凭证的跳板；被使用的跳板不可删除、解绑或改成代理路径。没有本地公开监听、Agent forwarding、远端 Shell 或通用转发接口。

SOCKS5 使用 [socks 客户端](https://github.com/JoshGlazebrook/socks)，支持无认证及用户名/密码认证。Core 自行拥有到代理的 TCP socket，在协商完成后将其交给目标 SSH；目标域名由代理解析，不执行目标本地 DNS 解析，不回退直连。协议用户名/密码各限 255 字节；这是 SOCKS5 协议边界，不是应用加锁密码或 SSH 密码的强度限制。SOCKS5 本身不加密代理认证，应在可信网络/代理上使用；目标 SSH 认证仍受端到端 SSH 主机身份校验保护。

ConnectionScope 统一拥有总时限、AbortSignal、SSH clients、代理 socket 和转发流；总超时、锁定、配置变更及异常均销毁全部资源，晚到的转发回调也立即销毁流。原始代理异常可能带选项信息，因此只返回固定安全错误。SOCKS5 密码引用计入凭证使用数量，禁止误删或改为私钥；代理凭证及跳板/跳板凭证版本纳入前端结果依赖。

此 ADR 的初始批次只实现认证测试；M2 已按 ADR-012 复用此连接逻辑。MCP/命令审批必须绑定完整路径及相关版本，不能让智能体通过传入任意转发目标改变已授权服务器路径。KnownHost 仍按 host/port 管理，路径变化不自动替换主机身份。


## ADR-012：M2 本地 MCP 与有界命令记录（2026-10-20）

已实现官方 TypeScript SDK 1.32.1 无状态 Streamable HTTP，Core 独占回环监听 `127.0.0.1:43821/mcp`。默认不启动，每次 HTTP 请求/工具派发校验独立 Token 哈希、过期与撤销；严格 Host、存在时的同源 Origin、固定路径、64 KiB 请求体和请求/连接限额。应用操作 ID、接入归属和请求去重独立于 MCP 会话；禁用 GET SSE，不需要长驻 MCP session。

OperationService 是命令请求、桌面审批/取消、MCP 查询的共同业务入口。接入策略创建后不可编辑，仅撤销后新建；默认逐条确认，限时免确认最多 1 小时。审批保存不可变的命令参数、完整目标/路径快照及相关凭证版本；连接前、握手后和 exec 派发前重新检查锁定/授权/配置，派发意图 SQLite FULL 同步成功后才调用 SSH exec。连接阶段与命令阶段分别计时，锁定/配置变化/撤销/取消统一终止内部连接资源。连接测试和命令共享 ServerService 的路由/主机验证逻辑，MCP adapter 不接触 SSH。

远端独立 POSIX sh，分别引用 cwd 与命令，进入绝对目录后用随机 NUL 分帧返回 pwd -P，再运行用户命令；分帧仅用于区分输出，不是对恶意远端的信任边界。不提供 PTY/stdin 或持续目录。取消当前仅断开连接，不证明远端进程停止。派发后未收到可信完整退出结果则 unknown；重启将有执行意图的非终态标为 unknown，其余中止，不重放。

M2 的有限记录先保存在 SQLite v4 的加密字段/分块中，暂不引入 ADR-006 规划的独立文件录制格式。记录密钥使用 HKDF-SHA256 从主密钥派生，固定域 hostharbor-recording-v1；AES-GCM 独立 nonce，AAD 绑定操作 ID、记录用途、块序号与流。命令/目录/目标快照/结果/输出加密；状态、时间、profile 配置、请求标识、字节数仍为明文元数据。已知连接凭证采用跨块精确匹配脱敏，输出是非可信纯文本。记录写失败阻止派发或断开执行并停止接收新任务。限额为 4 并发、20 等待审批、每条 1 MiB 原始用户输出、200 条记录、100 个接入；保留/清理、检索和时间回放留给 M3，不能将当前详情页描述为完整回放。

UI 只调用固定 IPC，不持有执行服务、数据库、SSH 或解密密钥；新 Token 仅创建时短暂展示，服务端只保存哈希。当前没有自动写入客户端配置或给用户真实服务器自动授予智能体权限。官方 SDK、直接 HTTP、macOS utility/打包 UI 合成验收与真实产品客户端兼容性分别记录。


## ADR-013：集中审批策略（2026-10-20，#12）

OperationService 使用独立、无 Electron 依赖的 PolicyService。三模式：all-approval / rules / paused。规则以接入 ID、服务器 ID、完整 command、请求 cwd、启用与到期做 AND 匹配；范围内多个 ID 为 OR，空数组代表全部（包括未来新增对象）。拒绝 > 审批 > 放行，未匹配审批；允许规则必须指定完整命令，不支持前缀/正则/模型分类。cwd 匹配不是路径沙箱。

SQLite v5 单行 approval_policy：revision 元数据 + 加密完整策略，使用已有派生记录密钥、独立随机 nonce、AAD approval-policy:v1。迁移初始 revision=0/detail=NULL 只表示全部审批；其他损坏组合失败关闭。UI 通过固定 get/save/preview IPC；MCP 无策略写接口。保存按预期 revision 更新，失败不替换旧策略；过期编辑报冲突。规则上限 100。

新操作在加密不可变详情中记录决策、策略版本、全部匹配规则的 ID/名称/动作与原因。策略变更使 awaiting_approval / queued / connecting 且无执行意图的任务失效；派发前再次按现行策略评估并比较提交时决定，规则自然到期也不能沿用旧放行。已派发命令不因策略编辑终止，暂停表示拒绝新派发；显式取消仍不能证明远端进程停止。策略保存成功但在途失效持久化失败时停止接收新任务，并报告存储故障。

全局策略取代 ADR-005/012 中 profile 的免确认行为；旧模式值仅作数据兼容，不再决定执行，新接入使用 mode=policy。Token、范围、有效期与撤销保持。旧的非终态任务重启时按原规则标记中止/未知；没有策略快照的记录不能重新派发。批准仍绑定完整配置与命令，不绕过锁定、主机验证或授权检查。

预览验证有效接入及服务器范围，只评估已保存策略，不联网，不持久化操作，不代表 SSH 可用或命令安全。输出依旧非可信文本。规则和精确命令不是对恶意远端、被替换脚本或同用户本地攻击的绝对隔离。

ADR-013 增补（#14）：规则模式内置四组疑似高风险命令预设（删除、磁盘写入/格式化、关机重启、权限修改）。预设是保守关键字提示，可误报/漏报，不是 Shell 解析器或权限边界；动作只允许审批/拒绝，绝不因未命中风险而授予执行。与完整命令规则合并后沿用拒绝 > 审批 > 放行。预设配置 riskRules 为加密策略内的可选字段，旧策略缺省采用四组已启用/人工审批；显式配置要求四组唯一且完整，防止损坏配置静默遗漏。默认配置来自版本化代码，不增加数据库表或改写用户旧规则。自定义放行仍须完整命令，未匹配仍审批。决策记录内置 ID、名称及 risk=high，重用原有版本/匹配重检和失效处理。

## ADR-014：操作历史、回放与七天保留（#15）

SQLite v6 为输出增加编码字段（旧块 json、新块 gzip-json），新块 JSON 文本经 gzip 后再使用既有独立 nonce/AAD 加密；解压有 64 KiB 单块上限，未知编码失败关闭。操作新增人工决定/时间、输出清理时间/原因；历史详情和过滤仍经统一 OperationService。每页 50 条，最多保留 10,000 条摘要，历史扫描解密有固定边界；不以明文命令建索引。

recording_settings 加密保存带版本的保留天数/输出配额，默认七天、500 MiB，允许 1–365 天、64–4096 MiB。保留自终态 updatedAt 起算，只清理终态输出，保留参数/审批/结果/去重。解锁、每分钟及读取/请求入口检查，锁定停止后台整理；解锁时整理失败重新锁定。清理事务失败回滚，显式设置提交不立即删除，后续定时/请求/手动整理应用新值。输出超配额按最早结束优先；为每个可并发执行预留 8 MiB，不能容纳时拒绝派发，不删除运行中录制。配额只约束输出密文，不等于整个数据库大小。

主文件页总量、可复用空闲页、输出密文/操作数分别统计。清理使用 secure_delete；空闲页默认复用。所有任务结束后允许显式 VACUUM 缩小主库，临时日志、备份和底层存储残留不在擦除保证内。

手动删除整条终态操作在同一事务中删除加密详情、结果与输出，并保留 profileId/requestKey 最小墓碑（最多 100,000 条）；再次使用同请求标识返回 OPERATION_REMOVED，不能因日志删除而重复执行。仅清理输出则原去重响应和结果仍在。MCP 无清理、设置或回放控制权限，现有五工具不增加。

桌面播放仅消费本地有界文本分块，相对首段输出计时，按序显示 stdout/stderr，支持暂停/倍速/定位与流筛选。输出不渲染 HTML，不执行命令；未知状态仍不可推断远端停止。锁定/换页取消读取并卸载播放器，显示末尾 1 Mi 字符并明确截断，加载总量有 16 Mi 字符边界。历史是本地活动记录，不称为防篡改审计。

## ADR-015：AI 接入配置（2026-10-21，#17）

系统设置独立管理 OpenAI / Anthropic 两协议配置，最后保存的协议为当前配置；每种协议分别保留 API 基础地址、模型 ID 与 Key。SQLite v7 ai_settings 单行密文和乐观 revision；既有派生密钥/AES-GCM、AAD ai-settings:v1，元数据和 Key 全部加密。Main 固定 IPC → Core AiService，renderer 只收到 hasKey，不提供已保存 Key 读取接口，MCP 没有 AI 配置接口。新 Key 只短暂留在输入 DOM/提交中，不进 React 状态或日志；锁定/卸载/协议切换清除。空 Key 保留仅限同协议、同规范化地址，改地址须重新输入 Key。

模型列表采用官方 HTTP 协议：[OpenAI GET /models + Bearer](https://developers.openai.com/api/reference/resources/models/methods/list)、[Anthropic GET /v1/models + x-api-key/anthropic-version](https://platform.claude.com/docs/en/api/models/list)。地址按 API base 配置，根路径规范为 /v1，自定义前缀保留；拒绝账号/密码、查询参数和片段，远程要求 HTTPS，仅显式本机 localhost/127.0.0.1/[::1] 允许 HTTP。拒绝重定向，避免 Key 被自动转发到其他地址，不关闭 TLS 校验。

只在用户点击获取模型/测试时联网，发送当前提供或同址保存的 Key；不发送服务器/凭证/日志，不自动推理。模型可手动输入，列表测试不代表模型支持推理。15 秒整次超时、2 个并发、2 MiB 解码响应、500 个模型、Anthropic 最多五页；名称/ID 限制，过滤重复/无效/包含本次 Key 的条目。错误不返回远端正文或原始异常。锁定、配置修改和关闭取消请求，返回前复查 revision，旧响应不能恢复界面。

本批不接入内置智能体执行或模型调用；未来推理/工具执行必须另行接入统一操作服务和审批，不得让 AI 配置提供 SSH 或策略旁路。

ADR-015 修正（#19）：Anthropic 兼容网关的 `/anthropic` 前缀按 `/anthropic/v1/models` 请求，显式 `/anthropic/v1` 不重复添加。此为资源路径解析，保留配置原地址及同址 Key 绑定，不跨域探测或跟随重定向。404/405 与 429 使用固定安全错误，不回传远端正文。

## ADR-016：有界 AI 调查与结构化服务器档案（#20）

InvestigationService 在 Core 调用 AiService 推理适配器与同一个 OperationService。OpenAI 使用 Chat Completions function calls，Anthropic 使用 Messages tool_use/tool_result；无远端托管执行。模型只能提交限定查询或结构化 save_report，不能提供任意 shell。固定基础采集后，process/service/container 参数必须来自成功证据，目录限定已发现路径和固定部署根目录，所有 Shell 参数校验并独立引用。不读取进程参数/环境、配置或业务文件，不绕过主机校验和审批。

用户开始时确认 AI 地址/模型/数据范围，提交 AI/服务器 revision；Core 绑定目标/路由/凭证/指纹快照。内部 desktop-ai profile 仅单服务器、十分钟，不生成可用 Token，MCP authenticate 明确拒绝其 source；不显示在 MCP 接入列表，操作记录仍保存其来源。所有命令照常评估全局策略、人工批准绑定不可变操作并重查、持久化意图、执行与录制。拒绝和未知状态停止调查；暂停仅作用新派发，AI 不替用户批准。

SQLite v8 profiles 增 source（旧记录 mcp），server_dossiers 一服务器一加密文档（AAD server-dossier:ID），保存当前任务及最后成功报告，报告 schema 有资源、磁盘、应用/目录/端口、未知事项及证据 UUID。校验证据存在且成功，不将引用等同语义真实性；AI 输出可能出错。失败刷新保留旧报告，快照变化标记陈旧，删除服务器级联删除；档案预览独立于七天完整回放保留。

总预算十分钟/十查询/七模型轮次、单模型六十秒、单命令十五秒/连接十二秒，一次全局一任务；每证据12k字符、总64k、模型请求512KiB/响应1MiB、密文文档前明文512KiB。输出作为不可信文本，已知 SSH 秘密过滤后再做常见 Token 尽力脱敏；不声称可完全阻止数据泄漏。配置变更、锁定、取消和退出中止，重启保留中断说明、撤销内部授权、不恢复执行。详见 [服务器档案](server-dossier.md)。

ADR-016 兼容与恢复增补（#22）：Core 内保留完整 Anthropic assistant 响应块用于工具轮次，包括 opaque thinking/signature，仅发回原目的地址、不渲染/记录；请求/响应大小和总预算继续有效。MiniMax-M3.1-Flash 的 Anthropic 请求设置 output_config.effort=low，其他模型不注入厂商选项。停止原因先于工具结构校验，用固定错误码区分截断/无调用/协议/报告/证据问题。截断/无调用、报告字段/证据修正合计最多两次，强制 report-only，不重执行采集命令。显式 reuseEvidence 启动只整理本机已存历史预览，不允许新查询，沿用原采集时间；重新确认当前 AI 地址与配置 revision。固定 testAiTools IPC 仅使用合成信息做两轮模型能力检查，返回布尔结果，不开放任意提示词或响应内容。Main 此固定方法 RPC 时限130秒，单模型请求仍60秒。

## ADR-017：独立应用上下文与受控日志入口（#23）

SQLite v9 独立 applications 表，稳定 UUID、serverId、createdAt 为索引元数据，其余完整内容使用既有主密钥派生保护与 application:UUID AAD 加密。保存/删除使用 revision；记录 schemaVersion、人工确认时间、连接 revision，以及可选 AI 原始报告/证据来源。AI 报告刷新不覆盖此表，不把人工确认当作实时验证。读取校验 schema 与 id/serverId 绑定，连接配置变化后日志查询要求重新核实保存。

ApplicationService 负责桌面维护、授权元数据查询及固定日志命令生成；MCP adapter 仅委派业务服务，仍不接触 SSH。新增 get_server_context/find_applications/query_application_logs，list_servers 可按名称/地址搜索。元数据读取同样检查解锁、接入到期/撤销及服务器范围；不向 MCP 提供应用写入或原始调查预览。上下文与日志是非可信历史数据，不是模型指令。

日志工具只针对已保存来源生成有界 Linux bash 命令，journal/Docker 支持明确时间窗口，字面文件仅末尾采样、明确不应用时间过滤。OperationService 保存不可变来源/查询上下文，既有策略/审批/主机校验/意图/录制不变；批准和派发前通过注入验证器重查应用版本。验证器缺失失败关闭。requestKey 重试先取原操作快照，不能因来源编辑或删除重复执行。shell 引用与 pipefail 防止参数注入及上游错误被管道尾部掩盖，不将这些查询称为任意 Shell 的只读安全边界。详见 [应用上下文](application-context.md)。

## ADR-018：服务器档案人工修正覆盖层（#25）

在已有加密 server_dossiers 文档中增加可选 corrections（revision、updatedAt、values），无需数据库表迁移。原 AI 报告及证据保持原样；读取时生成有效视图，UI 与 MCP 读取同样内容和 manualFields 来源标记。内部调查使用原始文档，刷新成功只替换原 AI 报告，失败也不覆盖修正。人工内容不会被额外发送给 AI，不新增 SSH 或模型请求。

概述、system.os/cpu/memory/uptime 独立覆盖；磁盘、应用和未知事项按整个集合覆盖。AI 数组行没有稳定身份，不以索引跨报告合并。修改集合由人工维护，后续 AI 不覆盖整个集合；未修改字段仍取最新采集报告。Core 比较实际值并清除修改部分继承的 evidenceIds/置信度，renderer 不能提交证据元数据更改冒充采集事实。原采集证据仍可查看，但不作为人工值的证明。

固定 editServerDossier IPC 仅本机解锁后可用，校验基础报告 runId 与修正 revision，活动调查期间拒绝编辑同一报告；写失败保留原文档。MCP 没有写入接口。用户编辑的是展示/上下文档案，不修改独立应用运维档案及其日志执行入口。档案仍受512 KiB明文文档上限保护，超限不写入，不承诺历史版本恢复。

## ADR-019：共享 MCP 公共契约与桌面工具目录（#28）

无 Node/Electron 依赖的 shared/mcp-tools 保存八工具公共 description/inputSchema 与中文使用说明。OperationService 继续使用同一个 commandSchema，Core MCP 逐工具注册直接引用公共定义，renderer 只导入静态契约与说明，不导入执行模块、不调用本地监听来获取目录。JSON Schema 用于显示类型/必填/默认/标准范围；跨字段与自定义校验仍由 Zod/Core 执行，在使用说明中说明，不能把 JSON Schema 视为所有语义校验。

目录只说明当前程序内置工具，不表示当前 Token 可访问哪些资产、服务在线或命令获准。关闭服务及锁定时也可浏览静态目录；管理资产/创建接入仍沿用解锁和既有固定 IPC。没有工具试运行、调用按钮或新增执行/凭证接口。实际 SDK tools/list 与桌面目录 schema/description 的一致性由合成 MCP 测试检查。

## ADR-020：持久化操作查询与独立详情（#30）

操作页复用既有 queryHistory 固定 IPC，扩展 pageSize（20/50/100，缺省仍50）、active状态组与可选筛选元数据。Core 在现有最多10,000条持久化摘要范围内按时间/id降序查询、解密并匹配密文中的命令/目标，先筛选再分页；不把命令或服务器信息另建明文搜索索引。元数据仅给本机解锁UI，包含现存记录与历史操作快照的服务器/来源名称，桌面AI和撤销接入也可筛选；不修改 MCP 授权或工具。

renderer 表格仅保留当前页，应用筛选与草稿分离，定时更新保持查询/页码，过期响应与锁定后结果丢弃。记录减少时校正到有效末页；分页是当前数据的 offset 视图，新增/状态变更可能改变页内容，不承诺跨多次查询的冻结快照。操作详情与输出按选中ID独立读取，不依赖当前页或旧200条列表；审批/取消继续走原 OperationService。日志回放页保持原缺省50条行为，没有新增清理或执行通道。

原生与桌面合成测试通过 CoreClient 的可选启动参数注入 MCP 监听端口0，避免占用/停止用户已有43821服务；生产入口缺省仍43821，没有新增renderer配置接口。端口校验0–65535，仍只绑定127.0.0.1；此为进程启动依赖注入，不改变认证或Host/Origin校验。

ADR-020 界面增补（#32）：操作日志复用 OperationList 与同一个持久化查询接口，首屏20条、20/50/100页大小，列表只显示摘要；完整目标/来源/目录/命令/回放继续使用既有 HistoryDetail。窗口固定高度并禁止文档级滚动，侧栏固定宽度、独立溢出；右侧普通页内部滚动，日志页通过 flex/min-height:0 将剩余高度交给表格，筛选和分页不进入表格滚动。更多筛选隐藏不清除已应用来源/时间，收起后显示已应用提示。只改渲染布局，无 Core/授权/存储或回放清理语义变更。

ADR-020 审批/历史分组增补（#34）：审批中心固定active范围（等待审批/排队/连接/派发/执行），操作日志固定terminal范围（完成/失败/拒绝/中止/未知/过期）。Core先按组及状态过滤后计数分页，UI查询/重置始终携带各自状态组，状态下拉只展示对应组；无新存储或MCP工具。结束状态共用定义，unknown表示本地已停止跟踪但远端结果不确定，原风险提示不变。审批详情独立于当前列表，结束后列表移除而已打开详情继续读状态/输出；历史按同一记录读取，不复制/重执行任务。

## ADR-021：本机品牌资源与状态栏入口（#36）

选定C几何泊位标志重绘为SVG，renderer直接静态引用，PNG/ICNS/ICO与菜单栏1x/2x模板由构建脚本确定性导出并提交；OS应用图标与BrowserWindow/Dock显式绑定同一资源。资源随asar打包，无远端加载或新增renderer权限。字标采用系统字体，保留HostHarbor名称。

Main持有Tray引用，macOS使用18pt模板（36px Retina），Windows使用透明彩色图标。菜单只打开/恢复/聚焦同一窗口、调用已有SecurityService.lock、退出；不解锁或直接访问SSH，不显示虚假在线状态。macOS关闭窗口仍触发锁定并保留进程，可由状态栏重建；Windows最后窗口关闭仍退出，不添加隐藏驻留。退出销毁Tray并停止Core；单实例第二次打开可重建已关闭窗口。模板/应用资源缺失由原生验收发现；Tray创建失败保留主窗口并记录固定无敏感信息提示。

ADR-021 视觉一致性增补（#38）：字标由系统字体改为原C概念字形的平滑矢量轮廓，renderer显示带可访问名称的SVG图像，跨平台不依赖字体回退。标志按白色参考比例重绘；应用图标使用白色/深底，1024画布中背景848、四周88透明留白。统一脚本从mark.svg和wordmark.svg输出图标与官网浅/深、横/竖排组合。A/B/C完整概念和选稿参考保存在docs/design/branding，运行与打包仅包含resources/branding，不读取原图或外部生成路径；托盘和锁定生命周期保持。

## ADR-022：明确无到期时间的MCP接入（#40）

ProfileInput/AccessProfile的expiresAt使用number或null，null明确表示永久；省略、非法数字仍拒绝。SQLite v10事务重建profiles，使expiresAt可空并保留ID、Token哈希、范围、模式、撤销及来源；没有引用profiles的外键，操作记录/请求标识不变。SQL约束只允许mcp来源的policy/confirm-each使用null，旧time-limited免确认和desktop-ai仍须有限期；旧记录保持原期限，不自动延长。

认证、操作重查、到期处理显式区分null，永久请求不注册接入过期计时器，但命令/连接时限、等待审批五分钟上限、主机验证、锁定、范围、规则及撤销继续有效。UI仅7天/30天/永久，默认7天；列表永久有效且可撤销，策略预览含永久接入。不改变已有授权，不公开Token或增加MCP接口。

## ADR-023：可编辑接入与本机安装配置导出（#42）

SQLite v11为profiles增加revision（缺省1）和可空tokenSecret；旧ID/哈希/范围/期限/撤销/来源及操作记录不改。新MCP Token沿用SHA-256认证，并用已有记录派生密钥与profile-token:ID上下文AES-GCM加密保存。Token密文和哈希分工独立，读取导出前验证形状和哈希一致性；内部desktop-ai不能导出。

updateProfile仅本机固定IPC，revision比较、范围/期限校验、已撤销拒绝，旧mode统一为实际已使用的policy。未变期限保持原值，修改期限最多未来30天或null。实际修改在同事务更新profile/revision并作废未派发请求；之后取消此profile活动连接，失败停止接收执行。操作详情记录profileRevision，批准/派发再次核对，旧详情缺省1；requestKey/历史不重置。MCP读取历史详情/输出/取消时同时核验当前服务器范围，移除授权后不保留旧记录的读取旁路；本机历史入口不带MCP身份，仍可查看。已派发中断结果保持unknown语义。

prepareProfileToken以原Token哈希验证后加密补存（不变权限版本、不作废任务），或用户明确确认后生成新Token、递增版本并作废旧任务。不会自动旋转旧接入。installationProfile是仅Main可用Core RPC，不在preload或MCP暴露；Main复制接口接收profile ID，取得秘密后复查锁定revision及Core状态，直接await系统剪贴板写入，renderer仅收到成功/失败。JSON为mcpServers.hostharbor，含HTTP URL及Authorization头，Token不进入URL、不自动启动服务或安装。其他客户端格式按自身要求适配。剪贴板历史不在本地密文保护保证内。

## ADR-024：Main独立跟踪待审批并提醒（#44）

Core固定approvalSnapshot RPC返回vault与最多20个待审批ID，复用OperationService的到期处理；不解密命令、不向MCP提供该RPC。Main独立每秒读取，单个在途轮询，复查SecurityService.lockRevision，Core失败/锁定/退出清除提醒；停用后丢弃晚到响应。通知和图标失败不会改变审批/执行结果。

不依赖renderer页面计时器。纯TypeScript Tracker维护当前ID、最多10,000个已见ID和1.5秒合并批次；数量不变的新ID也提醒。前台应用内提示，后台按偏好调用原生Notification，只发送固定标题和数量。macOS Dock数字、Windows固定红色覆盖图标、托盘菜单/提示文字及macOS菜单栏数量都跟随未处理数，读消息不清零。没有通知批准按钮或执行通道。

Main保存通知点击的单个待跳转目标，发送固定事件；renderer启动订阅后可消费队列，切换审批中心并通过原getOperation读取详情，已锁定时先显示解锁入口。目标被消费后清除，不能切换页面反复打开。旧集合目标点击回到中心；竞争以Core当前状态为准。

Main单独保存notification-settings.json，严格schema、revision和原子替换，仅三个布尔偏好、不含资产。损坏不静默恢复为开启，默认badge/system开启、sound关闭。固定设置/测试IPC继续检查窗口发送者，不开放任意通知文案或操作系统设置写入。系统权限不能用Notification.isSupported当作已授权，展示结果采用show/failed事件及4秒无法确认回退；原始OS错误不回传。

Electron的macOS UNNotification要求签名，Dock角标受通知权限控制。当前未签名原生测试返回failed，仅验证真实失败反馈，未验收可见横幅/声音/真实OS点击。Main导航及交互使用合成入口验证，和真正系统展示分开记录。窗口关闭/锁定/后台生命周期保持ADR-021。

ADR-019目标范围说明增补（#46）：shared/mcp-instructions独立维护初始化instructions，shared/mcp-tools在查找/上下文/执行描述与桌面目录补充本次目标约束。区分接入可访问范围与用户任务范围；所有/全部按修饰对象和既有上下文理解，不用关键词触发跨机执行。全量仅指已声明的当前授权列表快照或确定子集，明确时不重复确认，不确定先问。缺失、失败或输出文字不能扩大范围。保持八工具及现有参数/数组返回，不加自然语言关键词拦截，不声称这是强制执行权限边界或已经验证外部模型服从。

## ADR-025：辅助审批与 AI 建议（2026-10-23，#48）

新增 assisted 模式，不改变旧策略默认值。精确自定义规则/内置高风险提示优先；未匹配请求仅通过完整识别的固定查询配方或版本校验的结构化日志入口自动放行。系统查询由 Core 重建固定绝对路径命令，保存原始请求及实际查询；不能用命令黑名单或模型分类授权任意 Shell。

AI 开关存于现有加密策略，默认关闭，开启需有效配置及外发确认。OperationService 先持久化待人工审批记录，再做最多两并行、十二秒的辅助分析；仅发送经尽力过滤的命令/目录，不发送资产标识或服务器输出。结果为加密建议，不修改 action，不触发 schedule；失败保留人工处理。派发前比较本地策略、配方、版本、授权和上下文，排除 advisory 字段，避免 AI 到达时破坏已绑定的人工审批。迟到结果仅在原请求仍待审批且版本有效时可保存。

## ADR-026：Main空闲自动锁定（2026-10-23，#50）

系统空闲锁定由Main拥有，注入OS空闲秒数、单调时钟、Core状态、SecurityService.lockRevision和既有锁定回调。单个每秒定时器、单次在途轮询，解锁/设置变更重置宽限；锁定、停止及设置变化使旧轮询失效。MCP/renderer活动不续期，系统锁屏/睡眠/关闭窗口锁定继续独立生效。

idle-lock-settings.json仅保存30/1800/null与revision，默认1800；严格校验与原子替换。修改前检查已解锁及锁定版本；读取、采样异常请求锁定，锁定传输失败保留强制重试标记。固定Main IPC只提供读取/保存，无MCP写入入口。关闭只关闭空闲计时，不改变其他锁定路径。此本机偏好不是对同用户篡改的安全边界。

## ADR-027：三分钟审批等待指引（2026-10-23，#52）

统一OperationService在已授权get/start/cancel和输出读取中动态派生agentGuidance，记录ID、Core时间、下一步、查询间隔、三分钟等待截止、五分钟/授权到期有效期和原ID续接参数。指引不持久化、不影响不可变审批/执行决策，不改变任务状态或在三分钟时自动取消。等待与有效期常量独立；重复请求通过get返回当前状态，不能返回陈旧待审批状态或续期。

全局instructions和相关工具描述要求立即提示用户审批、建议10秒查询间隔、截止后停止全部轮询并请用户处理后回复继续；继续时先单次查原ID，仍待审批不重开预算。拒绝/过期/未派发中止停止，未知结果保留不确定性。已批准任务按执行时限跟进，读完输出停止。现有工具/输入兼容，不引入长连接等待、客户端强制唤醒或模型必然遵守的声明。

## ADR-028：可组合的查询语言与逐段审批（2026-10-23，#54）

辅助审批从 version 1 完整配方升级为 version 2 正向查询语言。Core 自有受限字面 Shell lexer/parser 生成列表、条件连接和管道 AST，不声称支持完整 Bash/POSIX；引号/转义先解析，变量/替换/展开/任意重定向等不支持语法直接转人工。支持上限及具体命令见 assisted-approval.md。每段经过命令、子命令、选项类型及对象命名空间校验，长/短选项规范化，读取路径与敏感字段独立限制；未知参数不得由同名工具或无危险关键词推断放行。

通过后只渲染 AST 的授权配方，使用绝对工具、字面引用和固定附加边界（无分页器、有限日志、find不跟随/深度、证书仅字段），不执行原始 Shell 文本。每段都要通过，失败不派发任何部分；自定义/高风险规则优先，AI 保持建议且默认关闭。允许已登记查询工具的内部临时文件等行为，不宣称零副作用或远端文件沙箱；远端程序、账号、环境、符号链接及输出秘密仍是信任/使用边界。

PolicyDecision 兼容保留原 queryPlan 字段，version允许1/2，新增 queryAnalysis（段号/类别/结果/原因），随原加密操作详情保存；语法问题返回固定原因，未知参数及资产数据不复制进解释。renderer在预览/审批/历史复用折叠展示，不执行解析、不持有权限。原始请求和重建命令可对照；MCP不新增工具/输入。派发前重新计算并比较整个当前决策，升级前待审批决策不自动适配新配方。已有统一授权、主机校验、快照、持久化执行意图、时限和未知结果处理保持。

## ADR-029：常见排障能力与对象范围（2026-10-23，#56）

基于ADR-028扩展正向语义能力，独立query-args负责类型/读取对象/路径、query-diagnostics负责系统/版本/元数据/HTTP/TLS，原查询表保留服务/容器和文本语义。有限AST增加||、字面IPv6及无害重定向，所有分支/片段仍须通过，保留重定向顺序；生成代码不接受客户端脚本。普通字面标签可独立通过。完整校验的查询中不对标签/搜索文本应用全文危险词误报；精确自定义规则保持优先，未知语法继续保守审批，AI不授权。

OperationService统一注入实际server.host与不可变cwd，renderer/MCP不能提供queryScope。ApplicationService注入当前连接版本有效的确切file入口及应用版本摘要；仅真实ApplicationRecord提供权限，AI报告本身不提供。普通读取依赖维护入口时将scopeRevision写入queryPlan，批准/派发前重算并比较，变更返回CONTEXT_CHANGED。Core对自动查询中的已知敏感值保留人工；不把文字过滤当成授权依据。

HTTP配方正向限定URL/方法/对象，首参数-q、noproxy、无跳转/凭证/正文、固定时限与大小，拒绝write-out文件引用/文件写出。TLS只对当前目标或loopback做限时握手，关闭应用输入，证书只输出登记字段。元数据权限与内容权限分开，部署日志命名空间及精确入口均不构成远端文件沙箱；词法路径归一不验证符号链接身份。程序版本依赖登记工具、参数和系统/部署位置及远端管理员对程序的信任，非密码学程序身份验证；远端环境、DNS和服务语义仍是边界。

操作列表使用共享operationApproval映射，独立展示审批与执行状态，未知/失败不推测审批，AI建议不显示为自动批准。场景矩阵作为后续能力维护契约，同时验证正常组合与追加修改后的整条阻断；真实回环HTTP验证配置/代理隔离，Core/MCP使用合成SSH逐场景验收，不声称真实Linux资产工具路径已验证。


## ADR-030：桌面锁定与可选后台凭证使用（#58）

用户可关闭默认开启的“锁定时暂停 MCP 访问”。Core DesktopSession 的桌面会话与 ServerService 的真实密钥状态分开；普通锁定先关闭桌面门禁、递增会话版本，再按设置真实清密钥或保留后台能力。设置读取失败强制清密钥。真实 vault 锁定仍使所有 MCP fail closed，不改变 OperationService 的授权/审批/主机/持久化检查。

桌面 parent RPC 默认门禁，只有状态、最小提醒、安全密钥传输与锁定及无秘密偏好读取例外；锁定后的敏感读取/修改/批准/Token导出都拒绝，异步结果复查会话版本。MCP传输不暴露这些管理方法。通知仍可按数量提醒，人工审批需解锁，五分钟到期与三分钟等待保持。

Main通过原OS保护文件验证密码，后台恢复采用 validateKey 而非重复清密钥解锁，不打断后台操作；初始启动/重启没有密钥时仍正常解锁。安全修改、恢复及验证失败始终走真实锁定。系统锁屏/睡眠/空闲/窗口关闭/托盘使用普通应用锁定，Windows最后窗口仍退出。该模式明确保留内存密钥，不称为已清密钥的凭证库锁定。

偏好文件严格schema、revision、原子替换，修改仅解锁后，关闭需明确确认。属于本机偏好而非防同用户篡改的安全边界。Main额外丢弃锁定版本变化的迟到IPC结果；Renderer只获最小backgroundMcp布尔状态，不接收密钥。


## ADR-031：显式选择的宽松审批（#60）

新增独立permissive模式替代rules的UI入口，持久化仍识别旧rules并保持未匹配审批，不自动转换。切换入permissive的保存需permissiveConfirmed=true，确认仅用于防意外配置变更，不作为秘密认证。确认标记不持久化。旧规则可保留/编辑，UI用兼容提示要求主动选择新模式。

宽松策略是用户明确授权的默认执行原始Shell。独立permissiveRisks基于有限字面AST和程序/参数检测已知风险、脚本、动态结构；没有命中只是策略依据，不证明只读/安全，不把黑名单当安全边界。query-shell仅在该扫描入口开放通配字面参数，原辅助查询默认解析与重建保持。危险文本出现在普通标签/搜索参数中不会按全文关键词触发。风险/不确定语法需人工，整条无部分执行；宽松模式不生成queryPlan，不借用“已校验查询”声明。

保留精确高级规则的deny>approval>allow，并叠加宽松基础风险审批；旧禁用风险提示不会关闭宽松基线，已启用的拒绝设置可加严。原辅助模式AI仅给建议，宽松模式不调用AI来放行。已知秘密尽力过滤、统一授权、主机验证、快照/版本重查、持久化意图、录制、未知结果及策略变更作废仍走OperationService。


## ADR-032：独立路径授权的SFTP操作（#62）

FileService是OperationService注入的文件执行适配器，UI/MCP通过同一start/get/decide/cancel/state/intent/audit路径，MCP不直接建立SSH。操作加密detail新增transfer，结果新增fileResult，不迁移现有表；文件授权按profile/server使用独立AAD加密metadata记录保存。MCP接入默认无文件权限，桌面使用无可用MCP Token的desktop-files内部身份；权限需显式配置，原Shell审批规则不授权SFTP操作。全部审批/暂停仍优先；上传/下载分别可选自动，目录查询受读根限制。

Main系统目录选择生成本机根授权，固定IPC不接受renderer/MCP提交绝对根路径。Core异步设置/源准备在写入/提交前复查desktop会话版本，锁定后的迟到准备不产生新任务。本机根、权限revision、上传源大小/SHA、下载expectedSize/mtime绑定不可变详情；派发前统一复查profile revision、服务器/凭证/主机快照、策略/文件授权版本及五分钟审批有效期。执行期复查授权、快照与文件授权，但不把已派发任务延伸套用审批有效期；全局策略修改保持已有“仅作废未派发”语义。

通过既有withConnection和必需主机校验获取SFTP，支持单层SSH跳板/SOCKS5。无Shell调用、无二进制MCP/SQLite内容；64KiB流块、500MiB上限、10分钟时限，进度最多每250ms加密更新。目录句柄分页100项、最多扫描10000项/30秒。远端POSIX路径/realpath及本机单文件名/no-follow检查为尽力约束，不声明远端沙箱或可防同用户攻击。

上传派发前以500MiB/任务上限生成私有临时快照，验证批准的源hash后才向远端写；快照完成后清理，崩溃残留下次上传前清理，不进入数据库。再用远端同目录临时文件及远端读回hash比对后标准SFTP v3无覆盖rename；信任服务器遵守协议，不调用覆盖扩展。下载临时文件sync后本机同目录hard-link无覆盖发布；失败不降级覆盖。每次最终发布前重新检查授权和取消。下载源stat/mtime不等于内容快照签名。失败/断开可能留临时文件，记录线索并保持unknown语义、不自动重跑；日志清理不删除文件。首版不做覆盖、目录递归、同步、自动执行或解压。

所有文件工具共用SDK注册与桌面目录契约，现13工具/四组。FileResult在get_operation返回，完成指引stop/inspect而非read_output；文件摘要和临时线索可在文件页、审批中心和操作日志查看，二进制不作文本回放。


## ADR-033：绑定凭证的单次 sudo 提权（本地迭代）

servers.elevation增加none或sudo/passwordSource配置，数据库升级至12，旧记录默认none。密码来源仅引用凭证ID，可复用密码类型登录凭证或独立密码凭证，免密不提供密码。引用凭证受删除/改类型约束，版本纳入OperationService快照和既有撤销；密码解密仅在Core内。

start_command新增可选elevation=sudo；有限单命令sudo前缀兼容规范化，不推断组合命令权限范围。统一决策把提权保留人工、deny/paused优先，禁用AI授权和查询重建；操作详情记录提权身份、凭证依赖及完整命令，不持久化密码。派发前及密码输入前再次检查授权和目标版本。

固定sudo路径/参数，以root运行内层Shell并首先重定向stdin至/dev/null，再确认cwd与执行批准命令；无PTY。随机专用prompt跨块过滤，仅响应一次，发送后关闭输入并清Buffer。无prompt不发送，15秒认证期限，重复prompt中止且不重试。认证后的命令不获得后续交互输入；远端管理员和sudo/PAM仍可信，同用户/root攻击及所有内存副本不是可保证边界。无结束确认保留unknown。详情与sudoers包装命令限制见sudo-elevation.md。

按用户要求本轮不推送GitHub/不触发Actions，Issue/PR在大版本统一交付时补齐，本地执行计划持续更新。


## ADR-034：服务器文件设置与逐次路径审批（本地迭代，取代ADR-032授权模型）

文件设置使用files:settings:v2:<serverId>独立AAD加密metadata，仅服务器ID/revision/上传开关/固定目录/大小上限。旧profile/server根和自动传输数据不继承；旧待审批TransferSpec不能派发。设置更新使同服务器所有接入文件任务失效，原服务器授权/主机验证/持久化意图保持。

MCP移除本机枚举，上传使用localPath/remoteName，Core派生固定目标；下载使用remotePath/localPath，可选元数据。Renderer/Main不再提供持久本机目录选择授权。每次完整路径和大小限制随v2 TransferSpec加密绑定，始终人工确认，deny/paused优先；目录查询仅元数据，沿用接入范围及全审批。

上传批准前仅lstat元数据、inode/时间/大小绑定，批准后复查并生成快照，建立前后再核对，之后SHA/readback/不覆盖发布保持。下载可无需先列目录，批准后以源stat建立长度/mtime限制并在内容读取前检查配置上限。设置1–10240MiB、默认500MiB，原单任务时限/并发保持；大文件不入库。路径按次授权不表示既有客户端本机授权自动继承，更不承诺同用户FS沙箱。

本轮只本地开发，GitHub Issue/PR和推送待大版本集中处理。


## ADR-035：不持久化的目录浏览与传输分页（本地迭代）

目录浏览从TransferSpec执行任务分离，FileService.browse经OperationService.browseFiles进行已认证profile范围/修订/到期、服务器凭证/主机快照及暂停检查，沿用ServerService.withConnection直连/跳板/SOCKS5和固定SFTP元数据操作。不持久化operations/输出/执行意图，不创建审批；全部审批模式不阻止这类纯目录元数据读取，暂停仍拒绝。传输仍必须持久化意图并逐次人工批准。

临时browse生命周期与传输共享4连接上限、30秒总时限，策略变更、接入变更/撤销、真实锁定及内核关闭主动中断，每页批次/返回前复查授权；不引入任意命令直通或Transport执行SSH。桌面异步结果复查desktop revision，锁定后的结果不返回。MCP list_remote_files直接返回remotePath/entries/nextOffset，无requestKey/id/polling。旧list提交入口拒绝；旧历史保留，不做隐式删除。

历史查询新增kind=file-transfer和transferDirection筛选，在完整既有上限内解密过滤再分页，排除历史list条目，不再从最近30/200条截取。文件工作区固定外框、标题和分页，表格区滚动；摘要显示文件名/方向/状态/大小，完整路径和审批在独立详情。UI/Main只通过Core，不承担授权。

本轮仅本地维护，GitHub Issue/PR/推送继续大版本集中处理。


## ADR036：按审批模式保存下载审批选项

审批策略的加密JSON增加可选downloadApprovalRequired映射，按ApprovalMode分别保存。旧数据或缺失项默认为true，无数据库迁移。界面四张模式卡片分别提供复选框，修改不会选择该模式。

FileService通过统一OperationService决策：暂停优先拒绝；下载在当前模式显式false时自动放行；其余传输人工审批，上传不可绕过。MCP报告下载审批状态和暂停状态，调用方以操作状态为准。自动下载仍保存执行意图、路径/策略版本、大小限制与完整性记录；无覆盖、不执行、主机验证及接入复查保持。策略变化使未派发请求失效，不追溯自动批准已有记录。


## ADR037：接入软删除与分页管理

profiles增加deletedAt（schema v13）。删除仅允许桌面已解锁上下文，带id/revision并核对source=mcp；与revokedAt、Token密文清除和未派发任务中断在同一事务提交，之后取消活动连接/浏览/AI审批。保留tokenHash作为不可重新认证的撤销标记，历史操作快照和幂等记录不删除。删除不可重新启用，重复删除幂等；不提供永久清库入口。

listProfiles排除已删除；queryProfiles只读暴露MCP接入的元数据，SQL分页、参数化名称/服务器/地址搜索、互斥状态过滤和稳定createdAt/id排序。删除优先于撤销和过期，不占未删除接入数量上限；过期接入可编辑续期，撤销和删除不允许编辑或导出Token。桌面列表独立滚动，固定表头与分页，不经MCP公开接入管理。


## ADR038：文件发布边界与安全诊断

文件结果增加阶段、publicationAttempted和仅固定错误码/数字SFTP状态的failure。首次协议操作前持久化publicationAttempted=false；最终rename/link调用前先持久化true。尚未尝试最终发布的传输失败标记failed，可能仍有临时文件及在途写入；不声称临时文件不存在或远端进程结束。发出发布请求后的失败继续unknown，旧记录缺失标记时不推断、不重传。Core按已持久化进度的内存标记分类，锁定后无需解密结果；意图或诊断持久化失败保持保守处理。权限/缺失路径/不支持的SFTP状态映射固定提示，不记录服务端原始错误文本。旧记录不能恢复当时未保存的失败原因。


## ADR039：宽松模式采用日常运维默认执行

用户明确授权将宽松审批收敛为破坏性动作提示。独立permissive-shell扫描命令位置/组合/替换/常见包装与heredoc，取代受限查询解析器作为门槛；不求值Shell，不展开外部脚本，无法判断不因语法转人工。扫描有界、漏报可能，属于用户默认执行授权而非安全边界。辅助审批继续使用原受限解析/重建。

宽松模式的结构化sudo不再无条件人工，继承同一命令决策及自定义拒绝/人工规则，仍显式请求、绑定凭证、一次提示输入、脱敏和派发复查；全部/辅助/旧规则模式提权仍人工，暂停拒绝。SFTP独立审批不受影响。现有宽松用户重启后采用新语义，历史决策保留，其他模式不自动切换。


## ADR040：大文件有界流水线与阶段时限

FileService在审批后的本机私有快照上做4×64KiB有界分块上传，下载与完整读回共用偏移分块管线；按序消费摘要，不整文件缓冲。标准上传校验检查发送快照/哈希、写入确认、关闭和远端大小/类型；完整模式额外读回比对。标准模式不宣称远端哈希已验证，不执行远端Shell校验脚本。

服务器加密设置增加verification、idleTimeoutSeconds、totalTimeoutMinutes并提供旧值默认；新审批快照绑定这些设置，旧快照保持原完整读回/原总时限。OperationService用TransferDeadline分别跟踪进展与总时限，SSH连接仍使用原独立时限；实际字节增长/阶段切换才重置无进展计时，轮询不续时，授权不延长。桌面临时接入到期时重查已由可见窗口续期的有效期，真实接入仍到期即停止。

持久化结果包含准备/传输/验证字节、阶段时间、校验方式及通过标记。发布前持久化publicationAttempted=true，无覆盖发布和失败/未知边界沿用ADR038。超时只中止本次任务并保留线索，不重试、不自动修改历史记录。MCP和桌面通过同一操作服务读取这些结果，渲染端不接触SFTP或文件正文。


## ADR041：文件双向审批与模式选择分离

审批策略增加可选uploadApprovalRequired映射，与downloadApprovalRequired一样按模式保存；旧数据缺失时默认true。模式卡片仅负责选择模式，下方统一提供当前模式的上传/下载审批勾选项。FileService在统一OperationService中按请求方向读取对应值，false自动执行、true人工，暂停优先拒绝；全命令审批模式的文件传输也尊重明确的独立授权。

自动上传仍绑定完整路径、源身份、设置版本/大小与策略修订，保存执行意图并复查授权，不扩大固定远端目录、不覆盖或执行内容。策略修改沿用未派发请求失效机制，不自动批准已有请求。MCP报告uploadRequiresApproval/downloadRequiresApproval和uploadsPaused/downloadsPaused，不再声称所有上传始终人工；桌面、协议说明和中英文资源保持一致。
