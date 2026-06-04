# Enabling Stockfish

The app runs out of the box with a small **built-in engine** (see
`src/engine/useChessEngine.ts`) so you can play immediately. To use the real
**Stockfish** engine instead, drop a single-file UCI worker here so it's served
at `/stockfish.js`:

## Option A — single-file build (simplest, no special headers)

1. Download an asm.js / single-file build of Stockfish (e.g. from the
   `stockfish.js` project) named `stockfish.js`.
2. Place it in this `public/` folder.

That's it. On load the app spawns `new Worker('/stockfish.js')`, completes the
UCI handshake, and automatically switches from "Built-in engine" to "Stockfish".

## Option B — npm package

```bash
npm install stockfish
```

Then copy the worker file it ships into `public/stockfish.js` (a small copy
script in `package.json` works well), or point `useChessEngine("/your-path.js")`
at wherever you serve it.

## Notes

- Multi-threaded WASM builds need cross-origin isolation headers
  (`Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`). The single-file asm.js build in
  Option A avoids that entirely.
- Difficulty maps to Stockfish's `Skill Level` UCI option (0–20) plus a per-move
  time budget — see `src/data.ts`.
