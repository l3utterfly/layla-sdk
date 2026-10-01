import {
  LaylaSDK,
  type LaylaApiSaveChatMessage,
  type LaylaApiEvent_onSaveChatMessageResponse,
  type LaylaChatHistoryEntry,
  type SaveChatMessageParams,
  type SaveChatMessageResult,
} from '../src';

const layla = new LaylaSDK();
const params: SaveChatMessageParams = {
  id: 0,
  session_id: 'session',
  character_id: 'user',
  display_message: 'Visible text',
  message: 'Model text',
  timestamp: 0,
};
const result: Promise<SaveChatMessageResult> = layla.chat.saveChatMessage(params, {
  signal: new AbortController().signal,
});
const command: LaylaApiSaveChatMessage = { cmd: 'save_chat_message', data: params };
const event: LaylaApiEvent_onSaveChatMessageResponse = {
  event: 'on_save_chat_message_response',
  data: { ...params, id: 1, timestamp: 123, content: params.message, role: 'user' },
};
const historyEntry: LaylaChatHistoryEntry = event.data;

const { display_message, ...missingDisplay } = params;
// @ts-expect-error display_message is required even when it matches message
layla.chat.saveChatMessage(missingDisplay);
const { message, ...missingMessage } = params;
// @ts-expect-error message is required even when it matches display_message
layla.chat.saveChatMessage(missingMessage);
// @ts-expect-error new callers must use the save payload, not a history read entry
layla.chat.saveChatMessage(historyEntry);
// @ts-expect-error the response must include the deprecated content alias
const incompleteResult: SaveChatMessageResult = { ...params, role: 'user' };

void result;
void command;
void incompleteResult;
