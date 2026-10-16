'use strict';

const { getDealerSign } = require('../DealerSignRepository');

function makePool(queryImpl) {
  return { query: jest.fn(queryImpl) };
}

describe('DealerSignRepository', () => {
  describe('getDealerSign', () => {
    it('throws when username is missing', async () => {
      const pool = makePool();
      await expect(getDealerSign(pool, {})).rejects.toThrow('"username" is required');
      await expect(getDealerSign(pool)).rejects.toThrow('"username" is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('reads woc.dealer_sign with the same query as the CWS getFirmaAccettatore', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      await getDealerSign(pool, { username: '0073741.d235' });

      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT sign_image FROM woc.dealer_sign WHERE dealer_login_userid = $1',
        ['0073741.d235'],
      );
    });

    it('returns the BYTEA image encoded as base64', async () => {
      const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const pool = makePool(async () => ({ rows: [{ sign_image: image }] }));

      const result = await getDealerSign(pool, { username: '0073741.d235' });

      expect(result).toBe(image.toString('base64'));
      expect(Buffer.from(result, 'base64').equals(image)).toBe(true);
    });

    it('returns null when the user has no signature', async () => {
      const pool = makePool(async () => ({ rows: [] }));

      expect(await getDealerSign(pool, { username: 'no.sign' })).toBeNull();
    });

    it('propagates database errors', async () => {
      const pool = makePool(async () => { throw new Error('db unreachable'); });

      await expect(getDealerSign(pool, { username: '0073741.d235' })).rejects.toThrow('db unreachable');
    });
  });
});
