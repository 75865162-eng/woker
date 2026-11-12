# 商品管理移植：具体变更清单

当前实施与验证结果见 [本地交付记录](product-amazon-ads-delivery-2026-11-12.md)。用户后续“全量一次性移植到位”已授权本地代码及隔离验证；原确认单以下保留设计时点，真实数据库迁移和部署仍未执行。实际品牌/分类共用 ProductCatalogEntry 的 BRAND/CATEGORY 类型字典，未增加两张平行字典表。

日期：2026-11-12。目标为当前本地 ERP 工作树，范围依据用户要求：商品、SKU、ASIN、FNSKU、组合品、包装规格、商品分类、品牌和供应商关系。本文是实施前的共享模型/接口变更确认单，不代表以下功能已经开发完成。

## 已核实的来源与目标差异

源根目录 `/Users/chenjieliang/Documents/wimoor`。

| 能力 | Wimoor 真实实现证据 | ERP 当前实现及移植行为 |
| --- | --- | --- |
| 商品/SKU | ERP `material/pojo/entity/Material.java`；`MaterialServiceImpl.saveAllInfo:309` 起，保存主档前 trim SKU | 沿用 ProductRecord、工作区 SKU 唯一性、现有创建/编辑及工作流；不创建第二套 Material 主档，不替换现有自动 SKU 规则 |
| ASIN/FNSKU | Amazon `product/pojo/entity/ProductInfo.java:32-42,107-123` 具有 sku、asin、marketplaceid、amazonAuthId、fnsku；`resources/mapper/product/ProductInfoMapper.xml:174-201,245-333` 通过公司及映射后的本地 SKU 关联物料 | 主 ASIN 现有字段保留其用途；新增带卖家账号/站点/卖家 SKU 的标识关联。手工维护的关联不冒充同步发现的 Amazon 事实，不从文本相同推断跨店归属 |
| 组合品 | `material/pojo/entity/Assembly.java` 的 mainmid/submid/subnumber/remark；`MaterialServiceImpl:324-332` 校验用量正数；`:402-440` 有运行中组装单时限制修改 | 商品组成关系保存同工作区子商品稳定 ID、用量及备注；禁止自引用、重复及循环。源正整数用量沿用；循环防护为目标新增校验。商品组成不自动改变库存或产生组装单 |
| 包装规格 | Material 的 itemDimensions/pkgDimensions/boxDimensions/boxnum；DimensionsInfo 保存长宽高重量和单位，其 Map 构造器默认 cm/kg | 复用已有 productSizeCm/packageSizeCm、productWeightG/packageWeightG；补外箱尺寸、外箱毛重和单箱数量。明确目标 cm/g，源 kg 转 g，未知保持未填写，不能伪造零观测 |
| 分类 | Material.categoryid；MaterialCategory 的 name/number/color/remark/shopid；MaterialCategoryServiceImpl 的查询按 shopid 限定 | 新增当前工作区商品分类字典及商品引用。源是平级分类，本批不虚构多级类目或 Amazon Browse Node 关系 |
| 品牌 | Material.brand/brandid；MaterialBrand 的 name/remark/shopid；MaterialBrandServiceImpl 按 shopid 查询 | 新增工作区品牌字典及主档引用，现有 ProductMaster.brand 仍为派生显示；品牌维护不等于 Amazon 品牌备案 |
| 供应商关系 | MaterialSupplier 的 materialid/supplierid/purchaseUrl/productCode/deliverycycle/isdefault/MOQ；MaterialServiceImpl:339-340 调用 saveOrUpdateSupplier；该方法维护默认供应商及主档采购字段 | 复用已有组织 Supplier 与 ProductSupplier 投影；扩展主档为多供应商关系并选一个主供应商。商品工作区关系不改变 Supplier 的组织级职责。现有选品供应商对比表保留其研究用途，不自动成为正式供货关系 |

源码证据证明上述字段与方法存在；源完整运行、Amazon 账户授权及线上行为没有在本次验证。SKU、商品状态、图片/附件、会议记录、专利、利润试算和选品表等现有入口全部保留。

## 目标字段及写入边界（设计，待实施）

ProductRecord.payload 继续是商品扩展事实的存储位置，统一新增 `management` 契约，不向投影独立写入商品事实：

- `brandId`、`categoryId`：可空的同工作区字典引用。
- `carton`：可空；`lengthCm/widthCm/heightCm/grossWeightG` 为可空十进制字符串，`unitsPerCarton` 为可空正整数。已有商品与包装尺寸字段复用，不复制另一份。
- `components`：`productRecordId/quantity/notes`；quantity 正整数，同组织/工作区稳定商品引用。
- `listingIdentifiers`：`sellerAccountId/marketplaceId/sellerSku/asin/fnsku`；账号与站点须经现有实时授权验证，FNSKU 可空，不做跨卖家全局唯一声明。
- `suppliers`：`supplierId/supplierSku/productUrl/purchaseLeadTime/moq/isPrimary/notes`；校验可用供应商、重复关系与唯一主供应商。现有 supplierName/supplierUrl/purchaseLeadTime 列表展示从正式主关系解析，不引入客户端可独立写入的第二份关系事实。

上述是目标 TypeScript 契约设计，不称为 Wimoor 同名字段。管理字段缺失表示未建立该信息，读取/编辑不得清空其他既有商品扩展。版本恢复继续复用聚合入口，恢复引用须验证当前作用域与有效性。

品牌和分类用新增 Prisma 字典保存，各有 organizationId/workspaceId、稳定 ID、名称、备注、revision、停用标记及作用域唯一约束；分类额外保存源已确认的编码/颜色。新增迁移只增表与约束，不删除 ProductRecord 或现有业务表，不批量回填。不存在的/跨工作区字典引用在服务端拒绝；被引用字典以停用保留历史，不级联删除商品。

ProductMaster/ProductSupplier 等继续是可重建派生层，投影从主档按 sourceRevision 重建。投影不能另创未授权供应商、把旧单供应商投影路径删掉多供应商关系，或反向覆盖主档。

## 文件与入口范围（待实施）

| 文件/边界 | 具体变更 |
| --- | --- |
| `prisma/schema.prisma`、一份新迁移 | 新增 ProductBrand/ProductCategory 字典、租户/工作区关系及约束；不执行既有库迁移 |
| `src/lib/products/types.ts`、新增 `management-contract.ts` | 正式类型、运行时字段/数量/十进制/重复校验；金额与精密数值用字符串 |
| 新增 `management-service.ts`、`catalog-service.ts` | 复用组织/工作区/账号实时授权；聚合事务中校验引用、组合循环、主供应商及标识范围；字典 revision/审计 |
| `product-aggregate-service.ts`、`product-record-repository.ts` | 接入统一验证与事实保存，保持附件、审计、revision、Outbox 原子性；覆盖普通保存和版本恢复入口 |
| `product-center-projection.ts`、`product-detail-service.ts` | 派生品牌与多供应商关系，详情返回当前管理事实及受控选择上下文；投影缺失不影响事实读取 |
| `/api/products`、新增 `/api/products/catalogs` | 保存沿原入口；字典 GET/POST 复用 products 权限及服务，不增加 MCP 或平行 SQL 口径；校验失败返回 4xx |
| 新增 `src/components/products/product-management-fields.tsx`；现有编辑器与 draft 转换 | 原商品编辑器挂载品牌/分类、外箱、组合品、标识和多供应商维护，选择已有实体、可新增字典；复用既有商品/供应商分页查询，禁止一次载入全仓数据 |
| 商品相关 unit/integration/browser 测试及本文件 | 覆盖实际编辑器入口、保存回读、权限隔离、并发冲突、投影及恢复；记录源能力/目标扩展与实际测试结果 |

不修改 Root/Layout、认证 Provider 或导航，不新增全局轮询、微服务、缓存或 Worker。若实施发现必须扩大该范围，先记录实际依赖与影响再处理。

## 风险、回退与验证

1. **共享商品契约**：采购、WMS、Listing AI 和导出可能读 Product；新字段经主聚合保存，检查调用者是否裁剪 payload，防止其他入口保存时丢失。现有列表主读路径与分页保持不变。
2. **历史关系/投影**：单供应商与新多关系的契约需要一次明确收口；不得通过投影按名称新建另一份 Supplier，或将研究供应商自动转正式关系。没有实际数据验证前不批处理旧数据。
3. **外部身份**：FNSKU/ASIN 关联只证明目标端维护的绑定，不创建或修改 Amazon Listing，不调用 SP-API/Ads 写接口。
4. **组合品**：组成保存与库存组装分离；现有库存、FBA、采购单不可被主档编辑自动回算或重写。本批无库存数量变化。
5. **回退**：关闭新增 UI/写入入口并保留已保存扩展、字典与审计；不得用旧全量保存覆盖新字段。数据库不自动反向迁移、不删新增事实。本地改动只回退本任务独立 diff，保留已有未提交修改。
6. **隔离验证**：先审阅脚本；单测覆盖数据格式/循环/引用，临时库测试作用域、revision、保存/恢复、投影重建和关系防丢；浏览器从真实编辑器入口操作并保存回读。仅在明确空临时 PostgreSQL 执行迁移，不加载根 .env/真实凭据。API/共享逻辑按风险执行相关测试、lint 与 typecheck；准备合码再跑完整 check。

## 本次确认边界

仓库 AGENTS.md 的要求是：“若可能影响共享模型、权限、路由/API 契约、构建、部署、存储、Worker、定时任务或多个模块，先说明影响、回滚和验证方案并获得确认。”上述方案涉及共享 Product 类型、Prisma 字典、商品 API 与投影，因此在修改这些边界前确认这份具体范围。

确认只覆盖上述本地代码、迁移文件编写和隔离验证。既有数据库迁移、Wimoor 历史数据导入、真实 Amazon 调用、提交/推送和生产发布分别授权。本文件尚未获本轮具体范围确认时，不能把“用户要求移植”写成已同意执行数据库迁移。
