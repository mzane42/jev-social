const CONTAINER_KEYS = ["items", "results", "cards", "videos", "posts", "notes", "data"];

export function findEvidenceItems(value) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];

  for (const key of CONTAINER_KEYS) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      const items = normalizeItems(candidate);
      if (items.length) return items;
      continue;
    }
    if (isRecord(candidate)) {
      const nested = findEvidenceItems(candidate);
      if (nested.length) return nested;
    }
  }
  return [];
}

function normalizeItems(items) {
  return items
    .filter(isRecord)
    .map((item) => isRecord(item.entity) ? { ...item, ...item.entity } : item);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
