import {consumeInventoryValuation} from './valuation-service';
import { isDeepStrictEqual } from "node:util";
import type { WmsDomainEvent } from "@prisma/client";
import type { Tx } from "./repository";
import { commandEventPayload, wmsCommandCompleted } from "./domain-events";

export type WmsEventConsumer = {
  /** Version this ID when changing the consumer's semantics; new IDs replay historical events. */
  id: string;
  eventType: string;
  schemaVersion: number;
  /** Database work only, in this transaction. External I/O needs its own module Outbox. */
  handle: (tx: Tx, event: WmsDomainEvent) => Promise<void>;
};

/** Executable consumer template: verifies committed evidence before acknowledging delivery. */
export const inventoryEvidenceConsumer: WmsEventConsumer = {
  id: "wms.inventory-evidence.v1", eventType: wmsCommandCompleted, schemaVersion: 1,
  async handle(tx, event) {
    const command = await tx.wmsCommand.findFirstOrThrow({ where: {
      id: event.commandId, organizationId: event.organizationId, workspaceId: event.workspaceId,
    } });
    if (!isDeepStrictEqual(event.payload, await commandEventPayload(tx, command))) throw Error("WMS_EVENT_EVIDENCE_MISMATCH");
  },
};

export const inventoryValuationConsumer:WmsEventConsumer={id:"wms.inventory-valuation.v1",eventType:wmsCommandCompleted,schemaVersion:1,handle:consumeInventoryValuation};
export const wmsEventConsumers: readonly WmsEventConsumer[] = [inventoryEvidenceConsumer,inventoryValuationConsumer];
