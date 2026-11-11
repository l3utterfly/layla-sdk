import type { LaylaApiEvent, LaylaApiRequest } from '../interface';
import type { LaylaImageGenTag, LaylaImageGenTagSuggestion } from '../protocol';

export type MockImageGenTagRequest = Extract<LaylaApiRequest, { cmd:
  | 'image_gen_tag_get_dictionaries'
  | 'image_gen_tag_get_tags'
  | 'image_gen_tag_get_tag'
  | 'image_gen_tag_upsert_tag'
  | 'image_gen_tag_delete_tag'
  | 'image_gen_tag_search_tags'
  | 'image_gen_tag_suggest_tags'
}>;

const normalize = (value: string) => value.trim().toLowerCase().replace(/[ -]/g, '_').replace(/_+/g, '_');
const copy = (tag: LaylaImageGenTag): LaylaImageGenTag => ({ ...tag, aliases: [...tag.aliases] });
const count = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Tag ${name} must be a nonnegative integer.`);
};
const name = (value: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Tag english must be a non-empty string.');
};

/** Browser approximation: native hosts use ImgGenTagService's indexed scorer. */
function mockSuggestions(tags: LaylaImageGenTag[], query: string, limit: number): LaylaImageGenTagSuggestion[] {
  const pattern = normalize(query);
  if (!pattern || limit === 0) return [];
  const score = (value: string) => {
    const target = normalize(value);
    let cursor = 0;
    let gaps = 0;
    for (const char of pattern) {
      const found = target.indexOf(char, cursor);
      if (found < 0) return -Infinity;
      gaps += found - cursor;
      cursor = found + 1;
    }
    return pattern.length * 16 - gaps;
  };
  const suggestions: LaylaImageGenTagSuggestion[] = [];
  for (const tag of tags) {
    let best = score(tag.english);
    let alias: string | undefined;
    for (const candidate of tag.aliases) {
      const candidateScore = score(candidate);
      if (candidateScore > best) { best = candidateScore; alias = candidate; }
    }
    if (!Number.isFinite(best)) continue;
    const popularity = tag.post_count >= 1_000_000 ? 30 : tag.post_count >= 100_000 ? 22
      : tag.post_count >= 10_000 ? 15 : tag.post_count >= 1_000 ? 9 : tag.post_count >= 100 ? 4 : 0;
    suggestions.push({ replacement_tag: tag.english, primary_text: tag.english,
      ...(alias === undefined ? {} : { secondary_text: alias.replace(/_/g, ' ') }),
      match_type: alias === undefined ? 'fuzzy' : 'alias', category: tag.category,
      post_count: tag.post_count, score: best + popularity });
  }
  return suggestions.sort((a, b) => b.score - a.score || b.post_count - a.post_count).slice(0, limit);
}

/** Per-installation text dictionaries; intentionally independent of browser file storage. */
export function createMockImageGenTagHandler(initial: Record<string, LaylaImageGenTag[]> = {
  'mock/tags.csv': [
    { english: 'blue_hair', category: 0, post_count: 100, aliases: ['azure_hair'] },
    { english: 'blue_eyes', category: 0, post_count: 80, aliases: [] },
  ],
}): (request: MockImageGenTagRequest) => LaylaApiEvent {
  const dictionaries = new Map(Object.entries(initial).map(([filename, tags]) => [filename, tags.map(copy)]));
  // Seeded entries represent the managed library. Auto-created raw CSVs remain
  // accessible by filename, without registering tag-manager metadata.
  const listedFilenames = [...dictionaries.keys()];
  return (request) => {
    if (request.cmd === 'image_gen_tag_get_dictionaries') {
      return { event: 'on_image_gen_tag_get_dictionaries_response',
        data: listedFilenames.map((dictionary_filename) => ({ dictionary_filename })) };
    }
    const filename = request.data.dictionary_filename;
    if (typeof filename !== 'string' || !filename || filename.includes('\0') || filename.includes('\\') ||
      /^[a-z][a-z0-9+.-]*:/i.test(filename) || filename.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Expected a path relative to the tags folder.');
    }
    let tags = dictionaries.get(filename);
    if (!tags) {
      if (request.cmd !== 'image_gen_tag_upsert_tag' || request.data.replacing !== null) {
        throw new Error(`Tag dictionary not found: ${filename}`);
      }
      tags = [];
    }
    const dictionary_filename = filename;
    switch (request.cmd) {
      case 'image_gen_tag_suggest_tags': {
        const { query } = request.data;
        if (typeof query !== 'string') throw new Error('Tag query must be a string.');
        const limit = request.data.limit === undefined ? 40 : request.data.limit;
        count(limit, 'limit');
        return { event: 'on_image_gen_tag_suggest_tags_response',
          data: { dictionary_filename, query, limit, suggestions: mockSuggestions(tags, query, limit) } };
      }
      case 'image_gen_tag_get_tag': {
        const { english } = request.data;
        name(english);
        const tag = tags.find((entry) => entry.english === english);
        return { event: 'on_image_gen_tag_get_tag_response',
          data: { dictionary_filename, english, tag: tag ? copy(tag) : null } };
      }
      case 'image_gen_tag_upsert_tag': {
        const { tag, replacing } = request.data;
        name(tag.english);
        count(tag.category, 'category');
        count(tag.post_count, 'post count');
        if (!Array.isArray(tag.aliases) || tag.aliases.some((alias) => typeof alias !== 'string')) {
          throw new Error('Tag aliases must be an array of strings.');
        }
        if (replacing !== null) name(replacing);
        const index = replacing === null ? -1 : tags.findIndex((entry) => entry.english === replacing);
        if (replacing !== null && index < 0) throw new Error(`Tag not found: ${replacing}`);
        const english = tag.english.trim();
        if (tags.some((entry, i) => i !== index && entry.english === english)) {
          throw new Error(`Tag already exists: ${english}`);
        }
        const stored = { ...tag, english,
          aliases: [...new Set(tag.aliases.map((alias) => alias.trim()).filter((alias) => alias && alias !== english))] };
        if (index < 0) tags.unshift(stored);
        else tags[index] = stored;
        dictionaries.set(filename, tags);
        return { event: 'on_image_gen_tag_upsert_tag_response', data: { dictionary_filename, tag: copy(stored) } };
      }
      case 'image_gen_tag_delete_tag': {
        const { english } = request.data;
        name(english);
        const index = tags.findIndex((entry) => entry.english === english);
        if (index >= 0) tags.splice(index, 1);
        return { event: 'on_image_gen_tag_delete_tag_response', data: { dictionary_filename, english, deleted: index >= 0 } };
      }
      case 'image_gen_tag_get_tags':
      case 'image_gen_tag_search_tags': {
        const { offset, limit, category } = request.data;
        count(offset, 'offset');
        count(limit, 'limit');
        if (category != null) count(category, 'category');
        let matches = tags.filter((tag) => category == null || tag.category === category);
        let mode: 'prefix' | 'name' = 'name';
        if (request.cmd === 'image_gen_tag_search_tags') {
          const { query } = request.data;
          if (typeof query !== 'string' || !query.trim()) throw new Error('Tag query must be a non-empty string.');
          mode = request.data.mode ?? 'name';
          if (mode !== 'prefix' && mode !== 'name') throw new Error('Tag search mode must be prefix or name.');
          const pattern = normalize(query);
          matches = matches.filter((tag) => [tag.english, ...tag.aliases].some((value) =>
            mode === 'prefix' ? normalize(value).startsWith(pattern) : normalize(value).includes(pattern)));
          matches = [
            ...matches.filter((tag) => normalize(tag.english) === pattern),
            ...matches.filter((tag) => normalize(tag.english) !== pattern),
          ];
        }
        const page = { dictionary_filename, tags: matches.slice(offset, offset + limit).map(copy), total: matches.length, offset, limit };
        return request.cmd === 'image_gen_tag_search_tags'
          ? { event: 'on_image_gen_tag_search_tags_response', data: { ...page, query: request.data.query, mode } }
          : { event: 'on_image_gen_tag_get_tags_response', data: page };
      }
    }
  };
}
