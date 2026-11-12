import assert from 'node:assert/strict';

export async function verifyOutboundSchema(db) {
  const { rows: [f] } = await db.query(`SELECT w."organizationId" AS org, w."workspaceId" AS ws,w.id AS wh,p.id AS product,u.id AS actor FROM "WmsWarehouse" w JOIN "ProductRecord" p USING ("organizationId","workspaceId") JOIN "User" u ON u.id=p."userId" LIMIT 1`);
  assert.ok(f);
  let invalid = 0;
  async function rejects(sql, code) {
    await db.query('SAVEPOINT invalid_outbound');
    try { await assert.rejects(() => db.query(sql), e => e.code === code); invalid++; }
    finally { await db.query('ROLLBACK TO SAVEPOINT invalid_outbound'); }
  }
  await db.query('BEGIN');
  try {
    await db.query(`INSERT INTO "WmsOutbound" (id,"organizationId","workspaceId","warehouseId",number,"createdBy","updatedAt") VALUES ('outbound-schema',$1,$2,$3,'OUTBOUND-SCHEMA',$4,now())`,[f.org,f.ws,f.wh,f.actor]);
    await db.query(`INSERT INTO "WmsOutboundLine" (id,"organizationId","workspaceId","warehouseId","outboundId","productRecordId","requestedQty","updatedAt") VALUES ('outbound-line',$1,$2,$3,'outbound-schema',$4,2,now())`,[f.org,f.ws,f.wh,f.product]);
    for (const update of ['"requestedQty"=0','"requestedQty"=-1','revision=0']) await rejects(`UPDATE "WmsOutboundLine" SET ${update} WHERE id='outbound-line'`,'23514');
    await rejects(`UPDATE "WmsOutbound" SET revision=0 WHERE id='outbound-schema'`,'23514');
    await rejects(`UPDATE "WmsOutbound" SET status='UNKNOWN' WHERE id='outbound-schema'`,'22P02');
    for (const field of ['organizationId','workspaceId','warehouseId','productRecordId']) await rejects(`UPDATE "WmsOutboundLine" SET "${field}"='outside-scope' WHERE id='outbound-line'`,'23503');
    await rejects(`INSERT INTO "WmsOutboundLine" SELECT 'duplicate-line',"organizationId","workspaceId","warehouseId","outboundId","productRecordId","requestedQty",revision,"createdAt","updatedAt" FROM "WmsOutboundLine" WHERE id='outbound-line'`,'23505');
    await rejects(`INSERT INTO "WmsOutbound" SELECT 'duplicate-header',"organizationId","workspaceId","warehouseId",number,customer,"deliveryAddress",carrier,"trackingNumber",remark,status,"createdBy",revision,"createdAt","updatedAt" FROM "WmsOutbound" WHERE id='outbound-schema'`,'23505');
    await rejects(`DELETE FROM "WmsOutbound" WHERE id='outbound-schema'`,'23503');
    assert.equal((await db.query(`SELECT status FROM "WmsOutbound" WHERE id='outbound-schema'`)).rows[0].status,'DRAFT');
    console.log(`PASS: outbound schema rejects ${invalid} invalid quantity/revision/status/scope/duplicate/deletion writes; no stock mutations`);
  } finally { await db.query('ROLLBACK'); }
}
