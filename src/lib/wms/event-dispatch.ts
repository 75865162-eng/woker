import { getWmsEventQueue } from "@/lib/queue/redis-queue";
import { pendingWmsEventDeliveries } from "./event-bus";

let scanning = false;
export async function dispatchPendingWmsEvents() {
  if (scanning || process.env.QUEUE_DRIVER !== "redis") return;
  scanning = true;
  try {
    const queue = getWmsEventQueue();
    for (const delivery of await pendingWmsEventDeliveries()) {
      await queue.add("consume-wms-event", { deliveryId: delivery.id }, {
        jobId: `wms-${delivery.id}-${delivery.attempts}`,
        attempts: 3, backoff: { type: "exponential", delay: 1000 },
        // Database intent survives both success and failure; recovery can always rebuild Redis.
        removeOnComplete: true, removeOnFail: true,
      });
    }
  } finally { scanning = false; }
}
