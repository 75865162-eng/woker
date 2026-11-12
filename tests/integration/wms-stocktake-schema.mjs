import assert from 'node:assert/strict';

// Called only inside the disposable PostgreSQL runner, after its first-loop fixtures.
export async function verifyStocktakeSchema(db) {
  const { rows: [fixture] } = await db.query(`
    SELECT l."organizationId", l."workspaceId", l."warehouseId", l.id AS "locationId",
      lot.id AS "lotId", u.id AS "userId", c.id AS "commandId"
    FROM "WmsLocation" l
    JOIN "WmsLot" lot USING ("organizationId", "workspaceId")
    JOIN "WmsCommand" c USING ("organizationId", "workspaceId")
    JOIN "User" u ON u.id = c."actorUserId"
    LIMIT 1`);
  assert.ok(fixture, 'first-loop fixtures exist');
  const { organizationId: org, workspaceId: ws, warehouseId: wh, locationId: loc, lotId: lot, userId: user, commandId: command } = fixture;
  let rejected = 0;
  async function rejects(sql, params, code, constraint) {
    await db.query('SAVEPOINT invalid_input');
    try {
      await assert.rejects(() => db.query(sql, params), error => error.code === code && (!constraint || error.constraint === constraint));
      rejected++;
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT invalid_input');
      await db.query('RELEASE SAVEPOINT invalid_input');
    }
  }
  await db.query('BEGIN');
  try {
    await db.query(`INSERT INTO "WmsStocktake" ("id","organizationId","workspaceId","warehouseId","number","createdBy","updatedAt")
      VALUES ('stocktake-schema', $1,$2,$3,'SCHEMA-COUNT',$4,now())`, [org,ws,wh,user]);
    await rejects(`UPDATE "WmsStocktake" SET "workspaceId"='other-workspace' WHERE id='stocktake-schema'`, [], '23503');
    await rejects(`UPDATE "WmsStocktake" SET "organizationId"='other-org' WHERE id='stocktake-schema'`, [], '23503');
    for (const update of [
      '"status"=\'COUNTING\'',
      '"status"=\'POSTED\',"startedAt"=now()',
      '"postedAt"=now()',
      '"revision"=0',
      '"startedAt"=now()',
    ]) await rejects(`UPDATE "WmsStocktake" SET ${update} WHERE id='stocktake-schema'`, [], '23514', 'WmsStocktake_metadata_check');
    await db.query(`INSERT INTO "WmsStocktakeLocation" ("id","organizationId","workspaceId","warehouseId","stocktakeId","locationId")
      VALUES ('stocktake-range',$1,$2,$3,'stocktake-schema',$4)`,[org,ws,wh,loc]);
    await rejects(`INSERT INTO "WmsStocktakeLocation" ("id","organizationId","workspaceId","warehouseId","stocktakeId","locationId")
      VALUES ('duplicate-range',$1,$2,$3,'stocktake-schema',$4)`,[org,ws,wh,loc], '23505', 'WmsStocktakeLocation_scope_location_key');
    await db.query(`INSERT INTO "WmsWarehouse" ("id","organizationId","workspaceId","code","name","updatedAt")
      VALUES ('count-other-wh',$1,$2,'COUNT-OTHER','Synthetic other warehouse',now())`,[org,ws]);
    await rejects(`UPDATE "WmsStocktakeLocation" SET "warehouseId"='count-other-wh' WHERE id='stocktake-range'`,[], '23503', 'WmsStocktakeLocation_stocktake_fkey');
    await db.query(`INSERT INTO "WmsStocktake" ("id","organizationId","workspaceId","warehouseId","number","createdBy","updatedAt")
      VALUES ('count-other-header',$1,$2,'count-other-wh','COUNT-OTHER',$3,now())`,[org,ws,user]);
    await rejects(`INSERT INTO "WmsStocktakeLocation" ("id","organizationId","workspaceId","warehouseId","stocktakeId","locationId")
      VALUES ('cross-wh-range',$1,$2,'count-other-wh','count-other-header',$3)`, [org,ws,loc], '23503', 'WmsStocktakeLocation_location_fkey');
    await db.query(`INSERT INTO "WmsStocktakeLine" ("id","organizationId","workspaceId","stocktakeId","locationId","lotId",
      "baselineOnHand","baselinePendingQc","baselinePendingPutaway","baselineRejected","baselineReserved","updatedAt")
      VALUES ('count-line',$1,$2,'stocktake-schema',$3,$4,0,0,0,0,0,now())`,[org,ws,loc,lot]);
    assert.equal((await db.query(`SELECT "countedQty" FROM "WmsStocktakeLine" WHERE id='count-line'`)).rows[0].countedQty, null);
    for (const update of [
      '"baselineOnHand"=1',
      '"baselineRevision"=0',
      '"baselineReserved"=1',
      '"baselinePendingQc"=-1',
      '"baselineRevision"=1,"baselineOnHand"=2147483647,"baselinePendingQc"=2147483647,"baselineReserved"=2147483647',
      '"countedQty"=0',
      '"countedBy"=\'operator\'',
      '"revision"=0',
    ]) await rejects(`UPDATE "WmsStocktakeLine" SET ${update} WHERE id='count-line'`,[], '23514');
    await rejects(`UPDATE "WmsStocktakeLine" SET "lotId"='missing-lot' WHERE id='count-line'`, [], '23503');
    await rejects(`UPDATE "WmsStocktakeLine" SET "locationId"='missing-range' WHERE id='count-line'`, [], '23503');
    await rejects(`INSERT INTO "WmsStocktakeLine" SELECT 'duplicate-line', "organizationId","workspaceId","stocktakeId","locationId","lotId",
      "baselineRevision","baselineOnHand","baselinePendingQc","baselinePendingPutaway","baselineRejected","baselineReserved",
      "countedQty","countedBy","countedAt","revision","createdAt","updatedAt" FROM "WmsStocktakeLine" WHERE id='count-line'`, [], '23505', 'WmsStocktakeLine_scope_lot_key');
    await db.query(`UPDATE "WmsStocktakeLine" SET "countedQty"=0,"countedBy"=$1,"countedAt"=now() WHERE id='count-line'`,[user]);
    assert.equal((await db.query(`SELECT "countedQty" FROM "WmsStocktakeLine" WHERE id='count-line'`)).rows[0].countedQty, 0);
    await rejects(`UPDATE "WmsStocktakeLine" SET "countedQty"=-1 WHERE id='count-line'`,[], '23514', 'WmsStocktakeLine_count_check');
    await db.query(`UPDATE "WmsStocktakeLine" SET "baselineRevision"=1,"baselineOnHand"=10,
      "baselinePendingQc"=2,"baselineReserved"=3 WHERE id='count-line'`);
    await db.query(`UPDATE "WmsStocktake" SET "status"='COUNTING',"startedAt"=now() WHERE id='stocktake-schema'`);
    await db.query(`UPDATE "WmsStocktake" SET "status"='REVIEW' WHERE id='stocktake-schema'`);
    await db.query(`UPDATE "WmsStocktake" SET "status"='POSTED',"postedAt"=now(),"postedCommandId"=$1 WHERE id='stocktake-schema'`,[command]);
    await rejects(`UPDATE "WmsStocktake" SET "status"='CANCELLED' WHERE id='stocktake-schema'`,[], '23514');
    await rejects(`DELETE FROM "WmsStocktake" WHERE id='stocktake-schema'`,[], '23503');
    await rejects(`DELETE FROM "WmsStocktakeLocation" WHERE id='stocktake-range'`,[], '23503');
    console.log(`PASS: stocktake schema rejects ${rejected} invalid writes; null/zero counts, baseline buckets and posting metadata verified (not operational posting)`);
  } finally {
    // Every stocktake-specific fixture is rolled back; existing first-loop evidence remains intact.
    await db.query('ROLLBACK');
  }
}
