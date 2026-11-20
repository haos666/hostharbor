# 加密备份与恢复 / Encrypted backup & restore

状态：本地开发版已实现，尚未随 v0.1.0 安装包发布。入口：**系统设置 → 数据与集成 → 备份与恢复**。

## 中文

### 创建备份

解锁应用后点击“创建加密备份”，输入并确认独立的备份密码，再选择保存位置。文件扩展名为 `.hhbackup`。密码只要求非空和两次一致，没有最短长度或特殊字符要求；应用不记住备份密码，应用安全码也不能用来解密它。

备份包含：

- 密码、SSH 私钥及私钥口令。
- 服务器、登录/提权/SOCKS5 凭证绑定和 SSH 跳板关系。
- 对应服务器的已确认主机指纹。
- 已完成的服务器档案、人工修正、应用及日志入口，文件传输设置，以及当前巡检手册（不含巡检报告历史）。

不包含 MCP 接入、Token 或授权、操作历史及回放、原始调查输出、传输文件、应用解锁密码/安全码、AI Key 或全局设置。只有密文会写入备份文件，资产名称和地址也在加密载荷内。文件本身含有可恢复的服务器凭证，请与密码妥善保管。

### 导入备份

1. 新电脑先设置自己的应用密码和安全码，并解锁应用。
2. 点击“选择备份文件”，输入创建该文件时的备份密码。
3. 查看预览并选择要导入的资产，确认后导入。选中服务器会自动勾选所需的凭证和跳板；取消必要依赖也会取消相关服务器。

完全重复的资产会跳过；同名但内容不同的资产默认不选，可手动勾选作为独立记录保留，不覆盖本机已有记录。已有主机指纹与备份不同的服务器禁止导入，其依赖服务器也会被阻止。不要通过修改备份来绕过主机身份核对。

恢复时分配新的本机 ID，重建引用，并用目标电脑自己的主密钥重新加密。不会自动连接服务器、执行命令或授予 MCP 权限。历史档案保留原采集时间与人工修正，但不携带原始证据，界面会提示重新调查以确认现状。

### 失败与限制

- 预览有效期 10 分钟；锁定、重启、源文件或本机资产变更后需重新预览。即使允许锁屏时后台 MCP 运行，桌面备份仍要求解锁。
- 导入提交前必须没有等待审批、排队、执行、连接测试、目录浏览或调查中的任务；有活动时会拒绝导入。导入使用单一事务，失败整体回滚。
- 原生文件对话框可取消；选定路径后的加密/解密或事务提交期间显示忙碌状态，暂不支持中途取消。失败不会自动重试。
- 首版上限：32 MiB 加密文件、2,000 条凭证、1,000 台服务器、每台服务器 40 条应用。不包含云同步和定时备份。
- macOS Apple Silicon 上完成原生 Core、OS 密钥保护及合成 SSH 恢复测试；原生文件面板由 Electron 提供，自动化 UI 验收注入选择结果。Windows 与 Intel 本次新增功能尚未独立原生验收。

## English

Available in v0.3.0; not included in v0.1.0 installers. Open **Settings → Data & integrations → Backup & restore** after unlocking the app.

Create a `.hhbackup` file with a separate, nonempty password and matching confirmation. There are no minimum-length or character-complexity rules. The app does not remember this password; the app recovery code cannot decrypt the file.

The encrypted payload contains passwords, private keys/passphrases, servers and login/sudo/proxy/jump bindings, pinned host identities, completed dossiers and manual corrections, application/log context, file settings, shared proxy definitions, server tags/quick-filter preferences and current inspection plans (not report history). It excludes MCP profiles/tokens/grants, activity history/replay, raw investigation output, transferred files, app security proofs, AI keys and global preferences. Asset names and addresses are encrypted too.

On the destination computer, configure its own app password/recovery code, unlock, choose the backup and enter its backup password. Review and select assets before importing. Exact duplicates are skipped; conflicting names may be selected as separate records. Different existing host pins block import. Selecting a server selects its required credentials/jump host. Existing records are retained.

Restored records receive new IDs, remapped dependencies and encryption under the destination computer's own master key. Import never connects to a server or creates MCP access. Restored dossiers retain historical information and corrections, but original collection evidence is excluded and the UI labels them for re-investigation.

Previews expire after 10 minutes and are invalidated by locking/restart or source/asset changes. Import requires idle operations/connections/investigations and uses one transaction with complete rollback on failure. Native file selection can be cancelled; cryptographic processing and transaction submission show a busy state and cannot currently be cancelled mid-operation. Failures are not retried automatically.

Version 1 limits: 32 MiB encrypted file, 2,000 credentials, 1,000 servers and 40 applications per server. No cloud sync or scheduled backups. Apple Silicon native Core/OS protection and synthetic SSH restore were tested; automated GUI tests inject native picker results. Intel and Windows have not received separate native acceptance for this addition.
