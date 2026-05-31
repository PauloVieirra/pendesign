# Lean Inception — Canvas read-only + UI parity (Sub-projeto 2 / N)

- **Status:** Design aprovado, aguardando plano de implementação
- **Autor:** Brainstorming colaborativo (Paulo Junior + Claude)
- **Data:** 2026-05-25
- **Sub-projeto:** Canvas web (visualização + upload + remove + reset)
- **Depende de:** Sub-projeto 1 — `docs/superpowers/specs/2026-05-25-lean-inception-extraction-pipeline-design.md`
- **Próximo previsto:** Sub-projeto 3 — demais 11 colunas + scoring de maturidade

---

## 1. Contexto

O sub-projeto 1 entregou o pipeline de extração CLI-first: documentos `.md`/`.txt` são ingeridos via `od lean-inception extract`, processados por runtime de agente, e cards são persistidos em SQLite com proveniência. O daemon expõe rotas HTTP completas (`GET/POST/DELETE /api/projects/:id/lean-inception[/documents[/:docId]]`) e o contrato `LeanInceptionState` está em `packages/contracts`.

Este sub-projeto adiciona a **camada visual** em `apps/web`: uma aba fixa "Lean Inception" dentro do FileWorkspace de cada project, com canvas kanban interativo (7 colunas, cards, zoom/pan), drawer de detalhe com proveniência citada, e UI completa para upload/remove/reset — fechando a paridade UI/CLI exigida pelo `AGENTS.md`.

## 2. Decisões fundamentais (registradas)

| Decisão | Escolha | Por quê |
|---|---|---|
| Escopo | Visualização + upload + remove + reset (paridade UI/CLI total) | Fecha o gap do AGENTS.md e elimina dependência exclusiva do CLI |
| Entry point | Aba fixa `__lean_inception__` em `FileWorkspace.tsx`, leftmost, sem botão de fechar | Segue padrão existente de `DESIGN_FILES_TAB`/`DESIGN_SYSTEM_TAB`; encaixa em "1 inception por project" |
| Layout das colunas | Kanban horizontal, 7 colunas lado a lado | Padrão de board (Trello/Jira); natural para workshop format |
| Interações canvas | Zoom + pan via `react-zoom-pan-pinch` | Spec original lista zoom/pan/minimap como diferencial; biblioteca madura para React 18 |
| Card detail | Drawer à direita | Mantém contexto do board; espaço para mostrar source_anchor + line + filename |
| Updates | Fetch on-mount + refresh manual + invalidate após ações | Sem polling, sem SSE no MVP; mais simples |
| Upload | Botão + drag-and-drop full-canvas | Descoberta fácil + atalho rápido para quem já sabe |
| Empty state | 7 colunas vazias sempre visíveis + CTA central | Bate com princípio do spec "colunas existem previamente" |
| Doc management | Toolbar com `Documents (N)` popover + Reset/Refresh/Add | Tudo no header, sem roubar largura do canvas |
| Status cores | green/amber/orange/neutral (Tailwind v4 tokens) | Convenção visual: complete/partial/insufficient/not_identified |

## 3. Escopo

### In scope

- Componente `LeanInceptionCanvas` consumindo `LeanInceptionState` do contract.
- Aba fixa em `FileWorkspace.tsx` posicionada antes de `DESIGN_FILES_TAB`/`DESIGN_SYSTEM_TAB`.
- Hook `useLeanInception(projectId)` para fetch + actions.
- 8 componentes filhos em `apps/web/src/components/lean-inception/`.
- Upload por botão + drag-and-drop full-canvas (`.md`/`.txt` apenas).
- Drawer de detalhe lateral com `source_anchor` citado e link/scroll para `source_line`.
- Documents popover na toolbar com remove individual + status por doc.
- Reset com confirmação modal.
- Zoom in/out/fit controls.
- Empty state CTA quando 0 docs.
- i18n keys novas em todos os 18 locales.
- Testes Vitest + Testing Library para hook + componentes.

### Out of scope (sub-projetos futuros)

- Polling / SSE para extrações em tempo real.
- Demais 11 colunas (jornada, integrações, dependências, MVP, é/não é, métricas, riscos, backlog, priorizações, hipóteses, requisitos técnicos, requisitos não funcionais).
- Scoring de maturidade por área (Discovery/UX/UI/FE/BE/QA).
- Alertas contextuais por coluna.
- Minimap.
- Drag-reorder de cards (read-only por princípio — fonte da verdade é o doc).
- Editar/mover cards manualmente.
- Exportação do board (imagem, PDF).
- Compartilhamento por URL pública.
- Histórico de versões navegável.
- Tema escuro custom (usa o tema global do app).
- Mobile/touch otimizado (desktop-first; responsive básico suficiente).

## 4. Arquitetura

```
┌───────────────────────────────────────────────────────────────────┐
│  apps/web                                                         │
│                                                                   │
│  FileWorkspace.tsx (existing — modify)                            │
│   ├─ tab strip                                                    │
│   │   [Lean Inception ★] [Design Files] [index.html × ] [...]    │
│   │   ↑ NEW, fixed, leftmost, no close                           │
│   └─ when activeTab === LEAN_INCEPTION_TAB                        │
│       render <LeanInceptionCanvas projectId={projectId} />        │
│                                                                   │
│  components/lean-inception/ (new directory)                       │
│   ├─ LeanInceptionCanvas.tsx       (orchestrator)                 │
│   ├─ LeanInceptionToolbar.tsx                                     │
│   ├─ LeanInceptionBoard.tsx        (zoom/pan + drag-drop)         │
│   ├─ LeanInceptionColumn.tsx                                      │
│   ├─ LeanInceptionCard.tsx                                        │
│   ├─ LeanInceptionDetailDrawer.tsx                                │
│   ├─ LeanInceptionDocumentsList.tsx (popover content)             │
│   ├─ LeanInceptionDropOverlay.tsx                                 │
│   ├─ LeanInceptionEmptyState.tsx                                  │
│   └─ useLeanInception.ts                                          │
└───────────────────────────────────────────────────────────────────┘
                                  │
                                  │ fetch
                                  ▼
              daemon /api/projects/:id/lean-inception/*
              (sub-projeto 1, já em produção)
```

### Princípios arquiteturais

- **Reuso de contracts:** Consome `LeanInceptionState`, `ExtractDocumentsRequest`, etc. de `@open-design/contracts`. Sem duplicação de schema.
- **Hook único:** `useLeanInception(projectId)` é a superfície de dados. Componentes recebem dados por prop, não conhecem fetch.
- **Estado local:** Sem context global, sem store global. Estado vive no `LeanInceptionCanvas` e no hook.
- **Sem rota nova:** Aba é estado interno do FileWorkspace (igual `__design_files__`). Sem mudança no `router.ts`.
- **Padrão de aba pré-existente:** Constante `LEAN_INCEPTION_TAB` segue convenção `__lean_inception__`.

## 5. Hook `useLeanInception`

### API

```ts
interface UseLeanInception {
  state: LeanInceptionState | null;
  isLoading: boolean;       // true durante 1º fetch
  isMutating: boolean;      // true durante upload/remove/reset
  error: LeanInceptionError | string | null;

  refresh: () => Promise<void>;
  extract: (files: File[]) => Promise<void>;
  removeDocument: (documentId: string) => Promise<void>;
  reset: () => Promise<void>;
}
```

### Comportamentos

- **Mount:** chama `GET /api/projects/:id/lean-inception`, popula `state`.
- **`extract(files)`:** filtra `.md`/`.txt` localmente, lê em base64, faz `POST .../documents`, atualiza `state` com a resposta. Erros tipados de `LeanInceptionError` vão para `error` e toasts.
- **`removeDocument(id)`:** `DELETE .../documents/:id`, atualiza `state`.
- **`reset()`:** `DELETE .../lean-inception`, depois `refresh()` (que retorna estado vazio recriado).
- **`refresh()`:** `GET` novamente, atualiza `state`.

### Tratamento de erro

Erros do daemon (códigos `LeanInceptionErrorCode`) são mapeados para mensagens i18n na UI. Validação local (formato de arquivo) acontece antes do fetch — toast imediato sem roundtrip.

## 6. Componentes

### `LeanInceptionCanvas.tsx`

Container raiz. Recebe `projectId`. Estado local:

```ts
const { state, isLoading, isMutating, error, ...actions } = useLeanInception(projectId);
const [detailCard, setDetailCard] = useState<LeanInceptionCard | null>(null);
const [dropActive, setDropActive] = useState(false);
const [docsPopoverOpen, setDocsPopoverOpen] = useState(false);
const [confirmingReset, setConfirmingReset] = useState(false);
```

Layout vertical: `<LeanInceptionToolbar>` no topo, `<LeanInceptionBoard>` ocupando o resto, `<LeanInceptionDetailDrawer>` overlay à direita quando `detailCard`.

### `LeanInceptionToolbar.tsx`

Props: `docCount`, `documents`, `isMutating`, `onAdd`, `onRefresh`, `onReset`, `onRemoveDoc`, `onZoomIn`, `onZoomOut`, `onZoomFit`, `popoverOpen`, `onPopoverToggle`.

Layout:
```
[+ Add document] [📄 Documents (N) ▾] [↻ Refresh] [⚠ Reset]
                                     [🔍-] [🔍+] [⤢ Fit]
```

Quando `popoverOpen`, renderiza `<LeanInceptionDocumentsList>` em popover ancorado ao botão Documents. Botões ficam `disabled` quando `isMutating`.

### `LeanInceptionBoard.tsx`

Props: `columns: Record<ColumnKey, ColumnSnapshot>`, `isMutating`, `onDropFiles`, `onCardClick`.

Estrutura:

```tsx
<div onDragEnter dragLeave drop>
  {dropActive && <DropOverlay />}
  <TransformWrapper minScale={0.3} maxScale={1.5} initialScale={1}
    panning={{ excluded: ['li-no-pan'] }}
    wheel={{ step: 0.1 }}
  >
    <TransformComponent>
      <div className="li-board-grid">
        {LEAN_INCEPTION_COLUMN_KEYS.map(key =>
          <LeanInceptionColumn key={key} columnKey={key} {...columns[key]} onCardClick={onCardClick} />
        )}
      </div>
    </TransformComponent>
  </TransformWrapper>
</div>
```

`li-no-pan` é aplicada a cards e elementos interativos para não disparar pan no drag.

### `LeanInceptionColumn.tsx`

Props: `columnKey`, `status`, `cards`, `onCardClick`.

Header: ícone + label i18n + status pill (color-coded) + contador. Largura fixa ~280px, scroll vertical interno se cards > altura disponível.

### `LeanInceptionCard.tsx`

Props: `card`, `onClick`.

Compact view (read-only):

```
┌──────────────────────────────────┐
│ ● Title da extração (até 2 lns)  │  ← confidence dot + title
│                                  │
│ filename.md · L42                │  ← meta linha pequena
└──────────────────────────────────┘
```

`className="li-card li-no-pan"`. Click abre drawer.

### `LeanInceptionDetailDrawer.tsx`

Props: `card`, `onClose`.

Slide-in da direita, 400px wide. Animação 200ms enter / 140ms exit (conforme UI animation philosophy do AGENTS.md). Fecha por X, ESC, click fora.

Conteúdo:
- Header: title + confidence badge + filename
- Body: content (descrição expandida) + `source_anchor` em blockquote citada + "Line {source_line}" + nome do doc
- Footer: link para "Open document" (futuro — placeholder no MVP, abre nada ou mostra path)

### `LeanInceptionDocumentsList.tsx`

Popover content. Lista todos os docs:

```
documents (3)
─────────────────────────
✓ discovery-notes.md   3 cards   ✕
✓ requirements.md      5 cards   ✕
⚠ broken.md (failed)   0 cards   ✕
```

Click no `✕` chama `onRemoveDoc(id)`. Status icons: ✓ extracted / ⏳ extracting (spinner) / ⚠ failed.

### `LeanInceptionDropOverlay.tsx`

Renderiza quando `dropActive`. Cobre o board com fundo translúcido + borda dashed + texto centralizado: "Drop .md or .txt files to extract".

### `LeanInceptionEmptyState.tsx`

Renderiza centralizado sobre o board quando `state.documents.length === 0`. Conteúdo: ícone grande + "No documents yet" + "Drag and drop .md/.txt or click Add document" + botão primary que dispara `onAdd`.

## 7. Visual tokens

### Status por coluna

| Status | Tailwind class | Label key |
|---|---|---|
| `complete` | `text-green-500` | `lean_inception.status.complete` |
| `partial` | `text-amber-500` | `lean_inception.status.partial` |
| `insufficient` | `text-orange-500` | `lean_inception.status.insufficient` |
| `not_identified` | `text-neutral-400` | `lean_inception.status.not_identified` |

### Confidence dot

| Confidence | Color |
|---|---|
| `high` | `bg-green-500` |
| `medium` | `bg-amber-500` |
| `low` | `bg-neutral-400` |

### Animações

Respeitam UI animation philosophy do AGENTS.md:
- Drawer enter: 200ms `cubic-bezier(0.23, 1, 0.32, 1)`
- Drawer exit: 140ms
- DropOverlay fade: 200ms enter / 140ms exit
- Popover enter: 200ms / exit: 140ms
- Modal de confirm Reset: 200ms / 140ms

## 8. i18n

Novas keys em `apps/web/src/i18n/types.ts` e em TODOS os 18 locales (`apps/web/src/i18n/locales/*.ts`):

```
lean_inception.tab.title = "Lean Inception"

lean_inception.column.vision               = "Vision"
lean_inception.column.objective            = "Objective"
lean_inception.column.problem              = "Problem"
lean_inception.column.personas             = "Personas"
lean_inception.column.features             = "Features"
lean_inception.column.business_rules       = "Business rules"
lean_inception.column.acceptance_criteria  = "Acceptance criteria"

lean_inception.status.complete             = "Complete"
lean_inception.status.partial              = "Partial"
lean_inception.status.insufficient         = "Insufficient"
lean_inception.status.not_identified       = "Not identified"

lean_inception.toolbar.add_document        = "Add document"
lean_inception.toolbar.documents           = "Documents"
lean_inception.toolbar.refresh             = "Refresh"
lean_inception.toolbar.reset               = "Reset"
lean_inception.toolbar.zoom_in             = "Zoom in"
lean_inception.toolbar.zoom_out            = "Zoom out"
lean_inception.toolbar.zoom_fit            = "Fit"

lean_inception.empty.title                 = "No documents yet"
lean_inception.empty.description           = "Drag and drop .md or .txt files, or click Add document."

lean_inception.drop.title                  = "Drop .md or .txt files to extract"

lean_inception.detail.source               = "Source"
lean_inception.detail.line                 = "Line {line}"

lean_inception.confirm.reset.title         = "Reset Lean Inception?"
lean_inception.confirm.reset.description   = "This deletes all documents and cards. Cannot be undone."
lean_inception.confirm.reset.confirm       = "Reset"
lean_inception.confirm.reset.cancel        = "Cancel"

lean_inception.error.unsupported_format    = "Only .md and .txt are supported."
lean_inception.error.document_too_large    = "Document exceeds the size limit."
lean_inception.error.daemon_unreachable    = "Daemon is unreachable. Is it running?"
lean_inception.error.extraction_failed     = "Extraction failed: {message}"
lean_inception.error.document_not_found    = "Document not found."
lean_inception.error.generic               = "An error occurred: {message}"
```

Tradução inicial em inglês; outros locales reusam a string em inglês com TODO de tradução proper (consistente com como features novas entram hoje no app).

## 9. Edge cases

| Caso | Tratamento |
|---|---|
| Project sem inception (1º fetch) | Daemon auto-cria. Canvas mostra 7 colunas + empty state CTA. |
| Upload > 500KB | Toast com `error.message` do daemon; doc não persiste. |
| Tipo não suportado (PDF) | Validação local: toast `unsupported_format`. Sem roundtrip. |
| Drop de pasta | Filtra recursivamente `.md`/`.txt`; ignora resto silenciosamente. |
| Doc `extraction_status='failed'` | Não aparece no board; aparece em Documents popover com badge "failed". |
| Doc `extraction_status='extracting'` | Spinner no Documents popover; só atualiza após refresh manual no MVP. |
| Daemon offline (fetch falha) | Estado de erro: mensagem `daemon_unreachable` + botão Retry. |
| Pan/zoom + drag-drop conflito | `panning.excluded: ['li-no-pan']` evita pan sobre cards e drop zone. |
| Drawer aberto + remove do doc do card | Drawer detecta `detailCard.document_id` removido → fecha automaticamente. |
| Zoom muito baixo (cards ilegíveis) | minScale=0.3 evita texto irreproducível; acima disso usuário aceita. |

## 10. Testes

### Unit (Vitest + @testing-library/react)

`apps/web/tests/lean-inception/`:

- `useLeanInception.test.tsx` — fetch on mount, extract, removeDocument, reset, refresh, error paths. Mock global `fetch`.
- `LeanInceptionColumn.test.tsx` — render com cards, sem cards, statuses diferentes; click handler dispara.
- `LeanInceptionCard.test.tsx` — render com confidence dot certo; click handler; truncate de title.
- `LeanInceptionDetailDrawer.test.tsx` — open/close via prop, ESC, click-fora; conteúdo renderiza `source_anchor` literal.
- `LeanInceptionToolbar.test.tsx` — botões `disabled` durante `isMutating`; popover Documents abre/fecha; click em zoom controls dispara handler.
- `LeanInceptionEmptyState.test.tsx` — render quando `documents.length === 0`; click no CTA dispara `onAdd`.
- `LeanInceptionDropOverlay.test.tsx` — render só quando `dropActive`.

### E2E (deferido, sob `OD_E2E_FULL=1`)

`e2e/tests/lean-inception/canvas.spec.ts`:
- Cria project, abre aba Lean Inception, vê empty state.
- Clica Add document, sobe `.md` real, aguarda cards aparecerem (com mock de runtime ou real LLM).
- Click num card, drawer abre com source_anchor.
- Remove doc pela toolbar, board volta para vazio.

Não bloqueia PR normal — opt-in.

### Comandos de validação

```bash
pnpm guard
pnpm typecheck
pnpm --filter @open-design/web test
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/contracts typecheck
```

## 11. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| `react-zoom-pan-pinch` conflita com cliques nos cards | Média | Médio (UX quebrado) | `panning.excluded: ['li-no-pan']` testado em desenvolvimento; testes manuais antes de fechar PR |
| Drag-drop não funciona dentro de `TransformWrapper` | Média | Alto (feature core) | Drag-drop handlers ficam no wrapper DIV externo ao TransformWrapper; teste manual |
| Schema do `LeanInceptionState['columns']` é `Partial<Record<...>>` no contract; UI assume tudo populado | Baixa | Médio (runtime errors) | Hook normaliza: garante todas as 7 chaves presentes antes de expor `state`; teste cobre |
| i18n keys faltando em algum locale quebra typecheck | Alta no dev | Baixo | Adicionar a todos os 18 locales no mesmo commit; CI typecheck pega cedo |
| `react-zoom-pan-pinch` adiciona peso de bundle | Baixa | Baixo | Bibliotec ~7KB gzip; aceitável |
| Drag-drop sobre o iframe de outras tabs (FileViewer) | Baixa | Baixo | A aba Lean Inception é o único viewer ativo quando selecionada |

## 12. Open questions

- **Locales não-EN no MVP:** Decidir se outros 17 locales recebem traduções proper ou reusam EN com TODO. Recomendação: reusar EN inicialmente, abrir issue para tradução.
- **Detalhe do drawer — "Open document" link:** Placeholder no MVP; futuro abre o doc original no FileViewer. Decidir se já wiring o link com noop ou esconde no MVP.
- **Toast system:** Verificar se o app já tem um toast/notification system para reusar. Se não, criar mínimo em `components/lean-inception/Toast.tsx`.

## 13. Próximos sub-projetos (preview)

1. **Demais 11 colunas** — estender o `column_key` enum + prompts + recalibrar limiares.
2. **Scoring de maturidade** — área Discovery/UX/UI/FE/BE/QA derivado de status das colunas.
3. **Alertas contextuais** — regras textuais com mensagens i18n.
4. **Formatos adicionais** — pipeline de conversão PDF/DOCX → MD intermediário.
5. **Live updates** — SSE para refletir extrações em curso sem refresh manual.
6. **Minimap** — quando colunas crescerem para 18.
7. **Versionamento profundo** — snapshots históricos navegáveis.

---

**Próximo passo após aprovação:** invocar `superpowers:writing-plans` para gerar o plano de implementação.
