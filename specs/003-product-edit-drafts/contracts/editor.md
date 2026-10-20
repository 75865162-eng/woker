# 编辑与 API 契约

- POST /api/products 保持 product.revision；409 保持 conflict/currentRevision；不得用服务器当前 revision 代替用户预期版本。
- GET /api/products/:sku/detail 为冲突权威读取；workspaceId 显式作用域。
- GET video-plan 返回 revision；PUT video-plan 要求 revision，缺失或过期返回409。
- POST /api/audit/versions 的商品恢复要求 expectedRevision，来自用户确认前读取的权威详情；冲突返回409且不自动重试。
- 所有成功响应仅在聚合事务提交后返回；后置缓存/队列异常不得被误报为业务事务失败，Outbox 保留重试依据。
