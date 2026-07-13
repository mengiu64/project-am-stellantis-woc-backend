'use strict';

const { SessionRepository } = require('../../src/repositories/sessionRepository');

describe('SessionRepository (interfaccia base)', () => {
  it('getSessionData lancia un errore "non implementato"', async () => {
    const repository = new SessionRepository();
    await expect(repository.getSessionData('1000')).rejects.toThrow(
      'getSessionData(codmarket) non implementato'
    );
  });
});
