# Project status

## v0.2.0 source batch — 2026-11-04

Version metadata is 0.2.0. This batch includes encrypted asset backups, server inspection plans/reports, channel approval/global controls and output pagination repairs. [Bilingual update and upgrade notes](releases/v0.2.0.md). [Delivery tracking #3](https://github.com/haos666/hostharbor/issues/3).

Local source review covers 79 changed files with no detected credential/instance-identifier matches; 939 checks and macOS arm64 native/bilingual GUI validation are recorded below. Release CI verifies both macOS architectures. Published downloads remain v0.1.0 until a separate installer release; Windows remains deferred. The historical entries below record individual local handoffs, whose queued GitHub work is consolidated into #3.

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

### Reference-project research

The first [source-research report](research/reference-projects/README.md) compares five pinned repositories and records three proposed improvements: approval explanations / optional exact temporary grants, policy property tests, and optional activity budgets. Local validation passed 146 reference policy tests and 327 HostHarbor tests. No product code or runtime dependency was changed. Third-party GUI, cross-platform and real-client validation remain separate follow-ups.

### Limits

No automatic updater, resumable file transfers or recursive directory synchronization. Local activity records are not tamper-proof audit records. Arbitrary shell commands are not guaranteed read-only. See [SECURITY.md](../SECURITY.md).

### Selected next work

The user selected [encrypted asset backup / restore, SSH configuration import, and per-server saved actions](personal-workflow-plan.md), in that order. Encrypted backup / restore is implemented locally on `haos-codex/encrypted-backup` (not published in v0.1.0). Settings provide password-encrypted `.hhbackup` export, bounded selection/conflict preview and transactional restore under a new master key. No MCP grants, history or global secrets are exported. [Scope and instructions](backup.md). SSH configuration import and saved actions remain planned. Earlier research proposals about approval options and activity budgets are deferred.

See [CHANGELOG.md](../CHANGELOG.md) for user-facing changes and [execution-plan.md](execution-plan.md) for next steps.

### Backup validation — 2026-10-26

888 tests, type checks and production build passed. macOS arm64 native utility IPC, independent OS-protected restore and restored synthetic SSH authentication/pin passed. Isolated real renderer/preload/Core UI flow covers short passwords, mismatch, wrong-password retry, selected import, duplicate skip and bilingual minimum-window layout; file-dialog selections are test adapters. Physical native picker interaction, Intel and Windows acceptance remain separate. No production credentials were read/exported and no real server was accessed. GitHub Issue/PR updates remain queued for the next release batch.

### Output pagination repair — 2026-10-30

Implemented locally: each read_output response returns at most eight fragments; hasMore reports a saved successor page, outputComplete reports local retained-output exhaustion, and outputAvailability distinguishes cleared recordings. Exact cursor resumes and terminal stop/inspect guidance replace conflicting instructions. Existing numeric cursors remain compatible; original recording limits and per-page authorization remain unchanged. 910 tests, type/build and macOS arm64 native utility/MCP/synthetic SSH multi-page output passed without a second command execution. No production operation output was read, and no previously rejected client call was retried. External Codex auto-review decisions are not verified or guaranteed; clients may need to refresh/reconnect tool metadata. Local package update follows validation; no GitHub push this iteration.

### Server inspections V1 — 2026-11-02

Implemented locally, not in v0.1.0 downloads: versioned editable Markdown per server, offline templates, explicitly consented AI drafts from saved context, and scoped MCP list/get/submit tools. Agent-authored reports freeze the handbook version and authenticated operation evidence, with pagination, latest-result counts and deletion. Current plans join encrypted asset backups; report history is excluded. Existing authorization and approval remain mandatory. Scheduling stays with the external agent; no automatic repair. [Usage](inspections.md).

928 tests, type/build, macOS arm64 native utility/MCP/synthetic SSH evidence flow and isolated bilingual GUI passed. AI protocols use synthetic providers; no real assets or servers were used. Refreshed and restarted the local arm64 package after confirming no unfinished operations; retained a protected pre-upgrade schema13 snapshot and old bundle. Storage is now schema14; rollback requires the matching database snapshot. Intel/Windows acceptance and real provider/client scheduling remain unverified. GitHub Issue/PR updates are queued for the next release batch.

Inspection UI follow-up (2026-11-02): dossier, inspection plan and reports share one tabbed server window. Removed redundant workflow prose; bounded content scrolling and fixed save actions remain. Unsaved changes are guarded when leaving the inspection. 928 checks and isolated macOS bilingual UI flow passed; local arm64 package refreshed.

Lightweight inspection follow-up (2026-11-02): unsaved servers automatically preview a shared default checklist; no template-generation button. AI analysis now recommends future steps, using OS/service/path context without old metrics or evidence. Checklist titles are fixed and AI introductions are removed to prevent duplicated goals; suggestions exceeding six checks are rejected and total text is bounded below 6,000 characters. Five minutes is only a planning scope; mechanical command/time quotas and budget prefaces were removed. Large log input must be bounded before filtering. Existing saved plans are preserved. 930 tests/type/build, macOS arm64 synthetic native inspection/MCP and isolated bilingual UI passed; real provider output quality remains unverified. Local arm64 package refreshed; no GitHub push.

Inspection loading feedback (2026-11-02): centered animated spinner overlay and AI-button spinner replace layout-shifting text. Localized status uses actual request state; no fabricated percentages. 930 checks and delayed synthetic AI native GUI validation passed, including animation, bilingual state and failure cleanup. Updated/restarted the local arm64 package; no real provider request or GitHub push.

Inspection checklist correction (2026-11-02): removed mechanically invented command counts, per-command timeout recommendations, minute splits and goal/budget paragraphs from templates and MCP guidance. Five minutes is a generation-time scope preference only. AI drafts are normalized to actual check sections, dropping duplicated preambles and ignoring fenced fake headings. Log guidance bounds input before filtering; existing byte-bounded file-log tools remain unchanged. 931 tests/type/build passed; native/GUI evidence and local package handoff are tracked in the execution plan. Saved user documents are preserved and require review/replacement if they contain an older generated preface.

### Channel approval policies — 2026-11-04

Implemented locally: each MCP access may inherit the default policy or configure an independent full policy, including modes, risk/exact rules, AI advice and directional file approval. Global pause overrides all channels. Commands, sudo, file metadata/transfers, pre-dispatch rechecks and history share authenticated scope/revision resolution. Changes invalidate only relevant undispatched work; existing Tokens/configuration remain valid. Built-in operations inherit defaults. Existing profiles remain inherited, with no automatic permission changes. [Usage](channel-approval.md).

938 tests/type/build, complete macOS arm64 native Core/SSH/SFTP regressions, two authenticated MCP Tokens with distinct execution outcomes/global pause/reset, and isolated bilingual minimum-window UI passed. No production servers were accessed. Refreshed/restarted the local arm64 package after checking no unfinished work and retaining a protected schema14 database snapshot plus old bundle. Schema15 prevents older binaries from ignoring independent restrictions. Intel/Windows native acceptance for this change remains unverified; GitHub Issue/PR queued for the next release batch.

### Channel detail / global controls correction — 2026-11-04

The channel policy page now shows the full policy immediately, without an inheritance/custom selector. System settings show only require-all-approval and deny-all-execution switches. Global approval covers commands and both file directions while preserving channel denials; global denial has priority. Legacy settings remain as a compatibility seed, with no automatic permission changes. Channel configuration rejects global fields; global override changes invalidate all undispatched scopes and bind a control epoch. 939 tests/type/build and native dual-Token MCP command/file override checks passed; bilingual GUI verifies both channel details and the two-switch system page. No production server access or GitHub push. Final layout verified with switches aligned beside descriptions. Local arm64 package updated and restarted after checking zero unfinished operations and retaining a protected schema15 snapshot/old bundle. Existing access permissions were preserved; Intel/Windows acceptance for this change remains unverified.
