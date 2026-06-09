/**
 * resources/classifier.ts
 * -----------------------
 * The classifier resource: `layla.classifier.getSentiment()`.
 *
 * This is the template for any one-shot endpoint — a single `oneShot(...)` call
 * giving the command, the response event name, and how to read the payload.
 * Copy this file to add a new resource (e.g. `settings.ts` -> `Settings.get`).
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onGetSentimentResponse,
  SentimentValues,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';


export class Classifier {
  /**
   * Ask the native host for the sentiment of a given text. Resolves once with the host's `on_get_sentiment_response` payload, or rejects on error/abort.
   * @param text The text to analyze for sentiment.
   * @param options Additional request options.
   * @returns A promise that resolves to the sentiment analysis result.
   */
  getSentiment(text: string, options: RequestOptions = {}): Promise<SentimentValues> {
    return oneShot<SentimentValues>(
      { cmd: 'get_sentiment', data: { text } },
      'on_get_sentiment_response',
      (event: LaylaApiEvent) => {
        const data = (event as LaylaApiEvent_onGetSentimentResponse).data;
        return data.sentiment_values;
      },
      options.signal,
    );
  }
}
