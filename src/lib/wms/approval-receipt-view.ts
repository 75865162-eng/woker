import type { WmsLocationContext } from "./reservation-view";

/** Current catalog context, not a historical snapshot of the approval request. */
export type ApprovalReceiptContext = {
  number: string;
  sourceReference: string | null;
  receivingLocation: WmsLocationContext;
  lines: { lineId: string; lotId: string; lotCode: string; barcode: string | null; targetLocation: WmsLocationContext | null }[];
};
