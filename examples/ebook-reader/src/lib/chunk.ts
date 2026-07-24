/* ---------------------------------------------------------------------------
 * PLACEHOLDER chunker.
 *
 * Splits the extracted text into paragraph-sized passages so the UI has real
 * content to show. The dedicated chunking stage is a separate task — this just
 * does a blank-line split with a soft length cap so a page-long PDF paragraph
 * doesn't become one giant passage.
 * ------------------------------------------------------------------------- */

const SOFT_MAX = 600 // characters before we split a long paragraph on sentences

export function chunkParagraphs(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const out: string[] = []
  for (const para of paragraphs) {
    if (para.length <= SOFT_MAX) {
      out.push(para)
      continue
    }
    // Break overly long paragraphs at sentence boundaries.
    const sentences = para.match(/[^.!?]+[.!?]+[\])'"`]*|\S+$/g) ?? [para]
    let buf = ''
    for (const s of sentences) {
      if (buf && buf.length + s.length > SOFT_MAX) {
        out.push(buf.trim())
        buf = ''
      }
      buf += s
    }
    if (buf.trim()) out.push(buf.trim())
  }
  return out
}

/** Rough spoken-duration estimate: ~155 words per minute, floored at 3s. */
export function estimateDuration(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.max(3, Math.round((words / 155) * 60))
}
