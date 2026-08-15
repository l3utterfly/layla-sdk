import { useEffect, useRef, useState } from "react";
import {
  LaylaSDK,
  LaylaAbortError,
  type ChatCompletionContentPart,
  type ChatCompletionMessageParam,
  type ChatCompletionStream,
  type LaylaTTSVoice,
  type STTSpeechRecognizedListener,
} from "../../../src/index";
import "./App.css";

const layla = new LaylaSDK();
const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const supportedImageTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface ChatMessage {
  role: "user" | "assistant";
  content: string | null;
  imageBase64?: string;
  imageName?: string;
}

interface PendingImage {
  dataUrl: string;
  name: string;
}

interface SendOptions {
  /** When provided, sends this text instead of the composer input (voice input). */
  text?: string;
}

const readImageAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("The selected image could not be read."));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });

const toCompletionMessage = (
  message: ChatMessage,
): ChatCompletionMessageParam => {
  if (!message.imageBase64) {
    return {
      role: message.role,
      content: message.content,
    };
  }

  const content: ChatCompletionContentPart[] = [];
  if (message.content) {
    content.push({ type: "text", text: message.content });
  }
  content.push({
    type: "image_url",
    image_url: {
      url: message.imageBase64,
      detail: "auto",
    },
  });

  return {
    role: message.role,
    content,
  };
};

const saveChatMessage = async (
  message: ChatMessage,
  characterId: "layla" | "user",
) => {
  try {
    await layla.chat.saveChatMessage({
      role: message.role,
      content: message.content,
      ...(message.imageBase64
        ? { image_base64: message.imageBase64 }
        : {}),
      id: 0,
      character_id: characterId,
      session_id: sessionId,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error("Failed to save chat message", err);
  }
};

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<PendingImage | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [readingImage, setReadingImage] = useState(false);
  const [busy, setBusy] = useState(false);

  // Voice chat state.
  const [voices, setVoices] = useState<LaylaTTSVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const streamRef = useRef<ChatCompletionStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refs let the long-lived STT listener and the voice loop read current values
  // without re-subscribing on every render.
  const busyRef = useRef(false);
  const listeningRef = useRef(false);
  const voiceModeRef = useRef(voiceMode);
  const voiceIdRef = useRef(voiceId);
  const sendMessageRef = useRef<(options?: SendOptions) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  useEffect(() => {
    voiceIdRef.current = voiceId;
  }, [voiceId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  // Load the installed TTS voices once and default to the first one.
  useEffect(() => {
    layla.tts
      .getVoices()
      .then((available) => {
        setVoices(available);
        setVoiceId((current) => current ?? available[0]?.id ?? null);
      })
      .catch((err) => console.error("Failed to load TTS voices", err));
  }, []);

  /** Speak text with the selected voice. Resolves when playback finishes. */
  const speak = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSpeaking(true);
    try {
      await layla.tts.generateVoice(voiceIdRef.current, trimmed);
    } catch (err) {
      if (!(err instanceof LaylaAbortError)) {
        console.error("TTS playback failed", err);
      }
    } finally {
      setSpeaking(false);
    }
  };

  const stopSpeaking = () => {
    void layla.tts.stopSpeaking();
  };

  /** Ask the host to start capturing microphone speech. */
  const startListening = async () => {
    if (listeningRef.current || busyRef.current) return;
    setVoiceError(null);
    stopSpeaking();
    setListening(true);
    listeningRef.current = true;
    try {
      // Resolves once the recogniser has started; the transcript arrives later
      // through the `speechRecognized` event handler registered below.
      await layla.stt.startListening();
    } catch (err) {
      console.error("Failed to start listening", err);
      setVoiceError("Could not start the microphone.");
      setListening(false);
      listeningRef.current = false;
    }
  };

  /** Ask the host to stop capturing microphone speech and release the mic. */
  const stopListening = async () => {
    if (!listeningRef.current) return;
    setListening(false);
    listeningRef.current = false;
    try {
      await layla.stt.stopListening();
    } catch (err) {
      if (!(err instanceof LaylaAbortError)) {
        console.error("Failed to stop listening", err);
      }
    }
  };

  const toggleListening = () => {
    if (listeningRef.current) {
      void stopListening();
    } else {
      void startListening();
    }
  };

  const toggleVoiceMode = () => {
    const next = !voiceModeRef.current;
    voiceModeRef.current = next;
    setVoiceMode(next);
    if (next) {
      void startListening();
    } else {
      stopSpeaking();
      void stopListening();
    }
  };

  const sendMessage = async (options: SendOptions = {}) => {
    const fromVoice = options.text !== undefined;
    const text = (options.text ?? input).trim();
    // Voice input is text-only; typed messages may carry an image attachment.
    const selectedImage = fromVoice ? null : attachment;

    if ((!text && !selectedImage) || busyRef.current || readingImage) return;

    setListening(false);
    listeningRef.current = false;

    const userMessage: ChatMessage = {
      role: "user",
      content: text || null,
      ...(selectedImage
        ? {
            imageBase64: selectedImage.dataUrl,
            imageName: selectedImage.name,
          }
        : {}),
    };

    const nextMessages = [...messages, userMessage];

    setMessages([
      ...nextMessages,
      {
        role: "assistant",
        content: "",
      },
    ]);

    if (!fromVoice) {
      setInput("");
      setAttachment(null);
    }
    setAttachmentError(null);
    setBusy(true);
    busyRef.current = true;

    let assistantContent = "";

    try {
      await saveChatMessage(userMessage, "user");

      const stream = layla.chat.completions.stream({
        messages: nextMessages.map(toCompletionMessage),
      });

      streamRef.current = stream;

      stream.on("content", (_delta: string, snapshot: string) => {
        assistantContent = snapshot;

        setMessages([
          ...nextMessages,
          {
            role: "assistant",
            content: snapshot,
          },
        ]);
      });

      stream.on("error", (err: Error) => {
        console.error(err);

        setMessages([
          ...nextMessages,
          {
            role: "assistant",
            content: `Error: ${err.message}`,
          },
        ]);
      });

      assistantContent = await stream.finalContent();

      if (assistantContent) {
        await saveChatMessage(
          {
            role: "assistant",
            content: assistantContent,
          },
          "layla",
        );
      }
    } catch (err) {
      if (err instanceof LaylaAbortError) {
        if (assistantContent) {
          await saveChatMessage(
            {
              role: "assistant",
              content: assistantContent,
            },
            "layla",
          );
        }
      } else {
        console.error(err);
      }
    } finally {
      streamRef.current = null;
      setBusy(false);
      busyRef.current = false;
    }

    // Hands-free loop: speak the reply, then listen for the next turn.
    if (voiceModeRef.current && assistantContent) {
      await speak(assistantContent);
      if (voiceModeRef.current) void startListening();
    }
  };

  // Keep the ref pointing at the latest sendMessage for the STT listener.
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  });

  // Subscribe once to recognised speech for the lifetime of the app.
  useEffect(() => {
    const handleSpeech: STTSpeechRecognizedListener = ({ transcript }) => {
      const text = transcript.trim();
      setListening(false);
      listeningRef.current = false;
      if (!text) return;

      if (voiceModeRef.current) {
        void sendMessageRef.current({ text });
      } else {
        // Push-to-talk: drop the transcript into the composer to review/edit.
        setInput((prev) => (prev ? `${prev} ${text}` : text));
      }
    };

    layla.stt.on("speechRecognized", handleSpeech);
    return () => {
      layla.stt.off("speechRecognized", handleSpeech);
      void layla.tts.stopSpeaking();
      if (listeningRef.current) void layla.stt.stopListening();
    };
  }, []);

  const stopGeneration = () => {
    streamRef.current?.abort();
  };

  const selectImage = async (file: File | undefined) => {
    if (!file) return;

    if (!supportedImageTypes.has(file.type)) {
      setAttachmentError("Choose a PNG, JPEG, GIF, or WebP image.");
      return;
    }

    setReadingImage(true);
    setAttachmentError(null);

    try {
      const dataUrl = await readImageAsDataUrl(file);
      setAttachment({ dataUrl, name: file.name });
    } catch (err) {
      setAttachmentError(
        err instanceof Error ? err.message : "The image could not be attached.",
      );
    } finally {
      setReadingImage(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">L</div>

          <div>
            <div className="header-title">
              Layla Chat
            </div>

            <div className="header-subtitle">
              AI Companion
            </div>
          </div>
        </div>

        <div className="header-right">
          {busy && (
            <div className="typing-indicator">
              Generating...
            </div>
          )}
        </div>
      </header>

      <main className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <h1>Welcome to Layla</h1>

            <p>
              Start chatting with your AI companion. Tap the microphone to talk,
              or turn on Voice for a hands-free conversation.
            </p>
          </div>
        )}

        {messages.map((message, index) => {
          const isStreaming =
            busy && index === messages.length - 1 && message.role === "assistant";

          return (
            <div
              key={index}
              className={`message ${message.role}`}
            >
              {message.role === "assistant" && (
                <div className="avatar assistant-avatar">
                  L
                </div>
              )}

              <div className="bubble">
                {message.imageBase64 && (
                  <img
                    className="message-image"
                    src={message.imageBase64}
                    alt={message.imageName ?? "Attached image"}
                  />
                )}

                {message.content && (
                  <div className="message-text">
                    {message.content}
                  </div>
                )}

                {isStreaming && (
                  <span className="cursor">
                    ▊
                  </span>
                )}

                {message.role === "assistant" &&
                  message.content &&
                  !isStreaming && (
                    <button
                      type="button"
                      className="speak-btn"
                      aria-label="Play this message"
                      title="Play this message"
                      disabled={speaking || busy}
                      onClick={() => void speak(message.content ?? "")}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 9v6h4l5 5V4L8 9H4Z" />
                        <path d="M16 8a5 5 0 0 1 0 8" />
                      </svg>
                      Play
                    </button>
                  )}
              </div>

              {message.role === "user" && (
                <div className="avatar user-avatar">
                  Y
                </div>
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </main>

      <footer className="composer">
        <div className="voice-bar">
          <select
            className="voice-select"
            aria-label="Text-to-speech voice"
            value={voiceId ?? ""}
            onChange={(event) => setVoiceId(event.target.value || null)}
          >
            <option value="">Default voice</option>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </select>

          {speaking && (
            <button
              type="button"
              className="speaking-indicator"
              onClick={stopSpeaking}
              title="Stop speaking"
            >
              Stop
            </button>
          )}

          <button
            type="button"
            className={`voice-mode-btn ${voiceMode ? "active" : ""}`}
            aria-pressed={voiceMode}
            title="Hands-free voice conversation"
            onClick={toggleVoiceMode}
          >
            {voiceMode ? "Voice: On" : "Voice: Off"}
          </button>
        </div>

        {attachment && (
          <div className="attachment-preview">
            <img src={attachment.dataUrl} alt="Image ready to attach" />

            <div className="attachment-details">
              <strong>{attachment.name}</strong>
              <span>Ready to send</span>
            </div>

            <button
              type="button"
              className="remove-attachment-btn"
              aria-label="Remove attached image"
              onClick={() => setAttachment(null)}
            >
              ×
            </button>
          </div>
        )}

        {attachmentError && (
          <div className="attachment-error" role="alert">
            {attachmentError}
          </div>
        )}

        {voiceError && (
          <div className="attachment-error" role="alert">
            {voiceError}
          </div>
        )}

        {listening && (
          <div className="listening-banner" role="status">
            <span className="listening-dot" />
            Listening…
          </div>
        )}

        <div className="composer-row">
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void selectImage(file);
            }}
          />

          <button
            type="button"
            className="attach-btn"
            aria-label="Attach an image"
            title="Attach an image"
            disabled={busy || readingImage}
            onClick={() => fileInputRef.current?.click()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12.5 6.5 7.4 11.6a3 3 0 0 0 4.2 4.2l6.1-6.1a5 5 0 0 0-7.1-7.1L4.2 9a7 7 0 0 0 9.9 9.9l5.4-5.4" />
            </svg>
          </button>

          <button
            type="button"
            className={`mic-btn ${listening ? "listening" : ""}`}
            aria-label={listening ? "Listening" : "Speak"}
            aria-pressed={listening}
            title={listening ? "Listening…" : "Speak"}
            disabled={busy || readingImage}
            onClick={toggleListening}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
            </svg>
          </button>

          <input
            value={input}
            placeholder={attachment ? "Add a message..." : "Message Layla..."}
            aria-label="Message Layla"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />

          {!busy ? (
            <button
              type="button"
              className="send-btn"
              disabled={(!input.trim() && !attachment) || readingImage}
              onClick={() => void sendMessage()}
            >
              {readingImage ? "Reading..." : "Send"}
            </button>
          ) : (
            <button
              type="button"
              className="stop-btn"
              onClick={stopGeneration}
            >
              Stop
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
