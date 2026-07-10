# DMS Lambda

Client Node.js per l'integrazione con le API Stellantis **DML** (Digital Layer). Ottiene un ****** da **PingFederate** e lo usa per interrogare i servizi **DMS Settings** e **DMS Inquiry** (LFP / WL / MP).

---

## Struttura del progetto

```
dms/
├── config.js          # Credenziali e URL di tutti i servizi
├── httpClient.js       # Wrapper HTTPS (no dipendenze esterne)
├── authService.js      # Autenticazione PingFederate → ******
├── dmsService.js       # getDmsSettings / postDmsInquiry / buildTypeSection
├── index.js            # Entry point Lambda + CLI
├── WL_Request.json     # Esempio di payload completo per inquiry --file
└── package.json
```

> **Nessuna dipendenza npm** — usa esclusivamente moduli built-in di Node.js (`https`, `url`, `crypto`).

---

## Prerequisiti

- Node.js >= 24
- Accesso di rete agli endpoint:
  - `idfed-preprod.mpsa.com:443` (PingFederate)
  - `emea-aws.dev.np-api.stellantis.com` (DML API)

---

## Flusso

```
index.js
   │
   ├─► authService.js  ──POST──► PingFederate  →  ******
   │
   └─► dmsService.js
           ├─► getDmsSettings(token, params)  ──GET──►  /dms/settings
           └─► postDmsInquiry(token, body)     ──POST──► /inquiry/DML/1.0/inquiry
```

---

## Utilizzo

### DMS Settings

Recupera la configurazione DMS del dealer.

```bash
node index.js settings <country> <brand> <dealer>
```

**Esempio (esegui da console):**
```bash
node index.js settings fr FT 0062230
```

### DMS Inquiry — argomenti posizionali

Invia una richiesta DML inquiry generando in automatico `ApplicationArea` (da `config.sender`) e la sezione tipo-specifica (vuota, da popolare prima dell'uso in produzione).

```bash
node index.js inquiry <type> <documentId> <customerId> <vehicleId>
```

`type` accetta: `LFP` (up-selling packages) | `WL` (work lines) | `MP` (spare parts).

**Esempio (esegui da console):**
```bash
node index.js inquiry LFP 84564621 854265 3C4NJCBH7KT831816
node index.js inquiry WL  84564622 854266 3C4NJCBH7KT831816
node index.js inquiry MP  84564623 854267 3C4NJCBH7KT831816
```

### DMS Inquiry — payload completo da file

Utile quando serve popolare `UpSelling.Packages` / `WorkLines` / `SpareParts.PartsItem` con dati reali (vedi `WL_Request.json` come esempio).

```bash
node index.js inquiry --file ./WL_Request.json
```

**Header inviati (entrambi i comandi):**
| Header | Valore |
|---|---|
| `X-IBM-Client-Id` | configurato in `config.js` |
| `X-IBM-Client-Secret` | configurato in `config.js` |
| `X-Target-Env` | configurato in `config.js` (default `stage`) |
| `Authorization` | `****** |

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
DMS_PING_CLIENT_ID=your_ping_client_id_here
DMS_PING_CLIENT_SECRET=your_ping_client_secret_here
DML_IBM_CLIENT_ID=your_ibm_client_id_here
DML_IBM_CLIENT_SECRET=your_ibm_client_secret_here
DML_X_TARGET_ENV=stage

# ApplicationArea.Sender (usati dal comando CLI "inquiry" con argomenti posizionali, tutti opzionali)
DML_SENDER_COMPONENT_ID=1.0.0
DML_SENDER_DEALER_ID=0710736
DML_SENDER_DEALER_ID_SRC=0710736
DML_SENDER_COUNTRY=DE
DML_SENDER_LANGUAGE=de-DE
DML_SENDER_SITE_ID=00007532
DML_SENDER_SERVICE_ID=DE-0710736.D001
DML_SENDER_CURRENCY=EUR
DML_SENDER_BRAND=AP
```

`config.js` carica automaticamente il file `.env` se presente, senza dipendenze npm.

### Lambda / produzione

Configura le variabili d'ambiente direttamente sull'ambiente di esecuzione (es. AWS Lambda Environment Variables, CI/CD secrets):

| Variabile | Descrizione |
|---|---|
| `DMS_PING_CLIENT_ID` | Client ID PingFederate (dedicato dms) |
| `DMS_PING_CLIENT_SECRET` | Client Secret PingFederate (dedicato dms) |
| `DML_IBM_CLIENT_ID` | Client ID Stellantis DML API |
| `DML_IBM_CLIENT_SECRET` | Client Secret Stellantis DML API |
| `DML_X_TARGET_ENV` | Ambiente target IBM Gateway (default `stage`) |

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
| `Comando non valido` | Lanciato senza argomenti | Specificare `settings` o `inquiry` come primo argomento |
