'use strict';

const axios = require('axios');

const ALLOWED_STATUS_CODES = [200, 201, 202, 203, 204, 205, 206];

/**
 * AgendaSOA REST Client for Node.js
 * Mirrors the PHP AgendaSOARestClient class.
 */
class AgendaSOAClient {
  /**
   * @param {object} config
   * @param {string} config.host       - Base URL of the AgendaSOA service
   * @param {string} config.username   - Basic-auth username
   * @param {string} config.password   - Basic-auth password
   * @param {string} [config.apiKey]   - Static API-Key (used by appointment endpoint)
   * @param {string} [config.proxy]    - Proxy URL (optional)
   * @param {https.Agent} [config.httpsAgent] - Agent mTLS (certificato client), opzionale
   */
  constructor(config = {}) {
    this.host     = config.host     || process.env.AGENDA_SOA_HOST;
    this.username = config.username || process.env.AGENDA_SOA_USERNAME;
    this.password = config.password || process.env.AGENDA_SOA_PASSWORD;
    this.apiKey   = config.apiKey   || process.env.AGENDA_SOA_API_KEY;

    const axiosConfig = {
      baseURL: this.host,
      timeout: 30000,
    };

    if (config.httpsAgent) {
      axiosConfig.httpsAgent = config.httpsAgent;
    }


    this.http = axios.create(axiosConfig);

    this.http.interceptors.request.use((req) => {
      //console.log('[HTTP →]', req.method?.toUpperCase(), req.baseURL + req.url);
      //console.log('[HTTP →] headers:', req.headers);
      //if (req.params) console.log('[HTTP →] params:', req.params);
      //if (req.data)   console.log('[HTTP →] body:', req.data);
      return req;
    });

    this.http.interceptors.response.use((res) => {
      //console.log('[HTTP ←]', res.status, res.config.url);
      const planning = res.data?.grillePlanningReceptionnairePresentations;
      /*
      if (planning) {
        planning.forEach((rec) => {
          //console.log(`[HTTP ←] ccs id=${rec.id}, tranches:`, (rec.tranches ?? []).map((t) => t.rdv?.reception_date ?? 'no rdv') );
        });
      }
      */
      return res;
    }, (err) => {
      //console.log('[HTTP ←] error:', err.message);
      return Promise.reject(err);
    });

  }

  // ─── private helpers ────────────────────────────────────────────────────────

  _basicAuthHeader() {
    const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  };
 
  async _get(urlPath, params = {}) {
    const response = await this.http.get(urlPath, {
      headers: this._basicAuthHeader(),
      params,
      validateStatus: () => true, // handle errors manually
    });
    return this._processResponse(response);
  }

  async _getWithApiKey(urlPath, params = {}) {
    const response = await this.http.get(urlPath, {
      headers: {
        ...this._basicAuthHeader(),
        'API-Key': this.apiKey,
      },
      params,
      validateStatus: () => true,
    });
    return this._processResponse(response);
  }

  async _post(urlPath, body = {}) {
    const response = await this.http.post(urlPath, body, {
      headers: {
        ...this._basicAuthHeader(),
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    });
    return this._processResponse(response);
  }

  _processResponse(response) {
    const success = ALLOWED_STATUS_CODES.includes(response.status);
    if (!success) {
      return {
        success: false,
        data: `${response.status}: ${response.data?.status ?? 'GENERIC'}: ${response.data?.message ?? 'ERROR'}`,
      };
    }
    return {
      success: true,
      data: response.data,
    };
  }

  // ─── public API methods ──────────────────────────────────────────────────────

  /**
   * GET planningrest/planning/v1/appointment/data/
   * Returns appointment data from the planning service.
   *
   * @param {object} params
   * @param {string} params.ccs      - CCS code
   * @param {string} params.date     - Date (YYYY-MM-DD)
   * @param {string} params.ldapId   - LDAP user identifier
   * @param {string} params.pdvId    - PDV identifier
   * @param {string} params.locale   - Locale (e.g. "fr_FR")
   */
  async appointment(params) {
    return this._getWithApiKey('planningrest/planning/v1/appointment/data/', params);
  }

  /**
   * GET vendorrest/pdvs/v1/{id}/availablehours/
   * Returns available booking hours for a PDV.
   * Applies the same zero-padding fix as the PHP original.
   *
   * @param {object} params  - Must include `id`
   */
  async availableHours(params) {
    const { id, ...queryParams } = params;
    const result = await this._get(`vendorrest/pdvs/v1/${id}/availablehours/`, queryParams);

    if (!result.success) return result;

    const raw = result.data?.heureRdvMap ?? result.data;
    const hours = (Array.isArray(raw) ? raw : Object.values(raw ?? {})).map((h) => {
      const s = String(h);
      return s.length < 5 ? `0${s}` : s;
    });

    //console.log('availableHours:', hours);
    
    return { success: true, data: hours };
  }

  /**
   * GET vendorrest/pdvs/v1/{id}/ccslist/
   * Returns the list of CCS (Conseiller Client Service) for a PDV.
   *
   * @param {object} params  - Must include `id`
   */
  async cCSList(params) {
    try {
      const { id, ...queryParams } = params;
      const result = await this._get(`vendorrest/pdvs/v1/${id}/ccslist/`, queryParams);

      if (!result.success) return { success: false, data: result.data };

      const list = Array.isArray(result.data) ? result.data : [];
      const mapped = list.map((item) => ({
        LOGINNAME:          item.personnelId,
        FIRSTNAME:          item.prenom,
        LASTNAME:           item.nom,
        NAME:               `${item.prenom} ${item.nom}`,
        OWNER_PDV:          item.ownerPdv,
        IS_CCS_SHARED:      item.isCcsShared,
        PARENT_PDV_LOGO:    item.parentPdvLogo,
        IS_SHARED_DELETED:  item.isSharedCCSDeleted,
        DELETED_DATE:       item.deletedDate,
        DTE:                item.dte,
      }));
      return { success: true, data: mapped };
    } catch (e) {
      return { success: false, data: null, message: e.message };
    }
  }

  /**
   * Returns available hours for a receptionist (CCS), excluding slots already booked.
   *
   * Calls availableHours to get all PDV slots, then calls appointment to get the
   * receptionist's planning, and filters out times already occupied by an rdv.
   *
   * @param {string} pdvId   - PDV identifier (used as `id` for availableHours)
   * @param {string} date    - Date in YYYYMMDD format
   * @param {string} ccs     - Receptionist id (matches `id` in grillePlanningReceptionnairePresentations)
   * @param {string} locale  - Locale (e.g. "fr_FR")
   * @param {string} ldapId  - LDAP user identifier (required by appointment endpoint)
   * @returns {{ success: boolean, data: string[] }}  Free time slots in "HH:MM" format
   */
  async getAvHoursForRec(pdvId, date, ccs, locale, ldapId) {
    // Convert YYYYMMDD → YYYY-MM-DD for availableHours; appointment keeps YYYYMMDD
    const startDate = date.length === 8
      ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
      : date;


    const avResult = await this.availableHours({ id: pdvId, startDate });
    const apptParams = { ccs, date, pdvId, locale, ldapId };
    const apptResult = await this.appointment(apptParams);
    



    if (!avResult.success) return avResult;
    if (!apptResult.success) return apptResult;

    const allHours = avResult.data; // ["07:00", "07:07", ...]
    const planningList = apptResult.data?.grillePlanningReceptionnairePresentations ?? [];



    const recEntries = planningList.filter((r) => String(r.id) === String(ccs));

    // non ho appuntamenti per questo ccs, quindi tutte le ore disponibili sono libere
    if (!recEntries.length) return { success: true, data: allHours };

    // Extract busy start times from reception_date: "22/06/2026 à 10h30" → "10:30"
    const busyTimes = new Set();
    for (const recEntry of recEntries) {
      for (const tranche of recEntry.tranches ?? []) {
       
        const receptionDate = tranche.rdv?.reception_date;
        
        if (!receptionDate) continue;
        const timePart = receptionDate.split(' à ')[1];
        if (!timePart) continue;
        if (recEntry.id == ccs) {
          busyTimes.add(timePart.replace('h', ':'));
        }
        
        
      }
    }
    //console.log(`[DEBUG] orari occupati da appointment per ccs=${ccs}:`, [...busyTimes]);

    const freeHours = allHours
      .filter((h) => !busyTimes.has(h))
      .sort((a, b) => a.localeCompare(b));


    return { success: true, data: freeHours };
  } 


  /**
   * GET appointmentrest/rdvs/v1/{id}/data/
   * Returns appointment detail data for a given RDV id.
   *
   * @param {object} params  - Must include `id`
   */
  async data(params) {
    const { id, ...queryParams } = params;
    const result = await this._get(`appointmentrest/rdvs/v1/${id}/data/`, queryParams);

    if (!result.success) return result;
    return { success: true, data: result.data?.plaDtoList ?? result.data };
  }
}

module.exports = AgendaSOAClient;
