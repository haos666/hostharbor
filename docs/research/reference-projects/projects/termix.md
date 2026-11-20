# Termix

结论：适合借鉴资产组织和统一动作目录，不适合为了借鉴而引入完整插件平台。根许可证 Apache-2.0；本轮只审查核心仓库，未安装插件、运行 GUI 或验证插件功能。

## 核心源码确认

1. **动作目录与当前主机上下文结合。** PaletteEntry 具有全局/主机 scope、when 条件、titleKey 与关键词；条件/加载异常时不显示错误动作。未来可让打开服务器档案、文件、历史和审批拥有统一入口，并自然适配多语言。[动作与筛选目录](https://github.com/Termix-SSH/Termix/blob/73c15f7c58961c9b7b1c59661417527d8fbb825f/src/ui/shell/palette-registry.ts#L6)。
2. **资产树防御损坏引用。** 文件夹与 parentHost 分别组织；缺失父节点、不可访问节点和环路回落到有效位置，空文件夹可保留。[资产树构建](https://github.com/Termix-SSH/Termix/blob/73c15f7c58961c9b7b1c59661417527d8fbb825f/src/ui/sidebar/build-host-tree.ts#L5)。若我们增加分组/标签，不能把 UI 归组直接变成 MCP 批量执行授权。
3. **设置从能力目录生成。** Host feature sections 根据启用插件及贡献字段构建，并区分单机与默认设置，避免重复面板。[设置目录生成](https://github.com/Termix-SSH/Termix/blob/73c15f7c58961c9b7b1c59661417527d8fbb825f/src/ui/settings/host-feature-tabs.tsx#L46)。可学习内部注册表；现阶段无需开放运行第三方插件。
4. **连接关键路径预取主机指纹记录。** 避免在 key exchange 回调才读取数据库，考虑跳板链路的握手时限。[主机信息预取](https://github.com/Termix-SSH/Termix/blob/73c15f7c58961c9b7b1c59661417527d8fbb825f/src/backend/hosts/host-key-verifier.ts#L22)。我们已有自己的指纹校验，不据此建议自动信任主机。

## 限制与取舍

- README 的文件管理、AI、终端等能力位于独立插件仓库。本轮不把核心声明当作插件实现已验证；无 GUI 截图或交互测试，不判断其视觉质量和所有场景完成度。
- 多用户、角色、云同步、插件签名/安装、多个数据库后端都增加维护面，当前个人桌面产品不跟进。
- 同为 TypeScript/React 不代表能直接复制组件：依赖其类型、别名、UI 组件库和注册体系。先抽取需求与行为契约；如后续移植纯函数，单独审查源文件、依赖及版权/NOTICE。

## 对 HostHarbor 的用途

先维持现有分页列表与分组设置；资产数量增长后再引入标签/分组、全局检索和上下文动作。我们的服务器档案/应用索引仍作为智能体入口，不能被一个只面向人工操作的资产树替代。
