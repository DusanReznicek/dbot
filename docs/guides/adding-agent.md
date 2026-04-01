# Přidání nového sub-agenta

> Jak vytvořit a zaregistrovat nového agenta v DBot

## Postup

1. Zkopírujte šablonu `src/agents/_template/` do `src/agents/{nový-agent}/`
2. Implementujte rozhraní `ISubAgent`:
   - `id` — unikátní identifikátor (např. `"calendar-agent"`)
   - `name` — čitelný název
   - `capabilities` — pole schopností (např. `["calendar.read", "calendar.write"]`)
   - `handleMessage(message: AgentMessage)` — hlavní dispatch logika
3. Vytvořte konfigurační schema (`{agent}.config.ts`) s Zod validací
4. Přidejte konfiguraci do `config/agents.yaml`:
   ```yaml
   agents:
     - id: "nový-agent"
       enabled: true
       config:
         # ... specifická konfigurace
   ```
5. (Volitelně) Přidejte permission pravidla do `config/permissions.yaml`

## Referenční implementace

Viz `src/agents/obsidian-agent/` — kompletní agent s 9 capabilities, VaultManager, config schema.

## Klíčové soubory

| Soubor | Popis |
|---|---|
| `src/core/interfaces/agent.interface.ts` | `ISubAgent`, `AgentContext`, `HealthStatus` |
| `src/agents/_template/template-agent.ts` | Šablona s boilerplate kódem |
| `config/agents.yaml` | Registrace a konfigurace agentů |
