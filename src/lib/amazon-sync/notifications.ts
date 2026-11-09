import { notificationTypes } from "./notification-types";
export { notificationTypes } from "./notification-types";
import { observationFact, type SafeFact } from "./observation-parsers";
import { observationObject as object, observationText as text, observationInvalid as invalid } from "./observation-policy";

/** Official Notification Type Values, reviewed 2026-11-07. This registry enables
 * read-only subscription discovery. It never creates destinations/subscriptions,
 * receives events, or claims that a subscription proves delivery health.
 * https://developer-docs.amazon.com/sp-api/docs/notification-type-values */


export function parseNotificationSubscriptions(value: unknown, notificationType: string): { rows: SafeFact[]; nextToken?: string } {
  if (!(notificationTypes as readonly string[]).includes(notificationType)) return invalid();
  const root = object(value);
  if (root.errors !== undefined && (!Array.isArray(root.errors) || root.errors.length)) return invalid();
  const payload = object(root.payload);
  if (!Array.isArray(payload.subscriptions) || payload.subscriptions.length > 100) return invalid();
  const seen = new Set<string>();
  const rows = payload.subscriptions.map(value => {
    const subscription = object(value), subscriptionId = text(subscription.subscriptionId, 200);
    if (seen.has(subscriptionId)) return invalid(); seen.add(subscriptionId);
    const payloadVersion = text(subscription.payloadVersion, 100);
    text(subscription.destinationId, 200);
    const directive = subscription.processingDirective === undefined ? {} : object(subscription.processingDirective);
    const filter = directive.eventFilter === undefined ? {} : object(directive.eventFilter);
    const marketplaceIds = filter.marketplaceIds === undefined ? null : filter.marketplaceIds;
    if (marketplaceIds !== null && (!Array.isArray(marketplaceIds) || marketplaceIds.length > 100 || marketplaceIds.some(id => typeof id !== "string" || !/^[A-Z0-9]{1,40}$/.test(id)))) return invalid();
    return observationFact("NOTIFICATION_SUBSCRIPTION", [notificationType, subscriptionId], { notificationType, subscriptionId, payloadVersion, scope: "SELLER_SUBSCRIPTION", marketplaceIds, filterConfigured: directive.eventFilter !== undefined || directive.filterExpression !== undefined, eventDeliveryVerified: false });
  });
  return { rows, ...(payload.nextToken === undefined || payload.nextToken === null || payload.nextToken === "" ? {} : { nextToken: text(payload.nextToken, 32000) }) };
}
