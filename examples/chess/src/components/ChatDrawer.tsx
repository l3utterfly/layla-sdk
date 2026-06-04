import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Character, ChatMessage } from "../types";
import { Avatar } from "./Avatar";
import styles from "./ChatDrawer.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  responding?: boolean;
}

export function ChatDrawer({ open, onClose, character, messages, onSend, responding }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const submit = () => {
    const text = inputRef.current?.value.trim();
    if (!text) return;
    onSend(text);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={styles.scrim}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className={styles.drawer}
            style={{ ["--accent" as string]: character.accent }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            aria-label={`Conversation with ${character.name}`}
          >
            <header className={styles.head}>
              <Avatar
                accent={character.accent}
                motif={character.motif}
                imageUrl={character.imageUrl}
                name={character.name}
                size={40}
              />
              <div className={styles.headText}>
                <h3 className={styles.headName}>{character.name}</h3>
                <p className={styles.headTitle}>{character.title}</p>
              </div>
              <button className={styles.close} onClick={onClose} aria-label="Close chat">
                ✕
              </button>
            </header>

            <div className={styles.messages} ref={scrollRef}>
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`${styles.row} ${m.role === "player" ? styles.rowMe : styles.rowThem}`}
                >
                  <div className={`${styles.msg} ${m.role === "player" ? styles.me : styles.them}`}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.composer}>
              <input
                ref={inputRef}
                className={styles.input}
                placeholder={`Say something to ${character.name.split(" ")[0]}…`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
              <button className={styles.send} onClick={submit} aria-label="Send message">
                {responding ? "…" : "➤"}
              </button>
            </div>
            <p className={styles.note}>
              {responding ? `${character.name.split(" ")[0]} is replying…` : "Chat replies use Layla and the live board context."}
            </p>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
