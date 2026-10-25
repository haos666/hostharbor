# SSH connection routes

Choose the route when editing a server:

- **Direct** uses the saved destination address and login credential.
- **SSH jump host** references a saved, credential-bound direct server and forwards one connection to the destination. Multi-hop chains are not supported.
- **SOCKS5** uses the configured proxy endpoint, with an optional separate password credential.

The jump host and destination keep independent host verification. Check fingerprints through a trusted channel before accepting a first connection; changed fingerprints block access. A successful connection test verifies SSH authentication, not a continuously online state or application health.

Network access comes from this computer. Connect your normal VPN when required. Proxy credentials and SSH credentials remain local; configuring a route does not expand an agent's server grant.

## 中文

在服务器编辑页选择直连、单层 SSH 跳板或 SOCKS5。跳板引用已保存且绑定凭证的直连服务器；SOCKS5 可绑定独立密码凭证。跳板和目标分别校验主机指纹，变化时拒绝连接。

测试连接仅验证主机身份及 SSH 认证，不代表持续在线或业务可用。本机需要 VPN 时仍由你正常连接；路由配置不扩大智能体的服务器授权范围。
