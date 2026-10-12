export function parseStoredTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const tags: unknown = JSON.parse(value);
    if (!Array.isArray(tags)) return [];
    return [...new Set(tags.filter((tag): tag is string => typeof tag === "string"))];
  } catch {
    return [];
  }
}
