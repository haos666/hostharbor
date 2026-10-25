# Execution plan

## Current macOS release

- [x] Local SSH credential vault, host verification and direct / jump host / SOCKS5 routes.
- [x] Scoped local MCP access, configurable command and directional file approval, operation history and replay.
- [x] SFTP single-file transfer progress, verification, limits and timeout handling.
- [x] Optional AI configuration, structured server investigation and editable application context.
- [x] Configurable system / Chinese / English UI and grouped settings.
- [x] Apache-2.0, bilingual product documentation, synthetic screenshots, brand assets and third-party notices.
- [x] macOS-only release workflow for Intel and Apple Silicon, with architecture-specific native checks.
- [x] Both architecture-specific CI jobs passed and the [release pull request](https://github.com/haos666/hostharbor/pull/2) was merged.
- [x] Published [v0.1.0](https://github.com/haos666/hostharbor/releases/tag/v0.1.0) with validated Intel / Apple Silicon DMG, ZIP and SHA-256 checksums.

## Next release

- [ ] Windows native GUI, credential protection, notifications and packaged execution acceptance before distributing Windows installers.
- [ ] Developer ID signing / notarization when a distribution identity is available.
- [ ] Broader external MCP client acceptance and documented compatibility.

Start new feature and internationalization branches from current `origin/main`. Keep their work in separate branches or worktrees, merge verified changes deliberately, and update this plan at meaningful handoffs. Use synthetic assets in all shared examples. Batch GitHub delivery rather than triggering CI for each routine iteration.
