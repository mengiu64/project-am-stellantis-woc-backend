'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('axios');

const axios = require('axios');

process.env.DOCSOA_HOST = 'https://api.test.com';
process.env.DOCSOA_USERNAME = 'user';
process.env.DOCSOA_PASSWORD = 'pass';
process.env.DOCSOA_CLIENT_ID = 'client-id';
delete process.env.PROXY_HOST;
delete process.env.PROXY_PORT;

const { DocSOARestClient, vinParts } = require('../DocSOARestClient');

const VALID_BASE64 = Buffer.from('<result><item>test</item></result>').toString('base64');

function soapEnvelope(innerXml) {
  return `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${innerXml}</soap:Body></soap:Envelope>`;
}

describe('DocSOARestClient', () => {
  let client;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DEBUG_SOAP;
    client = new DocSOARestClient();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('vinParts splits the VIN into wmi, vds and vis', () => {
    expect(vinParts('ABCDEFGHIJKLMNOP')).toEqual({
      wmi: 'ABC',
      vds: 'DEFGHI',
      vis: 'JKLMNOP',
    });
  });

  test('functionsService parses functions response and sorts recursive items', async () => {
    process.env.DEBUG_SOAP = '1';
    axios.post.mockResolvedValue({
      status: 200,
      data: soapEnvelope(`
        <getFunctionsResponse>
          <functionsResponse>
            <listFunctions ordreAffichage="2" idFunction="F002" IdFunctionPath="F002" Label="Brakes" imagePath="/img/brakes.jpg" isAvailable="true"/>
            <listFunctions ordreAffichage="1" idFunction="F001" IdFunctionPath="F001" Label="Engine" imagePath="/img/engine.jpg" isAvailable="true">
              <listFunctions ordreAffichage="1" idFunction="F001A" IdFunctionPath="F001/F001A" Label="Oil" imagePath="/img/oil.jpg" isAvailable="true"/>
            </listFunctions>
            <listFunctions idFunction="F000" IdFunctionPath="F000" Label="General" isAvailable="true"/>
            <listFunctions ordreAffichage="3" idFunction="SKIP" IdFunctionPath="SKIP" Label="Hidden" imagePath="/img/hidden.jpg"/>
          </functionsResponse>
        </getFunctionsResponse>
      `),
    });

    const result = await client.functionsService({
      wmi: 'ABC',
      vds: 'DEF123',
      vis: '4567890',
      langue: 'it',
      pays: 'IT',
      marque: 'FT',
      typedoc: ['A', 'B'],
    });

    expect(result).toEqual({
      success: true,
      data: [
        {
          ordreAffichage: undefined,
          idFunction: 'F000',
          IdFunctionPath: 'F000',
          Label: 'General',
          image: '',
          listFunctions: '',
        },
        {
          ordreAffichage: '1',
          idFunction: 'F001',
          IdFunctionPath: 'F001',
          Label: 'Engine',
          image: 'engine.jpg',
          listFunctions: [
            {
              ordreAffichage: '1',
              idFunction: 'F001A',
              IdFunctionPath: 'F001/F001A',
              Label: 'Oil',
              image: 'oil.jpg',
              listFunctions: '',
            },
          ],
        },
        {
          ordreAffichage: '2',
          idFunction: 'F002',
          IdFunctionPath: 'F002',
          Label: 'Brakes',
          image: 'brakes.jpg',
          listFunctions: '',
        },
      ],
    });
    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.test.com/applications/newapvprdocre/ws/functionsService/v1?client_id=client-id');
    expect(body).toContain('<spec:listeTypeDoc>A</spec:listeTypeDoc>');
    expect(body).toContain('<iden:WMI>ABC</iden:WMI>');
    expect(config.proxy).toBe(false);
    expect(config.headers.Authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
    expect(logSpy).toHaveBeenCalled();
  });

  test('functionsService accepts typedoc as a single value', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: soapEnvelope(`
        <getFunctionsResponse>
          <functionsResponse>
            <listFunctions ordreAffichage="1" idFunction="F010" IdFunctionPath="F010" Label="Single" imagePath="/img/single.jpg" isAvailable="true"/>
          </functionsResponse>
        </getFunctionsResponse>
      `),
    });

    const result = await client.functionsService({
      wmi: 'ABC',
      vds: 'DEF123',
      vis: '4567890',
      langue: 'it',
      pays: 'IT',
      marque: 'FT',
      typedoc: 'ONLY',
    });

    expect(result).toEqual({
      success: true,
      data: [
        {
          ordreAffichage: '1',
          idFunction: 'F010',
          IdFunctionPath: 'F010',
          Label: 'Single',
          image: 'single.jpg',
          listFunctions: '',
        },
      ],
    });
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('<spec:listeTypeDoc>ONLY</spec:listeTypeDoc>');
  });

  test('functionsService returns DocSOA error when codeRetour is -1', async () => {
    const rawXml = soapEnvelope('<getFunctionsResponse><functionsResponse><codeRetour>-1</codeRetour></functionsResponse></getFunctionsResponse>');
    axios.post.mockResolvedValue({ status: 200, data: rawXml });

    await expect(client.functionsService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT' })).resolves.toEqual({
      success: false,
      data: rawXml,
      message: 'ERROR from DocSOA: codeRetour -1',
    });
  });

  test('functionsService returns error when listFunctions is missing', async () => {
    axios.post.mockResolvedValue({ status: 200, data: soapEnvelope('<getFunctionsResponse><functionsResponse/></getFunctionsResponse>') });

    await expect(client.functionsService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'listFunctions not found in response',
    });
  });

  test('forfaitService decodes a base64 payload', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: soapEnvelope(`<getForfaitResponse><ForfaitResponse><codeRetour>0</codeRetour><resultat>${VALID_BASE64}</resultat></ForfaitResponse></getForfaitResponse>`),
    });

    const result = await client.forfaitService({
      wmi: 'ABC',
      vds: 'DEF123',
      vis: '4567890',
      langue: 'it',
      pays: 'IT',
      marque: 'FT',
      codePdv: '001',
      fonctionIdListe: ['F001'],
    });

    expect(result).toEqual({ success: true, data: { item: 'test' } });
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('<spec:fonctionIdListe>F001</spec:fonctionIdListe>');
  });

  test('forfaitService returns error when response node is missing', async () => {
    axios.post.mockResolvedValue({ status: 200, data: soapEnvelope('<getForfaitResponse/>') });

    await expect(client.forfaitService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT', codePdv: '001', funzione: 'X' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'ForfaitResponse not found',
    });
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('<spec:fonctionIdListe></spec:fonctionIdListe>');
  });

  test('forfaitService returns DocSOA error details for negative codeRetour', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: soapEnvelope('<getForfaitResponse><ForfaitResponse><codeRetour>-1</codeRetour><error><errorCode>E01</errorCode><errorLabel>Auth error</errorLabel></error></ForfaitResponse></getForfaitResponse>'),
    });

    await expect(client.forfaitService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT', codePdv: '001' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'DocSOA error E01: Auth error',
    });
  });

  test('forfaitService defaults missing codeRetour/resultat to a null success payload', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: soapEnvelope('<getForfaitResponse><ForfaitResponse><resultat></resultat></ForfaitResponse></getForfaitResponse>'),
    });

    await expect(client.forfaitService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT', codePdv: '001' })).resolves.toEqual({
      success: true,
      data: null,
    });
  });

  test('forfaitService defaults missing error details when codeRetour is negative', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: soapEnvelope('<getForfaitResponse><ForfaitResponse><codeRetour>-1</codeRetour></ForfaitResponse></getForfaitResponse>'),
    });

    await expect(client.forfaitService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT', codePdv: '001' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'DocSOA error : ',
    });
  });

  test('ibxDetailForfaitService decodes resultat', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: soapEnvelope(`<getIbxDetailForfaitResponse><ibxdetailforfaitResponse><resultat>${VALID_BASE64}</resultat></ibxdetailforfaitResponse></getIbxDetailForfaitResponse>`),
    });

    const result = await client.ibxDetailForfaitService({
      wmi: 'ABC',
      vds: 'DEF123',
      vis: '4567890',
      langue: 'it',
      pays: 'IT',
      marque: 'FT',
      codeFF: 'FF1',
      codePdv: '001',
      livello: '2',
      livello2: 'unused',
      niveau: '2',
    });

    expect(result).toEqual({ success: true, data: { item: 'test' } });
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('<spec:niveau>2</spec:niveau>');
  });

  test('ibxDetailForfaitService returns error when response node is missing', async () => {
    axios.post.mockResolvedValue({ status: 200, data: soapEnvelope('<getIbxDetailForfaitResponse/>') });

    await expect(client.ibxDetailForfaitService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT', codeFF: 'FF1', codePdv: '001' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'ibxdetailforfaitResponse not found',
    });
  });

  test('ibxDetailForfaitService returns success with empty resultat message', async () => {
    axios.post.mockResolvedValue({ status: 200, data: soapEnvelope('<getIbxDetailForfaitResponse><ibxdetailforfaitResponse><resultat></resultat></ibxdetailforfaitResponse></getIbxDetailForfaitResponse>') });

    await expect(client.ibxDetailForfaitService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT', codeFF: 'FF1', codePdv: '001' })).resolves.toEqual({
      success: true,
      data: null,
      message: 'Empty resultat',
    });
  });

  test('ibxParametrageService decodes resultat', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: soapEnvelope(`<getIbxParametrageResponse><ibxparametrageResponse><resultat>${VALID_BASE64}</resultat></ibxparametrageResponse></getIbxParametrageResponse>`),
    });

    const result = await client.ibxParametrageService({
      wmi: 'ABC',
      vds: 'DEF123',
      vis: '4567890',
      langue: 'it',
      pays: 'IT',
      marque: 'FT',
      FonctionIdListe: ['F001'],
    });

    expect(result).toEqual({ success: true, data: { item: 'test' } });
    const [, body] = axios.post.mock.calls[0];
    expect(body).toContain('<spec:FonctionIdListe>F001</spec:FonctionIdListe>');
  });

  test('ibxParametrageService returns error when response node is missing', async () => {
    axios.post.mockResolvedValue({ status: 200, data: soapEnvelope('<getIbxParametrageResponse/>') });

    await expect(client.ibxParametrageService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'ibxparametrageResponse not found',
    });
  });

  test('ibxParametrageService throws on HTTP status outside success range', async () => {
    axios.post.mockResolvedValue({ status: 500, data: '<error>boom</error>' });

    await expect(client.ibxParametrageService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT' })).rejects.toThrow('HTTP 500: <error>boom</error>');
  });

  test('ibxDetailtpService decodes resultat and passes IBM client header', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: soapEnvelope(`<getIbxDetailTpResponse><ibxdetailtpResponse><resultat>${VALID_BASE64}</resultat></ibxdetailtpResponse></getIbxDetailTpResponse>`),
    });

    const result = await client.ibxDetailtpService({
      wmi: 'ABC',
      vds: 'DEF123',
      vis: '4567890',
      langue: 'it',
      pays: 'IT',
      marque: 'FT',
      refTp: 'TP1',
      codePdv: '001',
    });

    expect(result).toEqual({ success: true, data: { item: 'test' } });
    const [, , config] = axios.post.mock.calls[0];
    expect(config.headers['X-IBM-Client-Id']).toBe('client-id');
  });

  test('ibxDetailtpService returns error when response node is missing', async () => {
    axios.post.mockResolvedValue({ status: 200, data: soapEnvelope('<getIbxDetailTpResponse/>') });

    await expect(client.ibxDetailtpService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT', refTp: 'TP1', codePdv: '001' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'ibxdetailtpResponse not found',
    });
  });

  test('ibxDetailtpService returns error when resultat is empty', async () => {
    axios.post.mockResolvedValue({ status: 200, data: soapEnvelope('<getIbxDetailTpResponse><ibxdetailtpResponse><resultat></resultat></ibxdetailtpResponse></getIbxDetailTpResponse>') });

    await expect(client.ibxDetailtpService({ wmi: 'ABC', vds: 'DEF123', vis: '4567890', langue: 'it', pays: 'IT', marque: 'FT', refTp: 'TP1', codePdv: '001' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'Empty resultat in ibxDetailtpResponse',
    });
  });
});
