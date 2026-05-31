# Importar projeto local como projeto nativo

Data: 2026-05-31

## Problema

Na tela de Projetos só é possível criar projetos do zero. A importação existente
(`POST /api/import/folder`) trabalha "in-place" sobre a pasta original (via
`metadata.baseDir`) e **não** cria design system nem as configurações padrão de
um projeto nativo. Falta um caminho para trazer uma pasta local para dentro do
sistema e tratá-la como um projeto nativo completo.

## Decisões alinhadas com o usuário

- **Armazenamento**: copiar os arquivos da pasta local para `.od/projects/<id>/`.
  O projeto fica 100% nativo e independente da pasta de origem (sem `baseDir`).
- **Seleção (web)**: drop zone (arrastar e soltar a pasta) + seletor de pasta
  (`<input webkitdirectory>`), funcionando inclusive no navegador.
- **Design system**: ao importar, criar o DS padrão com as variáveis-seed
  (números, booleanos, strings e cores) — igual a um projeto nativo criado sem
  escolher DS (`autoCreateDesignSystemForProject`).
- **Configs nativas**: row em `projects`, conversa inicial, plugin default por
  kind (`prototype`), tabs com arquivo de entrada detectado, e o DS acima.
- **Paridade UI/CLI**: incluir `od project import --path <pasta>`.

## Arquitetura (3 camadas)

1. **Contrato** (`packages/contracts/src/api/projects.ts`):
   `ImportLocalProjectRequest` (`{ id?, name?, files: Array<{ path; contentBase64 }> }`)
   e `ImportLocalProjectResponse` (`{ project; conversationId; entryFile; fileCount }`).
2. **Daemon** (`apps/daemon/src/import-export-routes.ts`):
   `POST /api/import/local` que cria o projeto nativo, escreve os arquivos em
   `.od/projects/<id>/` (filtrando dirs de build), detecta `entryFile`, seta tabs
   e chama `autoCreateDesignSystemForProject`.
3. **UI Web** (`apps/web`): botão "Importar projeto" no header de Projetos →
   modal com drop zone + picker; lê a pasta via `webkitGetAsEntry()`/`webkitdirectory`,
   monta a lista de arquivos e faz o POST; depois navega para o projeto.
4. **CLI** (`apps/daemon/src/cli.ts`): `od project import --path <pasta>`.

## Robustez

- **Ignore**: pular `node_modules`, `.git`, `dist`, `build`, `.next`, `.nuxt`,
  `.turbo`, `.cache`, `.output`, `out`, `coverage`, `.od`, `.tmp` etc. (reusa o
  `SKIP_DIRS` do daemon).
- **Limites**: máx. de arquivos e bytes totais com erro claro (`PAYLOAD_TOO_LARGE`).
- **Idempotência**: novo `id` por import; nunca sobrescreve projeto existente.
- **Segurança**: `writeProjectFile` já sanitiza paths e bloqueia traversal.

## Estratégia de validação (TDD)

Spec vermelho no boundary HTTP do daemon (e2e Vitest): `POST /api/import/local`
cria projeto nativo (sem `baseDir`), copia os arquivos para `.od/projects/<id>/`,
atribui um `designSystemId` (`user:*`) e detecta o `entryFile`. Implementar até
passar e então UI + CLI.
