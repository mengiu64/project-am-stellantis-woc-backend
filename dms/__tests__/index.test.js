'use strict';

jest.mock('../authService', () => ({
  getBearerToken: jest.fn(),
}));
jest.mock('../dmsService', () => ({
  getDmsSettings: jest.fn(),
  postDmsInquiry: jest.fn(),
  buildTypeSection: jest.fn(),
}));

const { getBearerToken } = require('../authService');
const { getDmsSettings, postDmsInquiry } = require('../dmsService');
const { handler } = require('../index');

describe('dms lambda handler — routing (per swagger-woc.yaml)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBearerToken.mockResolvedValue('TOKEN');
  });

  test('GET /api/settings/dml/current -> action "settings"', async () => {
    getDmsSettings.mockResolvedValue({ success: true });

    const event = {
      rawPath: '/api/settings/dml/current',
      queryStringParameters: { country: 'fr', brand: 'FT', dealer: '0062230' },
    };
    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    expect(getDmsSettings).toHaveBeenCalledWith('TOKEN', { country: 'fr', brand: 'FT', dealer: '0062230' });
    expect(postDmsInquiry).not.toHaveBeenCalled();
  });

  test('POST /api/repairorder/inquiry/LFP -> action "inquiry" with MessageType=LFP merged from path', async () => {
    postDmsInquiry.mockResolvedValue({ success: true });

    const event = {
      rawPath: '/api/repairorder/inquiry/LFP',
      body: JSON.stringify({
        DocumentID: '84564621',
        CustomerIdDms: '854265',
        VehicleID: '3C4NJCBH7KT831816',
        packageCodes: 'FORFAIT',
      }),
    };
    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    expect(postDmsInquiry).toHaveBeenCalledWith('TOKEN', expect.objectContaining({
      DocumentID: '84564621',
      CustomerIdDms: '854265',
      VehicleID: '3C4NJCBH7KT831816',
      MessageType: 'LFP',
      packageCodes: 'FORFAIT',
    }));
  });

  test('POST /api/repairorder/inquiry/WL -> MessageType=WL merged from path', async () => {
    postDmsInquiry.mockResolvedValue({ success: true });

    const event = {
      rawPath: '/api/repairorder/inquiry/WL',
      body: JSON.stringify({ DocumentID: '1', CustomerIdDms: '2', VehicleID: '3' }),
    };
    await handler(event);

    expect(postDmsInquiry).toHaveBeenCalledWith('TOKEN', expect.objectContaining({ MessageType: 'WL' }));
  });

  test('does not overwrite MessageType already present (flat) in the body', async () => {
    postDmsInquiry.mockResolvedValue({ success: true });

    const event = {
      rawPath: '/api/repairorder/inquiry/LFP',
      body: JSON.stringify({ MessageType: 'MP' }),
    };
    await handler(event);

    expect(postDmsInquiry).toHaveBeenCalledWith('TOKEN', expect.objectContaining({ MessageType: 'MP' }));
  });

  test('does not overwrite MessageType already present (nested in PartsInquiryHeader)', async () => {
    postDmsInquiry.mockResolvedValue({ success: true });

    const event = {
      rawPath: '/api/repairorder/inquiry/LFP',
      body: JSON.stringify({ PartsInquiryHeader: { MessageType: 'WL' } }),
    };
    await handler(event);

    const [, sentBody] = postDmsInquiry.mock.calls[0];
    expect(sentBody.PartsInquiryHeader.MessageType).toBe('WL');
    expect(sentBody.MessageType).toBeUndefined();
  });

  test('POST /api/repairorder/inquiry/inquiry (no path type) still resolves action "inquiry"', async () => {
    postDmsInquiry.mockResolvedValue({ success: true });

    const event = {
      rawPath: '/api/repairorder/inquiry/inquiry',
      body: JSON.stringify({ MessageType: 'LFP' }),
    };
    await handler(event);

    expect(postDmsInquiry).toHaveBeenCalledWith('TOKEN', expect.objectContaining({ MessageType: 'LFP' }));
  });

  test('ignores an invalid path segment as MessageType (e.g. .../inquiry/FOO)', async () => {
    postDmsInquiry.mockResolvedValue({ success: true });

    const event = {
      rawPath: '/api/repairorder/inquiry/FOO',
      body: JSON.stringify({ MessageType: 'LFP' }),
    };
    await handler(event);

    expect(postDmsInquiry).toHaveBeenCalledWith('TOKEN', expect.objectContaining({ MessageType: 'LFP' }));
  });

  test('direct invocation with { action, body } bypasses path resolution', async () => {
    getDmsSettings.mockResolvedValue({ success: true });

    const event = { action: 'settings', body: { country: 'fr', brand: 'FT', dealer: '0062230' } };
    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    expect(getDmsSettings).toHaveBeenCalledWith('TOKEN', { country: 'fr', brand: 'FT', dealer: '0062230' });
  });

  test('returns 400 for an unknown action', async () => {
    const event = { rawPath: '/api/repairorder/foo' };
    const res = await handler(event);

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.message).toContain('Unknown action: "foo"');
  });

  test('returns 502 when downstream call fails with a generic error', async () => {
    postDmsInquiry.mockRejectedValue(new Error('[dms] inquiry failed: HTTP 500'));

    const event = { rawPath: '/api/repairorder/inquiry/LFP', body: JSON.stringify({ MessageType: 'LFP' }) };
    const res = await handler(event);

    expect(res.statusCode).toBe(502);
  });
});
