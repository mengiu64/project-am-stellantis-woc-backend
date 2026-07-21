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

  it('accetta un\'etichetta custom (es. per lo username)', () => {
    const err = new SessionNotFoundError('0073741.d235', "l'utente");
    expect(err.message).toBe('Dati di sessione non trovati per l\'utente "0073741.d235"');
    expect(err.name).toBe('SessionNotFoundError');
    expect(err.code).toBe('SESSION_NOT_FOUND');
  });
});
