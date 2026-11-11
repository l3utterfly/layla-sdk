import {
  LaylaSDK,
  type Images,
  type LaylaImageGenTag,
  type LaylaImageGenTagDictionaryData,
  type LaylaImageGenTagPage,
  type LaylaImageGenTagSuggestion,
  type ImageGenTagSuggestOptions,
  type LaylaApiImageGenTagSuggestTags,
  type LaylaApiEvent_onImageGenTagSuggestTagsResponse,
  type ImageGenTagListOptions,
  type ImageGenTagSearchOptions,
  type ImageGenTagSearchResult,
  type LaylaApiImageGenTagGetDictionaries,
  type LaylaApiImageGenTagGetTags,
  type LaylaApiImageGenTagGetTag,
  type LaylaApiImageGenTagUpsertTag,
  type LaylaApiImageGenTagDeleteTag,
  type LaylaApiImageGenTagSearchTags,
  type LaylaApiEvent_onImageGenTagGetDictionariesResponse,
  type LaylaApiEvent_onImageGenTagGetTagsResponse,
  type LaylaApiEvent_onImageGenTagGetTagResponse,
  type LaylaApiEvent_onImageGenTagUpsertTagResponse,
  type LaylaApiEvent_onImageGenTagDeleteTagResponse,
  type LaylaApiEvent_onImageGenTagSearchTagsResponse,
  type LaylaApiRequest,
  type LaylaApiEvent,
  installLaylaMock,
} from '../src';

const images: Images = new LaylaSDK().images;
const filename = 'demo/tags.csv';
const tag: LaylaImageGenTag = { english: 'blue_hair', category: 0, post_count: 100, aliases: [] };
const listOptions: ImageGenTagListOptions = { offset: 0, limit: 10, category: null, signal: new AbortController().signal };
const searchOptions: ImageGenTagSearchOptions = { ...listOptions, mode: 'prefix' };
const dictionaries: Promise<LaylaImageGenTagDictionaryData[]> = images.getTagDictionaries(listOptions);
const page: Promise<LaylaImageGenTagPage> = images.getTags(filename, listOptions);
const lookup: Promise<LaylaImageGenTag | null> = images.getTag(filename, tag.english, listOptions);
const saved: Promise<LaylaImageGenTag> = images.upsertTag(filename, tag, null, listOptions);
const deleted: Promise<boolean> = images.deleteTag(filename, tag.english, listOptions);
const matches: Promise<ImageGenTagSearchResult> = images.searchTags(filename, 'blue', searchOptions);
const suggestOptions: ImageGenTagSuggestOptions = { limit: 40, signal: listOptions.signal };
const suggestions: Promise<LaylaImageGenTagSuggestion[]> = images.suggestTags(filename, 'blu hr', suggestOptions);
const suggestRequest: LaylaApiRequest = { cmd: 'image_gen_tag_suggest_tags', data: { dictionary_filename: filename, query: 'blue' } } satisfies LaylaApiImageGenTagSuggestTags;
const suggestEvent: LaylaApiEvent = {} as LaylaApiEvent_onImageGenTagSuggestTagsResponse;
void [suggestions, suggestRequest, suggestEvent];
void [dictionaries, page, lookup, saved, deleted, matches];
void installLaylaMock({ imageTagDictionaries: { [filename]: [tag] } });

// Ensure request/response types are publicly importable and included in the unions.
type TagRequest = LaylaApiImageGenTagGetDictionaries | LaylaApiImageGenTagGetTags | LaylaApiImageGenTagGetTag
  | LaylaApiImageGenTagUpsertTag | LaylaApiImageGenTagDeleteTag | LaylaApiImageGenTagSearchTags;
type TagEvent = LaylaApiEvent_onImageGenTagGetDictionariesResponse | LaylaApiEvent_onImageGenTagGetTagsResponse
  | LaylaApiEvent_onImageGenTagGetTagResponse | LaylaApiEvent_onImageGenTagUpsertTagResponse
  | LaylaApiEvent_onImageGenTagDeleteTagResponse | LaylaApiEvent_onImageGenTagSearchTagsResponse;
const request: LaylaApiRequest = {} as TagRequest;
const response: LaylaApiEvent = {} as TagEvent;
void [request, response];

// @ts-expect-error Every dictionary operation requires its filename.
void images.getTags();
// @ts-expect-error Search modes have exactly two supported values.
void images.searchTags(filename, 'blue', { mode: 'fuzzy' });
// @ts-expect-error Tag aliases must be text.
void images.upsertTag(filename, { ...tag, aliases: [123] });
// @ts-expect-error Canonical count field uses the wire-compatible snake_case name.
void images.upsertTag(filename, { english: 'x', category: 0, postCount: 0, aliases: [] });
// @ts-expect-error A category filter is a number or null.
void images.getTags(filename, { category: '0' });
// @ts-expect-error Suggestions require a dictionary filename and a query.
void images.suggestTags(filename);
// @ts-expect-error Ranked suggestions have a bounded limit, rather than pagination.
void images.suggestTags(filename, 'blue', { offset: 1 });
// @ts-expect-error Ranked suggestions use the picker engine, with no prefix/name mode.
void images.suggestTags(filename, 'blue', { mode: 'prefix' });
