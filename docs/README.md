# DBot — Dokumentace

> Osobní AI agentní systém s hub-and-spoke architekturou

---

## Architektura

- [Přehled architektury](architecture/overview.md) — hub-and-spoke vzor, komponenty, tech stack, bezpečnostní model, rozšiřitelnost
- [Detail design](architecture/detail-design.md) — technický deep-dive všech vrstev, TypeScript rozhraní, datové toky, bootstrap sekvence

## Průvodci

- [Rychlý start](guides/getting-started.md) — instalace, konfigurace, Docker, environment proměnné, API endpointy
- [Přidání agenta](guides/adding-agent.md) — jak vytvořit nového sub-agenta
- [Přidání kanálu](guides/adding-channel.md) — jak přidat nový vstupní kanál
- [Přidání skillu](guides/adding-skill.md) — jak vytvořit nový skill/modul

## Features

- [Ollama (lokální LLM)](features/ollama.md) — integrace lokálních modelů, dynamické přepínání, REST API
- [Obsidian Sync](features/obsidian-sync.md) — Docker sync architektura, auto-login, dvě hesla, periodic polling
- [Telegram kanál](features/telegram.md) — grammY integrace, long polling, allowlist, rate limiting

## Plánování

- [Specifikace](planning/specification.md) — původní projektové zadání
- [Implementační plán](planning/implementation-plan.md) — 7 fází, milníky M1–M7, acceptance criteria
- [Changelog](planning/changelog.md) — skutečný průběh implementace, řešené problémy, statistiky
