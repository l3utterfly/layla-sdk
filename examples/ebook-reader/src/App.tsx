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
  Sparkles,
  SkipBack,
  SkipForward,
  Type,
  Upload,
  Volume2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import './App.css'

/* ---------------------------------------------------------------------------
 * Types + dummy data
 * All data here is placeholder. The real pipeline (extract → chunk → TTS →
 * queue) will be wired up feature-by-feature later.
 * ------------------------------------------------------------------------- */

type BookFormat = 'txt' | 'pdf' | 'epub'
type ChunkStatus = 'pending' | 'synthesizing' | 'ready'

interface Chunk {
  id: number
  text: string
  status: ChunkStatus
  duration: number // seconds (dummy)
}

interface Book {
  id: string
  title: string
  author: string
  format: BookFormat
  cover: string // single letter / short label
  gradient: string
  chunks: Chunk[]
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

const SAMPLE_BOOKS: Book[] = [
  {
    id: 'lighthouse',
    title: 'The Keeper of the Last Light',
    author: 'E. M. Harlow',
    format: 'epub',
    cover: 'K',
    gradient: 'linear-gradient(150deg, #47a6ff, #1b6fb8)',
    chunks: makeChunks(1),
  },
  {
    id: 'orbit',
    title: 'Notes from a Decaying Orbit',
    author: 'Priya Anand',
    format: 'pdf',
    cover: 'O',
    gradient: 'linear-gradient(150deg, #8a5cff, #4b2fa8)',
    chunks: makeChunks(2),
  },
  {
    id: 'garden',
    title: 'The Midnight Garden Papers',
    author: 'T. Okafor',
    format: 'txt',
    cover: 'G',
    gradient: 'linear-gradient(150deg, #2fbf8f, #12795a)',
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

/* ---------------------------------------------------------------------------
 * App
 * ------------------------------------------------------------------------- */

export default function App() {
  const [book, setBook] = useState<Book | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const [playingId, setPlayingId] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1 within current chunk

  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadBook = useCallback((source: Book) => {
    // clone so each load restarts the simulated pipeline
    setBook({ ...source, chunks: source.chunks.map((c) => ({ ...c, status: 'pending' })) })
    setPlayingId(null)
    setIsPlaying(false)
    setProgress(0)
  }, [])

  const reset = useCallback(() => {
    setBook(null)
    setPlayingId(null)
    setIsPlaying(false)
    setProgress(0)
  }, [])

  /* ---- Simulated TTS synthesis: promote one chunk per tick ---- */
  useEffect(() => {
    if (!book) return
    const timer = setInterval(() => {
      setBook((prev) => {
        if (!prev) return prev
        const idx = prev.chunks.findIndex((c) => c.status !== 'ready')
        if (idx === -1) return prev
        const chunks = prev.chunks.map((c, i) => {
          if (i !== idx) return c
          return { ...c, status: c.status === 'pending' ? 'synthesizing' : 'ready' } as Chunk
        })
        return { ...prev, chunks }
      })
    }, 850)
    return () => clearInterval(timer)
  }, [book?.id])

  /* ---- Simulated playback progress + auto-advance ---- */
  const currentChunk = useMemo(
    () => book?.chunks.find((c) => c.id === playingId) ?? null,
    [book, playingId],
  )

  useEffect(() => {
    if (!isPlaying || !book || !currentChunk) return
    const step = 0.2 // seconds per tick
    const timer = setInterval(() => {
      setProgress((p) => {
        const next = p + step / currentChunk.duration
        if (next < 1) return next
        // advance to the next ready chunk in the queue
        const idx = book.chunks.findIndex((c) => c.id === currentChunk.id)
        const following = book.chunks.slice(idx + 1)
        const nextChunk = following.find((c) => c.status === 'ready')
        if (nextChunk) {
          setPlayingId(nextChunk.id)
          return 0
        }
        // nothing ready yet — hold at the end of this chunk
        setIsPlaying(false)
        return 1
      })
    }, 200)
    return () => clearInterval(timer)
  }, [isPlaying, book, currentChunk])

  const firstReadyId = useMemo(
    () => book?.chunks.find((c) => c.status === 'ready')?.id ?? null,
    [book],
  )

  const togglePlay = useCallback(() => {
    if (!book) return
    if (playingId == null) {
      if (firstReadyId == null) return
      setPlayingId(firstReadyId)
      setProgress(0)
      setIsPlaying(true)
      return
    }
    setIsPlaying((v) => !v)
  }, [book, playingId, firstReadyId])

  const jumpTo = useCallback(
    (chunk: Chunk) => {
      if (chunk.status !== 'ready') return
      setPlayingId(chunk.id)
      setProgress(0)
      setIsPlaying(true)
    },
    [],
  )

  const skip = useCallback(
    (dir: -1 | 1) => {
      if (!book || playingId == null) return
      const ready = book.chunks.filter((c) => c.status === 'ready')
      const pos = ready.findIndex((c) => c.id === playingId)
      const target = ready[pos + dir]
      if (target) {
        setPlayingId(target.id)
        setProgress(0)
      }
    },
    [book, playingId],
  )

  /* ---- File input (UI only — we load a dummy book) ---- */
  const onFileChosen = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      const ext = file?.name.split('.').pop()?.toLowerCase()
      const format: BookFormat =
        ext === 'pdf' ? 'pdf' : ext === 'epub' ? 'epub' : 'txt'
      const base = SAMPLE_BOOKS.find((b) => b.format === format) ?? SAMPLE_BOOKS[0]
      loadBook(
        file
          ? { ...base, title: file.name.replace(/\.[^.]+$/, ''), author: 'Imported file', format }
          : base,
      )
    },
    [loadBook],
  )

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
          {!book ? (
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
          progress={progress}
          onToggle={togglePlay}
          onSkip={skip}
        />
      )}
    </>
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
  onReset,
  onJump,
}: {
  book: Book
  currentChunk: Chunk | null
  isPlaying: boolean
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
          <Stage state="done" icon={FileText} name="Text extracted" sub="Plain text ready" />
          <Stage state="done" icon={Layers} name="Chunked into passages" sub={`${total} paragraphs`} />
          <Stage
            state={synthDone ? 'done' : 'active'}
            icon={synthDone ? Check : Loader2}
            spin={!synthDone}
            name="Synthesizing audio"
            sub={synthDone ? 'All clips generated' : `${readyCount} / ${total} clips ready`}
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
  progress,
  onToggle,
  onSkip,
}: {
  book: Book
  currentChunk: Chunk | null
  isPlaying: boolean
  progress: number
  onToggle: () => void
  onSkip: (dir: -1 | 1) => void
}) {
  const index = currentChunk ? book.chunks.findIndex((c) => c.id === currentChunk.id) : -1
  const readyCount = book.chunks.filter((c) => c.status === 'ready').length
  const elapsed = currentChunk ? currentChunk.duration * progress : 0

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
            <div className="played" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="time">{fmtTime(currentChunk?.duration ?? 0)}</span>
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
