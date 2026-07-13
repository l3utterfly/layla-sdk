/**
 * resources/contextual.ts
 * -----------------------
 * Helpers for mini-apps launched inside a character chat context.
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onChatContextNewMessage,
  LaylaApiEvent_onGetExecutionContextResponse,
  LaylaExecutionContext,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

export type ChatContextNewMessage =
  LaylaApiEvent_onChatContextNewMessage['data'];

export type ChatContextNewMessageListener = (
  data: ChatContextNewMessage,
) => void;

export class Contextual {
  private readonly chatContextNewMessageListeners =
    new Set<ChatContextNewMessageListener>();
  private listening = false;

  /**
   * Ask the native host for the context in which this mini-app is running.
   * Returns `null` for a standalone top-level mini-app.
   */
  getExecutionContext(
    options: RequestOptions = {},
  ): Promise<LaylaExecutionContext | null> {
    return oneShot<LaylaExecutionContext | null>(
      { cmd: 'get_execution_context', data: null },
      'on_get_execution_context_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGetExecutionContextResponse).data,
      options.signal,
    );
  }

  /** Listen for new messages added to the surrounding character chat. */
  on(
    event: 'chatContextNewMessage',
    listener: ChatContextNewMessageListener,
  ): this {
    void event;
    this.chatContextNewMessageListeners.add(listener);
    this.ensureListening();
    return this;
  }

  /** Stop listening for new messages added to the surrounding character chat. */
  off(
    event: 'chatContextNewMessage',
    listener: ChatContextNewMessageListener,
  ): this {
    void event;
    this.chatContextNewMessageListeners.delete(listener);
    if (this.chatContextNewMessageListeners.size === 0) this.stopListening();
    return this;
  }

  private ensureListening(): void {
    if (this.listening || typeof window === 'undefined') return;
    window.addEventListener('message', this.onWindowMessage);
    this.listening = true;
  }

  private stopListening(): void {
    if (!this.listening || typeof window === 'undefined') return;
    window.removeEventListener('message', this.onWindowMessage);
    this.listening = false;
  }

  private onWindowMessage = (messageEvent: MessageEvent): void => {
    if (typeof messageEvent.data !== 'string') return;

    let event: Partial<LaylaApiEvent>;
    try {
      event = JSON.parse(messageEvent.data);
    } catch {
      return;
    }

    if (event.event !== 'on_chat_context_new_message') return;
    const data = (event as LaylaApiEvent_onChatContextNewMessage).data;

    for (const listener of [...this.chatContextNewMessageListeners]) {
      try {
        listener(data);
      } catch {
        // A consumer listener must not prevent other listeners from running.
      }
    }
  };
}
