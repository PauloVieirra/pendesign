import type { VariableScope } from '../design-system-variables.js';

export interface ExtractedToken<V> {
  value: V;
  scope: VariableScope;
  usageCount: number;
  sourceFiles: string[];
}

export interface ExtractedTokens {
  colors: ExtractedToken<string>[];
  fonts: ExtractedToken<string>[];
  sizes: ExtractedToken<number>[];
  spacing: ExtractedToken<number>[];
  borderRadii: ExtractedToken<number>[];
  borderWidths: ExtractedToken<number>[];
}

export function emptyExtractedTokens(): ExtractedTokens {
  return { colors: [], fonts: [], sizes: [], spacing: [], borderRadii: [], borderWidths: [] };
}
