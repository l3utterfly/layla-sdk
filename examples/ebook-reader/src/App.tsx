import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  FileText,
  FileType2,
  Headphones,
  Layers,
  ListMusic,
  Loader2,
  Play,
  Pause,
  RotateCw,
  Sparkles,
  SkipBack,
  SkipForward,
  TriangleAlert,
  Type,
  Upload,
  Volume2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { LaylaSDK, LaylaAbortError } from '../../../src/index'
import type {
  BackgroundAudioStatus,
  BackgroundAudioTrackChanged,
} from '../../../src/index'
import { extractText, formatFromName } from './lib/extract'
import type { BookFormat, ExtractProgress } from './lib/extract'
import { chunkParagraphs, estimateDuration } from './lib/chunk'
import './App.css'

/* ---------------------------------------------------------------------------
 * Types
 * Text extraction (TXT/PDF/EPUB) is real — see src/lib/extract.ts. Chunking is
 * a placeholder paragraph split (src/lib/chunk.ts) pending its own stage.
 * Synthesis is real: every passage is pre-generated to a saved audio file via
 * layla.tts.generateVoiceToFile(..., save=true). Playback is real too: the
 * saved files are queued into layla.backgroundAudio, and the transport reflects
 * the host's status / track-changed / finished events.
 * ------------------------------------------------------------------------- */

// One SDK client for the whole app. Outside the Layla host the browser mock
// (installed in main.tsx) stands in for the native TTS endpoints.
const layla = new LaylaSDK()

type ChunkStatus = 'pending' | 'synthesizing' | 'ready'

interface Chunk {
  id: number
  text: string
  status: ChunkStatus
  duration: number // seconds — estimated from word count for real books
  /** Filename of the saved audio clip, set once the host has voiced it. */
  filename?: string
}

interface Book {
  id: string
  title: string
  author: string
  format: BookFormat
  cover: string // single letter / short label
  gradient: string
  /** Full extracted text, kept in memory for the (next) chunking stage. */
  text: string
  /** Pages (PDF) or sections (EPUB); undefined for TXT / samples. */
  units?: number
  chunks: Chunk[]
}

const COVER_GRADIENTS = [
  'linear-gradient(150deg, #47a6ff, #1b6fb8)',
  'linear-gradient(150deg, #8a5cff, #4b2fa8)',
  'linear-gradient(150deg, #2fbf8f, #12795a)',
  'linear-gradient(150deg, #ff8a5c, #b8461b)',
  'linear-gradient(150deg, #ff6b81, #a81b3a)',
]

function gradientFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length]
}

const LOREM: string[] = [
  'The lighthouse keeper had not spoken to another soul in forty-one days, and he had begun to suspect that the sea itself was keeping count.',
  'Every evening at dusk he climbed the one hundred and eighty-two steps, lit the great lamp, and watched the beam sweep across water the colour of cold iron.',
  'On the morning the letter arrived, folded inside a bottle green with age, the wind fell strangely silent, as though the whole coast were leaning in to listen.',
  'It was addressed to no one in particular, and yet every line seemed to speak directly to him, naming fears he had never confessed aloud.',
  'He read it three times before the tide turned, and by the third reading his hands had stopped shaking and something in his chest had gone very still.',
  'The instructions were simple, almost absurd in their simplicity: when the light next fails, do not relight it — walk down to the shore and wait.',
  'For a keeper, letting the light die was the one unforgivable sin, a betrayal of every ship that trusted the darkness to be broken on his hill.',
  'And so he argued with himself through the long grey afternoon, pacing the narrow gallery while gulls wheeled and complained beneath a bruised sky.',
  'When the lamp guttered that night, sputtered once, and went out, he found that his feet were already carrying him toward the stairs and the waiting sea.',
  'The shore was empty, of course. There was only the sound of the surf, the smell of salt, and far out on the black water, a single answering light.',
]

function makeChunks(seed: number): Chunk[] {
  return LOREM.map((text, i) => ({
    id: seed * 100 + i,
    text,
    status: 'pending' as ChunkStatus,
    duration: 14 + ((i * 7 + seed * 3) % 22), // 14–35s, deterministic
  }))
}

const SAMPLE_TEXT = LOREM.join('\n\n')

const SAMPLE_BOOKS: Book[] = [
  {
    id: 'lighthouse',
    title: 'The Keeper of the Last Light',
    author: 'E. M. Harlow',
    format: 'epub',
    cover: 'K',
    gradient: 'linear-gradient(150deg, #47a6ff, #1b6fb8)',
    text: SAMPLE_TEXT,
    chunks: makeChunks(1),
  },
  {
    id: 'orbit',
    title: 'Notes from a Decaying Orbit',
    author: 'Priya Anand',
    format: 'pdf',
    cover: 'O',
    gradient: 'linear-gradient(150deg, #8a5cff, #4b2fa8)',
    text: SAMPLE_TEXT,
    chunks: makeChunks(2),
  },
  {
    id: 'garden',
    title: 'The Midnight Garden Papers',
    author: 'T. Okafor',
    format: 'txt',
    cover: 'G',
    gradient: 'linear-gradient(150deg, #2fbf8f, #12795a)',
    text: SAMPLE_TEXT,
    chunks: makeChunks(3),
  },
]

const FORMAT_META: Record<BookFormat, { label: string; icon: LucideIcon }> = {
  txt: { label: 'TXT', icon: Type },
  pdf: { label: 'PDF', icon: FileText },
  epub: { label: 'EPUB', icon: FileType2 },
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function extractSub(book: Book): string {
  const chars = book.text.length
  const size = chars >= 1000 ? `${Math.round(chars / 1000)}k chars` : `${chars} chars`
  if (book.units && book.format === 'pdf') return `${book.units} pages · ${size}`
  if (book.units && book.format === 'epub') return `${book.units} sections · ${size}`
  return `${size} extracted`
}

/* ---------------------------------------------------------------------------
 * App
 * ------------------------------------------------------------------------- */

type ExtractState = { name: string; format: BookFormat; progress: ExtractProgress | null }

export default function App() {
  const [book, setBook] = useState<Book | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const [extracting, setExtracting] = useState<ExtractState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [playingId, setPlayingId] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  // Live playhead reported by the host: seconds into the current clip and the
  // clip's total length (0 until the host knows it).
  const [position, setPosition] = useState<{ currentTime: number; duration: number }>({
    currentTime: 0,
    duration: 0,
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Chunk ids of the tracks currently queued in the background player, in queue
  // order. Non-null means a queue is active; the array index matches the host's
  // `currentIndex`. A ref (not state) because the event listeners read it.
  const queueRef = useRef<number[] | null>(null)

  // The voice used for pre-generation. `null` means the host's default voice;
  // we read it into a ref so resolving it later doesn't restart synthesis.
  const voiceRef = useRef<string | null>(null)
  const [voiceName, setVoiceName] = useState<string | null>(null)

  const resetPlayback = useCallback(() => {
    queueRef.current = null
    setPlayingId(null)
    setIsPlaying(false)
    setPosition({ currentTime: 0, duration: 0 })
    void layla.backgroundAudio.stop()
  }, [])

  useEffect(() => {
    let active = true
    layla.tts
      .getVoices()
      .then((voices) => {
        if (!active) return
        const voice = voices[0] ?? null
        voiceRef.current = voice?.id ?? null
        setVoiceName(voice?.name ?? null)
      })
      .catch(() => {
        // No voices available — fall back to the host default voice (null).
      })
    return () => {
      active = false
    }
  }, [])

  const loadBook = useCallback((source: Book) => {
    resetPlayback()
    // clone so each load restarts the pre-generation pipeline
    setBook({ ...source, chunks: source.chunks.map((c) => ({ ...c, status: 'pending' })) })
    setError(null)
    setExtracting(null)
  }, [resetPlayback])

  const reset = useCallback(() => {
    resetPlayback()
    setBook(null)
    setError(null)
    setExtracting(null)
  }, [resetPlayback])

  /* ---- Real TTS pre-generation ----
   * Voice every passage to a saved audio file up front via
   * layla.tts.generateVoiceToFile(voiceId, text, save=true). With save=true the
   * host persists each clip and returns its filename (rather than inline audio),
   * which we stash on the chunk. Passages are voiced sequentially so the UI can
   * show one being synthesized at a time; the SDK bridge serialises requests
   * anyway. The AbortController cancels any in-flight clip when the book changes
   * or the effect is torn down (e.g. StrictMode's double-invoke in dev). */
  useEffect(() => {
    if (!book) return
    const chunks = book.chunks
    const controller = new AbortController()
    let cancelled = false

    const patchChunk = (id: number, patch: Partial<Chunk>) =>
      setBook((prev) =>
        prev
          ? { ...prev, chunks: prev.chunks.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
          : prev,
      )

    async function preGenerate() {
      for (const chunk of chunks) {
        if (cancelled) return
        if (chunk.status === 'ready') continue
        patchChunk(chunk.id, { status: 'synthesizing' })
        try {
          const result = await layla.tts.generateVoiceToFile(
            voiceRef.current,
            chunk.text,
            true, // save = true — persist the clip and return its filename
            { signal: controller.signal },
          )
          if (cancelled) return
          patchChunk(chunk.id, {
            status: 'ready',
            filename: result.filename ?? undefined,
          })
        } catch (err) {
          if (cancelled || err instanceof LaylaAbortError) return
          // A real synthesis failure: leave the passage queued and stop here.
          patchChunk(chunk.id, { status: 'pending' })
          return
        }
      }
    }

    void preGenerate()
    return () => {
      cancelled = true
      controller.abort()
    }
    // Re-run only when a different book is loaded; chunk text is fixed per book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id])

  const currentChunk = useMemo(
    () => book?.chunks.find((c) => c.id === playingId) ?? null,
    [book, playingId],
  )

  /* ---- Real playback via the background audio player ----
   * The host owns queue progression, so the transport just issues commands
   * (start/pause/resume/skip/stop) and mirrors what the host reports back:
   *   status       → playing flag + live playhead + which track is current
   *   trackChanged → the queue advanced (auto or via skip)
   *   finished     → the last track ended and the player was released
   * queueRef maps the host's numeric currentIndex back to a passage id. */
  useEffect(() => {
    const idAt = (index: number) => queueRef.current?.[index] ?? null

    const onStatus = (s: BackgroundAudioStatus) => {
      setIsPlaying(s.playing)
      setPosition({ currentTime: s.currentTime, duration: s.duration })
      const id = idAt(s.currentIndex)
      if (id != null) setPlayingId(id)
    }
    const onTrackChanged = (t: BackgroundAudioTrackChanged) => {
      const id = idAt(t.currentIndex)
      if (id != null) setPlayingId(id)
      setPosition({ currentTime: 0, duration: 0 })
    }
    const onFinished = () => {
      queueRef.current = null
      setIsPlaying(false)
      setPlayingId(null)
      setPosition({ currentTime: 0, duration: 0 })
    }

    layla.backgroundAudio
      .on('status', onStatus)
      .on('trackChanged', onTrackChanged)
      .on('finished', onFinished)
    return () => {
      layla.backgroundAudio
        .off('status', onStatus)
        .off('trackChanged', onTrackChanged)
        .off('finished', onFinished)
    }
  }, [])

  // The play queue: every passage that has a saved audio file, in reading order.
  const buildQueue = useCallback((): { ids: number[]; files: string[] } => {
    const ready = book?.chunks.filter((c) => c.status === 'ready' && c.filename) ?? []
    return { ids: ready.map((c) => c.id), files: ready.map((c) => c.filename as string) }
  }, [book])

  const startQueue = useCallback(
    (startIndex: number) => {
      if (!book) return
      const { ids, files } = buildQueue()
      if (files.length === 0) return
      queueRef.current = ids
      void layla.backgroundAudio.start(files, { title: book.title, artist: book.author })
      if (startIndex > 0) void layla.backgroundAudio.skip(startIndex)
      setPlayingId(ids[startIndex] ?? ids[0] ?? null)
      setIsPlaying(true)
    },
    [book, buildQueue],
  )

  const togglePlay = useCallback(() => {
    if (!book) return
    if (queueRef.current == null) {
      startQueue(0)
      return
    }
    if (isPlaying) {
      void layla.backgroundAudio.pause()
      setIsPlaying(false)
    } else {
      void layla.backgroundAudio.resume()
      setIsPlaying(true)
    }
  }, [book, isPlaying, startQueue])

  const jumpTo = useCallback(
    (chunk: Chunk) => {
      if (chunk.status !== 'ready') return
      const active = queueRef.current
      if (active == null) {
        const idx = buildQueue().ids.indexOf(chunk.id)
        if (idx >= 0) startQueue(idx)
        return
      }
      const idx = active.indexOf(chunk.id)
      if (idx < 0) return
      void layla.backgroundAudio.skip(idx)
      // Tapping a passage means "play this one" — resume in case we were paused
      // (skip alone preserves the host's play/pause state).
      void layla.backgroundAudio.resume()
      setPlayingId(chunk.id)
      setIsPlaying(true)
    },
    [buildQueue, startQueue],
  )

  const skip = useCallback(
    (dir: -1 | 1) => {
      const active = queueRef.current
      if (active == null || playingId == null) return
      const pos = active.indexOf(playingId)
      const target = pos + dir
      if (pos < 0 || target < 0 || target >= active.length) return
      void layla.backgroundAudio.skip(target)
      setPlayingId(active[target])
    },
    [playingId],
  )

  /* ---- Real text extraction (TXT/PDF/EPUB) ---- */
  const onFileChosen = useCallback((files: FileList | null) => {
    const file = files?.[0]
    if (!file) return

    const format = formatFromName(file.name)
    resetPlayback()
    setBook(null)
    setError(null)
    setExtracting({ name: file.name, format, progress: null })

    extractText(file, (p) => {
      setExtracting((cur) => (cur ? { ...cur, progress: p } : cur))
    })
      .then((result) => {
        const paragraphs = chunkParagraphs(result.text)
        if (paragraphs.length === 0) {
          throw new Error('No readable text was found in this file.')
        }
        const chunks: Chunk[] = paragraphs.map((text, i) => ({
          id: i,
          text,
          status: 'pending',
          duration: estimateDuration(text),
        }))
        const title = file.name.replace(/\.[^.]+$/, '') || file.name
        setBook({
          id: `file-${Date.now()}`,
          title,
          author: 'Imported file',
          format: result.format,
          cover: (title.trim().charAt(0) || '?').toUpperCase(),
          gradient: gradientFor(title),
          text: result.text, // full extracted text held in memory for chunking
          units: result.units,
          chunks,
        })
        setExtracting(null)
      })
      .catch((e: unknown) => {
        setExtracting(null)
        setError(e instanceof Error ? e.message : 'Could not read this file.')
      })
  }, [resetPlayback])

  return (
    <>
      <div className="atmosphere" aria-hidden="true">
        <div className="bloom one" />
        <div className="bloom two" />
        <div className="bloom three" />
      </div>
      <div className="vignette" aria-hidden="true" />

      <div className="shell">
        <header className="topbar">
          <span className="brand-mark">
            <Headphones size={18} strokeWidth={2.4} />
          </span>
          <span className="brand-text">
            <span className="brand-name">Layla Reader</span>
            <span className="brand-sub">Listen to any book</span>
          </span>
          <span className="topbar-spacer" />
          <span className="mini-badge">
            <Sparkles size={12} /> Mini-app
          </span>
        </header>

        <main>
          {extracting ? (
            <Extracting info={extracting} />
          ) : error ? (
            <ExtractError message={error} onRetry={reset} />
          ) : !book ? (
            <Landing
              dragActive={dragActive}
              setDragActive={setDragActive}
              fileInputRef={fileInputRef}
              onFileChosen={onFileChosen}
              onPickSample={loadBook}
            />
          ) : (
            <Reader
              book={book}
              currentChunk={currentChunk}
              isPlaying={isPlaying}
              voiceName={voiceName}
              onReset={reset}
              onJump={jumpTo}
            />
          )}
        </main>
      </div>

      {book && (
        <Player
          book={book}
          currentChunk={currentChunk}
          isPlaying={isPlaying}
          position={position}
          onToggle={togglePlay}
          onSkip={skip}
        />
      )}
    </>
  )
}

/* ---------------------------------------------------------------------------
 * Extraction progress + error
 * ------------------------------------------------------------------------- */

function Extracting({ info }: { info: ExtractState }) {
  const p = info.progress
  const pct = p && p.total ? Math.round((p.unit / p.total) * 100) : null
  return (
    <section className="landing">
      <div className="status-card panel">
        <span className="dropzone-icon">
          <Loader2 size={26} className="spin" />
        </span>
        <h3>Extracting text…</h3>
        <p className="status-file">{info.name}</p>
        {p && p.total ? (
          <>
            <div className="synth-progress" aria-hidden="true">
              <div className="fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="status-sub">
              Reading {p.label} {p.unit} of {p.total}
            </p>
          </>
        ) : (
          <p className="status-sub">Reading {FORMAT_META[info.format].label} file…</p>
        )}
      </div>
    </section>
  )
}

function ExtractError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="landing">
      <div className="status-card panel">
        <span className="dropzone-icon danger">
          <TriangleAlert size={26} />
        </span>
        <h3>Couldn't read that file</h3>
        <p className="status-sub">{message}</p>
        <button type="button" className="btn primary" onClick={onRetry}>
          <RotateCw size={16} /> Try another file
        </button>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------------------
 * Landing / file picker
 * ------------------------------------------------------------------------- */

function Landing({
  dragActive,
  setDragActive,
  fileInputRef,
  onFileChosen,
  onPickSample,
}: {
  dragActive: boolean
  setDragActive: (v: boolean) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileChosen: (files: FileList | null) => void
  onPickSample: (book: Book) => void
}) {
  return (
    <section className="landing">
      <p className="eyebrow">Text → Speech</p>
      <h1>Turn your books into audio</h1>
      <p className="lead">
        Drop in a document and Layla reads it aloud — extracting the text,
        splitting it into passages, and voicing each one in order.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.pdf,.epub"
        hidden
        onChange={(e) => onFileChosen(e.target.files)}
      />

      <div
        className={`dropzone${dragActive ? ' drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          onFileChosen(e.dataTransfer.files)
        }}
      >
        <span className="dropzone-icon">
          <Upload size={26} />
        </span>
        <h3>Drop a file here</h3>
        <p>or choose one from your device</p>
        <button
          type="button"
          className="btn primary"
          onClick={() => fileInputRef.current?.click()}
        >
          <BookOpen size={16} /> Choose file
        </button>

        <div className="formats">
          {(Object.keys(FORMAT_META) as BookFormat[]).map((f) => {
            const Icon = FORMAT_META[f].icon
            return (
              <span className="format-pill" key={f}>
                <Icon size={13} /> {FORMAT_META[f].label}
              </span>
            )
          })}
        </div>
      </div>

      <p className="samples-label">Or try a sample</p>
      <div className="sample-grid">
        {SAMPLE_BOOKS.map((b) => (
          <button
            type="button"
            className="sample-card"
            key={b.id}
            onClick={() => onPickSample(b)}
          >
            <span className="sample-cover" style={{ background: b.gradient }}>
              {b.cover}
            </span>
            <span className="sample-meta">
              <span className="sample-title">{b.title}</span>
              <span className="sample-sub">
                {b.author} · {FORMAT_META[b.format].label}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------------------
 * Reader (book panel + chunk list)
 * ------------------------------------------------------------------------- */

function Reader({
  book,
  currentChunk,
  isPlaying,
  voiceName,
  onReset,
  onJump,
}: {
  book: Book
  currentChunk: Chunk | null
  isPlaying: boolean
  voiceName: string | null
  onReset: () => void
  onJump: (c: Chunk) => void
}) {
  const readyCount = book.chunks.filter((c) => c.status === 'ready').length
  const total = book.chunks.length
  const synthDone = readyCount === total
  const totalSeconds = book.chunks.reduce((a, c) => a + c.duration, 0)
  const FormatIcon = FORMAT_META[book.format].icon

  return (
    <div className="reader-grid">
      {/* Left: book + pipeline */}
      <aside className="panel side">
        <div className="book-head">
          <span className="book-cover" style={{ background: book.gradient }}>
            {book.cover}
          </span>
          <div className="book-meta">
            <span className="book-title">{book.title}</span>
            <span className="book-author">{book.author}</span>
            <div className="badge-row">
              <span className="tag format">
                <FormatIcon size={11} /> {FORMAT_META[book.format].label}
              </span>
              <span className="tag">
                <ListMusic size={11} /> {total} chunks
              </span>
            </div>
          </div>
        </div>

        <div className="stat-row">
          <div className="stat">
            <div className="val">{total}</div>
            <div className="lbl">Passages</div>
          </div>
          <div className="stat">
            <div className="val">{readyCount}</div>
            <div className="lbl">Voiced</div>
          </div>
          <div className="stat">
            <div className="val">{fmtTime(totalSeconds)}</div>
            <div className="lbl">Runtime</div>
          </div>
        </div>

        <div className="pipeline">
          <div className="pipeline-title">Pipeline</div>
          <Stage state="done" icon={BookOpen} name="File selected" sub={FORMAT_META[book.format].label + ' document'} />
          <Stage state="done" icon={FileText} name="Text extracted" sub={extractSub(book)} />
          <Stage state="done" icon={Layers} name="Chunked into passages" sub={`${total} paragraphs`} />
          <Stage
            state={synthDone ? 'done' : 'active'}
            icon={synthDone ? Check : Loader2}
            spin={!synthDone}
            name="Pre-generating audio"
            sub={
              synthDone
                ? `All clips saved${voiceName ? ` · ${voiceName}` : ''}`
                : `${readyCount} / ${total} clips saved${voiceName ? ` · ${voiceName}` : ''}`
            }
          />
          <Stage
            state={isPlaying ? 'active' : synthDone ? 'done' : 'pending'}
            icon={Headphones}
            name="Playing queue"
            sub={isPlaying ? 'Now playing' : 'Ready to play'}
          />
        </div>

        <button type="button" className="btn" style={{ marginTop: 18, width: '100%' }} onClick={onReset}>
          <Upload size={15} /> Choose another file
        </button>
      </aside>

      {/* Right: chunk list */}
      <section className="panel chunks-panel">
        <div className="chunks-head">
          <div>
            <h2>Passages</h2>
            <span className="sub">Each passage becomes one audio clip</span>
          </div>
          <span className="tag">
            {synthDone ? <Check size={12} /> : <Loader2 size={12} className="spin" />}{' '}
            {readyCount}/{total}
          </span>
        </div>

        <div className="synth-progress" aria-hidden="true">
          <div className="fill" style={{ width: `${(readyCount / total) * 100}%` }} />
        </div>

        <div className="chunk-list">
          {book.chunks.map((chunk, i) => {
            const playing = currentChunk?.id === chunk.id
            return (
              <button
                type="button"
                key={chunk.id}
                className={`chunk-row${playing ? ' playing' : ''}`}
                onClick={() => onJump(chunk)}
                disabled={chunk.status !== 'ready'}
                aria-current={playing || undefined}
              >
                <span className="chunk-index">{i + 1}</span>
                <span className="chunk-body">
                  <span className="chunk-text">{chunk.text}</span>
                  <span className="chunk-foot">
                    <ChunkStatusBadge status={chunk.status} playing={playing && isPlaying} />
                    <span className="chunk-dur">{fmtTime(chunk.duration)}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Stage({
  state,
  icon: Icon,
  name,
  sub,
  spin,
}: {
  state: 'done' | 'active' | 'pending'
  icon: LucideIcon
  name: string
  sub: string
  spin?: boolean
}) {
  return (
    <div className={`stage ${state}`}>
      <span className="stage-dot">
        <Icon size={15} className={spin ? 'spin' : undefined} />
      </span>
      <span className="stage-body">
        <span className="stage-name">{name}</span>
        <span className="stage-sub">{sub}</span>
      </span>
    </div>
  )
}

function ChunkStatusBadge({ status, playing }: { status: ChunkStatus; playing: boolean }) {
  if (playing) {
    return (
      <span className="chunk-status playing">
        <span className="eq" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        Playing
      </span>
    )
  }
  if (status === 'ready') {
    return (
      <span className="chunk-status ready">
        <Check size={11} /> Ready
      </span>
    )
  }
  if (status === 'synthesizing') {
    return (
      <span className="chunk-status synth">
        <Loader2 size={11} className="spin" /> Voicing
      </span>
    )
  }
  return <span className="chunk-status">Queued</span>
}

/* ---------------------------------------------------------------------------
 * Sticky player bar
 * ------------------------------------------------------------------------- */

function Player({
  book,
  currentChunk,
  isPlaying,
  position,
  onToggle,
  onSkip,
}: {
  book: Book
  currentChunk: Chunk | null
  isPlaying: boolean
  position: { currentTime: number; duration: number }
  onToggle: () => void
  onSkip: (dir: -1 | 1) => void
}) {
  const index = currentChunk ? book.chunks.findIndex((c) => c.id === currentChunk.id) : -1
  const readyCount = book.chunks.filter((c) => c.status === 'ready').length
  // The host reports the real clip length once known; until then fall back to
  // the passage's estimated duration so the scrubber still has a total to show.
  const total = position.duration > 0 ? position.duration : currentChunk?.duration ?? 0
  const elapsed = currentChunk ? Math.min(position.currentTime, total) : 0
  const fraction = total > 0 ? elapsed / total : 0

  return (
    <div className="player" role="region" aria-label="Audio player">
      <div className="player-now">
        <span className="player-cover" style={{ background: book.gradient }}>
          <BookOpen size={18} />
        </span>
        <div className="player-now-meta">
          <div className="player-now-title">
            {currentChunk ? `Passage ${index + 1}` : 'Nothing playing'}
          </div>
          <div className="player-now-sub">{book.title}</div>
        </div>
      </div>

      <div className="player-center">
        <div className="transport">
          <button
            type="button"
            className="tbtn"
            onClick={() => onSkip(-1)}
            aria-label="Previous passage"
            disabled={!currentChunk}
          >
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button
            type="button"
            className="tbtn play"
            onClick={onToggle}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button
            type="button"
            className="tbtn"
            onClick={() => onSkip(1)}
            aria-label="Next passage"
            disabled={!currentChunk}
          >
            <SkipForward size={18} fill="currentColor" />
          </button>
        </div>

        <div className="scrubber">
          <span className="time">{fmtTime(elapsed)}</span>
          <div className="track">
            <div className="played" style={{ width: `${fraction * 100}%` }} />
          </div>
          <span className="time">{fmtTime(total)}</span>
        </div>
      </div>

      <div className="player-right">
        <span className="queue-chip">
          <ListMusic size={14} /> {readyCount} in queue
        </span>
        <button type="button" className="tbtn" aria-label="Volume">
          <Volume2 size={18} />
        </button>
      </div>
    </div>
  )
}
