/** Resolves on a later turn of the event loop, like a network round trip. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
