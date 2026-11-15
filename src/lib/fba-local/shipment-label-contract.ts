export const shipmentLabelKinds = ['BOX_LABEL', 'ITEM_LABEL'] as const;
export type ShipmentLabelKind = typeof shipmentLabelKinds[number];
