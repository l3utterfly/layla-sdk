import type { SentimentValues } from "../../../../src";

/** The emotional expression presets defined by the VRM 1.0 specification. */
export const VRM_EMOTION_EXPRESSIONS = [
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "neutral",
] as const;

export type VrmEmotionExpression = (typeof VRM_EMOTION_EXPRESSIONS)[number];
export type VrmEmotionExpressionWeights = Record<VrmEmotionExpression, number>;

export const MAX_VRM_EXPRESSION_WEIGHT = 0.7;

export type LaylaSentiment = keyof SentimentValues;

export interface StrongestLaylaSentiment {
  sentiment: LaylaSentiment;
  score: number;
}

/**
 * Groups Layla's fine-grained sentiment labels into VRM 1.0's standard
 * emotional expression presets.
 */
export const LAYLA_SENTIMENT_TO_VRM_EXPRESSION = {
  admiration: "happy",
  amusement: "happy",
  anger: "angry",
  annoyance: "angry",
  approval: "relaxed",
  caring: "relaxed",
  confusion: "surprised",
  curiosity: "surprised",
  desire: "relaxed",
  disappointment: "sad",
  disapproval: "angry",
  disgust: "angry",
  embarrassment: "surprised",
  excitement: "happy",
  fear: "surprised",
  gratitude: "relaxed",
  grief: "sad",
  joy: "happy",
  love: "relaxed",
  nervousness: "surprised",
  optimism: "happy",
  pride: "happy",
  realization: "surprised",
  relief: "relaxed",
  remorse: "sad",
  sadness: "sad",
  surprise: "surprised",
  neutral: "neutral",
} as const satisfies Record<LaylaSentiment, VrmEmotionExpression>;

const clampSentimentScore = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Returns the single strongest valid Layla sentiment, or null for all-zero scores. */
export function getStrongestLaylaSentiment(
  sentiments: SentimentValues,
): StrongestLaylaSentiment | null {
  let strongest: StrongestLaylaSentiment | null = null;

  for (const sentiment of Object.keys(
    LAYLA_SENTIMENT_TO_VRM_EXPRESSION,
  ) as LaylaSentiment[]) {
    const score = clampSentimentScore(sentiments[sentiment]);
    if (!strongest || score > strongest.score) {
      strongest = { sentiment, score };
    }
  }

  return strongest && strongest.score > 0 ? strongest : null;
}

/**
 * Converts the strongest Layla sentiment into one VRM 1.0 emotion preset,
 * capped at `MAX_VRM_EXPRESSION_WEIGHT` to keep the expression subtle.
 *
 * Every preset is returned, with only the winning expression receiving a
 * non-zero weight. This keeps VRM emotion expressions mutually exclusive and
 * clears the previous emotional state when passed to `setExpressions()`.
 */
export function mapLaylaSentimentsToVrmExpressions(
  sentiments: SentimentValues,
): VrmEmotionExpressionWeights {
  const weights: VrmEmotionExpressionWeights = {
    happy: 0,
    angry: 0,
    sad: 0,
    relaxed: 0,
    surprised: 0,
    neutral: 0,
  };

  const strongest = getStrongestLaylaSentiment(sentiments);

  if (strongest) {
    const expression =
      LAYLA_SENTIMENT_TO_VRM_EXPRESSION[strongest.sentiment];
    weights[expression] = Math.min(
      MAX_VRM_EXPRESSION_WEIGHT,
      strongest.score,
    );
  }

  return weights;
}
