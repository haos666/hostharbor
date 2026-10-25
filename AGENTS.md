# HostHarbor maintenance instructions

## Product scope

Personal installed desktop app. Current release targets macOS Intel and Apple Silicon; Windows distribution is deferred until native acceptance. Store SSH server credentials locally, expose controlled access through local MCP, monitor operations, and audit/replay command output. Read README.md, docs/project-status.md and docs/execution-plan.md before making changes; consult docs/architecture.md for boundaries. Update execution-plan.md at each meaningful handoff.

## Architecture

- Electron + React + TypeScript. npm with a committed package-lock.json.
- Renderer cannot access Node, SQLite, SSH or long-lived encryption keys directly. A credential entry form may briefly hold user input; never persist it in renderer state stores.
- Main owns desktop lifecycle and OS-backed key protection. Core utility process owns execution, policy, audit and storage.
- Both UI and MCP execution must go through the same operation service. Transport adapters must never execute SSH directly.
- Core modules should not depend on Electron except the process bootstrap and explicitly injected OS adapters.
- SSH connections and operations are scoped to authenticated access profiles; never trust MCP client-reported names as identity.

## Security invariants

- Reusable prompts, tool descriptions, examples and maintenance documents must use explicit placeholders for user asset information. Never copy server names, hosts, accounts or other instance details from a user's scenario into generic content. Resolve real values only from authorized tools for the current request; tests must use clearly synthetic fixtures.
- Never commit, log, expose through MCP, or include in screenshots real credentials, tokens, private keys or decrypted vault data.
- Fail closed if the vault is locked, authorization is absent/expired/revoked, host verification fails, or execution-intent persistence fails.
- Bind approval to immutable operation details and recheck authorization immediately before dispatch.
- Remote host identity verification is mandatory. Never auto-accept changed keys.
- Do not label arbitrary shell execution as read-only. No command blacklist or model classification is a security boundary.
- Do not claim process isolation or OS-backed encryption prevents all same-user local attacks.
- Disconnecting SSH does not prove remote process cancellation. Represent unknown outcomes honestly and do not automatically rerun commands.
- Treat server output as untrusted text. Never render it as HTML or allow terminal sequences to perform privileged desktop actions.
- Audits are local activity records, not a tamper-proof enterprise audit system. Redaction is best effort.

## Workflow

- User has authorized maintaining this repository, its GitHub issues and documentation, and normal development commits/branches. This does not authorize accessing real servers, deploying, changing public visibility, or publishing credentials.
- Keep work scoped to the requested task. Do not start scheduled maintenance without a request.
- Maintain GitHub Issues for meaningful implementation tasks, with scope and acceptance criteria. Update docs/project-status.md for material progress or blockers; update docs/architecture.md when a decision changes.
- Keep implemented capabilities distinct from plans. No fake online states, dummy security claims, or buttons that imply a completed operation.
- Never overwrite unrelated user changes. Do not change licenses or add telemetry without discussion.
- Run npm run check for code changes. Validate native functionality on the target OS; compilation alone does not verify Keychain/DPAPI, packaged utility processes or SSH behavior.
- Use feature branches and PRs for substantive implementation after bootstrap. Attach created PRs to the Codex chat.
- No subagents unless explicitly authorized by the user or a later applicable instruction.

## GitHub delivery cadence

User preference (2026-10-25): develop and validate locally, maintain local plans/status, and batch GitHub pushes, PRs and merges for larger releases. Do not push every feature or trigger Actions for routine iterations. Track pending GitHub Issue/PR updates locally until the release batch is requested.

## Useful commands

```sh
npm ci
npm run dev
npm run check
npm run dist:dir
```
