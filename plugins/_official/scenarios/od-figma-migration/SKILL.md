---
name: od-figma-migration
description: Default reference pipeline for the figma-migration taskKind — figma-extract → token-map → generate → critique.
od:
  scenario: figma-migration
  mode: scenario
---

# od-figma-migration (scenario)

Spec §1 / §10.1 / §21.3.1 / §23.3.3: the canonical figma-migration
flow. The pipeline is sequenced so each stage's output is the next
stage's input — `figma-extract` writes `figma/tree.json`,
`token-map` writes `token-map/colors.json` (etc.), and `generate`
reads both before producing the HTML artifact.

## Default pipeline

```jsonc
{
  "stages": [
    { "id": "extract",  "atoms": ["figma-extract"] },
    { "id": "tokens",   "atoms": ["token-map"] },
    { "id": "generate", "atoms": ["file-write", "live-artifact"] },
    {
      "id": "critique", "atoms": ["critique-theater"],
      "repeat": true,
      "until": "critique.score>=4 || iterations>=3"
    }
  ]
}
```

## Token + inputs

This scenario sources the Figma Personal Access Token (PAT) from the
saved `figma-context` MCP server (`mcp-config.json:servers[id="figma-context"].env.FIGMA_API_KEY`),
falling back to the `FIGMA_TOKEN` shell env var. There is no OAuth
flow — the user pastes their PAT once in Settings → MCP → figma-context,
and every figma-migration run after that just works.

The remaining inputs (`figmaUrl`, optional `componentsUrl`,
`outputFormat`, `cssFramework`) are gathered pre-run by the inline
`PluginInputsForm` that the web app renders for `od.inputs[]`. No
separate `kind:'form'` GenUI surface is needed.

## Output conventions

`figma-extract` writes `<cwd>/figma/tree.json` (screens) and — when
`componentsUrl` is supplied — also `<cwd>/figma/components.tree.json`
(reusable components from a separate page in the same Figma file).
Use both as the structural source of truth; the rasterised PNGs in
`<cwd>/figma/assets/` are for visual reference, not for shipping as
final artwork.

The agent must materialise the project according to `outputFormat`:

**React (`outputFormat = "react"`):**

```
<cwd>/
├── pages/<ScreenName>.tsx        # one screen = one page component
├── components/<Name>.tsx         # one Figma component = one file
├── components/index.ts           # barrel export of every component
└── styles/                       # tailwind.config.ts OR bootstrap shim
```

Each `pages/<Name>.tsx` MUST import from `../components/<...>` rather
than redeclaring the component inline. If you find yourself writing
a `function CardWidget()` directly inside a page, stop and move it
to `components/CardWidget.tsx` first. Long inline component
definitions are flagged by the critique stage and force another
iteration.

**HTML (`outputFormat = "html"`):**

```
<cwd>/
├── pages/<screen-name>.html      # one screen = one page (monolithic)
├── partials/<name>.html          # documented snippets, not includes
└── styles/main.css               # plus the chosen CSS framework CDN
```

HTML pages are monolithic by design — there is no module system to
import partials at runtime without JavaScript. The `partials/`
directory is a *documentation* artefact: each file contains a
canonical copy of one reusable block with a leading comment naming
every page that embeds it. Future edits MUST be propagated to every
embed location explicitly.

**CSS framework choice (`cssFramework`):**

- `tailwind` — utility classes inline on each element; emit a
  `tailwind.config.ts` (React) or include the Tailwind CDN script
  (HTML). Map design tokens from `figma/tokens.json` into the
  `theme.extend` block.
- `bootstrap` — use Bootstrap 5 utility + component classes; emit
  custom CSS in `styles/main.css` for any token that Bootstrap
  doesn't cover natively.
