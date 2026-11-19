import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20261223000000_quantity_float_to_decimal/migration.sql", import.meta.url),
  "utf8",
);
const restockRead = readFileSync(new URL("../src/lib/sellfox/restock-read.ts", import.meta.url), "utf8");

function modelBlock(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  assert.ok(start >= 0, `缺少模型 ${name}`);
  return schema.slice(start, schema.indexOf("\n}", start));
}

const quantityFields = ["reservedQty", "listingQuantity", "unsellable", "warehousing"];

test("SellfoxProductDailySnapshot 数量字段为 DECIMAL(20,4)", () => {
  const daily = modelBlock("SellfoxProductDailySnapshot");
  for (const field of ["refundNum", "evaluationSaleNum", "channelSaleNum"]) {
    assert.match(daily, new RegExp(`${field}\\s+Decimal\\?\\s+@db\\.Decimal\\(20, 4\\)`), `${field} 应为 Decimal(20,4)`);
    assert.doesNotMatch(daily, new RegExp(`${field}\\s+Float`));
  }
});

test("Listing 快照与画像的数量字段均为 DECIMAL(20,4)", () => {
  for (const model of ["SellfoxListingSnapshot", "SellfoxListingProfile"]) {
    const block = modelBlock(model);
    for (const field of quantityFields) {
      assert.match(block, new RegExp(`${field}\\s+Decimal\\?\\s+@db\\.Decimal\\(20, 4\\)`), `${model}.${field} 应为 Decimal(20,4)`);
      assert.doesNotMatch(block, new RegExp(`${field}\\s+Float`), `${model}.${field} 不应再是 Float`);
    }
  }
});

test("数量迁移先 DROP 依赖视图，再 ALTER 全部 11 列，最后按最新定义重建视图", () => {
  assert.match(migration, /DROP VIEW IF EXISTS "sellfox_profit_daily"/);
  assert.match(migration, /DROP VIEW IF EXISTS "sellfox_listing_current"/);

  for (const [table, fields] of [
    ["SellfoxProductDailySnapshot", ["refundNum", "evaluationSaleNum", "channelSaleNum"]],
    ["SellfoxListingSnapshot", quantityFields],
    ["SellfoxListingProfile", quantityFields],
  ] as const) {
    for (const field of fields) {
      assert.match(
        migration,
        new RegExp(`ALTER TABLE "${table}" ALTER COLUMN "${field}" TYPE DECIMAL\\(20,4\\) USING "${field}"::numeric\\(20,4\\)`),
        `缺少 ${table}.${field} 的 ALTER`,
      );
    }
  }

  assert.match(migration, /CREATE VIEW "sellfox_profit_daily"/);
  assert.match(migration, /CREATE OR REPLACE VIEW sellfox_listing_current/);
});

test("迁移重建的视图包含数量字段，且 listing_current 使用最新 promoPrice 定义", () => {
  const profitView = migration.slice(migration.indexOf('CREATE VIEW "sellfox_profit_daily"'), migration.indexOf("CREATE OR REPLACE VIEW sellfox_listing_current"));
  for (const field of ["refundNum", "evaluationSaleNum", "channelSaleNum"]) {
    assert.match(profitView, new RegExp(`"${field}"`), `profit_daily 视图应继续暴露 ${field}`);
  }
  const listingView = migration.slice(migration.indexOf("CREATE OR REPLACE VIEW sellfox_listing_current"));
  for (const field of quantityFields) {
    assert.match(listingView, new RegExp(`"${field}"`), `listing_current 视图应继续暴露 ${field}`);
  }
  assert.match(listingView, /"promoPrice"/, "listing_current 必须保留 promoPrice 列（最新版本）");
});

test("restock raw 读取把 Decimal 数量列显式转回 float8，保持 number 契约", () => {
  assert.match(restockRead, /"reservedQty"::float8 AS "reservedQty"/);
  assert.match(restockRead, /unsellable::float8 AS unsellable/);
  assert.match(restockRead, /warehousing::float8 AS warehousing/);
});

test("数量使用 DECIMAL 运算无浮点误差", () => {
  const a = new Prisma.Decimal("0.1");
  const b = new Prisma.Decimal("0.2");
  assert.equal(a.add(b).toString(), "0.3");
  assert.equal(new Prisma.Decimal("3").mul(new Prisma.Decimal("0.0001")).toString(), "0.0003");
});
