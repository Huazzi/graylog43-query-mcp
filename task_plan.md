# 任务计划：Graylog 4.3 只读 MCP

## 目标

实现一个本地 stdio MCP。它只访问已验证的 `GET /api/search/universal/relative`，将调用方的逻辑 Stream 名称映射为服务端固定的 Graylog Stream ID，并为非正式、正式环境实施不同的查询限额。

## 成功标准

1. 可通过 stdio 启动，并提供 `get_system_info`、`list_allowed_streams`、`search_stream` 三个工具。
2. 查询请求固定使用允许的 Stream 和字段，不暴露导出或写接口。
3. 非正式默认 90 分钟、正式默认 1 小时；各自的范围、全量查询范围和结果条数按已确认策略受限。
4. 有配置模板、使用说明和不含真实凭据的测试。

## 阶段

### 阶段 1：探索与结构

**状态：** complete

检查空工作区并确定最小 Node/TypeScript 项目结构。

### 阶段 2：核心实现

**状态：** complete

实现配置校验、Graylog REST 客户端和 MCP 工具。

### 阶段 3：配置与测试

**状态：** complete

添加配置示例、Codex 注册说明与自动化测试。

### 阶段 4：验证与复核

**状态：** complete

安装依赖、构建、运行测试并复核只读边界。

### 阶段 5：本地 `.env` 接入

**状态：** complete

使用 Node 原生 `--env-file` 加载本地配置，完成 `graylog_tst/list_allowed_streams` 实际调用，并更新 Codex 注册示例。

## 决策

- 使用 TypeScript 和官方 MCP TypeScript SDK，传输方式为 stdio。
- 使用当前 SDK 的 `serveStdio` 和 `registerTool` API；MCP stdout 只承载协议，诊断信息不写入日志内容。
- 不实现 CSV 导出、`/views/*` 或任何写操作。

## 验证结果

- TypeScript 严格模式构建通过。
- 6 项自动化测试通过，包括策略边界、固定 REST 参数、响应字段清洗和 stdio MCP 工具发现。
- 源码仅包含两个 GET 路径：`api/system` 和 `api/search/universal/relative`。
- 未使用真实 Token 或访问公司 Graylog；现场连通性需要配置只读 Token 后验证。
