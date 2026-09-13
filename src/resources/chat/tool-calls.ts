/**
 * resources/chat/tool-calls.ts
 * ----------------------------
 * Reading Layla's `<tool_call>` markup back into OpenAI tool calls.
 *
 * The host has exactly one string to stream a reply through, so a completion's
 * `tool_calls` are collapsed into the message text as one block per call:
 *
 *   <tool_call>{"name":NAME,"arguments":ARGS,"tool_call_id":ID}</tool_call>
 *
 * with several calls separated by a newline. Putting them back is this file's
 * job: consumers write against the OpenAI shape and must never have to know
 * the markup exists.
 *
 * Two details of how the host renders a call matter here. It streams the block
 * as the call takes shape, so the JSON is only complete once `</tool_call>`
 * arrives — the `tool_call_id` is written last, and a generation cut off
 * mid-arguments closes no block at all. And `arguments` is written as the raw
 * JSON the model produced (usually an object), where OpenAI carries it as a
 * JSON *string*.
 */

/** One call read out of the markup, in the pieces OpenAI splits it into. */
export interface LaylaToolCall {
  /** The host's `tool_call_id`, or `''` when the provider issued none. */
  id: string;
  name: string;
  /** Raw JSON, as OpenAI's `function.arguments` carries it. */
  arguments: string;
}

const NAME_FIELD = /"name"\s*:\s*("(?:[^"\\]|\\.)*")/;
const ID_FIELD = /"(?:tool_call_id|id)"\s*:\s*("(?:[^"\\]|\\.)*")/;
// `parameters` is what some local models call the argument object; the host
// only ever writes `arguments`, but a model's own markup can reach us verbatim.
const ARGUMENTS_FIELD = /"(?:arguments|parameters)"\s*:\s*/;
const TRAILING_ID_FIELD = /,\s*"(?:tool_call_id|id)"\s*:/;

/**
 * Read one `<tool_call>` block's inner text. Returns `null` when the block
 * names no tool — a call cut off before its name finished is nothing the
 * caller could act on.
 */
export function parseToolCallBlock(block: string): LaylaToolCall | null {
  const text = block.trim();
  if (!text) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.name === 'string' && record.name.length > 0) {
        return {
          id: readId(record),
          name: record.name,
          arguments: normaliseArguments(
            record.arguments !== undefined ? record.arguments : record.parameters,
          ),
        };
      }
    }
  } catch {
    // Not valid JSON — the usual reason being a block the host never closed.
    // Fall through and salvage what the text does carry.
  }

  return parsePartialToolCallBlock(text);
}

function readId(record: Record<string, unknown>): string {
  if (typeof record.tool_call_id === 'string') return record.tool_call_id;
  if (typeof record.id === 'string') return record.id;
  return '';
}

function normaliseArguments(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '{}';
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

/**
 * Salvage a call from a block that is not valid JSON, which is what a
 * generation stopped part-way through one looks like. The fields are read
 * where they sit rather than parsed, and the arguments text is handed on
 * exactly as the model wrote it — OpenAI's contract already says
 * `function.arguments` may not be valid JSON and must be validated before use.
 */
function parsePartialToolCallBlock(text: string): LaylaToolCall | null {
  const nameMatch = NAME_FIELD.exec(text);
  if (!nameMatch) return null;

  const name = readJsonString(nameMatch[1]);
  if (!name) return null;

  const idMatch = ID_FIELD.exec(text);
  const id = idMatch ? readJsonString(idMatch[1]) ?? '' : '';

  let args = '{}';
  const argumentsMatch = ARGUMENTS_FIELD.exec(text);
  if (argumentsMatch) {
    const raw = text.slice(argumentsMatch.index + argumentsMatch[0].length);
    const trailingId = raw.search(TRAILING_ID_FIELD);
    const value = (trailingId === -1 ? raw : raw.slice(0, trailingId)).trim();
    if (value.length > 0) args = value;
  }

  return { id, name, arguments: args };
}

function readJsonString(quoted: string): string | null {
  try {
    const value: unknown = JSON.parse(quoted);
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
