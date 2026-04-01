# DBot — Obsidian Sync

> Synchronizace Obsidian vaultu z cloudu do Docker kontejneru pomocí `obsidian-headless` CLI.

---

## 1. Docker architektura

Dva kontejnery sdílí `vault-data` volume — `dbot` čte/píše poznámky, `obsidian-sync` periodicky synchronizuje s Obsidian Cloud:

```
dbot / dbot-dev (RW) ──┐
                        ├── vault-data (shared volume, /vault) ──► Obsidian Cloud
obsidian-sync (RW) ────┘   periodický sync (každých 30s)
```

| Volume | Účel |
|---|---|
| `vault-data` | Sdílený vault — mountován jako `/vault` v obou kontejnerech |
| `obsidian-auth` | Credentials pro CLI (`/root/.config/obsidian-headless/auth.json`) |

Skill `ObsidianSyncSkill` (v2, běží v `dbot` kontejneru) neprovádí sync sám — pouze kontroluje stav vaultu na filesystému (existence adresáře, počet `.md` souborů, poslední modifikace). Samotný sync řídí `obsidian-sync` kontejner.

Dockerfile (`docker/Dockerfile.sync`) používá `node:22-alpine`, nainstaluje `obsidian-headless` globálně a nastaví healthcheck přes `pgrep -f "ob sync"`.

---

## 2. sync-entrypoint.sh — auto-login a sync

Skript `docker/sync-entrypoint.sh` zajišťuje automatický login a periodickou synchronizaci.

### Auto-login flow

Při startu kontejneru:

1. **Nový login** — pokud existuje `OBSIDIAN_EMAIL` a neexistuje `auth.json`:
   - `ob login --email $OBSIDIAN_EMAIL --password $OBSIDIAN_PASSWORD`
   - `ob sync-setup --vault $OBSIDIAN_VAULT_NAME [--password $OBSIDIAN_VAULT_PASSWORD]`
   - `ob sync` (iniciální stažení vaultu)
2. **Existující credentials** — pokud `auth.json` existuje, použijí se uložené credentials z auth volume
3. **Žádné credentials** — pokud není nastavena `OBSIDIAN_EMAIL` a neexistuje `auth.json`, kontejner skončí s chybou (exit 1)

### Periodický polling loop

Po úspěšném loginu/načtení credentials přejde skript do nekonečné smyčky:

```sh
while true; do
  ob sync 2>&1 || echo "[sync-entrypoint] Sync error, will retry..."
  sleep "$SYNC_INTERVAL"
done
```

Interval je konfigurovatelný přes `OBSIDIAN_SYNC_INTERVAL` (výchozí: 30 sekund).

---

## 3. Dvě hesla

Obsidian používá dva nezávislé typy hesel:

| Proměnná | Účel | Příkaz |
|---|---|---|
| `OBSIDIAN_PASSWORD` | Heslo k Obsidian **účtu** (přihlášení) | `ob login --password` |
| `OBSIDIAN_VAULT_PASSWORD` | **Šifrovací** heslo vaultu (end-to-end encryption) | `ob sync-setup --password` |

`OBSIDIAN_VAULT_PASSWORD` je volitelné — pokud není nastaveno, `ob sync-setup` proběhne bez šifrovacího hesla. Typický problém: chyba "Failed to validate password" při `ob sync-setup` znamená, že vault je zašifrovaný a chybí `OBSIDIAN_VAULT_PASSWORD`.

---

## 4. Konfigurace — environment variables

Všechny proměnné se nastavují v `.env` souboru:

| Proměnná | Povinné | Výchozí | Popis |
|---|---|---|---|
| `OBSIDIAN_EMAIL` | ano | — | E-mail Obsidian účtu |
| `OBSIDIAN_PASSWORD` | ano | — | Heslo k účtu |
| `OBSIDIAN_VAULT_NAME` | ne | `default` | Název vaultu v Obsidian cloudu |
| `OBSIDIAN_VAULT_PASSWORD` | ne | — | Šifrovací heslo (pokud je vault šifrován) |
| `OBSIDIAN_SYNC_INTERVAL` | ne | `30` | Interval syncu v sekundách |

---

## 5. Proč polling místo --continuous

Původní implementace používala `ob sync --continuous`, který sleduje filesystem eventy přes inotify. Tento přístup **nefunguje** v Docker prostředí:

- Docker shared volumes (`vault-data`) **netriggerují inotify události cross-container**.
- Soubory zapsané z `dbot` kontejneru nevyvolají inotify notifikaci v `obsidian-sync` kontejneru.
- Řešení: periodický polling (`ob sync` v loop s `sleep`) provádí full diff oproti cloudu při každém volání — spolehlivější než inotify přes volume boundary.

---

## 6. Troubleshooting

### Stale auth volume

**Příznak:** Sync kontejner loguje chyby autentizace, ale nespouští nový login.

**Příčina:** `auth.json` existuje na `obsidian-auth` volume, ale token vypršel. Entrypoint přeskočí login, protože soubor existuje.

**Řešení:**
```bash
docker compose down
docker volume rm docker_obsidian-auth
docker compose up -d obsidian-sync
```

### Sync nedetekuje změny

**Příznak:** Soubory změněné v `dbot` kontejneru se neobjevují v cloudu.

**Řešení:**
1. Zkontrolujte logy: `docker compose logs obsidian-sync`
2. Ověřte healthcheck: `docker inspect --format='{{.State.Health.Status}}' dbot-obsidian-sync`
3. Snížení intervalu: nastavte `OBSIDIAN_SYNC_INTERVAL=10` v `.env`

### Vault not found

**Příznak:** `ObsidianSyncSkill` hlásí `VAULT_NOT_FOUND`.

**Řešení:**
1. Ověřte, že `vault-data` volume existuje: `docker volume ls | grep vault`
2. Zkontrolujte, že oba kontejnery mají mount na `/vault`
3. Počkejte na dokončení `start-period` healthchecku (30s) a zkontrolujte logy sync kontejneru
