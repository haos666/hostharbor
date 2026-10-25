# Contributing to HostHarbor

Thank you for helping make server access through AI agents easier to understand and control.

- Search existing issues before opening a bug report or feature request.
- For vulnerabilities, follow [SECURITY.md](SECURITY.md). Never publish credentials, private hosts, customer logs or production recordings.
- Use synthetic assets in examples, screenshots and tests.
- Discuss substantial changes before implementation. Keep pull requests focused and describe user-visible behavior and validation.
- Run `npm ci` and `npm run check`. For execution/storage changes, also run `npm run test:native` on macOS.
- Keep English and Simplified Chinese resources in `src/shared/locales/` in sync. Never translate user data, remote output or protocol identifiers.
- Renderer code cannot access Node, SSH, SQLite or long-lived keys. UI and MCP operations must use the same Core operation service.
- Do not change approval, host verification, data collection or telemetry behavior without an explicit design discussion.

This release targets macOS on Intel and Apple Silicon. Windows contributions are welcome for a future release, but Windows installers are not part of the current distribution.

By intentionally submitting a contribution, you agree that it is offered under the project's Apache-2.0 license. Retain relevant third-party copyright and license notices.
