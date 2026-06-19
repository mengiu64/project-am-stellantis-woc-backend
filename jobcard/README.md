# JobCard Lambda

Client Node.js per l'integrazione con le API Stellantis DGT (Digital Layer).  
Ottiene un Bearer token da **PingFederate** e lo usa per interrogare i servizi **JobCard List** e **JobCard Details**.

---

## Struttura del progetto

```
jobcard/
├── config.js          # Credenziali e URL di tutti i servizi
├── httpClient.js      # Wrapper HTTPS (no dipendenze esterne)
├── authService.js     # Autenticazione PingFederate → Bearer token
├── jobCardService.js  # getJobCardList / getJobCardDetails
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
   ├─► authService.js  ──POST──► PingFederate  →  Bearer token
   │
   └─► jobCardService.js
           ├─► getJobCardList(token, dealerId)    ──GET──► /jobCardList
           └─► getJobCardDetails(token, jobCardId) ──GET──► /jobCardDetails
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

## Configurazione

Tutte le credenziali e gli URL sono centralizzati in `config.js`:

```js
module.exports = {
  auth: {
    url:          'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
    grantType:    'client_credentials',
    scope:        'prd:dgt',
    clientId:     '...',
    clientSecret: '...',
  },
  dgt: {
    baseUrl:      'https://emea-aws.stage.np-api.stellantis.com',
    basePath:     '/ps-stage/extra/srp/digital-layer/v1',
    clientId:     '...',
    clientSecret: '...',
  },
};
```

---

## Troubleshooting

| Errore | Causa | Soluzione |
|---|---|---|
| `EAI_AGAIN <hostname>` | DNS non risolve (tipico in WSL) | `echo "nameserver 8.8.8.8" \| sudo tee /etc/resolv.conf` |
| `HTTP 401` | Token scaduto o credenziali errate | Verificare `clientId` / `clientSecret` in `config.js` |
| `HTTP 403` | Scope insufficiente o IP non autorizzato | Verificare `scope` e whitelist IP |
| `Comando non valido` | Lanciato senza argomenti | Specificare `list` o `details` come primo argomento |
