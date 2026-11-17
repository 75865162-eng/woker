-- DBA 审阅后在维护窗口执行；任何异常使整笔事务回滚。不会创建角色或设置密码。
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $isolation$
DECLARE
  r record;
  t record;
  s record;
  allowed boolean;
BEGIN
  -- PUBLIC 的权限不能对单个登录做 DENY；不自动撤销共享权限，以免破坏业务。
  -- DBA 必须先将业务授权迁移至专用角色，再移除 PUBLIC 表/列权限和 CREATE。
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
      LATERAL aclexplode(c.relacl) a
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_' AND a.grantee = 0
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace,
      LATERAL aclexplode(a.attacl) x
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_' AND x.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC 仍有应用对象表/列权限；请 DBA 显式迁移业务授权并撤销 PUBLIC 后重试';
  END IF;

  FOR r IN SELECT * FROM pg_roles WHERE rolname IN ('amazon_mcp_ro', 'sellfox_mcp_ro') LOOP
    IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
      OR NOT r.rolcanlogin THEN
      RAISE EXCEPTION '角色 % 属性不安全；请 DBA 先修正高权限属性及 LOGIN', r.rolname;
    END IF;
    -- NOINHERIT 不能阻止 SET ROLE；任何成员关系均拒绝，包含间接关系的起点。
    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) THEN
      RAISE EXCEPTION '角色 % 仍是其他角色成员；请 DBA 撤销成员关系（NOINHERIT 不足以隔离）', r.rolname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass
      AND refobjid = r.oid AND deptype = 'o') THEN
      RAISE EXCEPTION '角色 % 拥有对象；请 DBA 转移所有权后重试', r.rolname;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
      WHERE a.grantee IN (0, r.oid)
    ) OR EXISTS (
      -- 无全局函数默认 ACL 时，PostgreSQL 隐含向 PUBLIC 授予未来函数 EXECUTE。
      -- schema 级 REVOKE 不能取消该全局默认值，必须针对每个实际对象 owner 撤销。
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
        AND NOT EXISTS (SELECT 1 FROM pg_default_acl d
          WHERE d.defaclrole = c.relowner AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')
    ) THEN
      RAISE EXCEPTION '角色 % 或 PUBLIC 存在未来对象默认授权；请 DBA 按 owner/schema 清理默认权限', r.rolname;
    END IF;
    IF has_database_privilege(r.oid, current_database(), 'CREATE')
      OR has_database_privilege(r.oid, current_database(), 'TEMP') THEN
      RAISE EXCEPTION '角色 % 有数据库 CREATE/TEMP（可能来自 PUBLIC）；请 DBA 迁移并撤销后重试', r.rolname;
    END IF;
    FOR s IN SELECT * FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname !~ '^pg_' LOOP
      IF has_schema_privilege(r.oid, s.oid, 'CREATE') THEN
        RAISE EXCEPTION '角色 % 可在 schema % 创建对象；请 DBA 撤销 CREATE 后重试', r.rolname, s.nspname;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
        AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION '角色 % 可执行应用函数/过程；请 DBA 审核并撤销直接或 PUBLIC EXECUTE 后重试', r.rolname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('amazon_mcp_ro', 'sellfox_mcp_ro')) <> 2 THEN
    RAISE EXCEPTION '缺少 amazon_mcp_ro 或 sellfox_mcp_ro；请 DBA 使用安全凭证预建角色';
  END IF;

  FOR r IN SELECT * FROM pg_roles WHERE rolname IN ('amazon_mcp_ro', 'sellfox_mcp_ro') LOOP
    EXECUTE format('ALTER ROLE %I SET default_transaction_read_only = on', r.rolname);
    EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', r.rolname, '30s');
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), r.rolname);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r.rolname);
    FOR t IN SELECT c.*, n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') LOOP
      IF t.relkind = 'S' THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM %I', t.nspname, t.relname, r.rolname);
      ELSE
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I', t.nspname, t.relname, r.rolname);
        -- 表级 REVOKE 不会移除列级授权。
        FOR s IN SELECT attname FROM pg_attribute WHERE attrelid = t.oid AND attnum > 0 AND NOT attisdropped LOOP
          EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM %I', s.attname, t.nspname, t.relname, r.rolname);
        END LOOP;
        allowed := t.nspname = 'public' AND t.relkind IN ('r', 'p') AND
          ((r.rolname = 'amazon_mcp_ro' AND t.relname LIKE 'Amazon%') OR
           (r.rolname = 'sellfox_mcp_ro' AND t.relname LIKE 'Sellfox%'));
        IF allowed THEN
          EXECUTE format('GRANT SELECT ON TABLE %I.%I TO %I', t.nspname, t.relname, r.rolname);
        END IF;
      END IF;
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND ((r.rolname = 'amazon_mcp_ro' AND c.relname LIKE 'Amazon%') OR
             (r.rolname = 'sellfox_mcp_ro' AND c.relname LIKE 'Sellfox%'))
        AND has_table_privilege(r.oid, c.oid, 'SELECT')
    ) THEN
      RAISE EXCEPTION '角色 % 没有可读的本提供方表；拒绝空结果验收', r.rolname;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND (
          has_table_privilege(r.oid, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(r.oid, c.oid, 'INSERT,UPDATE,REFERENCES')
          OR ((has_table_privilege(r.oid, c.oid, 'SELECT') OR has_any_column_privilege(r.oid, c.oid, 'SELECT'))
            AND NOT (n.nspname = 'public' AND c.relkind IN ('r', 'p') AND
              ((r.rolname = 'amazon_mcp_ro' AND c.relname LIKE 'Amazon%') OR
               (r.rolname = 'sellfox_mcp_ro' AND c.relname LIKE 'Sellfox%'))))
        )
    ) THEN
      RAISE EXCEPTION '角色 % 授权后有效权限仍越界，事务回滚；请 DBA 排查共享授权', r.rolname;
    END IF;
  END LOOP;
END
$isolation$;
COMMIT;
