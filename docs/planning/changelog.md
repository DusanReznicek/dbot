# DBot — Execution Plan (skutečný průběh implementace)

> Dokument zachycuje reálné kroky, které byly provedeny během implementace projektu DBot.
> Datum: 2026-03-26 – 2026-03-31

---

## Přípravná fáze

### Krok 1 — Projektová specifikace
- **Vstup:** Uživatel definoval požadavky v `docs/planning/specification.md`
  - Jeden řídící agent, 1–N pod-agentů, vrstva skillů/modulů
  - Komunikace mezi agenty pouze s povolením uživatele
  - Runtime v kontejnerech, Node.js + TypeScript
- **Výstup:** Hotový `docs/planning/specification.md`

### Krok 2 — Solution Design
- Vytvořen `docs/architecture/overview.md` (původně `solutiondesign.md`) — kompletní technický návrh:
  - Hub-and-spoke architektura (ASCII diagram)
  - Návrh 7 komponent (Master Agent, Sub-Agent framework, Skills, Message Bus, LLM, Channels, Permissions)
  - TypeScript rozhraní pro každou komponentu
  - Tech stack výběr s odůvodněním
  - Kontejnerová architektura (multi-stage Dockerfile, Docker Compose)
  - Bezpečnostní model (3 vrstvy)
  - Rozšiřitelnost (jak přidat agenta/skill/kanál/LLM provider)

### Krok 3 — WhatsApp integrace do designu
- Přidána sekce WhatsApp (Baileys) do solution designu:
  - `BaileysConnectionManager`, `AuthStateManager`, `MessageNormalizer`, `ResponseFormatter`
  - Mapování WA typů zpráv → `UserMessage`
  - Bezpečnostní opatření (allowlist, rate limiting, auth state persistence)

### Krok 4 — Implementační plán
- Vytvořen `docs/planning/implementation-plan.md` (původně `plan.md`):
  - 7 fází s konkrétními soubory a pořadím
  - Ověřovací kroky pro každou fázi
  - 7 milníků (M1–M7) s acceptance criteria
  - 45 unit testovacích scénářů, 12 integračních, 10 E2E
  - CI pipeline návrh

---

## Fáze 1 — Core Framework

**Datum:** 2026-03-27 | **Stav:** ✅ Kompletní

### Vytvořené soubory:
| Soubor | Popis |
|---|---|
| `package.json` | 15 dependencies, 8 devDependencies, scripts (dev, build, test, typecheck) |
| `tsconfig.json` | strict, ES2022, NodeNext module, path aliasy (@core, @channels, @agents, @skills) |
| `.env.example` | Šablona environment proměnných |
| `src/core/interfaces/message.interface.ts` | `UserMessage`, `AgentMessage`, `AgentResponse`, `MessageType` enum |
| `src/core/interfaces/agent.interface.ts` | `IMasterAgent`, `ISubAgent`, `AgentContext`, `HealthStatus` |
| `src/core/interfaces/skill.interface.ts` | `ISkill`, `SkillManifest`, `SkillResult`, `ActionDescriptor` |
| `src/core/interfaces/llm.interface.ts` | `ILLMProvider`, `ChatMessage`, `LLMOptions`, `LLMResponse`, `ToolDefinition`, `ToolCall` |
| `src/core/interfaces/index.ts` | Re-export |
| `src/core/utils/logger.ts` | Pino wrapper: `createLogger()`, `setLogLevel()` |
| `src/core/utils/errors.ts` | `DBotError`, `AgentError`, `SkillError`, `ChannelError`, `PermissionError` |
| `src/core/config/config.schema.ts` | Zod schémata pro server, llm, messageBus, channels, logging, whatsapp |
| `src/core/config/config.loader.ts` | Convict + YAML layered loader (default → env-specific → env vars) |
| `config/default.yaml` | Výchozí konfigurace |
| `config/agents.yaml` | Registrace agentů (placeholder) |
| `config/skills.yaml` | Konfigurace skillů (placeholder) |
| `config/permissions.yaml` | Inter-agent pravidla (disabled) |
| `src/core/message-bus/message-bus.interface.ts` | `IMessageBus`, `Subscription`, `MessageHandler` |
| `src/core/message-bus/in-memory.message-bus.ts` | EventEmitter3 implementace, request-response korelace |
| `src/core/message-bus/index.ts` | Re-export |
| `vitest.config.ts` | Vitest konfigurace s path aliasy |

### Ověření:
- ✅ `npx tsc --noEmit` — 0 chyb
- ✅ Config loader načte a validuje YAML
- ✅ `npm install` bez chyb

---

## Fáze 2 — Master Agent + REST API

**Datum:** 2026-03-27 | **Stav:** ✅ Kompletní

### Vytvořené soubory:
| Soubor | Popis |
|---|---|
| `src/core/registry/skill.registry.ts` | Registrace skillů s manifest validací |
| `src/core/registry/agent.registry.ts` | Registrace agentů, `findByCapability()` |
| `src/master-agent/intent-router.ts` | Hardcoded keyword → capability routing |
| `src/master-agent/conversation-context.ts` | Rolling window konverzace |
| `src/master-agent/master-agent.ts` | `IMasterAgent`: `handleUserMessage()`, `routeToAgent()`, `registerSubAgent()` |
| `src/master-agent/index.ts` | Re-export |
| `src/api/middleware/error.middleware.ts` | Custom error → HTTP status mapping |
| `src/api/middleware/auth.middleware.ts` | Bearer token auth z `DBOT_API_KEY` |
| `src/api/routes/health.routes.ts` | `GET /api/v1/health` |
| `src/api/routes/agents.routes.ts` | `GET /api/v1/agents` |
| `src/api/routes/skills.routes.ts` | `GET /api/v1/skills` |
| `src/api/routes/chat.routes.ts` | `POST /api/v1/chat` |
| `src/api/server.ts` | Fastify instance s middleware a routes |
| `src/main.ts` | Bootstrap: config → logger → bus → registries → master agent → server |
| `tests/unit/core/message-bus.test.ts` | 7 testů (publish/subscribe/request/timeout/broadcast/wildcard/shutdown) |
| `tests/unit/master-agent/intent-router.test.ts` | 6 testů (keyword routing + fallback) |

### Ověření:
- ✅ `npm run dev` → Fastify na portu 3000
- ✅ `GET /api/v1/health` → 200
- ✅ `POST /api/v1/chat` → AgentResponse
- ✅ 13 testů prochází

---

## Fáze 3 — Channels + WhatsApp (Baileys)

**Datum:** 2026-03-27 | **Stav:** ✅ Kompletní

### Vytvořené soubory:
| Soubor | Popis |
|---|---|
| `src/channels/channel.interface.ts` | `IChannel`, `IChannelRouter`, `ChannelType`, `ChannelStatus` |
| `src/channels/channel-router.ts` | Bridge kanály ↔ Master Agent |
| `src/channels/rest-api/rest-api.channel.ts` | REST API jako `IChannel` (refaktor z chat.routes) |
| `src/channels/whatsapp/auth-state.ts` | Produkční auth state persistence (JSON soubory) |
| `src/channels/whatsapp/baileys-connection.ts` | `BaileysConnectionManager`: makeWASocket, QR/pairing, exponential backoff reconnect |
| `src/channels/whatsapp/message-normalizer.ts` | `WAMessage` → `UserMessage` (text, image, document, audio, reaction, reply) |
| `src/channels/whatsapp/response-formatter.ts` | `AgentResponse` → WA zpráva, `chunkText()` pro >4096 znaků |
| `src/channels/whatsapp/whatsapp.channel.ts` | Allowlist, token-bucket rate limiter, typing indicator |
| `src/channels/whatsapp/index.ts` | Re-export |
| `tests/unit/channels/message-normalizer.test.ts` | 9 testů (všech 6 typů zpráv + edge cases) |
| `tests/unit/channels/response-formatter.test.ts` | 7 testů (chunking, formátování) |

### Upravené soubory:
- `chat.routes.ts` — delegace na `RestApiChannel`
- `server.ts` — přijímá `restApiChannel` dependency
- `main.ts` — ChannelRouter bootstrap, registrace kanálů

### Řešené problémy:
- **Auth state TS chyba:** `Record<string, SignalDataTypeMap[T] | undefined>` — opraveno odstraněním `| undefined`
- **Dev server timing:** Zvýšen sleep na 3–4 sekundy v test skriptech

### Ověření:
- ✅ QR kód se zobrazí v konzoli při startu
- ✅ REST API funguje paralelně
- ✅ 29 testů prochází

---

## Fáze 4 — LLM Integrace

**Datum:** 2026-03-27 | **Stav:** ✅ Kompletní

### Vytvořené soubory:
| Soubor | Popis |
|---|---|
| `src/core/llm/openai.provider.ts` | `chat()` (s tools), `streamChat()` (AsyncIterable), `getTokenCount()` |
| `src/core/llm/anthropic.provider.ts` | `chat()` (tool_use blocks), `streamChat()`, system prompt separation |
| `src/core/llm/llm-provider.factory.ts` | Factory: inicializace providerů dle API klíčů, graceful skip |
| `src/core/llm/index.ts` | Re-export |
| `tests/unit/core/llm/openai.provider.test.ts` | 6 testů (mock SDK) |
| `tests/unit/core/llm/anthropic.provider.test.ts` | 7 testů (mock SDK) |

### Upravené soubory:
- `intent-router.ts` — **Upgrade na LLM-based routing:** system prompt s capabilities, structured JSON output `{agentId, action, confidence}`, code fence stripping, fallback na hardcoded
- `conversation-context.ts` — `toChatMessages()`: token budget trimming (newest-first)
- `master-agent.ts` — `setLLMProvider()` metoda
- `main.ts` — LLM factory inicializace, default provider injection
- `intent-router.test.ts` — Rozšíření na 12 testů (6 hardcoded + 6 LLM)

### Ověření:
- ✅ 42 testů prochází
- ✅ LLM routing funguje s mock providerem
- ✅ Fallback na hardcoded při nedostupnosti LLM

---

## Fáze 5 — Obsidian Agent + Skills

**Datum:** 2026-03-28 | **Stav:** ✅ Kompletní

### Vytvořené soubory — Skills:
| Soubor | Popis |
|---|---|
| `src/skills/file-system/skill.manifest.json` | Akce: read, write, append, delete, list, exists |
| `src/skills/file-system/file-system.skill.ts` | FS operace sandboxed na `basePath`, path traversal ochrana |
| `src/skills/file-system/index.ts` | Re-export |
| `src/skills/markdown-parser/skill.manifest.json` | Akce: parse, stringify, getFrontmatter, setFrontmatter, extractLinks, extractTags |
| `src/skills/markdown-parser/markdown-parser.skill.ts` | gray-matter pro frontmatter, regex pro wikilinks/md links/tags |
| `src/skills/markdown-parser/index.ts` | Re-export |
| `src/skills/obsidian-sync/skill.manifest.json` | Akce: sync, getStatus, getLastSyncTime |
| `src/skills/obsidian-sync/obsidian-sync.skill.ts` | HTTP klient na Headless sync API (fetch + AbortSignal.timeout) |
| `src/skills/obsidian-sync/index.ts` | Re-export |

### Vytvořené soubory — Agent:
| Soubor | Popis |
|---|---|
| `src/agents/obsidian-agent/obsidian-agent.config.ts` | Zod schema: vaultPath, syncEnabled, defaultFolder, taskFile, dailyNotesFolder, excludePatterns |
| `src/agents/obsidian-agent/vault-manager.ts` | readNote, writeNote, editNote, searchNotes (full-text), listNotes, getMetadata, setMetadata, syncVault |
| `src/agents/obsidian-agent/obsidian-agent.ts` | `ISubAgent` se 7 capabilities, CZ/EN command parsing, snippet extraction |
| `src/agents/obsidian-agent/index.ts` | Re-exports |
| `src/agents/_template/template-agent.ts` | Šablona pro nové agenty |

### Testy:
| Soubor | Počet testů |
|---|---|
| `tests/unit/skills/file-system.test.ts` | 10 (reálný tmpdir, path traversal) |
| `tests/unit/skills/markdown-parser.test.ts` | 14 (frontmatter, links, tags) |
| `tests/unit/agents/obsidian-agent.test.ts` | 14 (dispatch logika, 7 capabilities) |

### Upravené soubory:
- `config/agents.yaml` — `enabled: true` pro obsidian-agent
- `main.ts` — Agent bootstrap z agents.yaml: načtení YAML, inicializace skillů, vytvoření agenta, registrace

### Ověření:
- ✅ `tsc --noEmit` — 0 chyb
- ✅ 97 testů prochází (12 souborů)
- ✅ Dev server — Obsidian Agent registrován s 7 capabilities

---

## Fáze 6 — Permission systém + inter-agent komunikace

**Datum:** 2026-03-28 | **Stav:** ✅ Kompletní

### Vytvořené soubory:
| Soubor | Popis |
|---|---|
| `src/core/permissions/permission.types.ts` | `PermissionRule`, `PermissionCheckResult`, `PermissionConfig` |
| `src/core/permissions/permission.manager.ts` | `loadFromFile()`, `check()`, `enforce()`, `addRule()`, `removeRule()`, `setEnabled()` |
| `src/core/permissions/index.ts` | Re-export |
| `src/api/routes/permissions.routes.ts` | `GET/POST/DELETE /api/v1/permissions`, `PUT /toggle`, `POST /check` |
| `tests/unit/core/permissions/permission.manager.test.ts` | 13 testů (enable/disable, addRule, removeRule, check direction, enforce, loadFromFile) |
| `tests/integration/inter-agent-communication.test.ts` | 8 testů (blocked, allowed, confirmation hold, runtime add/remove) |

### Upravené soubory:
- `in-memory.message-bus.ts` — injekce `IPermissionManager`, ověření pravidel před doručením, emitování `permission:confirmation-required`
- `master-agent.ts` — `setPermissionManager()`, `setConfirmationHandler()`, `handleConfirmationRequest()` (ano/ne flow)
- `server.ts` — registrace permissions routes, `permissionManager` v ServerDeps
- `main.ts` — inicializace PermissionManager, propojení s message busem a MasterAgentem

### Klíčová funkcionalita:
- Globální kill switch (`enabled: false` → vše blokováno)
- Allowlist model: pouze explicitně povolené páry agent→agent
- `requireConfirmation: true` → zpráva se nedoručí, emituje se event pro potvrzení uživatelem
- Runtime API pro přidání/odebrání pravidel

### Ověření:
- ✅ `tsc --noEmit` — 0 chyb
- ✅ 118 testů prochází (12 souborů)

---

## Fáze 7 — Kontejnerizace + produkční připravenost (rozpracováno)

**Datum:** 2026-03-29 | **Stav:** 🔄 In progress

### Dokončeno:
| Soubor | Popis |
|---|---|
| `src/core/message-bus/redis.message-bus.ts` | ioredis Pub/Sub implementace `IMessageBus`, permission checks, request-response korelace |

### Upravené soubory:
- `main.ts` — Přepínání In-memory / Redis bus dle konfigurace, graceful shutdown (channels → server → agents → bus, double-shutdown guard)
- `tsconfig.json` — Upgrade `module` na `NodeNext` (podpora `import ... with`)
- `redis.message-bus.ts` — Oprava ioredis import/type problémů (CJS/ESM kompatibilita)
- `obsidian-sync.skill.ts` — Oprava spread type (explicitní `Record<string, unknown>` cast)
- `config/agents.yaml` — Cesta vault změněna na `./data/vault` pro lokální vývoj

### Zbývá:
- Dockerfile (multi-stage produkční build)
- Dockerfile.dev (dev s tsx watch)
- docker-compose.yml (dbot + redis services)
- config/production.yaml (Redis bus, warn log level)
- Unit testy Redis message bus

### Ověření:
- ✅ `tsc --noEmit` — 0 chyb
- ✅ 118 testů prochází
- ✅ Dev server běží, API endpointy fungují
- ✅ "Vytvoř poznámku Meeting notes s obsahem: ..." → soubor ve vaultu s frontmatter

---

## Ollama integrace (lokální LLM)

**Datum:** 2026-03-29 | **Stav:** ✅ Kompletní

### Vytvořené soubory:
| Soubor | Popis |
|---|---|
| `src/core/llm/ollama.provider.ts` | `OllamaProvider` implementující `ILLMProvider` — chat, streamChat (NDJSON), model management, tool calling |
| `src/api/routes/llm.routes.ts` | REST API pro správu modelů: providers, models, switch, pull, status |
| `tests/unit/core/llm/ollama.provider.test.ts` | 14 unit testů (chat, tools, stream, model management, error handling) |

### Upravené soubory:
- `src/core/config/config.schema.ts` — nové `ollamaProviderSchema` (model, baseUrl, keepAlive, timeout), rozšíření `llmSchema.defaultProvider` o `'ollama'`
- `config/default.yaml` — přidána sekce `ollama` pod `llm.providers`
- `src/core/llm/llm-provider.factory.ts` — registrace `OllamaProvider` (vždy, bez API klíče)
- `src/core/llm/index.ts` — export `OllamaProvider`, `OllamaProviderConfig`, `OllamaModelInfo`
- `src/api/server.ts` — registrace LLM routes, `llmProviderFactory` v `ServerDeps`
- `src/main.ts` — předání `llmProviderFactory` do `createServer()`

### Klíčová funkcionalita:
- **Dynamické přepínání modelů** za běhu přes API (`PUT /api/v1/llm/models`)
- **NDJSON streaming** — Ollama-specifický formát, buffer management s ReadableStream
- **Tool calling** — konverze `ToolDefinition[]` na OpenAI-kompatibilní formát
- **Model management** — list, info, pull, availability check
- **Bez API klíče** — lokální provider, vždy inicializován

### Aktualizovaná dokumentace:
- `README.md` — tech stack, API endpoints, env vars, test counts
- `docs/architecture/detail-design.md` (původně `detaildesign.md`) — nová sekce 8.5 (Ollama Provider), REST API endpoints
- `docs/planning/changelog.md` (původně `execution-plan.md`) — tato sekce

### Ověření:
- ✅ `tsc --noEmit` — 0 chyb
- ✅ 136 testů prochází (13 souborů)

---

## Mistral integrace (cloud LLM)

**Datum:** 2026-03-30 | **Stav:** ✅ Kompletní

### Vytvořené soubory:
| Soubor | Popis |
|---|---|
| `src/core/llm/mistral.provider.ts` | `MistralProvider` implementující `ILLMProvider` — chat, streamChat, tool calling (OpenAI-kompatibilní) |
| `tests/unit/core/llm/mistral.provider.test.ts` | 10 unit testů (chat, tools string/object args, stream, system prompt, error handling) |

### Upravené soubory:
- `package.json` — přidán `@mistralai/mistralai` SDK
- `src/core/config/config.schema.ts` — rozšíření `defaultProvider` enum o `'mistral'`, přidání `mistral` do providers
- `config/default.yaml` — přidána sekce `mistral` (model: mistral-large-latest)
- `src/core/llm/llm-provider.factory.ts` — registrace MistralProvider (MISTRAL_API_KEY)
- `src/core/llm/index.ts` — export MistralProvider
- `.env.example` — přidán MISTRAL_API_KEY
- `docker/docker-compose.yml` — přidán MISTRAL_API_KEY do obou services

### Ověření:
- ✅ `tsc --noEmit` — 0 chyb
- ✅ 146 testů prochází (14 souborů)

---

## Smart Write Routing + Obsidian Sync + Env konfigurace

**Datum:** 2026-03-31 | **Stav:** ✅ Kompletní

### Kontext:
DBot běží v dedikovaném Docker kontejneru na zařízení BEZ Obsidian desktopu. Vault uvnitř kontejneru je primární kopie a musí se synchronizovat s Obsidian Cloud přes `obsidian-headless` CLI.

### A. Obsidian Headless sync služba

| Soubor | Popis |
|---|---|
| `docker/Dockerfile.sync` | NOVÝ — Node.js 22 Alpine + `obsidian-headless` CLI, healthcheck |
| `docker/sync-entrypoint.sh` | NOVÝ — Auto-login (ob login + ob sync-setup), periodický sync loop |
| `docker/docker-compose.yml` | Přidán `obsidian-sync` service se sdíleným `vault-data` volume (RW), `obsidian-auth` volume pro credentials, `env_file: ../.env` |

**Architektura:** Dva kontejnery sdílí vault volume — `dbot` píše poznámky, `obsidian-sync` periodicky synchronizuje s Obsidian Cloud (polling každých 30s).

**Dvě hesla pro Obsidian Sync:**
- `OBSIDIAN_PASSWORD` — heslo k Obsidian účtu (pro `ob login`)
- `OBSIDIAN_VAULT_PASSWORD` — šifrovací heslo vaultu (pro `ob sync-setup --password`)

### B. Env proměnné pro konfiguraci

| Soubor | Popis |
|---|---|
| `.env` | Přidány `DBOT_VAULT_PATH`, `DBOT_VAULT_SYNC_ENABLED`, `DBOT_VAULT_DEFAULT_FOLDER` |
| `.env.example` | Stejné klíče s placeholdery |
| `src/main.ts` | Env override logika — `process.env.DBOT_VAULT_PATH` apod. přepisují `agents.yaml` při bootstrapu |

### C. Smart write routing (task + daily)

| Soubor | Popis |
|---|---|
| `src/agents/obsidian-agent/obsidian-agent.config.ts` | Přidány pole `taskFile` a `dailyNotesFolder` |
| `src/agents/obsidian-agent/vault-manager.ts` | Nové metody `appendToNote()` (create-or-append pattern) a `getDailyNotePath()` |
| `src/agents/obsidian-agent/obsidian-agent.ts` | Nové capabilities `obsidian.task` + `obsidian.daily`, handlery `handleTask()` + `handleDailyNote()`, parsery `parseTaskContent()` + `parseDailyContent()` |
| `src/master-agent/intent-router.ts` | Aktualizovaná klíčová slova (daily → task → write priorita), LLM prompt disambiguace pro task/daily/write/edit |
| `config/agents.yaml` | Přidány `taskFile: "tasks.md"`, `dailyNotesFolder: "daily"` |

### D. Nové testy (+10)

| Soubor | Nové testy |
|---|---|
| `tests/unit/agents/obsidian-agent.test.ts` | +7: task append/create, daily append/path format, unparseable task/daily, capabilities check |
| `tests/unit/master-agent/intent-router.test.ts` | +3: "Přidej úkol" → task, "Denní poznámka" → daily, "Vytvoř poznámku Tasks" → write (ne task!) |

### Řešené problémy:
- **Keyword kolize task vs write**: "přidej" matchoval task i write. Řešení: task keywords jsou specifické (`'úkol', 'ukol', 'task:', 'todo:'`), generická slova zůstávají ve write skupině.

### Ověření:
- ✅ `tsc --noEmit` — 0 chyb
- ✅ 156 testů prochází (14 souborů)

---

## Telegram integrace (grammY)

**Datum:** 2026-03-31 | **Stav:** ✅ Kompletní

### Vytvořené soubory:
| Soubor | Popis |
|---|---|
| `src/channels/telegram/telegram.channel.ts` | `TelegramChannel` implementující `IChannel` — grammY Bot, long polling, allowlist dle chat ID, skupinové filtrování, token-bucket rate limiter |
| `src/channels/telegram/message-normalizer.ts` | TG `Message` → `UserMessage` (text, photo, document, voice/audio) |
| `src/channels/telegram/response-formatter.ts` | `AgentResponse` → TG zpráva, MarkdownV2 formátování s plain text fallback, `chunkText()` pro >4096 znaků |
| `src/channels/telegram/index.ts` | Re-export |
| `tests/unit/channels/telegram-message-normalizer.test.ts` | 7 testů (text, photo, document, voice/audio, edge cases) |
| `tests/unit/channels/telegram-response-formatter.test.ts` | 10 testů (Markdown formatting, plain text fallback, chunking, photo/document) |

### Upravené soubory:
- `package.json` — přidán `grammy` SDK
- `src/core/config/config.schema.ts` — nové `telegramChannelSchema` (botToken, allowedChatIds, allowGroups, maxMessageLength)
- `config/default.yaml` — přidána sekce `telegram` pod `channels`
- `src/channels/channel.interface.ts` — rozšíření `ChannelType` o `TELEGRAM`
- `src/main.ts` — registrace TelegramChannel v ChannelRouteru (if enabled)
- `.env.example` — přidán `TELEGRAM_BOT_TOKEN`

### Klíčová funkcionalita:
- **Long polling** — nevyžaduje veřejnou URL ani webhook, grammY `bot.start()`
- **Allowlist dle chat ID** — filtrování příchozích zpráv podle numerického chat ID
- **Skupinové filtrování** — volitelné povolení skupinových konverzací (`allowGroups`)
- **MarkdownV2** — formátování odpovědí s escapováním speciálních znaků, automatický fallback na plain text při parse erroru
- **Message chunking** — dělení dlouhých zpráv na 4096 znaků (shodný algoritmus s WhatsApp)
- **Token-bucket rate limiter** — per chat ID, identická logika s WhatsApp

### Ověření:
- ✅ `tsc --noEmit` — 0 chyb
- ✅ 173 testů prochází (16 souborů)
- ✅ Bot reaguje na zprávy v Telegram přes long polling

---

## Produkční opravy a vylepšení

**Datum:** 2026-03-31 | **Stav:** ✅ Kompletní

### A. Default LLM provider změněn na Mistral

| Soubor | Popis |
|---|---|
| `config/default.yaml` | Změna `defaultProvider` z `"openai"` na `"mistral"` — jediný nakonfigurovaný provider s API klíčem |

### B. ObsidianSyncSkill v2 (filesystem-based)

| Soubor | Popis |
|---|---|
| `src/skills/obsidian-sync/obsidian-sync.skill.ts` | Přepsáno — odstraněny HTTP `fetch()` volání na neexistující API, nahrazeno filesystem kontrolami (vault dir, .obsidian dir) |
| `src/skills/obsidian-sync/skill.manifest.json` | v2.0.0 — configSchema: `vaultPath` místo `headlessSyncUrl`, permissions: `filesystem.read` místo `network.http` |
| `src/agents/obsidian-agent/obsidian-agent.config.ts` | Odstraněny `syncInterval` a `headlessSyncUrl` z Zod schématu |
| `config/agents.yaml` | Odstraněny `syncInterval: 300` a `headlessSyncUrl` |
| `src/main.ts` | Sync skill inicializace s `vaultPath` místo `headlessSyncUrl` |

### C. Obsidian Sync — periodický polling místo continuous

| Soubor | Popis |
|---|---|
| `docker/sync-entrypoint.sh` | Nahrazeno `exec ob sync --continuous` periodickým `ob sync` v loop (každých 30s) |

**Důvod:** Docker shared volumes (vault-data) netrrigují inotify události cross-container. `ob sync --continuous` sleduje filesystem eventy a nedetekoval soubory zapsané z `dbot-dev` kontejneru. Periodický polling (`ob sync` v loop s `sleep $OBSIDIAN_SYNC_INTERVAL`) problém řeší.

### D. Docker env_file oprava

| Soubor | Popis |
|---|---|
| `docker/docker-compose.yml` | `obsidian-sync` service: odstraněn blok `environment` s `${OBSIDIAN_*}` interpolací (neměl přístup k hodnotám), ponecháno pouze `env_file: ../.env` |

**Důvod:** Docker Compose `environment` s `${VAR}` interpoluje z host shellu, ne z `env_file`. Proměnné jako `OBSIDIAN_EMAIL` byly prázdné.

### E. parseTaskContent — rozšíření parseru

| Soubor | Popis |
|---|---|
| `src/agents/obsidian-agent/obsidian-agent.ts` | Rozšířen fallback regex v `parseTaskContent()` o slovesa: `vytvoř`, `zadej`, `zapsat`, `zapni` + volitelné `mi` (podpora "Vytvoř mi úkol X") |

**Důvod:** Zpráva "Vytvoř mi úkol Zítra koupit rohlíky" se zapisovala celá včetně prefixu.

### F. Telegram end-to-end ověření

- Bot token nastaven v `.env` (`TELEGRAM_BOT_TOKEN`)
- Kanál zapnut v `config/default.yaml` (`enabled: true`)
- grammY dependency nainstalována a Docker image rebuildován
- Bot úspěšně přijímá a odpovídá na zprávy
- IntentRouter (Mistral LLM) správně routuje na Obsidian Agent
- Úkoly se zapisují do vault a synchronizují přes Obsidian Cloud

### Ověření:
- ✅ `tsc --noEmit` — 0 chyb
- ✅ 173 testů prochází (16 souborů)
- ✅ End-to-end: Telegram zpráva → MasterAgent → Obsidian Agent → tasks.md → Obsidian Cloud

---

## Řešené problémy (cross-phase)

| Problém | Fáze | Řešení |
|---|---|---|
| Baileys auth state TS error (`undefined` v Record) | 3 | Změna na `Record<string, SignalDataTypeMap[T]>` bez undefined |
| Dev server timing v test skriptech | 2–3 | Zvýšení sleep, redirect output do temp file |
| `import ... with { type: 'json' }` TS chyba | 7 | Upgrade `module` z `Node16` na `NodeNext` |
| ioredis import not constructable | 7 | Runtime default/named export detection + type cast |
| Spread of non-object type v obsidian-sync | 7 | Explicitní `as Record<string, unknown>` cast |
| FileSystemSkill crash — neexistující vaultPath | 7 | Vytvoření `data/vault/` adresáře, změna cesty v agents.yaml |
| Docker env vars nedorazily do obsidian-sync | Sync | `environment` blok s `${VAR}` interpoloval z host shellu — fix: pouze `env_file` |
| "Failed to validate password" při ob sync-setup | Sync | Obsidian má 2 hesla (účet + vault šifrovací) — přidán `OBSIDIAN_VAULT_PASSWORD` |
| ob sync --continuous nedetekoval cross-container změny | Sync | Docker shared volumes netrrigují inotify — fix: periodický polling |
| parseTaskContent nezachytil "Vytvoř mi úkol" | Agent | Rozšířen fallback regex o `vytvoř`, `zadej`, `zapsat` + volitelné `mi` |
| grammy chyběl v Docker image | Telegram | `npm install grammy` + rebuild Docker image |
| Neplatný Telegram bot token (401 Unauthorized) | Telegram | Uživatel poslal chat ID místo tokenu — opraveno |

---

## Statistiky

| Metrika | Hodnota |
|---|---|
| Celkem souborů zdrojového kódu | ~65 |
| Celkem testovacích souborů | 16 |
| Celkem testů | 173 |
| Fáze dokončeny | 6 / 7 + Ollama + Mistral + Smart Write/Sync + Telegram |
| TypeScript chyby | 0 |
| Failing testy | 0 |

---

## Časová osa

```
Den 1 (2026-03-27):
  Fáze 1 (Core framework)        ██████████ ✅
  Fáze 2 (Master Agent + API)    ██████████ ✅
  Fáze 3 (Channels + WhatsApp)   ██████████ ✅
  Fáze 4 (LLM integrace)         ██████████ ✅

Den 2 (2026-03-28):
  Fáze 5 (Obsidian Agent)        ██████████ ✅
  Fáze 6 (Permission systém)     ██████████ ✅

Den 3 (2026-03-29):
  Fáze 7 (Kontejnerizace)        █████░░░░░ 🔄
  README.md + execution plan     ██████████ ✅
  Lokální spuštění + ověření     ██████████ ✅
  Ollama integrace               ██████████ ✅

Den 4 (2026-03-30):
  Mistral integrace              ██████████ ✅

Den 5 (2026-03-31):
  Smart write routing (task/daily) ██████████ ✅
  Obsidian Headless sync service   ██████████ ✅
  Env konfigurace vault            ██████████ ✅
  Telegram integrace (grammY)      ██████████ ✅
  Nové testy (+27)                 ██████████ ✅
  Default LLM → Mistral           ██████████ ✅
  ObsidianSyncSkill v2             ██████████ ✅
  Sync polling fix (inotify)       ██████████ ✅
  Docker env_file oprava           ██████████ ✅
  Telegram E2E ověření             ██████████ ✅
  parseTaskContent rozšíření       ██████████ ✅
  Aktualizace dokumentace          ██████████ ✅
```
