'use strict';

// Verifica che, in assenza di override iniettati nel costruttore, la repository
// carichi (lazy) i moduli reali di myPeople/dms tramite require(path.resolve(...)),
// esattamente come farebbe in produzione (Lambda con SessionFunction impacchettata
// con myPeople/ e dms/ come cartelle sorelle — vedi Makefile). I moduli reali
// vengono qui sostituiti con dei mock (stesso percorso relativo, stessa profondità
// di cartelle di src/repositories/myPeopleDmsSessionRepository.js rispetto alla
// root del repo) per non dipendere da AWS/Secrets Manager/rete in questo test.
jest.mock('../../../myPeople/myPeopleService', () => ({
  readUserProfiles: jest.fn().mockResolvedValue({
    Response: {
      RC: '0',
      STATUS: 'SUCCESS',
      User: {
        Attributes: { MARKETCODE: '1000', MAINSINCOM: '0073741', NATIONiso2: 'IT', USERTYPE: 'DEALER' },
        OICs: [{ CODE: '00007584', BRANDS: '00,77,66,57,70,83', MAIN: 'Y' }],
      },
    },
  }),
}));

jest.mock('../../../dms/authService', () => ({
  getBearerToken: jest.fn().mockResolvedValue('***TOKEN***'),
}));

jest.mock('../../../dms/dmsService', () => ({
  getDmsSettings: jest.fn().mockResolvedValue({ success: true, data: [] }),
  getCompanyTypes: jest.fn().mockResolvedValue({ success: true, data: [] }),
  getCustomerTitles: jest.fn().mockResolvedValue({ success: true, data: [] }),
}));

const { MyPeopleDmsSessionRepository } = require('../../src/repositories/myPeopleDmsSessionRepository');
const myPeopleService = require('../../../myPeople/myPeopleService');
const dmsAuthService = require('../../../dms/authService');
const dmsService = require('../../../dms/dmsService');

describe('MyPeopleDmsSessionRepository — lazy loading dei moduli reali (myPeople/dms)', () => {
  afterEach(() => jest.clearAllMocks());

  test('usa i moduli reali (myPeople/myPeopleService, dms/authService, dms/dmsService) quando non vengono iniettati override', async () => {
    const repository = new MyPeopleDmsSessionRepository();
    const data = await repository.getSessionData('0073741.d235');

    expect(myPeopleService.readUserProfiles).toHaveBeenCalledWith({ username: '0073741.d235' });
    expect(dmsAuthService.getBearerToken).toHaveBeenCalledTimes(1);
    expect(dmsService.getDmsSettings).toHaveBeenCalledWith('***TOKEN***', {
      country: 'it',
      brand: 'FT',
      dealer: '0073741',
    });
    expect(dmsService.getCompanyTypes).toHaveBeenCalledWith('***TOKEN***', { country: 'it', language: 'it' });
    expect(dmsService.getCustomerTitles).toHaveBeenCalledWith('***TOKEN***', { country: 'it', language: 'it' });
    expect(data.codmarket).toBe('1000');
    expect(data.sincom).toBe('0073741');
    expect(data.brandvehic_reftech).toBe('FT');
    expect(data.companytypes).toEqual([]);
    expect(data.customertitles).toEqual([]);
  });

  test('riusa i moduli già caricati (cache) su una seconda chiamata', async () => {
    const repository = new MyPeopleDmsSessionRepository();
    await repository.getSessionData('0073741.d235');
    await repository.getSessionData('0073741.d235');

    // require() viene invocato una sola volta grazie alla cache lazy interna,
    // ma la funzione risolta viene comunque chiamata ad ogni getSessionData().
    expect(myPeopleService.readUserProfiles).toHaveBeenCalledTimes(2);
  });
});
