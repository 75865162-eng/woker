-- 双池数据库角色隔离（DDL，需 DBA 在维护窗口手动执行；本仓库不会自动执行）
--
-- 背景（2026-11-15 实测）：MCP_PG_READONLY_URL 使用的角色 sellfox_mcp_ro
-- 对 62 张 Amazon* 表持有 SELECT，数据库层没有双池隔离；目前仅靠应用层
-- assertProviderTable 的 Amazon*/Sellfox* 前缀封闭清单挡住跨池误用。
--
-- 执行顺序：先备份 → 执行本脚本 → 把 AMAZON_MCP_PG_READONLY_URL 配到 .env
-- → 运行 `node scripts/mcp-isolation/audit-roles.mjs` 复核（应输出 0 越权）。
-- 新增 Amazon*/Sellfox* 表后需重跑本脚本（没有自动 default privileges，避免过宽授权）。

-- 1) Amazon 独立只读登录。密码请现场替换，绝不写入版本库。
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amazon_mcp_ro') THEN
    CREATE ROLE amazon_mcp_ro LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
  END IF;
END
$do$;

GRANT USAGE ON SCHEMA public TO amazon_mcp_ro;

-- 2) 只给 Amazon 角色授 Amazon* 表，不授 ALL TABLES。
DO $do$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname = current_schema() AND tablename LIKE 'Amazon%' LOOP
    EXECUTE format('GRANT SELECT ON %I TO amazon_mcp_ro', t.tablename);
  END LOOP;
END
$do$;

-- 3) 撤销赛狐角色对 Amazon* 表的越权读取。
DO $do$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname = current_schema() AND tablename LIKE 'Amazon%' LOOP
    EXECUTE format('REVOKE SELECT ON %I FROM sellfox_mcp_ro', t.tablename);
  END LOOP;
END
$do$;

-- 4) PUBLIC 若仍持有 Amazon* 表 SELECT，角色级 REVOKE 会失效，必须一并撤销。
DO $do$
DECLARE t record;
BEGIN
  FOR t IN SELECT DISTINCT table_name AS tablename FROM information_schema.role_table_grants
           WHERE grantee = 'PUBLIC' AND table_schema = current_schema()
             AND table_name LIKE 'Amazon%' AND privilege_type = 'SELECT' LOOP
    EXECUTE format('REVOKE SELECT ON %I FROM PUBLIC', t.tablename);
  END LOOP;
END
$do$;

-- 5) 防御：Amazon 角色不得读任何 Sellfox* 表。
DO $do$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname = current_schema() AND tablename LIKE 'Sellfox%' LOOP
    EXECUTE format('REVOKE ALL ON %I FROM amazon_mcp_ro', t.tablename);
  END LOOP;
END
$do$;

-- 配置示例（.env，勿提交真实密码）：
-- AMAZON_MCP_PG_READONLY_URL=postgresql://amazon_mcp_ro:<password>@127.0.0.1:5432/<db>
