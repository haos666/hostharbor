# Security

HostHarbor is a macOS desktop SSH workspace with a local encrypted credential vault and controlled local MCP access. This release provides Intel and Apple Silicon builds; Windows release validation is deferred. The listener is disabled on startup; users explicitly create scoped access profiles and enable it. Initial binaries are unsigned and not notarized; see the release notes before installation.

## Intended security boundary

- Keep SSH credentials out of MCP messages, ordinary logs and renderer persistence.
- Use OS-protected key material to encrypt credentials at rest.
- Require authenticated local MCP access, explicit server grants and host key verification.
- Persist operation intent before dispatch and capture bounded output and lifecycle events.
- Keep terminal output untrusted and isolate renderer privileges.

The app cannot guarantee protection from a compromised OS or every malicious process running as the same user. Arbitrary commands inherit the remote account's permissions; client-side checks cannot guarantee read-only shell behavior. Model-visible command output can contain business data. Local audit records are not independently tamper-proof.

## Reporting

Use this repository's GitHub private vulnerability reporting feature when available. If it is unavailable, open an issue containing only a request for a private reporting channel. Never put credentials, customer data, exploitable private infrastructure details or raw production recordings in issues.

## Current implementation limits

Credentials are encrypted; server/credential labels, addresses, usernames and pinned host keys are plaintext SQLite metadata. By default, locking hides desktop metadata and drops active key references. Users may explicitly disable “Pause MCP access when locking”: after initial password unlock, this locks only desktop RPC access while the Core retains keys for authenticated background MCP. Manual approvals still require desktop unlock. Restart, security-proof changes and failed security verification close credential access; this setting never unlocks a fresh process. See [desktop locking](docs/mcp-lock.md). Unlock requires an app password; the random root key is wrapped separately by password and recovery proofs, then protected by the OS. Both proofs being lost prevents recovery. OS-backed protection does not guarantee a system prompt on each use.

The protected key and database must be preserved with their original OS key environment. No portable recovery/export mechanism exists yet. Changed host keys are rejected; there is no automatic or one-click pin replacement. Connection tests authenticate only and open no remote command session.


Command parameters, target snapshots, results and output chunks use a separately derived AES-GCM recording key. Operation states/timestamps/request identifiers and access profile labels/scopes/expiry remain plaintext metadata. Exact known-secret redaction crosses output chunks but cannot identify every transformed secret or business datum. Do not treat model-visible output as authority for subsequent commands.

MCP uses per-profile Bearer tokens, stored as SHA-256 hashes, on loopback Streamable HTTP. It is not an OAuth server. Query and cancellation enforce profile ownership. Approval binds immutable command, directory, limits and route/credential versions, with authorization rechecked before dispatch. Remote host identity must already be pinned through the desktop test flow.

Disconnecting, timing out, cancelling or revoking access cannot prove remote processes stopped. Unknown outcomes are retained and never automatically retried. Dispatch intent is persisted first; recording failures stop dispatch or disconnect the operation and block new work. Disk failure can leave the last state or output incomplete. Local history and text replay have configurable retention (default seven days for output) and a ciphertext quota. They are not tamper-proof enterprise audit records. Cleanup retains summaries; deleting a terminal record retains a minimal profile/request-key tombstone to prevent duplicate execution. Compression precedes encryption, decompression is bounded, and active outputs are never automatically purged. Space reclaim requires all operations to finish. Backups and physical storage erasure are not guaranteed. Real client and platform GUI validation limits remain documented in docs/mcp.md.


Approval policy is centralized: all-approval (default), assisted diagnostics, explicit permissive maintenance, retained custom rules, or pause new execution. Deny overrides approval, which overrides allow; unmatched commands require approval. Allow rules require an exact complete command. Matching a requested directory does not constrain subsequent filesystem access, and exact commands are not guaranteed read-only. Existing time-limited profiles no longer independently bypass this policy. Saving a policy invalidates requests not yet dispatched; dispatched commands continue until completion or explicit cancellation. Policy revisions and matches are rechecked before dispatch. Rule contents and recorded decisions are encrypted locally; MCP cannot edit them.


AI settings store both provider configuration and API keys encrypted in the local vault. Saved keys are never returned to the renderer or MCP. An existing key is reused only for the same protocol and normalized base URL; a new address requires a new explicit key input. Model-list requests are user initiated, bounded, refuse redirects, and cancel on lock/configuration changes. Remote endpoints require HTTPS; explicit loopback HTTP is available for local providers. Model-list requests send no server asset data or SSH credentials; saving configuration does not start inference or grant server access. Removing local configuration does not revoke the provider-side API key.

## AI 服务器档案

用户在服务器页确认目标 AI 地址、模型及数据范围后，限定 Linux 采集结果才会发送到该地址；不会自动调查真实资产。模型只选择固定查询工具，所有 SSH 经过原操作服务、策略、主机验证和意图记录；不允许模型任意 Shell、提权或读配置/环境变量。桌面单服务器十分钟内部授权不能用于 MCP 认证，结束/重启撤销。

档案和有限证据预览加密存储，独立于七天完整命令回放保留；刷新失败保留旧报告，服务器删除级联清理。已知秘密与常见 Token 过滤是尽力而为，不能承诺任意服务器输出都无敏感信息；AI 结论和服务端内容一律不可信，证据引用不证明结论正确。停止调查不能证明远端进程已终止。


## Explicit permissive approval

Users may explicitly select permissive approval to execute original commands without human review when preset risk checks do not flag them. This is default-allow authorization, not proof of read-only behavior. Unknown programs, remote environments and service semantics may write or expose data. Risk hints are not a security boundary. Legacy rule-mode data remains default-approval until an explicit confirmed switch. Profile scope, expiry/revocation, actual vault lock, host verification, intent persistence and recording remain mandatory. See [permissive approval](docs/permissive-approval.md).

## Single-file transfers

Directory metadata browsing returns directly without operation, approval or audit records; it still requires server authorization, pinned host verification and an available vault, and rejects paused access. It cannot execute arbitrary shell commands or read file contents. Uploads and downloads retain persisted intent. Uploads and downloads each default to manual approval, with independent per-mode opt-outs in settings. Pause always denies transfers. SFTP uses server-level upload enablement, one fixed upload directory and a configurable size limit. Per-request absolute local paths are bound to each operation and rechecked before dispatch, including automatic uploads and downloads. There is no local directory enumeration or reusable local root grant. Upload source metadata is bound before approval; contents are read into a private snapshot only after human or explicit policy authorization. Download size is checked before content reads when not already known. Previous automatic/root grants are not inherited. Staging/received files rely on OS permissions rather than vault encryption; path checks do not defeat all same-user filesystem races. Interrupted transfers may leave partial files and unknown publication; no automatic overwrite or retry. See [file transfers](docs/file-transfers.md).

## Bound sudo elevation

Server sudo configuration references a login-password or separate password credential, or explicitly requests noninteractive passwordless sudo. Structured elevation uses the same destructive-operation policy in explicitly selected permissive mode; other modes require human approval. Deny/pause precedence and immutable target/credential revisions remain. Core sends one password only on a fresh per-operation sudo prompt, strips that prompt before recording and closes stdin; the elevated shell closes its own stdin before running the approved command. No PTY, generic prompt automation, persistent root session or sudoers modification is provided. Unknown outcomes never retry. This relies on the authenticated remote host, sudo/PAM and administrator policies, not on a command blacklist. Restricted-command sudoers, MFA and requiretty configurations may refuse this shell wrapper. See [sudo elevation](docs/sudo-elevation.md).
