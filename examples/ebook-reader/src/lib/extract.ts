/* ---------------------------------------------------------------------------
 * Text extraction for TXT / PDF / EPUB.
 *
 * PDF  → PDF.js  (pdfjs-dist)
 * EPUB → ePub.js (epubjs)
 * TXT  → File.text()
 *
 * Each extractor returns the full plain text of the document. The caller keeps
 * that string in memory to feed the next pipeline stage (chunking). Parsers are
 * dynamically imported so their (large) code only loads when a file of that
 * type is actually opened.
 * ------------------------------------------------------------------------- */

export type BookFormat = 'txt' | 'pdf' | 'epub'

export interface ExtractProgress {
  /** 1-based index of the unit currently being read (PDF page / EPUB section). */
  unit: number
  /** Total units, or 0 if unknown. */
  total: number
  /** What the units are, for display ("page" | "section"). */
  label: string
}

export interface ExtractResult {
  format: BookFormat
  /** Full extracted plain text — this is what gets stored for chunking. */
  text: string
  /** Number of pages (PDF) or sections (EPUB); undefined for TXT. */
  units?: number
}

export function formatFromName(name: string): BookFormat {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'epub') return 'epub'
  return 'txt'
}

type ProgressFn = (p: ExtractProgress) => void

export async function extractText(file: File, onProgress?: ProgressFn): Promise<ExtractResult> {
  const format = formatFromName(file.name)
  if (format === 'pdf') return extractPdf(file, onProgress)
  if (format === 'epub') return extractEpub(file, onProgress)
  return extractTxt(file, onProgress)
}

/* ---------------------------------- TXT ---------------------------------- */

async function extractTxt(file: File, onProgress?: ProgressFn): Promise<ExtractResult> {
  onProgress?.({ unit: 1, total: 1, label: 'file' })
  const text = normalize(await file.text())
  return { format: 'txt', text }
}

/* ---------------------------------- PDF ---------------------------------- */

async function extractPdf(file: File, onProgress?: ProgressFn): Promise<ExtractResult> {
  const pdfjs = await import('pdfjs-dist')
  // Vite resolves the ?url import to a hashed asset URL for the worker.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = await file.arrayBuffer()
  const task = pdfjs.getDocument({ data })
  const doc = await task.promise
  const total = doc.numPages
  const pages: string[] = []

  for (let i = 1; i <= total; i++) {
    onProgress?.({ unit: i, total, label: 'page' })
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(itemsToText(content.items))
    page.cleanup()
  }

  await task.destroy()
  return { format: 'pdf', text: normalize(pages.join('\n\n')), units: total }
}

/** Reconstruct text from a page's text items, using EOL flags for line breaks. */
function itemsToText(items: unknown[]): string {
  let out = ''
  for (const raw of items) {
    const item = raw as { str?: string; hasEOL?: boolean }
    if (typeof item.str !== 'string') continue
    out += item.str
    if (item.hasEOL) out += '\n'
    else if (item.str && !item.str.endsWith(' ')) out += ' '
  }
  return out
}

/* --------------------------------- EPUB ---------------------------------- */

async function extractEpub(file: File, onProgress?: ProgressFn): Promise<ExtractResult> {
  const ePub = (await import('epubjs')).default
  const data = await file.arrayBuffer()
  const book = ePub(data)
  await book.ready

  // `spineItems` is populated at runtime but not in the shipped type defs.
  const sections = (book.spine as unknown as { spineItems: Array<EpubSection> }).spineItems ?? []
  const total = sections.length
  const parts: string[] = []
  const request = book.load.bind(book)

  for (let i = 0; i < total; i++) {
    onProgress?.({ unit: i + 1, total, label: 'section' })
    const section = sections[i]
    try {
      const contents = await section.load(request)
      // `contents` is the section's root element; prefer <body> so head/title
      // metadata doesn't leak into the spoken text.
      const el = contents as unknown as {
        querySelector?: (s: string) => { textContent?: string } | null
        textContent?: string
      }
      const body = el?.querySelector?.('body')
      const text = (body?.textContent ?? el?.textContent ?? '').trim()
      if (text) parts.push(text)
    } catch {
      // skip sections that fail to load (e.g. cover images, empty nav)
    } finally {
      section.unload()
    }
  }

  book.destroy()
  return { format: 'epub', text: normalize(parts.join('\n\n')), units: total }
}

interface EpubSection {
  load(request: (path: string) => Promise<object>): Promise<unknown>
  unload(): void
}

/* -------------------------------- helpers -------------------------------- */

/** Collapse runaway whitespace while preserving paragraph (blank-line) breaks. */
function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
