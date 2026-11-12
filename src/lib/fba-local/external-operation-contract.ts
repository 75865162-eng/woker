/** These are local workflow categories, not an enabled Amazon operation catalogue. */
export const externalWorkflowSteps = ['PLAN', 'PACKING', 'PLACEMENT', 'TRANSPORT', 'DELIVERY_WINDOW', 'LABELS', 'SHIPMENT_CONFIRMATION', 'CANCELLATION'] as const;
export type ExternalWorkflowStep = typeof externalWorkflowSteps[number];
export const inboundWriteReadiness = {
  apiFamily: 'Fulfillment Inbound', apiVersion: '2024-03-20',
  enabled: false, reason: 'WRITE_OPERATION_SCHEMA_AND_RECOVERY_ADAPTER_REQUIRED',
  quotaSource: 'UNVERIFIED', customsTemplate: 'TARGET_CONFIGURATION_REQUIRED',
} as const;
