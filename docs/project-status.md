# Project status

## macOS 0.1.0

HostHarbor provides local SSH credential management, controlled MCP access, command approval, encrypted operation recording/replay, SFTP single-file transfers, optional AI server dossiers and an editable application context.

The interface supports Follow system, Simplified Chinese and English. Settings are grouped into General, Security, and Data & integrations. The application is licensed under Apache-2.0.

### Release scope

- macOS Apple Silicon (arm64) and Intel (x64).
- Unsigned, non-notarized DMG and ZIP archives, with SHA-256 checksums.
- Windows distribution is deferred; existing source support is not release certification.
- Local checks currently cover 870 tests plus native macOS utility-process, OS protection and synthetic SSH/SFTP tests.
- [Intel and Apple Silicon CI](https://github.com/haos666/hostharbor/actions/runs/40220223437) passed unit, type, build, native utility-process / OS protection / synthetic SSH-SFTP checks and architecture-specific packaging.
- The [release pull request](https://github.com/haos666/hostharbor/pull/2) is merged; [v0.1.0 downloads](https://github.com/haos666/hostharbor/releases/tag/v0.1.0) are published.

### Limits

No automatic updater, portable vault export, resumable file transfers or recursive directory synchronization. Local activity records are not tamper-proof audit records. Arbitrary shell commands are not guaranteed read-only. See [SECURITY.md](../SECURITY.md).

See [CHANGELOG.md](../CHANGELOG.md) for user-facing changes and [execution-plan.md](execution-plan.md) for next steps.
