# Architecture Boundaries

本轮仅加固既有权限与 workspace 边界，不增加业务功能，不改变同步语义，不启用 Amazon Ads HTTP 写回。

## Workspace access

API 必须先通过 `requireApiPermission` 做服务端身份与模块动作校验，再以会话中的 `organizationId` 和请求中的 workspace ID 查询 `WorkspaceScope`。请求参数、header 和 Cookie 都不是授权依据；workspace 不存在或不属于当前组织时返回 403。新增或修改带 workspace 的 API 时使用 `assertWorkspaceAccess`，不要只把请求 ID 拼进业务查询条件。

## API authorization

API Route Handler 使用 `requireApiPermission(module, action, request)`。只有明确的 owner-only 管理操作才可使用集中定义的 owner helper。`middleware.ts` 只验证会话签名并处理未登录请求，不承担业务模块权限或数据范围判断。

`amazon_bulk_ad_role_permissions` Cookie 仅用于客户端展示/缓存提示，禁止用于 API 授权。服务端权限来自有效 session 对应的数据库成员角色和组织角色目录。

## Role source of truth

`OrganizationRosterRole`（经组织角色目录服务）是组织可配置角色与权限的真源；`OrganizationMember.role` 是成员当前角色的关系字段，写入值必须是 Prisma `OrganizationRole` 枚举中的合法角色。`OrganizationRolePermission` 是旧权限表，只允许兼容读取和迁移期 fallback，不再作为新写入目标。角色权限 Cookie 不是真源。

## Storage and recovery

PPC Workspace 的浏览器 IndexedDB 是设备级恢复/缓存机制；服务端 workspace snapshot、draft run 和文件元数据由数据库及 storage adapter 管理。Product Center 的 `ProductRecord` 仍是商品主资料事实源，不能与 PPC 本地恢复策略混为一谈。

本轮未切换存储、列表查询或同步路径。回滚仅需回退本轮 helper、调用点、测试和文档改动；不涉及数据库迁移。
