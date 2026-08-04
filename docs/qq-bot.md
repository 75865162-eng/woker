# QQ Bot 接入说明

## WebSocket 方式

本地直接启动 QQ Bot WebSocket worker，不需要公网域名，也不需要 Webhook：

```bash
npm run qq:codex-bot
```

启动后，worker 会连接 QQ Bot 网关，收到单聊或群聊 @ 消息后运行 `codex exec`，再把结果发回 QQ。

## 环境变量

在 `.env` 中配置：

```bash
QQ_BOT_APP_ID=你的机器人 AppID
QQ_BOT_SECRET=你的机器人 Secret
QQ_BOT_API_BASE_URL=https://api.bot.qq.com
QQ_BOT_SANDBOX=true
QQ_BOT_SIGNATURE_CHECK=true
QQ_BOT_CODEX_ENABLED=true
QQ_BOT_CODEX_BIN=codex
QQ_BOT_CODEX_WORKDIR=/path/to/repo
QQ_BOT_CODEX_SANDBOX=workspace-write
QQ_BOT_CODEX_MODEL=
QQ_BOT_ALLOWED_USER_IDS=
QQ_BOT_WS_INTENTS=1107296256
QQ_BOT_WS_RECONNECT_MS=5000
QQ_BOT_DEBUG_EVENTS=true
```

`QQ_BOT_SECRET` 会用于换取 QQ Bot access token 来连接 WebSocket 和主动回消息。Webhook 模式下也会用于 Ed25519 地址验证签名。生产环境不要关闭 `QQ_BOT_SIGNATURE_CHECK`。

`QQ_BOT_CODEX_WORKDIR` 是 Codex 执行代码任务的仓库目录。`QQ_BOT_CODEX_SANDBOX` 建议保持 `workspace-write`，不要直接给群聊入口使用 `danger-full-access`。

`QQ_BOT_ALLOWED_USER_IDS` 可以填逗号分隔的用户 ID 白名单；留空表示所有能给机器人发消息的人都能触发 Codex。

`QQ_BOT_WS_INTENTS` 默认 `1107296256`，包含单聊/群聊消息事件和频道 @ 消息事件。若 QQ 后台未给对应事件权限，需要在机器人管理后台开启对应事件订阅/权限。

## Webhook 方式

项目仍保留 QQ Bot Webhook 入口：

```text
POST /api/bots/qq/webhook
GET  /api/bots/qq/webhook
```

如果使用 Webhook，需要在 QQ 机器人开放平台把回调地址配置为：

```text
https://你的域名/api/bots/qq/webhook
```

## 当前支持的群聊命令

单聊机器人时，可以直接发自然语言需求。群聊里通常需要先 @ 机器人，再写需求。

支持的命令：

```text
/code 需求描述
/status 任务ID
```

没有显式命令的普通消息也会按 `/code` 处理。收到 `/code` 后，服务端会后台运行：

```bash
codex exec --cd "$QQ_BOT_CODEX_WORKDIR" --sandbox "$QQ_BOT_CODEX_SANDBOX"
```

完成后机器人会把 Codex 最终结果发回 QQ。

## 安全边界

- 不允许群聊消息直接执行 shell。
- 所有回调请求默认要求 QQ 签名校验。
- 建议上线前配置 `QQ_BOT_ALLOWED_USER_IDS` 白名单。
- Codex 执行目录限定在 `QQ_BOT_CODEX_WORKDIR`。
- 群聊入口不建议使用 `danger-full-access`。
