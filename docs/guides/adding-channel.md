# Přidání nového kanálu

> Jak přidat nový vstupní kanál do DBot

## Postup

1. Vytvořte adresář `src/channels/{nový-kanál}/` se soubory:
   - `{kanál}.channel.ts` — implementace `IChannel`
   - `message-normalizer.ts` — konverze nativního formátu → `UserMessage`
   - `response-formatter.ts` — konverze `AgentResponse` → nativní formát
   - `index.ts` — barrel exports
2. Přidejte hodnotu do `ChannelType` enum v `src/channels/channel.interface.ts`
3. Přidejte config schema do `src/core/config/config.schema.ts`
4. Přidejte výchozí konfiguraci do `config/default.yaml` pod `channels`
5. Přidejte bootstrap logiku do `src/main.ts`
6. Zaregistrujte kanál v `ChannelRouter`

## IChannel rozhraní

```typescript
interface IChannel {
  id: string;
  name: string;
  type: ChannelType;
  initialize(config: any): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ChannelStatus;
  setMessageHandler(handler: MessageHandler): void;
}
```

## Referenční implementace

- `src/channels/whatsapp/` — komplexní kanál (WebSocket, QR auth, reconnect)
- `src/channels/telegram/` — středně složitý (grammY, long polling, allowlist)
- `src/channels/rest-api/` — minimální kanál (HTTP bridge)
