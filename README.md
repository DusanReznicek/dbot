# DBot

Osobní AI agentní systém s hub-and-spoke architekturou. Jeden řídící agent (Master Agent) orchestruje N sub-agentů, kteří využívají modulární skilly a LLM providery. Vstup přes WhatsApp (Baileys), Telegram (grammY) nebo REST API.

---

## Tech Stack

| Kategorie | Technologie | Účel |
|---|---|---|
| Runtime | Node.js 20 LTS + TypeScript 5.x | Hlavní framework |
| WhatsApp | [Baileys](https://baileys.wiki) (`@whiskeysockets/baileys`) | WhatsApp Web WebSocket protokol |
| Telegram | [grammY](https://grammy.dev) (`grammy`) | Telegram Bot API (long polling) |
| HTTP Framework | Fastify 5 | REST API, nativní TypeScript |
| LLM — OpenAI | `openai` SDK | GPT-4o |
| LLM — Anthropic | `@anthropic-ai/sdk` | Claude Sonnet, Opus |
| LLM — Mistral | `@mistralai/mistralai` | Mistral Large, Small, Codestral |
| LLM — Ollama | HTTP API (fetch) | Lokální modely (Llama, Mistral, …) |
| Message Bus (dev) | `eventemitter3` | In-process pub/sub |
| Message Bus (prod) | `ioredis` | Redis Pub/Sub |
| Konfigurace | `convict` + `js-yaml` + `zod` | YAML layered config s runtime validací |
| Logování | `pino` | Strukturované JSON logy |
| Markdown | `remark` + `gray-matter` | Parsování MD + YAML frontmatter |
| Testování | `vitest` | TypeScript-native, Jest-kompatibilní |
| Kontejnerizace | Docker + Docker Compose | Multi-stage build, Redis |
| Dev runtime | `tsx` | TS bez build kroku |

---

## Architektura

```
        ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
        │  WhatsApp  │ │ Telegram  │ │ REST API  │ │    CLI    │
        │ (Baileys)  │ │ (grammY)  │ │ (Fastify) │ │           │
        └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
              │              │              │              │
              └──────────────┴──────────────┼──────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Channel Router   │
                    │  (IChannel iface) │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │   Master Agent    │
                    │  (Orchestrátor)   │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              │         Message Bus          │
              │  (EventEmitter / Redis)      │
              └──┬──────────┬──────────┬────┘
                 │          │          │
          ┌──────▼───┐ ┌───▼──────┐ ┌─▼────────┐
          │ Obsidian  │ │ Sub-Agent│ │ Sub-Agent │
          │  Agent    │ │    B     │ │    ...    │
          └──────┬───┘ └───┬──────┘ └──┬───────┘
                 │          │           │
              ┌──▼──────────▼───────────▼──┐
              │      Skills / Modules       │
              └─────────────┬──────────────┘
              ┌─────────────▼──────────────┐
              │      LLM Abstrakce          │
              │  (OpenAI, Anthropic,        │
              │   Mistral, Ollama)         │
              └────────────────────────────┘
```

### Hlavní vrstvy

| Vrstva | Popis |
|---|---|
| **Channels** | Vstupní kanály (WhatsApp, Telegram, REST API, CLI). Každý implementuje `IChannel` — normalizuje vstup do `UserMessage`, formátuje odpovědi zpět. |
| **Master Agent** | Centrální orchestrátor. Přijímá zprávy, klasifikuje intent (LLM + hardcoded fallback), routuje na sub-agenty, spravuje konverzační kontext. |
| **Message Bus** | Event-driven komunikace. `InMemoryMessageBus` (EventEmitter3) pro vývoj, `RedisMessageBus` (ioredis Pub/Sub) pro produkci. Permission-gated. |
| **Sub-Agents** | Doménově specifičtí agenti. Deklarují capabilities, přijímají `AgentMessage`, vrací `AgentResponse`. Obsidian Agent je první implementovaný. |
| **Skills** | Znovupoužitelné moduly (file-system, markdown-parser, obsidian-sync). Každý má manifest, DI do agentů. |
| **LLM Abstrakce** | Jednotné rozhraní `ILLMProvider`. OpenAI, Anthropic, Mistral a Ollama providery, factory, dynamické přepínání modelů. |
| **Permissions** | Allowlist model pro inter-agent komunikaci. Global kill switch, volitelný confirmation flow přes aktivní kanál. |

---

## Spuštění

### Quick Start (lokální vývoj)

```bash
npm install
cp .env.example .env        # nastavte API klíče
npm run dev
```

### Docker

```bash
cd docker
docker compose up --build                          # produkce (dbot + redis + obsidian-sync)
docker compose --profile dev up dbot-dev redis     # dev s hot reload
```

Kompletní seznam environment proměnných, API endpointů a konfiguračních voleb viz [Průvodce rychlým startem](docs/guides/getting-started.md).

---

## Obsidian Agent

První implementovaný sub-agent. Spravuje Obsidian vault přes file-system operace.

### Capabilities

| Capability | Popis |
|---|---|
| `obsidian.read` | Čtení poznámky podle cesty |
| `obsidian.write` | Vytvoření/přepsání poznámky |
| `obsidian.edit` | Částečná editace existující poznámky |
| `obsidian.search` | Full-text vyhledávání napříč vaultem |
| `obsidian.list` | Výpis souborů a složek |
| `obsidian.metadata` | Čtení/zápis YAML frontmatter |
| `obsidian.sync` | Synchronizace přes Headless sync API |
| `obsidian.task` | Přidání úkolu do `tasks.md` (formát `- [ ] text`) |
| `obsidian.daily` | Zápis do denní poznámky `daily/YYYY-MM-DD.md` (formát `- **HH:MM** text`) |

Podrobnosti o Smart Write Routing a Obsidian Sync viz [Obsidian Sync](docs/features/obsidian-sync.md).

---

## Rozšiřitelnost

- [Nový sub-agent](docs/guides/adding-agent.md)
- [Nový kanál](docs/guides/adding-channel.md)
- [Nový skill](docs/guides/adding-skill.md)
- Nový LLM provider — implementujte `ILLMProvider` v `src/core/llm/`

---

## Bezpečnostní model

| Vrstva | Mechanismus |
|---|---|
| **Kanálová** | WhatsApp allowlist kontaktů, Telegram allowlist chat ID, rate limiting (token bucket), REST API Bearer auth |
| **Inter-agent** | Explicitní allowlist v `permissions.yaml`, global kill switch, volitelný confirmation flow |
| **Skill** | Sandbox na `vaultPath`, path traversal ochrana (`resolve()` + prefix check) |

---

## Testy

```bash
npm test                    # Všechny testy
npm run test:unit           # Pouze unit
npm run test:integration    # Pouze integrační
npm run test:coverage       # S pokrytím
```

**Aktuální stav:** 16 test souborů, 173 testů — vše prochází.

| Oblast | Testů |
|---|---|
| Message Bus (in-memory + Redis) | 16 |
| Intent Router (hardcoded + LLM + task/daily) | 15 |
| Channels — WhatsApp (normalizer + formatter) | 16 |
| Channels — Telegram (normalizer + formatter) | 17 |
| LLM Providers (OpenAI + Anthropic + Mistral + Ollama) | 37 |
| Skills (file-system + markdown) | 24 |
| Obsidian Agent (+ task/daily) | 21 |
| Permissions | 17 |
| Inter-agent komunikace (integrace) | 8 |
| **Celkem** | **173** |

---

## Dokumentace

Kompletní dokumentace je v [docs/README.md](docs/README.md):

- **Architecture** — přehled architektury, detail design
- **Guides** — rychlý start, přidání agentů/kanálů/skillů
- **Features** — Ollama, Obsidian Sync, Telegram
- **Planning** — specifikace, implementační plán, changelog

---

## Konfigurace

Vrstvená konfigurace (convict): `config/default.yaml` → `config/{NODE_ENV}.yaml` → environment variables (`DBOT__SECTION__KEY`).

Podrobnosti viz [Průvodce rychlým startem](docs/guides/getting-started.md).

---

## Licence

Soukromý projekt.
