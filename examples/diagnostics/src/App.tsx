import { useEffect, useMemo, useRef, useState } from "react";
import {
  LaylaSDK,
  LaylaAbortError,
  type AceStepProgress,
  type AceStepRequest,
  type LaylaCharacter,
} from "../../../src/index";
import type { LaylaMockHandle } from "../../../src/mock";
import "./App.css";

/* ------------------------------------------------------------------ *
 * Layla SDK diagnostics
 * ---------------------
 * One mini-app that exercises every public SDK endpoint plus the
 * per-lane concurrency behaviour. It runs two ways from the same build:
 *
 *   • `npm run dev` in a browser  -> talks to the installed browser mock
 *     (see main.tsx), so the whole suite is green with no host.
 *   • copied to the host WebView  -> talks to the real bridge, so it is a
 *     sanity check that the host implements the protocol correctly.
 *
 * Keep this suite up to date as the SDK grows: it is the one-shot smoke
 * test we run to confirm nothing regressed.
 * ------------------------------------------------------------------ */

const layla = new LaylaSDK();
const sessionId = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const mockHandle = (): LaylaMockHandle | null =>
  (window as unknown as { __laylaDiagMock?: LaylaMockHandle }).__laylaDiagMock ??
  null;

const hasBridge = (): boolean =>
  !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;

type Weight = "safe" | "heavy";
type Status = "idle" | "running" | "pass" | "fail" | "skip";

interface CheckCtx {
  layla: LaylaSDK;
  mock: LaylaMockHandle | null;
  sessionId: string;
  /** Cross-check cache (e.g. a character id resolved once and reused). */
  shared: {
    characters?: LaylaCharacter[];
    /** An enriched request from the raw LM pass, rendered by the synth check. */
    aceStepTake?: AceStepRequest;
    /** A rendered track, reused as the source for understand/VAE. */
    aceStepAudio?: string;
    /** Latents from understand, reused by the understand-from-latents check. */
    aceStepLatents?: string;
  };
  /**
   * Aborts when the user stops the run. Checks may forward it to the SDK (e.g.
   * as a stream `signal`) so long-running work is cancelled promptly; the runner
   * also races every check against it so the UI never waits on a stopped check.
  */
  signal: AbortSignal;
  /** Append plain text to this check's expandable diagnostic log. */
  log: (text: string) => void;
}

type SharedCheckCtx = Omit<CheckCtx, "log">;

interface Check {
  id: string;
  name: string;
  /** One line describing what this proves. */
  desc: string;
  weight: Weight;
  /**
   * Exempt this check from the runner's watchdog. Set on endpoints that are
   * designed to run for a long time (on-device generation), where a fixed
   * deadline would produce false failures.
   */
  noTimeout?: boolean;
  /** Resolve with a detail string, throw to fail, throw Skip to skip. */
  run: (ctx: CheckCtx) => Promise<string>;
}

interface Group {
  id: string;
  title: string;
  blurb: string;
  checks: Check[];
}

interface Result {
  status: Status;
  ms?: number;
  detail?: string;
  log?: string;
}

/* ---- tiny test helpers ------------------------------------------------ */

class SkipError extends Error {}
const skip = (why: string): never => {
  throw new SkipError(why);
};

/** Thrown by `abortable` when the user stops the run mid-check. */
class StopError extends Error {}

/** Reject with StopError as soon as `signal` aborts, else follow `p`. */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new StopError("stopped"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new StopError("stopped"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const truncate = (s: string, n = 80) =>
  s.length > n ? `${s.slice(0, n)}…` : s;

/** Reject if `p` has not settled within `ms`, so a dead endpoint fails loudly. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Resolve when `attach` fires its callback, or reject on timeout. */
function waitForEvent<T>(
  attach: (fire: (value: T) => void) => () => void,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      detach();
      reject(new Error(`no ${label} within ${ms}ms`));
    }, ms);
    const detach = attach((value) => {
      clearTimeout(t);
      detach();
      resolve(value);
    });
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * A short 16-bit PCM WAV holding a quiet 440Hz tone, as a data URI.
 *
 * The Ace-Step analysis passes need a real track to chew on. Preferring one the
 * synth check just rendered keeps the run realistic, but a synthetic tone lets
 * `understand` and the VAE round-trip be run on their own without paying for a
 * full render first.
 */
function makeTestWavDataUri(seconds = 2, sampleRate = 16000): string {
  const numSamples = Math.floor(seconds * sampleRate);
  const bytes = new Uint8Array(44 + numSamples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i += 1) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.3;
    view.setInt16(44 + i * 2, Math.round(sample * 0x7fff), true);
  }
  return `data:audio/wav;base64,${toBase64(bytes)}`;
}

/** The track the analysis passes work on: a rendered one if we have it. */
function aceStepSourceAudio(ctx: CheckCtx): string {
  if (ctx.shared.aceStepAudio) {
    ctx.log("source: the track rendered by the synth check");
    return ctx.shared.aceStepAudio;
  }
  ctx.log("source: a synthetic 2s 440Hz test tone (no rendered track cached)");
  return makeTestWavDataUri();
}

const ACE_STEP_CAPTION = "A dreamy lo-fi hip-hop beat with warm vinyl crackle";

/**
 * Collect progress for one raw Ace-Step pass and assert the contract every raw
 * command shares: ticks arrive, and `progress` is null on all of them because a
 * single pass has no defined share of a larger whole.
 */
function aceStepProgressProbe(ctx: CheckCtx) {
  const ticks: AceStepProgress[] = [];
  return {
    onProgress: (p: AceStepProgress) => ticks.push(p),
    verify(): string {
      assert(ticks.length > 0, "no on_ace_step_generate_progress events");
      const withFraction = ticks.filter((t) => t.progress !== null);
      assert(
        withFraction.length === 0,
        `a raw pass must report progress: null, got ${withFraction.length} tick(s) with a fraction`,
      );
      const phases = [...new Set(ticks.map((t) => t.status))];
      ctx.log(
        `progress: ${ticks.length} events across ${phases.length} phase(s): ${phases.join(", ")}`,
      );
      ctx.log(
        ticks
          .slice(0, 12)
          .map((t) => `  ${t.status} ${t.current}/${t.total}`)
          .join("\n"),
      );
      return `${ticks.length} progress events`;
    },
  };
}

async function firstCharacterId(ctx: CheckCtx): Promise<string> {
  if (!ctx.shared.characters) {
    ctx.shared.characters = await ctx.layla.characters.list(0, 5);
  }
  const id = ctx.shared.characters[0]?.id;
  if (!id) skip("no characters available on this host");
  return id;
}

/* ---- the suite -------------------------------------------------------- */

const groups: Group[] = [
  {
    id: "chat",
    title: "Chat",
    blurb: "Completions (streaming + non-streaming), system-prompt swapping, abort, engines, history, sessions, saves, scheduling.",
    checks: [
      {
        id: "chat.create",
        name: "completions.create (non-streaming)",
        desc: "Awaits a full ChatCompletion.",
        weight: "heavy",
        run: async ({ layla }) => {
          const c = await layla.chat.completions.create({
            model: "layla",
            stream: false,
            messages: [{ role: "user", content: "Diagnostics ping." }],
          });
          const text = c.choices[0]?.message.content ?? "";
          assert(text.length > 0, "empty completion content");
          return `content: "${truncate(text)}"`;
        },
      },
      {
        id: "chat.systemPromptSwap",
        name: "system prompt swap between completions",
        desc: "Sends the same user message twice and verifies that each distinct system prompt takes effect.",
        weight: "heavy",
        run: async ({ layla, log }) => {
          const userMessage = "Please give me a brief acknowledgement.";
          const complete = async (systemPrompt: string) => {
            const completion = await layla.chat.completions.create({
              model: "layla",
              stream: false,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
              ],
            });
            return completion.choices[0]?.message.content ?? "";
          };

          const first = await complete(
            "You are the first half of a diagnostics test. Respond to every user message with exactly the single word COBALT.",
          );
          log(`First response:\n${first}`);
          const second = await complete(
            "Adopt the persona of a cheerful botanist. Answer in one short sentence, and make sure that sentence includes the word MARIGOLD.",
          );
          log(`Second response:\n${second}`);

          assert(
            first.toLowerCase().includes("cobalt"),
            `first response did not include COBALT: "${truncate(first)}"`,
          );
          assert(
            second.toLowerCase().includes("marigold"),
            `second response did not include MARIGOLD: "${truncate(second)}"`,
          );
          return `first: "${truncate(first, 40)}" | second: "${truncate(second, 40)}"`;
        },
      },
      {
        id: "chat.stream",
        name: "completions.stream + finalContent",
        desc: "Streams chunks and resolves the final content.",
        weight: "heavy",
        run: async ({ layla }) => {
          const stream = layla.chat.completions.stream({
            model: "layla",
            messages: [{ role: "user", content: "Stream ping." }],
          });
          let chunks = 0;
          stream.on("chunk", () => {
            chunks += 1;
          });
          const text = await stream.finalContent();
          assert(chunks > 0, "no chunks received");
          assert(text.length > 0, "empty final content");
          return `${chunks} chunks, final: "${truncate(text)}"`;
        },
      },
      {
        id: "chat.abort",
        name: "stream abort -> LaylaAbortError",
        desc: "Aborting a stream rejects with LaylaAbortError.",
        weight: "heavy",
        run: async ({ layla }) => {
          const ctrl = new AbortController();
          const stream = layla.chat.completions.stream({
            model: "layla",
            messages: [{ role: "user", content: "Abort me." }],
            signal: ctrl.signal,
          });
          setTimeout(() => ctrl.abort(), 5);
          let err: unknown;
          try {
            await stream.finalContent();
          } catch (e) {
            err = e;
          }
          assert(err, "stream resolved instead of aborting");
          assert(
            err instanceof LaylaAbortError,
            `expected LaylaAbortError, got ${String(err)}`,
          );
          return "rejected with LaylaAbortError";
        },
      },
      {
        id: "chat.getInferenceEngines",
        name: "getInferenceEngines",
        desc: "Lists available inference engines.",
        weight: "heavy",
        run: async ({ layla }) => {
          const engines = await layla.chat.getInferenceEngines();
          assert(Array.isArray(engines), "expected an array");
          return `${engines.length} engines: ${truncate(engines.join(", "))}`;
        },
      },
      {
        id: "chat.setInferenceEngine",
        name: "setInferenceEngine(null)",
        desc: "Resets to the host default engine (safe no-op).",
        weight: "heavy",
        run: async ({ layla }) => {
          const r = await layla.chat.setInferenceEngine(null);
          return `ok: ${truncate(JSON.stringify(r))}`;
        },
      },
      {
        id: "chat.getChatHistory",
        name: "getChatHistory",
        desc: "Reads history for the diagnostics session.",
        weight: "heavy",
        run: async ({ layla, sessionId }) => {
          const h = await layla.chat.getChatHistory(sessionId, 0, 5);
          assert(Array.isArray(h), "expected an array");
          return `${h.length} entries`;
        },
      },
      {
        id: "chat.getChatSessions",
        name: "getChatSessions",
        desc: "Reads sessions for the first character.",
        weight: "heavy",
        run: async (ctx) => {
          const cid = await firstCharacterId(ctx);
          const r = await ctx.layla.chat.getChatSessions(cid, 0, 5);
          assert(Array.isArray(r.sessions), "expected sessions array");
          return `${r.sessions.length} sessions`;
        },
      },
      {
        id: "chat.saveChatMessage",
        name: "saveChatMessage (write)",
        desc: "Persists a diagnostics message and gets its id.",
        weight: "heavy",
        run: async (ctx) => {
          const cid = await firstCharacterId(ctx);
          const saved = await ctx.layla.chat.saveChatMessage({
            id: 0,
            character_id: cid,
            session_id: ctx.sessionId,
            role: "user",
            content: "[diagnostics] saveChatMessage probe",
            timestamp: Date.now(),
          });
          assert(typeof saved.id === "number", "no id returned");
          return `saved id ${saved.id}`;
        },
      },
      {
        id: "chat.schedule",
        name: "schedule -> get -> cancel (write, self-cleaning)",
        desc: "Schedules a future message, lists it, then cancels it.",
        weight: "heavy",
        run: async (ctx) => {
          const cid = await firstCharacterId(ctx);
          const sched = await ctx.layla.chat.scheduleChatMessage({
            id: 0,
            character_id: cid,
            session_id: ctx.sessionId,
            timestamp: Date.now() + 3_600_000,
            message: "[diagnostics] scheduled probe",
          });
          assert(typeof sched.id === "number", "no scheduled id");
          const list = await ctx.layla.chat.getScheduledChatMessages();
          assert(Array.isArray(list), "expected schedule array");
          const cancelled = await ctx.layla.chat.cancelScheduledChatMessage(
            sched.id,
          );
          return `id ${sched.id}, ${list.length} pending, cancel -> ${truncate(
            JSON.stringify(cancelled),
          )}`;
        },
      },
    ],
  },
  {
    id: "characters",
    title: "Characters",
    blurb: "List, image, and a no-op update round-trip.",
    checks: [
      {
        id: "characters.list",
        name: "list",
        desc: "Lists character cards.",
        weight: "safe",
        run: async (ctx) => {
          ctx.shared.characters = await ctx.layla.characters.list(0, 5);
          assert(Array.isArray(ctx.shared.characters), "expected an array");
          return `${ctx.shared.characters.length} characters`;
        },
      },
      {
        id: "characters.getImage",
        name: "getImage",
        desc: "Fetches the first character's image (may be null).",
        weight: "safe",
        run: async (ctx) => {
          const cid = await firstCharacterId(ctx);
          const img = await ctx.layla.characters.getImage(cid);
          return img
            ? `image src length ${img.length}`
            : "no image for character (null)";
        },
      },
      {
        id: "characters.update",
        name: "update (no-op round-trip, write)",
        desc: "Re-saves the first character unchanged to exercise update.",
        weight: "safe",
        run: async (ctx) => {
          const cid = await firstCharacterId(ctx);
          const char = ctx.shared.characters?.find((c) => c.id === cid);
          assert(char, "character not found to update");
          const returnedId = await ctx.layla.characters.update(char);
          return `updated -> id ${returnedId}`;
        },
      },
    ],
  },
  {
    id: "memories",
    title: "Memories",
    blurb: "List, top memories, and create/update.",
    checks: [
      {
        id: "memories.list",
        name: "list",
        desc: "Lists memories for the first character.",
        weight: "safe",
        run: async (ctx) => {
          const cid = await firstCharacterId(ctx);
          const m = await ctx.layla.memories.list(cid, 0, 5);
          assert(Array.isArray(m), "expected an array");
          return `${m.length} memories`;
        },
      },
      {
        id: "memories.getTop",
        name: "getTopMemories",
        desc: "Reads the host-ranked top memories.",
        weight: "safe",
        run: async (ctx) => {
          const cid = await firstCharacterId(ctx);
          const m = await ctx.layla.memories.getTopMemories(cid, 5);
          assert(Array.isArray(m), "expected an array");
          return `${m.length} top memories`;
        },
      },
      {
        id: "memories.createOrUpdate",
        name: "createOrUpdate (write)",
        desc: "Creates a diagnostics memory (id <= 0).",
        weight: "safe",
        run: async (ctx) => {
          const cid = await firstCharacterId(ctx);
          const saved = await ctx.layla.memories.createOrUpdate([
            {
              id: 0,
              character_id: cid,
              session_id: ctx.sessionId,
              rawText: "[diagnostics] memory probe",
              timestamp: Date.now(),
              summary: null,
              knowledgeGraphJSON: null,
            },
          ]);
          assert(Array.isArray(saved), "expected an array");
          return `saved ${saved.length} memory(ies)`;
        },
      },
    ],
  },
  {
    id: "personas",
    title: "Personas",
    blurb: "Default persona read.",
    checks: [
      {
        id: "personas.get",
        name: "get(null)",
        desc: "Reads the default persona.",
        weight: "safe",
        run: async ({ layla }) => {
          const p = await layla.personas.get(null);
          assert(typeof p.name === "string", "persona missing name");
          return `persona: ${truncate(p.name)}`;
        },
      },
    ],
  },
  {
    id: "classifier",
    title: "Classifier",
    blurb: "Sentiment analysis.",
    checks: [
      {
        id: "classifier.getSentiment",
        name: "getSentiment",
        desc: "Scores sentiment for a sample string.",
        weight: "safe",
        run: async ({ layla }) => {
          const s = await layla.classifier.getSentiment(
            "I love how well this SDK works!",
          );
          const keys = Object.keys(s);
          assert(keys.length > 0, "empty sentiment result");
          return `${keys.length} sentiment fields`;
        },
      },
    ],
  },
  {
    id: "utils",
    title: "Utils (files)",
    blurb: "Save then read back a private file.",
    checks: [
      {
        id: "utils.fileRoundTrip",
        name: "saveFile -> readFile round-trip (write)",
        desc: "Writes base64 content and reads it back.",
        weight: "safe",
        run: async ({ layla }) => {
          const filename = `diagnostics-${Date.now()}.txt`;
          const content = "hello from diagnostics";
          const base64 = btoa(content);
          const saved = await layla.utils.saveFile(filename, base64, false);
          const read = await layla.utils.readFile(filename);
          assert(read.content_base64, "readFile returned no content");
          return `saved (${truncate(JSON.stringify(saved))}), read ${
            read.content_base64.length
          } chars`;
        },
      },
    ],
  },
  {
    id: "db",
    title: "Database",
    blurb: "executeSql create/insert/select round-trip.",
    checks: [
      {
        id: "db.roundTrip",
        name: "executeSql round-trip (write)",
        desc: "CREATE, INSERT (params), then SELECT the row back.",
        weight: "safe",
        run: async ({ layla }) => {
          const table = `diag_${Date.now().toString(36)}`;
          await layla.db.executeSql(
            `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, a TEXT, b TEXT)`,
          );
          const ins = await layla.db.executeSql(
            `INSERT INTO ${table} (a, b) VALUES (?, ?)`,
            ["one", "two"],
          );
          const sel = await layla.db.executeSql(`SELECT * FROM ${table}`);
          assert(Array.isArray(sel.rows), "SELECT returned no rows array");
          return `insertId ${ins.insertId}, rowsAffected ${ins.rowsAffected}, selected ${sel.rows.length} row(s)`;
        },
      },
    ],
  },
  {
    id: "contextual",
    title: "Contextual",
    blurb: "Execution context + push-event subscription.",
    checks: [
      {
        id: "contextual.getExecutionContext",
        name: "getExecutionContext",
        desc: "Reads the mini-app execution context.",
        weight: "safe",
        run: async ({ layla }) => {
          const ctx = await layla.contextual.getExecutionContext();
          return `appVersion: ${truncate(
            String((ctx as { appVersion?: unknown }).appVersion ?? "?"),
          )}`;
        },
      },
      {
        id: "contextual.subscription",
        name: "on('chatContextNewMessage') subscription",
        desc: "Registers a listener; verifies delivery when a synthetic event is available.",
        weight: "safe",
        run: async ({ layla, mock }) => {
          if (!mock) {
            // On the real host these fire from live chat activity, which the
            // test can't stage. Prove attach/detach don't throw and move on.
            const noop = () => {};
            layla.contextual.on("chatContextNewMessage", noop);
            layla.contextual.off("chatContextNewMessage", noop);
            return skip(
              "no synthetic emitter on host — verify with live chat activity",
            );
          }
          const received = waitForEvent<unknown>(
            (fire) => {
              const l = (data: unknown) => fire(data);
              layla.contextual.on("chatContextNewMessage", l);
              return () => layla.contextual.off("chatContextNewMessage", l);
            },
            2000,
            "chatContextNewMessage",
          );
          await delay(10);
          mock.emitChatContextNewMessage({
            message: {
              role: "assistant",
              content: "[diagnostics] synthetic context message",
            },
          } as Parameters<LaylaMockHandle["emitChatContextNewMessage"]>[0]);
          await received;
          return "listener received a synthetic context event";
        },
      },
    ],
  },
  {
    id: "concurrency",
    title: "Concurrency (per-lane serialisation)",
    blurb: "The behaviour introduced by the per-lane bridge change.",
    checks: [
      {
        id: "conc.crossLane",
        name: "cross-lane: fast db is not blocked by slow chat",
        desc: "Fires a slow chat stream and a db query together; the db call must finish first.",
        weight: "safe",
        run: async ({ layla }) => {
          const t0 = performance.now();
          let chatMs = 0;
          let dbMs = 0;
          const chat = layla.chat.completions
            .stream({
              model: "layla",
              messages: [{ role: "user", content: "Say several words please." }],
            })
            .finalContent()
            .then(() => {
              chatMs = performance.now() - t0;
            });
          const db = layla.db
            .executeSql("SELECT 1")
            .then(() => {
              dbMs = performance.now() - t0;
            });
          await Promise.all([chat, db]);
          assert(
            dbMs < chatMs,
            `db (${dbMs | 0}ms) did not finish before chat (${chatMs | 0}ms) — lanes may be serialised globally`,
          );
          return `db @${dbMs | 0}ms finished before chat @${chatMs | 0}ms (concurrent lanes)`;
        },
      },
      {
        id: "conc.fanOut",
        name: "multi-surface fan-out runs in parallel",
        desc: "Fires one read per surface at once; wall time should be well under their sum.",
        weight: "safe",
        run: async (ctx) => {
          const cid = await firstCharacterId(ctx);
          const { layla } = ctx;
          const jobs: Array<[string, Promise<unknown>]> = [
            ["engines", layla.chat.getInferenceEngines()],
            ["voices", layla.tts.getVoices()],
            ["persona", layla.personas.get(null)],
            ["memories", layla.memories.list(cid, 0, 3)],
            ["sentiment", layla.classifier.getSentiment("great")],
            ["models", layla.images.getImageGenerationModels()],
            ["context", layla.contextual.getExecutionContext()],
            ["sql", layla.db.executeSql("SELECT 1")],
          ];
          const t0 = performance.now();
          const settled = await Promise.allSettled(jobs.map(([, p]) => p));
          const wall = performance.now() - t0;
          const failed = settled
            .map((s, i) => [jobs[i][0], s] as const)
            .filter(([, s]) => s.status === "rejected");
          assert(
            failed.length === 0,
            `failed: ${failed
              .map(([name, s]) => `${name} (${String((s as PromiseRejectedResult).reason)})`)
              .join(", ")}`,
          );
          return `${jobs.length} surfaces resolved in ${wall | 0}ms wall time`;
        },
      },
      {
        id: "conc.sameLaneNoCrossTalk",
        name: "same-lane: two chats don't cross-talk",
        desc: "Two simultaneous chat generations each return their own answer.",
        weight: "safe",
        run: async ({ layla }) => {
          const a = layla.chat.completions
            .stream({
              model: "layla",
              messages: [{ role: "user", content: "ALPHA-marker" }],
            })
            .finalContent();
          const b = layla.chat.completions
            .stream({
              model: "layla",
              messages: [{ role: "user", content: "BETA-marker" }],
            })
            .finalContent();
          const [ra, rb] = await Promise.all([a, b]);
          // The mock echoes the prompt; on a real host we can only check that
          // both produced non-empty, distinct-enough answers.
          assert(ra.length > 0 && rb.length > 0, "one generation was empty");
          const mock = mockHandle();
          if (mock) {
            assert(
              ra.includes("ALPHA-marker") && rb.includes("BETA-marker"),
              `cross-talk: A="${truncate(ra, 40)}" B="${truncate(rb, 40)}"`,
            );
          }
          return `A: "${truncate(ra, 30)}" | B: "${truncate(rb, 30)}"`;
        },
      },
      {
        id: "conc.errorIsolation",
        name: "error isolation (requires host id-echo)",
        desc: "A failing request must not take down a concurrent healthy one.",
        weight: "safe",
        run: async ({ layla }) => {
          // Probe: a query the real host should reject (missing table). A valid
          // read runs alongside it. If the host echoes request ids, only the
          // bad query fails; the good one survives.
          let badFailed = false;
          const bad = layla.db
            .executeSql("SELECT * FROM __diagnostics_missing_table__")
            .then(
              () => undefined,
              () => {
                badFailed = true;
              },
            );
          let goodOk = false;
          let goodErr: unknown;
          const good = layla.tts.getVoices().then(
            () => {
              goodOk = true;
            },
            (e) => {
              goodErr = e;
            },
          );
          await Promise.all([bad, good]);
          if (!badFailed) {
            skip(
              "probe query did not raise an error here (expected under the browser mock or a lenient host)",
            );
          }
          assert(
            goodOk,
            `concurrent healthy request also failed (${String(
              goodErr,
            )}) — host is not attributing errors by id`,
          );
          return "bad request failed in isolation; concurrent request survived";
        },
      },
    ],
  },
  {
    id: "media",
    title: "Media & devices (heavy)",
    blurb: "TTS synthesis/playback, image generation, music generation and the raw Ace-Step passes, microphone, background audio. Not run by default.",
    checks: [
      {
        id: "tts.getVoices",
        name: "tts.getVoices",
        desc: "Lists installed TTS voices.",
        weight: "safe",
        run: async ({ layla }) => {
          const v = await layla.tts.getVoices();
          assert(Array.isArray(v), "expected an array");
          return `${v.length} voices`;
        },
      },
      {
        id: "tts.generateVoiceToFile",
        name: "tts.generateVoiceToFile",
        desc: "Synthesises audio without playback.",
        weight: "heavy",
        noTimeout: true,
        run: async ({ layla }) => {
          const r = await layla.tts.generateVoiceToFile(
            null,
            "Diagnostics voice test.",
            false,
          );
          const size =
            "audio_data_base64" in r
              ? r.audio_data_base64?.length
              : (r as { filename?: string }).filename;
          return `generated (${truncate(String(size))})`;
        },
      },
      {
        id: "tts.generateVoice",
        name: "tts.generateVoice + stopSpeaking",
        desc: "Plays synthesised audio, then stops it — and the in-flight generateVoice must settle too.",
        weight: "heavy",
        noTimeout: true,
        run: async ({ layla }) => {
          let settled = false;
          const speaking = layla.tts
            .generateVoice(null, "Diagnostics playback test.")
            .then(() => {
              settled = true;
            });
          await delay(300);
          await withTimeout(layla.tts.stopSpeaking(), 5_000, "stopSpeaking");
          // stopSpeaking must also terminate the in-flight generateVoice, not
          // just the host's audio. The host emits a single on_finished_speaking
          // with no correlatable id; if the bridge drops it, this promise never
          // resolves and the check would hang — so bound the wait and assert.
          await withTimeout(
            speaking,
            5_000,
            "generateVoice to settle after stopSpeaking",
          );
          assert(settled, "generateVoice did not settle after stopSpeaking");
          return "played, stopped, and generateVoice settled";
        },
      },
      {
        id: "images.getModels",
        name: "images.getImageGenerationModels",
        desc: "Lists image-generation models.",
        weight: "safe",
        run: async ({ layla }) => {
          const m = await layla.images.getImageGenerationModels();
          assert(Array.isArray(m), "expected an array");
          return `${m.length} models`;
        },
      },
      {
        id: "images.generate",
        name: "images.generateImage (+progress)",
        desc: "Generates an image and receives progress callbacks.",
        weight: "heavy",
        noTimeout: true,
        run: async ({ layla }) => {
          let progress = 0;
          const src = await layla.images.generateImage(
            "a small friendly robot, test render",
            () => {
              progress += 1;
            },
          );
          return src
            ? `image (${src.length} chars), ${progress} progress events`
            : `no image returned, ${progress} progress events`;
        },
      },
      {
        id: "acestep.generate",
        name: "acestep.generateMusic (+progress)",
        desc: "Generates music with Ace-Step end to end and receives progress callbacks carrying a whole-request fraction.",
        weight: "heavy",
        noTimeout: true,
        run: async (ctx) => {
          const ticks: AceStepProgress[] = [];
          const src = await ctx.layla.acestep.generateMusic(
            "a short upbeat chiptune loop, test render",
            (progress, status, current, total) =>
              ticks.push({ progress, status, current, total }),
            undefined,
            undefined,
            { signal: ctx.signal },
          );
          assert(ticks.length > 0, "no progress events");
          // Unlike a raw pass, the one-call pipeline knows how its phases weigh
          // against each other, so every tick must carry a real fraction.
          const missing = ticks.filter(
            (t) => typeof t.progress !== "number" || Number.isNaN(t.progress),
          );
          assert(
            missing.length === 0,
            `generateMusic must report a 0..1 fraction, got ${missing.length} tick(s) without one`,
          );
          const phases = [...new Set(ticks.map((t) => t.status))];
          ctx.log(`phases: ${phases.join(", ")}`);
          ctx.log(
            ticks
              .slice(0, 12)
              .map(
                (t) =>
                  `  ${t.status} ${t.current}/${t.total} — ${Math.round((t.progress ?? 0) * 100)}%`,
              )
              .join("\n"),
          );
          const pct = Math.round((ticks[ticks.length - 1].progress ?? 0) * 100);
          return src
            ? `audio (${src.length} chars), ${ticks.length} progress events (last ${pct}%)`
            : `no audio returned, ${ticks.length} progress events (last ${pct}%)`;
        },
      },
      {
        id: "acestep.lm",
        name: "acestep.lm (raw LM pass)",
        desc: "Enriches a caption into metadata, lyrics and audio codes without rendering audio.",
        weight: "heavy",
        noTimeout: true,
        run: async (ctx) => {
          const probe = aceStepProgressProbe(ctx);
          const requests = await ctx.layla.acestep.lm(
            { caption: ACE_STEP_CAPTION, duration: 20, lm_batch_size: 2 },
            { onProgress: probe.onProgress, signal: ctx.signal },
          );
          assert(Array.isArray(requests), "expected an array of requests");
          assert(requests.length > 0, "expected at least one enriched request");
          const take = requests[0];
          assert(
            typeof take.caption === "string" && take.caption.length > 0,
            "the enriched request lost its caption",
          );
          ctx.shared.aceStepTake = take;
          ctx.log(`take 1: ${truncate(JSON.stringify(take), 400)}`);
          const detail = probe.verify();
          const lyrics = take.lyrics ? `${take.lyrics.length} chars` : "none";
          return `${requests.length} variant(s), lyrics ${lyrics}, codes ${take.audio_codes ? "yes" : "no"}, ${detail}`;
        },
      },
      {
        id: "acestep.synth",
        name: "acestep.synth (raw render)",
        desc: "Renders one request to audio and echoes back the resolved seed. Uses the LM check's take when it ran.",
        weight: "heavy",
        noTimeout: true,
        run: async (ctx) => {
          const seed = 12345;
          const base = ctx.shared.aceStepTake ?? {
            caption: ACE_STEP_CAPTION,
            duration: 20,
          };
          ctx.log(
            ctx.shared.aceStepTake
              ? "request: the enriched take from the LM check"
              : "request: a bare caption (the LM check did not run)",
          );
          const probe = aceStepProgressProbe(ctx);
          const result = await ctx.layla.acestep.synth(
            { ...base, seed },
            { onProgress: probe.onProgress, signal: ctx.signal },
          );
          assert(
            typeof result.audio_data_base64 === "string" &&
              result.audio_data_base64.startsWith("data:"),
            "expected audio as a data URI",
          );
          assert(
            result.sample_rate === 48000,
            `expected a 48000Hz render, got ${result.sample_rate}`,
          );
          assert(result.num_samples > 0, "expected a non-empty render");
          assert(
            result.duration_seconds > 0,
            "expected a positive duration_seconds",
          );
          assert(
            result.seed === seed,
            `expected the fixed seed ${seed} back, got ${result.seed}`,
          );
          assert(
            result.request?.caption === base.caption,
            "the rendered request lost its caption",
          );
          ctx.shared.aceStepAudio = result.audio_data_base64;
          const detail = probe.verify();
          return `${result.duration_seconds}s @ ${result.sample_rate}Hz, ${result.num_samples} samples, seed ${result.seed}, ${detail}`;
        },
      },
      {
        id: "acestep.understand",
        name: "acestep.understand (+latents)",
        desc: "Analyses a track back into a request, and returns the latents so a later pass can skip the VAE encode.",
        weight: "heavy",
        noTimeout: true,
        run: async (ctx) => {
          const probe = aceStepProgressProbe(ctx);
          const result = await ctx.layla.acestep.understand(
            { audioBase64: aceStepSourceAudio(ctx) },
            {
              returnLatents: true,
              onProgress: probe.onProgress,
              signal: ctx.signal,
            },
          );
          assert(result.request != null, "expected an analysed request");
          assert(
            typeof result.request.caption === "string" &&
              result.request.caption.length > 0,
            "expected a caption describing the track",
          );
          assert(
            result.duration_seconds > 0,
            "expected a positive duration_seconds",
          );
          assert(
            typeof result.latents_base64 === "string" &&
              result.latents_base64.length > 0,
            "returnLatents was set on an audio source, so latents were expected",
          );
          assert(
            result.latent_frames > 0,
            "expected a positive latent_frames alongside the latents",
          );
          ctx.shared.aceStepLatents = result.latents_base64;
          ctx.log(`caption: ${truncate(result.request.caption, 200)}`);
          ctx.log(`request: ${truncate(JSON.stringify(result.request), 400)}`);
          const detail = probe.verify();
          return `"${truncate(result.request.caption, 48)}", ${result.latent_frames} latent frames, ${result.duration_seconds}s, ${detail}`;
        },
      },
      {
        id: "acestep.understandFromLatents",
        name: "acestep.understand (from latents)",
        desc: "Re-analyses from cached latents, skipping the VAE encode. The latents must not be echoed back.",
        weight: "heavy",
        noTimeout: true,
        run: async (ctx) => {
          const latents =
            ctx.shared.aceStepLatents ??
            skip("run the understand check first to cache latents");
          const probe = aceStepProgressProbe(ctx);
          const result = await ctx.layla.acestep.understand(
            { latentsBase64: latents },
            {
              // Deliberately set: it must be ignored when latents were the
              // source, since the bytes would be the ones just passed in.
              returnLatents: true,
              onProgress: probe.onProgress,
              signal: ctx.signal,
            },
          );
          assert(
            typeof result.request?.caption === "string" &&
              result.request.caption.length > 0,
            "expected a caption describing the track",
          );
          assert(
            result.latents_base64 === null,
            "returnLatents must be ignored when the source was latents",
          );
          assert(
            result.latent_frames === 0,
            `expected latent_frames 0 when no latents are returned, got ${result.latent_frames}`,
          );
          ctx.log(`caption: ${truncate(result.request.caption, 200)}`);
          const detail = probe.verify();
          return `"${truncate(result.request.caption, 48)}", no latents echoed, ${detail}`;
        },
      },
      {
        id: "acestep.vaeRoundTrip",
        name: "acestep.vaeEncode + vaeDecode",
        desc: "Encodes a track to latents and decodes them back, checking each direction reports itself and nulls the other side.",
        weight: "heavy",
        noTimeout: true,
        run: async (ctx) => {
          const encodeProbe = aceStepProgressProbe(ctx);
          const encoded = await ctx.layla.acestep.vaeEncode(
            aceStepSourceAudio(ctx),
            { onProgress: encodeProbe.onProgress, signal: ctx.signal },
          );
          assert(
            encoded.direction === "encode",
            `expected direction 'encode', got '${encoded.direction}'`,
          );
          assert(
            typeof encoded.latents_base64 === "string" &&
              encoded.latents_base64.length > 0,
            "expected latents from the encode direction",
          );
          assert(
            (encoded.latent_frames ?? 0) > 0,
            "expected a positive latent_frames on encode",
          );
          assert(
            encoded.audio_data_base64 === null && encoded.num_samples === null,
            "the decode side of the result must be null on an encode",
          );
          ctx.log(
            `encode: ${encoded.latent_frames} frames, ${encoded.duration_seconds}s`,
          );
          const encodeDetail = encodeProbe.verify();

          const decodeProbe = aceStepProgressProbe(ctx);
          const decoded = await ctx.layla.acestep.vaeDecode(
            encoded.latents_base64,
            {
              request: { output_format: "wav24" },
              onProgress: decodeProbe.onProgress,
              signal: ctx.signal,
            },
          );
          assert(
            decoded.direction === "decode",
            `expected direction 'decode', got '${decoded.direction}'`,
          );
          assert(
            typeof decoded.audio_data_base64 === "string" &&
              decoded.audio_data_base64.startsWith("data:"),
            "expected audio as a data URI from the decode direction",
          );
          assert(
            (decoded.num_samples ?? 0) > 0,
            "expected a positive num_samples on decode",
          );
          assert(
            decoded.latents_base64 === null && decoded.latent_frames === null,
            "the encode side of the result must be null on a decode",
          );
          assert(
            decoded.sample_rate === 48000,
            `expected a 48000Hz decode, got ${decoded.sample_rate}`,
          );
          ctx.log(
            `decode: ${decoded.num_samples} samples, ${decoded.duration_seconds}s`,
          );
          const decodeDetail = decodeProbe.verify();

          return `encode ${encoded.latent_frames} frames (${encodeDetail}) -> decode ${decoded.num_samples} samples (${decodeDetail})`;
        },
      },
      {
        id: "stt.listen",
        name: "stt.startListening + speechRecognized + stopListening",
        desc: "Opens the mic; in the mock a synthetic transcript arrives.",
        weight: "heavy",
        run: async ({ layla, mock }) => {
          const recognised = waitForEvent<unknown>(
            (fire) => {
              const l = (data: unknown) => fire(data);
              layla.stt.on("speechRecognized", l);
              return () => layla.stt.off("speechRecognized", l);
            },
            mock ? 3000 : 6000,
            "speechRecognized",
          );
          await layla.stt.startListening();
          try {
            const data = await recognised;
            return `recognised: ${truncate(JSON.stringify(data))}`;
          } catch (e) {
            if (mock) throw e;
            return "listening started (no speech captured — say something to verify)";
          } finally {
            await layla.stt.stopListening().catch(() => undefined);
          }
        },
      },
      {
        id: "backgroundAudio.player",
        name: "backgroundAudio start/status/pause/resume/skip/stop",
        desc: "Drives the player and waits for a status event.",
        weight: "heavy",
        run: async ({ layla }) => {
          const status = waitForEvent<unknown>(
            (fire) => {
              const l = (data: unknown) => fire(data);
              layla.backgroundAudio.on("status", l);
              return () => layla.backgroundAudio.off("status", l);
            },
            6000,
            "background audio status",
          );
          await layla.backgroundAudio.start(
            ["diagnostics-track-1.mp3", "diagnostics-track-2.mp3"],
            { title: "Diagnostics", artist: "Layla SDK" },
          );
          await status;
          await layla.backgroundAudio.pause();
          await layla.backgroundAudio.resume();
          await layla.backgroundAudio.skip(1);
          await layla.backgroundAudio.stop();
          return "player driven through pause/resume/skip/stop";
        },
      },
    ],
  },
];

/* ---- UI --------------------------------------------------------------- */

const STATUS_LABEL: Record<Status, string> = {
  idle: "—",
  running: "running",
  pass: "pass",
  fail: "fail",
  skip: "skip",
};

export default function App() {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [includeHeavy, setIncludeHeavy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);

  // The dev mock installs asynchronously (dynamic import in main.tsx), so
  // re-check the environment briefly after mount instead of once at render.
  const detectEnv = () => {
    if (mockHandle()) return { label: "Browser mock", tone: "mock" as const };
    if (hasBridge())
      return { label: "Native host bridge", tone: "host" as const };
    return { label: "No bridge detected", tone: "none" as const };
  };
  const [env, setEnv] = useState(detectEnv);
  useEffect(() => {
    if (env.tone !== "none") return;
    let tries = 0;
    const t = setInterval(() => {
      const next = detectEnv();
      tries += 1;
      if (next.tone !== "none" || tries > 20) {
        setEnv(next);
        clearInterval(t);
      }
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allChecks = useMemo(() => groups.flatMap((g) => g.checks), []);

  const counts = useMemo(() => {
    const c = { pass: 0, fail: 0, skip: 0, run: 0 };
    for (const check of allChecks) {
      const s = results[check.id]?.status;
      if (s === "pass") c.pass += 1;
      else if (s === "fail") c.fail += 1;
      else if (s === "skip") c.skip += 1;
      if (s && s !== "idle") c.run += 1;
    }
    return c;
  }, [results, allChecks]);

  async function runWithCtx(
    check: Check,
    ctx: SharedCheckCtx,
  ): Promise<Result> {
    setResults((r) => ({ ...r, [check.id]: { status: "running" } }));
    const t0 = performance.now();
    const logLines: string[] = [];
    const checkCtx: CheckCtx = {
      ...ctx,
      log: (text) => logLines.push(text),
    };
    try {
      const work = check.noTimeout
        ? check.run(checkCtx)
        : withTimeout(check.run(checkCtx), 45_000, check.name);
      // Race against the stop signal so a stopped check releases the runner
      // immediately, even if its underlying SDK call keeps settling in the
      // background.
      const detail = await abortable(work, ctx.signal);
      const res: Result = {
        status: "pass",
        ms: performance.now() - t0,
        detail,
        log: logLines.length > 0 ? logLines.join("\n\n") : detail,
      };
      setResults((r) => ({ ...r, [check.id]: res }));
      return res;
    } catch (e) {
      if (e instanceof StopError) {
        // Not a failure — the user stopped the run. Leave the check un-run so
        // it reads as idle and can be run again.
        const res: Result = {
          status: "idle",
          log: [...logLines, "Stopped by user."].join("\n\n"),
        };
        setResults((r) => ({ ...r, [check.id]: res }));
        return res;
      }
      const isSkip = e instanceof SkipError;
      const detail = e instanceof Error ? e.message : String(e);
      const diagnostic = e instanceof Error ? (e.stack ?? e.message) : String(e);
      const res: Result = {
        status: isSkip ? "skip" : "fail",
        ms: performance.now() - t0,
        detail,
        log: [
          ...logLines,
          `${isSkip ? "Skipped" : "Error"}:\n${diagnostic}`,
        ].join("\n\n"),
      };
      setResults((r) => ({ ...r, [check.id]: res }));
      return res;
    }
  }

  async function runMany(checks: Check[]) {
    if (checks.length === 0 || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress({ done: 0, total: checks.length });
    // Shared context so e.g. a character list fetched once is reused, but each
    // check still runs sequentially for a stable, readable report.
    const ctx: SharedCheckCtx = {
      layla,
      mock: mockHandle(),
      sessionId,
      shared: {},
      signal: controller.signal,
    };
    try {
      for (let i = 0; i < checks.length; i += 1) {
        if (controller.signal.aborted) break;
        await runWithCtx(checks[i], ctx);
        setProgress({ done: i + 1, total: checks.length });
      }
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  const runOne = (check: Check) => runMany([check]);

  const stop = () => abortRef.current?.abort();

  const runAll = () =>
    runMany(allChecks.filter((c) => includeHeavy || c.weight !== "heavy"));

  const runFailures = () =>
    runMany(
      allChecks.filter((c) => {
        const s = results[c.id]?.status;
        return s === "fail" && (includeHeavy || c.weight !== "heavy");
      }),
    );

  return (
    <div className="diag">
      <header className="diag-header">
        <h1>Layla SDK Diagnostics</h1>
        <p className="diag-sub">
          Exercises every SDK endpoint and the per-lane concurrency behaviour.
          Runs against the browser mock in dev, or the real host when copied in.
        </p>
        <div className="diag-toolbar">
          <span className={`env env-${env.tone}`}>{env.label}</span>
          <button disabled={busy} onClick={runAll}>
            Run all
          </button>
          <button
            disabled={busy || counts.fail === 0}
            onClick={runFailures}
          >
            Rerun failures
          </button>
          {busy && (
            <button className="stop-btn" onClick={stop}>
              Stop
            </button>
          )}
          <label className="heavy-toggle">
            <input
              type="checkbox"
              checked={includeHeavy}
              onChange={(e) => setIncludeHeavy(e.target.checked)}
            />
            include heavy (chat / audio / image gen / mic)
          </label>
          <span className="tally">
            <b className="ok">{counts.pass}</b> pass ·{" "}
            <b className="bad">{counts.fail}</b> fail ·{" "}
            <b className="warn">{counts.skip}</b> skip · {counts.run}/
            {allChecks.length} run
          </span>
        </div>
        {busy && progress && (
          <div className="diag-progress" role="status" aria-live="polite">
            <div className="diag-progress-track">
              <div
                className="diag-progress-fill"
                style={{
                  width: `${
                    progress.total ? (progress.done / progress.total) * 100 : 0
                  }%`,
                }}
              />
            </div>
            <span className="diag-progress-label">
              Running… {progress.done}/{progress.total}
            </span>
          </div>
        )}
      </header>

      {groups.map((group) => (
        <section key={group.id} className="group">
          <div className="group-head">
            <h2>{group.title}</h2>
            <p className="group-blurb">{group.blurb}</p>
            <button
              className="group-run"
              disabled={busy}
              onClick={() =>
                runMany(
                  group.checks.filter(
                    (c) => includeHeavy || c.weight !== "heavy",
                  ),
                )
              }
            >
              Run group
            </button>
          </div>
          <ul className="checks">
            {group.checks.map((check) => {
              const res = results[check.id] ?? { status: "idle" as Status };
              return (
                <li key={check.id} className={`check status-${res.status}`}>
                  <span className={`dot dot-${res.status}`} />
                  <div className="check-body">
                    <div className="check-title">
                      <code>{check.name}</code>
                      {check.weight === "heavy" && (
                        <span className="badge">heavy</span>
                      )}
                      <span className={`state state-${res.status}`}>
                        {STATUS_LABEL[res.status]}
                        {res.ms != null && res.status !== "running"
                          ? ` · ${res.ms | 0}ms`
                          : ""}
                      </span>
                    </div>
                    <div className="check-desc">{check.desc}</div>
                    {res.detail && (
                      <div className="check-detail">{res.detail}</div>
                    )}
                    <details className="check-log">
                      <summary>Log</summary>
                      <pre>{res.log || "No log output yet."}</pre>
                    </details>
                  </div>
                  <button
                    className="check-run"
                    disabled={busy || res.status === "running"}
                    onClick={() => void runOne(check)}
                  >
                    Run
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <footer className="diag-footer">
        Uses the sibling SDK at <code>../../../src/index</code>. Build with{" "}
        <code>npm run build</code> for a single-file <code>dist/index.html</code>{" "}
        to copy to the host.
      </footer>
    </div>
  );
}
