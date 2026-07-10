# pkMenupricing — Node.js client per MenuPricingSoapClient (Opel/Vauxhall Menu Pricing)

Client Node.js autoconsistente che replica le chiamate del servizio SOAP **MenuPricing** (Opel/Vauxhall), con autenticazione WS-Security.

## Struttura

```
pkMenupricing/
├── MenuPricingSoapClient.js   # Client SOAP MenuPricing (WS-Security)
├── index.js                   # Lambda entry-point + demo CLI (node index.js)
├── test.js                     # CLI di test per singola chiamata a riga di comando
├── __tests__/                  # Test Jest
└── package.json
```

## Installazione

```bash
cd pkMenupricing
npm install
```

## Configurazione

I parametri di connessione e le credenziali vanno impostati in un file `.env` (non committare):

| Variabile | Descrizione |
|---|---|
| `MENUPRICING_WSDL` | Base URL del servizio SOAP (senza `/Menus` o `/SecuredMenus`) |
| `MENUPRICING_USR` | Username WS-Security (applicazione) |
| `MENUPRICING_PWS` | Password WS-Security (applicazione) |
| `MENUPRICING_USR_REQ` | Username incluso nel body della richiesta |
| `MENUPRICING_PWS_REQ` | Password inclusa nel body della richiesta |
| `LANGUAGE_CODE` | Codice lingua di test (es. `ES`) |
| `COUNTRY_CODE` | Codice paese di test (es. `ES`) |
| `DEALER_IDENTIFICATION_CODE` | Codice dealer di test (es. `ES96590`) |
| `MANUFACTURER` | Codice manufacturer di test (es. `OV`) |
| `VIN` | VIN di test |
| `ID` | ID job di test (usato da `getJobDetails`) |

## Utilizzo (libreria)

```js
const { MenuPricingSoapClient } = require('./MenuPricingSoapClient');

const client = new MenuPricingSoapClient();

// 1. Lista job/pacchetti disponibili per un VIN
const jobs = await client.getJobs({
  languageCode: 'ES', countryCode: 'ES',
  dealerIdentificationCode: 'ES96590', manufacturer: 'OV',
  vin: 'W0VZT6GT7M1017935',
});

// 2. Dettaglio di un job/pacchetto
const detail = await client.getJobDetails({
  languageCode: 'ES', countryCode: 'ES',
  dealerIdentificationCode: 'ES96590', manufacturer: 'OV',
  vin: 'W0VZT6GT7M1017935', id: '020320055429',
});
```

## Test da console (`test.js`)

Chiamata singola a riga di comando: gli argomenti opzionali sovrascrivono i valori letti dal `.env`.

```bash
node test.js getJobs
node test.js getJobs W0VZT6GT7M1017935
node test.js getJobDetails
node test.js getJobDetails W0VZT6GT7M1017935 020320055429
```

Debug delle chiamate SOAP grezze:
```bash
DEBUG_SOAP=1 node test.js getJobDetails
```

## Demo rapida (`index.js`)

```bash
node index.js
```
Esegue una chiamata di esempio a `getJobs` usando i valori da `.env`.

## Uso come Lambda

Il file `index.js` espone `exports.handler`, che instrada l'evento in base al campo `action`:

```json
{
  "action": "getJobs | getJobDetails",
  "body": { "vin": "W0VZT6GT7M1017935", "languageCode": "ES", "countryCode": "ES", "dealerIdentificationCode": "ES96590", "manufacturer": "OV" }
}
```

## Test automatici

```bash
npm test               # esegue la suite Jest
npm run test:coverage  # esegue la suite con report di coverage (coverage/)
```
