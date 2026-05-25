export function normalizeForAnchor(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isAnchorValid(anchor: string, doc: string): boolean {
  const normAnchor = normalizeForAnchor(anchor);
  if (normAnchor.length === 0) return false;
  const normDoc = normalizeForAnchor(doc);
  return normDoc.includes(normAnchor);
}
