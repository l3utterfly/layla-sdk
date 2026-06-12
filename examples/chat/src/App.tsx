import { useEffect, useRef, useState } from "react";
import {
  LaylaSDK,
  LaylaAbortError,
  type ChatCompletionStream,
  type LaylaChatMessage,
} from "../../../src/index";
import "./App.css";

const layla = new LaylaSDK();
const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const saveChatMessage = async (
  message: LaylaChatMessage,
  characterId: "layla" | "user",
) => {
  try {
    await layla.chat.saveChatMessage({
      ...message,
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
  const [messages, setMessages] = useState<LaylaChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const streamRef = useRef<ChatCompletionStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();

    if (!text || busy) return;

    const userMessage: LaylaChatMessage = {
      role: "user",
      content: text,
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
    setBusy(true);

    let assistantContent = "";

    try {
      await saveChatMessage(userMessage, "user");

      const stream = layla.chat.completions.stream({
        messages: nextMessages,
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
              {message.content}

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
        <input
          value={input}
          placeholder="Message Layla..."
          onChange={(e) =>
            setInput(e.target.value)
          }
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey
            ) {
              e.preventDefault();
              sendMessage();
            }
          }}
        />

        {!busy ? (
          <button
            className="send-btn"
            onClick={sendMessage}
          >
            Send
          </button>
        ) : (
          <button
            className="stop-btn"
            onClick={stopGeneration}
          >
            Stop
          </button>
        )}
      </footer>
    </div>
  );
}
