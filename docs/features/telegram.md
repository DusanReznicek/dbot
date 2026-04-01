# Telegram kanal

> Integrace Telegram Bot API přes grammY (long polling)

---

## Přehled

Telegram kanal využívá [grammY](https://grammy.dev) — TypeScript-first Telegram Bot API framework. Používá **long polling** (nevyžaduje veřejnou URL ani webhook). Skládá se ze 3 komponent:

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
│                              │  - MarkdownV2 formatting  │    │
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

Třída `TelegramChannel` (`src/channels/telegram/telegram.channel.ts`) zapouzdřuje inicializaci bota, registraci handlerů, normalizaci zpráv, formátování odpovědí a bezpečnostní vrstvy (allowlist, rate limiter, filtr skupin).

---

## grammY Bot

Long polling cyklus — bot se periodicky dotazuje Telegram serverů na nové zprávy. Žádný webhook ani veřejná URL nejsou potřeba:

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

---

## MessageNormalizer

Soubor `src/channels/telegram/message-normalizer.ts` převádí nativní grammY `Message` na interní `UserMessage`:

| TG typ | Detekce | UserMessage type | Speciální zpracování |
|---|---|---|---|
| Text | `message.text` | `text` | Přímý mapping, včetně příkazů |
| Foto | `message.photo` | `image` | Stažení přes `getFile()`, výběr nejvyššího rozlišení, caption |
| Dokument | `message.document` | `document` | Stažení přes `getFile()`, fileName, mimeType |
| Hlas/Audio | `message.voice` / `message.audio` | `audio` | Stažení přes `getFile()`, duration |

Binární přílohy (foto, dokumenty, audio) se stahují přes `api.getFile()` a převádějí na base64.

Zprávy bez `msg.from` (channel posts) jsou přeskočeny. Nepodporované typy (sticker, location apod.) se loggují a ignorují.

Každá zpráva obsahuje `metadata.conversationId` (= chat ID) a `metadata.pushName` (jméno odesílatele).

---

## ResponseFormatter

Soubor `src/channels/telegram/response-formatter.ts` převádí `AgentResponse` na Telegram zprávy s **MarkdownV2** formátováním:

- Speciální znaky jsou escapovány pro MarkdownV2 parse mode
- Při selhání parsování Telegram API → automatický **fallback na plain text** (bez parse mode)
- **Chunking algoritmus** — dělení na hranici `\n` nebo mezery, tvrdý řez na 4096 znacích

### Sekvence odeslání odpovědi

1. Chat action: `sendChatAction('typing')` (pokud `typingIndicator: true`)
2. Odeslání fotografie s caption (pokud `response.image`)
3. Odeslání dokumentu (pokud `response.document`, base64 → `InputFile`)
4. Odeslání textových chunků (sekvenčně, MarkdownV2 → fallback plain text)

---

## Rate Limiter

Token-bucket rate limiter — per-chat-ID:

```
Konfigurace:
  maxTokens    = 10        (max burst)
  refillRate   = 10/min    (obnova)

allow(chatId):
  → shodná logika s WhatsApp rate limiterem
```

Ochrana proti flood zprávám. Každé chat ID má vlastní bucket s tokeny, které se postupně obnovují. Při vyčerpání tokenů se zpráva ignoruje.

---

## Allowlist

Filtrování přístupů dle chat ID:

```
Příchozí zpráva od chat ID 123456789:

1. Je chatId v allowedChatIds setu? → ANO → pokračuj
2. Není v allowedChatIds → tiše ignoruj (log warning)

Skupinové zprávy (chat.type === 'group' | 'supergroup'):
  → allowGroups: false → ignoruj
  → allowGroups: true → zkontroluj chatId v allowedChatIds
```

- Allowlist prázdný (`allowedChatIds: []`) = žádné zprávy nejsou povoleny
- Skupinové filtrování se řídí přes `allowGroups` flag (výchozí: `false`)

---

## Konfigurace

### default.yaml

Sekce `channels.telegram`:

```yaml
telegram:
  enabled: true
  botToken: ""
  allowedChatIds: []
  allowGroups: false
  typingIndicator: true
  maxMessageLength: 4096
  rateLimitPerChat: 10
```

### Environment proměnná

| Proměnná | Popis |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token (alternativa k `botToken` v YAML) |

Token z env proměnné má vyšší prioritu než hodnota v `default.yaml`.

---

## Setup

1. Otevřete Telegram a najděte [@BotFather](https://t.me/BotFather)
2. Vytvořte nového bota: `/newbot` → zadejte jméno → získáte token
3. Uložte token do `.env`: `TELEGRAM_BOT_TOKEN=123456:ABC-DEF...`
4. Nastavte `enabled: true` v `config/default.yaml` (sekce `channels.telegram`)
5. (Volitelně) Přidejte povolená chat ID do `allowedChatIds`
6. Spusťte DBot — bot zahájí long polling automaticky

### Zjištění chat ID

Napište botu zprávu. Pokud vaše chat ID není v allowlistu, DBot zaloguje warning s vaším chat ID. Toto ID přidejte do `allowedChatIds`.

---

## Soubory

| Soubor | Popis |
|---|---|
| `src/channels/telegram/telegram.channel.ts` | `TelegramChannel` — grammY Bot, long polling, allowlist, rate limiter |
| `src/channels/telegram/message-normalizer.ts` | TG `Message` → `UserMessage` (text, photo, document, voice/audio) |
| `src/channels/telegram/response-formatter.ts` | `AgentResponse` → TG zpráva, MarkdownV2 + plain text fallback, chunking |
| `src/channels/telegram/index.ts` | Re-export |
| `tests/unit/channels/telegram-message-normalizer.test.ts` | 7 testů (text, photo, document, voice/audio, edge cases) |
| `tests/unit/channels/telegram-response-formatter.test.ts` | 10 testů (Markdown formatting, plain text fallback, chunking) |
