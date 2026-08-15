# Graylog 4.3 只读 MCP

这是一个面向公司自建 Graylog 4.3 的本地 stdio MCP。它只调用已经验证可返回 JSON 的：

```text
GET /api/search/universal/relative
```

它不包含 CSV 导出、`/views/*`、告警管理、配置修改或其他写操作。

## 工具

- `get_system_info`：验证连接并读取 Graylog 报告的版本。
- `list_allowed_streams`：列出当前进程允许使用的逻辑 Stream。
- `search_stream`：按相对时间窗（`range_seconds`）查询一个允许的 Stream，仅返回 `timestamp`、`source`、`level`、`app_name` 和 `message`。
- `search_stream_absolute`：按绝对时间窗（`from`/`to`，ISO 8601）查询一个允许的 Stream，返回字段与 `search_stream` 一致。

一个 MCP 进程只加载一个环境：

- `--profile tst`：仅允许两个非正式 Stream。
- `--profile prd`：仅允许两个正式 Stream。

## 安装与构建

要求 Node.js 20 或更高版本。在项目根目录执行：

```bash
npm install
npm test
```

`npm test` 会先完成 TypeScript 构建，再运行策略测试和 stdio 协议冒烟测试。编译入口为项目根下的 `dist/index.js`。

### CI

[.github/workflows/ci.yml](./.github/workflows/ci.yml) 在 push 到 `main` 及所有 PR 上运行，按 Node 20 / 22 / 24 三个版本矩阵执行 `npm ci && npm test`。测试全部自包含（不访问真实 Graylog），因此无需在 GitHub Secrets 中配置任何 Token。

## 凭据与环境变量

为正式和非正式环境分别申请只读 API Token。Token 继承所属 Graylog 用户权限，因此 Graylog 用户本身也必须只能读取相应 Stream。

不要把真实 Token 写入源码、README 或 Git。本项目支持把以下变量放在项目根目录的 `.env` 中；该文件已被 `.gitignore` 排除。也可改用用户环境变量或公司密钥管理工具：

```text
GRAYLOG_TST_BASE_URL
GRAYLOG_TST_TOKEN
GRAYLOG_TST_PRECISION_STREAM_ID
GRAYLOG_TST_WORKFLOW_STREAM_ID

GRAYLOG_PRD_BASE_URL
GRAYLOG_PRD_TOKEN
GRAYLOG_PRD_PRECISION_STREAM_ID
GRAYLOG_PRD_WORKFLOW_STREAM_ID
```

变量清单与占位示例已整理在 [.env.example](./.env.example)，复制为 `.env` 后替换其中的 `replace-with-...` 占位符。`BASE_URL` 填 Graylog 根地址，不要在结尾添加 `/api`。例如：

```text
http://graylog.example.internal:9000
```

服务使用 Graylog API Token 的 Basic Auth 形式：用户名为 Token，密码固定为 `token`。普通账号密码不会被读取。

## 注册到 Claude Code

推荐用 **`--scope user` 注册一次**，即可在**所有项目**中调用（写入 `~/.claude.json`，仅本机、不入库）。在项目根目录运行：

```bash
# $PWD 展开为当前目录绝对路径；注册后任意目录的项目都能用
claude mcp add --transport stdio --scope user graylog_tst \
  -- node --env-file="$PWD/.env" "$PWD/dist/index.js" --profile tst
claude mcp add --transport stdio --scope user graylog_prd \
  -- node --env-file="$PWD/.env" "$PWD/dist/index.js" --profile prd

# 从任意目录确认两个 server 已连接
claude mcp list
```

两个 server 应显示 `✔ Connected`。新加入的 server 首次会弹批准提示；改过配置后需**重启 Claude Code 会话**才生效。

如果只想在某个项目内使用、或希望配置随仓库入库（同事 clone 后即可用），则改用 `--scope project`，会写入项目根 [.mcp.json](./.mcp.json)，其中的路径用 `${CLAUDE_PROJECT_DIR:-.}` 展开，Windows 与 macOS 通用，不包含 Token。注意：同一个名字**不要同时**在 user 和 project 两个范围注册，否则 `claude mcp list` 会提示 scope 冲突；保留一个即可（`claude mcp remove <名字> -s <scope>` 删除多余的）。

```bash
# 仅本项目使用（随仓库入库）
claude mcp add --transport stdio --scope project graylog_tst \
  -- node --env-file="$PWD/.env" "$PWD/dist/index.js" --profile tst
claude mcp add --transport stdio --scope project graylog_prd \
  -- node --env-file="$PWD/.env" "$PWD/dist/index.js" --profile prd
```

## 注册到 Codex

推荐使用 Codex CLI 注册（`codex mcp add` 与 Claude 的 `claude mcp add` 相互独立，两边各自维护配置）：

```bash
# 在项目根目录运行；$PWD 展开为当前目录绝对路径
codex mcp add graylog_tst -- node --env-file="$PWD/.env" "$PWD/dist/index.js" --profile tst
codex mcp add graylog_prd -- node --env-file="$PWD/.env" "$PWD/dist/index.js" --profile prd
codex mcp list
```

如果你通过 `config.toml` 管理 MCP，可参考 [codex-config.example.toml](./codex-config.example.toml)。放入项目级配置（项目根 `.codex/config.toml`）时，`cwd="."` 即项目根，相对路径 `--env-file=.env` 与 `./dist/index.js` 直接可用；放进全局 `~/.codex/config.toml` 则需改为绝对路径或调整 `cwd`。模板不包含 Token 值。

注册后重新启动 Codex，并先发起 Stream 探测指令：

```text
调用 graylog_tst 的 list_allowed_streams
```

确认只出现两个非正式 Stream，再调用 `get_system_info` 和一条 `limit=1` 的测试查询。正式环境同理。Claude Code 下工具通过 `mcp__graylog_tst__<工具名>` 命名空间调用，效果一致。

## 日志下载 CLI

MCP 查询工具适合交互式检索（小结果集、裁剪字段、限时限量）。需要把某时间窗的完整日志批量下载到本地做离线分析时，请用独立 CLI `dist/download.js`。`npm run build && npm link` 一次后可直接用简写 `graylog-dl`。它复用同一份 `.env` 与 Stream 映射，按时间分块导出、逐行追加写入一个 JSONL 文件，并按消息 `_id` 去重。

```bash
# 相对时间（最近 3 小时）——最短写法
graylog-dl tst precision --since 3h --query 'level:3'

# 绝对时间（指定窗口）——等效
node dist/download.js tst precision --from 2026-08-14T10:00:00.000Z --to 2026-08-14T12:00:00.000Z
```

`profile` 和 `stream` 可写成位置参数 `graylog-dl tst precision ...`，也可用显式 `--profile tst --stream precision`（二选一，不要混用）。`stream` 支持 `precision` / `workflow` 或完整 key（如 `tst_precision`）。

时间范围两种形式二选一：

| 形式 | 参数 | 说明 |
|---|---|---|
| 相对 | `--since 3h` | 必填；单位 `m`/`h`/`d`，`from = 当前 − 时长` |
| 相对 | `--until 1h` | 可选；窗口终点，缺省为当前时刻；支持相对时长或 ISO 时间戳 |
| 绝对 | `--from` / `--to` | ISO 8601 起止时间，`from` 必须早于 `to` |

其他参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `--query` | ⭕ | Graylog/Lucene 查询，缺省 `*`，≤1024 字符 |
| `--fields` | ⭕ | 逗号分隔的导出字段；缺省导出全字段；开启去重时自动补 `_id` |
| `--out` | ⭕ | 输出文件路径；缺省 `downloads/<profile>-<stream>-<from>-<to>.jsonl` |
| `--chunk-minutes` | ⭕ | 时间分块大小（分钟），缺省 60，避免单次导出过大 |
| `--no-dedup` | ⭕ | 关闭按 `_id` 去重 |

行为说明：

- 输出为 JSON Lines（每行一条消息），默认导出**全字段**（含 `_id`、自定义字段）。
- 先探测一次导出接口确认可用，再分块下载；每个分块独立请求。
- 按 `_id` 跨分块去重；重复执行是幂等的（同 `--out` 会覆盖写，不会产生重复条目）。
- 完成时在 **stdout** 输出一行 JSON 摘要 `{"file","total","deduped","windows"}`，供自动化/agent 读取；进度日志走 stderr。
- 下载的是完整原始消息，可能含敏感自定义字段，请按公司规范存放。

首次使用前建议在你的 Graylog 实例上验证导出接口（本仓库测试未覆盖真实实例）：先跑一个很短的 `--from/--to` 范围试一次，确认 `format=json` 返回 JSON Lines。

## 查询限制

| 环境 | 默认时间窗 | 最大时间窗 | `query=*` 最大时间窗 | 最大结果数 |
|---|---:|---:|---:|---:|
| 非正式 | 90 分钟 | 72 小时 | 12 小时 | 500 |
| 正式 | 1 小时 | 24 小时 | 2 小时 | 500 |

共同限制：

- `offset` 最大为 1000。
- 查询字符串最大为 1024 个字符。
- Stream ID 由服务端根据 `stream_key` 映射，调用方不能传入或覆盖 Graylog `filter`。
- 排序固定为 `timestamp:desc`，`decorate=false`，返回字段固定为五项。
- HTTP 超时为 20 秒；错误结果不会包含 Graylog 原始响应体，避免日志内容泄漏。
- `message_max_chars` 默认 1024，`0` 表示不截断；`message` 字段超过该长度时截断并追加 `…`，其余字段不截断。
- `search_stream_absolute` 的窗口（`to - from`）上限与相对查询一致，`from`/`to` 都不可晚于当前时间，且 `from` 必须早于 `to`。

## 诊断与日志

服务器把诊断日志写入 **stderr**（MCP 协议只占用 stdout），因此不会干扰协议流量。日志是每行一个 JSON 对象，包含 `ts`、`level`、`logger`、`message` 及结构化字段。

- `GRAYLOG_LOG_LEVEL=debug|info|warn|error`，缺省 `warn`。
- `warn`（缺省）：只输出配置错误与请求失败告警（HTTP 错误状态、无响应、非法 JSON）。
- `info`：额外输出启动摘要（profile、Graylog 主机、允许的 Stream）和下载进度。
- `debug`：额外输出每次请求成功的详情（接口路径、状态码、耗时），便于定位慢查询。
- 日志**绝不包含 Token 或日志消息内容**。

排查 server 无法启动或查询异常时，先用 `claude mcp list` 确认连接状态，再把 `GRAYLOG_LOG_LEVEL` 调为 `debug` 重启会话观察 stderr。

## 已知限制

- `offset` 被 Graylog 服务端封顶为 1000；需要超过 1000 条结果时，请收窄查询条件或缩小时间窗。
- Graylog 4.3 已移除旧版聚合接口（`/search/universal/relative/terms`、`stats`、`histogram`，自 4.0 起），本项目因此不提供按字段统计、直方图等聚合工具；相关能力需要 Graylog Views API，不在本项目范围内。
- 消息默认按 `message_max_chars` 截断以控制上下文占用；需要完整日志时传入 `message_max_chars=0`。

## 网络安全

当前公司实例使用内网 HTTP 时，MCP 只能在受控内网设备上运行。条件允许时，应在 Graylog 前配置公司可信的 HTTPS 反向代理；不要为了兼容自签名证书而关闭 TLS 校验。
