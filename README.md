<picture>
  <source media="(prefers-color-scheme: dark)" srcset="resources/branding/lockup-light.svg">
  <img src="resources/branding/lockup-dark.svg" alt="HostHarbor" width="420">
</picture>

**Your servers. Your credentials. Controlled access for your AI agents.**

[简体中文](README.zh-CN.md) · [Downloads](https://github.com/haos666/hostharbor/releases) · [MCP setup](docs/mcp.md) · [Security](SECURITY.md)

HostHarbor is a local desktop workspace that connects AI agents to your SSH servers through MCP. Keep reusable credentials in the app, grant agents access to specific servers, decide which operations need approval, and inspect the results in one place.

## Built for everyday server work

- **Manage access locally.** Save SSH passwords or private keys, pin host fingerprints, and connect directly, through an SSH jump host, or through SOCKS5. Bind a separate sudo credential when needed.
- **Give each agent its own access.** Create scoped, expiring or permanent MCP profiles with independent tokens. Edit grants or revoke an access profile without handing the agent your SSH password or private key.
- **Choose your approval workflow.** Confirm every command, use assisted diagnostics, explicitly allow routine maintenance in permissive mode, or pause execution. Upload and download approvals are configured independently for each mode.
- **See what happened.** Use the approval center for pending/running operations and searchable history for finished operations. Replay recorded text output, with configurable retention and local storage limits.
- **Transfer files without another tool.** Browse remote metadata and transfer single files over SFTP. Uploads use a fixed server directory and configurable size limits, with phase progress, separate timeout controls, and optional full readback verification.
- **Give agents useful server context.** Optional AI investigations create structured, editable server and application dossiers. MCP tools can find applications and query maintained log entries instead of rediscovering deployment paths every time.
- **Use your preferred language.** Follow the system language, or choose Simplified Chinese or English. Settings are grouped into General, Security, and Data & integrations.

![Server workspace using synthetic data](docs/images/servers.png)

## Download for macOS

The current distribution targets **macOS only**. Choose the architecture that matches your Mac.

| Mac | Download |
| --- | --- |
| Apple Silicon — M series | [arm64 installer](https://github.com/haos666/hostharbor/releases/download/v0.1.0/HostHarbor-0.1.0-mac-arm64.dmg) |
| Intel | [x64 installer](https://github.com/haos666/hostharbor/releases/download/v0.1.0/HostHarbor-0.1.0-mac-x64.dmg) |

ZIP archives and SHA-256 checksums are available on the [release page](https://github.com/haos666/hostharbor/releases/tag/v0.1.0). These initial binaries are **not Developer ID signed or notarized**; macOS may block opening them. Review the release notes and verify the checksum before choosing whether to open the application through macOS security settings. Do not disable Gatekeeper globally.

Windows installers are deferred to a later release. Source code for Windows is not a promise of current Windows release support.

Built-in server investigations and diagnostic probes currently target Linux servers. Other remote systems have not received equivalent feature validation; submitted commands must match the remote shell.

## Connect your first agent

1. Open HostHarbor and create an app lock password and recovery code. Preserve the recovery code separately.
2. Add a credential and a server. Bind the credential, test the connection, and verify the displayed host fingerprint independently before trusting it.
3. In **Agent access**, create an access profile for the intended servers and copy its installation configuration.
4. Enable the local MCP service and install that configuration in your MCP client. It contains a bearer token: treat it as a credential.
5. Choose an approval mode in Settings. Pending operations appear in **Approvals**, and finished operations appear in **Operation logs**.

HostHarbor uses authenticated **Streamable HTTP on loopback**. The app and MCP client run on the same computer. Your normal VPN connectivity still applies. See [MCP setup](docs/mcp.md), [SSH routing](docs/ssh-routing.md), and the in-app tool catalog for details.

![Approval settings using synthetic data](docs/images/approvals.png)

## Local storage and optional AI

Credentials and API keys are encrypted locally; HostHarbor does not upload your SSH credentials to an AI provider. Some asset metadata remains plaintext in the local database. An MCP client can see authorized operation output, which may contain sensitive business data.

AI is optional. Configure an OpenAI-compatible or Anthropic-compatible endpoint, API key, and model in Settings. Starting a server investigation sends selected, filtered server information to that configured endpoint. Review the provider and data scope before starting; filtering cannot guarantee that all sensitive content is removed. See [AI settings](docs/ai-settings.md) and [server dossiers](docs/server-dossier.md).

## Understand the boundary

Approval rules and AI advice do not make arbitrary shell commands safe or read-only. Permissive mode is an explicit choice to allow routine operations by default. Remote commands inherit the SSH account's permissions. Disconnecting SSH does not prove that a remote process stopped; uncertain outcomes are not automatically retried.

Local activity records are not tamper-proof enterprise audit logs. The vault does not protect against every compromised-OS or same-user attack. Portable vault export, automatic updates, resumable transfers and recursive directory synchronization are not included. Read [SECURITY.md](SECURITY.md) before connecting important assets.

## Build and contribute

Requires Node.js 24.15+ (supported engine range in `package.json`), npm, and macOS for current native release validation.

```sh
npm ci
npm run dev
```

```sh
npm run check
npm run test:native
npm run dist:mac:arm64
# On an Intel Mac:
npm run dist:mac:x64
```

[Contributing](CONTRIBUTING.md) · [Architecture](docs/architecture.md) · [Changelog](CHANGELOG.md)

## License

HostHarbor is licensed under [Apache-2.0](LICENSE). Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). The license does not grant rights to the HostHarbor trademarks.
