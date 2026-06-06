import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { LaylaAbortError, type TavernCardV2 } from "../layla";
import { layla } from "../laylaClient";
import type { Character, Difficulty, GameConfig, PlayerColor } from "../types";
import { DIFFICULTIES } from "../data";
import { formatLaylaConnectionError } from "../laylaErrors";
import { Avatar } from "./Avatar";
import styles from "./CharacterSelectModal.module.css";
interface Props {
  onStart: (config: GameConfig) => void;
}

const ACCENTS = [
  "#7fae6a",
  "#5b8fb0",
  "#9b7fc4",
  "#c08a4e",
  "#c6536f",
  "#b8b3a8",
];
const MOTIFS: Character["motif"][] = [
  "pawn",
  "knight",
  "bishop",
  "rook",
  "queen",
  "king",
];

function hashText(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function firstUseful(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function titleFromCard(card: TavernCardV2) {
  const tag = card.data.tags.find((t: string) => t.trim());
  if (tag) return tag;
  if (card.data.creator) return `By ${card.data.creator}`;
  return "Layla Character";
}

function mapLaylaCharacter(
  character: Awaited<ReturnType<typeof layla.characters.list>>[number],
  imageUrl: string | null,
  index: number,
): Character {
  const card = character.data;
  const name = firstUseful(card.data.name, `Character ${index + 1}`);
  const seed = hashText(`${character.id}:${name}`);
  const description = firstUseful(
    card.data.description,
    card.data.personality,
    card.data.scenario,
  );
  const greeting = firstUseful(
    card.data.first_mes,
    card.data.alternate_greetings[0],
  );

  return {
    id: character.id,
    name,
    title: titleFromCard(card),
    description,
    personality: firstUseful(card.data.personality),
    scenario: firstUseful(card.data.scenario),
    systemPrompt: firstUseful(card.data.system_prompt),
    postHistoryInstructions: firstUseful(card.data.post_history_instructions),
    messageExample: firstUseful(card.data.mes_example),
    accent: ACCENTS[seed % ACCENTS.length],
    motif: MOTIFS[seed % MOTIFS.length],
    imageUrl,
    suggestedSkill: Math.min(20, Math.max(2, 2 + index * 3)),
    greeting,
  };
}

export function CharacterSelectModal({ onStart }: Props) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [charId, setCharId] = useState<string | null>(null);
  const [color, setColor] = useState<PlayerColor>("white");
  const [difficultyId, setDifficultyId] = useState<string>("club");
  const [loadingCharacters, setLoadingCharacters] = useState(true);
  const [characterError, setCharacterError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCharacters() {
      setLoadingCharacters(true);
      setCharacterError(null);
      setCharacters([]);
      setCharId(null);

      try {
        const laylaCharacters = await layla.characters.list({
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;
        if (laylaCharacters.length === 0) {
          setCharacterError("Connected to Layla, but no characters were returned.");
          return;
        }

        const loadedCharacters = laylaCharacters.map((laylaCharacter, index) =>
          mapLaylaCharacter(laylaCharacter, null, index),
        );
        setCharacters(loadedCharacters);
        setCharId(loadedCharacters[0]?.id ?? null);
        setLoadingCharacters(false);

        laylaCharacters.forEach((laylaCharacter) => {
          void loadCharacterImage(laylaCharacter.id);
        });
      } catch (error) {
        if (controller.signal.aborted || error instanceof LaylaAbortError) {
          return;
        }

        console.error("Error loading Layla characters:", error);
        setCharacters([]);
        setCharacterError(formatLaylaConnectionError(error));
      } finally {
        if (!controller.signal.aborted) setLoadingCharacters(false);
      }
    }

    async function loadCharacterImage(characterId: string) {
      try {
        const imageUrl = await layla.characters.getImage(characterId, {
          signal: controller.signal,
        });

        if (controller.signal.aborted || !imageUrl) return;
        setCharacters((prev) =>
          prev.map((character) =>
            character.id === characterId ? { ...character, imageUrl } : character,
          ),
        );
      } catch (error) {
        if (controller.signal.aborted || error instanceof LaylaAbortError) {
          return;
        }

        console.warn("Unable to load Layla character image:", error);
      }
    }

    void loadCharacters();

    return () => controller.abort();
  }, []);

  const character = useMemo<Character | null>(
    () => characters.find((c) => c.id === charId) ?? null,
    [characters, charId],
  );
  const difficulty = useMemo<Difficulty>(
    () => DIFFICULTIES.find((d) => d.id === difficultyId) ?? DIFFICULTIES[1],
    [difficultyId],
  );

  const accent = character?.accent ?? "var(--brass)";

  const begin = () => {
    if (!character) return;
    onStart({ character, playerColor: color, difficulty });
  };

  return (
    <div className={styles.backdrop}>
      <motion.div
        className={styles.modal}
        style={{ ["--accent" as string]: accent }}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
      >
        <header className={styles.header}>
          <p className={styles.kicker}>♟ The Chess Salon</p>
          <h1 className={styles.title}>Choose your opponent</h1>
          <p className={styles.sub}>
            {loadingCharacters
              ? "Gathering Layla characters for the board."
              : "Pick one, choose your side, and set the stakes."}
          </p>
          {characterError && (
            <p className={styles.loadNote}>{characterError}</p>
          )}
        </header>

        <div className={styles.grid}>
          {loadingCharacters && (
            <div className={styles.loadingState} role="status" aria-label="Loading characters">
              <span className={styles.spinner} />
            </div>
          )}
          {!loadingCharacters && characters.length === 0 && (
            <div className={styles.emptyState}>
              {characterError ?? "No Layla characters are available."}
            </div>
          )}
          {characters.map((c, i) => {
            const active = c.id === charId;
            return (
              <motion.button
                type="button"
                key={c.id}
                className={`${styles.card} ${active ? styles.cardActive : ""}`}
                style={{ ["--accent" as string]: c.accent }}
                onClick={() => setCharId(c.id)}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.05, duration: 0.3 }}
                whileHover={{ y: -3 }}
                aria-pressed={active}
              >
                <div className={styles.cardAvatar}>
                  <Avatar
                    accent={c.accent}
                    motif={c.motif}
                    imageUrl={c.imageUrl}
                    name={c.name}
                    size={64}
                  />
                </div>
                <div className={styles.cardBody}>
                  <h3 className={styles.cardName}>{c.name}</h3>
                  <p className={styles.cardTitle}>{c.title}</p>
                  <p className={styles.cardDesc}>{c.description}</p>
                </div>
                {active && <span className={styles.check}>✓</span>}
              </motion.button>
            );
          })}
        </div>

        <div className={styles.options}>
          <div className={styles.optBlock}>
            <span className={styles.optLabel}>Play as</span>
            <div
              className={styles.segmented}
              role="radiogroup"
              aria-label="Play as"
            >
              {(["white", "black"] as PlayerColor[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  className={`${styles.seg} ${color === c ? styles.segOn : ""}`}
                  onClick={() => setColor(c)}
                >
                  <span
                    className={`${styles.dot} ${c === "white" ? styles.dotWhite : styles.dotBlack}`}
                  />
                  {c === "white" ? "White" : "Black"}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.optBlock}>
            <span className={styles.optLabel}>
              Difficulty{" "}
              <em className={styles.optHint}>
                · Stockfish skill {difficulty.skill}
              </em>
            </span>
            <div
              className={styles.chips}
              role="radiogroup"
              aria-label="Difficulty"
            >
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={difficultyId === d.id}
                  className={`${styles.chip} ${difficultyId === d.id ? styles.chipOn : ""}`}
                  onClick={() => setDifficultyId(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className={styles.blurb}>{difficulty.blurb}</p>
          </div>
        </div>

        <footer className={styles.footer}>
          <p className={styles.footHint}>
            {character ? (
              <>
                Facing{" "}
                <strong style={{ color: accent }}>{character.name}</strong> ·
                you play {color}
              </>
            ) : (
              "Select a character to begin"
            )}
          </p>
          <button
            type="button"
            className={styles.begin}
            disabled={!character || loadingCharacters || Boolean(characterError)}
            onClick={begin}
          >
            Begin the game
          </button>
        </footer>
      </motion.div>
    </div>
  );
}
