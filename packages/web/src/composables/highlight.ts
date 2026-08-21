export type HighlightSegment = { text: string; hit: boolean };

/**
 * Split `text` into segments, marking every case-insensitive occurrence of
 * `query` as a hit. The caller renders hits in a background <mark>. An empty
 * query returns the whole text as a single non-hit segment.
 *
 * The pieces are plain substrings, so rendering them as text nodes (component
 * interpolation / v-text) is inherently XSS-safe — no HTML is produced here.
 */
export const splitHighlight = (text: string, query: string): HighlightSegment[] => {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (;;) {
    const index = lowerText.indexOf(lowerQ, cursor);
    if (index === -1) {
      if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (index > cursor) segments.push({ text: text.slice(cursor, index), hit: false });
    segments.push({ text: text.slice(index, index + q.length), hit: true });
    cursor = index + q.length;
  }
  return segments;
};
