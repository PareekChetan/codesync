// Distinct, readable cursor colours on a dark background.
const PALETTE = ['#7ee2b8', '#ffb86b', '#8ab4ff', '#ff7aa8', '#c9a6ff', '#ffe066', '#5fd4f4', '#ff8f70'];

/** Same user always gets the same colour, on every device. */
export function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
