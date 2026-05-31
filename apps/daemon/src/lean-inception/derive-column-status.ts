import type { LeanInceptionColumnStatus } from '@open-design/contracts';

type CardLike = { confidence: 'low' | 'medium' | 'high' };

export function deriveColumnStatus(cards: readonly CardLike[]): LeanInceptionColumnStatus {
  if (cards.length === 0) return 'not_identified';
  let score = 0;
  for (const card of cards) {
    if (card.confidence === 'high') score += 1.0;
    else if (card.confidence === 'medium') score += 0.6;
    else score += 0.3;
  }
  if (score >= 3.0) return 'complete';
  if (score >= 1.5) return 'partial';
  return 'insufficient';
}
