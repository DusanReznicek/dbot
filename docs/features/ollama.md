# DBot — Plán integrace Ollama (lokální LLM)

> Přidání podpory lokálních modelů běžících v Ollama s dynamickou změnou modelu za běhu.

---

## 1. Přehled

[Ollama](https://ollama.com) je runtime pro lokální LLM modely (Llama 3, Mistral, Phi, Gemma, CodeLlama, …). Nabízí HTTP REST API kompatibilní s OpenAI formátem, běží na `localhost:11434`.

### Proč Ollama?

| Vlastnost | Cloud LLM (OpenAI/Anthropic) | Ollama (lokální) |
|---|---|---|
| Latence | 500ms–3s | 50ms–500ms |
| Cena | Per-token | Zdarma |
| Privátnost | Data odeslána do cloudu | Vše lokální |
| Dostupnost | Vyžaduje internet | Offline |
| Kvalita | Nejlepší modely (GPT-4o, Claude) | Menší modely, ale rychlý vývoj |
| Modely | Fixní nabídka | Libovolný model z knihovny |

### Klíčový požadavek: dynamická změna modelu

Uživatel chce přepínat mezi modely za běhu — bez restartu DBot:
- `/model llama3.2` → přepne na Llama 3.2
- `/model mistral` → přepne na Mistral
- `/model list` → zobrazí dostupné modely

---

## 2. Ollama API

Ollama nabízí dva API formáty:

### 2.1 Nativní API (`/api/*`)

```
POST /api/chat
{
  "model": "llama3.2",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "stream": false,
  "options": {
    "temperature": 0.7,
    "num_predict": 1024
  }
}

→ Response:
{
  "model": "llama3.2",
  "message": {"role": "assistant", "content": "..."},
  "done": true,
  "total_duration": 123456789,
  "eval_count": 42,
  "prompt_eval_count": 15
}
```

### 2.2 OpenAI-kompatibilní API (`/v1/*`)

```
POST /v1/chat/completions
{
  "model": "llama3.2",
  "messages": [...],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false
}

→ Response: Identický formát jako OpenAI API
```

### 2.3 Další užitečné endpointy

```
GET  /api/tags       → Seznam nainstalovaných modelů
POST /api/show       → Detail modelu (velikost, parametry, template)
POST /api/pull       → Stažení nového modelu
DELETE /api/delete   → Smazání modelu
GET  /api/ps         → Běžící modely (v paměti)
```

---

## 3. Architektonický návrh

### 3.1 Kde se Ollama zapojí

```
┌──────────────────────────────────────────────────┐
│              LLMProviderFactory                    │
│                                                    │
│  providers: Map<string, ILLMProvider>              │
│    ├─ "openai"    → OpenAIProvider                │
│    ├─ "anthropic" → AnthropicProvider             │
│    └─ "ollama"    → OllamaProvider  ← NOVÉ       │
│                                                    │
│  getDefaultProvider() → dle config.defaultProvider │
└──────────────────────────────────────────────────┘
```

`OllamaProvider` implementuje stejné rozhraní `ILLMProvider` jako ostatní providery. Žádné změny v Master Agent, Intent Router ani jinde nejsou potřeba.

### 3.2 OllamaProvider — interní architektura

```
┌─────────────────────────────────────────────────────────┐
│                    OllamaProvider                         │
│                                                          │
│  id: "ollama"                                            │
│  baseUrl: "http://localhost:11434"                       │
│  currentModel: "llama3.2"      ← dynamicky měnitelný    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  chat(messages, options)                          │   │
│  │    model = options?.model ?? this.currentModel    │   │
│  │    POST /api/chat {model, messages, stream:false} │   │
│  │    → mapuje response na LLMResponse               │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  streamChat(messages, options)                     │   │
│  │    POST /api/chat {model, messages, stream:true}  │   │
│  │    → NDJSON stream → yield LLMStreamChunk         │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Správa modelů (nové metody):                     │   │
│  │  - setModel(name) → změní currentModel            │   │
│  │  - getModel() → vrátí currentModel                │   │
│  │  - listModels() → GET /api/tags                   │   │
│  │  - getModelInfo(name) → POST /api/show            │   │
│  │  - pullModel(name) → POST /api/pull               │   │
│  │  - isAvailable() → health check                   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Implementační plán

### Fáze A — OllamaProvider (core)

| # | Soubor | Změna | Popis |
|---|---|---|---|
| 1 | `src/core/llm/ollama.provider.ts` | **Nový** | `OllamaProvider` implementující `ILLMProvider` |
| 2 | `src/core/config/config.schema.ts` | **Úprava** | Přidání `ollama` do `llmSchema` |
| 3 | `config/default.yaml` | **Úprava** | Přidání `ollama` sekce do `llm.providers` |
| 4 | `src/core/llm/llm-provider.factory.ts` | **Úprava** | Inicializace `OllamaProvider` |
| 5 | `src/core/llm/index.ts` | **Úprava** | Export `OllamaProvider` |
| 6 | `tests/unit/core/llm/ollama.provider.test.ts` | **Nový** | Unit testy (mock fetch) |

### Fáze B — Dynamická změna modelu

| # | Soubor | Změna | Popis |
|---|---|---|---|
| 7 | `src/api/routes/llm.routes.ts` | **Nový** | REST API pro správu modelů |
| 8 | `src/api/server.ts` | **Úprava** | Registrace LLM routes |
| 9 | `src/master-agent/master-agent.ts` | **Úprava** | Přepínání provideru za běhu |

### Fáze C — Ověření

| # | Soubor | Změna | Popis |
|---|---|---|---|
| 10 | `tests/unit/core/llm/ollama.provider.test.ts` | **Rozšíření** | Testy dynamické změny modelu |
| 11 | Ověření | — | tsc, vitest, manuální test s Ollama |

---

## 5. Detailní specifikace

### 5.1 OllamaProvider (`src/core/llm/ollama.provider.ts`)

```typescript
export interface OllamaProviderConfig {
  model: string;          // Výchozí model (např. "llama3.2")
  baseUrl?: string;       // Default: "http://localhost:11434"
  keepAlive?: string;     // Jak dlouho model zůstane v paměti ("5m", "0" = uvolnit hned)
  timeout?: number;       // Request timeout v ms (default: 120000)
}

export interface OllamaModelInfo {
  name: string;           // "llama3.2:latest"
  size: number;           // Velikost v bytech
  digest: string;         // SHA256
  modifiedAt: string;     // ISO date
  details: {
    family: string;       // "llama"
    parameterSize: string;// "8B"
    quantizationLevel: string; // "Q4_0"
  };
}

export class OllamaProvider implements ILLMProvider {
  public readonly id = 'ollama';
  private baseUrl: string;
  private currentModel: string;
  private keepAlive: string;
  private timeout: number;

  constructor(config: OllamaProviderConfig);

  // === ILLMProvider ===
  async chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse>;
  async *streamChat(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;
  getTokenCount(text: string): number;

  // === Model management (Ollama-specific) ===
  setModel(model: string): void;
  getModel(): string;
  async listModels(): Promise<OllamaModelInfo[]>;
  async getModelInfo(model: string): Promise<OllamaModelInfo>;
  async pullModel(model: string): Promise<void>;
  async isAvailable(): Promise<boolean>;
}
```

#### chat() — implementace

```typescript
async chat(messages: ChatMessage[], options?: LLMOptions): Promise<LLMResponse> {
  const model = options?.model ?? this.currentModel;

  // Sestavení požadavku (nativní Ollama API)
  const body = {
    model,
    messages: this.toOllamaMessages(messages, options?.systemPrompt),
    stream: false,
    options: {
      temperature: options?.temperature ?? 0.7,
      num_predict: options?.maxTokens ?? 2048,
    },
    keep_alive: this.keepAlive,
    // Tools — Ollama podporuje tools od verze 0.4+
    ...(options?.tools?.length ? { tools: this.toOllamaTools(options.tools) } : {}),
  };

  const response = await fetch(`${this.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(this.timeout),
  });

  if (!response.ok) {
    throw new DBotError(
      `Ollama API error: ${response.status} ${response.statusText}`,
      'LLM_ERROR',
      { model, status: response.status }
    );
  }

  const data = await response.json();

  return {
    content: data.message?.content ?? '',
    model: data.model,
    usage: {
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
    },
    finishReason: data.done ? 'stop' : 'length',
    toolCalls: this.extractToolCalls(data.message),
  };
}
```

#### streamChat() — NDJSON streaming

```typescript
async *streamChat(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk> {
  const model = options?.model ?? this.currentModel;

  const response = await fetch(`${this.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: this.toOllamaMessages(messages, options?.systemPrompt),
      stream: true,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 2048,
      },
    }),
    signal: AbortSignal.timeout(this.timeout),
  });

  // Ollama streamuje NDJSON — jeden JSON objekt per řádek
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';  // Nedokončený řádek zpět do bufferu

    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line);
      yield {
        content: chunk.message?.content ?? '',
        done: chunk.done ?? false,
      };
    }
  }
}
```

#### toOllamaMessages() — system prompt handling

```typescript
private toOllamaMessages(messages: ChatMessage[], systemPrompt?: string): OllamaChatMessage[] {
  const result: OllamaChatMessage[] = [];

  // Ollama podporuje system roli přímo v messages (jako OpenAI)
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    result.push({ role: msg.role, content: msg.content });
  }

  return result;
}
```

#### toOllamaTools() — tool calling

```typescript
// Ollama používá OpenAI-kompatibilní formát pro tools (od verze 0.4+)
private toOllamaTools(tools: ToolDefinition[]): OllamaTool[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
```

#### Model management

```typescript
setModel(model: string): void {
  this.currentModel = model;
  logger.info({ model }, 'Ollama model changed');
}

getModel(): string {
  return this.currentModel;
}

async listModels(): Promise<OllamaModelInfo[]> {
  const response = await fetch(`${this.baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json();
  return data.models ?? [];
}

async getModelInfo(model: string): Promise<OllamaModelInfo> {
  const response = await fetch(`${this.baseUrl}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model }),
    signal: AbortSignal.timeout(5000),
  });
  return response.json();
}

async pullModel(model: string): Promise<void> {
  // Pulluje model — může trvat minuty, proto dlouhý timeout
  await fetch(`${this.baseUrl}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: false }),
    signal: AbortSignal.timeout(600_000), // 10 minut
  });
}

async isAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${this.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

### 5.2 Config schema změny

**`src/core/config/config.schema.ts`:**

```typescript
// Nové: Ollama provider schema
const ollamaProviderSchema = z.object({
  model: z.string(),
  baseUrl: z.string().default('http://localhost:11434'),
  keepAlive: z.string().default('5m'),
  timeout: z.number().default(120000),
});

// Upravené: llmSchema
const llmSchema = z.object({
  defaultProvider: z.enum(['openai', 'anthropic', 'ollama']).default('openai'),  // ← přidáno 'ollama'
  providers: z.object({
    openai: llmProviderSchema.default({ model: 'gpt-4o' }),
    anthropic: llmProviderSchema.default({ model: 'claude-sonnet-4-20250514' }),
    ollama: ollamaProviderSchema.default({ model: 'llama3.2' }),  // ← nové
  }),
});
```

### 5.3 Config YAML změny

**`config/default.yaml`:**

```yaml
llm:
  defaultProvider: "openai"   # Lze změnit na "ollama" pro lokální modely
  providers:
    openai:
      model: "gpt-4o"
    anthropic:
      model: "claude-sonnet-4-20250514"
    ollama:                    # ← nové
      model: "llama3.2"
      baseUrl: "http://localhost:11434"
      keepAlive: "5m"
      timeout: 120000
```

### 5.4 Factory změny

**`src/core/llm/llm-provider.factory.ts`:**

```typescript
initializeFromConfig(config: LLMConfig): void {
  // ... existující OpenAI a Anthropic ...

  // Ollama — nevyžaduje API klíč, stačí ověřit dostupnost
  if (config.providers.ollama) {
    try {
      const ollamaProvider = new OllamaProvider({
        model: config.providers.ollama.model,
        baseUrl: config.providers.ollama.baseUrl,
        keepAlive: config.providers.ollama.keepAlive,
        timeout: config.providers.ollama.timeout,
      });
      this.providers.set('ollama', ollamaProvider);
      logger.info({ model: config.providers.ollama.model }, 'Ollama provider registered');
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize Ollama provider');
    }
  }
}
```

**Poznámka:** Na rozdíl od OpenAI/Anthropic, Ollama nevyžaduje API klíč. Provider se vytvoří vždy, ale `isAvailable()` ověří, zda Ollama server skutečně běží.

### 5.5 REST API pro správu modelů

**`src/api/routes/llm.routes.ts`:**

```
GET  /api/v1/llm/providers          → Seznam providerů + aktuální model
GET  /api/v1/llm/provider/:id       → Detail provideru
PUT  /api/v1/llm/default            → Změna default provideru
POST /api/v1/llm/ollama/model       → Změna Ollama modelu za běhu
GET  /api/v1/llm/ollama/models      → Seznam dostupných Ollama modelů
POST /api/v1/llm/ollama/pull        → Stažení nového modelu
GET  /api/v1/llm/ollama/status      → Stav Ollama serveru
```

**Příklady:**

```bash
# Přepni Ollama na model mistral
curl -X POST /api/v1/llm/ollama/model -d '{"model": "mistral"}'
→ {"model": "mistral", "previous": "llama3.2"}

# Seznam nainstalovaných modelů
curl /api/v1/llm/ollama/models
→ {"models": [
    {"name": "llama3.2:latest", "size": 4700000000, "parameterSize": "8B"},
    {"name": "mistral:latest", "size": 4100000000, "parameterSize": "7B"},
    {"name": "phi3:latest", "size": 2300000000, "parameterSize": "3.8B"}
  ]}

# Stáhni nový model
curl -X POST /api/v1/llm/ollama/pull -d '{"model": "codellama"}'
→ {"status": "pulling", "model": "codellama"}

# Přepni default provider na Ollama
curl -X PUT /api/v1/llm/default -d '{"provider": "ollama"}'
→ {"defaultProvider": "ollama", "model": "mistral"}
```

### 5.6 Dynamická změna modelu přes WhatsApp

Rozšíření intent routeru o systémové příkazy:

```
Uživatel: "/model llama3.2"
  → IntentRouter detekuje prefix "/" → systémový příkaz
  → MasterAgent.handleSystemCommand("model", "llama3.2")
  → OllamaProvider.setModel("llama3.2")
  → Response: "Model změněn na llama3.2"

Uživatel: "/model list"
  → OllamaProvider.listModels()
  → Response: "Dostupné modely:\n- llama3.2 (8B)\n- mistral (7B)\n- phi3 (3.8B)"

Uživatel: "/provider ollama"
  → MasterAgent.setLLMProvider(factory.getProvider('ollama'))
  → Response: "Provider změněn na ollama (model: llama3.2)"

Uživatel: "/provider openai"
  → MasterAgent.setLLMProvider(factory.getProvider('openai'))
  → Response: "Provider změněn na openai (model: gpt-4o)"
```

---

## 6. Unit testy

**`tests/unit/core/llm/ollama.provider.test.ts`:**

| # | Scénář | Popis |
|---|---|---|
| 1 | chat() — základní volání | Mock fetch → vrátí LLMResponse se správnými poli |
| 2 | chat() — system prompt | Ověří, že system prompt je v messages jako první |
| 3 | chat() — custom model via options | `options.model` má přednost před `currentModel` |
| 4 | chat() — tool calling | Správná konverze tools + extrakce tool calls z odpovědi |
| 5 | chat() — API error (500) | Throw `DBotError` s kontextem |
| 6 | chat() — timeout | AbortSignal.timeout → DBotError |
| 7 | chat() — Ollama nedostupná | fetch throw → DBotError |
| 8 | streamChat() — NDJSON parsing | Chunky správně parsovány, `done: true` na konci |
| 9 | streamChat() — partial buffer | Neúplný řádek buffered do dalšího čtení |
| 10 | getTokenCount() | Heuristika chars/3.5 |
| 11 | setModel() / getModel() | Dynamická změna modelu |
| 12 | listModels() | Mock /api/tags → pole OllamaModelInfo |
| 13 | isAvailable() — server běží | Mock 200 → true |
| 14 | isAvailable() — server neběží | Mock network error → false |

---

## 7. Konfigurace pro různé scénáře

### 7.1 Pouze lokální (offline)

```yaml
llm:
  defaultProvider: "ollama"
  providers:
    ollama:
      model: "llama3.2"
      baseUrl: "http://localhost:11434"
```

```bash
# Bez API klíčů — OpenAI/Anthropic se neinicializují
npm run dev
```

### 7.2 Hybridní (Ollama + cloud fallback)

```yaml
llm:
  defaultProvider: "ollama"    # Primárně lokální
  providers:
    ollama:
      model: "llama3.2"
    openai:
      model: "gpt-4o"         # Fallback pro složité tasky
```

Možné rozšíření: automatický fallback na cloud LLM pokud Ollama není dostupná.

### 7.3 Docker Compose s Ollama

```yaml
services:
  dbot:
    build: ...
    environment:
      - DBOT__llm__defaultProvider=ollama
      - DBOT__llm__providers__ollama__baseUrl=http://ollama:11434
    depends_on:
      - ollama

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
    # GPU podpora (volitelné):
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

volumes:
  ollama-data:
```

---

## 8. Rozdíly oproti cloud providerům

| Aspekt | OpenAI / Anthropic | Ollama |
|---|---|---|
| Autentizace | API klíč (povinný) | Žádná (lokální server) |
| Inicializace | Fail pokud chybí klíč | Vždy se vytvoří, health check za běhu |
| Modely | Fixní (gpt-4o, claude-sonnet) | Dynamicky měnitelné za běhu |
| Tool calling | Plná podpora | Podpora od Ollama 0.4+ (závisí na modelu) |
| Streaming | SSE (server-sent events) | NDJSON (newline-delimited JSON) |
| Token counting | SDK / heuristika | Ollama vrací eval_count v response |
| Timeout | 30–60s typicky | 30–120s (závisí na modelu a HW) |
| Cena | Per-token | Zdarma |
| Kvalita odpovědí | Vysoká (velké modely) | Závisí na zvoleném modelu |

---

## 9. Omezení a rizika

| Riziko | Dopad | Mitigace |
|---|---|---|
| Ollama server neběží | LLM routing nefunguje | `isAvailable()` check → fallback na hardcoded routing |
| Pomalý model na slabém HW | Vysoká latence odpovědí | Konfigurovatelný timeout, menší modely (phi3, gemma:2b) |
| Malé modely špatně routují intenty | Intent router vrací špatné výsledky | Fallback na hardcoded routing při nízké confidence |
| Tool calling nepodporováno modelem | Některé modely neumí tools | Detekce v runtime, graceful fallback na non-tool prompt |
| Model není nainstalován | 404 z Ollama API | Validace přes `listModels()` před `setModel()` |
| Ollama běží na jiném stroji | Nutná síťová konfigurace | `baseUrl` konfigurovatelný, Docker networking |

---

## 10. Budoucí rozšíření

### 10.1 Automatický model routing

Různé tasky → různé modely:

```yaml
ollama:
  models:
    default: "llama3.2"         # Obecné konverzace
    coding: "codellama"          # Programátorské tasky
    small: "phi3"                # Rychlé jednoduché odpovědi
  routing:
    - capability: "obsidian.*"
      model: "default"
    - capability: "code.*"
      model: "coding"
```

### 10.2 Model preloading

Přednahrání modelů do paměti při startu:

```typescript
async warmup(): Promise<void> {
  await this.chat([{ role: 'user', content: 'hello' }], { maxTokens: 1 });
}
```

### 10.3 Ollama health monitoring

```typescript
// Periodický health check (každých 30s)
setInterval(async () => {
  const available = await ollamaProvider.isAvailable();
  if (!available && this.defaultProvider === 'ollama') {
    logger.warn('Ollama unavailable — switching to cloud fallback');
    this.switchToFallbackProvider();
  }
}, 30000);
```

### 10.4 Embeddings podpora

Ollama nabízí i embeddings endpoint (`/api/embeddings`) — užitečné pro:
- Sémantické vyhledávání v Obsidian vaultu
- RAG (Retrieval-Augmented Generation) nad poznámkami

---

## 11. Shrnutí implementačních kroků

```
Krok 1:  Vytvořit src/core/llm/ollama.provider.ts         (OllamaProvider)
Krok 2:  Upravit src/core/config/config.schema.ts          (ollama schema)
Krok 3:  Upravit config/default.yaml                       (ollama sekce)
Krok 4:  Upravit src/core/llm/llm-provider.factory.ts      (registrace)
Krok 5:  Upravit src/core/llm/index.ts                     (export)
Krok 6:  Vytvořit src/api/routes/llm.routes.ts             (model management API)
Krok 7:  Upravit src/api/server.ts                         (registrace routes)
Krok 8:  Vytvořit tests/unit/core/llm/ollama.provider.test.ts (14 testů)
Krok 9:  Ověření: tsc --noEmit + vitest run
Krok 10: Manuální test: ollama serve → npm run dev → POST /api/v1/chat
Krok 11: Aktualizovat docs/architecture/overview.md         (LLM sekce, tech stack, Docker Compose)
Krok 12: Aktualizovat docs/planning/implementation-plan.md  (Ollama do fáze 4/7)
Krok 13: Aktualizovat docs/architecture/detail-design.md    (LLM vrstva, konfigurace, API endpointy)
Krok 14: Aktualizovat docs/planning/changelog.md            (nová sekce Ollama integrace)
Krok 15: Aktualizovat README.md                            (tech stack, API, env vars, spuštění)
```

**Odhad rozsahu:** ~400 řádků nového kódu + ~50 řádků úprav existujících souborů + ~100 řádků dokumentace.
**Žádné breaking changes** — stávající OpenAI/Anthropic providery fungují beze změn.
