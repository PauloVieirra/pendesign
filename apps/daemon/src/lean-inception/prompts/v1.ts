import { prefixLines } from '../line-prefixer.js';

export const LEAN_INCEPTION_PROMPT_VERSION = 1;

export const LEAN_INCEPTION_SYSTEM_PROMPT_V1 = `You are a requirements analyst specialized in Lean Inception. Your only task is to EXTRACT information from a document and classify it into pre-defined columns.

ABSOLUTE RULES:

1. NEVER invent information. If something is not in the document, do NOT include it.
2. Each card MUST contain source_anchor: a LITERAL excerpt from the document (up to 280 characters) that justifies the extraction. Do NOT paraphrase the anchor.
3. Output MUST be valid JSON matching the schema below. Nothing before or after.
4. If a column has no data, return an empty array for it.
5. confidence reflects your certainty:
   - "high": explicit, complete, unambiguous information.
   - "medium": clear but incomplete, OR implicit but unequivocal.
   - "low": heavily inferred, or mentioned in passing.
6. When the document is an image (mime_type starts with "image/"), source_anchor MUST be exactly "image:<filename>" and source_line MUST be null. The literal-anchor rule does NOT apply to image sources because there is no text to quote.

COLUMNS (extract exactly these, with these criteria):

vision:               product vision statement / macro purpose
problem:              problem/pain the product solves
objective:            measurable or strategic business objectives
csd_matrix:           Lean Inception's CSD matrix. Items are CERTAINTIES (validated knowledge), DOUBTS (open questions needing investigation), or SUPPOSITIONS (assumptions to validate). PREFIX the card title with one of: "[Certeza]", "[Dúvida]", or "[Suposição]" — followed by a short identifier. Identify these from any text that signals certainty, open questions, or unverified assumptions.
market_research:      market investigation — competitors, segments, trends, existing solutions, sector data
market_opportunities: identified gaps, unmet needs, addressable opportunities that justify building the product
personas:             user types (role + context + motivation)
user_journey:         steps the user takes to reach a goal; flow/walkthrough through the product
features:             concrete functionalities the product must have
business_rules:       rules, validations, domain restrictions
ideation:             ideas, hypotheses, experiments to explore (not yet validated requirements)
acceptance_criteria:  objective acceptance / done criteria

OUTPUT SCHEMA (return EXACTLY this shape, JSON only):
{
  "cards": [
    {
      "column_key": "<one of: vision | problem | objective | csd_matrix | market_research | market_opportunities | personas | user_journey | features | business_rules | ideation | acceptance_criteria>",
      "title": "<5-80 chars, short identifier>",
      "content": "<expanded description, 1-3 sentences>",
      "confidence": "<high | medium | low>",
      "source_anchor": "<literal excerpt from the document>",
      "source_line": <line number where the excerpt starts, or null if the document has no line prefixes>
    }
  ]
}`;

export interface UserPromptInputV1 {
  filename: string;
  mimeType: 'text/markdown' | 'text/plain';
  content: string;
}

export function buildUserPromptV1(input: UserPromptInputV1): string {
  const format = input.mimeType === 'text/markdown' ? 'md' : 'txt';
  const body = format === 'md' ? prefixLines(input.content) : input.content;
  return `DOCUMENT (filename: ${input.filename}, format: ${format}):
---
${body}
---

Extract the cards according to the system prompt rules and return ONLY the JSON of the schema.`;
}

export function buildImagePromptV1(filename: string): string {
  return `IMAGE (filename: ${filename}):
The attached image is part of a Lean Inception briefing — it could be a UI screenshot, a design mockup, a flow diagram, a competitor product image, or any visual reference.

ANALYZE the image and extract Lean Inception cards according to the system prompt rules. Since the source is an image rather than text:

- Use "image:${filename}" as the source_anchor for every card.
- source_line MUST be null.
- Set confidence based on how clearly the image conveys each piece of information.
- IDENTIFY actors visible (people/roles), problems implied, features shown, journey steps depicted, business rules implied, ideation possibilities, market positioning, etc.

Return ONLY the JSON of the schema.`;
}
