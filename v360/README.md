# V360 Lambda

Client Node.js per l'integrazione con le API Stellantis **ASV360** (Vehicle 360). Ottiene un ****** da **PingFederate** e lo usa per interrogare i servizi **OTA Compatibility** e **Get Details** (dati veicolo + campagne).

---

## Struttura del progetto

```
v360/
├── config.js          # Credenziali e URL di tutti i servizi + default parametri
├── httpClient.js       # Wrapper HTTPS (no dipendenze esterne)
├── authService.js       # Autenticazione PingFederate → ******
├── v360Service.js       # otaCompatibility / getDetails
├── index.js             # Entry point Lambda + CLI
└── package.json
```

> **Nessuna dipendenza npm** — usa esclusivamente moduli built-in di Node.js (`https`, `url`, `crypto`).

---

## Prerequisiti

- Node.js >= 24
- Accesso di rete agli endpoint:
  - `idfed.mpsa.com:443` (PingFederate)
  - `emea-aws.api.stellantis.com` (ASV360 API)

---

## Flusso

```
index.js
   │
   ├─► authService.js  ──POST──► PingFederate  →  ******
   │
   └─► v360Service.js
           ├─► otaCompatibility(token, params) ──POST──► /otaCompatibility
           └─► getDetails(token, params)        ──POST──► /getdetails
```

---

## Utilizzo

### OTA Compatibility

Verifica la compatibilità degli aggiornamenti OTA per un VIN. Solo `vin` è obbligatorio: `includeOtaHistoryData` e `locale`, se non passati, usano i default configurati in `config.js` (`includeOtaHistoryData="true"`, `locale="en_EN"`).

```bash
node index.js otaCompatibility <vin> [key=value ...]
```

**Esempi (esegui da console):**
```bash
node index.js otaCompatibility VR7EMZKU7RJ963237
node index.js otaCompatibility VR7EMZKU7RJ963237 includeOtaHistoryData=true locale=fr_FR
```

npm script equivalente:
```bash
npm run ota -- VR7EMZKU7RJ963237
```

### Get Details

Restituisce i dettagli del veicolo (colori, motorizzazione, campagne, ecc.) e default a `searchType="vin"` più i valori configurati in `config.getDetailsDefaults` (`countryCode`, `clientId`, `offering`, `languageCode`) quando non passati.

```bash
node index.js getdetails <vin> [key=value ...]
```

**Esempi (esegui da console):**
```bash
node index.js getdetails VF3VEAHHWFZ062040
node index.js getdetails VF3VEAHHWFZ062040 countryCode=FR offering="Vehicle Description,campaign" languageCode=fr
```

npm script equivalente:
```bash
npm run getdetails -- VF3VEAHHWFZ062040
```

> ℹ️ La risposta di `getdetails` include il campo `data.externalHexColor` (attualmente `null`), inserito subito prima di `data.externalColor` in previsione di una futura valorizzazione da DB.

---

## Parametri

### `otaCompatibility`

| Parametro | Obbligatorio | Descrizione | Default |
|---|---|---|---|
| `vin` | ✅ | VIN del veicolo | — |
| `includeOtaHistoryData` | ❌ | `"true"` / `"false"` | `config.otaCompatibilityDefaults.includeOtaHistoryData` (`"true"`) |
| `locale` | ❌ | Es. `"en_EN"`, `"fr_FR"` | `config.otaCompatibilityDefaults.locale` (`"en_EN"`) |

### `getDetails`

| Parametro | Obbligatorio | Descrizione | Default |
|---|---|---|---|
| `vin` | ✅ | VIN del veicolo | — |
| `searchType` | ❌ | Tipo di ricerca | `"vin"` |
| `countryCode` | ❌ | Es. `"FR"` | `config.getDetailsDefaults.countryCode` |
| `clientId` | ❌ | Client identifier | `config.getDetailsDefaults.clientId` (da env `ASV_GETDETAILS_CLIENT_ID`) |
| `offering` | ❌ | Es. `"Vehicle Description,campaign"` | `config.getDetailsDefaults.offering` |
| `languageCode` | ❌ | Es. `"fr"` | `config.getDetailsDefaults.languageCode` |

---

## Configurazione

Le credenziali vengono lette da **variabili d'ambiente**. Non inserire mai valori reali in `config.js`.

### Sviluppo locale

Copia `.env.example` in `.env` e inserisci i valori reali:

```bash
cp .env.example .env
```

```ini
# .env  (NON committare questo file — è in .gitignore)
V360_PING_CLIENT_ID=your_ping_client_id_here
V360_PING_CLIENT_SECRET=your_ping_client_secret_here
ASV_CLIENT_ID=your_asv_client_id_here
ASV_CLIENT_SECRET=your_asv_client_secret_here
ASV_GETDETAILS_CLIENT_ID=your_asv_getdetails_client_id_here
```

`config.js` carica automaticamente il file `.env` se presente, senza dipendenze npm.

### Lambda / produzione

Configura le variabili d'ambiente direttamente sull'ambiente di esecuzione (es. AWS Lambda Environment Variables, CI/CD secrets):

| Variabile | Descrizione |
|---|---|
| `V360_PING_CLIENT_ID` | Client ID PingFederate (dedicato v360) |
| `V360_PING_CLIENT_SECRET` | Client Secret PingFederate (dedicato v360) |
| `ASV_CLIENT_ID` | Client ID Stellantis ASV360 API |
| `ASV_CLIENT_SECRET` | Client Secret Stellantis ASV360 API |
| `ASV_GETDETAILS_CLIENT_ID` | Client identifier usato di default nel body di `getdetails` (specifico per ambiente) |

---

## Test automatici

```bash
npm install
npm test               # esegue la suite Jest
npm run test:coverage  # esegue la suite con report di coverage (coverage/)
```

---

## Troubleshooting

| Errore | Causa | Soluzione |
|---|---|---|
| `EAI_AGAIN <hostname>` | DNS non risolve (tipico in WSL) | `echo "nameserver 8.8.8.8" \| sudo tee /etc/resolv.conf` |
| `HTTP 401` | Token scaduto o credenziali errate | Verificare `clientId` / `clientSecret` in `config.js` |
| `HTTP 403` | Scope insufficiente o IP non autorizzato | Verificare `scope` e whitelist IP |
| `Comando non valido` | Lanciato senza argomenti | Specificare `otaCompatibility` o `getdetails` come primo argomento |
