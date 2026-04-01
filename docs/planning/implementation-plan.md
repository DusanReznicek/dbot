# DBot — Implementační plán

> Vychází z [`docs/architecture/overview.md`](../architecture/overview.md) | Verze: 0.1.0 | Datum: 2026-03-27

---

## Přehled fází

| Fáze | Název | Výstup |
|---|---|---|
| 1 | Core framework | Rozhraní, config, message bus, logger |
| 2 | Master Agent + API | Orchestrátor, registry, REST API |
| 3 | Channels + WhatsApp + Telegram | IChannel abstrakce, Baileys + grammY integrace |
| 4 | LLM integrace | OpenAI + Anthropic + Mistral + Ollama providery, LLM routing |
| 5 | Obsidian Agent | File-system/markdown/sync skilly + agent |
| 6 | Permission systém | Inter-agent komunikace + permission manager |
| 7 | Kontejnerizace | Dockerfile, Docker Compose, Redis message bus |

### Závislosti mezi fázemi

```
Fáze 1 (rozhraní + config + message bus)
  └─▶ Fáze 2 (Master Agent + API)
        └─▶ Fáze 3 (Channels + WA + TG)    ─┐
              └─▶ Fáze 4 (LLM routing)      │  Fáze 3 a 4 jsou relativně nezávislé —
                    └─▶ Fáze 5 (Obsidian)   │  WhatsApp lze implementovat s echo odpovědí
                          └─▶ Fáze 6 (Perms)
                                └─▶ Fáze 7 (Docker)
```

---

## Fáze 1 — Core framework

**Cíl:** Základ projektu — TypeScript konfigurace, rozhraní, config loader, logger, in-memory message bus.

### Soubory k vytvoření (v pořadí):

| # | Soubor | Popis |
|---|---|---|
| 1 | `package.json` | dependencies: `fastify`, `openai`, `@anthropic-ai/sdk`, `@whiskeysockets/baileys`, `eventemitter3`, `ioredis`, `convict`, `js-yaml`, `pino`, `zod`, `remark`, `gray-matter`; devDeps: `typescript`, `tsx`, `vitest`, `eslint`, `@typescript-eslint`, `prettier`; scripts: `dev`, `build`, `test` |
| 2 | `tsconfig.json` | strict mode, target ES2022, paths aliasy (`@core/*`, `@channels/*`, `@agents/*`, `@skills/*`) |
| 3 | `.eslintrc.js`, `.prettierrc`, `.env.example` | Lint + format konfigurace, příklad env proměnných |
| 4 | `src/core/interfaces/message.interface.ts` | `UserMessage`, `AgentMessage`, `AgentResponse`, `MessageType` enum |
| 5 | `src/core/interfaces/agent.interface.ts` | `IMasterAgent`, `ISubAgent`, `AgentContext`, `SubAgentInfo`, `HealthStatus` |
| 6 | `src/core/interfaces/skill.interface.ts` | `ISkill`, `SkillManifest`, `SkillResult`, `ActionDescriptor`, `SkillConfig` |
| 7 | `src/core/interfaces/llm.interface.ts` | `ILLMProvider`, `ChatMessage`, `LLMOptions`, `LLMResponse`, `LLMStreamChunk` |
| 8 | `src/core/interfaces/index.ts` | Re-export všech rozhraní |
| 9 | `src/core/utils/logger.ts` | Pino wrapper, strukturovaný kontext `{ agentId?, channelId?, conversationId? }` |
| 10 | `src/core/utils/errors.ts` | `DBotError`, `AgentError`, `SkillError`, `ChannelError`, `PermissionError` |
| 11 | `src/core/config/config.schema.ts` | Zod schémata pro validaci (server, llm, messageBus, channels, logging) |
| 12 | `src/core/config/config.loader.ts` | Convict loader: `default.yaml` → `{NODE_ENV}.yaml` → env variables |
| 13 | `config/default.yaml` | Výchozí hodnoty (port 3000, OpenAI gpt-4o, messageBus in-memory, WhatsApp enabled) |
| 14 | `config/agents.yaml` | Registrace agentů (placeholder pro Obsidian Agent) |
| 15 | `config/skills.yaml` | Konfigurace skillů (placeholder) |
| 16 | `config/permissions.yaml` | Inter-agent pravidla (výchozí: `enabled: false`) |
| 17 | `src/core/message-bus/message-bus.interface.ts` | `IMessageBus`, `Subscription`, `MessageHandler` |
| 18 | `src/core/message-bus/in-memory.message-bus.ts` | EventEmitter3 implementace, request-response korelace s timeoutem |
| 19 | `src/core/message-bus/index.ts` | Re-export |

### Ověření:
```bash
npx tsc --noEmit                              # TypeScript kompilace bez chyb
npx tsx src/core/config/config.loader.ts      # Config se načte bez výjimky
```

---

## Fáze 2 — Master Agent + základní API

**Cíl:** Funkční orchestrátor s REST API, agent registry a skill registry.

### Soubory k vytvoření (v pořadí):

| # | Soubor | Popis |
|---|---|---|
| 1 | `src/core/registry/skill.registry.ts` | Skenování `src/skills/`, načítání manifestů, zod validace |
| 2 | `src/core/registry/agent.registry.ts` | In-memory registrace sub-agentů, lookup podle capability |
| 3 | `src/master-agent/intent-router.ts` | Hardcoded routing (klíčová slova → agent capabilities); v fázi 4 upgrade na LLM |
| 4 | `src/master-agent/conversation-context.ts` | Rolling window konverzace, aktivní agent, user preferences |
| 5 | `src/master-agent/master-agent.ts` | `IMasterAgent`: `initialize()`, `handleUserMessage()`, `routeToAgent()` |
| 6 | `src/master-agent/index.ts` | Re-export |
| 7 | `src/api/middleware/error.middleware.ts` | Fastify error handler, mapování custom errors → HTTP kódy |
| 8 | `src/api/middleware/auth.middleware.ts` | Bearer token ověření z env `DBOT_API_KEY` |
| 9 | `src/api/routes/health.routes.ts` | `GET /api/v1/health` |
| 10 | `src/api/routes/agents.routes.ts` | `GET /api/v1/agents` |
| 11 | `src/api/routes/skills.routes.ts` | `GET /api/v1/skills` |
| 12 | `src/api/routes/chat.routes.ts` | `POST /api/v1/chat` → Master Agent |
| 13 | `src/api/server.ts` | Fastify instance, registrace pluginů |
| 14 | `src/main.ts` | Bootstrap: config → logger → message bus → registries → master agent → server |
| 15 | `tests/unit/core/message-bus.test.ts` | Unit testy message bus |
| 16 | `tests/unit/master-agent/intent-router.test.ts` | Unit testy intent routeru |

### Ověření:
```bash
npm run dev
curl http://localhost:3000/api/v1/health          # → 200
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'                         # → AgentResponse
npm test
```

---

## Fáze 3 — Channel abstrakce + WhatsApp (Baileys) + Telegram (grammY)

**Cíl:** Multi-channel vstupní vrstva s WhatsApp a Telegram jako primárními kanály.

### Soubory k vytvoření (v pořadí):

| # | Soubor | Popis |
|---|---|---|
| 1 | `src/channels/channel.interface.ts` | `IChannel`, `IChannelRouter`, `ChannelType`, `ChannelStatus`, `IWhatsAppChannel`, `WhatsAppChannelConfig` |
| 2 | `src/channels/channel-router.ts` | Registrace kanálů, bridge: normalizace → Master Agent → response formatter |
| 3 | `src/channels/rest-api/rest-api.channel.ts` | Refaktor `chat.routes.ts` do `IChannel` vzoru |
| 4 | `src/channels/whatsapp/auth-state.ts` | Vlastní produkční auth persistence (JSON soubory v `data/whatsapp-auth/`); **ne** demo `useMultiFileAuthState` |
| 5 | `src/channels/whatsapp/baileys-connection.ts` | `BaileysConnectionManager`: `makeWASocket()`, QR/pairing autentizace, reconnect s exponential backoff, event listenery (`connection.update`, `messages.upsert`, `creds.update`) |
| 6 | `src/channels/whatsapp/message-normalizer.ts` | `WAMessage` → `UserMessage`: text, image (base64+caption), document, audio, reaction, reply (replyTo) |
| 7 | `src/channels/whatsapp/response-formatter.ts` | `AgentResponse` → WA zpráva: chunking >4096 znaků, typing indicator, read receipts |
| 8 | `src/channels/whatsapp/whatsapp.channel.ts` | `IWhatsAppChannel`: compose komponent, allowlist kontaktů, rate limiting (token bucket) |
| 9 | `src/channels/whatsapp/index.ts` | Re-export |
| 10 | `data/.gitkeep` + `.gitignore` update | Adresář pro WA auth session (ignorovat `data/whatsapp-auth/`) |
| 11 | Aktualizace `src/main.ts` | Inicializace `ChannelRouter`, registrace kanálů |
| 12 | `tests/unit/channels/message-normalizer.test.ts` | Unit testy normalizace zpráv |
| 13 | `tests/unit/channels/response-formatter.test.ts` | Unit testy formátování odpovědí |
| 14 | `tests/integration/whatsapp-flow.test.ts` | Mock Baileys socket, end-to-end flow |
| 15 | `src/channels/telegram/telegram.channel.ts` | `TelegramChannel`: grammY Bot, long polling, allowlist dle chat ID, rate limiter |
| 16 | `src/channels/telegram/message-normalizer.ts` | TG `Message` → `UserMessage` (text, photo, document, voice/audio) |
| 17 | `src/channels/telegram/response-formatter.ts` | `AgentResponse` → TG zpráva, MarkdownV2 + plain text fallback, chunking 4096 |
| 18 | `src/channels/telegram/index.ts` | Re-export |
| 19 | `tests/unit/channels/telegram-message-normalizer.test.ts` | 7 testů |
| 20 | `tests/unit/channels/telegram-response-formatter.test.ts` | 10 testů |

### Ověření:
- QR kód se zobrazí v konzoli při startu (WhatsApp)
- Po spárování: zpráva od povoleného čísla → bot odpoví
- Zpráva od nepovoleného čísla → tiše ignorována
- Telegram bot reaguje na zprávy přes long polling
- `POST /api/v1/chat` stále funguje paralelně

---

## Fáze 4 — LLM integrace

**Cíl:** OpenAI + Anthropic + Mistral + Ollama providery, LLM-based intent routing, konverzační kontext.

### Soubory k vytvoření (v pořadí):

| # | Soubor | Popis |
|---|---|---|
| 1 | `src/core/llm/openai.provider.ts` | `OpenAIProvider`: `chat()`, `streamChat()` (AsyncIterable), `getTokenCount()` |
| 2 | `src/core/llm/anthropic.provider.ts` | `AnthropicProvider`: `chat()`, `streamChat()`, `getTokenCount()` |
| 3 | `src/core/llm/llm-provider.factory.ts` | Factory: `createProvider(config)` → `ILLMProvider` dle `config.llm.defaultProvider` |
| 4 | `src/core/llm/index.ts` | Re-export |
| 5 | Aktualizace `src/master-agent/intent-router.ts` | LLM-based routing: system prompt s capabilities agentů, structured JSON output `{ agentId, action, confidence }`, fallback na hardcoded |
| 6 | Aktualizace `src/master-agent/conversation-context.ts` | LLM token management: trimování starých zpráv při překročení context window |
| 7 | `tests/unit/core/llm/openai.provider.test.ts` | Mock openai SDK |
| 8 | `tests/unit/core/llm/anthropic.provider.test.ts` | Mock anthropic SDK |
| 9 | `src/core/llm/mistral.provider.ts` | `MistralProvider`: chat, streamChat, tool calling (OpenAI-kompatibilní) — výchozí provider |
| 10 | `src/core/llm/ollama.provider.ts` | `OllamaProvider`: chat (HTTP), streamChat (NDJSON), model management (set/get/list/pull), tool calling |
| 11 | `src/api/routes/llm.routes.ts` | REST API pro správu modelů: providers, models, switch, pull, status |
| 12 | `tests/unit/core/llm/mistral.provider.test.ts` | Mock SDK, 10 testů |
| 13 | `tests/unit/core/llm/ollama.provider.test.ts` | Mock fetch, 14 testů |

### Ověření:
```bash
DBOT__LLM__DEFAULT_PROVIDER=anthropic npm run dev
# Zpráva přes WhatsApp/API → LLM klasifikuje intent → správný agent
```

---

## Fáze 5 — Obsidian Agent + skilly

**Cíl:** Plně funkční Obsidian Agent s file-system, markdown-parser a obsidian-sync skilly.

### Skilly:

| # | Soubor | Popis |
|---|---|---|
| 1 | `src/skills/file-system/skill.manifest.json` | Akce: `read`, `write`, `append`, `delete`, `list`, `exists`; permissions: `filesystem.read`, `filesystem.write` |
| 2 | `src/skills/file-system/file-system.skill.ts` | FS operace; sandbox na `vaultPath` (path traversal ochrana: `path.resolve` + prefix check) |
| 3 | `src/skills/file-system/index.ts` | Re-export |
| 4 | `src/skills/markdown-parser/skill.manifest.json` | Akce: `parse`, `stringify`, `getFrontmatter`, `setFrontmatter`, `extractLinks`, `extractTags` |
| 5 | `src/skills/markdown-parser/markdown-parser.skill.ts` | remark + gray-matter: YAML frontmatter, `[[wikilink]]` + `[markdown](link)`, `#tag` |
| 6 | `src/skills/markdown-parser/index.ts` | Re-export |
| 7 | `src/skills/obsidian-sync/skill.manifest.json` | Akce: `sync`, `getStatus`, `getLastSyncTime` |
| 8 | `src/skills/obsidian-sync/obsidian-sync.skill.ts` | Filesystem-based sync status (v2) — ověření vault dir + .obsidian dir |
| 9 | `src/skills/obsidian-sync/index.ts` | Re-export |

### Obsidian Agent:

| # | Soubor | Popis |
|---|---|---|
| 10 | `src/agents/obsidian-agent/obsidian-agent.config.ts` | Zod schéma: `vaultPath`, `syncEnabled`, `defaultFolder`, `taskFile`, `dailyNotesFolder`, `excludePatterns` |
| 11 | `src/agents/obsidian-agent/vault-manager.ts` | Vyšší operace: `searchNotes(query)`, `readNote(path)`, `writeNote(path, content, frontmatter?)` |
| 12 | `src/agents/obsidian-agent/obsidian-agent.ts` | `ISubAgent`: capabilities `obsidian.*`, `handleMessage()` → dispatch na VaultManager |
| 13 | `src/agents/obsidian-agent/index.ts` | Factory `createObsidianAgent(config)` |
| 14 | `src/agents/_template/` | Šablonové soubory pro nové agenty |
| 15 | Aktualizace `config/agents.yaml` | Plná konfigurace Obsidian Agenta s `vaultPath` |

### Testy:

| # | Soubor | Popis |
|---|---|---|
| 16 | `tests/unit/skills/file-system.test.ts` | Mock fs, path traversal test |
| 17 | `tests/unit/skills/markdown-parser.test.ts` | Parsování MD + frontmatter |
| 18 | `tests/unit/agents/obsidian-agent.test.ts` | Agent dispatch logika |
| 19 | `tests/integration/obsidian-flow.test.ts` | WA zpráva → Obsidian Agent → vault → WA odpověď |

### Ověření:
- "Přidej poznámku XYZ do složky Inbox" přes WhatsApp → nový MD soubor ve vaultu
- "Najdi poznámku o YYY" → výpis nalezených souborů
- "Synchronizuj vault" → spuštění Headless sync

---

## Fáze 6 — Permission systém + inter-agent komunikace

**Cíl:** Explicitní allowlist model pro meziagenturní komunikaci.

### Soubory k vytvoření (v pořadí):

| # | Soubor | Popis |
|---|---|---|
| 1 | `src/core/permissions/permission.types.ts` | `PermissionRule`, `PermissionCheckResult` |
| 2 | `src/core/permissions/permission.manager.ts` | `IPermissionManager`: načítání z `config/permissions.yaml`, `canCommunicate()`, `requiresConfirmation()` |
| 3 | Aktualizace `src/core/message-bus/in-memory.message-bus.ts` | Injektovat `IPermissionManager`, ověřovat pravidla před doručením |
| 4 | Aktualizace `src/master-agent/master-agent.ts` | Handler pro confirmation events: zpráva uživateli přes aktivní kanál, await ano/ne |
| 5 | `src/api/routes/permissions.routes.ts` | `GET/POST/DELETE /api/v1/permissions` |
| 6 | `tests/unit/core/permissions/permission.manager.test.ts` | Unit testy |
| 7 | `tests/integration/inter-agent-communication.test.ts` | Cross-agent zprávy s/bez pravidel |

### Ověření:
- Cross-agent zpráva bez pravidla → `PermissionError`
- Pravidlo s `requireConfirmation: true` → bot se ptá přes WhatsApp

---

## Fáze 7 — Kontejnerizace + produkční připravenost

**Cíl:** Docker setup, Redis message bus, graceful shutdown.

### Soubory k vytvoření (v pořadí):

| # | Soubor | Popis |
|---|---|---|
| 1 | `src/core/message-bus/redis.message-bus.ts` | ioredis Pub/Sub implementace `IMessageBus`, reply channel pro request-response |
| 2 | `docker/Dockerfile` | Multi-stage: deps (`npm ci`) → build (`tsc`) → production (`node dist/main.js`) |
| 3 | `docker/Dockerfile.dev` | Dev image s `tsx watch src/main.ts` |
| 4 | `docker/docker-compose.yml` | Services: `dbot` (volumes: src, config, data) + `redis` (redis:7-alpine) |
| 5 | `config/production.yaml` | Overrides: `messageBus.type: redis`, `logging.level: warn` |
| 6 | Aktualizace `src/main.ts` | Graceful shutdown: SIGTERM → stop channels → shutdown agents → close bus → exit |

### Ověření:
```bash
docker compose up --build
# Bot se spáruje s WhatsApp
# Zprávy fungují end-to-end
docker compose logs dbot | grep "ERROR"     # → žádné chyby
```

---

## Globální konvence

| Konvence | Pravidlo |
|---|---|
| Dependency Injection | Závislosti přes konstruktor nebo factory |
| Interface-first | Nejdříve TypeScript rozhraní, pak implementace |
| Error handling | Custom error třídy z `src/core/utils/errors.ts` |
| Logování | Každý log obsahuje `{ agentId?, channelId?, conversationId? }` |
| Testy | Unit: `tests/unit/` (zrcadlí `src/`), integrační: `tests/integration/` |
| Config | Žádné hardcoded hodnoty — vše přes `config/*.yaml` nebo env |
| Importy | Path aliasy `@core/`, `@channels/`, `@agents/`, `@skills/` |

---

## Soubory měněné průběžně

| Soubor | Fáze úprav |
|---|---|
| `src/main.ts` | 2, 3, 7 (bootstrap rozšiřování) |
| `src/master-agent/intent-router.ts` | 2 (hardcoded), 4 (LLM upgrade) |
| `config/default.yaml` | 1, 3, 4, 5 (přidávání sekcí) |
| `src/core/message-bus/in-memory.message-bus.ts` | 1 (základ), 6 (permission checks) |
| `config/agents.yaml` | 1 (placeholder), 5 (Obsidian Agent) |

---

## Vývojové milníky

### M1 — Skeleton běží (konec Fáze 1)

**Acceptance criteria:**
- [ ] `npm install` projde bez chyb
- [ ] `npx tsc --noEmit` — nulový počet TypeScript chyb
- [ ] Config loader načte `config/default.yaml` a validuje přes zod schéma
- [ ] Logger vypisuje strukturované JSON logy do stdout
- [ ] In-memory message bus: publish → subscribe doručí zprávu; `request()` vrátí odpověď do timeoutu

**Demo:** `npx tsx src/core/config/config.loader.ts` vypíše načtenou konfiguraci bez výjimky.

---

### M2 — Master Agent odpovídá přes API (konec Fáze 2)

**Acceptance criteria:**
- [ ] `npm run dev` spustí Fastify server na portu 3000
- [ ] `GET /api/v1/health` vrátí `200` s počtem registrovaných agentů a skillů
- [ ] `GET /api/v1/agents` vrátí prázdné pole (žádní agenti zatím)
- [ ] `POST /api/v1/chat` přijme `{ "message": "hello" }` a vrátí `AgentResponse` (echo/fallback odpověď)
- [ ] Intent router mapuje klíčová slova na capabilities (hardcoded)
- [ ] Conversation context udržuje historii zpráv v rolling window
- [ ] Unit testy: message bus (publish/subscribe/request-timeout) + intent router (keyword → capability mapping) — všechny projdou

**Demo:** `curl -X POST localhost:3000/api/v1/chat -d '{"message":"hello"}' -H 'Content-Type: application/json'` → JSON odpověď.

---

### M3 — WhatsApp echo bot (konec Fáze 3)

**Acceptance criteria:**
- [ ] Při startu aplikace se v konzoli zobrazí QR kód pro spárování WhatsApp
- [ ] Po naskenování QR kódu: `connection.update` event s `connection: 'open'`
- [ ] Auth state persisted — restart aplikace nevyžaduje nové spárování
- [ ] Zpráva od čísla v allowlistu → bot odpoví (echo nebo Master Agent response)
- [ ] Zpráva od čísla mimo allowlist → tiše ignorována (žádná odpověď, log warning)
- [ ] Typing indicator zobrazen během zpracování
- [ ] Zprávy >4096 znaků správně rozchunkovány
- [ ] `POST /api/v1/chat` funguje paralelně s WhatsApp kanálem
- [ ] Rate limiter: >N zpráv/min od jednoho JID → zprávy dočasně ignorovány
- [ ] Unit testy: MessageNormalizer (6 typů zpráv) + ResponseFormatter (chunking, formátování) — projdou

**Demo:** Poslat zprávu z mobilu na spárované číslo → bot odpoví přes WhatsApp do 3 sekund.

---

### M4 — LLM rozumí intentům (konec Fáze 4)

**Acceptance criteria:**
- [ ] `OpenAIProvider.chat()` volá OpenAI API a vrací `LLMResponse`
- [ ] `AnthropicProvider.chat()` volá Anthropic API a vrací `LLMResponse`
- [ ] `LLMProviderFactory` vytvoří správný provider dle konfigurace
- [ ] Intent router: LLM klasifikuje "Přidej poznámku do Obsidianu" → `{ agentId: "obsidian-agent", action: "obsidian.write", confidence: >0.8 }`
- [ ] Intent router: neznámý intent → fallback odpověď (ne crash)
- [ ] Fallback na hardcoded routing pokud LLM API nedostupné
- [ ] Konverzační kontext: trimování starších zpráv při překročení token limitu
- [ ] Unit testy: oba providery (mock SDK) + intent router (LLM mock + fallback) — projdou

**Demo:** Poslat přes WhatsApp "Co je v mém Obsidianu?" → LLM správně routuje na obsidian-agent (log ukazuje `agentId: obsidian-agent`).

---

### M5 — Obsidian Agent plně funkční (konec Fáze 5)

**Acceptance criteria:**
- [ ] File-system skill: čtení/zápis/list souborů v rámci vaultPath; path traversal mimo vault → `SkillError`
- [ ] Markdown-parser skill: getFrontmatter/setFrontmatter, extractLinks (`[[wikilink]]` i `[md](link)`), extractTags (`#tag`)
- [ ] Obsidian-sync skill: HTTP volání na Headless sync endpoint; nedostupný endpoint → graceful error
- [ ] Obsidian Agent: `handleMessage()` správně dispatchuje na VaultManager pro všech 7 capabilities
- [ ] E2E flow: "Přidej poznámku Nákupní seznam do Inbox" přes WA → nový soubor `vault/Inbox/Nákupní seznam.md`
- [ ] E2E flow: "Najdi poznámku o projektu X" přes WA → výpis nalezených souborů s krátkou ukázkou obsahu
- [ ] E2E flow: "Synchronizuj vault" přes WA → spuštění sync + potvrzení
- [ ] Skill manifesty validovány skill registry při startu
- [ ] Unit testy: file-system (CRUD + path traversal), markdown-parser (frontmatter + links + tags), obsidian-agent (dispatch) — projdou
- [ ] Integrační test: celý flow WA → Master → Obsidian → skill → odpověď — projde

**Demo:** Poslat přes WhatsApp "Vytvoř poznámku Meeting notes s obsahem: Probíráno X, Y, Z" → soubor ve vaultu; poté "Najdi meeting" → bot najde a vrátí obsah.

---

### M6 — Permission systém chrání komunikaci (konec Fáze 6)

**Acceptance criteria:**
- [ ] `PermissionManager` načte pravidla z `config/permissions.yaml`
- [ ] Message bus: zpráva z agent A → agent B bez pravidla → `PermissionError` (zpráva nedoručena)
- [ ] Message bus: zpráva s platným pravidlem → doručena
- [ ] `requireConfirmation: true` → Master Agent odešle otázku uživateli přes aktivní kanál, čeká na ano/ne
- [ ] Uživatel odpoví "ne" → zpráva nedoručena, agent informován
- [ ] Runtime API: `POST /api/v1/permissions` přidá nové pravidlo; `DELETE` odebere
- [ ] Globální kill switch `interAgentCommunication.enabled: false` → veškerá inter-agent komunikace blokována
- [ ] Unit testy: permission manager (canCommunicate, requiresConfirmation, addRule, removeRule) — projdou
- [ ] Integrační test: cross-agent flow s/bez pravidla — projde

**Demo:** Nastavit pravidlo obsidian→calendar s potvrzením; spustit akci vyžadující cross-agent komunikaci → bot se zeptá přes WhatsApp "Povolit?".

---

### M7 — Produkční nasazení v kontejneru (konec Fáze 7)

**Acceptance criteria:**
- [ ] `docker compose up --build` spustí oba services (dbot + redis) bez chyb
- [ ] Redis message bus: publish/subscribe/request funguje mezi procesy
- [ ] WhatsApp spárování funguje v kontejneru (QR kód v `docker compose logs`)
- [ ] Auth state přežije restart kontejneru (volume mount `data/`)
- [ ] Graceful shutdown: `docker compose stop` → SIGTERM → channels stop → agents shutdown → bus close → exit 0
- [ ] `docker compose logs dbot | grep "ERROR"` → prázdný výstup
- [ ] Produkční build (`docker/Dockerfile`): image size < 200MB
- [ ] `config/production.yaml` overrides aktivní (Redis bus, warn log level)

**Demo:** `docker compose up -d` → poslat zprávu přes WhatsApp → odpověď do 5s → `docker compose restart dbot` → bot se reconnectne bez nutnosti nového QR kódu.
