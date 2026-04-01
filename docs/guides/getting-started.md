# DBot — Rychlý start

> Kompletní průvodce instalací, konfigurací a spuštěním DBot

---

## Předpoklady

- Node.js >= 20
- (volitelně) Docker + Docker Compose
- (volitelně) OpenAI nebo Anthropic API klíč
- (volitelně) [Ollama](https://ollama.com) pro lokální LLM modely

---

## Lokální vývoj

```bash
# Instalace
npm install

# Konfigurace
cp .env.example .env
# Nastavte OPENAI_API_KEY a/nebo ANTHROPIC_API_KEY

# Spuštění (in-memory message bus)
npm run dev

# Testy
npm test

# TypeScript check
npm run typecheck
```

---

## Docker

```bash
# Produkce (dbot + redis + obsidian-sync)
cd docker
docker compose up --build

# Dev s hot reload
cd docker
docker compose --profile dev up dbot-dev redis

# S Obsidian sync (vyžaduje jednorázový setup credentials)
docker compose up --build dbot redis obsidian-sync
```

### Obsidian sync credentials

Obsidian sync credentials nastavte v `.env`:

- `OBSIDIAN_EMAIL` — email k Obsidian účtu
- `OBSIDIAN_PASSWORD` — heslo k Obsidian účtu (pro `ob login`)
- `OBSIDIAN_VAULT_NAME` — název vaultu pro sync
- `OBSIDIAN_VAULT_PASSWORD` — šifrovací heslo vaultu (pro `ob sync-setup`)

> **Poznámka:** Existují dva typy hesel — `OBSIDIAN_PASSWORD` je heslo k účtu, `OBSIDIAN_VAULT_PASSWORD` je šifrovací heslo vaultu. Při startu kontejneru se automaticky provede `ob login` + `ob sync-setup` pomocí těchto proměnných.

---

## Environment proměnné

| Proměnná | Popis | Výchozí |
|---|---|---|
| `DBOT_API_KEY` | Bearer token pro REST API autentizaci | — |
| `OPENAI_API_KEY` | OpenAI API klíč | — |
| `ANTHROPIC_API_KEY` | Anthropic API klíč | — |
| `NODE_ENV` | Prostředí (`development` / `production`) | `development` |
| `DBOT__MESSAGE_BUS__TYPE` | Typ message busu (`in-memory` / `redis`) | `in-memory` |
| `DBOT__MESSAGE_BUS__REDIS__HOST` | Redis host | `localhost` |
| `MISTRAL_API_KEY` | Mistral API klíč | — |
| `DBOT__LLM__DEFAULT_PROVIDER` | Výchozí LLM provider (`openai` / `anthropic` / `mistral` / `ollama`) | `mistral` |
| `DBOT__LLM__PROVIDERS__OLLAMA__BASE_URL` | Ollama base URL | `http://localhost:11434` |
| `DBOT__LLM__PROVIDERS__OLLAMA__MODEL` | Výchozí Ollama model | `llama3.1` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token (alternativa ke config) | — |
| `DBOT_VAULT_PATH` | Cesta k Obsidian vaultu (v Dockeru `/vault`) | `./data/vault` |
| `DBOT_VAULT_SYNC_ENABLED` | Povolit sync s Obsidian Cloud | `false` |
| `DBOT_VAULT_DEFAULT_FOLDER` | Výchozí složka pro nové poznámky | `/` |
| `OBSIDIAN_EMAIL` | Obsidian account email pro sync auto-login | — |
| `OBSIDIAN_PASSWORD` | Obsidian account heslo | — |
| `OBSIDIAN_VAULT_NAME` | Název Obsidian vaultu pro sync | — |
| `OBSIDIAN_VAULT_PASSWORD` | Šifrovací heslo vaultu pro sync-setup | — |
| `OBSIDIAN_SYNC_INTERVAL` | Interval synchronizace v sekundách | `30` |

---

## API Endpoints

| Metoda | Endpoint | Popis |
|---|---|---|
| `GET` | `/api/v1/health` | Health check (uptime, počet agentů/skillů) |
| `GET` | `/api/v1/agents` | Seznam registrovaných agentů |
| `GET` | `/api/v1/skills` | Seznam registrovaných skillů |
| `POST` | `/api/v1/chat` | Odeslání zprávy Master Agentovi |
| `GET` | `/api/v1/permissions` | Seznam permission pravidel |
| `POST` | `/api/v1/permissions` | Přidání nového pravidla |
| `DELETE` | `/api/v1/permissions/:id` | Odebrání pravidla |
| `PUT` | `/api/v1/permissions/toggle` | Zapnutí/vypnutí inter-agent komunikace |
| `GET` | `/api/v1/llm/providers` | Seznam dostupných LLM providerů |
| `GET` | `/api/v1/llm/models` | Seznam Ollama modelů + aktuální |
| `PUT` | `/api/v1/llm/models` | Přepnutí aktivního Ollama modelu |
| `GET` | `/api/v1/llm/models/:model` | Info o konkrétním modelu |
| `POST` | `/api/v1/llm/models/pull` | Stažení nového modelu |
| `GET` | `/api/v1/llm/status` | Ollama dostupnost check |

Všechny `/api` endpointy vyžadují hlavičku `Authorization: Bearer <DBOT_API_KEY>`.

---

## Konfigurace

Vrstvená konfigurace (convict):

1. `config/default.yaml` — výchozí hodnoty
2. `config/{NODE_ENV}.yaml` — environment overrides (např. `production.yaml`)
3. Environment variables — nejvyšší priorita (`DBOT__SECTION__KEY`)

Hlavní konfigurační sekce: `server`, `llm` (openai, anthropic, mistral, ollama), `messageBus`, `logging`, `channels` (whatsapp, telegram, restApi, cli).
