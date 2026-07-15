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

/** Converts one contextual Layla sentiment update into VRM emotion weights. */
export function mapLaylaSentimentToVrmExpressions(
  sentiment: LaylaSentiment,
): VrmEmotionExpressionWeights {
  const weights: VrmEmotionExpressionWeights = {
    happy: 0,
    angry: 0,
    sad: 0,
    relaxed: 0,
    surprised: 0,
    neutral: 0,
  };

  weights[LAYLA_SENTIMENT_TO_VRM_EXPRESSION[sentiment]] =
    MAX_VRM_EXPRESSION_WEIGHT;
  return weights;
}
