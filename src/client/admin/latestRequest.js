// Each start returns a predicate for the request that just began.
export function createLatestRequest() {
  let current = 0;
  return () => {
    const request = ++current;
    return () => current === request;
  };
}
