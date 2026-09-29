// FNV-1a 32-bit hash — sync, no async, works in Workers and Node.
function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const TYPE_ABBREV: Record<string, string> = {
  transcript_section: 'ts',
  main_point: 'mp',
  audience_situation: 'as',
  key_illustration: 'ki',
  big_idea: 'bi',
  practical_application: 'pa',
};

// Build a deterministic Vectorize vector ID that always fits within 64 bytes.
// Format (short slugs):  {sermon_id}:{t}:{idx}
// Format (long slugs):   {sermon_id[:48]}{fnv32(sermon_id)}:{t}:{idx}  (≤62 bytes)
export function makeChunkId(sermon_id: string, chunk_type: string, idx: number): string {
  const t = TYPE_ABBREV[chunk_type] ?? chunk_type.slice(0, 2);
  const suffix = `:${t}:${idx}`;
  if (sermon_id.length + suffix.length <= 64) return sermon_id + suffix;
  const prefix = sermon_id.slice(0, 48) + fnv1a32(sermon_id);
  return prefix + suffix;
}
