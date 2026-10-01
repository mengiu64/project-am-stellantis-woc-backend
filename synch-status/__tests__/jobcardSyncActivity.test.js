// jobcardSyncActivity.test.js
// Aggiornamento di woc.jobcard_sync_activity (techreason/ack/businessreason/lastupdate)

const path = require('path');

const {
  syncJobcardActivity,
  fetchDmsSynchroStatus,
  loadJobcardServices,
  EVENT_TYPE_TO_ACK,
  UPDATE_TECHREASON_SQL,
  UPDATE_BUSINESSREASON_SQL,
} = require('../jobcardSyncActivity');

jest.mock('../../jobcard/authService', () => ({
  getBearerToken: jest.fn(),
}));
jest.mock('../../jobcard/jobCardService', () => ({
  getJobCardDetails: jest.fn(),
}));

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeDeps(body) {
  return {
    getBearerToken: jest.fn().mockResolvedValue('token-123'),
    getJobCardDetails: jest.fn().mockResolvedValue(body),
  };
}

const DETAILS_BODY = { dmsAvailable: true, jobCardDetail: { roInfo: { jobCardSrpId: 'JCID-42', dmsSynchroStatus: 'SYNCED' } } };

describe('jobcardSyncActivity', () => {
  describe('SQL', () => {
    it('aggiorna techreason, ack e lastupdate per jobcardid', () => {
      expect(UPDATE_TECHREASON_SQL).toMatch(/UPDATE woc\.jobcard_sync_activity/);
      expect(UPDATE_TECHREASON_SQL).toMatch(/techreason = \$2, ack = \$3, lastupdate = now\(\)/);
      expect(UPDATE_TECHREASON_SQL).toMatch(/WHERE jobcardid = \$1/);
    });

    it('aggiorna businessreason e lastupdate per jobcardid', () => {
      expect(UPDATE_BUSINESSREASON_SQL).toMatch(/businessreason = \$2, lastupdate = now\(\)/);
      expect(UPDATE_BUSINESSREASON_SQL).toMatch(/WHERE jobcardid = \$1/);
    });
  });

  describe('fetchDmsSynchroStatus()', () => {
    it('ritorna jobCardDetail.roInfo.dmsSynchroStatus', async () => {
      const deps = makeDeps(DETAILS_BODY);
      await expect(fetchDmsSynchroStatus('JCID-42', deps)).resolves.toBe('SYNCED');
      expect(deps.getJobCardDetails).toHaveBeenCalledWith('token-123', 'JCID-42');
    });

    it('estrae dmsSynchroStatus dalla risposta reale di jobCardDetails', async () => {
      const realBody = {
        statusCode: 200,
        success: true,
        message: 'Job card retrieved successfully',
        jobCardDetail: {
          roInfo: { jobCardSrpId: 'JCID-17362', jobCardLegacyId: '1JSGR43CT', status: 'CREATED', dmsSynchroStatus: 'UNSYNCED' },
          jobs: [],
        },
      };
      await expect(fetchDmsSynchroStatus('JCID-17362', makeDeps(realBody))).resolves.toBe('UNSYNCED');
    });

    it('accetta anche roInfo al primo livello', async () => {
      await expect(fetchDmsSynchroStatus('JCID-42', makeDeps({ roInfo: { dmsSynchroStatus: 'UNSYNCED' } }))).resolves.toBe('UNSYNCED');
    });

    it('ritorna null se dmsSynchroStatus assente', async () => {
      await expect(fetchDmsSynchroStatus('JCID-42', makeDeps({}))).resolves.toBeNull();
      await expect(fetchDmsSynchroStatus('JCID-42', makeDeps(null))).resolves.toBeNull();
    });

    it('usa di default i servizi della lambda jobcard', async () => {
      const { getBearerToken } = require(path.resolve(__dirname, '../../jobcard/authService'));
      const { getJobCardDetails } = require(path.resolve(__dirname, '../../jobcard/jobCardService'));
      getBearerToken.mockResolvedValue('tok');
      getJobCardDetails.mockResolvedValue(DETAILS_BODY);

      expect(loadJobcardServices()).toEqual({ getBearerToken, getJobCardDetails });
      await expect(fetchDmsSynchroStatus('JCID-42')).resolves.toBe('SYNCED');
      expect(getJobCardDetails).toHaveBeenCalledWith('tok', 'JCID-42');
    });
  });

  describe('syncJobcardActivity()', () => {
    let pool;
    let logger;

    beforeEach(() => {
      pool = { query: jest.fn() };
      logger = makeLogger();
    });

    it('aggiorna techreason, richiama jobCardDetails e aggiorna businessreason', async () => {
      pool.query.mockResolvedValue({ rows: [{ jobcardid: 'JCID-42' }] });
      const deps = makeDeps(DETAILS_BODY);

      const outcome = await syncJobcardActivity({ pool, jobCardId: 'JCID-42', djcSyncStatus: 'FAILURE', eventType: 'DMS_PUSH_FAILURE', logger, deps });

      expect(outcome).toEqual({ techReasonUpdated: true, ack: 'KO', businessReason: 'SYNCED', businessReasonUpdated: true });
      expect(pool.query).toHaveBeenNthCalledWith(1, UPDATE_TECHREASON_SQL, ['JCID-42', 'FAILURE', 'KO']);
      expect(pool.query).toHaveBeenNthCalledWith(2, UPDATE_BUSINESSREASON_SQL, ['JCID-42', 'SYNCED']);
    });

    it.each([
      ['DMS_PUSH_SUCCESS_WITHOUT_UPDATE', 'SUCCESS_WITHOUT_UPDATE', 'OK'],
      ['DMS_PUSH_SUCCESS_WITH_UPDATE', 'SUCCESS_WITH_UPDATE', 'OK'],
      ['DMS_PUSH_REFUSAL', 'REFUSAL', 'KO'],
      ['DMS_PUSH_FAILURE', 'FAILURE', 'KO'],
    ])('%s: salva ack=%s', async (eventType, djcSyncStatus, ack) => {
      pool.query.mockResolvedValue({ rows: [{ jobcardid: 'JCID-42' }] });

      const outcome = await syncJobcardActivity({ pool, jobCardId: 'JCID-42', djcSyncStatus, eventType, logger, deps: makeDeps(DETAILS_BODY) });

      expect(outcome.ack).toBe(ack);
      expect(EVENT_TYPE_TO_ACK[eventType]).toBe(ack);
      expect(pool.query).toHaveBeenNthCalledWith(1, UPDATE_TECHREASON_SQL, ['JCID-42', djcSyncStatus, ack]);
    });

    it('eventType sconosciuto/assente: ack null', async () => {
      pool.query.mockResolvedValue({ rows: [{ jobcardid: 'JCID-42' }] });

      const outcome = await syncJobcardActivity({ pool, jobCardId: 'JCID-42', djcSyncStatus: 'X', logger, deps: makeDeps(DETAILS_BODY) });

      expect(outcome.ack).toBeNull();
      expect(pool.query).toHaveBeenNthCalledWith(1, UPDATE_TECHREASON_SQL, ['JCID-42', 'X', null]);
    });

    it('record non trovato: non richiama jobCardDetails', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      const deps = makeDeps(DETAILS_BODY);

      const outcome = await syncJobcardActivity({ pool, jobCardId: 'JCID-1', djcSyncStatus: 'REFUSAL', eventType: 'DMS_PUSH_REFUSAL', logger, deps });

      expect(outcome).toEqual({ techReasonUpdated: false, ack: 'KO', businessReason: null, businessReasonUpdated: false });
      expect(deps.getJobCardDetails).not.toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('rows undefined: trattato come record non trovato', async () => {
      pool.query.mockResolvedValue({});
      const outcome = await syncJobcardActivity({ pool, jobCardId: 'JCID-1', djcSyncStatus: 'REFUSAL', eventType: 'DMS_PUSH_REFUSAL', logger, deps: makeDeps(DETAILS_BODY) });
      expect(outcome.techReasonUpdated).toBe(false);
    });

    it('errore su UPDATE techreason: non propaga e non richiama jobCardDetails', async () => {
      pool.query.mockRejectedValue(new Error('db down'));
      const deps = makeDeps(DETAILS_BODY);

      const outcome = await syncJobcardActivity({ pool, jobCardId: 'JCID-42', djcSyncStatus: 'FAILURE', eventType: 'DMS_PUSH_FAILURE', logger, deps });

      expect(outcome.techReasonUpdated).toBe(false);
      expect(deps.getJobCardDetails).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('errore jobCardDetails: techreason resta aggiornato, businessreason no', async () => {
      pool.query.mockResolvedValue({ rows: [{ jobcardid: 'JCID-42' }] });
      const deps = makeDeps(DETAILS_BODY);
      deps.getJobCardDetails.mockRejectedValue(new Error('DGT 500'));

      const outcome = await syncJobcardActivity({ pool, jobCardId: 'JCID-42', djcSyncStatus: 'FAILURE', eventType: 'DMS_PUSH_FAILURE', logger, deps });

      expect(outcome).toEqual({ techReasonUpdated: true, ack: 'KO', businessReason: null, businessReasonUpdated: false });
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalled();
    });

    it('errore su UPDATE businessreason: non propaga', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ jobcardid: 'JCID-42' }] })
        .mockRejectedValueOnce(new Error('db down'));

      const outcome = await syncJobcardActivity({ pool, jobCardId: 'JCID-42', djcSyncStatus: 'FAILURE', eventType: 'DMS_PUSH_FAILURE', logger, deps: makeDeps(DETAILS_BODY) });

      expect(outcome).toEqual({ techReasonUpdated: true, ack: 'KO', businessReason: 'SYNCED', businessReasonUpdated: false });
      expect(logger.error).toHaveBeenCalled();
    });

    it('UPDATE businessreason senza righe/rows: businessReasonUpdated false', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ jobcardid: 'JCID-42' }] })
        .mockResolvedValueOnce({});

      const outcome = await syncJobcardActivity({ pool, jobCardId: 'JCID-42', djcSyncStatus: 'FAILURE', eventType: 'DMS_PUSH_FAILURE', logger, deps: makeDeps(DETAILS_BODY) });

      expect(outcome.businessReasonUpdated).toBe(false);
    });
  });
});
