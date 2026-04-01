# Přidání nového skillu

> Jak vytvořit nový skill/modul pro DBot agenty

## Postup

1. Vytvořte adresář `src/skills/{nový-skill}/` se soubory:
   - `skill.manifest.json` — manifest s akcemi a konfiguračním schématem
   - `{skill}.skill.ts` — implementace `ISkill`
   - `index.ts` — barrel exports
2. Implementujte rozhraní `ISkill`:
   - `initialize(config)` — jednorázová inicializace
   - `execute(action, params)` — dispatch na konkrétní akci
   - `getAvailableActions()` — seznam dostupných akcí
3. Vytvořte `skill.manifest.json`:
   ```json
   {
     "id": "nový-skill",
     "name": "Nový Skill",
     "version": "1.0.0",
     "description": "Popis skillu",
     "actions": [
       { "name": "akce1", "description": "Co dělá", "parameters": {} }
     ],
     "configSchema": {},
     "permissions": ["filesystem.read"]
   }
   ```
4. Zaregistrujte v `SkillRegistry` (v `src/main.ts` nebo dynamicky)

## Referenční implementace

- `src/skills/file-system/` — CRUD operace, sandbox, path traversal ochrana
- `src/skills/markdown-parser/` — frontmatter, wikilinks, tags
- `src/skills/obsidian-sync/` — filesystem-based status check

## Klíčové soubory

| Soubor | Popis |
|---|---|
| `src/core/interfaces/skill.interface.ts` | `ISkill`, `SkillManifest`, `SkillResult` |
| `src/core/registry/skill.registry.ts` | Registrace a validace manifestů |
