/**
 * resources/contextual.ts
 * -----------------------
 * Helpers for mini-apps launched inside a character chat context.
 */

import type {
  LaylaApiEvent,
  LaylaApiEvent_onChatContextFinishedSpeaking,
  LaylaApiEvent_onChatContextNewMessage,
  LaylaApiEvent_onChatContextSentimentUpdate,
  LaylaApiEvent_onChatContextStartedSpeaking,
  LaylaApiEvent_onChatContextStartedThinking,
  LaylaApiEvent_onGetExecutionContextResponse,
  LaylaExecutionContext,
} from '../protocol';
import { oneShot, type RequestOptions } from '../internal/one-shot';

export type ChatContextNewMessage =
  LaylaApiEvent_onChatContextNewMessage['data'];

export type ChatContextNewMessageListener = (
  data: ChatContextNewMessage,
) => void;

export type ChatContextSentimentUpdate =
  LaylaApiEvent_onChatContextSentimentUpdate['data'];

export type ChatContextSentimentUpdateListener = (
  data: ChatContextSentimentUpdate,
) => void;

export type ChatContextStartedSpeaking =
  LaylaApiEvent_onChatContextStartedSpeaking['data'];

export type ChatContextStartedSpeakingListener = (
  data: ChatContextStartedSpeaking,
) => void;

export type ChatContextFinishedSpeaking =
  LaylaApiEvent_onChatContextFinishedSpeaking['data'];

export type ChatContextFinishedSpeakingListener = (
  data: ChatContextFinishedSpeaking,
) => void;

export type ChatContextStartedThinking =
  LaylaApiEvent_onChatContextStartedThinking['data'];

export type ChatContextStartedThinkingListener = (
  data: ChatContextStartedThinking,
) => void;

type ChatContextEventName =
  | 'chatContextNewMessage'
  | 'chatContextSentimentUpdate'
  | 'chatContextStartedSpeaking'
  | 'chatContextFinishedSpeaking'
  | 'chatContextStartedThinking';

type ChatContextEventListener =
  | ChatContextNewMessageListener
  | ChatContextSentimentUpdateListener
  | ChatContextStartedSpeakingListener
  | ChatContextFinishedSpeakingListener
  | ChatContextStartedThinkingListener;

export class Contextual {
  private readonly chatContextNewMessageListeners =
    new Set<ChatContextNewMessageListener>();
  private readonly chatContextSentimentUpdateListeners =
    new Set<ChatContextSentimentUpdateListener>();
  private readonly chatContextStartedSpeakingListeners =
    new Set<ChatContextStartedSpeakingListener>();
  private readonly chatContextFinishedSpeakingListeners =
    new Set<ChatContextFinishedSpeakingListener>();
  private readonly chatContextStartedThinkingListeners =
    new Set<ChatContextStartedThinkingListener>();
  private listening = false;

  /**
   * Ask the native host for the context in which this mini-app is running.
   * The returned context always includes the Layla app version. Its character
   * and session fields are `null` for a standalone top-level mini-app.
   */
  getExecutionContext(
    options: RequestOptions = {},
  ): Promise<LaylaExecutionContext> {
    return oneShot<LaylaExecutionContext>(
      { cmd: 'get_execution_context', data: null },
      'on_get_execution_context_response',
      (event: LaylaApiEvent) =>
        (event as LaylaApiEvent_onGetExecutionContextResponse).data,
      options.signal,
    );
  }

  /** Listen for activity in the surrounding character chat. */
  on(
    event: 'chatContextNewMessage',
    listener: ChatContextNewMessageListener,
  ): this;
  on(
    event: 'chatContextSentimentUpdate',
    listener: ChatContextSentimentUpdateListener,
  ): this;
  on(
    event: 'chatContextStartedSpeaking',
    listener: ChatContextStartedSpeakingListener,
  ): this;
  on(
    event: 'chatContextFinishedSpeaking',
    listener: ChatContextFinishedSpeakingListener,
  ): this;
  on(
    event: 'chatContextStartedThinking',
    listener: ChatContextStartedThinkingListener,
  ): this;
  on(
    event: ChatContextEventName,
    listener: ChatContextEventListener,
  ): this {
    switch (event) {
      case 'chatContextNewMessage':
        this.chatContextNewMessageListeners.add(
          listener as ChatContextNewMessageListener,
        );
        break;
      case 'chatContextSentimentUpdate':
        this.chatContextSentimentUpdateListeners.add(
          listener as ChatContextSentimentUpdateListener,
        );
        break;
      case 'chatContextStartedSpeaking':
        this.chatContextStartedSpeakingListeners.add(
          listener as ChatContextStartedSpeakingListener,
        );
        break;
      case 'chatContextFinishedSpeaking':
        this.chatContextFinishedSpeakingListeners.add(
          listener as ChatContextFinishedSpeakingListener,
        );
        break;
      case 'chatContextStartedThinking':
        this.chatContextStartedThinkingListeners.add(
          listener as ChatContextStartedThinkingListener,
        );
        break;
    }
    this.ensureListening();
    return this;
  }

  /** Stop listening for activity in the surrounding character chat. */
  off(
    event: 'chatContextNewMessage',
    listener: ChatContextNewMessageListener,
  ): this;
  off(
    event: 'chatContextSentimentUpdate',
    listener: ChatContextSentimentUpdateListener,
  ): this;
  off(
    event: 'chatContextStartedSpeaking',
    listener: ChatContextStartedSpeakingListener,
  ): this;
  off(
    event: 'chatContextFinishedSpeaking',
    listener: ChatContextFinishedSpeakingListener,
  ): this;
  off(
    event: 'chatContextStartedThinking',
    listener: ChatContextStartedThinkingListener,
  ): this;
  off(
    event: ChatContextEventName,
    listener: ChatContextEventListener,
  ): this {
    switch (event) {
      case 'chatContextNewMessage':
        this.chatContextNewMessageListeners.delete(
          listener as ChatContextNewMessageListener,
        );
        break;
      case 'chatContextSentimentUpdate':
        this.chatContextSentimentUpdateListeners.delete(
          listener as ChatContextSentimentUpdateListener,
        );
        break;
      case 'chatContextStartedSpeaking':
        this.chatContextStartedSpeakingListeners.delete(
          listener as ChatContextStartedSpeakingListener,
        );
        break;
      case 'chatContextFinishedSpeaking':
        this.chatContextFinishedSpeakingListeners.delete(
          listener as ChatContextFinishedSpeakingListener,
        );
        break;
      case 'chatContextStartedThinking':
        this.chatContextStartedThinkingListeners.delete(
          listener as ChatContextStartedThinkingListener,
        );
        break;
    }
    if (!this.hasListeners()) this.stopListening();
    return this;
  }

  private hasListeners(): boolean {
    return (
      this.chatContextNewMessageListeners.size > 0 ||
      this.chatContextSentimentUpdateListeners.size > 0 ||
      this.chatContextStartedSpeakingListeners.size > 0 ||
      this.chatContextFinishedSpeakingListeners.size > 0 ||
      this.chatContextStartedThinkingListeners.size > 0
    );
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

    switch (event.event) {
      case 'on_chat_context_new_message':
        this.emit(
          this.chatContextNewMessageListeners,
          (event as LaylaApiEvent_onChatContextNewMessage).data,
        );
        break;
      case 'on_chat_context_sentiment_update':
        this.emit(
          this.chatContextSentimentUpdateListeners,
          (event as LaylaApiEvent_onChatContextSentimentUpdate).data,
        );
        break;
      case 'on_chat_context_started_speaking':
        this.emit(
          this.chatContextStartedSpeakingListeners,
          (event as LaylaApiEvent_onChatContextStartedSpeaking).data,
        );
        break;
      case 'on_finished_speaking':
        this.emit(
          this.chatContextFinishedSpeakingListeners,
          (event as LaylaApiEvent_onChatContextFinishedSpeaking).data,
        );
        break;
      case 'on_chat_context_started_thinking':
        this.emit(
          this.chatContextStartedThinkingListeners,
          (event as LaylaApiEvent_onChatContextStartedThinking).data,
        );
        break;
    }
  };

  private emit<T>(listeners: Set<(data: T) => void>, data: T): void {
    for (const listener of [...listeners]) {
      try {
        listener(data);
      } catch {
        // A consumer listener must not prevent other listeners from running.
      }
    }
  }
}
