/** IPC closes when the owning manager exits, including SIGKILL/crash. */
/** @param {NodeJS.Process} [channel] @param {{timeoutMs?: number, signal?: (value: NodeJS.Signals) => unknown}} [options] */
export function watchParent(channel = process, { timeoutMs = 25_000, signal = value => process.kill(process.pid, value) } = {}) {
  let stopping = false;
  let timer;
  const disconnect = () => {
    if (stopping) return;
    stopping = true;
    timer = setTimeout(() => signal("SIGKILL"), timeoutMs);
    timer.unref?.();
    signal("SIGTERM");
  };
  channel.once("disconnect", disconnect);
  if (channel.connected === false) disconnect();
  return () => { clearTimeout(timer); channel.removeListener("disconnect", disconnect); };
}
