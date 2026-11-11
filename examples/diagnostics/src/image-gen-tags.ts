import type { LaylaSDK, LaylaImageGenTag, LaylaImageGenTagPage } from "../../../src/index";

interface TagCheckCtx {
  layla: LaylaSDK;
  sessionId: string;
  signal: AbortSignal;
  log: (text: string) => void;
}

interface TagCheck {
  id: string;
  name: string;
  desc: string;
  weight: "safe";
  run: (ctx: TagCheckCtx) => Promise<string>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertTag(tag: LaylaImageGenTag) {
  assert(typeof tag?.english === "string" && tag.english.length > 0, "missing canonical tag name");
  assert(Number.isSafeInteger(tag.category) && tag.category >= 0, "invalid tag category");
  assert(Number.isSafeInteger(tag.post_count) && tag.post_count >= 0, "invalid tag post_count");
  assert(Array.isArray(tag.aliases) && tag.aliases.every((alias) => typeof alias === "string"), "invalid tag aliases");
}

function assertSameTag(actual: LaylaImageGenTag | null, expected: LaylaImageGenTag) {
  assert(actual !== null, `tag ${expected.english} was not found`);
  assertTag(actual);
  assert(actual.english === expected.english && actual.category === expected.category &&
    actual.post_count === expected.post_count && JSON.stringify(actual.aliases) === JSON.stringify(expected.aliases),
  `tag fields did not round-trip: ${JSON.stringify(actual)}`);
}

function assertPage(page: LaylaImageGenTagPage, filename: string, offset: number, limit: number) {
  assert(page.dictionary_filename === filename, "response came from a different dictionary");
  assert(page.offset === offset && page.limit === limit, "pagination was not echoed correctly");
  assert(Number.isSafeInteger(page.total) && page.total >= 0, "invalid total match count");
  assert(Array.isArray(page.tags) && page.tags.length <= limit && page.tags.length <= page.total, "invalid page size");
  page.tags.forEach(assertTag);
}

export function createImageGenTagGroup(skip: (reason: string) => never) {
  const firstDictionary = async (ctx: TagCheckCtx) => {
    const dictionaries = await ctx.layla.images.getTagDictionaries({ signal: ctx.signal });
    const filename = dictionaries[0]?.dictionary_filename;
    if (!filename) return skip("no tag dictionaries available — create or import one in the tag manager and rerun");
    ctx.log(`dictionary: ${filename}`);
    return filename;
  };

  /** Each write check owns unique names and cleans up even if a request is aborted. */
  const withTemporaryTag = async (
    ctx: TagCheckCtx,
    probe: (filename: string, tag: LaylaImageGenTag, renamed: string) => Promise<string>,
  ) => {
    const filename = await firstDictionary(ctx);
    const nonce = `${ctx.sessionId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const tag: LaylaImageGenTag = {
      english: `[diagnostics]_${nonce}`,
      category: 0,
      post_count: 0,
      aliases: [`diagnostics_alias_${nonce}`],
    };
    const renamed = `${tag.english}_renamed`;
    for (const name of [tag.english, renamed]) {
      assert(await ctx.layla.images.getTag(filename, name, { signal: ctx.signal }) === null,
        `temporary name already exists: ${name}`);
    }
    try {
      const saved = await ctx.layla.images.upsertTag(filename, tag, null, { signal: ctx.signal });
      assertSameTag(saved, tag);
      ctx.log(`created temporary tag: ${saved.english}`);
      return await probe(filename, tag, renamed);
    } finally {
      const failures: string[] = [];
      for (const name of [tag.english, renamed]) {
        try {
          // Cleanup must finish even after Stop aborts the check's signal.
          const removed = await ctx.layla.images.deleteTag(filename, name);
          ctx.log(`cleanup ${name}: ${removed ? "deleted" : "already absent"}`);
        } catch (error) {
          const message = `${name}: ${error instanceof Error ? error.message : String(error)}`;
          failures.push(message);
          ctx.log(`cleanup failed: ${message}`);
        }
      }
      assert(failures.length === 0, `temporary tag cleanup failed: ${failures.join("; ")}`);
    }
  };

  const checks: TagCheck[] = [
    {
      id: "images.getTagDictionaries",
      name: "images.getTagDictionaries",
      desc: "Lists reusable relative dictionary filenames; an empty library is valid.",
      weight: "safe",
      run: async (ctx) => {
        const dictionaries = await ctx.layla.images.getTagDictionaries({ signal: ctx.signal });
        assert(Array.isArray(dictionaries), "expected a dictionary array");
        const filenames = dictionaries.map(({ dictionary_filename }) => dictionary_filename);
        assert(filenames.every((filename) => typeof filename === "string" && filename.length > 0), "invalid dictionary filename");
        assert(new Set(filenames).size === filenames.length, "duplicate dictionary filenames");
        ctx.log(JSON.stringify(dictionaries, null, 2));
        return `${dictionaries.length} available tag dictionary(s)`;
      },
    },
    {
      id: "images.getTags",
      name: "images.getTags (pagination)",
      desc: "Browses two pages and a count-only page, including empty dictionaries.",
      weight: "safe",
      run: async (ctx) => {
        const filename = await firstDictionary(ctx);
        const first = await ctx.layla.images.getTags(filename, { offset: 0, limit: 2, signal: ctx.signal });
        const second = await ctx.layla.images.getTags(filename, { offset: 2, limit: 2, signal: ctx.signal });
        const count = await ctx.layla.images.getTags(filename, { limit: 0, signal: ctx.signal });
        assertPage(first, filename, 0, 2);
        assertPage(second, filename, 2, 2);
        assertPage(count, filename, 0, 0);
        assert(first.total === second.total && first.total === count.total, "total changed between pages");
        assert(first.tags.length === Math.min(first.total, 2), "first page has the wrong size");
        assert(second.tags.length === Math.min(Math.max(first.total - 2, 0), 2), "second page has the wrong size");
        assert(!second.tags.some((tag) => first.tags.some((entry) => entry.english === tag.english)), "pages overlap");
        ctx.log(JSON.stringify({ first, second, count }, null, 2));
        return `${first.total} tags; pagination and limit: 0 verified`;
      },
    },
    {
      id: "images.getTag",
      name: "images.getTag (exact name / missing)",
      desc: "Reads a listed tag by its exact name and verifies a missing name returns null.",
      weight: "safe",
      run: async (ctx) => {
        const filename = await firstDictionary(ctx);
        const page = await ctx.layla.images.getTags(filename, { limit: 1, signal: ctx.signal });
        assertPage(page, filename, 0, 1);
        if (page.tags[0]) {
          const tag = await ctx.layla.images.getTag(filename, page.tags[0].english, { signal: ctx.signal });
          assertSameTag(tag, page.tags[0]);
          ctx.log(JSON.stringify(tag, null, 2));
        }
        const missing = `[diagnostics]_missing_${ctx.sessionId}_${Math.random().toString(36).slice(2)}`;
        assert(await ctx.layla.images.getTag(filename, missing, { signal: ctx.signal }) === null, "missing tag did not return null");
        return page.tags.length ? "exact lookup and absent-tag null verified" : "empty dictionary; absent-tag null verified";
      },
    },
    {
      id: "images.upsertTag",
      name: "images.upsertTag (create / update / rename; write)",
      desc: "Round-trips a unique temporary tag, updates its fields, renames it, then cleans up.",
      weight: "safe",
      run: (ctx) => withTemporaryTag(ctx, async (filename, tag, renamed) => {
        const options = { signal: ctx.signal };
        assertSameTag(await ctx.layla.images.getTag(filename, tag.english, options), tag);
        const updated = { ...tag, post_count: 7, aliases: [...tag.aliases, `${tag.english}_alias`] };
        assertSameTag(await ctx.layla.images.upsertTag(filename, updated, tag.english, options), updated);
        const moved = { ...updated, english: renamed };
        assertSameTag(await ctx.layla.images.upsertTag(filename, moved, updated.english, options), moved);
        assert(await ctx.layla.images.getTag(filename, tag.english, options) === null, "old name still exists after rename");
        assertSameTag(await ctx.layla.images.getTag(filename, renamed, options), moved);
        ctx.log(JSON.stringify({ created: tag, updated, renamed: moved }, null, 2));
        return "created, updated and renamed a temporary tag; cleanup completed";
      }),
    },
    {
      id: "images.deleteTag",
      name: "images.deleteTag (delete / already absent; write)",
      desc: "Deletes its own temporary tag, verifies null lookup, and repeats deletion for false.",
      weight: "safe",
      run: (ctx) => withTemporaryTag(ctx, async (filename, tag) => {
        const options = { signal: ctx.signal };
        assert(await ctx.layla.images.deleteTag(filename, tag.english, options) === true, "existing tag deletion did not return true");
        assert(await ctx.layla.images.getTag(filename, tag.english, options) === null, "deleted tag still exists");
        assert(await ctx.layla.images.deleteTag(filename, tag.english, options) === false, "repeated deletion did not return false");
        return "deletion returned true; missing lookup returned null; repeated deletion returned false";
      }),
    },
    {
      id: "images.searchTags",
      name: "images.searchTags (name / prefix / alias; temporary write)",
      desc: "Searches a temporary tag by name and alias, checks category filtering and pagination, then cleans up.",
      weight: "safe",
      run: (ctx) => withTemporaryTag(ctx, async (filename, tag) => {
        const options = { signal: ctx.signal, limit: 10 };
        const name = await ctx.layla.images.searchTags(filename, tag.english.toUpperCase(), options);
        assertPage(name, filename, 0, 10);
        assert(name.mode === "name" && name.query === tag.english.toUpperCase(), "search did not echo query/default mode");
        assertSameTag(name.tags[0] ?? null, tag);
        const prefix = await ctx.layla.images.searchTags(filename, tag.aliases[0].replace(/_/g, " ").toUpperCase(), {
          ...options, mode: "prefix", category: tag.category,
        });
        assertPage(prefix, filename, 0, 10);
        assert(prefix.mode === "prefix" && prefix.total === 1, "normalized alias prefix did not match exactly once");
        assertSameTag(prefix.tags[0] ?? null, tag);
        const suffix = tag.english.slice("[diagnostics]_".length);
        const substring = await ctx.layla.images.searchTags(filename, suffix, options);
        assertSameTag(substring.tags[0] ?? null, tag);
        const notPrefix = await ctx.layla.images.searchTags(filename, suffix, { ...options, mode: "prefix" });
        assert(notPrefix.total === 0 && notPrefix.tags.length === 0, "prefix search incorrectly matched a name/alias suffix");
        const count = await ctx.layla.images.searchTags(filename, tag.english, { ...options, limit: 0 });
        assertPage(count, filename, 0, 0);
        assert(count.total === 1, "count-only search lost its total");
        const filtered = await ctx.layla.images.searchTags(filename, tag.english, { ...options, category: tag.category + 1 });
        assert(filtered.total === 0 && filtered.tags.length === 0, "category filter included the temporary tag");
        ctx.log(JSON.stringify({ name, prefix, substring, notPrefix, count, filtered }, null, 2));
        return "name/substring, normalized alias prefix, category filter and count-only search verified; cleanup completed";
      }),
    },
    {
      id: "images.suggestTags",
      name: "images.suggestTags (picker engine; temporary write)",
      desc: "Checks ranked fuzzy and alias suggestions, bounded/blank results and repeated-call timing, then cleans up.",
      weight: "safe",
      run: (ctx) => withTemporaryTag(ctx, async (filename, tag) => {
        const options = { signal: ctx.signal, limit: 40 };
        const started = performance.now();
        const first = await ctx.layla.images.suggestTags(filename, tag.english, options);
        const firstMs = performance.now() - started;
        const warmed = performance.now();
        const repeated = await ctx.layla.images.suggestTags(filename, tag.english, options);
        const repeatedMs = performance.now() - warmed;
        assert(first.some((entry) => entry.replacement_tag === tag.english), "created tag missing from suggestions");
        assert(JSON.stringify(first) === JSON.stringify(repeated), "repeated suggestions changed without an edit");
        assert(first.length <= options.limit, "suggestion limit was ignored");
        for (const [index, entry] of first.entries()) {
          assert(typeof entry.primary_text === "string" && entry.primary_text.length > 0, "missing suggestion display text");
          assert(Number.isFinite(entry.score) && Number.isSafeInteger(entry.category) && Number.isSafeInteger(entry.post_count), "invalid suggestion metadata");
          assert(["fuzzy", "alias", "translation", "correction", "embedding"].includes(entry.match_type), "invalid match type");
          if (index > 0) assert(first[index - 1].score >= entry.score, "suggestions are not relevance-ranked");
        }
        const fuzzy = await ctx.layla.images.suggestTags(filename, tag.english.replace("[diagnostics]", "[diag]"), { ...options, limit: 1 });
        assert(fuzzy.length === 1 && fuzzy[0].replacement_tag === tag.english, "subsequence query did not find the temporary tag");
        const alias = await ctx.layla.images.suggestTags(filename, tag.aliases[0], options);
        assert(alias.some((entry) => entry.replacement_tag === tag.english && entry.match_type === "alias"), "alias suggestion missing");
        assert((await ctx.layla.images.suggestTags(filename, tag.english, { ...options, limit: 0 })).length === 0, "zero limit returned suggestions");
        assert((await ctx.layla.images.suggestTags(filename, "  ", options)).length === 0, "blank query returned suggestions");
        ctx.log(`first suggestion after edit: ${firstMs.toFixed(1)}ms; repeated: ${repeatedMs.toFixed(1)}ms`);
        ctx.log(JSON.stringify({ first, fuzzy, alias }, null, 2));
        return `picker suggestions verified; first ${firstMs.toFixed(0)}ms / repeated ${repeatedMs.toFixed(0)}ms; cleanup completed`;
      }),
    },
  ];

  return {
    id: "image-tags",
    title: "Image tag dictionaries",
    blurb: "Lightweight text tag APIs. Write checks use unique temporary tags and clean them up. Included in Run all.",
    checks,
  };
}
