import test from "node:test";
import assert from "node:assert/strict";
import { inboundUnits, mergeRestockDays, restockDailyRates, suggestRestockDate, suggestRestockQuantity } from "@/lib/sellfox/restock";
import { buildRestockRows } from "@/lib/sellfox/restock-read";

const today = "2026-11-06";

function days(quantity: number, stockout: string[] = []) {
  const end = "2026-11-04";
  const rows = [];
  for (let cursor = "2026-10-06"; cursor <= end; cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    rows.push({ date: cursor, quantity: stockout.includes(cursor) ? 0 : quantity, stockout: stockout.includes(cursor) });
  }
  return rows;
}

test("restock suggestion is zero when stock already covers demand, including a negative raw result", () => {
  assert.equal(suggestRestockQuantity({ fulfillable: 1000, inTransit: 0, daily: 1 }), 0);
  assert.equal(suggestRestockQuantity({ fulfillable: 400, inTransit: 0, daily: 10 }), 0);
  assert.equal(suggestRestockQuantity({ fulfillable: 10, inTransit: 4, daily: 2 }), 60);
  assert.equal(suggestRestockQuantity({ fulfillable: null, inTransit: 0, daily: 2 }), null);
  assert.equal(suggestRestockQuantity({ fulfillable: 10, inTransit: null, daily: 2 }), null);
  assert.equal(suggestRestockDate(today, 0), null);
  assert.equal(suggestRestockDate(today, 60), "2026-12-06");
});

test("stockout days are removed from the daily-rate divisor and are not filled with zero", () => {
  const stockouts = ["2026-11-03", "2026-11-04"];
  const rates = restockDailyRates(days(10, stockouts), today);
  assert.equal(rates.avg7, 10);
  assert.equal(rates.avg30, 10);
  assert.equal(rates.weighted, 10);
  const diluted = restockDailyRates(days(10).map((day) => stockouts.includes(day.date) ? { ...day, quantity: 0, stockout: false } : day), today);
  assert.ok(diluted.avg7 != null && diluted.avg7 < 10);
  assert.equal(restockDailyRates([], today).weighted, null);
  assert.deepEqual(mergeRestockDays([{ date: "2026-11-01", quantity: 0, stockout: true }, { date: "2026-11-01", quantity: 4 }]), [{ date: "2026-11-01", quantity: 4, stockout: false }]);
});

test("in-transit uses open shipment lines and refuses a line with missing quantity", () => {
  assert.equal(inboundUnits([{ status: "SHIPPED", declaredQty: 10, receivedQty: 4 }, { status: "CLOSED", declaredQty: 9, receivedQty: 0 }]), 6);
  assert.equal(inboundUnits([{ status: "CANCELLED", declaredQty: 10, receivedQty: 0 }]), 0);
  assert.equal(inboundUnits([{ status: "RECEIVING", declaredQty: 8, receivedQty: null }]), null);
});

test("restock rows group by ASIN and keep listing identity beside the suggestion", () => {
  const rows = buildRestockRows({
    today,
    groupBy: "asin",
    listings: [{
      id: "listing", storeId: "store", asin: "B000", msku: "MSKU", sku: "SKU", parentAsin: null, title: "标题", mainImage: "https://example.test/a.jpg",
      fulfillable: 10, reservedQty: 1, unsellable: 2, warehousing: 3, fulfillment: "AFN", shopExternalId: "shop", name: "店铺", marketplace: "US",
    }],
    sales: days(2).map((day) => ({ storeId: "store", msku: "MSKU", asin: "B000", reportDate: day.date, quantity: day.quantity })),
    shipments: [{ storeId: "store", msku: "MSKU", asin: "B000", status: "IN_TRANSIT", declaredQty: 4, receivedQty: 0 }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].asin, "B000");
  assert.equal(rows[0].msku, "MSKU");
  assert.equal(rows[0].sku, "SKU");
  assert.equal(rows[0].store, "店铺 / US");
  assert.equal(rows[0].fulfillable, 10);
  assert.equal(rows[0].inTransit, 4);
  assert.equal(rows[0].daily, 2);
  assert.equal(rows[0].suggest, 60);
  assert.equal(rows[0].mainImage, "https://example.test/a.jpg");
});
