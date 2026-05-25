# Lean Inception — Extraction Pipeline (Sub-projeto 1 / N)

- **Status:** Design aprovado, aguardando plano de implementação
- **Autor:** Brainstorming colaborativo (Paulo Junior + Claude)
- **Data:** 2026-05-25
- **Sub-projeto:** Pipeline de extração CLI-first (sem UI)
- **Próximo sub-projeto previsto:** Canvas read-only consumindo os contratos definidos aqui

---

## 1. Contexto

Foi solicitada a funcionalidade **Gerador Inteligente de Lean Inception**: um sistema que recebe documentação de projeto, extrai automaticamente informações estratégicas, organiza num board visual com 18 colunas, calcula maturidade por área (Discovery/UX/UI/FE/BE/QA) e gera alertas/diagnósticos. O usuário **não pode** editar manualmente — toda informação deriva exclusivamente dos documentos enviados ("documentação é a fonte da verdade").

A spec original cobre múltiplos subsistemas independentes (ingestão, NLP, canvas, scoring, alertas, versionamento, auditoria). Foi decidido em brainstorming que tentar projetar tudo em uma única spec produziria um documento vago. O escopo foi decomposto em sub-projetos sequenciais; este documento cobre **apenas o primeiro**: pipeline de extração CLI-first.

## 2. Decisão sobre fatia inicial

Foram avaliadas três fatias iniciais:

- **A.** Fatia vertical fina ponta-a-ponta (upload + extração rasa + canvas mínimo)
- **B.** Modelo de dados + canvas shell com dados mockados
- **C.** Pipeline de extração CLI-first, sem UI

**Escolhida: C.** Justificativa:

- O maior risco do produto inteiro é "a IA consegue extrair Lean Inception útil de docs reais?". Resposta negativa muda tudo. Melhor descobrir em 2-3 semanas.
- Open Design já orquestra agentes (Claude, Codex, etc.) — reaproveitamos runtimes existentes como motor.
- O JSON de saída vira o **contrato real** em `packages/contracts`, contra o qual a UI futura será desenhada (sem mocks que divergem).
- Casa exatamente com a regra UI/CLI dual-track do `AGENTS.md`.

## 3. Decisões fundamentais (registradas)

| Decisão | Escolha | Por quê |
|---|---|---|
| Onde vive | Feature dentro do Open Design (pendesign) | Reaproveita daemon, contracts, CLI infra |
| Motor de extração | Reuso de runtime de agente existente (default `claude`) | Sem nova chave de API; aproveita stream-json, prompt budget, detecção |
| Colunas no MVP | 7 (vision, objective, problem, personas, features, business_rules, acceptance_criteria) | Mais comuns em docs reais; permite calibrar prompt em algo mensurável |
| Formatos no MVP | Markdown + TXT apenas | Zero overhead de parsing; foco em qualidade da extração |
| Persistência | SQLite, 1 Lean Inception por OD project (1:1) | Reaproveita conceito de project do OD; cascade simples |
| Atribuição de fonte | Por card: `doc_id` + `source_anchor` literal + `source_line` (quando MD) | Princípio "fonte da verdade" exige rastreabilidade |
| Multi-doc | Suportado desde o MVP, sem dedup | Casos reais sempre têm múltiplos docs |
| Qualidade/Confiança | Per-card `{low,medium,high}` + per-column `{complete,partial,insufficient,not_identified}` | Contrato preparado para scoring sub-projeto futuro |

## 4. Escopo

### In scope (este sub-projeto)

- Comando `od lean-inception` com subcomandos `extract`, `status`, `list`, `remove-doc`, `reset`.
- Endpoints HTTP no daemon (`/api/projects/:id/lean-inception/*`).
- Tabelas SQLite e migrations.
- Contracts compartilhados em `packages/contracts/src/api/lean-inception.ts`.
- Prompt system + user para extração estruturada.
- Validação dupla (Zod + verificação de anchor).
- Status de coluna derivado on-read.
- Testes unitários, de integração HTTP e golden fixtures.

### Out of scope (sub-projetos futuros)

- **Canvas / UI web.** Nenhum componente em `apps/web` neste sub-projeto.
- **Demais 11 colunas** (jornada, integrações, dependências, MVP, é/não é, métricas, riscos, backlog, priorizações, hipóteses, requisitos técnicos, requisitos não funcionais).
- **Formatos além de MD/TXT** (PDF, DOCX, XLSX, CSV, JSON, imagens/OCR).
- **Scoring de maturidade por área** (Discovery/UX/UI/FE/BE/QA).
- **Alertas contextuais por coluna.**
- **Versionamento profundo** (snapshots históricos navegáveis). MVP só tem audit log de extrações.
- **Dedup / clusterização de cards similares entre docs.**
- **Chunking de docs grandes** (> 500KB são rejeitados no MVP).
- **Reprocessamento em batch** (re-rodar todos os docs com prompt novo).
- **Acesso multi-usuário concorrente.** Daemon é singleton local-first.

## 5. Arquitetura

```
                   ┌─────────────────────────────────────────────┐
                   │                  od CLI                     │
                   │  od lean-inception extract <doc...>         │
                   │  od lean-inception status <project-id>      │
                   │  od lean-inception remove-doc <doc-id>      │
                   └──────────────┬──────────────────────────────┘
                                  │ HTTP (fetch)
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                       apps/daemon                            │
   │                                                              │
   │   POST   /api/projects/:id/lean-inception/documents          │
   │   GET    /api/projects/:id/lean-inception                    │
   │   GET    /api/projects/:id/lean-inception/documents          │
   │   DELETE /api/projects/:id/lean-inception/documents/:docId   │
   │   DELETE /api/projects/:id/lean-inception                    │
   │                                                              │
   │   ┌────────────────────────────────────────────────────┐     │
   │   │  Extraction service                                │     │
   │   │  1. ingest doc → store under .od/projects/<id>/    │     │
   │   │     lean-inception/docs/<doc-id>.<ext>             │     │
   │   │  2. spawn agent runtime (claude default)           │     │
   │   │     with structured extraction prompt              │     │
   │   │  3. parse JSON output                              │     │
   │   │  4. validate (Zod + anchor verification)           │     │
   │   │  5. persist to SQLite (transaction)                │     │
   │   │  6. column status derived on-read                  │     │
   │   └────────────────────────────────────────────────────┘     │
   └──────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │  .od/app.sqlite         │
                    │  + .od/projects/<id>/   │
                    │     lean-inception/     │
                    │       docs/<doc-id>.md  │
                    └─────────────────────────┘
```

### Princípios arquiteturais

- **CLI primeiro, daemon HTTP único source of truth.** UI futura consome os mesmos endpoints.
- **Contracts em `packages/contracts`** — DTOs Zod compartilhados, zero acoplamento.
- **Documento = unidade atômica de proveniência.** Cards são sempre filhos de exatamente 1 doc. Reprocessar 1 doc só afeta cards daquele doc.
- **Status de coluna é derivado, nunca persistido.** Função determinística dos cards vivos.
- **Sem dedup, sem clusterização.** Cards de docs diferentes coexistem com sources independentes.

## 6. Data model

### SQLite

```sql
CREATE TABLE lean_inceptions (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE lean_inception_documents (
  id                  TEXT PRIMARY KEY,
  inception_id        TEXT NOT NULL REFERENCES lean_inceptions(id) ON DELETE CASCADE,
  filename            TEXT NOT NULL,
  mime_type           TEXT NOT NULL,         -- text/markdown | text/plain
  byte_size           INTEGER NOT NULL,
  content_hash        TEXT NOT NULL,         -- sha256
  storage_path        TEXT NOT NULL,         -- relativo a .od/
  ingested_at         TEXT NOT NULL,
  last_extracted_at   TEXT,
  extraction_status   TEXT NOT NULL,         -- pending | extracting | extracted | failed
  extraction_error    TEXT
);

CREATE INDEX idx_lid_inception ON lean_inception_documents(inception_id);
CREATE UNIQUE INDEX idx_lid_hash ON lean_inception_documents(inception_id, content_hash);

CREATE TABLE lean_inception_cards (
  id              TEXT PRIMARY KEY,
  inception_id    TEXT NOT NULL REFERENCES lean_inceptions(id) ON DELETE CASCADE,
  document_id     TEXT NOT NULL REFERENCES lean_inception_documents(id) ON DELETE CASCADE,
  column_key      TEXT NOT NULL,             -- enum de 7 valores
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  confidence      TEXT NOT NULL,             -- low | medium | high
  source_anchor   TEXT NOT NULL,             -- trecho literal do doc, ≤ 280 chars
  source_line     INTEGER,                   -- null para .txt
  extraction_id   TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_lic_doc ON lean_inception_cards(document_id);
CREATE INDEX idx_lic_inception_col ON lean_inception_cards(inception_id, column_key);

CREATE TABLE lean_inception_extractions (
  id                TEXT PRIMARY KEY,
  inception_id      TEXT NOT NULL REFERENCES lean_inceptions(id) ON DELETE CASCADE,
  document_id       TEXT NOT NULL REFERENCES lean_inception_documents(id) ON DELETE CASCADE,
  runtime           TEXT NOT NULL,
  model             TEXT,
  prompt_version    INTEGER NOT NULL,
  prompt_tokens     INTEGER,
  output_tokens     INTEGER,
  duration_ms       INTEGER,
  warnings_count    INTEGER NOT NULL DEFAULT 0,
  cards_persisted   INTEGER NOT NULL DEFAULT 0,
  cards_dropped     INTEGER NOT NULL DEFAULT 0,
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  status            TEXT NOT NULL,           -- running | succeeded | failed
  error_message     TEXT
);
```

### Decisões de schema explícitas

- **`content_hash` UNIQUE por inception:** re-upload do mesmo arquivo é idempotente.
- **`ON DELETE CASCADE` em tudo:** zero órfãos.
- **Status de coluna NÃO está no schema.** Calculado on-read.
- **`extraction_id` em cards:** rastreia qual rodada produziu cada card.
- **`column_key` é enum textual.** Constantes de código no MVP; vira tabela quando colunas forem configuráveis.
- **`prompt_version`:** permite re-rodar docs antigos com prompt novo sem perder histórico.

### Derivação de status de coluna (determinística)

```ts
function deriveColumnStatus(cards: Card[]): ColumnStatus {
  if (cards.length === 0) return 'not_identified';
  const high   = cards.filter(c => c.confidence === 'high').length;
  const medium = cards.filter(c => c.confidence === 'medium').length;
  const low    = cards.length - high - medium;
  const score  = high * 1.0 + medium * 0.6 + low * 0.3;
  if (score >= 3.0) return 'complete';
  if (score >= 1.5) return 'partial';
  return 'insufficient';
}
```

Limiares são chutes razoáveis. Vão ser calibrados em testes contra docs reais e refinados em sub-projetos seguintes.

### Contracts em `packages/contracts`

Arquivo: `packages/contracts/src/api/lean-inception.ts`

Exports:

- `LEAN_INCEPTION_COLUMN_KEYS` (const array de 7 strings)
- `LeanInceptionColumnKey` (union type)
- `LeanInceptionCard` (DTO de leitura, Zod schema + tipo)
- `LeanInceptionDocument` (DTO de leitura)
- `LeanInceptionColumnStatus` (`'complete' | 'partial' | 'insufficient' | 'not_identified'`)
- `LeanInceptionState` (snapshot: `inception_id`, `project_id`, `documents[]`, `columns: Record<ColumnKey, { status, cards[] }>`, `extraction?`)
- `ExtractDocumentsRequest` / `ExtractDocumentsResponse`
- `RemoveDocumentResponse`
- `LeanInceptionErrorCode` (union de codes — ver Seção 10) + `LeanInceptionError` schema

Conforme regra do `AGENTS.md`: pure TypeScript, sem dependências de Next.js, Express, fs, SQLite, daemon internals, browser APIs.

## 7. CLI

Registro em `apps/daemon/src/cli.ts` via `SUBCOMMAND_MAP`. Implementação em `apps/daemon/src/lean-inception-cli.ts`.

### Comandos

```bash
od lean-inception extract <doc-path...> [--project <id>] [--runtime <name>] [--json] [--quiet]
od lean-inception status [--project <id>] [--json]
od lean-inception list [--project <id>] [--json]
od lean-inception remove-doc <doc-id> [--project <id>] [--json] [--yes]
od lean-inception reset [--project <id>] [--yes] [--json]
```

### Resolução de `--project`

1. `--project <id>` explícito vence.
2. Senão, `OD_PROJECT_ID` env var.
3. Senão, `cwd-aliases.ts` (já existente no daemon).
4. Senão, erra com `no project resolved; pass --project <id> or set OD_PROJECT_ID` (exit 3).

### Flags do `extract`

| Flag | Tipo | Default | Descrição |
|---|---|---|---|
| `--project <id>` | string | autodetect | OD project id |
| `--runtime <name>` | string | autodetect | `claude`, `codex`, etc. |
| `--json` | bool | false | Stdout JSON puro |
| `--quiet` | bool | false | Sem progresso textual |
| `--help` / `-h` | bool | — | Uso |

### Saída padrão (não-`--json`)

```
↳ doc1.md ......... extracting ... 7 cards (2.3s)
↳ doc2.md ......... extracting ... 4 cards (1.9s)
↳ Lean Inception status:
    vision              complete    (1 high)
    personas            partial     (2 medium)
    business_rules      insufficient (1 low)
    acceptance_criteria not_identified
```

### Saída `--json`

Snapshot completo `LeanInceptionState`, sem texto adicional.

### Exit codes

| Code | Significado |
|---|---|
| 0 | Sucesso |
| 1 | Erro genérico |
| 2 | Erro de uso (flag inválida) |
| 3 | Project não resolvido |
| 4 | Runtime não disponível |
| 5 | Documento não suportado |

## 8. Estratégia de prompting

### Forma

Dois blocos: **system prompt** (constante versionada) + **user prompt** (dinâmico).

### System prompt V1 (resumo)

```
Você é um analista de requisitos especializado em Lean Inception.
Sua única tarefa é EXTRAIR informações de um documento e classificá-las
em colunas pré-definidas.

REGRAS ABSOLUTAS:

1. NUNCA invente informação. Se algo não está no documento, NÃO inclua.
2. Cada card DEVE conter source_anchor: um trecho LITERAL do documento
   (até 280 caracteres) que justifique a extração. Não parafraseie.
3. Output DEVE ser JSON válido conforme o schema. Nada antes ou depois.
4. Se uma coluna não tem dados, retorne array vazio.
5. confidence reflete sua certeza:
   - "high": explícita, completa, sem ambiguidade
   - "medium": clara mas incompleta, OU implícita mas inequívoca
   - "low": fortemente inferida, ou mencionada de passagem

COLUNAS:

vision:               declaração de visão / propósito macro
objective:            objetivos de negócio mensuráveis
problem:              problema/dor que o produto resolve
personas:             tipos de usuário (papel + contexto + motivação)
features:             funcionalidades concretas
business_rules:       regras, validações, restrições
acceptance_criteria:  critérios objetivos de aceite

OUTPUT SCHEMA:
{
  "cards": [
    {
      "column_key": "<um dos 7>",
      "title": "<5-80 chars>",
      "content": "<descrição expandida, 1-3 frases>",
      "confidence": "<high|medium|low>",
      "source_anchor": "<trecho literal do documento>",
      "source_line": <número da linha, ou null>
    }
  ]
}
```

O texto completo do prompt V1 será committado em `apps/daemon/src/lean-inception/prompts/v1.ts` durante a implementação.

### User prompt

```
DOCUMENTO (filename: <name>, format: <md|txt>):
---
<conteúdo, prefixado com "L<n>: " por linha quando MD>
---

Extraia os cards conforme as regras do system prompt e retorne APENAS
o JSON do schema.
```

### Numeração explícita de linhas

Para `.md`, prefixar cada linha com `L<n>: ` antes de injetar no prompt. Sem isso, `source_line` vira chute do LLM. Para `.txt`, `source_line` sempre `null`.

### Invocação

```ts
await execAgentRuntime({
  runtime: 'claude',
  systemPrompt: LEAN_INCEPTION_SYSTEM_PROMPT_V1,
  userPrompt: buildUserPrompt(doc),
  outputFormat: 'json',
  timeout_ms: 120_000,
});
```

Para Claude, `--output-format json` evita stream-json overhead. Para runtimes sem JSON output direto, fallback de parse via primeiro bloco ` ```json ... ``` ` ou primeiro `{` até último `}`.

### Validação pós-extração

Após receber JSON do agente, antes de persistir:

1. **Schema validation** via Zod. JSON inválido → status `failed`, erro no extraction log.
2. **Anchor verification:** `source_anchor` (normalizado: lowercase, whitespace colapsado) deve aparecer no doc original. Cards com anchor inválido são DROPADOS silenciosamente (contador agregado em `warnings_count`).
3. **Column key whitelist:** rejeita fora dos 7 válidos.
4. **Tamanhos:** trunca `source_anchor` em 280 chars; rejeita `title` fora de 5-120 chars.
5. **Contagem:** doc com 0 cards após validação → `extraction_status='extracted'` mesmo assim, sem erro.

### Token budget

- < 100KB: single-shot.
- 100KB-500KB: single-shot com warning.
- > 500KB: rejeita com `DOCUMENT_TOO_LARGE`. Chunking deferido.

### Sem streaming no MVP

Validação precisa do JSON completo. Persistência atômica por transação. Streaming entra quando UI vier.

## 9. Semântica de reprocessamento

| Operação | Comportamento |
|---|---|
| Adicionar doc novo | Insert. Spawn extração. Cards appended. Outros docs não tocados. |
| Re-upload do mesmo (`content_hash` igual) | No-op idempotente. Retorna `document_id` existente. |
| Re-upload com conteúdo alterado (mesmo filename, hash diferente) | `remove-doc <old-id>` + `add doc`. Cascade limpa cards antigos. |
| `remove-doc <id>` | Delete em `documents`. Cards somem via cascade. Statuses re-derivados on-read. |
| `reset` | Delete em `lean_inceptions`. Cascade limpa tudo. |
| Extração falha no meio | Doc fica `extraction_status='failed'`. Cards de outros docs intactos. Re-upload com novo hash refaz. |

**Invariantes:**

- Card sempre tem doc vivo (cascade).
- Status de coluna é função apenas dos cards atualmente vivos.
- Operação por doc é transação SQLite atômica (insert da extraction + dos cards juntos).

## 10. Erros e edge cases

### Erros tipados

```ts
type LeanInceptionErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'DOCUMENT_TOO_LARGE'
  | 'EMPTY_DOCUMENT'
  | 'PROJECT_NOT_FOUND'
  | 'RUNTIME_UNAVAILABLE'
  | 'EXTRACTION_TIMEOUT'
  | 'EXTRACTION_FAILED'
  | 'INVALID_JSON_OUTPUT'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'DOCUMENT_NOT_FOUND';
```

Cada erro carrega `code`, `message`, `details?` (objeto opcional).

### Edge cases

| Caso | Tratamento |
|---|---|
| Doc com 0 cards extraídos | Sucesso. `card_count=0`. Sem warning. |
| Anchors inválidos | Card DROPADO silenciosamente. Agregado em `warnings_count`. Log estruturado guarda anchor + título descartado. |
| Todas anchors inválidos | `extraction_status='extracted'` com 0 cards. |
| Texto antes/depois do JSON | Parser tenta bloco ` ```json ``` `, depois primeiro `{` até último `}`. Falha → `INVALID_JSON_OUTPUT`. |
| 2 `extract` simultâneos no mesmo project | Lock in-memory por `inception_id` no daemon. Segundo aguarda. |
| Project não existe | 404. CLI exit 3. |
| Inception não existe no primeiro `extract` | Auto-create na rota POST. Idempotente. |
| Doc binário com extensão `.md` | Detecta via decode UTF-8. Falha → `UNSUPPORTED_FORMAT`. |

### Logging

Reusa logger padrão do daemon:

- `lean_inception.extract.start { inception_id, document_id, runtime, model }`
- `lean_inception.extract.finish { document_id, status, cards_persisted, cards_dropped, duration_ms }`
- `lean_inception.extract.warning { document_id, reason }`

## 11. Estratégia de testes

### Unit (Vitest, em `apps/daemon/tests/lean-inception/`)

- `derive-column-status.test.ts` — função pura, casos cobertos.
- `validate-anchor.test.ts` — normalização, encontrado, não-encontrado, fuzzy near-miss.
- `parse-llm-output.test.ts` — JSON puro, em bloco de código, com texto antes/depois, inválido.
- `schema.test.ts` — Zod rejeita campos faltando, valores inválidos, tamanhos fora.
- `content-hash.test.ts` — mesmo conteúdo = mesmo hash; whitespace trailing conta.

### Integration (Vitest, daemon HTTP boundary)

Spawn daemon em porta de teste com SQLite temporário, exercita endpoints reais com runtime mockado (stub devolve JSON conhecido):

- POST com MD válido → cards persistidos → GET retorna estado.
- Re-upload mesmo doc → idempotente.
- Re-upload mesmo filename, conteúdo diferente → substitui.
- DELETE doc → cards somem, statuses re-derivados.
- DELETE inexistente → 404.
- Doc > 500KB → 400 com `DOCUMENT_TOO_LARGE`.

### Golden extraction (manual + semi-automatizado)

Em `apps/daemon/tests/lean-inception/fixtures/`:

- 5-7 MDs reais (discovery notes, BRD, ata de inception, etc.).
- Cada um com `expected.json` curado — **mínimo de cobertura por coluna**, não exato.
- Teste roda com LLM real sob `OD_E2E_LIVE_LLM=1`. Valida contagem por coluna ≥ mínimo + anchors batem.
- Não bloqueia PR normal. Nightly ou sob demanda.

### E2E

Deferido — não há UI no sub-projeto. Quando vier, entra em `e2e/tests/lean-inception/`.

### Bugs futuros

Conforme bug follow-up workflow do `AGENTS.md`: spec vermelho primeiro, antes do fix.

### Validação durante desenvolvimento

```bash
pnpm guard
pnpm typecheck
pnpm --filter @open-design/daemon test
pnpm --filter @open-design/contracts typecheck
OD_E2E_LIVE_LLM=1 pnpm --filter @open-design/daemon test golden  # opcional
```

## 12. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| LLM ignora regra de anchor literal e parafraseia | Alta | Médio (cards descartados, qualidade baixa) | Regra explícita + verificação obrigatória pós-extração. Cards inválidos descartados, agregado em warnings_count. |
| LLM extrai pouco com confidence inflada | Média | Alto (status de coluna inflado) | Testes com 5-10 docs reais antes de fechar V1 do prompt. Iterar prompt até estabilizar. Documentar goldens. |
| Schema do JSON muda quando UI/scoring entram | Média | Alto (retrabalho de contrato) | Contracts versionados; statuses de coluna derivados (não persistidos) já anteciparam necessidade futura. |
| Doc real > 500KB rejeitado frustra usuário | Baixa | Médio | Mensagem clara com tamanho atual + limite. Chunking entra em sub-projeto seguinte. |
| Runtime do agente não instalado | Média | Alto (extração falha) | Detecção via `runtimes/detection.ts` (já existente). Erro com instrução de instalação. |
| Mesma extração rodada 2x no mesmo doc com prompt V2 sobrescreve dados de V1 | Baixa | Baixo no MVP | Log de extrações guarda `prompt_version`. V1 e V2 podem coexistir como rodadas separadas; cards atuais refletem última. |
| Concorrência multi-processo no daemon | Muito baixa | Médio | Daemon é singleton local-first. Lock in-memory suficiente. Documentado como out-of-scope. |

## 13. Open questions (a resolver na implementação ou em iteração)

- Limiares exatos da `deriveColumnStatus` (3.0, 1.5) serão calibrados nos goldens. Pode mudar antes do release.
- Texto exato do prompt V1 — esqueleto está aqui; redação final entra na implementação e itera com docs reais.
- Como reportar warnings de anchor inválido para o usuário no output do CLI (não-`--json`): mostrar contagem? listar títulos descartados? Decidir na implementação ao ver o output real.
- Nome do runtime detectado fica em qual env var / config — alinhar com `runtimes/detection.ts` existente.

## 14. Próximos sub-projetos (preview, não fazem parte deste design)

Após este sub-projeto entregar:

1. **Canvas read-only (web UI)** — consome `LeanInceptionState` do contract. Renderiza 7 colunas com cards. Foca em virtualização, zoom/pan, minimap.
2. **Demais 11 colunas** — adicionar ao prompt e ao enum. Recalibrar limiares de status.
3. **Formatos adicionais** — pipeline de conversão (PDF/DOCX/XLSX → MD intermediário) antes do extractor.
4. **Scoring de maturidade por área** (Discovery/UX/UI/FE/BE/QA) — função agregadora sobre statuses + heurísticas adicionais.
5. **Alertas contextuais por coluna** — regras textuais a partir dos statuses.
6. **Versionamento profundo** — snapshots históricos navegáveis.
7. **Clusterização/dedup entre docs.**

Cada um vira sua própria spec → plano → implementação.

---

**Próximo passo após aprovação deste spec:** invocar `superpowers:writing-plans` para gerar o plano de implementação detalhado.
