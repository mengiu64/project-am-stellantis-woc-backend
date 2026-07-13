'use strict';

const { SessionNotFoundError } = require('../src/errors');

describe('SessionNotFoundError', () => {
  it('imposta message, name e code coerenti con il mercato richiesto', () => {
    const err = new SessionNotFoundError('9999');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Dati di sessione non trovati per il mercato "9999"');
    expect(err.name).toBe('SessionNotFoundError');
    expect(err.code).toBe('SESSION_NOT_FOUND');
  });
});
