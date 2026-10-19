'use strict';

const { parseRequestParams, validateLanguage, validateText } = require('../../src/utils/requestParams');
const { response, errorResponse } = require('../../src/utils/httpResponse');
const { ValidationError, NoTranslationsFoundError, TranslationNotFoundError } = require('../../src/errors');

describe('parseRequestParams', () => {
  test('unisce query, body e params', () => {
    expect(parseRequestParams({ queryStringParameters: { a: '1' }, body: '{"b":"2"}', params: { c: '3' } }))
      .toEqual({ a: '1', b: '2', c: '3' });
  });
  test('body oggetto gia parsato', () => {
    expect(parseRequestParams({ body: { b: 1 } })).toEqual({ b: 1 });
  });
  test('evento vuoto', () => {
    expect(parseRequestParams(undefined)).toEqual({});
  });
  test('body non JSON -> ValidationError', () => {
    expect(() => parseRequestParams({ body: '{x' })).toThrow(ValidationError);
  });
  test('body non oggetto -> ValidationError', () => {
    expect(() => parseRequestParams({ body: '[1]' })).toThrow(ValidationError);
    expect(() => parseRequestParams({ body: 'null' })).toThrow(ValidationError);
  });
});

describe('validateLanguage', () => {
  test('valori validi', () => {
    expect(validateLanguage(' en ', true)).toBe('en');
    expect(validateLanguage('pt-BR', false)).toBe('pt-BR');
  });
  test('assente: undefined se opzionale, errore se obbligatorio', () => {
    expect(validateLanguage(undefined, false)).toBeUndefined();
    expect(validateLanguage('', false)).toBeUndefined();
    expect(() => validateLanguage(null, true)).toThrow(ValidationError);
  });
  test('valori non validi', () => {
    expect(() => validateLanguage('english-long', false)).toThrow(ValidationError);
    expect(() => validateLanguage("en'; DROP", false)).toThrow(ValidationError);
    expect(() => validateLanguage(['en'], false)).toThrow(ValidationError);
  });
});

describe('validateText', () => {
  test('normalizza e valida', () => {
    expect(validateText(' shell ', 'context', 512)).toBe('shell');
    expect(validateText(undefined, 'context', 512)).toBeUndefined();
    expect(validateText('   ', 'context', 512)).toBeUndefined();
    expect(() => validateText(5, 'context', 512)).toThrow(ValidationError);
    expect(() => validateText('x'.repeat(513), 'context', 512)).toThrow(ValidationError);
  });
});

describe('httpResponse', () => {
  let logSpy; let errSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('response serializza il body', () => {
    expect(response(200, { a: 1 })).toEqual({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
  });
  test('mappa 400, 404 e 500 senza mai usare 401/403', () => {
    expect(errorResponse(new ValidationError('x'), 'op').statusCode).toBe(400);
    expect(errorResponse(new NoTranslationsFoundError(), 'op').statusCode).toBe(404);
    expect(errorResponse(new TranslationNotFoundError('xx'), 'op').statusCode).toBe(404);
    const r = errorResponse(new Error('password=secret'), 'op');
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain('secret');
    expect(errSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });
  test('errore non-Error -> 500', () => {
    expect(errorResponse('boom', 'op').statusCode).toBe(500);
    expect(errorResponse(null, 'op').statusCode).toBe(500);
  });
});
