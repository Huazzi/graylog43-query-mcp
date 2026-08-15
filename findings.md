# 发现记录

## 已验证的 Graylog 4.3 接口

- `GET /api/search/universal/relative` 返回 `application/json`，响应包含 `messages[].message`、`total_results`、`from`、`to` 和 `time`。
- Stream 限定使用 `filter=streams:<stream-id>`。
- `/views/search/messages*` 仅用于 CSV 导出，不能作为本项目查询接口。

## 固定 Stream 映射

- `tst_precision`: `67e3ccf43ed2537593dc8b6d`
- `tst_workflow`: `66d81be43ed253759370e307`
- `prd_precision`: `6881e2df3ed25375932a3799`
- `prd_workflow`: `66d7d1c53ed2537593704853`

## 查询策略

| 环境 | 默认 | 最大 | `query=*` 最大 | 最大返回 |
|---|---:|---:|---:|---:|
| 非正式 | 5400 秒 | 259200 秒 | 43200 秒 | 500 |
| 正式 | 3600 秒 | 86400 秒 | 7200 秒 | 500 |

## 依赖

- 官方 MCP TypeScript SDK 的可安装稳定版本为 `@modelcontextprotocol/server` 2.0.0；此前假设的 1.25.2 版本不存在，已改正。
