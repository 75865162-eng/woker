import { automaticAdapter, automaticAdapterResources, type AutomaticAdapterResource } from "./automatic-adapters";
import { automaticIntervalMinutes } from "./automatic-window-rules";
export * from "./automatic-window-rules";

export const automaticResources = automaticAdapterResources;
export function automaticResourceIntervalMinutes(resource: string) {
  return automaticAdapter(resource)?.intervalMinutes ?? automaticIntervalMinutes;
}
export function isAutomaticResource(resource: string): resource is AutomaticAdapterResource {
  return automaticAdapter(resource) !== undefined;
}
