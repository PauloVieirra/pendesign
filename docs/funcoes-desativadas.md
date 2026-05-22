# Funções desativadas

Registro das funcionalidades do produto que foram desativadas da interface do
usuário, mas cujo código permanece presente no repositório. Cobre também as
mudanças de fluxo (substituição de abas por wizard de steps) e a adição de
funcionalidades novas que pertencem a esse mesmo módulo.

> Princípio adotado: **esconder, não remover.** A lógica (estados, props,
> rotas, contratos, testes unitários) é preservada para que a reativação seja
> uma alteração de UI, não uma reescrita.

## Modal "Novo projeto" — wizard de steps (substitui abas)

- **Arquivo:** `apps/web/src/components/NewProjectPanel.tsx`
- **Data:** 2026-05-22
- **Responsável:** paulo.junior@seatecnologia.com.br

### Fluxo atual (steps)

| Step | Conteúdo                | `CreateTab` interno | Obrigatório? |
| ---- | ----------------------- | ------------------- | ------------ |
| 1    | Configurar protótipo    | `prototype`         | Sim          |
| 2    | Importar do Figma       | `figma`             | Não (pula)   |
| 3    | Documentação do projeto | —                   | Não (pula)   |

- O wizard é controlado pelo state `step: 1 | 2 | 3` em `NewProjectPanel`.
- `tab` continua existindo como state derivado (`step 1 → 'prototype'`,
  `step 2 → 'figma'`), mantendo o contrato de `buildMetadata`,
  `skillIdForTab`, `handleCreate` e `handleCreateFigma` inalterado.
- A navegação fica em `WizardFooter` com botões **Voltar / Avançar / Salvar**.
- `resolveInitialTab()` faz o fallback silencioso de qualquer
  `initialTab` requisitada por callers externos para `'prototype'`.

### Abas desativadas (escondidas da UI; código preservado)

| Aba             | `CreateTab` id   | i18n                      | Status do código |
| --------------- | ---------------- | ------------------------- | ---------------- |
| Live artifact   | `live-artifact`  | `newproj.tabLiveArtifact` | Preservado       |
| Slide deck      | `deck`           | `newproj.tabDeck`         | Preservado       |
| From template   | `template`       | `newproj.tabTemplate`     | Preservado       |
| Media           | `media`          | `newproj.tabMedia`        | Preservado       |
| Other           | `other`          | `newproj.tabOther`        | Preservado       |

Constante de controle: `VISIBLE_TABS = ['prototype', 'figma']`. Toda a
lógica downstream (sub-componentes `PlatformPicker`, `SurfaceOptions`,
`FidelityPicker`, `ConnectorsSection`, `TemplatePicker`,
`PromptTemplatePicker`, `MediaProjectOptions`) está intacta.

### Como reativar uma aba

1. Adicionar o id ao array `VISIBLE_TABS` em `NewProjectPanel.tsx`.
2. Decidir se vira um novo step (mudar o stepper para N steps) ou se
   compartilha um step existente (ex.: re-introduzir um seletor interno
   no Step 1).
3. Reabilitar/ajustar os testes e2e Playwright em
   `e2e/ui/project-management-flows.test.ts` e
   `e2e/ui/entry-configuration-flows.test.ts` que ainda referenciam
   `new-project-tab-live-artifact`, `-deck` e `-media` — esses testes
   passarão a falhar até serem ajustados.

## Step 3 — Documentação do projeto (RAG por projeto)

Novo step do wizard. Aceita upload de arquivos `.md` e `.txt` que são
ingeridos no RAG isolado por projeto.

### Armazenamento

- **Tabela SQLite:** `project_docs` (criada via migration em
  `apps/daemon/src/db.ts`).
- **Colunas:** `id, project_id, doc_id, doc_name, chunk_idx, content,
  embedding_json, embedding_model, created_at`.
- **Isolamento:** `FOREIGN KEY(project_id) REFERENCES projects(id) ON
  DELETE CASCADE` + índice composto `(project_id, doc_id, chunk_idx)`.
  **TODA** query (insert, list, search, delete) é filtrada por
  `project_id` no SQL — garantia no nível do banco, não da aplicação.
- **Arquivos brutos:** _não_ são materializados em disco. O conteúdo
  vive apenas no SQLite. Para auditoria, a Step 3 sempre exibe os docs
  anexados antes de salvar; após a criação, há um endpoint GET de
  consulta (ver "API" abaixo).

### Embeddings (Voyage AI)

- **Provedor:** Voyage AI, modelo `voyage-3-lite` (1024 dims).
- **Configuração:** variável de ambiente `VOYAGE_API_KEY`. Quando ausente,
  os chunks são gravados sem embedding e a busca degrada para overlap
  lexical (algoritmo em `apps/daemon/src/rag.ts:rankByLexical`). O Step 3
  continua usável e nada quebra; só perde qualidade.
- **Endpoint:** `https://api.voyageai.com/v1/embeddings`.
- **Chunking:** 600 chars por chunk com overlap de 80 chars; preferência
  por quebra de linha ou ponto final próximo ao limite.

### Retrieval (auto-injeção no system prompt)

- Ponto de injeção: `composeSystemPrompt` em `apps/daemon/src/prompts/system.ts`,
  novo campo opcional `projectDocsRagSection`.
- Caller: `composeDaemonSystemPrompt` em `apps/daemon/src/server.ts` carrega
  todos os chunks do projeto via `loadAllProjectDocChunks(db, projectId)`,
  trunca por um budget de **12.000 caracteres** (~3k tokens) e formata
  com `formatRagSection` antes de concatenar ao prompt.
- A escolha foi por **auto-injeção** (não busca semântica por turno), pois
  a infra atual chama `composeSystemPrompt` apenas uma vez por run. Quando
  os docs do projeto excederem 12k chars, a função `searchProjectDocs(db,
  projectId, query, topK)` em `rag.ts` está pronta para uso por um hook
  futuro que dispare retrieval por turno.

### API

- `POST /api/projects` — agora aceita campo opcional `docs: Array<{ name,
  content }>` no body. A ingestão acontece atomicamente após o insert do
  projeto. A resposta retorna `docsResult.ingested[]` e `docsResult.failed[]`.
- `POST /api/projects/:id/docs` — adicionar docs a um projeto existente.
- `GET /api/projects/:id/docs` — lista os docs do projeto (nome + número
  de chunks).
- `DELETE /api/projects/:id/docs/:docId` — remove todos os chunks de um
  doc.

### Tipos de input

- **Aceitos:** `.md`, `.markdown`, `.txt`.
- **Desativados (backlog):**
  - PDF / DOCX — requer dependência adicional no daemon (`pdf-parse`,
    `mammoth`). Status: não implementado.
  - URL externa — requer fetch server-side com validação de SSRF.
    Status: não implementado.
- **Limite por upload:** múltiplos arquivos via `<input type="file" multiple>`.
  Tamanho não limitado pelo cliente; o daemon aceita até o limite
  padrão do Express body parser.

## Histórico

| Data       | Mudança                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-22 | Criação do documento; ocultadas as abas Live artifact, Slide deck, From template, Media, Other no modal de Novo projeto.                            |
| 2026-05-22 | Tabs (Prototype, From Figma) substituídas por wizard de 3 steps; novo Step 3 de Documentação com RAG Voyage AI isolado por projeto (`project_docs`). |
