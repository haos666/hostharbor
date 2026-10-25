# Execution plan

## Current macOS release

- [x] Local SSH credential vault, host verification and direct / jump host / SOCKS5 routes.
- [x] Scoped local MCP access, configurable command and directional file approval, operation history and replay.
- [x] SFTP single-file transfer progress, verification, limits and timeout handling.
- [x] Optional AI configuration, structured server investigation and editable application context.
- [x] Configurable system / Chinese / English UI and grouped settings.
- [x] Apache-2.0, bilingual product documentation, synthetic screenshots, brand assets and third-party notices.
- [x] macOS-only release workflow for Intel and Apple Silicon, with architecture-specific native checks.
- [ ] Complete both architecture-specific CI jobs and merge the release pull request.
- [ ] Publish macOS DMG / ZIP archives and SHA-256 checksums after validation.

## Next release

- [ ] Windows native GUI, credential protection, notifications and packaged execution acceptance before distributing Windows installers.
- [ ] Developer ID signing / notarization when a distribution identity is available.
- [ ] Broader external MCP client acceptance and documented compatibility.

Keep feature and internationalization work in separate branches or worktrees, merge verified changes deliberately, and update this plan at meaningful handoffs. Use synthetic assets in all shared examples. Batch GitHub delivery rather than triggering CI for each routine iteration.
