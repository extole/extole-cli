export function collect(val, prev) {
  return prev.concat([val]);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
