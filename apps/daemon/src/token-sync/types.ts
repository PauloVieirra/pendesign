export interface ExtractedToken<V> {
  value: V;
  usageCount: number;
  sourceFiles: string[];
}

export interface ExtractedTokens {
  colors: ExtractedToken<string>[];
  fonts: ExtractedToken<string>[];
  sizes: ExtractedToken<number>[];
  spacing: ExtractedToken<number>[];
}

export function emptyExtractedTokens(): ExtractedTokens {
  return { colors: [], fonts: [], sizes: [], spacing: [] };
}
