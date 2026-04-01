# DBot — Detail Design

> Detailní technický popis fungování systému DBot
> Verze: 0.1.0 | Datum: 2026-03-29

---

## Obsah

1. [Přehled architektury](#1-přehled-architektury)
2. [Datové toky](#2-datové-toky)
3. [Vstupní vrstva (Channels)](#3-vstupní-vrstva-channels)
4. [Orchestrační vrstva (Master Agent)](#4-orchestrační-vrstva-master-agent)
5. [Komunikační vrstva (Message Bus)](#5-komunikační-vrstva-message-bus)
6. [Agenturní vrstva (Sub-Agents)](#6-agenturní-vrstva-sub-agents)
7. [Modulární vrstva (Skills)](#7-modulární-vrstva-skills)
8. [LLM vrstva](#8-llm-vrstva)
9. [Bezpečnostní model](#9-bezpečnostní-model)
10. [Konfigurační systém](#10-konfigurační-systém)
11. [REST API](#11-rest-api)
12. [Životní cyklus aplikace](#12-životní-cyklus-aplikace)
13. [Datové struktury a typy](#13-datové-struktury-a-typy)
14. [Error handling](#14-error-handling)
15. [Testovací architektura](#15-testovací-architektura)

---

## 1. Přehled architektury

DBot je vrstevnatý systém s jasně oddělenými zodpovědnostmi. Každá vrstva komunikuje výhradně přes definovaná TypeScript rozhraní, což umožňuje nezávislou výměnu implementací.

```
 Uživatel (WhatsApp / Telegram / REST API / CLI)
     │
     ▼
┌─────────────────────────────────────────────────┐
│              VSTUPNÍ VRSTVA                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ WhatsApp │ │ Telegram │ │ REST API │ │  CLI   │ │
│  │ Channel  │ │ Channel  │ │ Channel  │ │Channel │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │
│       └─────────────┴────────────┼───────────┘      │
│              ┌───────▼────────┐                  │
│              │ Channel Router │                  │
│              └───────┬────────┘                  │
└──────────────────────┼──────────────────────────┘
                       │ UserMessage
                       ▼
┌──────────────────────────────────────────────────┐
│            ORCHESTRAČNÍ VRSTVA                    │
│  ┌─────────────────────────────────────────┐     │
│  │            Master Agent                  │     │
│  │  ┌──────────┐ ┌──────────┐ ┌─────────┐ │     │
│  │  │  Intent  │ │Konverzace│ │  Agent  │ │     │
│  │  │  Router  │ │  Context │ │Registry │ │     │
│  │  └──────────┘ └──────────┘ └─────────┘ │     │
│  └──────────────────┬──────────────────────┘     │
└─────────────────────┼────────────────────────────┘
                      │ AgentMessage
                      ▼
┌──────────────────────────────────────────────────┐
│           KOMUNIKAČNÍ VRSTVA                      │
│  ┌──────────────────────────────────────────┐    │
│  │  Message Bus (InMemory / Redis Pub/Sub)  │    │
│  │  + Permission Manager                     │    │
│  └──────────────────┬───────────────────────┘    │
└─────────────────────┼────────────────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
┌──────────────────────────────────────────────────┐
│            AGENTURNÍ VRSTVA                       │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐    │
│  │ Obsidian  │  │ Agent B   │  │ Agent ... │    │
│  │  Agent    │  │           │  │           │    │
│  └─────┬─────┘  └───────────┘  └───────────┘    │
└────────┼─────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│           MODULÁRNÍ VRSTVA (Skills)               │
│  ┌────────────┐ ┌─────────────┐ ┌────────────┐  │
│  │ FileSystem │ │  Markdown   │ │  Obsidian  │  │
│  │   Skill    │ │   Parser    │ │    Sync    │  │
│  └────────────┘ └─────────────┘ └────────────┘  │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│              LLM VRSTVA                                              │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │  OpenAI  │ │ Anthropic  │ │ Mistral  │ │ Ollama │ │  Factory  │  │
│  │ Provider │ │  Provider  │ │ Provider │ │Provider│ │           │  │
│  └──────────┘ └────────────┘ └──────────┘ └────────┘ └───────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Vrstvená komunikace

Každá vrstva komunikuje **pouze se sousední vrstvou** (s výjimkou LLM, který je sdílený):

| Vrstva | Přijímá od | Předává do |
|---|---|---|
| Channels | Uživatel (nativní formát) | Master Agent (`UserMessage`) |
| Master Agent | Channel Router | Sub-Agent (`AgentMessage`) |
| Message Bus | Master Agent / Agenti | Cílový agent |
| Sub-Agents | Message Bus | Skills |
| Skills | Agent | Filesystem / HTTP / LLM |

---

## 2. Datové toky

### 2.1 Hlavní tok: uživatelská zpráva → odpověď

```
Uživatel pošle "Vytvoř poznámku Meeting notes s obsahem: Probíráno X, Y"
  │
  ▼
WhatsApp Channel
  ├─ BaileysConnectionManager zachytí `messages.upsert` event
  ├─ MessageNormalizer: WAMessage → UserMessage {type: 'text', content: '...', senderId: '420...@s.whatsapp.net'}
  ├─ Allowlist check: JID v povolených? → ano
  ├─ Rate limiter: token bucket check → ok (odebere 1 token)
  ├─ Typing indicator: sendPresenceUpdate('composing')
  │
  ▼
Channel Router
  ├─ handleIncoming(message, 'whatsapp')
  ├─ Volá messageHandler → MasterAgent.handleUserMessage()
  │
  ▼
Master Agent
  ├─ ConversationContext: vytvoří/načte konverzaci
  ├─ IntentRouter.route("Vytvoř poznámku Meeting notes s obsahem: Probíráno X, Y")
  │   ├─ [Pokud LLM dostupný]:
  │   │   ├─ Sestaví system prompt s capabilities všech agentů
  │   │   ├─ Volá LLMProvider.chat() → JSON {agentId: "obsidian-agent", action: "obsidian.write", confidence: 0.95}
  │   │   ├─ Validuje agentId existuje v AgentRegistry
  │   │   └─ confidence ≥ 0.5 → použije LLM výsledek
  │   └─ [Fallback — hardcoded]:
  │       ├─ Hledá klíčová slova: "poznámku" → capability prefix "obsidian"
  │       ├─ AgentRegistry.findByCapability("obsidian") → obsidian-agent
  │       ├─ inferAction(): "vytvoř" → "obsidian.write"
  │       └─ Vrací {agentId: "obsidian-agent", action: "obsidian.write", confidence: 0.7}
  │
  ├─ Sestaví AgentMessage {source: "master-agent", target: "obsidian-agent", action: "obsidian.write", payload: {content: "..."}}
  ├─ Volá routeToAgent("obsidian-agent", agentMessage)
  │   └─ AgentRegistry.get("obsidian-agent").handleMessage(agentMessage)
  │
  ▼
Obsidian Agent
  ├─ handleMessage(): switch na action "obsidian.write"
  ├─ handleWrite(content):
  │   ├─ parseWriteCommand("Vytvoř poznámku Meeting notes s obsahem: Probíráno X, Y")
  │   │   └─ Regex: title = "Meeting notes", body = "Probíráno X, Y"
  │   ├─ buildNotePath("Meeting notes") → "Meeting notes.md" (+ defaultFolder)
  │   └─ VaultManager.writeNote("Meeting notes.md", body, {created: new Date().toISOString()})
  │
  ▼
VaultManager
  ├─ MarkdownParserSkill.execute('stringify', {body, frontmatter}) → "---\ncreated: ...\n---\nProbíráno X, Y"
  ├─ FileSystemSkill.execute('write', {path: "Meeting notes.md", content: "---\n..."})
  │   ├─ safePath() → resolve("data/vault/Meeting notes.md")
  │   ├─ Prefix check: starts with basePath? → yes
  │   ├─ mkdirSync(dirname, {recursive: true})
  │   └─ writeFileSync()
  └─ Vrací SkillResult {success: true}
  │
  ▼
Obsidian Agent → AgentResponse {text: "Poznámka vytvořena: Meeting notes.md"}
  │
  ▼
Master Agent → ConversationContext.addEntry() → vrací AgentResponse
  │
  ▼
Channel Router → WhatsApp Channel
  ├─ ResponseFormatter.formatResponse():
  │   ├─ Text < 4096 znaků → jedna zpráva
  │   └─ sendMessage(jid, {text: "Poznámka vytvořena: Meeting notes.md"})
  └─ Typing indicator: sendPresenceUpdate('available')
  │
  ▼
Uživatel vidí odpověď na WhatsApp
```

### 2.2 Tok: inter-agent komunikace s permission check

```
Agent A chce poslat zprávu Agent B
  │
  ▼
Message Bus (publish)
  ├─ Detekuje: message.source && message.target → inter-agent zpráva
  ├─ PermissionManager.check(sourceId, targetId, action)
  │   ├─ [enabled: false] → BLOKOVÁNO ("globally disabled")
  │   ├─ [enabled: true, no rule] → BLOKOVÁNO ("No permission rule")
  │   ├─ [enabled: true, rule, requireConfirmation: true]:
  │   │   ├─ Emituje 'permission:confirmation-required' event
  │   │   ├─ Master Agent obdrží event → ptá se uživatele přes aktivní kanál
  │   │   ├─ Uživatel odpoví "ano" → zpráva doručena
  │   │   └─ Uživatel odpoví "ne" → zpráva zahozena
  │   └─ [enabled: true, rule, requireConfirmation: false]:
  │       └─ POVOLENO → zpráva doručena
  └─ emitter.emit(channel, message) / publisher.publish(channel, JSON.stringify(message))
```

### 2.3 Tok: request-response korelace

```
Master Agent potřebuje synchronní odpověď od Sub-Agenta
  │
  ▼
MessageBus.request(channel, message, timeout=30s)
  ├─ Vygeneruje message.id (UUID)
  ├─ Zaregistruje listener na channel pro:
  │   response.parentMessageId === message.id && response.type === RESPONSE
  ├─ Publikuje message
  ├─ Čeká na odpověď:
  │   ├─ [Odpověď přijata] → clearTimeout, unsubscribe, resolve(response)
  │   └─ [Timeout] → unsubscribe, reject(DBotError 'REQUEST_TIMEOUT')
  └─ Vrací Promise<AgentMessage>
```

---

## 3. Vstupní vrstva (Channels)

### 3.1 Abstrakce IChannel

Každý vstupní kanál implementuje rozhraní `IChannel`:

```typescript
interface IChannel {
  id: string;          // Unikátní identifikátor ('whatsapp', 'telegram', 'rest-api', 'cli')
  name: string;        // Čitelný název
  type: ChannelType;   // WHATSAPP | TELEGRAM | REST_API | CLI

  initialize(config: any): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ChannelStatus;
  setMessageHandler(handler: MessageHandler): void;
}
```

`ChannelRouter` drží mapu registrovaných kanálů a funguje jako bridge:

```
                       ┌─────────────────────────────────┐
  Channel A ──register─▶│         ChannelRouter            │
  Channel B ──register─▶│  Map<channelId, IChannel>        │
  Channel C ──register─▶│  messageHandler → MasterAgent    │
                       └─────────┬───────────────────────┘
                                 │
             handleIncoming(msg, channelId) → MasterAgent.handleUserMessage(msg)
```

### 3.2 WhatsApp Channel (Baileys)

Nejkomplexnější kanál. Skládá se z 5 komponent:

```
┌─────────────────────────────────────────────────────────────┐
│                   WhatsApp Channel                           │
│                                                              │
│  ┌───────────────────┐      ┌──────────────────────────┐   │
│  │  BaileysConnection │      │    MessageNormalizer      │   │
│  │     Manager        │─────▶│  WAMessage → UserMessage  │   │
│  │  - makeWASocket()  │      │                           │   │
│  │  - QR / pairing    │      │  text / image / document  │   │
│  │  - reconnect       │      │  audio / reaction / reply │   │
│  └────────┬──────────┘      └──────────┬───────────────┘   │
│           │                             │                    │
│  ┌────────▼──────────┐      ┌──────────▼───────────────┐   │
│  │   AuthState        │      │   ResponseFormatter       │   │
│  │   Manager          │      │  AgentResponse → WA msg   │   │
│  │  - creds.json      │      │  - chunking (4096 chars)  │   │
│  │  - key-*.json      │      │  - image / document       │   │
│  │  - BufferJSON      │      │  - typing indicator       │   │
│  └───────────────────┘      └──────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Bezpečnostní filtry                       │   │
│  │  - Allowlist kontaktů (JID exact match)               │   │
│  │  - Token-bucket rate limiter (10 tok/min per JID)     │   │
│  │  - Status broadcast filter                             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### BaileysConnectionManager

Zodpovědný za WebSocket spojení s WhatsApp. Emituje typed eventy:

| Event | Kdy | Data |
|---|---|---|
| `qr` | Při prvním spuštění / expiraci session | QR string pro zobrazení |
| `connected` | Po úspěšné autentizaci | — |
| `disconnected` | Při ztrátě spojení | `{ reason }` |
| `message` | Při příchodu nové zprávy | `WAMessage` |

**Reconnect logika** — exponenciální backoff:

```
Pokus 1: delay = 5000ms * 1.5^0 = 5000ms
Pokus 2: delay = 5000ms * 1.5^1 = 7500ms
Pokus 3: delay = 5000ms * 1.5^2 = 11250ms
...
Pokus N: delay = reconnectInterval * 1.5^(N-1)

Zastaví se po: maxReconnectAttempts pokusech
Speciální případ: loggedOut → invalidace auth state, žádný retry
```

**Baileys event listenery:**

```typescript
socket.ev.on('connection.update', ({connection, lastDisconnect, qr}) => {
  if (qr)                    → emit('qr', qr)
  if (connection === 'open') → emit('connected'), resetReconnectAttempts
  if (connection === 'close') → analyzeDisconnectReason → reconnect / giveUp
});

socket.ev.on('creds.update', () → authState.saveCreds());  // Okamžitý persist

socket.ev.on('messages.upsert', ({messages, type}) → {
  if (type === 'notify') → for each msg: emit('message', msg)
});
```

#### AuthStateManager

Persistence session dat Baileys do JSON souborů (nikoliv `useMultiFileAuthState`, která není pro produkci):

```
data/whatsapp-auth/
├── creds.json                          # Hlavní auth credentials
├── app-state-sync-key-AAAA.json       # Encryption keys
├── pre-key-1.json                      # Pre-keys pro E2E
├── sender-key-...json                  # Sender keys
└── session-...json                     # Session data
```

**Serializace:** `BufferJSON` — řeší konverzi `Buffer` objektů do JSON a zpět:

```typescript
// Uložení
JSON.stringify(data, BufferJSON.replacer)
// Načtení
JSON.parse(fileContent, BufferJSON.reviver)
```

**API:**

```typescript
createAuthState(dir) → {
  state: {
    creds: AuthenticationCreds,
    keys: {
      get(type, ids[]) → Record<id, data>,     // Načte z JSON souborů
      set(data: Record<type, Record<id, value>>) // Zapíše/smaže soubory
    }
  },
  saveCreds() → Promise<void>   // Uloží creds.json
}
```

#### MessageNormalizer

Převádí nativní `WAMessage` na interní `UserMessage`:

| WA typ | Detekce | UserMessage type | Speciální zpracování |
|---|---|---|---|
| Text | `msg.conversation` nebo `msg.extendedTextMessage?.text` | `text` | Reply: extrakce `contextInfo.stanzaId` → `replyTo` |
| Obrázek | `msg.imageMessage` | `image` | Download buffer → base64, caption, mimetype |
| Dokument | `msg.documentMessage` | `document` | Download buffer → base64, fileName, mimetype |
| Audio | `msg.audioMessage` | `audio` | Download → base64, `ptt` flag (push-to-talk), seconds |
| Reakce | `msg.reactionMessage` | `reaction` | Emoji text, reference přes `key.id` |

**Filtrování:**
- Status broadcast (`jid === 'status@broadcast'`) → skip
- Protokolové zprávy (prázdný message object) → skip
- Vlastní zprávy → skip (pokud `allowSelf: false`)

#### ResponseFormatter

Formátuje `AgentResponse` zpět do WhatsApp zprávy. Klíčový je **chunking algoritmus** pro dlouhé texty:

```
Input: text s 8000 znaky, maxLength = 4096

Iterace 1:
  ├─ Hledej '\n' zpětně od pozice 4096 → nalezen na 3800? → rozděl tam
  ├─ Pokud '\n' < 50% maxLength → hledej ' ' (mezeru)
  └─ Pokud ani ' ' → tvrdý řez na 4096
  → Chunk 1: text[0..3800]

Iterace 2:
  ├─ Zbytek: text[3800..8000].trimStart() = 4200 znaků
  ├─ Opakuj logiku...
  → Chunk 2: text[3800..7600]
  → Chunk 3: text[7600..8000]
```

**Sekvence odeslání odpovědi:**
1. Read receipt (pokud `readMessages: true`)
2. Typing indicator start (`sendPresenceUpdate('composing')`)
3. Odeslání obrázku s caption (pokud `response.image`)
4. Odeslání dokumentu (pokud `response.document`)
5. Odeslání textových chunků (sekvenčně)
6. Typing indicator konec (`sendPresenceUpdate('available')`)

#### Rate Limiter (Token Bucket)

Ochrana proti flood zprávám — per-JID token bucket:

```
Konfigurace:
  maxTokens    = 10        (max burst)
  refillRate   = 10/min    (obnova)

Stav per JID:
  tokens       = 10        (aktuální počet)
  lastRefill   = timestamp

allow(jid):
  elapsed = now - lastRefill
  refilled = elapsed * (refillRate / 60000)
  tokens = min(maxTokens, tokens + refilled)
  lastRefill = now
  if tokens >= 1:
    tokens -= 1
    return true   → zpráva zpracována
  else:
    return false  → zpráva tiše zahozena
```

### 3.3 Telegram Channel (grammY)

Třetí kanál využívající [grammY](https://grammy.dev) — TypeScript-first Telegram Bot API framework. Používá **long polling** (nevyžaduje veřejnou URL ani webhook). Skládá se ze 3 komponent:

```
┌─────────────────────────────────────────────────────────────┐
│                   Telegram Channel                            │
│                                                               │
│  ┌───────────────────┐      ┌──────────────────────────┐    │
│  │   grammY Bot       │      │    MessageNormalizer      │    │
│  │  - long polling    │─────▶│  TG Message → UserMessage │    │
│  │  - no webhook      │      │                           │    │
│  │  - bot.start()     │      │  text / photo / document  │    │
│  └───────────────────┘      │  voice / audio             │    │
│                              └──────────┬───────────────┘    │
│                              ┌──────────▼───────────────┐    │
│                              │   ResponseFormatter       │    │
│                              │  AgentResponse → TG msg   │    │
│                              │  - Markdown formatting    │    │
│                              │  - plain text fallback    │    │
│                              │  - chunking (4096 chars)  │    │
│                              └──────────────────────────┘    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              Bezpečnostní filtry                       │    │
│  │  - Allowlist dle chat ID (exact match)                │    │
│  │  - Filtrování skupinových zpráv (volitelně)           │    │
│  │  - Token-bucket rate limiter (per chat ID)            │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

#### grammY Bot

Long polling cyklus — bot se dotazuje Telegram serverů na nové zprávy. Žádný webhook ani veřejná URL nejsou potřeba:

```typescript
const bot = new Bot(token);
bot.on('message:text', handler);
bot.on('message:photo', handler);
bot.on('message:document', handler);
bot.on('message:voice', handler);
bot.on('message:audio', handler);
bot.start();  // zahájí long polling
```

Bot token se konfiguruje přes `channels.telegram.botToken` v `default.yaml` nebo přes env proměnnou `TELEGRAM_BOT_TOKEN`.

#### MessageNormalizer

Převádí nativní grammY `Message` na interní `UserMessage`:

| TG typ | Detekce | UserMessage type | Speciální zpracování |
|---|---|---|---|
| Text | `message.text` | `text` | Přímý mapping |
| Foto | `message.photo` | `image` | Stažení přes `getFile()`, caption |
| Dokument | `message.document` | `document` | Stažení přes `getFile()`, fileName, mimetype |
| Hlas/Audio | `message.voice` nebo `message.audio` | `audio` | Stažení přes `getFile()`, duration |

**Filtrování:**
- Skupinové zprávy → filtrování dle `allowGroups` config
- Zprávy bez obsahu (prázdný text + žádná příloha) → skip

#### ResponseFormatter

Formátuje `AgentResponse` zpět do Telegram zprávy s **Markdown V2** formátováním:

- Speciální znaky jsou escapovány pro MarkdownV2 parse mode
- Při selhání parsování Telegram API → automatický fallback na plain text (bez parse mode)
- **Chunking algoritmus** identický s WhatsApp — dělení na hranici `\n` nebo mezery, tvrdý řez na 4096 znacích

**Sekvence odeslání odpovědi:**
1. Chat action: `sendChatAction('typing')`
2. Odeslání fotografie s caption (pokud `response.image`)
3. Odeslání dokumentu (pokud `response.document`)
4. Odeslání textových chunků (sekvenčně, MarkdownV2 → fallback plain text)

#### Rate Limiter (Token Bucket)

Stejný mechanismus jako WhatsApp — per-chat-ID token bucket:

```
Konfigurace:
  maxTokens    = 10        (max burst)
  refillRate   = 10/min    (obnova)

allow(chatId):
  → shodná logika s WhatsApp rate limiterem (viz 3.2)
```

#### Allowlist a skupinové filtrování

```
Příchozí zpráva od chat ID 123456789:

1. Je chatId v allowedChatIds setu? → ANO → pokračuj
2. Není v allowedChatIds → tiše ignoruj (log warning)

Skupinové zprávy (chat.type === 'group' | 'supergroup'):
  → allowGroups: false → ignoruj
  → allowGroups: true → zkontroluj chatId v allowedChatIds
```

### 3.4 REST API Channel

Minimalistická implementace — bridge mezi HTTP a `ChannelRouter`:

```typescript
handleApiMessage(text, conversationId?) {
  → vytvoří UserMessage {
      id: uuid(),
      channelId: 'rest-api',
      senderId: 'api-user',
      type: 'text',
      content: text,
      metadata: { conversationId }
    }
  → volá messageHandler(message, 'rest-api')
  → vrací AgentResponse
}
```

Autentizace je řešena na úrovni API middleware (Bearer token), ne na úrovni kanálu.

---

## 4. Orchestrační vrstva (Master Agent)

### 4.1 Struktura

```
┌──────────────────────────────────────────────────────────┐
│                     Master Agent                          │
│                                                           │
│  ┌─────────────────┐  ┌───────────────────────────────┐  │
│  │  AgentRegistry   │  │       IntentRouter             │  │
│  │                  │  │                                │  │
│  │  Map<id, agent>  │  │  Tier 1: LLM-based routing    │  │
│  │  findByCapability│  │  Tier 2: Hardcoded keywords    │  │
│  └─────────────────┘  └───────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              ConversationContext                      │  │
│  │                                                      │  │
│  │  Map<conversationId, ConversationState>              │  │
│  │  - maxEntries: 20 (rolling window)                   │  │
│  │  - ttl: 24 hodin (auto-cleanup)                      │  │
│  │  - maxContextTokens: 8000                            │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              Permission Integration                   │  │
│  │  - setPermissionManager(IPermissionManager)           │  │
│  │  - setConfirmationHandler(ConfirmationHandler)        │  │
│  │  - handleConfirmationRequest(message, rule)           │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 4.2 handleUserMessage() — kompletní flow

```typescript
async handleUserMessage(message: UserMessage): Promise<AgentResponse> {
  // 1. Konverzační kontext
  const conversationId = message.metadata?.conversationId ?? uuid();
  const context = conversationContext.getOrCreate(conversationId);

  // 2. Intent routing
  const route = await intentRouter.route(message.content);
  // route = { agentId: string | null, action: string, confidence: number }

  // 3. Žádný agent → fallback
  if (!route.agentId) {
    return {
      id: uuid(),
      agentId: 'master-agent',
      text: `Přijal jsem zprávu: "${message.content}". Zatím nemám agenta, který by ji zpracoval.`
    };
  }

  // 4. Sestavení AgentMessage
  const agentMessage: AgentMessage = {
    id: uuid(),
    source: 'master-agent',
    target: route.agentId,
    type: MessageType.REQUEST,
    action: route.action,
    payload: { content: message.content, originalMessage: message },
    conversationId,
  };

  // 5. Routing na sub-agenta
  try {
    const agent = agentRegistry.get(route.agentId);
    const response = await agent.handleMessage(agentMessage);

    // 6. Uložení do kontextu
    conversationContext.addEntry(conversationId, message, response);
    return response;
  } catch (err) {
    return {
      agentId: 'master-agent',
      text: `Došlo k chybě při komunikaci s agentem "${route.agentId}".`,
      error: { code: 'AGENT_ERROR', message: err.message }
    };
  }
}
```

### 4.3 Intent Router — dvouúrovňový systém

#### Úroveň 1: LLM-based routing

Pokud je nastaven LLM provider, router sestaví prompt a nechá LLM klasifikovat intent:

**System prompt (dynamicky generovaný):**

```
You are an intent router for a personal AI assistant.
Given a user message, determine which agent should handle it.

Available agents:
- obsidian-agent: Manages Obsidian vault: read, write, edit, search, list notes, manage metadata, sync, add tasks, and write daily notes
  Capabilities: obsidian.read, obsidian.write, obsidian.edit, obsidian.search, obsidian.list, obsidian.metadata, obsidian.sync, obsidian.task, obsidian.daily

  Disambiguation rules:
  - "obsidian.task" = adding a task/todo item (triggers: úkol, ukol, task:, todo:)
  - "obsidian.daily" = writing to today's daily note / logging (triggers: denní poznámk, daily note, daily:)
  - "obsidian.write" = creating a completely new standalone note (triggers: vytvoř, přidej, create, add)
  - "obsidian.edit" = editing an existing note

Respond with JSON only:
{"agentId": "agent-id-here", "action": "capability.action", "confidence": 0.0-1.0}

If no agent matches, respond:
{"agentId": null, "action": "", "confidence": 0}
```

**Zpracování odpovědi:**
1. Odstranění code fences: ` ```json ... ``` ` → čistý JSON
2. `JSON.parse()` → validace struktury
3. Ověření `agentId` existuje v `AgentRegistry`
4. Confidence check: `≥ 0.5` → použít, jinak fallback
5. Při jakékoliv chybě (invalid JSON, neznámý agent, LLM timeout) → fallback na hardcoded

#### Úroveň 2: Hardcoded keyword routing

Záložní systém bez závislosti na LLM:

```typescript
const KEYWORD_MAP: Record<string, string> = {
  'obsidian': 'obsidian',
  'poznámk': 'obsidian',   // "poznámka", "poznámku", "poznámky"
  'note':    'obsidian',
  'vault':   'obsidian',
  'markdown': 'obsidian',
  'md':      'obsidian',
};
```

**Postup:**
1. Zpráva → lowercase → hledej klíčová slova z `KEYWORD_MAP`
2. Klíčové slovo nalezeno → capability prefix (např. `"obsidian"`)
3. `AgentRegistry.findByCapability("obsidian")` → agent
4. `inferAction(message)` → mapuje slovesa na akce:

```
"denní poznámk" / "denni poznamk" / "daily note" / "daily:"   → obsidian.daily
"úkol" / "ukol" / "task:" / "todo:"                           → obsidian.task
"vytvoř" / "přidej" / "zapiš" / "create" / "add" / "write"   → obsidian.write
"přečti" / "zobraz" / "read" / "show"                         → obsidian.read
"hledej" / "najdi" / "vyhledej" / "search" / "find"           → obsidian.search
"vypiš" / "seznam" / "list"                                     → obsidian.list
"synchronizuj" / "sync"                                          → obsidian.sync
"uprav" / "edituj" / "edit" / "update"                          → obsidian.edit
```

5. Vrací `{ agentId, action, confidence: 0.7 }`

### 4.4 Konverzační kontext

Udržuje historii zpráv v rolling window pro každou konverzaci:

```typescript
// Datový model
ConversationState {
  conversationId: string;
  activeAgentId: string | null;    // Naposledy routovaný agent
  entries: ConversationEntry[];     // Max 20 záznamů
  createdAt: number;
  lastActivityAt: number;
}

ConversationEntry {
  userMessage: UserMessage;
  agentResponse: AgentResponse;
  timestamp: number;
}
```

**Token budget management** — `toChatMessages()`:

```
Účel: Sestavit pole ChatMessage[] pro LLM, nepřekročit token budget

Postup:
1. Iteruj od NEJNOVĚJŠÍHO záznamu zpětně
2. Pro každý záznam:
   a. Odhadni tokeny: text.length / 3.5 (heuristika pro CZ/EN)
   b. Pokud kumulativní tokeny + tento záznam ≤ maxContextTokens (8000):
      → přidej na ZAČÁTEK pole
   c. Jinak → zastav iteraci
3. Výsledek: pole ChatMessage[] od nejstaršího po nejnovější, v rámci budgetu

Příklad:
  Budget: 8000 tokenů
  Záznam 5 (300 tok): ✅ kumulativně 300
  Záznam 4 (500 tok): ✅ kumulativně 800
  Záznam 3 (2000 tok): ✅ kumulativně 2800
  Záznam 2 (3000 tok): ✅ kumulativně 5800
  Záznam 1 (4000 tok): ❌ kumulativně 9800 > 8000 → stop
  → Výsledek: záznamy 2–5
```

**Auto-cleanup:**
- Konverzace starší než 24 hodin (`ttl`) jsou automaticky smazány
- Metoda `cleanup()` iteruje přes mapu a odstraňuje expired

---

## 5. Komunikační vrstva (Message Bus)

### 5.1 Abstrakce IMessageBus

```typescript
interface IMessageBus {
  publish(channel: string, message: AgentMessage): Promise<void>;
  subscribe(channel: string, handler: MessageHandler): Subscription;
  unsubscribe(subscription: Subscription): void;
  request(channel: string, message: AgentMessage, timeout?: number): Promise<AgentMessage>;
  shutdown(): Promise<void>;
}
```

### 5.2 InMemoryMessageBus (development)

Používá `eventemitter3` pro single-process pub/sub:

```
publish("obsidian-agent", msg)
  │
  ├─ [Permission check] → viz sekce 9
  │
  ├─ emitter.emit("obsidian-agent", msg)    // Direct subscribers
  └─ emitter.emit("*", msg)                 // Wildcard subscribers
```

**Subscription tracking:**
```typescript
subscriptions: Map<uuid, { channel, handler }>
// Umožňuje unsubscribe podle ID bez reference na handler
```

### 5.3 RedisMessageBus (production)

Používá dva oddělené ioredis klienty:

```
┌─────────────────────────────────────────────┐
│           RedisMessageBus                    │
│                                              │
│  ┌──────────┐         ┌──────────────────┐  │
│  │ publisher │─publish─▶│   Redis Server   │  │
│  │  (ioredis)│         │                  │  │
│  └──────────┘         │  channel → JSON   │  │
│                        │                  │  │
│  ┌──────────┐◀─message─│                  │  │
│  │subscriber │         └──────────────────┘  │
│  │  (ioredis)│                               │
│  └─────┬────┘                               │
│        │                                     │
│  ┌─────▼──────────────────────────────────┐  │
│  │  localHandlers: Map<channel, Set<{     │  │
│  │    id: uuid,                            │  │
│  │    handler: MessageHandler              │  │
│  │  }>>                                    │  │
│  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Lazy subscription:**
- První lokální handler pro kanál → `subscriber.subscribe(channel)` na Redis
- Poslední handler odebrán → `subscriber.unsubscribe(channel)` na Redis

**Retry strategie:**
```typescript
retryStrategy: (times: number) => Math.min(times * 200, 5000)
// Pokus 1: 200ms, pokus 2: 400ms, ... pokus 25+: 5000ms (cap)
```

**Serializace:** `JSON.stringify()` / `JSON.parse()` pro transport přes Redis Pub/Sub.

---

## 6. Agenturní vrstva (Sub-Agents)

### 6.1 ISubAgent rozhraní

```typescript
interface ISubAgent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];        // ["obsidian.read", "obsidian.write", ...]
  requiredSkills: string[];      // ["file-system", "markdown-parser"]

  initialize(context: AgentContext): Promise<void>;
  handleMessage(message: AgentMessage): Promise<AgentResponse>;
  shutdown(): Promise<void>;
  getHealthStatus(): HealthStatus;
}

interface AgentContext {
  config: Record<string, unknown>;
  skills: Map<string, unknown>;    // Injected skill instances
  llmProvider: ILLMProvider | null;
}
```

### 6.2 Obsidian Agent

**Architektura:**

```
┌──────────────────────────────────────────────────┐
│                 Obsidian Agent                     │
│                                                    │
│  handleMessage(AgentMessage)                       │
│    │                                               │
│    ├─ action: "obsidian.write"  → handleWrite()      │
│    ├─ action: "obsidian.read"   → handleRead()       │
│    ├─ action: "obsidian.edit"   → handleEdit()       │
│    ├─ action: "obsidian.search" → handleSearch()     │
│    ├─ action: "obsidian.list"   → handleList()       │
│    ├─ action: "obsidian.metadata"→ handleMeta()      │
│    ├─ action: "obsidian.sync"   → handleSync()       │
│    ├─ action: "obsidian.task"   → handleTask()       │
│    └─ action: "obsidian.daily"  → handleDailyNote()  │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │              VaultManager                    │  │
│  │                                              │  │
│  │  readNote()      → FS read → MD parse           │  │
│  │  writeNote()     → MD stringify → FS write       │  │
│  │  editNote()      → read → merge → write          │  │
│  │  searchNotes()   → FS list → read all → filter   │  │
│  │  listNotes()     → FS list(*.md)                  │  │
│  │  getMetadata()   → FS read → MD getFrontmatter   │  │
│  │  setMetadata()   → read → MD setFrontmatter      │  │
│  │  syncVault()     → Sync skill execute             │  │
│  │  appendToNote()  → exists? append : writeNote     │  │
│  │  getDailyNotePath() → daily/YYYY-MM-DD.md         │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**Command parsing** — CZ/EN klíčová slova:

```
"Vytvoř poznámku Shopping list s obsahem: mléko, chleba"
  → action: obsidian.write
  → title:  "Shopping list"
  → body:   "mléko, chleba"
  → path:   "Shopping list.md" (v defaultFolder)

"Přečti poznámku Meeting notes.md"
  → action: obsidian.read
  → path:   "Meeting notes.md"

"Najdi poznámku o projektu"
  → action: obsidian.search
  → query:  "projektu"

"Přidej úkol: Zavolat doktorovi"
  → action: obsidian.task
  → task:   "Zavolat doktorovi"
  → file:   "tasks.md"
  → format: "- [ ] Zavolat doktorovi"

"Zapiš: Dokončil jsem projekt"
  → action: obsidian.daily
  → path:   "daily/2026-03-31.md"
  → format: "- **14:35** Dokončil jsem projekt"
```

**Search výsledky** — snippet extraction:

```
Pro query "meeting" v souboru s obsahem "...důležitý meeting s klientem...":

  matchIndex = content.indexOf("meeting")
  snippetStart = max(0, matchIndex - 50)
  snippetEnd = min(content.length, matchIndex + query.length + 50)
  snippet = "...důležitý meeting s klientem..."
  matchCount = počet výskytů (case-insensitive)

Řazení: dle matchCount sestupně
Limit: max 10 výsledků
```

### 6.3 Agent šablona

Adresář `src/agents/_template/` obsahuje kostrový agent pro snadné vytváření nových:

```typescript
export class TemplateAgent implements ISubAgent {
  id = 'template-agent';
  name = 'Template Agent';
  capabilities = ['template.action'];
  requiredSkills = [];

  async initialize(context: AgentContext) { /* ... */ }
  async handleMessage(message: AgentMessage): Promise<AgentResponse> {
    // Dispatch logic here
  }
  async shutdown() { /* cleanup */ }
  getHealthStatus() { return { healthy: true, uptime: ... }; }
}
```

---

## 7. Modulární vrstva (Skills)

### 7.1 Skill Framework

Každý skill se skládá ze 3 částí:

```
src/skills/{skill-name}/
├── skill.manifest.json    # Deklarace: id, verze, akce, permissions
├── {skill-name}.skill.ts  # Implementace ISkill
└── index.ts               # Re-export
```

**ISkill rozhraní:**

```typescript
interface ISkill {
  id: string;
  name: string;
  version: string;

  initialize(config: Record<string, unknown>): Promise<void>;
  execute(action: string, params: Record<string, unknown>): Promise<SkillResult>;
  getAvailableActions(): ActionDescriptor[];
  shutdown(): Promise<void>;
}

interface SkillResult {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}
```

**SkillRegistry** drží skill instance i manifesty:

```
SkillRegistry
  ├─ skills: Map<id, ISkill>           // Živé instance
  ├─ manifests: Map<id, SkillManifest> // Metadata
  ├─ register(skill, manifest)
  ├─ get(skillId) → ISkill
  └─ getAll() → [{skill, manifest}]
```

### 7.2 FileSystem Skill

**Sandbox ochrana** — každá operace prochází `safePath()`:

```typescript
safePath(relativePath: string): string {
  const resolved = path.resolve(this.basePath, relativePath);

  if (!resolved.startsWith(this.basePath)) {
    throw new SkillError(
      `Path "${relativePath}" is outside the allowed directory`,
      'file-system', 'PATH_TRAVERSAL'
    );
  }

  return resolved;
}

// Příklady:
safePath("notes/test.md")     → "/data/vault/notes/test.md"     ✅
safePath("../../etc/passwd")   → SkillError: PATH_TRAVERSAL     ❌
safePath("../../../root/.ssh") → SkillError: PATH_TRAVERSAL     ❌
```

**Akce:**

| Akce | Vstup | Chování |
|---|---|---|
| `read` | `{ path }` | `readFileSync()`, vrací obsah jako string |
| `write` | `{ path, content }` | `mkdirSync(recursive)` + `writeFileSync()` |
| `append` | `{ path, content }` | `appendFileSync()` |
| `delete` | `{ path }` | `unlinkSync()` |
| `list` | `{ dir?, pattern? }` | Rekurzivní walk, glob-to-regex filtr |
| `exists` | `{ path }` | `existsSync()` → boolean |

**Rekurzivní listing s glob filtrem:**

```typescript
// pattern: "*.md" → regex: /^.*\.md$/
// pattern: "notes/**/*.md" → regex: /^notes\/.*\/.*\.md$/

function listRecursive(dir, pattern?) {
  for (entry of readdirSync(dir, {withFileTypes})) {
    if (entry.isDirectory())  → recurse(entry.path)
    if (entry.isFile()) {
      if (pattern && !regex.test(relativePath)) → skip
      results.push(relativePath)
    }
  }
}
```

### 7.3 Markdown Parser Skill

Využívá knihovnu `gray-matter` pro YAML frontmatter a regex pro extrakci odkazů/tagů.

**Akce:**

| Akce | Vstup | Výstup |
|---|---|---|
| `parse` | `{ content }` | `{ frontmatter, body, links, tags }` |
| `stringify` | `{ body, frontmatter? }` | Kompletní MD string s frontmatter |
| `getFrontmatter` | `{ content }` | Pouze frontmatter objekt |
| `setFrontmatter` | `{ content, data }` | MD s mergeovaným frontmatter |
| `extractLinks` | `{ content }` | `{ wikilinks: [], markdownLinks: [] }` |
| `extractTags` | `{ content }` | `string[]` |

**Extrakce odkazů:**

```typescript
// Wikilinks: [[target]] nebo [[target|display text]]
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// Markdown links: [text](url)
const MD_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;
```

**Extrakce tagů:**

```typescript
// Inline tagy: #tag (unicode-aware pro CZ/SK)
const TAG_REGEX = /(?:^|\s)#([a-zA-Z\u00C0-\u024F][\w\u00C0-\u024F/-]*)/g;

// + tagy z frontmatter.tags pole (array nebo string)
```

### 7.4 Obsidian Sync Skill (v2)

Sync běží v separátním Docker kontejneru (`obsidian-sync`) jako periodický polling loop (`ob sync` každých 30 s, konfigurovatelné přes `OBSIDIAN_SYNC_INTERVAL`). Docker shared volumes nepodporují inotify v sync kontejneru, proto se nepoužívá `ob sync --continuous`. Skill kontroluje stav vaultu na filesystému — nevolá žádné HTTP API.

```
┌─────────────┐   filesystem check   ┌────────────────────┐
│  Sync Skill │─────────────────────▶│ /vault (shared vol) │
│  (v2.0.0)   │   exists? stat?      │                     │
└─────────────┘                       └────────────────────┘
                                              ↕
                                      ┌────────────────────┐
                                      │ obsidian-sync      │
                                      │ container          │
                                      │ ob sync (periodic) │
                                      │ interval: 30s      │
                                      └────────────────────┘
```

**Akce:**
- `sync()`: Ověří existenci vault adresáře a `.obsidian/` (indikátor inicializace), vrátí stav
- `getStatus()`: Vrátí počet .md souborů, last modified, sync mode info
- `getLastSyncTime()`: Timestamp posledního checku

**Error handling:**
- Sync disabled → `{ success: false, error: { code: 'SYNC_DISABLED' } }`
- Vault dir not found → `{ success: false, error: { code: 'VAULT_NOT_FOUND' } }`

**Credentials & entrypoint:**
- `sync-entrypoint.sh` zajišťuje auto-login: `ob login` + `ob sync-setup` při startu kontejneru
- Dvě oddělená hesla: `OBSIDIAN_PASSWORD` (přihlášení k účtu) a `OBSIDIAN_VAULT_PASSWORD` (šifrování vaultu)
- Env vars `OBSIDIAN_EMAIL`, `OBSIDIAN_PASSWORD`, `OBSIDIAN_VAULT_PASSWORD`, `OBSIDIAN_VAULT_NAME` předány do sync kontejneru
- Periodický `ob sync` v loop (výchozí 30 s, konfigurovatelné přes `OBSIDIAN_SYNC_INTERVAL`) nahrazuje `ob sync --continuous`
- Credentials uloženy v `obsidian-auth` Docker volume

---

## 8. LLM vrstva

### 8.1 Architektura

```
┌──────────────────────────────────────────────────┐
│              LLMProviderFactory                    │
│                                                    │
│  initializeFromConfig(llmConfig):                  │
│    ├─ OPENAI_API_KEY nalezen? → new OpenAIProvider │
│    ├─ ANTHROPIC_API_KEY nalezen? → new AnthropicP. │
│    ├─ MISTRAL_API_KEY nalezen? → new MistralProv.  │
│    └─ Ollama (vždy) → new OllamaProvider           │
│                                                    │
│  providers: Map<id, ILLMProvider>                  │
│  getDefaultProvider() → dle config.defaultProvider │
└──────────────────────────────────────────────────┘
```

### 8.2 Společné rozhraní

```typescript
interface ILLMProvider {
  id: string;   // 'openai' | 'anthropic' | 'mistral' | 'ollama'

  // Synchronní volání → kompletní odpověď
  chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse>;

  // Streaming → iterátor přes chunky
  streamChat(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;

  // Odhad tokenů
  getTokenCount(text: string): number;
}
```

### 8.3 OpenAI Provider

```typescript
// chat()
const response = await client.chat.completions.create({
  model: options?.model ?? 'gpt-4o',
  messages,                    // ChatMessage[] → OpenAI format
  temperature,
  max_tokens,
  tools: convertTools(tools),  // ToolDefinition[] → OpenAI function format
});

// Výstup:
{
  content: response.choices[0].message.content,
  model: response.model,
  usage: { promptTokens, completionTokens, totalTokens },
  finishReason: response.choices[0].finish_reason,
  toolCalls: response.choices[0].message.tool_calls?.map(...)
}

// streamChat()
const stream = await client.chat.completions.create({...params, stream: true});
for await (const chunk of stream) {
  yield { content: chunk.choices[0]?.delta?.content, done: false };
}
yield { content: '', done: true };
```

### 8.4 Anthropic Provider

```typescript
// chat() — klíčový rozdíl: system prompt je separátní parametr
const systemMessages = messages.filter(m => m.role === 'system');
const nonSystemMessages = messages.filter(m => m.role !== 'system');

const response = await client.messages.create({
  model: options?.model ?? 'claude-sonnet-4-20250514',
  system: systemMessages.map(m => m.content).join('\n'),  // Separátní!
  messages: nonSystemMessages,
  max_tokens: options?.maxTokens ?? 4096,
  temperature,
  tools: convertTools(tools),  // → Anthropic tool format (input_schema)
});

// Extrakce z response.content[]:
content = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
toolCalls = response.content.filter(b => b.type === 'tool_use').map(...);
```

### 8.5 Mistral Provider

```typescript
// MistralProvider — wrapper nad @mistralai/mistralai SDK
// API klíč z configu nebo MISTRAL_API_KEY env var

// chat() — client.chat.complete({ model, messages, tools, ... })
// Formát zpráv = OpenAI-kompatibilní (system v messages array)
// Tool calling = OpenAI-kompatibilní (type: 'function')
// Tool call arguments: defensivní parsing (string → JSON.parse, object → přímo)

// streamChat() — client.chat.stream({ model, messages, ... })
// Async iterable s events: event.data.choices[0].delta.content

// Dostupné modely: mistral-large-latest, mistral-small-latest, codestral-latest
```

### 8.6 Ollama Provider (lokální LLM)

```typescript
// OllamaProvider — komunikuje s Ollama REST API (http://localhost:11434)
// Nepotřebuje API klíč, vždy se inicializuje

// chat() — POST /api/chat, stream: false
const response = await fetch(`${baseUrl}/api/chat`, {
  method: 'POST',
  body: JSON.stringify({
    model,           // dynamicky měnitelný za běhu
    messages,        // ChatMessage[] → OllamaChatMessage[]
    stream: false,
    options: { temperature, num_predict },
    keep_alive,      // jak dlouho držet model v paměti (default '5m')
  }),
});
// Vrací: { content, model, usage, finishReason, toolCalls }

// streamChat() — POST /api/chat, stream: true
// Ollama vrací NDJSON (newline-delimited JSON)
// Čtení přes ReadableStream reader s buffer managementem

// Model management (Ollama-specific):
setModel(model)               // přepnutí modelu za běhu
getModel()                    // aktuální model
listModels()                  // GET /api/tags
getModelInfo(model)           // POST /api/show
pullModel(model)              // POST /api/pull (stažení nového modelu)
isAvailable()                 // GET /api/tags (health check)
```

Konfigurace:
```yaml
llm:
  providers:
    ollama:
      model: "llama3.1"           # výchozí model
      baseUrl: "http://localhost:11434"
      keepAlive: "5m"
      timeout: 120000             # ms
```

### 8.7 Token counting

Obě implementace používají stejnou heuristiku (bez tokenizeru):

```typescript
getTokenCount(text: string): number {
  return Math.ceil(text.length / 3.5);
}
// 3.5 znaků/token je kompromis mezi angličtinou (~4) a češtinou (~3)
```

---

## 9. Bezpečnostní model

### 9.1 Vrstvy zabezpečení

```
┌─────────────────────────────────────────────────────────┐
│                VRSTVA 1: Kanálová bezpečnost             │
│                                                          │
│  WhatsApp:                                               │
│  ├─ Allowlist kontaktů (JID exact match)                │
│  ├─ Rate limiting (token bucket, 10/min per JID)        │
│  └─ Status broadcast filtr                               │
│                                                          │
│  Telegram:                                               │
│  ├─ Allowlist dle chat ID (exact match)                 │
│  ├─ Rate limiting (token bucket, per chat ID)           │
│  └─ Skupinové filtrování (allowGroups)                   │
│                                                          │
│  REST API:                                               │
│  ├─ Bearer token autentizace (DBOT_API_KEY)             │
│  └─ Middleware ověření na všech /api/* routes            │
├──────────────────────────────────────────────────────────┤
│              VRSTVA 2: Inter-agent bezpečnost            │
│                                                          │
│  Permission Manager:                                     │
│  ├─ Global kill switch (enabled: false → vše blokováno) │
│  ├─ Explicitní allowlist párů (source → target)         │
│  ├─ Akce-specifická pravidla (actions: ["action.x"])    │
│  ├─ Confirmation flow (requireConfirmation: true)       │
│  └─ Runtime API pro správu pravidel                      │
├──────────────────────────────────────────────────────────┤
│              VRSTVA 3: Skill bezpečnost                  │
│                                                          │
│  FileSystem Skill:                                       │
│  ├─ Sandbox na basePath (vaultPath)                     │
│  ├─ Path traversal ochrana (resolve + prefix check)     │
│  └─ Žádný přístup mimo povolený adresář                 │
│                                                          │
│  Obsidian Sync:                                          │
│  ├─ Timeout na HTTP požadavky (30s sync, 5s status)    │
│  └─ Komunikace pouze na konfigurovaný endpoint          │
└─────────────────────────────────────────────────────────┘
```

### 9.2 Permission Manager — rozhodovací strom

```
check(source, target, action)
  │
  ├─ enabled === false?
  │   └─ YES → { allowed: false, reason: "globally disabled" }
  │
  ├─ Najdi pravidlo: source === rule.source && target === rule.target?
  │   └─ Žádné pravidlo → { allowed: false, reason: "No permission rule" }
  │
  ├─ Pravidlo nalezeno:
  │   ├─ rule.actions.length === 0?    → Povoleny VŠECHNY akce
  │   └─ rule.actions.includes(action)?
  │       ├─ NO  → { allowed: false, reason: "Action not in rule" }
  │       └─ YES → { allowed: true, requireConfirmation: rule.requireConfirmation }
```

### 9.3 WhatsApp allowlist — logika

```
Příchozí zpráva od JID "420123456789@s.whatsapp.net":

1. Je JID v allowedContacts setu? → ANO → pokračuj
2. Extrahuj číslo (prefix před @) → "420123456789"
3. Je číslo v allowedContacts? → ANO → pokračuj
4. Ani JID ani číslo nenalezeno → tiše ignoruj (log warning)

Poznámka: Vlastní zprávy (fromMe: true) jsou filtrovány zvlášť dle allowSelf config.
```

### 9.4 API autentizace

```
Request → /api/v1/*
  │
  ├─ DBOT_API_KEY env proměnná nastavena?
  │   └─ NE → skip auth (development mode)
  │
  ├─ Authorization header přítomen?
  │   └─ NE → 401 Unauthorized
  │
  ├─ Format: "Bearer <token>"?
  │   └─ NE → 401 Unauthorized
  │
  └─ token === DBOT_API_KEY?
      ├─ NE → 401 Unauthorized
      └─ ANO → pokračuj na route handler
```

---

## 10. Konfigurační systém

### 10.1 Vrstvená konfigurace (priorita od nejnižší po nejvyšší)

```
┌─────────────────────────────────────────┐
│ 3. Environment variables                │  ← Nejvyšší priorita
│    DBOT__server__port=5000              │
│    OPENAI_API_KEY=sk-...                │
├─────────────────────────────────────────┤
│ 2. Environment-specific YAML            │
│    config/production.yaml               │
│    config/development.yaml              │
├─────────────────────────────────────────┤
│ 1. Default YAML                         │  ← Nejnižší priorita
│    config/default.yaml                  │
└─────────────────────────────────────────┘
```

### 10.2 Konfigurační schéma (Zod validace)

```typescript
// Kompletní struktura po validaci:
{
  server: {
    port: number,        // default: 3000
    host: string,        // default: "0.0.0.0"
  },
  llm: {
    defaultProvider: "mistral" | "openai" | "anthropic" | "ollama",
    providers: {
      openai:    { model: string, apiKey?: string },
      anthropic: { model: string, apiKey?: string },
      mistral:   { model: string, apiKey?: string },
      ollama:    { model: string, baseUrl?: string },
    }
  },
  messageBus: {
    type: "in-memory" | "redis",
    redis: { host: string, port: number }
  },
  logging: {
    level: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent"
  },
  channels: {
    whatsapp: {
      enabled: boolean,
      authMethod: "qr" | "pairing",
      authStateDir: string,
      allowedContacts: string[],
      allowSelf: boolean,
      readMessages: boolean,
      typingIndicator: boolean,
      maxMessageLength: number,    // default: 4096
      reconnectInterval: number,   // default: 5000ms
      maxReconnectAttempts: number, // default: 10
    },
    telegram: {
      enabled: boolean,
      botToken: string,             // Telegram Bot API token
      allowedChatIds: string[],     // Povolená chat ID
      allowGroups: boolean,         // Povolit skupinové zprávy
      maxMessageLength: number,     // default: 4096
    },
    restApi: { enabled: boolean },
    cli:     { enabled: boolean },
  }
}
```

### 10.3 Environment variable mapování

```
DBOT__server__port=5000              → config.server.port = 5000
DBOT__llm__defaultProvider=anthropic → config.llm.defaultProvider = "anthropic"
DBOT__messageBus__type=redis         → config.messageBus.type = "redis"
DBOT__messageBus__redis__host=redis  → config.messageBus.redis.host = "redis"

// Automatická konverze:
"true" / "false" → boolean
"1234"           → number (pokud celé číslo)
```

### 10.4 Agentní konfigurace

Separátní `config/agents.yaml` definuje registrované agenty:

```yaml
agents:
  - id: "obsidian-agent"
    enabled: true
    config:
      vaultPath: "./data/vault"
      syncEnabled: true
      defaultFolder: "/"
      taskFile: "tasks.md"
      dailyNotesFolder: "daily"
      excludePatterns: [".obsidian/**", ".trash/**"]
```

Agent config je validován Zod schématem (`obsidianAgentConfigSchema`) při bootstrapu.

---

## 11. REST API

### 11.1 Endpoint mapa

```
GET  /api/v1/health              → Stav systému
GET  /api/v1/agents              → Seznam agentů
GET  /api/v1/skills              → Seznam skillů
POST /api/v1/chat                → Odeslání zprávy
GET  /api/v1/permissions         → Permission pravidla
POST /api/v1/permissions         → Přidání pravidla
DELETE /api/v1/permissions/:id   → Odebrání pravidla
PUT  /api/v1/permissions/toggle  → Enable/disable
POST /api/v1/permissions/check   → Ověření pravidla
GET  /api/v1/llm/providers       → Seznam LLM providerů
GET  /api/v1/llm/models          → Seznam Ollama modelů + aktuální
PUT  /api/v1/llm/models          → Přepnutí aktivního Ollama modelu
GET  /api/v1/llm/models/:model   → Info o konkrétním modelu
POST /api/v1/llm/models/pull     → Stažení nového modelu
GET  /api/v1/llm/status          → Ollama dostupnost + aktuální model
```

### 11.2 Error handling middleware

Mapování custom chyb na HTTP kódy:

```
PermissionError → 403 Forbidden
AgentError      → 502 Bad Gateway
SkillError      → 500 Internal Server Error
ChannelError    → 502 Bad Gateway
DBotError       → 500 Internal Server Error
ValidationError → 400 Bad Request
Unknown         → 500 Internal Server Error

Response format:
{
  error: string,   // Chybová zpráva
  code: string,    // Interní kód (PERMISSION_DENIED, AGENT_ERROR, ...)
  details?: any    // Kontextové informace (pouze v development)
}
```

### 11.3 Health endpoint — detail

```json
{
  "status": "ok",
  "uptime": 3600,
  "agents": {
    "count": 1,
    "list": [
      {
        "id": "obsidian-agent",
        "name": "Obsidian Agent",
        "healthy": true
      }
    ]
  },
  "skills": {
    "count": 3
  }
}
```

---

## 12. Životní cyklus aplikace

### 12.1 Bootstrap sekvence

```
main()
  │
  ├─ 1. loadConfig()
  │     ├─ Načti config/default.yaml
  │     ├─ Načti config/{NODE_ENV}.yaml (pokud existuje)
  │     ├─ Aplikuj env variables (DBOT__*)
  │     └─ Validuj přes Zod schéma
  │
  ├─ 2. setLogLevel(config.logging.level)
  │
  ├─ 3. Initialize Message Bus
  │     ├─ config.messageBus.type === "redis"?
  │     │   └─ new RedisMessageBus(host, port) → connect()
  │     └─ else → new InMemoryMessageBus()
  │
  ├─ 4. new SkillRegistry()
  │
  ├─ 5. LLMProviderFactory.initializeFromConfig()
  │     ├─ OPENAI_API_KEY → new OpenAIProvider()
  │     └─ ANTHROPIC_API_KEY → new AnthropicProvider()
  │
  ├─ 6. new MasterAgent(messageBus)
  │     ├─ setLLMProvider(defaultProvider)
  │     └─ setPermissionManager(permissionManager)
  │
  ├─ 7. PermissionManager.loadFromFile("config/permissions.yaml")
  │     └─ messageBus.setPermissionManager(permissionManager)
  │
  ├─ 8. Bootstrap agents from config/agents.yaml
  │     └─ for each enabled agent:
  │         ├─ Validate config (Zod)
  │         ├─ Initialize skills
  │         ├─ Register skills in SkillRegistry
  │         ├─ Create agent instance
  │         ├─ agent.initialize({config, skills, llmProvider})
  │         └─ masterAgent.registerSubAgent(agent)
  │
  ├─ 9. new ChannelRouter()
  │     ├─ setMessageHandler → masterAgent.handleUserMessage
  │     ├─ Register RestApiChannel
  │     ├─ Register WhatsAppChannel (if enabled)
  │     └─ Register TelegramChannel (if enabled)
  │
  ├─ 10. channelRouter.startAll()
  │      ├─ REST API: start() (immediate)
  │      ├─ WhatsApp: start() → makeWASocket() → QR/connect
  │      └─ Telegram: start() → bot.start() → long polling
  │
  ├─ 11. createServer(deps) → Fastify listen
  │
  └─ 12. Register shutdown handlers (SIGTERM, SIGINT)
```

### 12.2 Graceful Shutdown sekvence

```
SIGTERM / SIGINT přijat
  │
  ├─ Double-shutdown guard (isShuttingDown flag)
  │
  ├─ 1. channelRouter.stopAll()
  │     ├─ WhatsApp: stop() → socket.end() → authState cleanup
  │     ├─ Telegram: stop() → bot.stop()
  │     └─ REST API: stop()
  │     → Žádné nové zprávy se nepřijímají
  │
  ├─ 2. server.close()
  │     → Fastify přestane přijímat HTTP požadavky
  │     → Dokončí otevřené požadavky
  │
  ├─ 3. masterAgent.shutdown()
  │     → Volá shutdown() na všech registrovaných sub-agentech
  │     → Agenti uvolní zdroje
  │
  ├─ 4. messageBus.shutdown()
  │     ├─ InMemory: removeAllListeners(), clear subscriptions
  │     └─ Redis: unsubscribe all → disconnect oba klienty
  │
  └─ 5. process.exit(0)
         └─ Při chybě: process.exit(1) + error log
```

---

## 13. Datové struktury a typy

### 13.1 Zprávy

```typescript
// Uživatelská zpráva (z kanálu do systému)
interface UserMessage {
  id: string;                    // UUID
  timestamp: number;             // Unix ms
  channelId: string;             // 'whatsapp' | 'telegram' | 'rest-api' | 'cli'
  senderId: string;              // JID nebo 'api-user'
  type: 'text' | 'image' | 'document' | 'audio' | 'reaction';
  content: string;               // Textový obsah
  attachment?: string;           // Base64 pro binární data
  replyTo?: string;              // ID zprávy na kterou reaguje
  metadata?: Record<string, unknown>;
}

// Meziagenturní zpráva
interface AgentMessage {
  id: string;                    // UUID
  timestamp: number;
  source: string;                // ID odesílajícího agenta
  target: string;                // ID cílového agenta
  type: MessageType;             // REQUEST | RESPONSE | EVENT | SYSTEM
  action: string;                // 'obsidian.write', 'obsidian.read', ...
  payload: Record<string, unknown>;
  conversationId: string;
  parentMessageId?: string;      // Pro request-response korelaci
  metadata?: Record<string, unknown>;
}

// Odpověď agenta (ze systému do kanálu)
interface AgentResponse {
  id: string;
  timestamp: number;
  agentId: string;               // Který agent odpovídal
  conversationId: string;
  text: string;                  // Hlavní textová odpověď
  image?: string;                // Base64 obrázek
  document?: { data: string; fileName: string; mimetype: string };
  metadata?: Record<string, unknown>;
  error?: { code: string; message: string };
}
```

### 13.2 Permission typy

```typescript
interface PermissionRule {
  id: string;                    // UUID (generováno při addRule)
  source: string;                // Agent ID odesílatele
  target: string;                // Agent ID příjemce
  actions: string[];             // Povolené akce ([] = všechny)
  requireConfirmation: boolean;  // Ptát se uživatele?
}

interface PermissionCheckResult {
  allowed: boolean;
  requireConfirmation: boolean;
  rule?: PermissionRule;         // Matchnuté pravidlo
  reason?: string;               // Důvod zamítnutí
}
```

### 13.3 LLM typy

```typescript
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

---

## 14. Error handling

### 14.1 Hierarchie chyb

```
Error
 └─ DBotError (code: string, context?: Record<string, unknown>)
     ├─ AgentError (agentId: string)
     ├─ SkillError (skillId: string)
     ├─ ChannelError (channelId: string)
     └─ PermissionError (source, target, action)
```

### 14.2 Error propagace

```
Skill úroveň:
  FileSystemSkill: path traversal → SkillError('PATH_TRAVERSAL')
  FileSystemSkill: file not found → SkillError('FILE_NOT_FOUND')
  ObsidianSync: network fail      → SkillResult { success: false, error: {...} }
       │
       ▼
Agent úroveň:
  ObsidianAgent: catch SkillError → AgentResponse { error: { code, message } }
  ObsidianAgent: unknown action   → AgentResponse { text: "Neznámá akce" }
       │
       ▼
Master Agent úroveň:
  MasterAgent: agent not found   → AgentResponse { text: "Nemám agenta..." }
  MasterAgent: agent throws      → AgentResponse { error: { code: 'AGENT_ERROR' } }
       │
       ▼
API úroveň:
  ErrorMiddleware: DBotError → HTTP kód dle typu
  ErrorMiddleware: unknown   → 500 Internal Server Error
```

### 14.3 Graceful degradation vzory

| Situace | Chování |
|---|---|
| LLM API nedostupné | Fallback na hardcoded keyword routing |
| Neznámý intent | Informativní odpověď v češtině (ne crash) |
| WhatsApp connection lost | Automatický reconnect s exponenciálním backoffem |
| Obsidian Sync server offline | SkillResult s chybovým kódem (ne exception) |
| Read receipt / typing selhání | Tiše ignorováno (non-critical) |
| Nepovolený WhatsApp kontakt | Tiché zahození (log warning) |
| Nepovolený Telegram chat ID | Tiché zahození (log warning) |
| Telegram Markdown parse error | Automatický fallback na plain text |
| Permission denied (inter-agent) | DBotError thrown, zpráva nedoručena |

---

## 15. Testovací architektura

### 15.1 Přehled

```
tests/
├── unit/                                  # Izolované testy jednotlivých komponent
│   ├── core/
│   │   ├── message-bus.test.ts           # 7 testů (pub/sub/request/timeout)
│   │   ├── llm/
│   │   │   ├── openai.provider.test.ts    # 6 testů (mock SDK)
│   │   │   ├── anthropic.provider.test.ts # 7 testů (mock SDK)
│   │   │   ├── mistral.provider.test.ts   # 10 testů (mock SDK)
│   │   │   └── ollama.provider.test.ts    # 14 testů (mock fetch)
│   │   └── permissions/
│   │       └── permission.manager.test.ts # 13 testů
│   ├── master-agent/
│   │   └── intent-router.test.ts         # 15 testů (hardcoded + LLM + task/daily)
│   ├── channels/
│   │   ├── message-normalizer.test.ts    # 9 testů — WhatsApp (6 typů zpráv)
│   │   ├── response-formatter.test.ts    # 7 testů — WhatsApp (chunking)
│   │   ├── telegram-message-normalizer.test.ts  # 7 testů — Telegram (text/photo/doc/voice)
│   │   └── telegram-response-formatter.test.ts  # 10 testů — Telegram (Markdown + fallback + chunking)
│   ├── skills/
│   │   ├── file-system.test.ts           # 10 testů (reálný tmpdir)
│   │   └── markdown-parser.test.ts       # 14 testů
│   └── agents/
│       └── obsidian-agent.test.ts        # 21 testů (+ task/daily)
└── integration/
    └── inter-agent-communication.test.ts  # 8 testů

Celkem: 16 souborů, 173 testů
```

### 15.2 Mock strategie

| Závislost | Unit test přístup | Integrační přístup |
|---|---|---|
| Filesystem | Reálný `os.tmpdir()` | Reálný temp adresář |
| OpenAI SDK | `vi.mock('openai')` | — |
| Anthropic SDK | `vi.mock('@anthropic-ai/sdk')` | — |
| Baileys | Mock EventEmitter + stub metody | — |
| grammY | Mock Bot instance + stub metody | — |
| Redis | — | `ioredis-mock` / testcontainers |
| Permission Manager | Reálná instance, in-memory rules | Reálná instance |

### 15.3 Testovací vzory

**Skills** — reálné FS operace v tmpdir:

```typescript
let basePath: string;
beforeEach(() => {
  basePath = mkdtempSync(join(tmpdir(), 'dbot-test-'));
});
afterEach(() => {
  rmSync(basePath, { recursive: true });
});
```

**LLM Providers** — mock SDK:

```typescript
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(mockResponse)
      }
    }
  }))
}));
```

**Permission + Message Bus** — integration:

```typescript
// Compose: real PermissionManager + real InMemoryMessageBus
const bus = new InMemoryMessageBus();
const pm = new PermissionManager();
pm.setEnabled(true);
bus.setPermissionManager(pm);

// Test: publish without rule → expect throw
await expect(bus.publish('ch', interAgentMsg)).rejects.toThrow('No permission rule');
```
