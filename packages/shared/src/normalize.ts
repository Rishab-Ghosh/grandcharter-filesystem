/**
 * Normalize node name for uniqueness/comparison only. Display name stays in nodes.name.
 * Order: trim, collapse internal whitespace to single space, NFC, lowercase.
 */
export function normalizeNodeName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFC')
    .toLowerCase();
}
