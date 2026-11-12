import type { WmsCommand } from "@prisma/client";
import { json, scoped } from "./access";
import type { Tx } from "./repository";

export const wmsCommandCompleted = "wms.command.completed.v1";

/** Only committed command facts: no valuation, live balance or external snapshot. */
export async function commandEventPayload(tx: Tx, command: WmsCommand) {
  const movements = await tx.wmsMovement.findMany({
    where: { organizationId: command.organizationId, workspaceId: command.workspaceId, commandId: command.id },
    orderBy: { sequence: "asc" }, include: { balance: { include: { lot: true } } },
  });
  return json({
    action: command.action, sourceAggregateId: command.aggregateId, expectedRevision: command.expectedRevision,
    actorUserId: command.actorUserId, result: command.result,
    movements: movements.map(({ balance, deltaVolumeCubicMeters, ...movement }) => ({
      ...movement, ...(deltaVolumeCubicMeters === null ? {} : {deltaVolumeCubicMeters}), occurredAt: movement.occurredAt.toISOString(), warehouseId: balance.warehouseId,
      locationId: balance.locationId, lotId: balance.lotId, productRecordId: balance.lot.productRecordId,
    })),
  });
}

export async function appendWmsCommandEvent(tx: Tx, command: WmsCommand) {
  return tx.wmsDomainEvent.create({ data: {
    id: crypto.randomUUID(), ...scoped(command), commandId: command.id,
    eventType: wmsCommandCompleted, schemaVersion: 1, occurredAt: command.createdAt,
    payload: await commandEventPayload(tx, command),
  } });
}
