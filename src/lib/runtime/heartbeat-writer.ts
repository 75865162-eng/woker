type HeartbeatStatus = "online" | "stopping";

/** Serialize shutdown after any in-flight online write, without polling overlap. */
export function createHeartbeatWriter(persist: (status: HeartbeatStatus) => Promise<void>) {
  let pending: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;

  return function writeHeartbeat(status: HeartbeatStatus = "online"): Promise<void> {
    if (stopping) return stopping;
    if (status === "stopping") {
      // Failed online writes must not suppress the final stopping attempt.
      stopping = (pending ?? Promise.resolve()).catch(() => undefined).then(() => persist("stopping"));
      return stopping;
    }
    if (pending) return pending;
    const operation = Promise.resolve().then(() => persist("online"));
    const finished = operation.finally(() => {
      if (pending === finished) pending = undefined;
    });
    pending = finished;
    return finished;
  };
}
