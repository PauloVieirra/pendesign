export function prefixLines(content: string): string {
  return content
    .split('\n')
    .map((line, idx) => `L${idx + 1}: ${line}`)
    .join('\n');
}
