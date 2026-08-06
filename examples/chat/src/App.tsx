import { useEffect, useRef, useState } from "react";
import {
  LaylaSDK,
  LaylaAbortError,
  type ChatCompletionContentPart,
  type ChatCompletionMessageParam,
  type ChatCompletionStream,
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

  const streamRef = useRef<ChatCompletionStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    const selectedImage = attachment;

    if ((!text && !selectedImage) || busy || readingImage) return;

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

    setInput("");
    setAttachment(null);
    setAttachmentError(null);
    setBusy(true);

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
    }
  };

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

        {busy && (
          <div className="typing-indicator">
            Generating...
          </div>
        )}
      </header>

      <main className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <h1>Welcome to Layla</h1>

            <p>
              Start chatting with your AI companion.
            </p>
          </div>
        )}

        {messages.map((message, index) => (
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

              {busy &&
                index === messages.length - 1 &&
                message.role === "assistant" && (
                  <span className="cursor">
                    ▊
                  </span>
                )}
            </div>

            {message.role === "user" && (
              <div className="avatar user-avatar">
                Y
              </div>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </main>

      <footer className="composer">
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
