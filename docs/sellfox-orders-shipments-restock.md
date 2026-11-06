# 赛狐订单、FBA 货件与补货建议

页面只读快照。OpenAPI 只在 `npm run worker:sellfox-sync` 里调用。计划默认关闭。

## 路径

从侧栏 Sellfox 进入 `/sellfox`，在数据域导航中点击“全部订单”“货件”或“补货建议”。三个入口只导航到快照读取页面，不启动同步；页面无数据时仍需区分尚未采集与筛选无结果，不代表路由不存在。

| 页面 | API | 谁写入 | 表 |
|---|---|---|---|
| `/sellfox/orders` | `GET /api/sellfox/orders` | Worker 资源 `orders` | `SellfoxOrderSnapshot` |
| `/sellfox/shipments` | `GET /api/sellfox/shipments` | Worker 资源 `fba_shipments` | `SellfoxFbaShipmentSnapshot` |
| `/sellfox/restock` | `GET /api/sellfox/restock` | 不写表。读 Listing 当前视图、销量日快照、货件当前采集 | 无 |

三个 GET 都要 `sellfox:view`。手动同步仍走 `POST /api/sellfox/sync`，body.resource 为 `orders` 或 `fba_shipments`，需要 `sellfox:create`、Redis Worker 和服务端凭据。

## OpenAPI

- 订单：`POST /api/order/pageList.json`。店铺 `shopIdList`，日期 `dateType=purchase`，`dateStart` / `dateEnd` 为 `yyyy-MM-dd HH:mm:ss`。默认同步上海时间最近 7 天，最多 90 天。
- 货件：`POST /api/fba/shippingOrder/pageList.json`。店铺 `shopIds`。不传日期时翻完整当前列表；传入 `startDate` / `endDate` 时带 `createTimeStart` / `createTimeEnd`。
- 发货单状态 `1/2/3/-1` 记为 `WORKING` / `READY_TO_SHIP` / `SHIPPED` / `CANCELLED`。响应里已经是 Amazon 货件状态名时原样归一。
- 商品行必须在 `orderItemVoList` 或 `items`。缺身份、店铺不符、状态无法识别时，该店记入运行进度的 `error`，其他店继续。页面 `failures` 列出最近一次运行里失败的店。

## 补货

`建议补货量 = round(max(0, (30 + 7) * 加权日均 - (可售 + 在途)))`。

- 可售：`sellfox_listing_current.fulfillable`。预留、不可售、在仓只展示；任一成员缺失则该列为空，不当作 0。
- 在途：当前货件采集中状态属于 `SHIPPED`、`IN_TRANSIT`、`DELIVERED`、`CHECKED_IN`、`RECEIVING` 的 `max(0, declaredQty - receivedQty)`。数量缺失则在途和建议都为空。
- 日均：去掉今天和昨天。7/14/30 天窗口按 50% / 30% / 20% 加权；明确断货日与缺失销量记录不进分子也不进分母，有记录且销量明确为 0 的日子仍参与分母。三个窗口缺一则日均和建议为空。
- 建议补货日：建议量大于 0 时为今天加 30 天，否则为空。
- 按 ASIN 聚合；`dimension=msku` 时按 MSKU。

### 历史库存口径与数据完整性（2026-11-06）

- 断货证据来自同组织/工作区/店铺/MSKU/业务日的 `SellfoxFbaInventorySnapshot.quantity`（API 可售量）。同店同日取最新一次采集，再按 MSKU 汇总该批次各行；任一行数量缺失则该 MSKU 当日库存未知。只有明确合计为 0 才剔除当日销量；没有历史库存或数量未知时，不推断断货，不把销量 0 当作断货。
- ASIN 维度先按各 MSKU 的库存证据剔除断货成员，再合并当日销量；仍有有效成员时保留该日，仅所有已观察成员均断货时剔除。MSKU 维度不混入同 ASIN 的其他 MSKU。
- `readSellfoxRestock` 查询货件采集 head。无 head 时在途、建议量和建议日期为空；有 head 且无对应在途行时才为 0。失败店铺继续单列展示，历史成功 head 仍按既有规则读取。
- 两项额外批量查询：30 天有效窗口（今天往前第 31 至第 2 天）的历史库存，以及目标店铺的货件 head。库存查询限定组织、工作区、店铺和输出所需 MSKU，不读取 payload，也不逐商品查询；销量读取同步缩小到该 30 天窗口。不新增表、不启动同步、不执行迁移。
- 离线验证：`node node_modules/tsx/dist/cli.mjs --test tests/sellfox-restock.test.ts tests/sellfox-replica-read-api.test.ts tests/sellfox-order-shipment.test.ts tests/sellfox-schedule.test.ts`，另运行 TypeScript 与改动文件 lint。API 测试使用 mock 数据库，覆盖读取证据、断货剔除、未知库存和无货件采集的空值传播；尚未在真实数据库验证执行计划及 P95。日内最新快照仅代表该次观察，不代表全日持续断货。
- 回滚仅撤回补货读取代码与对应测试，不更改已有快照。历史库存保留量、最新采集完整性与数据库查询耗时仍是上线前的专项验证项。

## Schema

迁移 `20261106140000_sellfox_order_and_fba_shipment_snapshots`。

- 订单唯一键：`storeId + orderId + lineKey`。历史行保留，后一次同步覆盖同一行。
- 货件唯一键：`storeId + shipmentId + lineKey`。一家店整页成功后，删掉该店更早采集的行，并更新 `SellfoxSnapshotHead.resource = fba_shipments`。
- 读货件和在途只认 head 上的 `capturedAt`。

## 调度

`sellfoxScheduleIntervals.orders` 和 `fba_shipments` 都是 720 分钟。不走每天 06:30。Worker 仍按现有 `SellfoxSyncSchedule.enabled` 入队，默认 false。

## 回滚

先停用这两个资源的计划，再部署不含该读取的应用。迁移只向前：不要在生产执行 drop。需要废弃表时单独审迁移，删除 `SellfoxOrderSnapshot`、`SellfoxFbaShipmentSnapshot` 以及 `SellfoxSnapshotHead` 里 `orders` / `fba_shipments` 行。不回滚数据库里的其他赛狐快照，也不改 `ProductRecord`。

本机尚未用真实 `SELLFOX_CLIENT_ID` 对过响应。第一次真实同步若报「缺少 orderItemVoList」或「缺少商品行 items」，以失败店铺的错误为准改契约，不要猜字段补零。
