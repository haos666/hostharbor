# AI 配置

打开「系统设置 → AI 配置」，解锁后配置 OpenAI 或 Anthropic 协议。两种协议分别保存，最后保存的协议作为当前配置。

- **API 地址**：填写 API 基础地址，例如 `https://api.openai.com/v1` 或 `https://api.anthropic.com/v1`，兼容服务也支持自定义路径。根地址自动使用 `/v1`；不要填写 `/models`、`/messages` 或 `/chat/completions` 等具体接口。远程要求 HTTPS，本机 localhost、127.0.0.1、[::1] 可用 HTTP。
- **API Key**：加密保存在本机凭证库，不会回显。编辑时留空保留同协议同地址的旧 Key；改地址需重新填写。新输入只在当前表单中短暂保留，保存、切换协议、离开页面或锁定时清除。
- **模型**：点击「获取模型 / 测试连接」，从返回列表选择，也可手动输入模型 ID。兼容服务未提供模型列表时仍可直接保存模型 ID。模型列表最多读取 500 个，超出时提示，可手动填其他模型。

保存不会联网；获取模型仅向填写地址发送 API Key，请先核对地址。此页测试只读取模型列表，不发起推理、不发送服务器资产、SSH 凭证或操作日志；列表成功不代表该模型推理接口可用。服务器页的 [AI 调查](server-dossier.md) 另行确认后会发送采集结果并调用模型，请选择支持工具调用的实际模型 ID。OpenAI 首版使用 Chat Completions，不支持仅 Responses 的网关。清除某协议配置会删除其保存的地址、模型和 Key，其他协议不受影响。

认证头与列表参考：[OpenAI 官方 Models API](https://developers.openai.com/api/reference/resources/models/methods/list)、[Anthropic 官方 Models API](https://platform.claude.com/docs/en/api/models/list)。OpenAI 使用 Bearer；Anthropic 使用 x-api-key 和 anthropic-version。当前不提供 OAuth、Azure 专用部署参数或额外自定义认证头。

Anthropic 兼容网关若基础路径以 `/anthropic` 结尾，模型列表请求会补齐为 `/anthropic/v1/models`；已带 `/anthropic/v1` 时不重复添加。其他自定义路径原样作为版本化 API 基础路径。保存的地址及 Key 绑定不变，不尝试其他域名或跟随重定向。HTTP 404/405 提示接口不支持，429 提示限流。参考 [MiniMax 官方模型列表](https://platform.minimax.cn/docs/api-reference/models/anthropic/list-models)。

点击“测试模型能力”可使用当前已保存协议/地址/Key/模型，以固定合成样例验证两轮工具调用和结构化报告。不会连接 SSH 或发送真实资产，可能产生少量模型费用；有未保存修改时先保存。真实调查失败后也可在服务器档案中整理已有采集，无需重跑命令。
