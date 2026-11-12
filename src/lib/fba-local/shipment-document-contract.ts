export const shipmentDocumentKinds=['DELIVERY_APPOINTMENT','INSURANCE','CONTAINER'] as const;
export type ShipmentDocumentKind=typeof shipmentDocumentKinds[number];
