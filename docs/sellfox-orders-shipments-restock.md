# 赛狐订单、FBA 货件与补货建议

页面只读快照。OpenAPI 只在 `npm run worker:sellfox-sync` 里调用。计划默认关闭。

## 路径

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
- 日均：去掉今天和昨天。7/14/30 天窗口里，断货日和没有销量的日子不进分子也不进分母。加权为 7 天 50%、14 天 30%、30 天 20%。三个窗口缺一则日均和建议为空。
- 建议补货日：建议量大于 0 时为今天加 30 天，否则为空。
- 按 ASIN 聚合；`dimension=msku` 时按 MSKU。

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
