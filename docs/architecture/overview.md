# DBot — Solution Design

> Osobní AI agentní řešení pro různé osobní činnosti
> Verze: 0.1.0 | Datum: 2026-03-26

---

## 1. Přehled systémové architektury

Systém využívá **hub-and-spoke** vzor se třemi hlavními vrstvami: řídící agent (orchestrátor), sub-agenti a vrstva skillů/modulů.

```
   ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
   │  WhatsApp  │ │ Telegram  │ │ REST API  │ │    CLI    │
   │ (Baileys)  │ │(node-tgb) │ │ (Fastify) │ │           │
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
              │  (EventEmitter / Redis PubSub)│
              └──┬──────────┬──────────┬────┘
                 │          │          │
          ┌──────▼───┐ ┌───▼──────┐ ┌─▼────────┐
          │ Obsidian  │ │ Sub-Agent│ │ Sub-Agent │
          │  Agent    │ │    B     │ │    ...    │
          └──────┬───┘ └───┬──────┘ └──┬───────┘
                 │          │           │
              ┌──▼──────────▼───────────▼──┐
              │      Skills / Modules       │
              │  (Plugin registry + loader) │
              └─────────────┬──────────────┘
              ┌─────────────▼──────────────┐
              │      LLM Abstrakce          │
              │(OpenAI,Anthropic,Mistral,..)│
              └────────────────────────────┘
```

### Klíčová architektonická rozhodnutí

- **Multi-channel vstup** — abstrakce `IChannel` umožňuje přijímat zprávy z různých kanálů (WhatsApp, Telegram, REST API, CLI); každý kanál normalizuje vstup do jednotného `UserMessage` formátu
- **WhatsApp jako primární UI** — knihovna Baileys (WebSocket protokol WhatsApp Web) poskytuje konverzační rozhraní bez nutnosti vlastní aplikace
- **Event-driven komunikace** mezi agenty přes message bus — lokálně `EventEmitter`, v produkci Redis Pub/Sub nebo NATS
- **Plugin-based skills** — každý skill je samostatný modul s manifestem (`skill.manifest.json`)
- **LLM Provider abstrakce** — jednotné rozhraní `ILLMProvider` obalující OpenAI i Anthropic SDK
- **Permission-gated inter-agent messaging** — agenti spolu nemohou komunikovat bez explicitního povolení uživatele
- **Monolith-first přístup** — na začátku vše v jednom procesu, architektura umožňuje pozdější extrakci do samostatných kontejnerů

---

## 2. Návrh komponent

### 2.1 Master Agent (Orchestrátor)

Centrální řídící agent zodpovědný za příjem požadavků, klasifikaci intentů, routing na sub-agenty a správu konverzačního kontextu.

**Zodpovědnosti:**
- Přijímání uživatelských požadavků z kanálů (WhatsApp, REST API, CLI)
- Klasifikace intentu (který sub-agent má požadavek zpracovat)
- Routing zpráv na příslušné sub-agenty
- Udržování globálního konverzačního kontextu
- Agregace výsledků z sub-agentů
- Vynucování permission modelu

**Rozhraní:**

```typescript
interface IMasterAgent {
  id: string;
  initialize(): Promise<void>;
  handleUserMessage(message: UserMessage): Promise<AgentResponse>;
  registerSubAgent(agent: ISubAgent): void;
  unregisterSubAgent(agentId: string): void;
  getRegisteredAgents(): SubAgentInfo[];
  routeToAgent(agentId: string, message: AgentMessage): Promise<AgentResponse>;
}
```

**Implementační detaily:**
- Drží `SubAgentRegistry` — in-memory mapa registrovaných sub-agentů s metadaty a capabilities
- Při příjmu zprávy používá LLM pro určení intentu + cílového agenta, poté dispatchuje přes message bus
- Udržuje `ConversationContext` objekt (rolling conversation window, user preferences, active agent state)

### 2.2 Sub-Agent Framework

Každý sub-agent je samostatná jednotka, která se registruje u Master Agenta, deklaruje své schopnosti a zpracovává routované zprávy.

**Rozhraní:**

```typescript
interface ISubAgent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];         // např. ["obsidian.read", "obsidian.write", "obsidian.search"]
  requiredSkills: string[];       // ID skillů, které agent potřebuje

  initialize(context: AgentContext): Promise<void>;
  handleMessage(message: AgentMessage): Promise<AgentResponse>;
  shutdown(): Promise<void>;
  getHealthStatus(): HealthStatus;
}
```

**Životní cyklus sub-agenta:**

1. **Discovery** — Master Agent skenuje konfigurovaný adresář nebo přijímá registrace přes message bus
2. **Registration** — Sub-agent posílá `REGISTER` zprávu s manifestem (id, capabilities, required skills)
3. **Initialization** — Master Agent volá `initialize()` s kontextem (config, skill references, LLM provider)
4. **Active** — Sub-agent zpracovává zprávy
5. **Shutdown** — Graceful shutdown při SIGTERM nebo explicitní unregister

**Vzor definice sub-agenta:**

```typescript
// src/agents/obsidian-agent/index.ts
export const createObsidianAgent = (config: ObsidianAgentConfig): ISubAgent => { ... }
```

### 2.3 Skills / Modules vrstva

Skilly jsou znovupoužitelné, kompozitní jednotky funkcionality, které agenti využívají. Nejsou to agenti — nemají autonomní chování. Jsou to nástroje.

**Rozhraní:**

```typescript
interface ISkill {
  id: string;
  name: string;
  version: string;
  description: string;

  initialize(config: SkillConfig): Promise<void>;
  execute(action: string, params: Record<string, unknown>): Promise<SkillResult>;
  getAvailableActions(): ActionDescriptor[];
  shutdown(): Promise<void>;
}

interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  actions: ActionDescriptor[];
  configSchema: JSONSchema;       // JSON Schema pro validaci
  permissions: string[];          // vyžadovaná oprávnění
}
```

**Balíčkování skillů:**
- Každý skill má `skill.manifest.json` ve svém kořeni
- Skilly načítá `SkillRegistry`, který skenuje `src/skills/` a validuje manifesty
- Skilly podporují nezávislé verzování (semver)
- Skilly jsou do agentů injektovány přes dependency injection během inicializace

**Příklady skillů:** `llm-chat`, `markdown-parser`, `file-system`, `http-client`, `obsidian-sync`, `web-search`

### 2.4 Komunikační vrstva

**Formát zpráv:**

```typescript
interface AgentMessage {
  id: string;                     // UUID
  timestamp: number;
  source: string;                 // agent ID
  target: string;                 // agent ID nebo '*' pro broadcast
  type: MessageType;              // REQUEST | RESPONSE | EVENT | SYSTEM
  action: string;                 // např. "obsidian.read", "obsidian.search"
  payload: Record<string, unknown>;
  conversationId: string;         // váže zprávy ke konverzaci
  parentMessageId?: string;       // pro request-response korelaci
  metadata?: Record<string, unknown>;
}

enum MessageType {
  REQUEST = 'REQUEST',
  RESPONSE = 'RESPONSE',
  EVENT = 'EVENT',
  SYSTEM = 'SYSTEM'
}
```

**Message Bus rozhraní:**

```typescript
interface IMessageBus {
  publish(channel: string, message: AgentMessage): Promise<void>;
  subscribe(channel: string, handler: MessageHandler): Subscription;
  unsubscribe(subscription: Subscription): void;
  request(channel: string, message: AgentMessage, timeout?: number): Promise<AgentMessage>;
}
```

**Implementace:**
- `InMemoryMessageBus` — používá Node.js `EventEmitter` pro single-process lokální vývoj
- `RedisMessageBus` — používá Redis Pub/Sub pro multi-container produkční nasazení

Metoda `request()` implementuje request-response korelaci: publikuje zprávu a čeká na odpověď s odpovídajícím `parentMessageId` (s konfigurovatelným timeoutem).

### 2.5 LLM Abstrakce

Jednotná vrstva pro komunikaci s různými LLM providery. Agenti nikdy nevolají LLM API přímo.

**Rozhraní:**

```typescript
interface ILLMProvider {
  id: string;
  chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse>;
  streamChat(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;
  getTokenCount(text: string): number;
}

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
}
```

**Implementace:**
- `OpenAIProvider` — wrapper nad `openai` SDK (GPT-4o, GPT-4.1)
- `AnthropicProvider` — wrapper nad `@anthropic-ai/sdk` (Claude Sonnet, Opus)
- `MistralProvider` — wrapper nad `@mistralai/mistralai` SDK (Mistral Large, Small, Codestral)
- `OllamaProvider` — lokální LLM přes Ollama HTTP API (Llama, Mistral, …), dynamické přepínání modelů za běhu, NDJSON streaming
- `LLMProviderFactory` — factory pro vytváření providerů na základě konfigurace

### 2.6 Channel abstrakce (vstupní kanály)

Systém podporuje více vstupních kanálů prostřednictvím jednotného rozhraní `IChannel`. Každý kanál přijímá zprávy ze svého zdroje, normalizuje je do `UserMessage` a předává Master Agentovi. Odpovědi z Master Agenta kanál formátuje zpět do nativního formátu daného zdroje.

**Rozhraní:**

```typescript
interface IChannel {
  id: string;
  name: string;
  type: ChannelType;

  initialize(config: ChannelConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ChannelStatus;

  // Callback pro příjem odpovědí z Master Agenta
  onMasterResponse(handler: (response: AgentResponse) => Promise<void>): void;
}

enum ChannelType {
  WHATSAPP = 'WHATSAPP',
  TELEGRAM = 'TELEGRAM',
  REST_API = 'REST_API',
  CLI = 'CLI'
}

interface ChannelStatus {
  connected: boolean;
  authenticated: boolean;
  lastActivity?: number;
  metadata?: Record<string, unknown>;
}
```

**Channel Router:**

```typescript
interface IChannelRouter {
  registerChannel(channel: IChannel): void;
  unregisterChannel(channelId: string): void;
  getActiveChannels(): ChannelStatus[];

  // Normalizuje zprávy z kanálů a předává Master Agentovi
  setMessageHandler(handler: (message: UserMessage, channelId: string) => Promise<AgentResponse>): void;
}
```

### 2.7 WhatsApp Interface (Baileys)

Primární konverzační rozhraní systému. Využívá knihovnu **Baileys** — TypeScript knihovnu pro automatizaci WhatsApp Web přes WebSocket protokol. Baileys se připojuje jako Linked Device (spárované zařízení) k osobnímu WhatsApp účtu.

> Dokumentace: https://baileys.wiki/docs/intro/

**Klíčové vlastnosti Baileys:**
- Přímá komunikace přes WhatsApp Web WebSocket protokol (bez browser automatizace)
- Připojení přes Linked Devices (osobní nebo business účet)
- Event-driven architektura (EventEmitter pattern)
- Podpora textu, obrázků, dokumentů, hlasových zpráv, reakcí
- TypeScript-native

**Architektura WhatsApp kanálu:**

```
┌─────────────────────────────────────────────┐
│           WhatsApp Channel                   │
│                                              │
│  ┌──────────────┐    ┌───────────────────┐  │
│  │  Baileys      │    │  Message          │  │
│  │  Connection   │───▶│  Normalizer       │  │
│  │  Manager      │    │  (WA → UserMsg)   │  │
│  └──────┬───────┘    └────────┬──────────┘  │
│         │                     │              │
│  ┌──────▼───────┐    ┌───────▼──────────┐   │
│  │  Auth State   │    │  Response         │  │
│  │  Manager      │    │  Formatter        │  │
│  │  (session     │    │  (AgentResp → WA) │  │
│  │   persistence)│    └──────────────────┘   │
│  └──────────────┘                            │
└──────────────────────────────────────────────┘
```

**Komponenty:**

| Komponenta | Zodpovědnost |
|---|---|
| `BaileysConnectionManager` | Správa WebSocket spojení, reconnect logika, QR kód / pairing code autentizace |
| `AuthStateManager` | Persistence auth stavu mezi restarty (multi-file auth state) — vlastní produkční implementace |
| `MessageNormalizer` | Konverze WhatsApp zpráv (`WAMessage`) na interní `UserMessage` formát |
| `ResponseFormatter` | Konverze `AgentResponse` na WhatsApp zprávy (text, obrázky, dokumenty, formátování) |

**Rozhraní WhatsApp kanálu:**

```typescript
interface IWhatsAppChannel extends IChannel {
  type: ChannelType.WHATSAPP;

  // Autentizace
  getQRCode(): Promise<string | null>;
  getPairingCode(phoneNumber: string): Promise<string>;
  isAuthenticated(): boolean;

  // Filtry — pouze vybrané kontakty mohou komunikovat s botem
  setAllowedContacts(jids: string[]): void;
  getAllowedContacts(): string[];
}

interface WhatsAppChannelConfig extends ChannelConfig {
  // Autentizace
  authStateDir: string;            // Adresář pro uložení session dat
  authMethod: 'qr' | 'pairing';   // Metoda párování

  // Filtry
  allowedContacts: string[];       // WhatsApp JIDs povolených kontaktů
  allowSelf: boolean;              // Povolit zprávy od vlastního čísla

  // Chování
  readMessages: boolean;           // Označovat zprávy jako přečtené
  typingIndicator: boolean;        // Zobrazovat "píše..." při zpracování
  maxMessageLength: number;        // Max délka odpovědi (WhatsApp limit ~65536)

  // Reconnect
  reconnectInterval: number;       // ms mezi pokusy o reconnect
  maxReconnectAttempts: number;
}
```

**Mapování zpráv:**

| WhatsApp typ | → UserMessage typ | Poznámka |
|---|---|---|
| Textová zpráva | `text` | Přímý text |
| Obrázek + caption | `image` | Base64 + popis |
| Dokument | `document` | Soubor jako příloha |
| Hlasová zpráva | `audio` | Vyžaduje speech-to-text skill pro zpracování |
| Reakce | `reaction` | Emoji reakce na předchozí zprávu |
| Reply (citace) | `text` + `replyTo` | Text s referencí na původní zprávu |

**Bezpečnostní opatření:**
- **Allowlist kontaktů** — bot reaguje pouze na zprávy od explicitně povolených WhatsApp čísel (JIDs)
- **Rate limiting** — ochrana proti flood zprávám
- **Auth state persistence** — vlastní implementace ukládání session (Baileys výchozí `useMultiFileAuthState` není určen pro produkci)
- **Žádný spam** — systém je navržen výhradně pro osobní použití, nikoli hromadné zprávy

**Důležité:** Baileys není oficiální WhatsApp Business API (WABA). Používá reverse-engineered protokol WhatsApp Web. Pro osobní použití je to adekvátní řešení, ale není to oficiálně podporované WhatsAppem.

---

## 3. První sub-agent: Obsidian Agent

### 3.1 Popis

Agent pro správu obsahu Markdown souborů v Obsidian vaultu. Umožňuje čtení, vytváření, editaci a vyhledávání poznámek. Synchronizace s remote vaultem přes Obsidian Headless sync.

### 3.2 Capabilities

| Capability | Popis |
|---|---|
| `obsidian.read` | Čtení obsahu MD souboru podle cesty |
| `obsidian.write` | Vytvoření nebo přepsání MD souboru |
| `obsidian.edit` | Částečná editace existujícího souboru |
| `obsidian.search` | Full-text vyhledávání napříč vaultem |
| `obsidian.list` | Výpis souborů a složek ve vaultu |
| `obsidian.metadata` | Čtení/zápis YAML frontmatter metadat |
| `obsidian.sync` | Spuštění synchronizace přes Headless sync |
| `obsidian.task` | Přidání úkolu do `tasks.md` (formát `- [ ] text`) |
| `obsidian.daily` | Zápis do denní poznámky `daily/YYYY-MM-DD.md` (formát `- **HH:MM** text`) |

### 3.3 Požadované skilly

- `file-system` — operace se soubory (CRUD na MD souborech)
- `markdown-parser` — parsování a manipulace s Markdown/YAML frontmatter
- `obsidian-sync` — integrace s Obsidian Headless sync API

### 3.4 Konfigurace

```yaml
# config/agents.yaml
agents:
  - id: "obsidian-agent"
    enabled: true
    config:
      vaultPath: "/path/to/obsidian/vault"
      syncEnabled: true
      defaultFolder: "/"
      taskFile: "tasks.md"           # cílový soubor pro úkoly
      dailyNotesFolder: "daily"      # složka pro denní poznámky
      excludePatterns:
        - ".obsidian/**"
        - ".trash/**"
```

### 3.5 Architektura Obsidian Agenta

```
┌─────────────────────────────────┐
│        Obsidian Agent           │
│                                 │
│  ┌───────────┐ ┌─────────────┐ │
│  │  Intent    │ │ Vault       │ │
│  │  Handler   │ │ Manager     │ │
│  └─────┬─────┘ └──────┬──────┘ │
│        │               │        │
│  ┌─────▼───────────────▼──────┐ │
│  │     Skill Orchestrator     │ │
│  └─────┬──────────┬───────────┘ │
└────────┼──────────┼─────────────┘
         │          │
   ┌─────▼────┐ ┌──▼───────────┐
   │file-system│ │markdown-parser│
   │  skill    │ │   skill      │
   └──────────┘ └──────────────┘

### 3.6 Smart Write Routing

Intent router rozlišuje typ zápisu na základě klíčových slov (priorita: daily → task → write):

| Zpráva | Akce | Cíl | Formát |
|---|---|---|---|
| "Přidej úkol: Zavolat" | `obsidian.task` | `tasks.md` | `- [ ] Zavolat` |
| "Denní poznámka: meeting" | `obsidian.daily` | `daily/YYYY-MM-DD.md` | `- **HH:MM** meeting` |
| "Vytvoř poznámku X" | `obsidian.write` | `X.md` | Nový soubor s frontmatter |

**VaultManager.appendToNote()** — create-or-append pattern:
- Soubor existuje → `fileSystem.append(path, content)`
- Soubor neexistuje → `writeNote(path, content, frontmatter)` (vytvoří s YAML frontmatter)

### 3.7 Obsidian Sync (Docker architektura)

V produkci běží `obsidian-headless` CLI v separátním kontejneru:

```
┌──────────────┐    ┌──────────────────────────┐
│  dbot         │    │  obsidian-sync            │
│  (Node.js)    │    │  (obsidian-headless CLI)  │
│  FileSystem   │    │  sync-entrypoint.sh       │
│  write /vault │    │  periodic poll → cloud    │
└───────┬───────┘    └────────────┬──────────────┘
        │                         │
        └─────── vault-data ──────┘
                (shared volume, RW)
                         │
              ┌──────────▼──────────┐
              │   Obsidian Cloud     │
              │   (E2E encrypted)    │
              └─────────────────────┘
```

DBot píše poznámky → `sync-entrypoint.sh` provádí periodický polling (konfigurovatelný interval přes `OBSIDIAN_SYNC_INTERVAL`, výchozí 30s) → pushne do Obsidian Cloud → synchronizace na všechna zařízení.

> **Poznámka:** Docker shared volumes nepodporují inotify cross-container, proto byl `ob sync --continuous` nahrazen periodickým pollingem (loop v entrypointu). Entrypoint `sync-entrypoint.sh` zajišťuje auto-login: nejprve `ob login` (account password), poté `ob sync-setup --password` (vault encryption password) — systém vyžaduje DVĚ hesla.
```

---

## 4. Struktura projektu

```
dbot/
├── docker/
│   ├── Dockerfile                    # Multi-stage build pro produkci
│   ├── Dockerfile.dev                # Dev s hot-reload
│   ├── Dockerfile.sync               # Obsidian Headless sync kontejner
│   └── docker-compose.yml           # dbot + redis + obsidian-sync orchestrace
├── docs/
│   ├── specification.md
│   └── solutiondesign.md
├── src/
│   ├── core/                         # Sdílené jádro (framework)
│   │   ├── interfaces/               # Všechna TypeScript rozhraní
│   │   │   ├── agent.interface.ts
│   │   │   ├── skill.interface.ts
│   │   │   ├── message.interface.ts
│   │   │   ├── llm.interface.ts
│   │   │   └── index.ts
│   │   ├── message-bus/
│   │   │   ├── message-bus.interface.ts
│   │   │   ├── in-memory.message-bus.ts
│   │   │   ├── redis.message-bus.ts
│   │   │   └── index.ts
│   │   ├── llm/
│   │   │   ├── llm-provider.factory.ts
│   │   │   ├── openai.provider.ts
│   │   │   ├── anthropic.provider.ts
│   │   │   ├── mistral.provider.ts
│   │   │   ├── ollama.provider.ts
│   │   │   └── index.ts
│   │   ├── registry/
│   │   │   ├── agent.registry.ts
│   │   │   └── skill.registry.ts
│   │   ├── permissions/
│   │   │   ├── permission.manager.ts
│   │   │   └── permission.types.ts
│   │   ├── config/
│   │   │   ├── config.loader.ts
│   │   │   └── config.schema.ts
│   │   └── utils/
│   │       ├── logger.ts
│   │       └── errors.ts
│   ├── channels/                       # Vstupní kanály
│   │   ├── channel.interface.ts
│   │   ├── channel-router.ts
│   │   ├── whatsapp/
│   │   │   ├── whatsapp.channel.ts      # IWhatsAppChannel implementace
│   │   │   ├── baileys-connection.ts    # Baileys WebSocket management
│   │   │   ├── auth-state.ts            # Produkční auth state persistence
│   │   │   ├── message-normalizer.ts    # WAMessage → UserMessage
│   │   │   ├── response-formatter.ts    # AgentResponse → WA zpráva
│   │   │   └── index.ts
│   │   ├── telegram/
│   │   │   ├── telegram.channel.ts
│   │   │   ├── message-normalizer.ts
│   │   │   ├── response-formatter.ts
│   │   │   └── index.ts
│   │   ├── rest-api/
│   │   │   └── rest-api.channel.ts
│   │   └── cli/
│   │       └── cli.channel.ts
│   ├── master-agent/
│   │   ├── master-agent.ts
│   │   ├── intent-router.ts
│   │   ├── conversation-context.ts
│   │   └── index.ts
│   ├── agents/                       # Sub-agenti
│   │   ├── obsidian-agent/
│   │   │   ├── obsidian-agent.ts
│   │   │   ├── obsidian-agent.config.ts
│   │   │   ├── vault-manager.ts
│   │   │   └── index.ts
│   │   └── _template/               # Šablona pro nové agenty
│   │       ├── template-agent.ts
│   │       ├── template-agent.config.ts
│   │       └── index.ts
│   ├── skills/                       # Skilly / moduly
│   │   ├── llm-chat/
│   │   │   ├── llm-chat.skill.ts
│   │   │   ├── skill.manifest.json
│   │   │   └── index.ts
│   │   ├── file-system/
│   │   │   ├── file-system.skill.ts
│   │   │   ├── skill.manifest.json
│   │   │   └── index.ts
│   │   ├── markdown-parser/
│   │   │   ├── markdown-parser.skill.ts
│   │   │   ├── skill.manifest.json
│   │   │   └── index.ts
│   │   ├── obsidian-sync/
│   │   │   ├── obsidian-sync.skill.ts
│   │   │   ├── skill.manifest.json
│   │   │   └── index.ts
│   │   └── _template/
│   │       ├── template.skill.ts
│   │       ├── skill.manifest.json
│   │       └── index.ts
│   ├── api/                          # REST API vrstva
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── chat.routes.ts        # POST /api/v1/chat
│   │   │   ├── agents.routes.ts      # GET /api/v1/agents
│   │   │   ├── skills.routes.ts      # GET /api/v1/skills
│   │   │   ├── permissions.routes.ts # GET/POST /api/v1/permissions
│   │   │   ├── llm.routes.ts        # GET/POST /api/v1/llm
│   │   │   └── health.routes.ts      # GET /api/v1/health
│   │   └── middleware/
│   │       ├── auth.middleware.ts
│   │       └── error.middleware.ts
│   └── main.ts                       # Entry point — bootstrap
├── config/
│   ├── default.yaml                  # Výchozí konfigurace
│   ├── agents.yaml                   # Registrace agentů
│   ├── skills.yaml                   # Konfigurace skillů
│   └── permissions.yaml              # Inter-agent oprávnění
├── tests/
│   ├── unit/
│   │   ├── core/
│   │   ├── master-agent/
│   │   ├── agents/
│   │   └── skills/
│   ├── integration/
│   └── fixtures/
├── package.json
├── tsconfig.json
├── .env.example
├── .eslintrc.js
├── .prettierrc
└── CLAUDE.md
```

---

## 5. Tech stack

| Kategorie | Technologie | Důvod výběru |
|---|---|---|
| Runtime | Node.js 20 LTS + TypeScript 5.x | Dle specifikace |
| WhatsApp | **Baileys** (`@whiskeysockets/baileys`) | WhatsApp Web WebSocket protokol, TypeScript-native, Linked Devices |
| HTTP Framework | **Fastify** | Rychlejší než Express, nativní TypeScript, vestavěná validace schémat |
| LLM — OpenAI | `openai` (oficiální SDK) | GPT-4o, GPT-4.1 |
| LLM — Anthropic | `@anthropic-ai/sdk` | Claude Sonnet, Opus |
| LLM — Mistral | `@mistralai/mistralai` | Mistral Large, Small, Codestral |
| LLM — Ollama | HTTP API (fetch) | Lokální modely (Llama 3.1, Mistral, …), dynamické přepínání |
| Message Bus (dev) | `eventemitter3` | Zero-dependency, in-process |
| Message Bus (prod) | `ioredis` | Redis Pub/Sub pro multi-container |
| Konfigurace | `convict` + `js-yaml` | Validace schématu, environment overrides, YAML |
| Logování | `pino` | Rychlé strukturované logování, nativní integrace s Fastify |
| Validace | `zod` | Runtime type validace, TypeScript-first, generuje JSON Schema |
| Testování | `vitest` | Rychlé, TypeScript-native, kompatibilní s Jest API |
| Kontejnerizace | Docker + Docker Compose | Dle specifikace |
| Dev runtime | `tsx` | TS spuštění bez build kroku ve vývoji |
| Linting | `eslint` + `@typescript-eslint` | Standardní TS linting |
| Formátování | `prettier` | Konzistentní formátování |
| Markdown | `remark` + `gray-matter` | Parsování MD + YAML frontmatter pro Obsidian Agent |

---

## 6. Kontejnerová architektura

### Dockerfile (multi-stage build)

```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Stage 2: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY config ./config
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### Docker Compose (lokální vývoj)

```yaml
services:
  dbot:
    build:
      context: ..
      dockerfile: docker/Dockerfile.dev
    ports:
      - "3000:3000"
    volumes:
      - ../src:/app/src
      - ../config:/app/config
      - ../data:/app/data               # WhatsApp auth state persistence
    environment:
      - NODE_ENV=development
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

**Strategie škálování:** V počáteční implementaci běží všichni agenti v jednom procesu (monolit). Abstrakce `IMessageBus` umožňuje pozdější extrakci agentů do samostatných kontejnerů komunikujících přes Redis — bez přepisování business logiky.

---

## 7. Konfigurace a prostředí

### Vrstvená konfigurace (convict)

1. `config/default.yaml` — výchozí hodnoty
2. `config/{NODE_ENV}.yaml` — environment overrides (např. `production.yaml`)
3. Environment variables — nejvyšší priorita (12-factor app)

### Hlavní konfigurační struktura

```yaml
# config/default.yaml
server:
  port: 3000
  host: "0.0.0.0"

llm:
  defaultProvider: "mistral"
  providers:
    openai:
      model: "gpt-4o"
      # apiKey z env: OPENAI_API_KEY
    anthropic:
      model: "claude-sonnet-4-20250514"
      # apiKey z env: ANTHROPIC_API_KEY
    ollama:
      model: "llama3.1"
      baseUrl: "http://localhost:11434"
      keepAlive: "5m"
      timeout: 120000

messageBus:
  type: "in-memory"               # nebo "redis"
  redis:
    host: "localhost"
    port: 6379

logging:
  level: "info"
```

### WhatsApp konfigurace

```yaml
# config/default.yaml (rozšíření)
channels:
  whatsapp:
    enabled: true
    authMethod: "qr"                # "qr" nebo "pairing"
    authStateDir: "./data/whatsapp-auth"
    allowedContacts:
      - "420xxxxxxxxx@s.whatsapp.net"   # Vlastní číslo
    allowSelf: true
    readMessages: true
    typingIndicator: true
    maxMessageLength: 4096
    reconnectInterval: 5000
    maxReconnectAttempts: 10

  restApi:
    enabled: true

  cli:
    enabled: false
```

**Environment variables** používají vzor `DBOT__{SECTION}__{KEY}`, např. `DBOT__LLM__DEFAULT_PROVIDER=anthropic`.

---

## 8. Bezpečnostní model

Systém oprávnění má tři vrstvy:

### Vrstva 1: Uživatelská oprávnění

Uživatel kontroluje, co systém může globálně dělat. Uloženo v `config/permissions.yaml`, přepisovatelné přes API.

### Vrstva 2: Inter-agent komunikace

Explicitní allowlist model. Ve výchozím stavu agenti **NEMOHOU** komunikovat mezi sebou. Uživatel musí explicitně povolit každý komunikační pár a specifikovat povolené akce.

```yaml
# config/permissions.yaml
interAgentCommunication:
  enabled: false                   # Globální kill switch
  allowedPairs:
    - source: "obsidian-agent"
      target: "calendar-agent"
      actions: ["calendar.check-availability"]
      requireConfirmation: true    # Ptát se uživatele před každou zprávou
```

**Implementace:**

```typescript
interface PermissionRule {
  source: string;                  // agent ID
  target: string;                  // agent ID
  actions: string[];               // povolené akce, nebo ['*'] pro všechny
  conditions?: {
    requireConfirmation: boolean;  // ptát se uživatele před každou zprávou
    rateLimit?: number;            // max zpráv za minutu
  };
}

interface IPermissionManager {
  canCommunicate(source: string, target: string, action: string): boolean;
  requiresConfirmation(source: string, target: string, action: string): boolean;
  addRule(rule: PermissionRule): void;
  removeRule(source: string, target: string): void;
  getAllRules(): PermissionRule[];
}
```

`PermissionManager` je injektován do `MessageBus`. Každá zpráva je ověřena před doručením.

### Vrstva 3: Skill oprávnění

Skilly deklarují požadovaná oprávnění v manifestu (např. `["filesystem.read", "network.http"]`). `SkillRegistry` validuje, že agent načítající skill má udělena příslušná oprávnění.

---

## 9. Rozšiřitelnost

### Přidání nového vstupního kanálu

1. Vytvořit novou třídu implementující `IChannel` v `src/channels/{nový-kanál}/`
2. Implementovat `MessageNormalizer` (konverze nativních zpráv → `UserMessage`)
3. Implementovat `ResponseFormatter` (konverze `AgentResponse` → nativní formát)
4. Přidat konfiguraci do `config/default.yaml` pod `channels`
5. Zaregistrovat kanál v `ChannelRouter`

Příklady budoucích kanálů: Telegram, Slack, Discord, webový widget.

### Přidání nového sub-agenta

1. Zkopírovat `src/agents/_template/` do `src/agents/{nový-agent}/`
2. Implementovat rozhraní `ISubAgent`
3. Exportovat factory funkci
4. Přidat konfiguraci do `config/agents.yaml`
5. (Volitelně) Přidat permission pravidla do `config/permissions.yaml`

Master Agent auto-discovery agentů na základě konfigurace — žádné změny v core kódu nejsou potřeba.

### Přidání nového skillu

1. Zkopírovat `src/skills/_template/` do `src/skills/{nový-skill}/`
2. Implementovat rozhraní `ISkill`
3. Vytvořit `skill.manifest.json` s popisem akcí a konfiguračním schématem
4. Přidat konfiguraci do `config/skills.yaml`
5. Referencovat skill ID v poli `requiredSkills` sub-agenta

### Přidání nového LLM providera

1. Vytvořit novou třídu implementující `ILLMProvider` v `src/core/llm/`
2. Zaregistrovat ji v `LLMProviderFactory`
3. Přidat konfiguraci pod `llm.providers` v configu

---

## 10. Implementační roadmapa

### Fáze 1 — Základ (core framework)
- [ ] Scaffolding projektu (`package.json`, `tsconfig.json`, Docker setup)
- [ ] Core rozhraní (`src/core/interfaces/`)
- [ ] Config loader
- [ ] Logger (pino)
- [ ] In-memory message bus

### Fáze 2 — Master Agent
- [ ] Master Agent skeleton
- [ ] Agent registry
- [ ] Skill registry
- [ ] Základní intent router (hardcoded routing, LLM-based později)
- [ ] REST API s health a chat endpointy

### Fáze 3 — Channel abstrakce + WhatsApp (Baileys)
- [ ] `IChannel` rozhraní a `ChannelRouter`
- [ ] REST API channel (refactor stávajícího API do channel patternu)
- [ ] Baileys integrace — `BaileysConnectionManager` + WebSocket spojení
- [ ] Auth state persistence (vlastní produkční implementace)
- [ ] QR kód / pairing code autentizace
- [ ] `MessageNormalizer` (WhatsApp zprávy → `UserMessage`)
- [ ] `ResponseFormatter` (`AgentResponse` → WhatsApp zprávy)
- [ ] Allowlist kontaktů + rate limiting
- [ ] End-to-end flow: WhatsApp zpráva → Channel → Master Agent → odpověď → WhatsApp

### Fáze 4 — LLM integrace
- [ ] `ILLMProvider` implementace pro OpenAI
- [ ] `ILLMProvider` implementace pro Anthropic
- [ ] LLM-based intent router v Master Agentovi
- [ ] Správa konverzačního kontextu

### Fáze 5 — Obsidian Agent
- [ ] `file-system` skill
- [ ] `markdown-parser` skill
- [ ] `obsidian-sync` skill (Headless sync integrace)
- [ ] Obsidian Agent implementace
- [ ] End-to-end flow: WhatsApp → Master Agent → Obsidian Agent → skill → WhatsApp odpověď

### Fáze 6 — Permission systém + inter-agent komunikace
- [ ] Permission manager
- [ ] Integrace message bus s permission checks
- [ ] Inter-agent messaging testy

### Fáze 7 — Kontejnerizace + produkční připravenost
- [ ] Multi-stage Dockerfile
- [ ] Redis message bus implementace
- [ ] Docker Compose pro full stack
- [ ] Strukturované logování + error handling hardening

---

## 11. Klíčové designové principy

| Princip | Popis |
|---|---|
| **Dependency Injection** | Všechny hlavní komponenty přijímají závislosti přes konstruktor nebo factory — umožňuje testování a výměnu implementací |
| **Interface-first** | Nejprve TypeScript rozhraní, pak implementace — čisté kontrakty mezi vrstvami |
| **Monolith-first** | Start jako single process, message bus abstrakce umožňuje pozdější extrakci do mikroslužeb |
| **Configuration over code** | Registrace agentů, načítání skillů, oprávnění — vše řízeno konfigurací |
| **Explicit over implicit** | Zejména pro inter-agent komunikaci — nic se neděje automaticky bez explicitního povolení uživatele |

---

## 12. Testovací strategie

### Testovací pyramida

```
        ╱ E2E testy ╲                    ← 5-10 scénářů (pomalé, plná integrace)
       ╱──────────────╲
      ╱ Integrační testy╲               ← 15-25 scénářů (více komponent dohromady)
     ╱────────────────────╲
    ╱    Unit testy         ╲            ← 50+ scénářů (rychlé, izolované)
   ╱──────────────────────────╲
```

**Framework:** Vitest (TypeScript-native, Jest-kompatibilní API)
**Struktura:** `tests/unit/` (zrcadlí `src/`), `tests/integration/`, `tests/e2e/`
**Pokrytí:** Cíl ≥ 80 % řádkového pokrytí pro `src/core/` a `src/channels/`

### Mock strategie

| Závislost | Mock přístup | Poznámka |
|---|---|---|
| Baileys (`makeWASocket`) | Vlastní mock vracející EventEmitter + stub metody (`sendMessage`, `sendPresenceUpdate`) | Simulace příchozích zpráv přes `emit('messages.upsert', ...)` |
| OpenAI SDK | `vi.mock('openai')` — mock `chat.completions.create()` | Vrací předpřipravené `LLMResponse` |
| Anthropic SDK | `vi.mock('@anthropic-ai/sdk')` — mock `messages.create()` | Vrací předpřipravené `LLMResponse` |
| Filesystem | `vi.mock('fs/promises')` nebo temp adresář (`os.tmpdir()`) | Unit: mock, integrační: reálný temp dir |
| Redis | `ioredis-mock` nebo testcontainers | Unit: mock, integrační: reálný Redis v kontejneru |
| Obsidian Headless sync | Mock HTTP server (`msw` nebo `nock`) | Simulace sync API odpovědí |

### 12.1 Unit testy

#### Core — Message Bus

| # | Scénář | Vstup | Očekávaný výsledek |
|---|---|---|---|
| U1 | Publish + subscribe doručí zprávu | `publish('ch', msg)` po `subscribe('ch', handler)` | `handler` volán s `msg` |
| U2 | Unsubscribe zastaví doručování | `unsubscribe(sub)` + `publish` | `handler` NENÍ volán |
| U3 | Request-response korelace | `request('ch', msg, 5000)` + odpověď s `parentMessageId` | `request()` resolve s odpovědí |
| U4 | Request timeout | `request('ch', msg, 100)` bez odpovědi | `request()` reject s timeout chybou |
| U5 | Broadcast doručení | `publish('*', msg)` | Všichni subscriberi na `*` obdrží zprávu |

#### Core — Config Loader

| # | Scénář | Vstup | Očekávaný výsledek |
|---|---|---|---|
| U6 | Načtení výchozí konfigurace | `config/default.yaml` existuje | Config objekt s validními hodnotami |
| U7 | Environment override | `DBOT__LLM__DEFAULT_PROVIDER=anthropic` | `config.llm.defaultProvider === 'anthropic'` |
| U8 | Nevalidní konfigurace | YAML s chybějícím povinným polem | Zod validační chyba |
| U9 | Vrstvení konfigurací | `default.yaml` + `production.yaml` | Produkční hodnoty přepisují výchozí |

#### Channels — Message Normalizer

| # | Scénář | Vstup (WAMessage) | Očekávaný výsledek (UserMessage) |
|---|---|---|---|
| U10 | Textová zpráva | `{ message: { conversation: "hello" } }` | `{ type: 'text', content: 'hello' }` |
| U11 | Extended text (reply) | `{ message: { extendedTextMessage: { text: "reply", contextInfo: { quotedMessage: ... } } } }` | `{ type: 'text', content: 'reply', replyTo: '...' }` |
| U12 | Obrázek s caption | `{ message: { imageMessage: { caption: "foto", ... } } }` | `{ type: 'image', content: 'foto', attachment: base64 }` |
| U13 | Dokument | `{ message: { documentMessage: { fileName: "doc.pdf", ... } } }` | `{ type: 'document', attachment: base64, metadata: { fileName: 'doc.pdf' } }` |
| U14 | Hlasová zpráva | `{ message: { audioMessage: { ptt: true, ... } } }` | `{ type: 'audio', attachment: base64 }` |
| U15 | Reakce | `{ message: { reactionMessage: { text: "👍", key: ... } } }` | `{ type: 'reaction', content: '👍', replyTo: '...' }` |

#### Channels — Response Formatter

| # | Scénář | Vstup (AgentResponse) | Očekávaný výsledek |
|---|---|---|---|
| U16 | Krátký text | `{ text: "Hotovo" }` | Jedna WA textová zpráva |
| U17 | Dlouhý text (>4096 znaků) | `{ text: "..." }` (5000 znaků) | 2 WA zprávy, správně rozdělené na hranici slova |
| U18 | Odpověď s obrázkem | `{ text: "Graf", image: base64 }` | WA imageMessage s caption |

#### Channels — WhatsApp Channel

| # | Scénář | Vstup | Očekávaný výsledek |
|---|---|---|---|
| U19 | Zpráva od povoleného kontaktu | JID v allowlistu | Zpráva předána Master Agentovi |
| U20 | Zpráva od nepovoleného kontaktu | JID mimo allowlist | Zpráva ignorována, log warning |
| U21 | Rate limit překročen | >N zpráv/min od jednoho JID | Další zprávy dočasně ignorovány |
| U22 | Reconnect po výpadku | `connection.update` s `connection: 'close'` | Automatický reconnect po `reconnectInterval` ms |

#### Master Agent — Intent Router

| # | Scénář | Vstup | Očekávaný výsledek |
|---|---|---|---|
| U23 | Hardcoded: Obsidian klíčové slovo | `"Přidej poznámku do Obsidianu"` | `{ agentId: 'obsidian-agent', action: 'obsidian.write' }` |
| U24 | Hardcoded: neznámý intent | `"Jaké je počasí?"` | Fallback odpověď (žádný agent) |
| U25 | LLM-based routing | Mock LLM vrátí `{ agentId: 'obsidian-agent' }` | Správný dispatch na obsidian-agent |
| U26 | LLM nedostupný | Mock LLM throwne error | Fallback na hardcoded routing |

#### LLM Providers

| # | Scénář | Vstup | Očekávaný výsledek |
|---|---|---|---|
| U27 | OpenAI chat | `[{ role: 'user', content: 'test' }]` | `LLMResponse` s vygenerovaným textem |
| U28 | Anthropic chat | `[{ role: 'user', content: 'test' }]` | `LLMResponse` s vygenerovaným textem |
| U29 | OpenAI stream | Stejný vstup | `AsyncIterable<LLMStreamChunk>` produkuje chunky |
| U30 | API error handling | Mock vrátí 429 (rate limit) | Propaguje se jako `DBotError` s kontextem |

#### Skills — File System

| # | Scénář | Vstup | Očekávaný výsledek |
|---|---|---|---|
| U31 | Read existující soubor | `execute('read', { path: 'note.md' })` | Obsah souboru |
| U32 | Read neexistující soubor | `execute('read', { path: 'missing.md' })` | `SkillError` |
| U33 | Write vytvoří adresáře | `execute('write', { path: 'sub/dir/note.md', content: '...' })` | Soubor vytvořen včetně adresářů |
| U34 | Path traversal mimo vault | `execute('read', { path: '../../etc/passwd' })` | `SkillError: Path outside vault` |
| U35 | List s glob pattern | `execute('list', { dir: '/', pattern: '*.md' })` | Pole MD souborů |

#### Skills — Markdown Parser

| # | Scénář | Vstup | Očekávaný výsledek |
|---|---|---|---|
| U36 | Get frontmatter | MD s YAML frontmatter `---\ntitle: Test\n---` | `{ title: 'Test' }` |
| U37 | Set frontmatter | Obsah + `{ tags: ['a'] }` | Aktualizovaný MD s novým frontmatter |
| U38 | Extract wikilinks | `Viz [[Projekt X]] a [[Meeting notes]]` | `['Projekt X', 'Meeting notes']` |
| U39 | Extract markdown links | `Viz [odkaz](http://x.com)` | `['http://x.com']` |
| U40 | Extract tags | `#projekt #důležité` | `['projekt', 'důležité']` |

#### Permissions

| # | Scénář | Vstup | Očekávaný výsledek |
|---|---|---|---|
| U41 | canCommunicate — povolený pár | source: A, target: B, action v pravidlech | `true` |
| U42 | canCommunicate — nepovolený pár | source: A, target: C, žádné pravidlo | `false` |
| U43 | requiresConfirmation | Pravidlo s `requireConfirmation: true` | `true` |
| U44 | Globální kill switch | `interAgentCommunication.enabled: false` | Vše vrátí `false` |
| U45 | Runtime přidání pravidla | `addRule(...)` → `canCommunicate(...)` | `true` po přidání |

### 12.2 Integrační testy

| # | Scénář | Komponenty | Postup | Očekávaný výsledek |
|---|---|---|---|---|
| I1 | REST API → Master Agent → echo | Fastify + Master Agent + Message Bus | `POST /api/v1/chat` s textem | `AgentResponse` s echo/fallback |
| I2 | WhatsApp zpráva → Master Agent | Mock Baileys + Channel Router + Master Agent | Emit `messages.upsert` s textovou zprávou od povoleného JID | Master Agent `handleUserMessage()` volán |
| I3 | Master Agent → Sub-Agent dispatch | Master Agent + Message Bus + Mock Sub-Agent | `handleUserMessage()` s obsidian intentem | Sub-agent obdrží `AgentMessage` |
| I4 | Obsidian Agent → File System skill | Obsidian Agent + file-system skill + temp dir | `handleMessage({ action: 'obsidian.write', ... })` | Soubor vytvořen v temp dir |
| I5 | Obsidian Agent → Markdown Parser | Obsidian Agent + markdown-parser + file-system + temp dir | Write note s frontmatter, pak read | Frontmatter správně zapsán a přečten |
| I6 | LLM intent routing | Master Agent + Mock LLM + Agent Registry | Zpráva → LLM klasifikace → routing | Správný agent obdrží zprávu |
| I7 | Permission blokace | Message Bus + Permission Manager | Zpráva A→B bez pravidla | `PermissionError`, zpráva nedoručena |
| I8 | Permission s potvrzením | Message Bus + Permission Manager + Mock kanál | Zpráva A→B s `requireConfirmation` | Potvrzovací otázka odeslána do kanálu |
| I9 | Config vrstvení end-to-end | Config Loader + default.yaml + env vars | Spuštění s `NODE_ENV=production` | Produkční overrides aktivní |
| I10 | Skill Registry načtení | Skill Registry + reálné skill.manifest.json | Sken `src/skills/` | Všechny manifesty načteny a validovány |
| I11 | Agent lifecycle | Master Agent + Mock Sub-Agent | Register → initialize → message → shutdown | Všechny fáze proběhnou v pořadí |
| I12 | Redis Message Bus | Redis bus + testcontainers Redis | publish/subscribe/request přes Redis | Zprávy doručeny mezi procesy |

### 12.3 End-to-End (E2E) testy

| # | Scénář | Popis | Postup | Očekávaný výsledek |
|---|---|---|---|---|
| E1 | WhatsApp → Obsidian write | Vytvoření poznámky přes WhatsApp | Odeslat "Vytvoř poznámku Test s obsahem: Hello World" | Soubor `vault/Test.md` existuje, bot odpoví potvrzením |
| E2 | WhatsApp → Obsidian search | Vyhledání poznámky přes WhatsApp | Odeslat "Najdi poznámku o meetingu" | Bot vrátí seznam nalezených souborů |
| E3 | WhatsApp → Obsidian read | Přečtení existující poznámky | Odeslat "Přečti poznámku Test" | Bot vrátí obsah souboru |
| E4 | WhatsApp → Obsidian sync | Synchronizace vaultu | Odeslat "Synchronizuj Obsidian" | Sync spuštěn, bot vrátí výsledek |
| E5 | REST API → Obsidian write | Stejný flow přes API | `POST /api/v1/chat` s write příkazem | Soubor vytvořen, `AgentResponse` vrácen |
| E6 | Neznámý intent | Zpráva bez mapování na agenta | Odeslat "Jaké je počasí?" | Bot odpoví fallback zprávou (ne crash) |
| E7 | Multi-turn konverzace | Kontext zachován mezi zprávami | 1: "Vytvoř poznámku X" → 2: "Přidej do ní tag #important" | Druhá zpráva rozumí kontextu první |
| E8 | WhatsApp allowlist | Bezpečnost — neautorizovaný přístup | Zpráva od neznámého čísla | Žádná odpověď, warning log |
| E9 | Graceful shutdown | Server se korektně vypne | SIGTERM → zpracování otevřených zpráv → shutdown | Exit code 0, žádná ztráta dat |
| E10 | Restart bez re-auth | WhatsApp session persistence | Restart aplikace | Bot se reconnectne bez QR kódu |

### 12.4 Testovací konfigurace

```yaml
# config/test.yaml
server:
  port: 0                           # Random port pro testy
llm:
  defaultProvider: "mock"           # Mock provider pro testy bez API klíčů
messageBus:
  type: "in-memory"
logging:
  level: "silent"                   # Tiché testy
channels:
  whatsapp:
    enabled: false                  # Vypnuto v unit/integration testech
  restApi:
    enabled: true
```

### 12.5 CI pipeline

```yaml
# Předpokládaný CI flow
test:
  - npm run lint                    # ESLint
  - npm run typecheck               # tsc --noEmit
  - npm run test:unit                # vitest run tests/unit/
  - npm run test:integration         # vitest run tests/integration/
  - npm run test:e2e                 # vitest run tests/e2e/ (vyžaduje Docker pro Redis)
  - npm run test:coverage            # vitest --coverage (cíl ≥ 80 %)
```
