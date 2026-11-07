import reviewed from "./official-schema-registry.json";

/** Registration is independent of executable capability and actual publication.
 * Hashes pin the reviewed public model bytes; new upstream versions require an
 * explicit offline regeneration. No model is fetched during synchronization. */
export function registeredSpApiSchemas() {
  return reviewed.map(({ responseFields, ...entry }) => ({ ...entry,
    status: entry.scope === "REVIEWED_LOCAL_CONTRACT_SUBSET" ? "REVIEWED_CONTRACT_SUBSET" : "REGISTERED_OFFICIAL_SCHEMA",
    capability: entry.executable ? "EXECUTABLE_ADAPTER" : "NOT_SUPPORTED", registeredResponseFields: responseFields.length }));
}

export function compareResponseSchema(operation: string | undefined, apiVersion: string | undefined, fields: Array<{ path: string }>, observedComplete: boolean) {
  const schema = reviewed.find(entry => entry.operation === operation && (!apiVersion || entry.apiVersion === apiVersion));
  if (!schema) return { status: "MODEL_NOT_REGISTERED" as const, apiVersion: apiVersion ?? null, contractSha256: null, registeredFields: null, observedRegisteredFields: null, unregisteredObservedFields: null, fieldCoveragePercent: null, officialUniverseComplete: false };
  const registered = new Set(schema.responseFields), observed = new Set(fields.map(field => field.path));
  const matched = [...observed].filter(path => registered.has(path)).length;
  return { status: schema.scope === "REVIEWED_LOCAL_CONTRACT_SUBSET" ? "REVIEWED_CONTRACT_SUBSET" : "REGISTERED_OFFICIAL_SCHEMA", apiVersion: schema.apiVersion, contractSha256: schema.contractSha256,
    registeredFields: registered.size, observedRegisteredFields: matched, unregisteredObservedFields: [...observed].filter(path => !registered.has(path)).length,
    // Optional fields absent from one response are not proof of missing access.
    fieldCoveragePercent: observedComplete && schema.fieldEnumerationComplete && registered.size ? Math.floor(matched / registered.size * 10000) / 100 : null,
    dynamicProperties: schema.dynamicProperties, basis: "FIELDS_OBSERVED_IN_ONE_RESPONSE_VS_REGISTERED_CONTRACT", officialUniverseComplete: false };
}
