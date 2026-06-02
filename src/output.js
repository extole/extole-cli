function compact(value) {
  if (Array.isArray(value)) {
    return value.map(compact).filter(element => element !== null && element !== undefined);
  }
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      if (fieldValue === null || fieldValue === undefined) continue;
      if (Array.isArray(fieldValue) && fieldValue.length === 0) continue;
      const compacted = compact(fieldValue);
      if (typeof compacted === 'object' && !Array.isArray(compacted) && Object.keys(compacted).length === 0) continue;
      result[key] = compacted;
    }
    return result;
  }
  return value;
}

export function printJson(data, options = {}) {
  const output = options.compact ? compact(data) : data;
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

export function printJsonText(text, options = {}) {
  try {
    const parsed = JSON.parse(text);
    printJson(parsed, options);
  } catch {
    process.stdout.write(text + '\n');
  }
}
