-- 通用端点支持自定义日期格式：财务类报表（/api/financial/v2/monthProfit/*）需要 yyyyMM / yyyyMMdd，
-- 与默认 yyyy-MM-dd 不同。dateFormat 让端点配置在拼请求时按各自格式输出 startDate/endDate。

ALTER TABLE "SellfoxApiEndpoint" ADD COLUMN "dateFormat" TEXT NOT NULL DEFAULT 'yyyy-MM-dd';
