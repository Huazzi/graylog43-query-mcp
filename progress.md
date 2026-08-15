# 进度记录

## 2026-08-15

- 修复 P0：`policy.test.ts` 中 `limit: 201` 抛错断言与 `maxLimit=500` 不一致（上限从 200 提到 500 时漏改测试），改为 `limit: 501` 抛错、`limit: 500` 通过、`limit: 0` 拒绝，并同步 `findings.md` 的最大返回值为 500。
- P1：新增 `search_stream_absolute` 工具（绝对时间窗 `from`/`to`，ISO 8601，`to` 缺省为当前时间；窗口上限复用 `maxRangeSeconds`/`maxWildcardRangeSeconds`，拒绝未来时间与 `from >= to`）。
- P1：两个搜索工具新增 `message_max_chars` 参数，默认 1024、`0` 不截断，超长 `message` 截断并追加 `…`。
- 测试从 6 项增至 15 项（绝对查询归一化、窗口/未来时间/逆序校验、`message_max_chars` 边界、absolute URL 形状、截断行为、stdio 工具列表 3→4），全部通过。
- P2：新增 `src/logger.ts`（JSON 行写入 stderr，级别 `debug/info/warn/error`，由 `GRAYLOG_LOG_LEVEL` 控制）。启动时输出摘要（profile、Graylog 主机、允许的 Stream），配置错误先记 `error` 日志再抛错；`GraylogClient` 注入 Logger，请求失败记 `warn`（含路径/状态码/耗时），成功记 `debug`。日志绝不包含 Token 或消息内容。默认级别后调整为 `warn`（经确认）。
- 日志下载 CLI：新增 `src/download.ts` 入口（`dist/download.js`，bin 名为 `graylog-dl`）。按 `--from/--to` 绝对时间窗、`--chunk-minutes`（缺省 60）分块调用 `/search/universal/absolute/export`（`format=json`）流式导出，按 `_id` 跨分块去重，逐行写入 JSONL（默认全字段），stdout 输出一行 JSON 摘要。`GraylogClient` 重构出共享 `request()`（支持 label/timeout），新增 `exportMessages`/`probeExport`。真实 stub 冒烟验证通过（探测、分块、去重、落盘）。测试增至 26 项。
- CLI 优化：`profile`/`stream` 支持位置参数简写（`graylog-dl tst precision ...`），与 `--profile/--stream` 二选一（混用报错）；新增相对时间 `--since`/`--until`（`m`/`h`/`d` 单位，`--until` 支持相对时长或 ISO），与 `--from/--to` 二选一。最短写法 `graylog-dl tst precision --since 3h`。`main` 改为显式传 `--profile` 给 `loadConfig`。测试增至 30 项。

## 2026-08-04

- 已创建项目级计划文件。
- 工作区仅有一个无关的 `feature-dev-codex` 目录和用户提供的截图；工作区根目录不是 Git 仓库。
- 确认 Node.js 24.18.0 和 npm 11.16.0 可用。
- 官方 MCP TypeScript SDK 当前建议使用 `serveStdio` 和 `registerTool`；Codex 手册在线抓取因网络限制失败，后续配置示例将同时附带 `codex mcp add` 命令。
- 首次依赖安装超时；在获准使用网络后发现预设的 SDK 版本 1.25.2 不存在。已查询 npm 并将版本改为 2.0.0，下一步采用修正版本安装。
- SDK 2.0.0 安装成功且 npm 审计无已知漏洞；策略测试 4 项通过。首次 TypeScript 构建发现 2.0 导出路径已改为包根和 `/stdio`，已针对实际包导出修正。
- 第二次构建暴露 `exactOptionalPropertyTypes` 与 Zod 可选字段推断不兼容；已让输入类型显式接受 `undefined`，保持严格编译选项不变。
- TypeScript 构建成功；5 项测试全部通过，其中 stdio 冒烟测试完成 MCP 初始化、工具发现和 `list_allowed_streams` 调用，且未访问真实 Graylog。
- 已补充 README、环境变量模板和 Codex 配置模板；新增 REST 客户端测试，验证固定 Stream filter、字段白名单、Token Basic Auth 形式以及 `_id`/索引信息不泄漏。
- 最终 `npm test` 共 6 项通过；依赖树正常。查询工具的输入 Schema 也只暴露当前 profile 的两个 Stream key。
- 完成检查脚本首次无法识别简写阶段列表（0/0）；已将计划改为技能要求的标准阶段/状态格式。
- 用户已在本地 `.env` 配置八个变量。确认 Node 不会默认加载 `.env` 后，改用原生 `--env-file` 启动方式；真实调用 `graylog_tst/list_allowed_streams` 成功，并同步修正文档和 Codex 配置模板。
