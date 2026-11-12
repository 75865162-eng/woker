export const closeDomains = ['PROCUREMENT', 'COST', 'FBA', 'AMAZON', 'ADS', 'BANK', 'SUBLEDGER', 'PROFIT_LOSS'] as const;
export type CloseDomain = typeof closeDomains[number];
export type ClosePolicy = { reference: string; requiredDomains: CloseDomain[]; allowReopen: boolean };
