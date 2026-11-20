# Changelog

## 0.3.0 — Inspection workspace and server organization (2026-11-20)

[Bilingual release and upgrade notes](docs/releases/v0.3.0.md). Consolidates the pending v0.2.0 source batch. [macOS arm64/x64 DMG, ZIP and checksums](https://github.com/haos666/hostharbor/releases/tag/v0.3.0) are published after both architectures passed release CI.

- Dedicated report-first inspection workspace with editable templates, bounded AI checklist suggestions, server/tag/result/time filters and versioned report history.
- Structured CPU/memory/disk measurements and system/application/custom report sections; offline browser dashboards with four complete themes and Markdown/Word/HTML exports.
- Per-finding ignore/undo with effective-status recalculation; reviewed AI exception notes of up to 50 characters appended as a new checklist version.
- Colored server tags, at most four configurable quick filters, shared dropdown/search selection, encrypted persistence and backup remapping.
- Shared SOCKS5 proxy management, transactional legacy migration, canonical server-route snapshots, reference guards and operation invalidation on edits.
- Agent server search and select-all-results; private-key import from a direct path, including hidden directories.
- Shared page headers/locked layouts, floating operation feedback, compact unlock/file settings, corrected upload switches and a tag dropdown polling fix.
- English/Chinese README, guides and theme previews updated. MCP server version now matches 0.3.0.
- Existing schema15 data and reports remain compatible; reconnect MCP clients for optional report fields. Keep matched pre-upgrade data for rollback. macOS only; Windows distribution remains deferred.

## 0.2.0 — Source update (2026-11-04)

See [中文 / English release notes](docs/releases/v0.2.0.md) for features, upgrade guidance and validation scope. Installer publication is separate from this source update.

- Per-access approval policies with full channel command/file settings, scoped invalidation and global required-approval/denial controls; bilingual desktop configuration and schema15 downgrade protection.

- Per-server Markdown inspection plans with editable offline templates, optional consented AI drafts and explicit draft review/save.
- Scoped MCP inspection discovery/retrieval and idempotent structured agent-report submission with operation-evidence checks.
- Bilingual inspection UI, last-check counts, paginated reports and version snapshots. Current plans are included in encrypted backup; scheduling remains external and anomalies are not automatically repaired.

- Recorded-output pagination now explicitly reports saved successor pages, local output exhaustion and cleared recordings; resume guidance includes the same operation ID and exact next cursor.
- Clarified the eight-chunk limit as per call and separated output paging from approval waiting. Existing numeric cursors remain compatible.

- Encrypted `.hhbackup` export and selected restore in Settings, with independent passwords and destination-key re-encryption.
- Duplicate/conflict/dependency preview, pinned-host conflict protection and transactional import without overwriting existing assets.
- Restored dossiers retain historical context/corrections and explicitly omit original evidence; MCP grants, activity history and global secrets are excluded.
- Bilingual backup UI with bounded preview pagination. macOS arm64 native Core and isolated GUI flow validated locally; Intel validation is delegated to release CI, and Windows distribution remains deferred.

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
