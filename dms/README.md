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

Invia una richiesta DML inquiry. `ApplicationArea` (Sender/BODID/CreationDateTime) **non va costruito dal chiamante**: viene generato internamente da `dmsService.js::postDmsInquiry()` (da `config.sender`) quando manca dal body — vale sia per la CLI sia per qualunque altro chiamante della lambda (es. `pkManager`). Qui ci limitiamo a costruire la sezione tipo-specifica (vuota, da popolare prima dell'uso in produzione).

> **Sezione tipo-specifica obbligatoria ed esclusiva**: in base al `MessageType` il body deve contenere **una e una sola** delle sezioni `UpSelling` (LFP) / `WorkLines` (WL) / `SpareParts` (MP). `postDmsInquiry()` valida questo vincolo e rigetta la richiesta se la sezione attesa manca o se ne sono presenti altre non pertinenti al `MessageType` dichiarato.

> **LFP — scorciatoia `packageCodes`**: per `MessageType: 'LFP'` il chiamante non deve costruire `UpSelling.Packages` a mano. Basta passare `packageCodes` — una singola stringa (es. `'ABC'`) o un array di stringhe (es. `['ABC', 'DEF']`) — e `postDmsInquiry()` genera `UpSelling.Packages` internamente via `buildUpSellingPackages()`. Se `UpSelling` è già presente nel body, ha sempre la precedenza e `packageCodes` viene ignorato.

> **Scorciatoia "flat" per `PartsInquiryHeader`**: se il body non contiene già `PartsInquiryHeader` annidato, `postDmsInquiry()` lo costruisce automaticamente da `DocumentID`/`CustomerIdDms`/`MessageType`/`VehicleID` passati direttamente a livello root del body. Utile per chiamare la lambda HTTP senza conoscere lo schema DML:
> ```json
> {
>   "DocumentID": "84564621",
>   "CustomerIdDms": "854265",
>   "MessageType": "LFP",
>   "VehicleID": "3C4NJCBH7KT831816",
>   "packageCodes": "FORFAIT"
> }
> ```
> Se `PartsInquiryHeader` è già presente nel body, ha sempre la precedenza e i campi root-level vengono ignorati.

> **WL — scorciatoia `workLines` / `customerAccountDmsId`**: per `MessageType: 'WL'` il chiamante non deve costruire a mano la struttura nidificata `WorkLines[].PartsItem[]`/`LaborItem[]` (con `PartType`/`PartStatus`/`LaborType`). Basta passare:
> - `workLines`: array di righe semplificate `{ workLineReference, partNumbers?, laborOperationIds?, transactionType?, customerAccountDmsId? }` (una voce per `WorkLineReference`, anche duplicato — non deve essere univoco);
> - `customerAccountDmsId` (opzionale, default `null`): valore unico di `CustomerAccountDMSID` ripetuto automaticamente su ogni riga generata (sovrascrivibile per singola riga con `customerAccountDmsId` dentro l'elemento di `workLines`).
>
> `postDmsInquiry()` genera `WorkLines` internamente via `buildWorkLines()`, con `TransactionType` default `1`, `PartType: 'L'`, `PartStatus: 'O'`, `LaborType: 'L'`. Se `WorkLines` è già presente nel body, ha sempre la precedenza e `workLines`/`customerAccountDmsId` vengono ignorati (mai inviati sul wire).

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

Utile quando serve popolare `UpSelling.Packages` / `WorkLines` / `SpareParts.PartsItem` con dati reali (vedi `WL_Request.json` come esempio). In questo caso il file può includere già un `ApplicationArea` proprio (usato così com'è); se omesso, viene comunque generato da `dmsService.js`.

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

# ApplicationArea.Sender (usati da dmsService.js::buildApplicationArea() per generare
# l'envelope della richiesta inquiry, sia da CLI che da qualunque altro chiamante; tutti opzionali)
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
