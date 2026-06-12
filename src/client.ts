/**
 * client.ts
 * ---------
 * The top-level client. Composes the resources into the object users interact
 * with. Add a new resource by importing it and assigning it a readonly field.
 */

import { Chat } from './resources/chat';
import { Characters } from './resources/characters';
import { Images } from './resources/images';
import { Classifier } from './resources/classifier';
import { Utils } from './resources/utils';

export interface LaylaSDKOptions {
  /** Reserved for future use (e.g. default model). */
  model?: string;
}

export class LaylaSDK {
  readonly chat = new Chat();
  readonly characters = new Characters();
  readonly images = new Images();
  readonly classifier = new Classifier();
  readonly utils = new Utils();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_options: LaylaSDKOptions = {}) {}
}

export { LaylaSDK as Layla };
export default LaylaSDK;
