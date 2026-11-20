# Server tags / 服务器标签

服务器列表以“标签”列替代“最近测试”。连接测试按钮与即时结果反馈保留。

- 点击“管理标签”创建、改名、设置颜色或删除标签；修改后点击“保存标签”。
- 点击服务器行的标签或“未分类”，勾选该服务器使用的标签，也可在这里新建。
- 服务器页左侧为“全部”及自选的标签快捷筛选；在管理标签中勾选“加入选项卡”，最多 4 个标签（“全部”不占名额）。右侧下拉仍包含全部标签与未分类，和快捷选项卡共用筛选状态，可叠加搜索。
- 一个标签可绑定多台服务器，一台服务器可绑定多个标签。删除标签会解除关联，不会删除服务器。目录最多 200 个标签，每台最多 20 个；列表简略展示前两个，剩余数量合并显示。
- 标签元数据在本机加密保存。修改分类不会改变连接修订、授予权限或取消操作。
- 加密备份包含标签目录及关联。恢复时重新映射新服务器 ID；已有同名标签沿用本机颜色和选项卡偏好，新增标签的选项卡偏好按剩余名额恢复，已有服务器的关联不被覆盖。旧备份没有标签时照常恢复。包含标签的新备份应使用当前或更新版本导入。
- MCP `list_servers` 仅返回已授权服务器的标签名称与颜色，query 支持标签子串查找。分类匹配不是任务执行授权，目标不明确仍须确认。

The server list replaces “Latest test” with tags. Use **Manage tags** to create, rename, recolor or delete reusable tags, then save. Click a server's tags or **Untagged** to assign multiple tags. Choose **Show as tab** in Manage tags for up to four quick tag filters, alongside the permanent **All** button. The complete tag/untagged dropdown remains available and shares the same selection with the shortcuts; search can be combined with either.

Tags are encrypted local metadata, separate from connection revisions and authorization. Encrypted backups include the catalog and assignments; restored servers receive remapped assignments, existing same-name tags retain local colors and tab preferences, imported shortcuts use only available slots, and existing server assignments remain unchanged. Older backups without tags remain supported. MCP only exposes labels on authorized servers; tags never grant access.
