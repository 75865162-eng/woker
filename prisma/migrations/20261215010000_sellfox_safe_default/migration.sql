-- 只改变新增配置的默认开关；现有配置由执行期封闭白名单再次校验。
ALTER TABLE "SellfoxApiEndpoint" ALTER COLUMN "enabled" SET DEFAULT false;
