'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/repositoryFactory');
jest.mock('../src/hqMarketsResolver');

const { buildRepository, buildMyPeopleDmsRepository } = require('../src/repositoryFactory');
const { resolveHqMarketsList } = require('../src/hqMarketsResolver');
const { handler, runCli, DEFAULT_MARKET, getAuthContext, resolveRoleFlags } = require('../src/index');
const { SessionNotFoundError } = require('../src/errors');

describe('session/src/index — handler', () => {
  let mockRepository;
  let mockMyPeopleDmsRepository;

  beforeEach(() => {
    mockRepository = { getSessionData: jest.fn() };
    mockMyPeopleDmsRepository = { getSessionData: jest.fn() };
    buildRepository.mockReturnValue(mockRepository);
    buildMyPeopleDmsRepository.mockReturnValue(mockMyPeopleDmsRepository);
    resolveHqMarketsList.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  it('DEFAULT_MARKET e\' "1000" di default', () => {
    expect(DEFAULT_MARKET).toBe('1000');
  });

  it('ritorna 401 quando event e\' vuoto (nessun authorizer)', async () => {
    const res = await handler();
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).success).toBe(false);
    expect(mockMyPeopleDmsRepository.getSessionData).not.toHaveBeenCalled();
    expect(mockRepository.getSessionData).not.toHaveBeenCalled();
  });

  it('ritorna 401 quando requestContext.authorizer.sub e\' assente', async () => {
    const res = await handler({ requestContext: { authorizer: {} } });
    expect(res.statusCode).toBe(401);
    expect(mockMyPeopleDmsRepository.getSessionData).not.toHaveBeenCalled();
  });

  it('usa requestContext.authorizer.sub come username per MyPeopleDmsSessionRepository', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000', sincom: '0073741' });
    const res = await handler({ requestContext: { authorizer: { sub: '0073741.d235' } } });

    expect(mockMyPeopleDmsRepository.getSessionData).toHaveBeenCalledWith('0073741.d235', null);
    expect(mockRepository.getSessionData).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      codmarket: '1000',
      sincom: '0073741',
      hqCentral: 0,
      hqMarket: 0,
      dealer: 1,
      hqMarketsList: [],
      userroles: [],
    });
  });

  it('espone userroles (array) valorizzato da requestContext.authorizer.roles (CSV)', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });
    const res = await handler({
      requestContext: { authorizer: { sub: '0073741.d235', roles: 'dealer, advisor' } },
    });
    expect(JSON.parse(res.body).userroles).toEqual(['dealer', 'advisor']);
  });

  it('inserisce userroles subito dopo profile nell\'ordine delle chiavi della risposta', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({
      codmarket: '1000',
      profile: 'ADMIN',
      physicalsite: 'SITE1',
    });
    const res = await handler({
      requestContext: { authorizer: { sub: '0073741.d235', roles: 'dealer' } },
    });
    expect(Object.keys(JSON.parse(res.body))).toEqual([
      'codmarket',
      'profile',
      'hqCentral',
      'hqMarket',
      'dealer',
      'hqMarketsList',
      'userroles',
      'physicalsite',
    ]);
  });

  it('accoda userroles in fondo se profile non e\' presente nei dati del repository', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });
    const res = await handler({
      requestContext: { authorizer: { sub: '0073741.d235', roles: 'dealer' } },
    });
    expect(Object.keys(JSON.parse(res.body))).toEqual(['codmarket', 'hqCentral', 'hqMarket', 'dealer', 'hqMarketsList', 'userroles']);
  });

  it('valorizza hqCentral=1 quando un ruolo contiene HQCENTRAL (case-insensitive, prefisso/ambiente variabili)', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });
    const res = await handler({
      requestContext: { authorizer: { sub: '0073741.d235', roles: 'ZWRT.WOC.PROD.hqcentral' } },
    });
    expect(JSON.parse(res.body)).toMatchObject({ hqCentral: 1, hqMarket: 0, dealer: 0 });
  });

  it('valorizza hqMarket=1 quando un ruolo contiene HQNSC + 4 cifre del mercato', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });
    const res = await handler({
      requestContext: { authorizer: { sub: '0073741.d235', roles: 'ZWRT.WOC.NONPROD.HQNSC3109' } },
    });
    expect(JSON.parse(res.body)).toMatchObject({ hqCentral: 0, hqMarket: 1, dealer: 0 });
  });

  it('valorizza dealer=1 quando nessun ruolo e\' HQCENTRAL/HQNSC (default)', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });
    const res = await handler({
      requestContext: { authorizer: { sub: '0073741.d235', roles: 'dealer,advisor' } },
    });
    expect(JSON.parse(res.body)).toMatchObject({ hqCentral: 0, hqMarket: 0, dealer: 1 });
  });

  it('resolveRoleFlags da\' priorita\' a hqCentral su hqMarket se un utente avesse entrambi i ruoli', () => {
    expect(resolveRoleFlags(['WRT.WOC.NONPROD.HQNSC3109', 'WRT.WOC.NONPROD.HQCENTRAL']))
      .toEqual({ hqCentral: 1, hqMarket: 0, dealer: 0 });
  });

  it('resolveRoleFlags ritorna tutti 0 tranne dealer con roles vuoto/non array', () => {
    expect(resolveRoleFlags([])).toEqual({ hqCentral: 0, hqMarket: 0, dealer: 1 });
    expect(resolveRoleFlags(undefined)).toEqual({ hqCentral: 0, hqMarket: 0, dealer: 1 });
  });

  it('ignora username/codmarket passati dal client e usa sempre authorizer.sub', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({});
    await handler({
      requestContext: { authorizer: { sub: '0073741.d235' } },
      queryStringParameters: { username: 'altro.utente', codmarket: '3109' },
      pathParameters: { username: 'altro.utente', codmarket: '3109' },
      criteria: { username: 'altro.utente', codmarket: '3109' },
    });
    expect(mockMyPeopleDmsRepository.getSessionData).toHaveBeenCalledWith('0073741.d235', null);
    expect(mockRepository.getSessionData).not.toHaveBeenCalled();
  });

  it('inoltra il profile (parsato da authorizer.profile) a getSessionData, per il mapping firstname/lastname HQ', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ usertype: 'HQ' });
    const profile = { sub: 'SF48816', given_name: 'Mario', family_name: 'Rossi' };
    await handler({
      requestContext: { authorizer: { sub: 'SF48816', profile: JSON.stringify(profile) } },
    });
    expect(mockMyPeopleDmsRepository.getSessionData).toHaveBeenCalledWith('SF48816', profile);
  });

  it('valorizza hqMarketsList con l\'elenco ritornato da resolveHqMarketsList per un utente HQ centrale', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });
    const markets = [{ market: '1000', description: 'Italy' }, { market: '3109', description: 'France' }];
    resolveHqMarketsList.mockResolvedValue(markets);

    const res = await handler({
      requestContext: { authorizer: { sub: 'SF48816', roles: 'ZWRT.WOC.NONPROD.HQCENTRAL' } },
    });

    expect(JSON.parse(res.body).hqMarketsList).toEqual(markets);
    expect(resolveHqMarketsList).toHaveBeenCalledWith({ hqCentral: 1, hqMarket: 0, roles: ['ZWRT.WOC.NONPROD.HQCENTRAL'] });
  });

  it('valorizza hqMarketsList con il singolo mercato per un utente HQ mercato', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });
    resolveHqMarketsList.mockResolvedValue([{ market: '3109', description: 'France' }]);

    const res = await handler({
      requestContext: { authorizer: { sub: 'SF48816', roles: 'ZWRT.WOC.NONPROD.HQNSC3109' } },
    });

    expect(JSON.parse(res.body).hqMarketsList).toEqual([{ market: '3109', description: 'France' }]);
    expect(resolveHqMarketsList).toHaveBeenCalledWith({ hqCentral: 0, hqMarket: 1, roles: ['ZWRT.WOC.NONPROD.HQNSC3109'] });
  });

  it('hqMarketsList e\' [] per un dealer (default del mock resolveHqMarketsList)', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });

    const res = await handler({
      requestContext: { authorizer: { sub: '0073741.d235', roles: 'dealer' } },
    });

    expect(JSON.parse(res.body).hqMarketsList).toEqual([]);
    expect(resolveHqMarketsList).toHaveBeenCalledWith({ hqCentral: 0, hqMarket: 0, roles: ['dealer'] });
  });

  it('ritorna 404 quando MyPeopleDmsSessionRepository lancia SessionNotFoundError', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockRejectedValue(
      new SessionNotFoundError('0073741.d235', "l'utente")
    );
    const res = await handler({ requestContext: { authorizer: { sub: '0073741.d235' } } });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  it('ritorna 502 su errore generico di MyPeopleDmsSessionRepository (es. dms irraggiungibile)', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockRejectedValue(new Error('dms unreachable'));
    const res = await handler({ requestContext: { authorizer: { sub: '0073741.d235' } } });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).message).toBe('dms unreachable');
  });

  it('ritorna 502 con messaggio stringificato quando l\'errore non ha "message"', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockRejectedValue('boom');
    const res = await handler({ requestContext: { authorizer: { sub: '0073741.d235' } } });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).message).toBe('boom');
  });

  it('la risposta ha header Content-Type: application/json', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({});
    const res = await handler({ requestContext: { authorizer: { sub: '0073741.d235' } } });
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});

describe('session/src/index — getAuthContext', () => {
  it('ritorna sub/roles/profile nulli o vuoti quando requestContext.authorizer e\' assente', () => {
    expect(getAuthContext({})).toEqual({ sub: null, roles: [], profile: null });
  });

  it('estrae sub dall\'authorizer', () => {
    const { sub } = getAuthContext({ requestContext: { authorizer: { sub: '0073741.d235' } } });
    expect(sub).toBe('0073741.d235');
  });

  it('converte roles (CSV) in array', () => {
    const { roles } = getAuthContext({
      requestContext: { authorizer: { sub: 'x', roles: 'dealer, advisor' } },
    });
    expect(roles).toEqual(['dealer', 'advisor']);
  });

  it('ritorna roles [] quando authorizer.roles e\' assente', () => {
    const { roles } = getAuthContext({ requestContext: { authorizer: { sub: 'x' } } });
    expect(roles).toEqual([]);
  });

  it('effettua il parsing JSON di profile quando presente', () => {
    const profile = { sub: 'x', dealer_code: '0073741', brand: 'FT' };
    const { profile: parsed } = getAuthContext({
      requestContext: { authorizer: { sub: 'x', profile: JSON.stringify(profile) } },
    });
    expect(parsed).toEqual(profile);
  });

  it('ritorna profile null quando il JSON e\' invalido', () => {
    const { profile } = getAuthContext({
      requestContext: { authorizer: { sub: 'x', profile: '{not-valid-json' } },
    });
    expect(profile).toBeNull();
  });

  it('ritorna profile null quando authorizer.profile e\' assente', () => {
    const { profile } = getAuthContext({ requestContext: { authorizer: { sub: 'x' } } });
    expect(profile).toBeNull();
  });
});

describe('session/src/index — runCli', () => {
  let mockRepository;
  let mockMyPeopleDmsRepository;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    mockRepository = { getSessionData: jest.fn() };
    mockMyPeopleDmsRepository = { getSessionData: jest.fn() };
    buildRepository.mockReturnValue(mockRepository);
    buildMyPeopleDmsRepository.mockReturnValue(mockMyPeopleDmsRepository);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    delete process.exitCode;
  });

  it('stampa i dati del mercato di default quando non sono passati argomenti', async () => {
    mockRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });
    const data = await runCli(['node', 'src/index.js']);
    expect(mockRepository.getSessionData).toHaveBeenCalledWith('1000');
    expect(data).toEqual({ codmarket: '1000' });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it('stampa i dati del mercato richiesto da argv', async () => {
    mockRepository.getSessionData.mockResolvedValue({ codmarket: '3109' });
    const data = await runCli(['node', 'src/index.js', '3109']);
    expect(mockRepository.getSessionData).toHaveBeenCalledWith('3109');
    expect(data.codmarket).toBe('3109');
  });

  it('logga l\'errore e imposta process.exitCode a 1 in caso di fallimento', async () => {
    mockRepository.getSessionData.mockRejectedValue(new SessionNotFoundError('9999'));
    const result = await runCli(['node', 'src/index.js', '9999']);
    expect(result).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[session] Errore:'));
    expect(process.exitCode).toBe(1);
  });

  it('con --username usa MyPeopleDmsSessionRepository', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });
    const data = await runCli(['node', 'src/index.js', '--username', '0073741.d235']);
    expect(mockMyPeopleDmsRepository.getSessionData).toHaveBeenCalledWith('0073741.d235');
    expect(mockRepository.getSessionData).not.toHaveBeenCalled();
    expect(data).toEqual({ codmarket: '1000' });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it('--username senza valore logga un errore e non chiama alcun repository', async () => {
    const result = await runCli(['node', 'src/index.js', '--username']);
    expect(result).toBeUndefined();
    expect(mockMyPeopleDmsRepository.getSessionData).not.toHaveBeenCalled();
    expect(mockRepository.getSessionData).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--username richiede un valore'));
    expect(process.exitCode).toBe(1);
  });
});
