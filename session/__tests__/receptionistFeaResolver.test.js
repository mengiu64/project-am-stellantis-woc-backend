'use strict';

jest.mock('../../serviceClient', () => ({ callService: jest.fn() }), { virtual: true });

const { callService } = require('../../serviceClient');
const { resolveReceptionistFEA } = require('../src/receptionistFeaResolver');

const SIGN = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

describe('session/src/receptionistFeaResolver — resolveReceptionistFEA', () => {
  beforeEach(() => callService.mockReset());

  it('per un dealer legge la firma via REST dbmanager/getDealerSign con lo username', async () => {
    callService.mockResolvedValue(SIGN);

    expect(await resolveReceptionistFEA({ username: '0073741.d235', dealer: 1 })).toBe(SIGN);
    expect(callService).toHaveBeenCalledWith('dbmanager', 'getDealerSign', {
      args: [{ username: '0073741.d235' }],
    });
  });

  it('ritorna null se il dealer non ha ancora salvato una firma', async () => {
    callService.mockResolvedValue(null);

    expect(await resolveReceptionistFEA({ username: '0073741.d235', dealer: 1 })).toBeNull();
  });

  it('gli errori HTTP REST sono loggati e ritornano null', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    callService.mockRejectedValue(new Error('HTTP 503'));

    expect(await resolveReceptionistFEA({ username: '0073741.d235', dealer: 1 })).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
    errorSpy.mockRestore();
  });

  it('per un utente HQ (dealer=0) ritorna null senza eseguire la query', async () => {
    const fetchDealerSignFn = jest.fn();

    expect(await resolveReceptionistFEA({ username: 'SF48816', dealer: 0 }, fetchDealerSignFn)).toBeNull();
    expect(fetchDealerSignFn).not.toHaveBeenCalled();
    expect(callService).not.toHaveBeenCalled();
  });

  it('ritorna null senza eseguire la query se username e\' assente', async () => {
    const fetchDealerSignFn = jest.fn();

    expect(await resolveReceptionistFEA({ dealer: 1 }, fetchDealerSignFn)).toBeNull();
    expect(fetchDealerSignFn).not.toHaveBeenCalled();
  });

  it('usa fetchDealerSignFn iniettata e normalizza undefined a null', async () => {
    const fetchDealerSignFn = jest.fn().mockResolvedValueOnce(SIGN).mockResolvedValueOnce(undefined);

    expect(await resolveReceptionistFEA({ username: '0073741.d235', dealer: 1 }, fetchDealerSignFn)).toBe(SIGN);
    expect(await resolveReceptionistFEA({ username: '0073741.d235', dealer: 1 }, fetchDealerSignFn)).toBeNull();
    expect(fetchDealerSignFn).toHaveBeenCalledWith({ username: '0073741.d235' });
    expect(callService).not.toHaveBeenCalled();
  });

  it('chiamata senza argomenti ritorna null', async () => {
    expect(await resolveReceptionistFEA()).toBeNull();
    expect(callService).not.toHaveBeenCalled();
  });
});
