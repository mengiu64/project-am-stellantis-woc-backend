'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('axios');

const axios = require('axios');

process.env.MENUPRICING_WSDL = 'https://menupricing.test';
process.env.MENUPRICING_USR = 'usr';
process.env.MENUPRICING_PWS = 'pws';
process.env.MENUPRICING_USR_REQ = 'usrreq';
process.env.MENUPRICING_PWS_REQ = 'pwsreq';

const { MenuPricingSoapClient } = require('../MenuPricingSoapClient');

function soapEnvelope(innerXml) {
  return `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${innerXml}</soap:Body></soap:Envelope>`;
}

function plainEnvelope(innerXml) {
  return `<Envelope><Body>${innerXml}</Body></Envelope>`;
}

describe('MenuPricingSoapClient', () => {
  let client;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DEBUG_SOAP;
    client = new MenuPricingSoapClient();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('getJobs returns indexed jobs for a successful response', async () => {
    process.env.DEBUG_SOAP = '1';
    axios.post.mockResolvedValue({
      data: soapEnvelope(`
        <getJobsResponse>
          <jobsResponse>
            <status state="2" description="OK"/>
            <jobHierarchy>
              <operation description="Oil change" id="OP1">
                <job id="JOB001" description="Oil change"/>
              </operation>
            </jobHierarchy>
          </jobsResponse>
        </getJobsResponse>
      `),
    });

    const result = await client.getJobs({
      languageCode: 'it',
      countryCode: 'IT',
      dealerIdentificationCode: '001',
      manufacturer: 'FT',
      vin: 'VIN123',
    });

    expect(result).toEqual({
      success: true,
      data: {
        JOB001: { codice: 'JOB001', descrizione: 'Oil change' },
      },
      message: '',
    });
    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://menupricing.test/Menus');
    expect(body).toContain('<vinMatch>VIN123</vinMatch>');
    expect(body).toContain('<pocFilter value="true"/>');
    expect(body).toContain('user="usrreq"');
    expect(config.headers.SOAPAction).toBe('"getJobs"');
    expect(logSpy).toHaveBeenCalled();
  });

  test('getJobs returns failure when status description is not OK', async () => {
    axios.post.mockResolvedValue({
      data: soapEnvelope('<getJobsResponse><jobsResponse><status state="9" description="KO"/></jobsResponse></getJobsResponse>'),
    });

    await expect(client.getJobs({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'KO',
    });
  });

  test('getJobs returns failure when getJobsResponse is missing', async () => {
    axios.post.mockResolvedValue({ data: '<Envelope />' });

    await expect(client.getJobs({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'No getJobsResponse found',
    });
  });

  test('getJobs recursively parses nested operations and ignores empty operations', async () => {
    axios.post.mockResolvedValue({
      data: soapEnvelope(`
        <getJobsResponse>
          <jobsResponse>
            <status state="2" description="OK"/>
            <jobHierarchy>
              <operation description="Container" id="OP0">
                <operation description="Brakes" id="OP2">
                  <job id="JOB002" description="Pads"/>
                </operation>
              </operation>
              <operation description="Ignore me" id="OPX"/>
            </jobHierarchy>
          </jobsResponse>
        </getJobsResponse>
      `),
    });

    const result = await client.getJobs({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123' });

    expect(result).toEqual({
      success: true,
      data: {
        JOB002: { codice: 'JOB002', descrizione: 'Brakes' },
      },
      message: '',
    });
  });

  test('getJobs falls back to job description and skips rows without a code', async () => {
    axios.post.mockResolvedValue({
      data: soapEnvelope(`
        <getJobsResponse>
          <jobsResponse>
            <status state="2" description="OK"/>
            <jobHierarchy>
              <operation id="OP3">
                <job id="JOB003" description="From job"/>
              </operation>
              <operation>
                <job description="Ignored"/>
              </operation>
            </jobHierarchy>
          </jobsResponse>
        </getJobsResponse>
      `),
    });

    const result = await client.getJobs({
      languageCode: 'it',
      countryCode: 'IT',
      dealerIdentificationCode: '001',
      manufacturer: undefined,
      vin: 'VIN123',
    });

    expect(result).toEqual({
      success: true,
      data: {
        JOB003: { codice: 'JOB003', descrizione: 'From job' },
      },
      message: '',
    });
    const [, body] = axios.post.mock.calls[0];
    expect(body).not.toContain('manufacturer=');
  });

  test('getJobs returns unknown error when status description is missing', async () => {
    axios.post.mockResolvedValue({
      data: plainEnvelope('<getJobsResponse><jobsResponse><status state="9"/></jobsResponse></getJobsResponse>'),
    });

    await expect(client.getJobs({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'Unknown error',
    });
  });

  test('getJobDetails returns transformed detail data for a MAN job with Lex promotion', async () => {
    axios.post.mockResolvedValue({
      data: soapEnvelope(`
        <getJobDetailsResponse>
          <jobDetailsResponse>
            <status state="1" description="OK" vehicleFileVersion="1.0"/>
            <job id="JOB001" description="Oil Change" jobSource="MAN" jobDifficulty="1">
              <promotion description="Lex" priceExcl="99.99"/>
              <labours>
                <labour id="LAB001" description="Labour desc" asDTUs="30"/>
              </labours>
              <partsList>
                <part partNumber="P001" partDescription="Part desc" quantity="1" priceExcl="25.00" altPartNumber="ALT001"/>
              </partsList>
            </job>
          </jobDetailsResponse>
        </getJobDetailsResponse>
      `),
    });

    const result = await client.getJobDetails({
      languageCode: 'it',
      countryCode: 'IT',
      dealerIdentificationCode: '001',
      manufacturer: 'FT',
      vin: 'VIN123',
      id: 'JOB001',
    });

    expect(result).toEqual({
      success: true,
      data: {
        codice: 'JOB001',
        descrizione: 'Oil Change',
        pkPrice: '99.99',
        isFixedPrice: '1',
        listaOperazioni: [
          expect.objectContaining({
            TYPE: 'OP',
            POSIZIONE: expect.stringMatching(/^!/),
            COD: 'LAB001',
            DESCR: 'Labour desc',
            TIME: '30',
            SELECTED: true,
          }),
        ],
        listaRicambi: [
          expect.objectContaining({
            TYPE: 'SP',
            POSIZIONE: 'ALT001',
            COD: 'P001',
            DESCR: 'Part desc',
            QTY: '1',
            PRICE: '25.00',
            SELECTED: true,
          }),
        ],
      },
      message: '',
    });
    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://menupricing.test/SecuredMenus');
    expect(body).toContain('id="JOB001"');
    expect(config.headers.SOAPAction).toBe('"getJobDetails"');
  });

  test('getJobDetails falls back when no MAN job exists', async () => {
    axios.post.mockResolvedValue({
      data: soapEnvelope(`
        <getJobDetailsResponse>
          <jobDetailsResponse>
            <status state="1" description="OK" vehicleFileVersion="1.0"/>
            <job id="JOB002" description="Brake Job" jobSource="OTHER" jobDifficulty="1">
              <labours></labours>
              <partsList></partsList>
            </job>
          </jobDetailsResponse>
        </getJobDetailsResponse>
      `),
    });

    const result = await client.getJobDetails({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123', id: 'JOB002' });

    expect(result).toEqual({
      success: true,
      data: {
        codice: 'JOB002',
        descrizione: 'Brake Job',
        pkPrice: 0,
        isFixedPrice: '0',
        listaOperazioni: [],
        listaRicambi: [],
      },
      message: '',
    });
  });

  test('getJobDetails returns failure when status is not OK', async () => {
    axios.post.mockResolvedValue({
      data: soapEnvelope('<getJobDetailsResponse><jobDetailsResponse><status state="3" description="FAIL" vehicleFileVersion="9.9"/></jobDetailsResponse></getJobDetailsResponse>'),
    });

    await expect(client.getJobDetails({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123', id: 'JOB001' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'Errore getting Menupricing.getJobDetails FAIL 3 9.9',
    });
  });

  test('getJobDetails trims missing state and version from the error message', async () => {
    axios.post.mockResolvedValue({
      data: plainEnvelope('<getJobDetailsResponse><jobDetailsResponse><status description="FAIL"/></jobDetailsResponse></getJobDetailsResponse>'),
    });

    await expect(client.getJobDetails({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123', id: 'JOB001' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'Errore getting Menupricing.getJobDetails FAIL',
    });
  });

  test('getJobDetails returns failure when job is missing', async () => {
    axios.post.mockResolvedValue({
      data: soapEnvelope('<getJobDetailsResponse><jobDetailsResponse><status state="1" description="OK" vehicleFileVersion="1.0"/></jobDetailsResponse></getJobDetailsResponse>'),
    });

    await expect(client.getJobDetails({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123', id: 'JOB001' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'No job in response',
    });
  });

  test('getJobDetails returns failure when getJobDetailsResponse is missing', async () => {
    axios.post.mockResolvedValue({ data: plainEnvelope('') });

    await expect(client.getJobDetails({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123', id: 'JOB001' })).resolves.toEqual({
      success: false,
      data: null,
      message: 'No getJobDetailsResponse found',
    });
  });

  test('getJobDetails uses random part position when altPartNumber is 000000', async () => {
    axios.post.mockResolvedValue({
      data: soapEnvelope(`
        <getJobDetailsResponse>
          <jobDetailsResponse>
            <status state="1" description="OK" vehicleFileVersion="1.0"/>
            <job id="JOB003" description="Tyres" jobSource="MAN" jobDifficulty="1">
              <partsList>
                <part partNumber="P002" partDescription="Tyre" quantity="2" priceExcl="10.00" altPartNumber="000000"/>
              </partsList>
            </job>
          </jobDetailsResponse>
        </getJobDetailsResponse>
      `),
    });

    const result = await client.getJobDetails({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123', id: 'JOB003' });

    expect(result.success).toBe(true);
    expect(result.data.listaRicambi[0].POSIZIONE).toMatch(/^!/);
  });

  test('getJobDetails ignores promotions that are not Lex', async () => {
    axios.post.mockResolvedValue({
      data: soapEnvelope(`
        <getJobDetailsResponse>
          <jobDetailsResponse>
            <status state="1" description="OK" vehicleFileVersion="1.0"/>
            <job id="JOB004" description="Wash" jobSource="MAN" jobDifficulty="1">
              <promotion description="Other" priceExcl="77.77"/>
            </job>
          </jobDetailsResponse>
        </getJobDetailsResponse>
      `),
    });

    const result = await client.getJobDetails({ languageCode: 'it', countryCode: 'IT', dealerIdentificationCode: '001', manufacturer: 'FT', vin: 'VIN123', id: 'JOB004' });

    expect(result).toEqual({
      success: true,
      data: {
        codice: 'JOB004',
        descrizione: 'Wash',
        pkPrice: 0,
        isFixedPrice: '0',
        listaOperazioni: [],
        listaRicambi: [],
      },
      message: '',
    });
  });
});
