# JobCard Lambda

Client Node.js per l'integrazione con le API Stellantis DGT (Digital Layer).  
Ottiene un token da **PingFederate** e lo usa per interrogare i servizi **JobCard List** e **JobCard Details**, e per inviare (**JobCard Save**) i payload di Digital Job Card costruiti dalla lambda `djc`.

---

## Struttura del progetto

```
jobcard/
├── config.js          # Credenziali e URL di tutti i servizi
├── httpClient.js      # Wrapper HTTPS (no dipendenze esterne)
├── authService.js     # Autenticazione PingFederate → Bearer token
├── jobCardService.js  # getJobCardList / getJobCardDetails / saveJobCard
├── index.js           # Entry point CLI
└── package.json
```

> **Nessuna dipendenza npm** — usa esclusivamente moduli built-in di Node.js (`https`, `url`).

---

## Prerequisiti

- Node.js >= 14
- Accesso di rete agli endpoint:
  - `idfed-preprod.mpsa.com:443` (PingFederate)
  - `emea-aws.stage.np-api.stellantis.com` (DGT API)

---

## Flusso

```
index.js
   │
   ├─► authService.js  ──POST──► PingFederate  →  token
   │
   └─► jobCardService.js
           ├─► getJobCardList(token, dealerId)     ──GET──►  /jobCardList
           ├─► getJobCardDetails(token, jobCardId)  ──GET──►  /jobCardDetails
           └─► saveJobCard(token, payload)          ──POST──► /jobCard
```

---

## Utilizzo

### JobCard List

Restituisce la lista delle job card per un determinato dealer.

```bash
node index.js list <dealerId>
```

**Esempio:**
```bash
node index.js list 0062219
```

**Header inviati:**
| Header | Valore |
|---|---|
| `X-IBM-Client-Id` | configurato in `config.js` |
| `X-IBM-Client-Secret` | configurato in `config.js` |
| `dealerId` | parametro di input |
| `Authorization` | `Bearer <token>` |

---

### JobCard Details

Restituisce il dettaglio di una singola job card.

```bash
node index.js details <jobCardId>
```

**Esempio:**
```bash
node index.js details 79
```

**Header inviati:**
| Header | Valore |
|---|---|
| `X-IBM-Client-Id` | configurato in `config.js` |
| `X-IBM-Client-Secret` | configurato in `config.js` |
| `jobCardId` | parametro di input |
| `Authorization` | `Bearer <token>` |

---

### JobCard Save

Invia (POST) un payload di Digital Job Card alla Push API SRP. Il payload è
tipicamente il `json_mod` prodotto da uno dei metodi `Save*` della lambda `djc`
(`SaveRoInfo`, `SaveCustomer`, ...): questa azione ne effettua l'invio effettivo
usando lo stesso client PingFederate/DGT di `getJobCardList`/`getJobCardDetails`.

```bash
node index.js saveJobcard <payloadJsonFile>
```

**Esempio:**
```bash
node index.js saveJobcard ./payload.json
```

**Header inviati:**
| Header | Valore |
|---|---|
| `X-IBM-Client-Id` | configurato in `config.js` |
| `X-IBM-Client-Secret` | configurato in `config.js` |
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <token>` |

> **Nota**: `saveJobcard` (POST `/jobCard`) è la stessa azione esposta anche dalla
> lambda `djc` (stesso client PingFederate/DGT). **API Gateway instrada le
> richieste POST verso la lambda `djc`**; questa azione resta disponibile qui per
> chiamata diretta/CLI e per coerenza tra le due lambda.

**Payload e obbligatorietà**: il payload (`roInfo` obbligatorio, più le sezioni
opzionali `customerInfo[]`, `vehicleInfo`, `jobs[]`, ecc.) segue le stesse
regole di obbligatorietà (M/M(O)/M(C)) e le stesse regole di
creazione/aggiornamento del documento **"SRP - DL DJC Post API Specification"**,
documentate in dettaglio in [`djc/README.md`](../djc/README.md#payload-struttura-e-regole-di-obbligatorietà)
e nello schema `JobCardSaveRequest` di `swagger-woc.yaml`
(`POST /api/repairorder/{method}`, `method=save`).

**Payload minimo:**

```json
{
  "roInfo": {
    "dmsRepairOrderId": "DMS-PNR-100403",
    "sourceApplication": "DMS",
    "dealerId": "RRDI/SINCOM/OIC",
    "brand": "0P",
    "stellantisBrand": "AP",
    "updateDateTime": "2026-04-10T11:55:00Z"
  }
}
```

**Risposta di successo (200):**

```json
{
  "response": {
    "statuscode": "200",
    "success": true,
    "jobCardId": "JCID-609",
    "message": "Job card Transaction Successful"
  }
}
```

---

### Arricchimento della risposta `getJobCardDetails`

Prima di essere restituita, la risposta di `getJobCardDetails` viene arricchita da `sanitizeJobCardDetails` con i seguenti campi calcolati (non presenti nella risposta originale della DGT API):

#### `jobs[].packageType` / `jobs[].packageCharge`

Aggiunti a ciascun elemento di `jobs`, posizionati **prima** di `partInfo`/`laborInfo` quando presenti (per leggibilità). Derivati da `jobType`/`packageCode` del job:

| `jobType`                              | `packageCode`            | `packageType` | `packageCharge`                                  |
|-----------------------------------------|---------------------------|----------------|---------------------------------------------------|
| `MFP`                                    | -                          | `FP`           | `CUSTOMER`                                        |
| `STD`                                    | presente (non vuoto/null) | `QE`           | `CUSTOMER`                                        |
| `LFP`                                    | -                          | `LFP`          | `CUSTOMER`                                        |
| `STD`                                    | assente/vuoto/null        | `GC`           | `CUSTOMER`                                        |
| assente/vuoto/null                       | -                          | `GC`           | `CUSTOMER`                                        |
| qualsiasi altro valore non vuoto/null   | -                          | `GC`           | `INTERNAL`                                        |

Se il job ha un campo `paymentType` valorizzato, `packageCharge` assume **sempre** quel valore (sovrascrive il risultato della tabella sopra); `packageType` resta invece sempre derivato da `jobType`/`packageCode` come sopra.

#### `roInfo.roSource`

Aggiunto subito dopo `roInfo.sourceApplication`, con lo **stesso valore** di quest'ultimo (se `roInfo`/`sourceApplication` sono assenti, `roSource` non viene aggiunto).

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
JOBCARD_PING_CLIENT_ID=your_ping_client_id_here
JOBCARD_PING_CLIENT_SECRET=your_ping_client_secret_here
DGT_CLIENT_ID=your_dgt_client_id_here
DGT_CLIENT_SECRET=your_dgt_client_secret_here
```

`config.js` carica automaticamente il file `.env` se presente, senza dipendenze npm.

### Lambda / produzione

Configura le variabili d'ambiente direttamente sull'ambiente di esecuzione (es. AWS Lambda Environment Variables, CI/CD secrets):

| Variabile | Descrizione |
|---|---|
| `JOBCARD_PING_CLIENT_ID` | Client ID PingFederate (dedicato jobcard) |
| `JOBCARD_PING_CLIENT_SECRET` | Client Secret PingFederate (dedicato jobcard) |
| `DGT_CLIENT_ID` | Client ID Stellantis DGT API |
| `DGT_CLIENT_SECRET` | Client Secret Stellantis DGT API |

---

## Troubleshooting

| Errore | Causa | Soluzione |
|---|---|---|
| `EAI_AGAIN <hostname>` | DNS non risolve (tipico in WSL) | `echo "nameserver 8.8.8.8" \| sudo tee /etc/resolv.conf` |
| `HTTP 401` | Token scaduto o credenziali errate | Verificare `clientId` / `clientSecret` in `config.js` |
| `HTTP 403` | Scope insufficiente o IP non autorizzato | Verificare `scope` e whitelist IP |
| `Comando non valido` | Lanciato senza argomenti | Specificare `list` o `details` come primo argomento |
