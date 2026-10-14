/** Resolves on a later turn of the event loop, like a network round trip. */
export function tick(): Promise<void> {
  // setImmediate in Node; the dev UI also runs this in the browser.
  return new Promise((resolve) => (typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0)));
}
