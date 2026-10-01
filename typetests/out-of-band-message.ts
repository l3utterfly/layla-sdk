import {
  LaylaSDK,
  type LaylaApiEvent_onSendOutOfBandMessageResponse,
  type LaylaApiSendOutOfBandMessage,
  type SendOutOfBandMessageOptions,
} from '../src';

const layla = new LaylaSDK();
const options: SendOutOfBandMessageOptions = {
  imageBase64: 'data:image/png;base64,aW1n',
  jsonSchema: { type: 'object', properties: { send: { type: 'boolean' } } },
  signal: new AbortController().signal,
};

const reply: Promise<string> = layla.contextual.sendOutOfBandMessage(
  'Should the character send a picture now? Answer yes or no.',
  options,
);

const command: LaylaApiSendOutOfBandMessage = {
  cmd: 'send_out_of_band_message',
  data: { message: 'Hello?' },
};
const event: LaylaApiEvent_onSendOutOfBandMessageResponse = {
  event: 'on_send_out_of_band_message_response',
  data: { msg: 'yes' },
};

void reply;
void command;
void event;
