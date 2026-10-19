'use strict';

const { TranslationsDbRepository, buildUpsertSql } = require('../../src/repositories/TranslationsDbRepository');

jest.mock('../../shared/dbClient', () => ({ getPool: jest.fn() }));
const { getPool } = require('../../shared/dbClient');

function makePool(queryImpl) {
  const client = { query: jest.fn(queryImpl), release: jest.fn() };
  return { client, pool: { connect: jest.fn().mockResolvedValue(client), query: jest.fn() } };
}

const ROWS = [
  { path: 'a.b', language: 'en', context: 'a', translation: 'X' },
  { path: 'a.b', language: 'de', context: 'a', translation: '[a.b]' },
];

describe('upsertRows', () => {
  test('esegue BEGIN, un upsert per gruppo (en / derivate), COMMIT e conta insert/update', async () => {
    const { client, pool } = makePool(async (sql) => {
      if (sql.startsWith('INSERT') && sql.includes('translation = EXCLUDED.translation')) return { rows: [{ inserted: true }] };
      if (sql.startsWith('INSERT')) return { rows: [{ inserted: false }] };
      return { rows: [] };
    });
    const out = await new TranslationsDbRepository({ pool }).upsertRows(ROWS);
    expect(out).toEqual({ inserted: 1, updated: 1 });
    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(sqls.some((s) => /DELETE/i.test(s))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  test('salta i gruppi vuoti', async () => {
    const { client, pool } = makePool(async () => ({ rows: [] }));
    await new TranslationsDbRepository({ pool }).upsertRows([ROWS[0]]);
    expect(client.query).toHaveBeenCalledTimes(3); // BEGIN, upsert en, COMMIT
  });

  test('errore: ROLLBACK, release e rilancio', async () => {
    const { client, pool } = makePool(async (sql) => {
      if (sql.startsWith('INSERT')) throw new Error('db down');
      return { rows: [] };
    });
    await expect(new TranslationsDbRepository({ pool }).upsertRows(ROWS)).rejects.toThrow('db down');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  test('errore anche nel ROLLBACK: l\'errore originale viene comunque rilanciato', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { pool } = makePool(async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('rollback ko');
      if (sql.startsWith('INSERT')) throw new Error('db down');
      return { rows: [] };
    });
    await expect(new TranslationsDbRepository({ pool }).upsertRows(ROWS)).rejects.toThrow('db down');
    jest.restoreAllMocks();
  });

  test('suddivide in batch', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ path: `p${i}`, language: 'en', context: 'p', translation: 't' }));
    const { client, pool } = makePool(async () => ({ rows: [] }));
    await new TranslationsDbRepository({ pool }).upsertRows(many);
    expect(client.query).toHaveBeenCalledTimes(5); // BEGIN + 3 batch + COMMIT
  });
});

describe('buildUpsertSql', () => {
  test('lingua derivata: aggiorna solo il context', () => {
    expect(buildUpsertSql(false)).toContain('SET context = EXCLUDED.context');
    expect(buildUpsertSql(false)).not.toContain('translation = EXCLUDED.translation');
  });
});

describe('letture', () => {
  test('findByLanguage', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ path: 'a' }] }) };
    expect(await new TranslationsDbRepository({ pool }).findByLanguage('en')).toEqual([{ path: 'a' }]);
    expect(pool.query.mock.calls[0][1]).toEqual(['en']);
  });

  test('findByFilters costruisce i filtri in AND con soli parametri', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await new TranslationsDbRepository({ pool }).findByFilters({ path: 'shell', language: 'en', context: 'shell' });
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toEqual(['shell', 'en', 'shell']);
    expect(sql).toContain('starts_with(path, $1');
    expect(sql).toContain('AND language = $2');
    expect(sql).toContain('AND context = $3');
  });

  test('findByFilters con un solo filtro', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await new TranslationsDbRepository({ pool }).findByFilters({ language: 'it' });
    expect(pool.query.mock.calls[0][1]).toEqual(['it']);
  });

  test('usa il pool di dbClient se non iniettato', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    getPool.mockResolvedValue(pool);
    await new TranslationsDbRepository().findByLanguage('en');
    expect(getPool).toHaveBeenCalled();
  });
});
