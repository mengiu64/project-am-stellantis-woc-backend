'use strict';

const { TranslationsRepository } = require('../../src/repositories/TranslationsRepository');

describe('TranslationsRepository (interfaccia astratta)', () => {
  test('getTranslations throws "non implementato" by default', async () => {
    const repo = new TranslationsRepository();
    await expect(repo.getTranslations('en')).rejects.toThrow('non implementato');
  });
});
