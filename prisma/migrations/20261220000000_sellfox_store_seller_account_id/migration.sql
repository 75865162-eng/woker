-- B0 底座：赛狐店铺列表真实响应含 sellerId（Amazon Seller ID），
-- 落 SellfoxStore.sellerAccountId 用于与 Amazon Seller 对齐；缺失保留 NULL，不臆造。
-- 纯新增可空列，改动既有行无影响，可回滚。

ALTER TABLE "SellfoxStore" ADD COLUMN "sellerAccountId" TEXT;
