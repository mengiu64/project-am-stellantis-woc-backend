# Security Policy

## Versioni supportate

| Versione / Branch | Supportata |
|---|---|
| `production` | ✅ |
| `staging` | ✅ |
| `develop` | ✅ |
| Branch precedenti | ❌ |

## Segnalare una vulnerabilità

**Non aprire una Issue pubblica per segnalare vulnerabilità di sicurezza.**

Utilizza il canale privato di GitHub:
👉 **[Report a vulnerability](../../security/advisories/new)**

Oppure contatta il team direttamente via email indicando:
- Descrizione della vulnerabilità
- Passi per riprodurla
- Impatto potenziale
- Eventuale patch o suggerimento di fix

### Cosa aspettarsi

| Fase | Tempistica |
|---|---|
| Conferma ricezione | entro 48 ore |
| Valutazione iniziale | entro 5 giorni lavorativi |
| Fix o workaround | entro 30 giorni (dipende dalla criticità) |
| Disclosure pubblica | concordata con chi segnala |

## Scope

Questo repository gestisce le Lambda Node.js del backend WOC Stellantis:
- `agendaSoa`, `agendaSoaNaga` — integrazione AgendaSOA
- `dms`, `jobcard`, `v360` — integrazione DMS / Jobcard / V360
- `pkEper`, `pkDocsoa`, `pkMenupricing` — integrazione ePer / DocSOA / MenuPricing

Sono **fuori scope**: infrastruttura AWS (VPC, IAM, API Gateway), sistemi di terze parti integrati.
