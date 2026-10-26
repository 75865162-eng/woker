# Sellfox response shape fixtures

2026-10-25 经用户明确授权，以本机服务端配置、既有 Sellfox client 只读核验。库存响应为 pageNo/pageSize/totalPage/totalSize/rows；样本首页 100 行、总计 790 行。销量 productNum/salePrice 各返回 39 个 MSKU、单个请求店铺、2026-10-24 业务日及 USD 币种；日指标位于 productSaleDayOpenVo。

这些 fixture 保留经观察确认的解析字段与类型，将店铺、商品、数量、金额、分页总数替换为测试值；未包含密钥、token、真实商品标识或原始业务响应。它们是隔离测试样例，不是生产同步数据。空页及错误形状在测试中单独构造。在线 Listing 仍未核验。

映射：库存 sku → MSKU，commoditySku → 内部 SKU，fnSku → FNSKU，available → 可售库存（并非 totalInventory）；销量按 shopIds + 唯一 mskus + day 合并 productNum/salePrice，缺失指标保留 null，币种不一致拒绝合并。

`performance-ad-channel-costs.json`：2026-10-26 根据任务提供的前期 mining 键（adSpCost/adSdCost/adSbCost/adSbvCost/adSbsCost）构造的共享合约 fixture，非本轮 live API 样本。同步提取和 PGlite 投影共用，覆盖非零、0、null/非法与历史回填；SBV/SBS 使用任务指定中文标签，未另行网页核验。adTotalCost 已映射 adCost，不新增总计字段。
