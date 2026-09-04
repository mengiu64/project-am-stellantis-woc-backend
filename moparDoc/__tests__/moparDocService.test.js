'use strict';

const {
  createJobCard,
  createAccessToken,
  getUploadDocURL,
  uploadedDoc,
  getJobCardList,
  getJobCardAndDocumentList,
  getDocumentsInfo,
  getDocuments,
  DeleteDocuments,
  DeleteJobcard,
  getDocumentsDownloadUrl,
} = require('../moparDocService');

// Fixture condivisa a sei chiavi (Req 5.1): usata dentro la factory del mock di ../config
jest.mock('../config', () => {
  // Recupera la fixture condivisa dentro la factory del mock (hoisting-safe)
  const { VALID_SECRET: SECRET } = require('./fixtures/validSecret');
  return {
    getConfig: jest.fn().mockResolvedValue({
      // jobDocs espone anche apiAccessCode/tamAccessCode derivati dalla fixture a sei chiavi
      jobDocs: {
        baseUrl: 'https://job-docs',
        basePath: '/jd',
        ibmClientId: 'id',
        ibmClientSecret: 'secret',
        apiAccessCode: SECRET.MOPARDOC_API_ACCESS_CODE, // Codice API dalla fixture condivisa
        tamAccessCode: SECRET.MOPARDOC_TAM_ACCESS_CODE, // Codice TAM dalla fixture condivisa
      },
      moparDocsServices: { baseUrl: 'https://services', basePath: '/svc', ibmClientId: 'id', ibmClientSecret: 'secret' },
      moparDocsApi: { baseUrl: 'https://api', basePath: '/api', ibmClientId: 'id', ibmClientSecret: 'secret' },
    }),
  };
});

jest.mock('../authService', () => ({
  getBearerToken: jest.fn().mockResolvedValue('test-token'),
}));

jest.mock('../httpClient', () => ({
  httpsRequest: jest.fn((options, body) => {
    return Promise.resolve({ statusCode: 200, body: { success: true } });
  }),
}));

describe('moparDocService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ────── Metodi originali (4 test per metodo: 2 error, 1 success) ──────

  describe('createJobCard', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(createJobCard({ vin: 'VIN123' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await createJobCard({
        vin: 'VIN123',
        market: 'IT',
        source: 'WEB',
        UserName: 'user1',
        dealerCode: '0062230',
        JobCard_Title: 'Test JobCard',
        TAMAccessCode: 'ACC123',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('createAccessToken', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(createAccessToken({ JobCardId: 'JC1' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await createAccessToken({
        JobCardId: 'JC1',
        UserName: 'user1',
        dealerCode: '0062230',
        market: 'IT',
        APIAccessCode: 'ACC123',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('getUploadDocURL', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getUploadDocURL({ JobCardId: 'JC1' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getUploadDocURL({
        JobCardId: 'JC1',
        Filename: 'doc.pdf',
        Size: '182379',
        ContentType: 'application/pdf',
        AccessToken: 'token',
        Filetype: 'PDF',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('uploadedDoc', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(uploadedDoc({ JobCardId: 'JC1' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await uploadedDoc({
        JobCardId: 'JC1',
        DocumentId: 'DOC1',
        Action: 'upload',
        AccessToken: 'token',
      });
      expect(result).toEqual({ success: true });
    });
  });

  // ────── Metodi NUOVI (2 test per metodo: 1 error, 1 success) ──────

  describe('getJobCardList', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getJobCardList({ VIN: 'VIN123' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getJobCardList({
        source: 'WOC',
        vin: 'VIN123',
        dealerCode: '0062230',
        market: 'IT',
      });
      expect(result).toEqual({ success: true });
    });

    test('should throw error when neither dealerCode nor rrdi is provided', async () => {
      await expect(getJobCardList({ source: 'WOC', vin: 'VIN123', market: 'IT' })).rejects.toThrow('Missing required field(s)');
    });

    test('should use rrdi when dealerCode is absent', async () => {
      const result = await getJobCardList({
        source: 'WOC',
        vin: 'VIN123',
        rrdi: 'RRDI01',
        market: 'IT',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('getJobCardAndDocumentList', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getJobCardAndDocumentList({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getJobCardAndDocumentList({
        source: 'WOC',
        vin: 'VIN123',
        dealerCode: '0062230',
        market: 'IT',
        Language: 'en',
        StartDate: '2022-10-31',
      });
      expect(result).toEqual({ success: true });
    });

    test('should throw error when neither dealerCode nor rrdi is provided', async () => {
      await expect(
        getJobCardAndDocumentList({ source: 'WOC', vin: 'VIN123', market: 'IT', Language: 'en', StartDate: '2022-10-31' })
      ).rejects.toThrow('Missing required field(s)');
    });

    test('should use rrdi when dealerCode is absent', async () => {
      const result = await getJobCardAndDocumentList({
        source: 'WOC',
        vin: 'VIN123',
        rrdi: 'RRDI01',
        market: 'IT',
        Language: 'en',
        StartDate: '2022-10-31',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('getDocumentsInfo', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getDocumentsInfo({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getDocumentsInfo({
        source: 'WOC',
        Language: 'en',
        DocumentIDList: [227856, 227857],
      });
      expect(result).toEqual({ success: true });
    });

    test('should throw error if DocumentIDList is empty', async () => {
      await expect(
        getDocumentsInfo({ source: 'WOC', Language: 'en', DocumentIDList: [] })
      ).rejects.toThrow('DocumentIDList deve essere un array non vuoto');
    });
  });

  describe('getDocuments', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getDocuments({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getDocuments({
        vin: 'VIN123',
      });
      expect(result).toEqual({ success: true });
    });

    test('should include JobCardIds in payload when provided', async () => {
      const result = await getDocuments({ vin: 'VIN123', JobCardIds: [1, 2, 3] });
      expect(result).toEqual({ success: true });
    });
  });

  describe('DeleteDocuments', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(DeleteDocuments({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await DeleteDocuments({
        source: 'WOC',
        JobCardId: 12345,
        Documents: [2083, 2084],
      });
      expect(result).toEqual({ success: true });
    });

    test('should throw error if Documents array is empty', async () => {
      await expect(
        DeleteDocuments({ source: 'WOC', JobCardId: 12345, Documents: [] })
      ).rejects.toThrow('Documents deve essere un array non vuoto');
    });
  });

  describe('DeleteJobcard', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(DeleteJobcard({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await DeleteJobcard({
        Source: 'WOC',
        JobCardId: 12345,
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('getDocumentsDownloadUrl', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getDocumentsDownloadUrl({ DocumentId: 'DOC1' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getDocumentsDownloadUrl({
        DocumentIDList: [227856, 227857],
      });
      expect(result).toEqual({ success: true });
    });

    test('should throw error if DocumentIDList is empty', async () => {
      await expect(
        getDocumentsDownloadUrl({ DocumentIDList: [] })
      ).rejects.toThrow('DocumentIDList deve essere un array non vuoto');
    });
  });

  describe('postJson HTTP error handling', () => {
    const { httpsRequest } = require('../httpClient');

    test('should throw when httpsRequest returns non-2xx status', async () => {
      httpsRequest.mockResolvedValueOnce({ statusCode: 500, body: { error: 'server error' } });
      await expect(
        createJobCard({
          vin: 'VIN123', market: 'IT', source: 'WOC', UserName: 'user1',
          dealerCode: '0062230', JobCard_Title: 'Test', TAMAccessCode: 'true',
        })
      ).rejects.toThrow('failed: HTTP 500');
    });

    test('should throw when response body has errorCode !== 0 (application error)', async () => {
      httpsRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: { errorCode: 1, errorMessage: 'Source Not compliant or Generic error in DeleteJobcard' },
      });
      await expect(
        DeleteJobcard({ Source: 'WOC', JobCardId: 82379 })
      ).rejects.toThrow('errorCode 1 - Source Not compliant or Generic error in DeleteJobcard');
    });

    test('should succeed when response body has errorCode === 0', async () => {
      httpsRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: { errorCode: 0, errorMessage: '' },
      });
      const result = await DeleteJobcard({ Source: 'WOC', JobCardId: 82379 });
      expect(result).toEqual({ errorCode: 0, errorMessage: '' });
    });

  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test di proprietà ed esempio per l'inoltro dei codici di accesso dalla config
// (Property 4/5/6 + esempio non-esposizione nei log). Riusa i mock di ../config
// e ../httpClient definiti sopra: config espone jobDocs.tamAccessCode/apiAccessCode
// derivati dalla fixture condivisa VALID_SECRET.
// ────────────────────────────────────────────────────────────────────────────

// Riferimenti ai mock e alla fixture condivisa a sei chiavi
const { VALID_SECRET } = require('./fixtures/validSecret');
const { httpsRequest } = require('../httpClient');

/**
 * Generatore pseudo-casuale deterministico (LCG) per i test di proprietà.
 * fast-check non è tra le dipendenze del modulo moparDoc, quindi si usa un
 * generatore inline che copre lo spazio degli input in modo intelligente.
 */
function makeRng(seed) {
  // Stato interno del generatore lineare congruenziale
  let state = seed >>> 0;
  return function next() {
    // Costanti classiche dell'LCG (Numerical Recipes)
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Genera una stringa arbitraria (inclusi caratteri speciali e stringa vuota rara)
function genString(rng) {
  // Alfabeto ampio per esercitare valori di codice diversi
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.';
  // Lunghezza variabile da 1 a 24 caratteri
  const len = 1 + Math.floor(rng() * 24);
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return out;
}

// Estrae il payload effettivamente inoltrato a un dato resourcePath dal mock httpsRequest.
// buildOptions imposta options.path = basePath + resourcePath; il body è il 2° argomento (JSON string).
function getForwardedPayload(resourcePath) {
  // Cerca fra le chiamate registrate quella il cui path termina col resourcePath atteso
  const call = httpsRequest.mock.calls.find(([options]) => options && options.path && options.path.endsWith(resourcePath));
  // Deserializza il body JSON inoltrato per ispezionare i campi
  return call ? JSON.parse(call[1]) : undefined;
}

describe('createJobCard — Property 4: inoltra il codice TAM dalla configurazione', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Feature: mopardoc-access-codes-to-secret, Property 4
  // Validates: Requirements 3.1, 3.5, 5.2
  test('TAMAccessCode inoltrato a /CreateJobCard è sempre quello della config, non del body', async () => {
    const rng = makeRng(0x4a4b4c4d);
    const iterations = 120; // >= 100 iterazioni richieste
    for (let i = 0; i < iterations; i += 1) {
      // Reset del mock per isolare le chiamate di questa iterazione
      httpsRequest.mockClear();
      // Genera un body valido con un TAMAccessCode differente dal valore del secret
      const bodyTam = genString(rng);
      const params = {
        vin: genString(rng),
        market: genString(rng),
        source: genString(rng),
        UserName: genString(rng),
        dealerCode: genString(rng),
        JobCard_Title: genString(rng),
        TAMAccessCode: bodyTam, // valore del body, che DEVE essere ignorato
      };

      // eslint-disable-next-line no-await-in-loop
      await createJobCard(params);

      const forwarded = getForwardedPayload('/CreateJobCard');
      // Il valore inoltrato deve corrispondere al codice del secret, mai a quello del body
      expect(forwarded.TAMAccessCode).toBe(VALID_SECRET.MOPARDOC_TAM_ACCESS_CODE);
    }
  });

  // Caso limite esplicito: anche senza TAMAccessCode nel body il valore proviene dalla config
  test('TAMAccessCode proviene dalla config anche quando assente dal body', async () => {
    httpsRequest.mockClear();
    await createJobCard({
      vin: 'VIN123', market: 'IT', source: 'WEB', UserName: 'user1',
      dealerCode: '0062230', JobCard_Title: 'Test',
    });
    const forwarded = getForwardedPayload('/CreateJobCard');
    expect(forwarded.TAMAccessCode).toBe(VALID_SECRET.MOPARDOC_TAM_ACCESS_CODE);
  });
});

describe('createAccessToken — Property 5: inoltra il codice API dalla configurazione', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Feature: mopardoc-access-codes-to-secret, Property 5
  // Validates: Requirements 3.2, 3.5, 5.3
  test('APIAccessCode inoltrato a /CreateAccessToken è sempre quello della config, non del body', async () => {
    const rng = makeRng(0x5e5f6061);
    const iterations = 120; // >= 100 iterazioni richieste
    for (let i = 0; i < iterations; i += 1) {
      // Reset del mock per isolare le chiamate di questa iterazione
      httpsRequest.mockClear();
      // Genera un body valido con un APIAccessCode differente dal valore del secret
      const bodyApi = genString(rng);
      const params = {
        JobCardId: genString(rng),
        UserName: genString(rng),
        dealerCode: genString(rng),
        market: genString(rng),
        APIAccessCode: bodyApi, // valore del body, che DEVE essere ignorato
      };

      // eslint-disable-next-line no-await-in-loop
      await createAccessToken(params);

      const forwarded = getForwardedPayload('/CreateAccessToken');
      // Il valore inoltrato deve corrispondere al codice del secret, mai a quello del body
      expect(forwarded.APIAccessCode).toBe(VALID_SECRET.MOPARDOC_API_ACCESS_CODE);
    }
  });

  // Caso limite esplicito: anche senza APIAccessCode nel body il valore proviene dalla config
  test('APIAccessCode proviene dalla config anche quando assente dal body', async () => {
    httpsRequest.mockClear();
    await createAccessToken({
      JobCardId: 'JC1', UserName: 'user1', dealerCode: '0062230', market: 'IT',
    });
    const forwarded = getForwardedPayload('/CreateAccessToken');
    expect(forwarded.APIAccessCode).toBe(VALID_SECRET.MOPARDOC_API_ACCESS_CODE);
  });
});

describe('Property 6: i codici di accesso non sono più obbligatori nel body', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Feature: mopardoc-access-codes-to-secret, Property 6
  // Validates: Requirements 3.3, 3.4
  test('createJobCard non fallisce per TAMAccessCode mancante quando gli altri campi sono presenti', async () => {
    const rng = makeRng(0x11223344);
    const iterations = 110; // >= 100 iterazioni richieste
    for (let i = 0; i < iterations; i += 1) {
      httpsRequest.mockClear();
      // Body con tutti i campi obbligatori residui ma SENZA TAMAccessCode
      const params = {
        vin: genString(rng),
        market: genString(rng),
        source: genString(rng),
        UserName: genString(rng),
        dealerCode: genString(rng),
        JobCard_Title: genString(rng),
      };
      // Non deve mai fallire con un errore di campo obbligatorio relativo a TAMAccessCode
      // eslint-disable-next-line no-await-in-loop
      await expect(createJobCard(params)).resolves.toEqual({ success: true });
    }
  });

  // Feature: mopardoc-access-codes-to-secret, Property 6
  // Validates: Requirements 3.3, 3.4
  test('createAccessToken non fallisce per APIAccessCode mancante quando gli altri campi sono presenti', async () => {
    const rng = makeRng(0x55667788);
    const iterations = 110; // >= 100 iterazioni richieste
    for (let i = 0; i < iterations; i += 1) {
      httpsRequest.mockClear();
      // Body con tutti i campi obbligatori residui ma SENZA APIAccessCode
      const params = {
        JobCardId: genString(rng),
        UserName: genString(rng),
        dealerCode: genString(rng),
        market: genString(rng),
      };
      // Non deve mai fallire con un errore di campo obbligatorio relativo a APIAccessCode
      // eslint-disable-next-line no-await-in-loop
      await expect(createAccessToken(params)).resolves.toEqual({ success: true });
    }
  });
});

describe('Esempio: i valori dei codici non compaiono nei log dei metodi di servizio', () => {
  let logSpy;
  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    // Spia su console.log/error/warn per ispezionare tutti gli argomenti loggati
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // Concatena tutti gli argomenti di tutte le chiamate di una spia in un'unica stringa
  function allLoggedText(...spies) {
    return spies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');
  }

  // Validates: Requirements 4.2
  test('createJobCard non stampa il valore del codice TAM nei log', async () => {
    await createJobCard({
      vin: 'VIN123', market: 'IT', source: 'WEB', UserName: 'user1',
      dealerCode: '0062230', JobCard_Title: 'Test',
    });
    const logged = allLoggedText(logSpy, errorSpy, warnSpy);
    // Il valore del codice TAM del secret non deve comparire in alcun log
    expect(logged).not.toContain(VALID_SECRET.MOPARDOC_TAM_ACCESS_CODE);
  });

  // Validates: Requirements 4.3
  test('createAccessToken non stampa il valore del codice API nei log', async () => {
    await createAccessToken({
      JobCardId: 'JC1', UserName: 'user1', dealerCode: '0062230', market: 'IT',
    });
    const logged = allLoggedText(logSpy, errorSpy, warnSpy);
    // Il valore del codice API del secret non deve comparire in alcun log
    expect(logged).not.toContain(VALID_SECRET.MOPARDOC_API_ACCESS_CODE);
  });
});
