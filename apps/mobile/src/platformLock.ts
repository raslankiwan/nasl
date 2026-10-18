/** Web Locks serialize shared browser storage across tabs; native has one JS runtime. */
export function platformLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const runtime = globalThis as typeof globalThis & {
    navigator?: { locks?: { request: <R>(name: string, work: () => Promise<R>) => Promise<R> } };
  };
  return runtime.navigator?.locks ? runtime.navigator.locks.request(name, work) : work();
}
