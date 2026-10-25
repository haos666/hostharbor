# Changelog

## 0.1.0 — First macOS release

### Server access
- Local SSH credential vault with password and SSH key authentication, app locking and recovery code support.
- Direct connections, an SSH jump host or SOCKS5 proxy, mandatory pinned host verification and bound sudo credentials.
- Scoped, revocable local MCP access with editable grants and expiry.

### Control and visibility
- Manual, assisted and permissive command approval, plus pause mode.
- Independent upload/download approval settings per mode.
- Approval reminders, operation history, filters and encrypted text output replay.
- SFTP single-file transfers with fixed upload destinations, size limits, phase progress and separate stall/total timeouts.

### Context and interface
- Optional OpenAI-compatible or Anthropic-compatible AI configuration.
- Structured server investigations and editable application/log context for agents.
- Follow-system, Simplified Chinese and English UI; grouped settings and responsive lists.

### Distribution
- macOS Intel (x64) and Apple Silicon (arm64) only. Windows distribution is deferred.
- Apache-2.0 license. Application binaries are unsigned and not notarized in this release.
- No automatic updates, portable vault export or resumable file transfers.
