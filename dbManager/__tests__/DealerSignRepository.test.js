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

    it('returns the BYTEA image as a data URL', async () => {
      const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const pool = makePool(async () => ({ rows: [{ sign_image: image }] }));

      const result = await getDealerSign(pool, { username: '0073741.d235' });

      expect(result).toBe(`data:image/jpeg;base64,${image.toString('base64')}`);
      expect(Buffer.from(result.split(',')[1], 'base64').equals(image)).toBe(true);
    });

    it.each([
      ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
      ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xdb])],
      ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
      ['image/svg+xml', Buffer.from('\uFEFF<?xml version="1.0"?>\n<!-- firma -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<SVG width="300">')],
      ['image/png', Buffer.from('<html><svg/></html>')],
      ['image/png', Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')],
      ['image/png', Buffer.from([0x00, 0x01, 0x02])],
    ])('detects %s from the image content', async (mimeType, image) => {
      const pool = makePool(async () => ({ rows: [{ sign_image: image }] }));

      expect(await getDealerSign(pool, { username: '0073741.d235' }))
        .toBe(`data:${mimeType};base64,${image.toString('base64')}`);
    });

    it('returns the SVG signature stored by the CWS storeFirmaAccettatore as the same data URL', async () => {
      const signature = `data:image/svg+xml;base64,${Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><text x="150" y="55">esempio</text></svg>',
      ).toString('base64')}`;
      const image = Buffer.from(signature.split(',')[1], 'base64');
      const pool = makePool(async () => ({ rows: [{ sign_image: image }] }));

      expect(await getDealerSign(pool, { username: '0073741.d235' })).toBe(signature);
    });

    it('checks many SVG comments in linear time', async () => {
      const image = Buffer.from(`${'<!-- - -->'.repeat(100000)}<html/>`);
      const pool = makePool(async () => ({ rows: [{ sign_image: image }] }));
      const start = Date.now();

      expect(await getDealerSign(pool, { username: '0073741.d235' })).toMatch(/^data:image\/png;base64,/);
      expect(Date.now() - start).toBeLessThan(1000);
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
