'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/repositoryFactory');

const { buildRepository, buildMyPeopleDmsRepository } = require('../src/repositoryFactory');
const { handler, runCli, DEFAULT_MARKET } = require('../src/index');
const { SessionNotFoundError } = require('../src/errors');

describe('session/src/index — handler', () => {
  let mockRepository;
  let mockMyPeopleDmsRepository;

  beforeEach(() => {
    mockRepository = { getSessionData: jest.fn() };
    mockMyPeopleDmsRepository = { getSessionData: jest.fn() };
    buildRepository.mockReturnValue(mockRepository);
    buildMyPeopleDmsRepository.mockReturnValue(mockMyPeopleDmsRepository);
  });

  afterEach(() => jest.clearAllMocks());

  it('DEFAULT_MARKET e\' "1000" di default', () => {
    expect(DEFAULT_MARKET).toBe('1000');
  });

  it('usa il mercato di default ("1000") quando event e\' vuoto', async () => {
    mockRepository.getSessionData.mockResolvedValue({ codmarket: '1000' });
    const res = await handler();
    expect(mockRepository.getSessionData).toHaveBeenCalledWith('1000');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ codmarket: '1000' });
  });

  it('legge codmarket da queryStringParameters', async () => {
    mockRepository.getSessionData.mockResolvedValue({ codmarket: '3109' });
    const res = await handler({ queryStringParameters: { codmarket: '3109' } });
    expect(mockRepository.getSessionData).toHaveBeenCalledWith('3109');
    expect(res.statusCode).toBe(200);
  });

  it('legge codmarket da pathParameters quando assente altrove', async () => {
    mockRepository.getSessionData.mockResolvedValue({ codmarket: '3110' });
    const res = await handler({ pathParameters: { codmarket: '3110' } });
    expect(mockRepository.getSessionData).toHaveBeenCalledWith('3110');
    expect(res.statusCode).toBe(200);
  });

  it('legge codmarket da event.criteria (invocazione diretta)', async () => {
    mockRepository.getSessionData.mockResolvedValue({ codmarket: '3109' });
    const res = await handler({ criteria: { codmarket: '3109' } });
    expect(mockRepository.getSessionData).toHaveBeenCalledWith('3109');
    expect(res.statusCode).toBe(200);
  });

  it('event.criteria ha priorita\' su queryStringParameters', async () => {
    mockRepository.getSessionData.mockResolvedValue({});
    await handler({
      queryStringParameters: { codmarket: '3109' },
      criteria: { codmarket: '3110' },
    });
    expect(mockRepository.getSessionData).toHaveBeenCalledWith('3110');
  });

  it('queryStringParameters/criteria hanno priorita\' su pathParameters', async () => {
    mockRepository.getSessionData.mockResolvedValue({});
    await handler({
      pathParameters: { codmarket: '3110' },
      queryStringParameters: { codmarket: '3109' },
    });
    expect(mockRepository.getSessionData).toHaveBeenCalledWith('3109');
  });

  it('ritorna 404 quando il repository lancia SessionNotFoundError', async () => {
    mockRepository.getSessionData.mockRejectedValue(new SessionNotFoundError('9999'));
    const res = await handler({ criteria: { codmarket: '9999' } });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  it('ritorna 502 su errore generico del repository', async () => {
    mockRepository.getSessionData.mockRejectedValue(new Error('S3 unreachable'));
    const res = await handler({ criteria: { codmarket: '1000' } });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).message).toBe('S3 unreachable');
  });

  it('ritorna 502 con messaggio stringificato quando l\'errore non ha "message"', async () => {
    mockRepository.getSessionData.mockRejectedValue('boom');
    const res = await handler({ criteria: { codmarket: '1000' } });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).message).toBe('boom');
  });

  it('la risposta ha header Content-Type: application/json', async () => {
    mockRepository.getSessionData.mockResolvedValue({});
    const res = await handler({});
    expect(res.headers['Content-Type']).toBe('application/json');
  });

  it('con username usa MyPeopleDmsSessionRepository invece di S3SessionRepository', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({ codmarket: '1000', sincom: '0073741' });
    const res = await handler({ queryStringParameters: { username: '0073741.d235' } });

    expect(mockMyPeopleDmsRepository.getSessionData).toHaveBeenCalledWith('0073741.d235');
    expect(mockRepository.getSessionData).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ codmarket: '1000', sincom: '0073741' });
  });

  it('legge username da event.criteria (invocazione diretta)', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({});
    await handler({ criteria: { username: '0073741.d235' } });
    expect(mockMyPeopleDmsRepository.getSessionData).toHaveBeenCalledWith('0073741.d235');
  });

  it('legge username da pathParameters quando assente altrove', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({});
    await handler({ pathParameters: { username: '0073741.d235' } });
    expect(mockMyPeopleDmsRepository.getSessionData).toHaveBeenCalledWith('0073741.d235');
  });

  it('username ha priorita\' su codmarket quando entrambi presenti', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockResolvedValue({});
    await handler({ queryStringParameters: { username: '0073741.d235', codmarket: '3109' } });
    expect(mockMyPeopleDmsRepository.getSessionData).toHaveBeenCalledWith('0073741.d235');
    expect(mockRepository.getSessionData).not.toHaveBeenCalled();
  });

  it('ritorna 404 quando MyPeopleDmsSessionRepository lancia SessionNotFoundError', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockRejectedValue(
      new SessionNotFoundError('0073741.d235', "l'utente")
    );
    const res = await handler({ criteria: { username: '0073741.d235' } });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  it('ritorna 502 su errore generico di MyPeopleDmsSessionRepository (es. dms irraggiungibile)', async () => {
    mockMyPeopleDmsRepository.getSessionData.mockRejectedValue(new Error('dms unreachable'));
    const res = await handler({ criteria: { username: '0073741.d235' } });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).message).toBe('dms unreachable');
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
