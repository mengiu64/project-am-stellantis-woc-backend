'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('axios');

const axios = require('axios');

process.env.EPER_HOST = 'eper.test';

const { WsIQPckEper } = require('../WsIQPckEper');

function escape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function soapEnvelope(innerXml) {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><ns2:putResponse xmlns:ns2="http://service.dms.keytech.it/"><return>${escape(innerXml)}</return></ns2:putResponse></soapenv:Body></soapenv:Envelope>`;
}

function emptySoapEnvelope() {
  return '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><ns2:putResponse xmlns:ns2="http://service.dms.keytech.it/"><return/></ns2:putResponse></soapenv:Body></soapenv:Envelope>';
}

function okStatus() {
  return '<dms:status><dms:success>1</dms:success></dms:status>';
}

function messageWith(responseName, content) {
  return `<dms:MESSAGE><dms:CONTENT><dms:${responseName}>${content}</dms:${responseName}></dms:CONTENT></dms:MESSAGE>`;
}

describe('WsIQPckEper', () => {
  let client;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DEBUG_SOAP;
    client = new WsIQPckEper({ coddealer: '001', codmarket: 'IT' });
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('constructor stores coddealer and codmarket', () => {
    expect(client.coddealer).toBe('001');
    expect(client.codmarket).toBe('IT');
  });

  test('getGroupsPRRequest uses VIN path and returns single gruppo', async () => {
    process.env.DEBUG_SOAP = '1';
    const innerXml = messageWith(
      'getGroupsPRResponse',
      `${okStatus()}<dms:gruppi><dms:gruppo><dms:codiceGruppo>01</dms:codiceGruppo></dms:gruppo></dms:gruppi>`
    );
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    const result = await client.getGroupsPRRequest({ ticket: 'TK', lingua: 'it', VIN: 'VIN123456789' });

    expect(result).toEqual([{ codiceGruppo: '01' }]);
    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://eper.test/DMSConnectorService');
    expect(body).toContain('VIN=&quot;VIN123456789&quot;');
    expect(body).not.toContain('modello=');
    expect(config.timeout).toBe(20000);
    expect(config.headers['Content-Type']).toBe('text/xml;charset=UTF-8');
    expect(logSpy).toHaveBeenCalled();
  });

  test('getGroupsPRRequest uses modello/telaio path and returns multiple gruppi', async () => {
    const innerXml = messageWith(
      'getGroupsPRResponse',
      `${okStatus()}<dms:gruppi><dms:gruppo><dms:codiceGruppo>01</dms:codiceGruppo></dms:gruppo><dms:gruppo><dms:codiceGruppo>02</dms:codiceGruppo></dms:gruppo></dms:gruppi>`
    );
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    const result = await client.getGroupsPRRequest({ ticket: 'TK', lingua: 'it', modello: 'MODEL', telaio: 'TELAIO' });

    expect(result).toEqual([{ codiceGruppo: '01' }, { codiceGruppo: '02' }]);
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('modello=&quot;MODEL&quot; telaio=&quot;TELAIO&quot;');
    expect(body).not.toContain('VIN=&quot;');
  });

  test('getGroupsPRRequest returns MESSAGE error attributes', async () => {
    axios.post.mockResolvedValue({
      data: soapEnvelope('<dms:MESSAGE ErrorCode="100" ErrorDescription="Auth failed"><dms:CONTENT/></dms:MESSAGE>'),
    });

    await expect(client.getGroupsPRRequest({ lingua: 'it', VIN: 'VIN123' })).resolves.toEqual({
      error: { exitCode: '100', errorMessage: 'Auth failed' },
    });
  });

  test('getGroupsPRRequest returns status error when success is zero', async () => {
    const innerXml = messageWith(
      'getGroupsPRResponse',
      '<dms:status><dms:success>0</dms:success><dms:exitCode>50</dms:exitCode><dms:errorMessage>Not found</dms:errorMessage></dms:status>'
    );
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    await expect(client.getGroupsPRRequest({ lingua: 'it', VIN: 'VIN123' })).resolves.toEqual({
      error: { exitCode: '50', errorMessage: 'Not found' },
    });
  });

  test('getGroupsPRRequest returns timeout error when SOAP return is empty', async () => {
    axios.post.mockResolvedValue({ data: emptySoapEnvelope() });

    await expect(client.getGroupsPRRequest({ lingua: 'it', VIN: 'VIN123' })).resolves.toEqual({
      error: { exitCode: '-1', errorMessage: 'Timeout (20 sec)' },
    });
  });

  test('getGroupsPRRequest returns parse error on invalid inner XML', async () => {
    axios.post.mockResolvedValue({ data: soapEnvelope('<dms:MESSAGE><dms:CONTENT>') });

    const result = await client.getGroupsPRRequest({ lingua: 'it', VIN: 'VIN123' });
    expect(result.error.exitCode).toBe('-1');
    expect(result.error.errorMessage).toMatch(/XML parse error/);
  });

  test('getGroupsPRRequest returns missing content error', async () => {
    axios.post.mockResolvedValue({ data: soapEnvelope('<dms:MESSAGE><dms:CONTENT></dms:CONTENT></dms:MESSAGE>') });

    await expect(client.getGroupsPRRequest({ lingua: 'it', VIN: 'VIN123' })).resolves.toEqual({
      error: { exitCode: '-1', errorMessage: 'No getGroupsPRResponse found in response' },
    });
  });

  test('getGroupsPRRequest returns empty array when gruppi are missing', async () => {
    const innerXml = messageWith('getGroupsPRResponse', `${okStatus()}<dms:gruppi></dms:gruppi>`);
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    await expect(client.getGroupsPRRequest({ lingua: 'it', VIN: 'VIN123' })).resolves.toEqual([]);
  });

  test('getGroupsPRRequest rethrows axios errors', async () => {
    axios.post.mockRejectedValue(new Error('network down'));

    await expect(client.getGroupsPRRequest({ lingua: 'it', VIN: 'VIN123' })).rejects.toThrow('network down');
  });

  test('getSubgroupsPR uses VIN path and returns sottogruppi', async () => {
    const innerXml = messageWith(
      'getSubgroupsPRResponse',
      `${okStatus()}<dms:sottogruppi><dms:sottogruppo><dms:codiceSottogruppo>10</dms:codiceSottogruppo></dms:sottogruppo></dms:sottogruppi>`
    );
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    const result = await client.getSubgroupsPR({ lingua: 'it', VIN: 'VIN123', codiceGruppo: '01' });

    expect(result).toEqual([{ codiceSottogruppo: '10' }]);
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('VIN=&quot;VIN123&quot; codiceGruppo=&quot;01&quot;');
  });

  test('getSubgroupsPR uses modello/telaio path', async () => {
    const innerXml = messageWith(
      'getSubgroupsPRResponse',
      `${okStatus()}<dms:sottogruppi><dms:sottogruppo><dms:codiceSottogruppo>11</dms:codiceSottogruppo></dms:sottogruppo></dms:sottogruppi>`
    );
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    const result = await client.getSubgroupsPR({ lingua: 'it', modello: 'MODEL', telaio: 'TELAIO', codiceGruppo: '01' });

    expect(result).toEqual([{ codiceSottogruppo: '11' }]);
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('modello=&quot;MODEL&quot; telaio=&quot;TELAIO&quot; codiceGruppo=&quot;01&quot;');
  });

  test('getSubgroupsPR returns empty array when no sottogruppi exist', async () => {
    const innerXml = messageWith('getSubgroupsPRResponse', `${okStatus()}<dms:sottogruppi></dms:sottogruppi>`);
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    await expect(client.getSubgroupsPR({ lingua: 'it', VIN: 'VIN123', codiceGruppo: '01' })).resolves.toEqual([]);
  });

  test('getPackagesPR uses VIN path and returns pacchetti', async () => {
    const innerXml = messageWith(
      'getPackagesPRResponse',
      `${okStatus()}<dms:pacchetti><dms:pacchetto><dms:codicePacchetto>P01</dms:codicePacchetto></dms:pacchetto></dms:pacchetti>`
    );
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    const result = await client.getPackagesPR({ lingua: 'it', VIN: 'VIN123', codiceGruppo: '01', codiceSottogruppo: '10' });

    expect(result).toEqual([{ codicePacchetto: 'P01' }]);
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('VIN=&quot;VIN123&quot; codiceGruppo=&quot;01&quot; codiceSottogruppo=&quot;10&quot;');
  });

  test('getPackagesPR uses modello/telaio path', async () => {
    const innerXml = messageWith(
      'getPackagesPRResponse',
      `${okStatus()}<dms:pacchetti><dms:pacchetto><dms:codicePacchetto>P02</dms:codicePacchetto></dms:pacchetto></dms:pacchetti>`
    );
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    const result = await client.getPackagesPR({ lingua: 'it', modello: 'MODEL', telaio: 'TELAIO', codiceGruppo: '01', codiceSottogruppo: '10' });

    expect(result).toEqual([{ codicePacchetto: 'P02' }]);
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('modello=&quot;MODEL&quot; telaio=&quot;TELAIO&quot; codiceGruppo=&quot;01&quot; codiceSottogruppo=&quot;10&quot;');
  });

  test('getPackagesPR returns empty array when no pacchetti exist', async () => {
    const innerXml = messageWith('getPackagesPRResponse', `${okStatus()}<dms:pacchetti></dms:pacchetti>`);
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    await expect(client.getPackagesPR({ lingua: 'it', VIN: 'VIN123', codiceGruppo: '01', codiceSottogruppo: '10' })).resolves.toEqual([]);
  });

  test('getPackageDetailsPR uses VIN path and returns pacchetto details', async () => {
    const innerXml = messageWith(
      'getPackageDetailsPRResponse',
      `${okStatus()}<dms:pacchetto><dms:codicePacchetto>P01</dms:codicePacchetto><dms:descrizione>Kit</dms:descrizione></dms:pacchetto>`
    );
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    const result = await client.getPackageDetailsPR({
      lingua: 'it',
      VIN: 'VIN123',
      codicePacchetto: 'P01',
      codicePosizione: 'POS',
      codicePosizioneGuida: 'GUIDA',
    });

    expect(result).toEqual({ codicePacchetto: 'P01', descrizione: 'Kit' });
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('VIN=&quot;VIN123&quot; codicePacchetto=&quot;P01&quot; codicePosizione=&quot;POS&quot; codicePosizioneGuida=&quot;GUIDA&quot;');
  });

  test('getPackageDetailsPR uses modello/telaio path', async () => {
    const innerXml = messageWith(
      'getPackageDetailsPRResponse',
      `${okStatus()}<dms:pacchetto><dms:codicePacchetto>P02</dms:codicePacchetto></dms:pacchetto>`
    );
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    const result = await client.getPackageDetailsPR({
      lingua: 'it',
      modello: 'MODEL',
      telaio: 'TELAIO',
      codicePacchetto: 'P02',
      codicePosizione: 'POS',
      codicePosizioneGuida: 'GUIDA',
    });

    expect(result).toEqual({ codicePacchetto: 'P02' });
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('modello=&quot;MODEL&quot; telaio=&quot;TELAIO&quot; codicePacchetto=&quot;P02&quot; codicePosizione=&quot;POS&quot; codicePosizioneGuida=&quot;GUIDA&quot;');
  });

  test('getPackageDetailsPR returns empty object when pacchetto is missing', async () => {
    const innerXml = messageWith('getPackageDetailsPRResponse', `${okStatus()}`);
    axios.post.mockResolvedValue({ data: soapEnvelope(innerXml) });

    await expect(client.getPackageDetailsPR({ lingua: 'it', VIN: 'VIN123', codicePacchetto: 'P01' })).resolves.toEqual({});
  });
});
