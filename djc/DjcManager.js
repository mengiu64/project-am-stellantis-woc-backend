'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Percorso di default del JSON di riferimento (get.json) ───────────────────
// Usato solo come fallback quando non è disponibile un jobCardId (es. test,
// uso locale via CLI senza una jobcard reale da leggere da /tmp).
const DEFAULT_DJC_JSON_PATH = path.resolve(__dirname, 'get.json');

// Cartella dove la lambda jobcard salva jobCardDetails come <jobCardId>.json
// (vedi jobcard/jobCardService.js::getJobCardDetails / saveJobCardDetailsToTmp).
const TMP_DIR = '/tmp';

// ═══════════════════════════════════════════════════════════════════════════════
// Classe DjcManager
// ═══════════════════════════════════════════════════════════════════════════════
//
// Orchestratore Node.js per la costruzione dei payload di Digital Job Card (DJC)
// da inviare alla Push API SRP (Save*). Il contenuto di riferimento (djcJson) è
// lo stesso jobCardDetails prodotto dalla lambda jobcard: viene letto da
// /tmp/<jobCardId>.json (scritto lì da jobcard/jobCardService.js) e usato come
// sorgente dati "originale" (json_orig) da cui derivare i payload modificati
// (json_mod) in base agli argomenti passati a ciascun metodo Save*. Se non è
// disponibile un jobCardId, si ricade su get.json (fixture di riferimento
// usata in locale/nei test).
class DjcManager {
  /**
   * @param {object} [djcJson]   - Contenuto già parsato di jobCardDetails (usato
   *                                principalmente nei test). Se omesso, viene letto
   *                                e parsato da disco in base a jobCardId.
   * @param {string|number} [jobCardId] - Identificatore della jobcard: se presente,
   *                                viene letto /tmp/<jobCardId>.json (prodotto dalla
   *                                lambda jobcard). Se assente, si ricade su get.json.
   */
  constructor(djcJson, jobCardId) {
    this.jobCardId = jobCardId;
    this.djcJson = djcJson ?? DjcManager._loadDjcJson(jobCardId);
  }

  // ── _loadDjcJson ─────────────────────────────────────────────────────────────
  // Legge e parsa il JSON sorgente da disco: /tmp/<jobCardId>.json se jobCardId
  // è presente (file scritto dalla lambda jobcard), altrimenti get.json.
  static _loadDjcJson(jobCardId) {
    const jsonPath = jobCardId
      ? path.join(TMP_DIR, `${jobCardId}.json`)
      : DEFAULT_DJC_JSON_PATH;

    let raw;
    try {
      raw = fs.readFileSync(jsonPath, 'utf8');
    } catch (err) {
      throw new Error(`[djc] impossibile leggere ${jsonPath}: ${err.message}`);
    }

    return JSON.parse(raw);
  }


  // ── _buildRoInfoBase ─────────────────────────────────────────────────────────
  // Sottoinsieme "base" di roInfo, comune a tutti i metodi Save* che includono
  // roInfo nel payload (dmsRepairOrderId, jobCardSrpId, jobCardLegacyId,
  // sourceApplication, dealerId, stellantisBrand, status, updateDateTime,
  // dmsSynchroStatus).
  //
  // dmsRepairOrderId è incluso per soddisfare il vincolo M(C) della Push API SRP
  // (almeno uno tra dmsRepairOrderId/jobCardSrpId/jobCardLegacyId deve essere
  // presente nel payload): jobCardSrpId/jobCardLegacyId da soli non bastano se
  // la Job Card sorgente ha solo dmsRepairOrderId valorizzato.
  static _buildRoInfoBase(roInfoSrc) {
    return {
      dmsRepairOrderId:  roInfoSrc.dmsRepairOrderId,
      jobCardSrpId:      roInfoSrc.jobCardSrpId,
      jobCardLegacyId:   roInfoSrc.jobCardLegacyId,
      sourceApplication: roInfoSrc.sourceApplication,
      dealerId:          roInfoSrc.dealerId,
      stellantisBrand:   roInfoSrc.stellantisBrand,
      status:            roInfoSrc.status,
      updateDateTime:    roInfoSrc.updateDateTime,
      dmsSynchroStatus:  roInfoSrc.dmsSynchroStatus,
    };
  }

  // ── SaveRoInfo ───────────────────────────────────────────────────────────────
  // Costruisce json_orig (stato corrente di jobCardDetail.roInfo, invariato) e
  // json_mod (stessa struttura, con i campi passati come argomento aggiornati).
  //
  // @param {string|boolean} interiorCarWash
  // @param {string|boolean} exteriorCarWash
  // @param {string|boolean} old                - roInfo.partPreferences[0].old
  // @param {string|boolean} original            - roInfo.partPreferences[0].original
  // @param {string|boolean} returned             - roInfo.partPreferences[0].returned
  // @param {string|boolean} circularEconomy      - roInfo.partPreferences[0].circularEconomy
  // @param {boolean}        obfcm
  // @param {boolean}        waitOnSite
  // @param {string}         vehicleIdentificationTagNumber
  // @param {string}         loanerFlag
  // @returns {{ json_orig: object, json_mod: object }}
  SaveRoInfo(
    interiorCarWash,
    exteriorCarWash,
    old,
    original,
    returned,
    circularEconomy,
    obfcm,
    waitOnSite,
    vehicleIdentificationTagNumber,
    loanerFlag
  ) {
    const roInfoSrc = this.djcJson?.jobCardDetail?.roInfo ?? {};

    // Sottoinsieme di campi di roInfo previsto dal payload SaveRoInfo
    const buildRoInfo = () => ({
      ...DjcManager._buildRoInfoBase(roInfoSrc),
      interiorCarWash:   roInfoSrc.interiorCarWash,
      exteriorCarWash:   roInfoSrc.exteriorCarWash,
      partPreferences:   DjcManager._deepClone(roInfoSrc.partPreferences ?? []),
      obfcm:             roInfoSrc.obfcm,
      waitOnSite:        roInfoSrc.waitOnSite,
      vehicleIdentificationTagNumber: roInfoSrc.vehicleIdentificationTagNumber,
      loanerFlag:        roInfoSrc.loanerFlag,
    });

    // json_orig: sottoinsieme di roInfo, non alterato
    const json_orig = { roInfo: buildRoInfo() };

    // json_mod: stessa struttura, con i campi ricevuti come argomento aggiornati
    const json_mod = { roInfo: buildRoInfo() };
    const roInfoMod = json_mod.roInfo;

    roInfoMod.interiorCarWash               = interiorCarWash;
    roInfoMod.exteriorCarWash               = exteriorCarWash;
    roInfoMod.obfcm                         = obfcm;
    roInfoMod.waitOnSite                    = waitOnSite;
    roInfoMod.vehicleIdentificationTagNumber = vehicleIdentificationTagNumber;
    roInfoMod.loanerFlag                    = loanerFlag;

    // partPreferences: array con un unico elemento { old, original, returned, circularEconomy }
    if (!Array.isArray(roInfoMod.partPreferences) || roInfoMod.partPreferences.length === 0) {
      roInfoMod.partPreferences = [{}];
    }
    roInfoMod.partPreferences[0] = {
      ...roInfoMod.partPreferences[0],
      old,
      original,
      returned,
      circularEconomy,
    };

    return { json_orig, json_mod };
  }

  // ── SaveDmsSync ──────────────────────────────────────────────────────────────
  // Costruisce json_orig (sottoinsieme base di jobCardDetail.roInfo, invariato) e
  // json_mod (stessa struttura, con dmsSynchroStatus aggiornato al valore ricevuto).
  //
  // @param {string} dmsSynchroStatus
  // @returns {{ json_orig: object, json_mod: object }}
  SaveDmsSync(dmsSynchroStatus) {
    const roInfoSrc = this.djcJson?.jobCardDetail?.roInfo ?? {};

    const json_orig = { roInfo: DjcManager._buildRoInfoBase(roInfoSrc) };
    const json_mod  = { roInfo: DjcManager._buildRoInfoBase(roInfoSrc) };

    json_mod.roInfo.dmsSynchroStatus = dmsSynchroStatus;

    return { json_orig, json_mod };
  }

  // ── SaveCustomer ─────────────────────────────────────────────────────────────
  // Costruisce json_orig (sottoinsieme base di roInfo + customerInfo con
  // customerId e contactInfo, invariato) e json_mod (stessa struttura, con i
  // campi di contatto aggiornati ai valori ricevuti come argomento).
  //
  // NB: nel payload Push API SRP (POST /jobCard) `contactInfo` è **sibling**
  // di `personalInfo` sotto `customerInfo[]`, non annidato dentro
  // `personalInfo.contactInfo` (la Push API rigetta esplicitamente
  // `customerInfo[0].personalInfo.contactInfo` con "is not allowed"). La
  // sorgente (jobCardDetail, prodotta dalla GET) continua invece ad annidare
  // contactInfo dentro personalInfo: la lettura da djcJson resta quindi
  // `customerInfoSrc.personalInfo.contactInfo`, ma l'output ricostruisce
  // customerInfo[0] con contactInfo a livello sibling.
  //
  // `customerId` è incluso perché richiesto (M(O)) dalla Push API SRP quando
  // la sezione `customerInfo` è presente nel payload: senza di esso l'intera
  // richiesta viene rigettata.
  //
  // @param {string} phone
  // @param {string} mobile
  // @param {string} email
  // @param {string} address
  // @param {string} additionalAddress
  // @returns {{ json_orig: object, json_mod: object }}
  SaveCustomer(phone, mobile, email, address, additionalAddress) {
    const roInfoSrc       = this.djcJson?.jobCardDetail?.roInfo ?? {};
    const customerInfoSrc = (this.djcJson?.jobCardDetail?.customerInfo ?? [])[0] ?? {};
    const contactInfoSrc  = customerInfoSrc.personalInfo?.contactInfo ?? {};

    const buildCustomerInfo = () => [
      {
        customerId: customerInfoSrc.customerId,
        contactInfo: {
          phone:             contactInfoSrc.phone,
          mobile:            contactInfoSrc.mobile,
          email:             contactInfoSrc.email,
          address:           contactInfoSrc.address,
          additionalAddress: contactInfoSrc.additionalAddress,
        },
      },
    ];

    const json_orig = {
      roInfo:       DjcManager._buildRoInfoBase(roInfoSrc),
      customerInfo: buildCustomerInfo(),
    };
    const json_mod = {
      roInfo:       DjcManager._buildRoInfoBase(roInfoSrc),
      customerInfo: buildCustomerInfo(),
    };

    json_mod.customerInfo[0].contactInfo = {
      phone,
      mobile,
      email,
      address,
      additionalAddress,
    };

    return { json_orig, json_mod };
  }

  // ── SaveVehicle ──────────────────────────────────────────────────────────────
  // Costruisce json_orig (sottoinsieme base di roInfo + vehicleInfo con solo
  // identification.licensePlate e state.{odometerOut,mileageUnits,fuelReserveLevel,
  // batteryReserveLevel}, invariato) e json_mod (stessa struttura, con i campi
  // aggiornati ai valori ricevuti come argomento).
  //
  // @param {string} licensePlate
  // @param {string|number} odometerOut
  // @param {string} mileageUnits
  // @param {number} fuelReserveLevel
  // @param {number} batteryReserveLevel
  // @returns {{ json_orig: object, json_mod: object }}
  SaveVehicle(licensePlate, odometerOut, mileageUnits, fuelReserveLevel, batteryReserveLevel) {
    const roInfoSrc      = this.djcJson?.jobCardDetail?.roInfo ?? {};
    const vehicleInfoSrc = this.djcJson?.jobCardDetail?.vehicleInfo ?? {};
    const identificationSrc = vehicleInfoSrc.identification ?? {};
    const stateSrc          = vehicleInfoSrc.state ?? {};

    const buildVehicleInfo = () => ({
      identification: {
        licensePlate: identificationSrc.licensePlate,
      },
      state: {
        odometerOut:         stateSrc.odometerOut,
        mileageUnits:        stateSrc.mileageUnits,
        fuelReserveLevel:    stateSrc.fuelReserveLevel,
        batteryReserveLevel: stateSrc.batteryReserveLevel,
      },
    });

    const json_orig = {
      roInfo:      DjcManager._buildRoInfoBase(roInfoSrc),
      vehicleInfo: buildVehicleInfo(),
    };
    const json_mod = {
      roInfo:      DjcManager._buildRoInfoBase(roInfoSrc),
      vehicleInfo: buildVehicleInfo(),
    };

    json_mod.vehicleInfo.identification.licensePlate = licensePlate;
    json_mod.vehicleInfo.state = {
      odometerOut,
      mileageUnits,
      fuelReserveLevel,
      batteryReserveLevel,
    };

    return { json_orig, json_mod };
  }

  // ── SaveJobs ─────────────────────────────────────────────────────────────────
  // Costruisce json_orig (sottoinsieme base di roInfo + copia di jobCardDetail.jobs).
  // Il metodo non riceve argomenti (nessun campo da modificare rispetto alla
  // sorgente): json_mod è quindi identico a json_orig.
  //
  // jobCardDetail.jobs (letto da /tmp) proviene dalla GET jobCardDetails, la cui
  // risposta viene arricchita da jobcard/jobCardService.js::enrichJobsWithPackageInfo
  // con i campi packageType/packageCharge (calcolati lato nostro solo per la UI).
  // Il DGT API POST /jobCard non li accetta ("is not allowed"): vanno quindi
  // rimossi prima di ricostruire il payload da rimandare indietro.
  //
  // @returns {{ json_orig: object, json_mod: object }}
  SaveJobs() {
    const roInfoSrc = this.djcJson?.jobCardDetail?.roInfo ?? {};
    const jobsSrc   = this.djcJson?.jobCardDetail?.jobs ?? [];

    const buildPayload = () => ({
      roInfo: DjcManager._buildRoInfoBase(roInfoSrc),
      jobs:   DjcManager._stripJobEnrichment(DjcManager._deepClone(jobsSrc)),
    });

    const json_orig = buildPayload();
    const json_mod  = buildPayload();

    return { json_orig, json_mod };
  }

  // ── SaveConsents ─────────────────────────────────────────────────────────────
  // Costruisce json_orig (sottoinsieme base di roInfo + consents[0].{repairer,stellantis},
  // invariato) e json_mod (stessa struttura, con privacyIndicator di ciascuna voce
  // aggiornato al valore ricevuto come argomento: channelCode1..3 → repairer[0..2],
  // channelCode4..6 → stellantis[0..2]. Il campo channelCode di ciascuna voce non
  // viene alterato.
  //
  // @param {boolean} channelCode1 - privacyIndicator di consents[0].repairer[0]
  // @param {boolean} channelCode2 - privacyIndicator di consents[0].repairer[1]
  // @param {boolean} channelCode3 - privacyIndicator di consents[0].repairer[2]
  // @param {boolean} channelCode4 - privacyIndicator di consents[0].stellantis[0]
  // @param {boolean} channelCode5 - privacyIndicator di consents[0].stellantis[1]
  // @param {boolean} channelCode6 - privacyIndicator di consents[0].stellantis[2]
  // @returns {{ json_orig: object, json_mod: object }}
  SaveConsents(channelCode1, channelCode2, channelCode3, channelCode4, channelCode5, channelCode6) {
    const roInfoSrc   = this.djcJson?.jobCardDetail?.roInfo ?? {};
    const consentsSrc = (this.djcJson?.jobCardDetail?.consents ?? [])[0] ?? {};

    const buildConsents = () => [
      {
        repairer:   DjcManager._deepClone(consentsSrc.repairer ?? []),
        stellantis: DjcManager._deepClone(consentsSrc.stellantis ?? []),
      },
    ];

    const json_orig = {
      roInfo:   DjcManager._buildRoInfoBase(roInfoSrc),
      consents: buildConsents(),
    };
    const json_mod = {
      roInfo:   DjcManager._buildRoInfoBase(roInfoSrc),
      consents: buildConsents(),
    };

    const [repairer, stellantis] = [json_mod.consents[0].repairer, json_mod.consents[0].stellantis];
    const privacyIndicators = [channelCode1, channelCode2, channelCode3, channelCode4, channelCode5, channelCode6];
    [...repairer, ...stellantis].forEach((entry, idx) => {
      entry.privacyIndicator = privacyIndicators[idx];
    });

    return { json_orig, json_mod };
  }

  // ── SaveAppointments ─────────────────────────────────────────────────────────
  // Costruisce json_orig (sottoinsieme base di roInfo + appointments[0].{
  // appointmentInternalId, reception, delivery}, invariato) e json_mod (stessa
  // struttura, con i campi di reception/delivery aggiornati ai valori ricevuti
  // come argomento).
  //
  // `appointmentInternalId` è incluso, invariato rispetto alla sorgente, perché
  // richiesto (M(O)) dalla Push API SRP quando la sezione `appointments` è
  // presente nel payload: senza di esso l'intera richiesta viene rigettata.
  //
  // @param {string} estimatedReceptionDateTime
  // @param {string} receptionDateTime
  // @param {string} receptionServiceAdvisorId
  // @param {string} receptionServiceAdvisorName
  // @param {string} estimatedDeliveryDateTime
  // @param {string} deliveryDateTime
  // @param {string} deliveryServiceAdvisorId
  // @param {string} deliveryServiceAdvisorName
  // @returns {{ json_orig: object, json_mod: object }}
  SaveAppointments(
    estimatedReceptionDateTime,
    receptionDateTime,
    receptionServiceAdvisorId,
    receptionServiceAdvisorName,
    estimatedDeliveryDateTime,
    deliveryDateTime,
    deliveryServiceAdvisorId,
    deliveryServiceAdvisorName
  ) {
    const roInfoSrc       = this.djcJson?.jobCardDetail?.roInfo ?? {};
    const appointmentSrc  = (this.djcJson?.jobCardDetail?.appointments ?? [])[0] ?? {};
    const receptionSrc    = appointmentSrc.reception ?? {};
    const deliverySrc     = appointmentSrc.delivery ?? {};

    const buildAppointments = () => [
      {
        appointmentInternalId: appointmentSrc.appointmentInternalId,
        reception: {
          estimatedReceptionDateTime: receptionSrc.estimatedReceptionDateTime,
          receptionDateTime:          receptionSrc.receptionDateTime,
          receptionServiceAdvisorId:  receptionSrc.receptionServiceAdvisorId,
          receptionServiceAdvisorName: receptionSrc.receptionServiceAdvisorName,
        },
        delivery: {
          estimatedDeliveryDateTime: deliverySrc.estimatedDeliveryDateTime,
          deliveryDateTime:          deliverySrc.deliveryDateTime,
          deliveryServiceAdvisorId:  deliverySrc.deliveryServiceAdvisorId,
          deliveryServiceAdvisorName: deliverySrc.deliveryServiceAdvisorName,
        },
      },
    ];

    const json_orig = {
      roInfo:       DjcManager._buildRoInfoBase(roInfoSrc),
      appointments: buildAppointments(),
    };
    const json_mod = {
      roInfo:       DjcManager._buildRoInfoBase(roInfoSrc),
      appointments: buildAppointments(),
    };

    json_mod.appointments[0].reception = {
      estimatedReceptionDateTime,
      receptionDateTime,
      receptionServiceAdvisorId,
      receptionServiceAdvisorName,
    };
    json_mod.appointments[0].delivery = {
      estimatedDeliveryDateTime,
      deliveryDateTime,
      deliveryServiceAdvisorId,
      deliveryServiceAdvisorName,
    };

    return { json_orig, json_mod };
  }

  // ── _deepClone ───────────────────────────────────────────────────────────────
  static _deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ── _stripJobEnrichment ────────────────────────────────────────────────────
  // Rimuove da ciascun job i campi packageType/packageCharge aggiunti da
  // jobcard/jobCardService.js::enrichJobsWithPackageInfo alla risposta di GET
  // jobCardDetails (derivati solo per la UI): il DGT API non li accetta in
  // POST /jobCard e li rifiuta con "is not allowed".
  // @param {Array<object>} jobs - array di job (già copiato/deep-cloned)
  // @returns {Array<object>} lo stesso array, senza packageType/packageCharge
  static _stripJobEnrichment(jobs) {
    if (!Array.isArray(jobs)) return jobs;
    for (const job of jobs) {
      if (job && typeof job === 'object') {
        delete job.packageType;
        delete job.packageCharge;
      }
    }
    return jobs;
  }
}

module.exports = { DjcManager };
