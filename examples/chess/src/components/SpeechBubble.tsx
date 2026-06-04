import { AnimatePresence, motion } from "framer-motion";
import styles from "./SpeechBubble.module.css";

interface SpeechBubbleProps {
  /** The line to show. Empty/undefined hides the bubble. */
  text?: string;
  /** Bump this whenever a new line should "pop", even if text repeats. */
  cue: number;
  thinking?: boolean;
}

export function SpeechBubble({ text, cue, thinking }: SpeechBubbleProps) {
  return (
    <div className={styles.wrap} aria-live="polite">
      <AnimatePresence mode="wait">
        {thinking ? (
          <motion.div
            key="thinking"
            className={styles.bubble}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.22 }}
          >
            <span className={styles.dots}>
              <i /><i /><i />
            </span>
          </motion.div>
        ) : text ? (
          <motion.div
            key={`line-${cue}`}
            className={styles.bubble}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 26 }}
          >
            <p className={styles.text}>{text}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
