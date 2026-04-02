// Strip nulls, empty arrays, and empty objects recursively
function compact(value) {
  if (Array.isArray(value)) {
    const arr = value.map(compact).filter(v => v !== null && v !== undefined);
    return arr;
  }
  if (value !== null && typeof value === 'object') {
    const obj = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      const compacted = compact(v);
      if (typeof compacted === 'object' && !Array.isArray(compacted) && Object.keys(compacted).length === 0) continue;
      obj[k] = compacted;
    }
    return obj;
  }
  return value;
}

export function printJson(data, opts = {}) {
  const verbose = opts.verbose || opts.raw;
  const out = verbose ? data : compact(data);
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

export function printJsonText(text, opts = {}) {
  try {
    const parsed = JSON.parse(text);
    printJson(parsed, opts);
  } catch {
    process.stdout.write(text + '\n');
  }
}
