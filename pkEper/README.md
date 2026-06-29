# pkEper — Node.js client per WsIQPckEper (ePer Stellantis)

Client Node.js autoconsistente che replica le chiamate del servizio SOAP `WsIQPckEper` originalmente implementato in PHP (`WsIQPckEper.class.php`).

## Struttura

```
pkEper/
├── WsIQPckEper.js   # Classe principale (equivalente PHP WsIQPckEper.class.php)
├── index.js         # Entry point / esempio d'uso
├── test.js          # Test completo (replica testEper.php)
├── package.json
└── README.md
```

## Installazione

```bash
cd pkEper
npm install
```

## Configurazione

I parametri di sessione vanno impostati nel file `test.js` (o passati al costruttore):

| Parametro    | Descrizione                        | Default di test |
|--------------|------------------------------------|-----------------|
| `coddealer`  | Codice dealer                      | `0073741`       |
| `codmarket`  | Codice mercato                     | `1000` (Italia) |
| `ticket`     | Token di autenticazione UPRS       | `null`          |
| `lingua`     | Codice lingua ePer                 | `IT`            |

## Utilizzo

```js
const { WsIQPckEper } = require('./WsIQPckEper');

const wsIQ = new WsIQPckEper({ coddealer: '0073741', codmarket: '1000' });

// 1. Gruppi
const groups = await wsIQ.getGroupsPRRequest({ ticket: null, lingua: 'IT', VIN: 'ZAC5JABL9PJK00363' });

// 2. Sottogruppi
const subgroups = await wsIQ.getSubgroupsPR({ ticket: null, lingua: 'IT', VIN, codiceGruppo: '33' });

// 3. Pacchetti
const packages = await wsIQ.getPackagesPR({ ticket: null, lingua: 'IT', VIN, codiceGruppo: '33', codiceSottogruppo: '10' });

// 4. Dettaglio pacchetto
const detail = await wsIQ.getPackageDetailsPR({
  ticket: null, lingua: 'IT', VIN,
  codicePacchetto: '3310B501',
  codicePosizione: '000',
  codicePosizioneGuida: 'U',
});
```

## Test completo

```bash
node test.js
```

Esegue le 4 chiamate SOAP nella stessa sequenza del file PHP originale `testEper.php`.

## Endpoint SOAP

```
https://eper.parts.fiat.com/wsdl/DMSConnectorService.wsdl
```

Metodo SOAP invocato: `put(sXMLMessage, sMessageType)`  
Il contenuto XML segue il formato `IQPckEper_envelope.xml`.
