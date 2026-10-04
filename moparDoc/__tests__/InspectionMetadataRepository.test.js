'use strict';

// Il modulo db reale non viene mai usato: nessuna connessione ad Aurora nei test
jest.mock('../db', () => ({
  getPool: jest.fn(),
  isDbConfigured: jest.fn(() => false),
}));

const db = require('../db');
const repo = require('../InspectionMetadataRepository');

const ALL_NULL = {
  Kind: null, TabId: null, DamageArea: null, Description: null, PosX: null, PosY: null, CapturedAt: null,
};

// Pool finto con query pilotabile
function mockPool(queryImpl) {
  const pool = { query: jest.fn(queryImpl || (() => Promise.resolve({ rows: [], rowCount: 0 }))) };
  return { pool, deps: { getPool: jest.fn().mockResolvedValue(pool) } };
}

describe('InspectionMetadataRepository', () => {
  let warnSpy;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    db.isDbConfigured.mockImplementation(() => false);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('normalizeInspectionMetadata', () => {
    test('input assente/non oggetto -> tutti null', () => {
      expect(repo.normalizeInspectionMetadata(undefined)).toEqual(ALL_NULL);
      expect(repo.normalizeInspectionMetadata(null)).toEqual(ALL_NULL);
      expect(repo.normalizeInspectionMetadata('x')).toEqual(ALL_NULL);
      expect(repo.normalizeInspectionMetadata({})).toEqual(ALL_NULL);
    });

    test('valori validi: trim, lowercase enum, numeri, data ISO', () => {
      expect(repo.normalizeInspectionMetadata({
        Kind: ' PIN ',
        TabId: 'Vehicle',
        DamageArea: 'front',
        Description: '  graffio  ',
        PosX: 12.5,
        PosY: '87.25',
        CapturedAt: '2026-10-01T10:20:30+02:00',
      })).toEqual({
        Kind: 'pin',
        TabId: 'vehicle',
        DamageArea: 'front',
        Description: 'graffio',
        PosX: 12.5,
        PosY: 87.25,
        CapturedAt: '2026-10-01T08:20:30.000Z',
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    test('limiti 0 e 100 ammessi; CapturedAt numerico (epoch ms) ammesso', () => {
      const out = repo.normalizeInspectionMetadata({ PosX: 0, PosY: '100', CapturedAt: 0 });
      expect(out.PosX).toBe(0);
      expect(out.PosY).toBe(100);
      expect(out.CapturedAt).toBe('1970-01-01T00:00:00.000Z');
    });

    test('stringhe vuote/solo spazi -> null senza warn', () => {
      expect(repo.normalizeInspectionMetadata({
        Kind: '', TabId: '   ', DamageArea: '\t', Description: '  ', PosX: '', PosY: '  ', CapturedAt: ' ',
      })).toEqual(ALL_NULL);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    test('enum fuori whitelist -> null + warn', () => {
      expect(repo.normalizeInspectionMetadata({ Kind: 'photo', TabId: 'engine', DamageArea: 'bottom' })).toEqual(ALL_NULL);
      expect(warnSpy).toHaveBeenCalledTimes(3);
    });

    test('tipi errati (oggetti, array, boolean) -> null + warn', () => {
      expect(repo.normalizeInspectionMetadata({
        Kind: { a: 1 }, TabId: ['vehicle'], DamageArea: true, Description: { t: 'x' }, PosX: { v: 1 }, PosY: [1], CapturedAt: { d: 1 },
      })).toEqual(ALL_NULL);
      expect(warnSpy).toHaveBeenCalledTimes(7);
    });

    test('PosX/PosY non numerici, non finiti o fuori range -> null + warn', () => {
      expect(repo.normalizeInspectionMetadata({ PosX: 'abc', PosY: -0.1 })).toEqual(ALL_NULL);
      expect(repo.normalizeInspectionMetadata({ PosX: 100.01, PosY: Infinity })).toEqual(ALL_NULL);
      expect(repo.normalizeInspectionMetadata({ PosX: NaN, PosY: '150' })).toEqual(ALL_NULL);
      expect(warnSpy).toHaveBeenCalledTimes(6);
    });

    test('CapturedAt non parsabile -> null + warn', () => {
      expect(repo.normalizeInspectionMetadata({ CapturedAt: 'not-a-date' }).CapturedAt).toBeNull();
      expect(repo.normalizeInspectionMetadata({ CapturedAt: NaN }).CapturedAt).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    test('Description oltre 1000 caratteri -> troncata + warn', () => {
      const out = repo.normalizeInspectionMetadata({ Description: 'a'.repeat(1500) });
      expect(out.Description).toHaveLength(repo.DESCRIPTION_MAX_LENGTH);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('isEmptyMetadata / rowToMetadata / resolveDocumentId', () => {
    test('isEmptyMetadata', () => {
      expect(repo.isEmptyMetadata(ALL_NULL)).toBe(true);
      expect(repo.isEmptyMetadata({})).toBe(true);
      expect(repo.isEmptyMetadata({ ...ALL_NULL, PosX: 0 })).toBe(false);
    });

    test('rowToMetadata converte NUMERIC (stringa) in number e captured_at in ISO', () => {
      expect(repo.rowToMetadata({
        document_id: '1', kind: 'pin', tab_id: 'tyres', damage_area: 'left', description: 'd',
        pos_x: '10.500', pos_y: '0.000', captured_at: new Date('2026-10-01T08:00:00Z'),
      })).toEqual({
        Kind: 'pin', TabId: 'tyres', DamageArea: 'left', Description: 'd', PosX: 10.5, PosY: 0, CapturedAt: '2026-10-01T08:00:00.000Z',
      });
    });

    test('rowToMetadata con valori null/invalidi', () => {
      expect(repo.rowToMetadata({ document_id: '1' })).toEqual(ALL_NULL);
      expect(repo.rowToMetadata({ pos_x: 'x', pos_y: null, captured_at: 'bad' })).toEqual(ALL_NULL);
      expect(repo.rowToMetadata({ captured_at: '2026-10-01T08:00:00Z' }).CapturedAt).toBe('2026-10-01T08:00:00.000Z');
    });

    test('resolveDocumentId: chiave ID, fallback e casi null', () => {
      expect(repo.resolveDocumentId({ ID: 47558 })).toBe('47558');
      expect(repo.resolveDocumentId({ DocumentId: ' D1 ' })).toBe('D1');
      expect(repo.resolveDocumentId({ ID: '  ', id: 'x' })).toBe('x');
      expect(repo.resolveDocumentId({})).toBeNull();
      expect(repo.resolveDocumentId(null)).toBeNull();
      expect(repo.resolveDocumentId('x')).toBeNull();
    });
  });

  describe('saveInspectionMetadata', () => {
    const base = { documentId: 47645, jobCardId: 78660, vin: ' VIN123 ', createdBy: ' user.sub ' };

    test('UPSERT parametrizzato con valori normalizzati', async () => {
      const { pool, deps } = mockPool();
      const res = await repo.saveInspectionMetadata({
        ...base,
        metadata: { Kind: 'pin', TabId: 'vehicle', DamageArea: 'front', Description: 'x', PosX: '1', PosY: 2, CapturedAt: '2026-10-01T08:00:00Z' },
      }, deps);
      expect(res).toEqual({ saved: true, reason: 'saved' });
      expect(pool.query).toHaveBeenCalledWith(repo.UPSERT_SQL, [
        '47645', '78660', 'VIN123', 'pin', 'vehicle', 'front', 'x', 1, 2, '2026-10-01T08:00:00.000Z', 'user.sub',
      ]);
      expect(repo.UPSERT_SQL).toMatch(/ON CONFLICT \(document_id\) DO UPDATE/);
    });

    test('createdBy assente -> null; createdBy lungo -> troncato a 50', async () => {
      const { pool, deps } = mockPool();
      await repo.saveInspectionMetadata({ ...base, createdBy: undefined, metadata: { Kind: 'general' } }, deps);
      expect(pool.query.mock.calls[0][1][10]).toBeNull();
      await repo.saveInspectionMetadata({ ...base, createdBy: 'u'.repeat(80), metadata: { Kind: 'general' } }, deps);
      expect(pool.query.mock.calls[1][1][10]).toHaveLength(50);
    });

    test('tutti i metadati null -> nessuna riga (no-metadata), nessun accesso al DB', async () => {
      const { pool, deps } = mockPool();
      const res = await repo.saveInspectionMetadata({ ...base, metadata: { Kind: 'bad', PosX: 200 } }, deps);
      expect(res).toEqual({ saved: false, reason: 'no-metadata' });
      expect(deps.getPool).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();
    });

    test('input assente -> no-metadata', async () => {
      await expect(repo.saveInspectionMetadata()).resolves.toEqual({ saved: false, reason: 'no-metadata' });
    });

    test('DB non configurato (default da ./db) -> db-not-configured', async () => {
      const res = await repo.saveInspectionMetadata({ ...base, metadata: { Kind: 'pin' } });
      expect(res).toEqual({ saved: false, reason: 'db-not-configured' });
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('DB configurato (default da ./db) -> usa getPool di ./db', async () => {
      const { pool } = mockPool();
      db.isDbConfigured.mockImplementation(() => true);
      db.getPool.mockResolvedValue(pool);
      const res = await repo.saveInspectionMetadata({ ...base, metadata: { Kind: 'pin' } });
      expect(res.saved).toBe(true);
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    test('isDbConfigured iniettato senza getPool -> getPool da ./db', async () => {
      const { pool } = mockPool();
      db.getPool.mockResolvedValue(pool);
      const res = await repo.saveInspectionMetadata({ ...base, metadata: { Kind: 'pin' } }, { isDbConfigured: () => true });
      expect(res.saved).toBe(true);
    });

    test('chiavi mancanti -> missing-keys', async () => {
      const { deps } = mockPool();
      await expect(repo.saveInspectionMetadata({ ...base, documentId: null, metadata: { Kind: 'pin' } }, deps))
        .resolves.toEqual({ saved: false, reason: 'missing-keys' });
      await expect(repo.saveInspectionMetadata({ ...base, jobCardId: undefined, metadata: { Kind: 'pin' } }, deps))
        .resolves.toEqual({ saved: false, reason: 'missing-keys' });
      await expect(repo.saveInspectionMetadata({ ...base, vin: '', metadata: { Kind: 'pin' } }, deps))
        .resolves.toEqual({ saved: false, reason: 'missing-keys' });
    });

    test('errore DB propagato al chiamante', async () => {
      const { deps } = mockPool(() => Promise.reject(new Error('db down')));
      await expect(repo.saveInspectionMetadata({ ...base, metadata: { Kind: 'pin' } }, deps)).rejects.toThrow('db down');
    });
  });

  describe('findByDocumentIds', () => {
    test('lista vuota/non array -> Map vuota senza DB', async () => {
      const { deps } = mockPool();
      expect((await repo.findByDocumentIds([], deps)).size).toBe(0);
      expect((await repo.findByDocumentIds(null, deps)).size).toBe(0);
      expect((await repo.findByDocumentIds([null, undefined, '  '], deps)).size).toBe(0);
      expect(deps.getPool).not.toHaveBeenCalled();
    });

    test('DB non configurato -> Map vuota', async () => {
      expect((await repo.findByDocumentIds([1])).size).toBe(0);
      expect(db.getPool).not.toHaveBeenCalled();
    });

    test('SELECT con id stringa deduplicati e mappa document_id -> metadati', async () => {
      const { pool, deps } = mockPool(() => Promise.resolve({
        rows: [{ document_id: '1', kind: 'pin', pos_x: '5.000', pos_y: null }],
      }));
      const map = await repo.findByDocumentIds([1, '1', ' 2 '], deps);
      expect(pool.query).toHaveBeenCalledWith(repo.SELECT_BY_IDS_SQL, [['1', '2']]);
      expect(map.get('1')).toEqual({ ...ALL_NULL, Kind: 'pin', PosX: 5 });
      expect(map.has('2')).toBe(false);
    });
  });

  describe('deleteByDocumentIds', () => {
    test('lista vuota -> 0 senza DB', async () => {
      const { deps } = mockPool();
      await expect(repo.deleteByDocumentIds([], deps)).resolves.toBe(0);
      expect(deps.getPool).not.toHaveBeenCalled();
    });

    test('DB non configurato -> 0', async () => {
      await expect(repo.deleteByDocumentIds([1])).resolves.toBe(0);
    });

    test('DELETE parametrizzato, ritorna rowCount', async () => {
      const { pool, deps } = mockPool(() => Promise.resolve({ rowCount: 2 }));
      await expect(repo.deleteByDocumentIds([1, 2], deps)).resolves.toBe(2);
      expect(pool.query).toHaveBeenCalledWith(repo.DELETE_BY_IDS_SQL, [['1', '2']]);
    });

    test('rowCount assente -> 0', async () => {
      const { deps } = mockPool(() => Promise.resolve({}));
      await expect(repo.deleteByDocumentIds([1], deps)).resolves.toBe(0);
    });

    test('errore DB propagato', async () => {
      const { deps } = mockPool(() => Promise.reject(new Error('db down')));
      await expect(repo.deleteByDocumentIds([1], deps)).rejects.toThrow('db down');
    });
  });

  describe('enrichDocumentLists', () => {
    const upstream = () => ({
      errorCode: 0,
      DocumentList: [{ ID: 3 }],
      jobCardList: [
        { JobCardId: 10, DocumentList: [{ ID: 1, Name: 'a' }, { ID: 2 }, null] },
        { JobCardId: 11 },
        null,
      ],
    });

    test('risposte non oggetto o senza liste restituite invariate', async () => {
      expect(await repo.enrichDocumentLists(null)).toBeNull();
      expect(await repo.enrichDocumentLists('x')).toBe('x');
      const arr = [1];
      expect(await repo.enrichDocumentLists(arr)).toBe(arr);
      const plain = { success: true };
      expect(await repo.enrichDocumentLists(plain)).toBe(plain);
    });

    test('con righe: InspectionMetadata valorizzato per id trovati, null altrove; input non mutato', async () => {
      const { pool, deps } = mockPool(() => Promise.resolve({
        rows: [
          { document_id: '1', kind: 'pin', tab_id: 'vehicle', damage_area: 'front', description: 'd', pos_x: '10.000', pos_y: '20.500', captured_at: new Date('2026-10-01T08:00:00Z') },
          { document_id: '3', kind: 'general' },
        ],
      }));
      const input = upstream();
      const out = await repo.enrichDocumentLists(input, deps);

      expect(pool.query).toHaveBeenCalledWith(repo.SELECT_BY_IDS_SQL, [['3', '1', '2']]);
      expect(out.jobCardList[0].DocumentList[0]).toEqual({
        ID: 1,
        Name: 'a',
        InspectionMetadata: {
          Kind: 'pin', TabId: 'vehicle', DamageArea: 'front', Description: 'd', PosX: 10, PosY: 20.5, CapturedAt: '2026-10-01T08:00:00.000Z',
        },
      });
      expect(out.jobCardList[0].DocumentList[1]).toEqual({ ID: 2, InspectionMetadata: null });
      expect(out.jobCardList[0].DocumentList[2]).toBeNull();
      expect(out.jobCardList[1]).toEqual({ JobCardId: 11 });
      expect(out.jobCardList[2]).toBeNull();
      expect(out.DocumentList[0].InspectionMetadata).toEqual({ ...ALL_NULL, Kind: 'general' });
      expect(out.errorCode).toBe(0);
      expect(input.jobCardList[0].DocumentList[0].InspectionMetadata).toBeUndefined();
    });

    test('documento senza id -> InspectionMetadata null', async () => {
      const { deps } = mockPool();
      const out = await repo.enrichDocumentLists({ DocumentList: [{ Name: 'x' }] }, deps);
      expect(out.DocumentList[0]).toEqual({ Name: 'x', InspectionMetadata: null });
    });

    test('solo jobCardList (senza DocumentList top-level), DB non configurato -> tutti null', async () => {
      const out = await repo.enrichDocumentLists({ jobCardList: [{ DocumentList: [{ ID: 1 }] }] });
      expect(out.jobCardList[0].DocumentList[0].InspectionMetadata).toBeNull();
      expect(out.DocumentList).toBeUndefined();
    });

    test('errore DB -> InspectionMetadata null su tutti i documenti + log errore', async () => {
      const { deps } = mockPool(() => Promise.reject(new Error('db down')));
      const out = await repo.enrichDocumentLists(upstream(), deps);
      expect(out.DocumentList[0].InspectionMetadata).toBeNull();
      expect(out.jobCardList[0].DocumentList[0].InspectionMetadata).toBeNull();
      expect(out.jobCardList[0].DocumentList[1].InspectionMetadata).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });

    test('errore senza message gestito', async () => {
      const deps = { getPool: jest.fn().mockRejectedValue(null) };
      const out = await repo.enrichDocumentLists({ DocumentList: [{ ID: 1 }] }, deps);
      expect(out.DocumentList[0].InspectionMetadata).toBeNull();
    });
  });
});
