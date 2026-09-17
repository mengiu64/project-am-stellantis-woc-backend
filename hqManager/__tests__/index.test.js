'use strict';

jest.mock('../HqManager', () => ({
  HqManager: jest.fn(),
}));

const { HqManager } = require('../HqManager');
const {
  handler,
  runGetEnablingConfiguration,
  runSetEnablingConfiguration,
  main,
} = require('../index');

function makeManagerInstance(overrides = {}) {
  const instance = {
    getEnablingConfiguration: jest.fn(),
    setEnablingConfiguration: jest.fn(),
    ...overrides,
  };
  HqManager.mockImplementation(() => instance);
  return instance;
}

describe('hqManager/index.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('handler', () => {
    it('returns 400 when action is missing/unknown', async () => {
      const res = await handler({ action: 'unknownAction', body: {} });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).success).toBe(false);
    });

    it('dispatches getEnablingConfiguration (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([{ oic: '00006821' }]),
      });

      const res = await handler({ action: 'getEnablingConfiguration', body: { codmarket: '1000' } });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, codmarket: '1000', configurations: [{ oic: '00006821' }] });
    });

    it('dispatches setEnablingConfiguration (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        setEnablingConfiguration: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({
        action: 'setEnablingConfiguration',
        body: { codmarket: '1000', oic: '00006821', enableWOC: 1, enableSignature: 0 },
      });

      expect(instance.setEnablingConfiguration).toHaveBeenCalledWith('1000', '00006821', 1, 0);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, codmarket: '1000', oic: '00006821', enableWOC: 1, enableSignature: 0 });
    });

    it('ignores an unparseable JSON body (parseBody catch branch) and falls back to path-derived action', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({
        rawPath: '/hqManager/getEnablingConfiguration',
        queryStringParameters: { codmarket: '1000' },
        body: '{not-valid-json',
      });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
    });

    it('dispatches via API Gateway proxy event (action from path + query string)', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({
        rawPath: '/hqManager/getEnablingConfiguration',
        queryStringParameters: { codmarket: '1000' },
      });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
    });

    it('resolves the action from event.path when rawPath is absent', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({ path: '/hqManager/getEnablingConfiguration', queryStringParameters: { codmarket: '1000' } });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
    });

    it('resolves the action from event.pathParameters.proxy when rawPath/path are absent', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({
        pathParameters: { proxy: 'hqManager/getEnablingConfiguration' },
        queryStringParameters: { codmarket: '1000' },
      });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
    });

    it('prefers action from the parsed body over the path-derived one', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({
        rawPath: '/hqManager/setEnablingConfiguration',
        body: JSON.stringify({ action: 'getEnablingConfiguration', codmarket: '1000' }),
      });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 when no action can be resolved at all (no path, no body action)', async () => {
      const res = await handler({});
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).success).toBe(false);
    });

    it('returns 400 when the manager throws a validation error ("is required")', async () => {
      makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockRejectedValue(new Error('"codmarket" is required')),
      });

      const res = await handler({ action: 'getEnablingConfiguration', body: {} });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ success: false, message: '"codmarket" is required' });
    });

    it('returns 502 when the manager throws any other error', async () => {
      makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockRejectedValue(new Error('connection lost')),
      });

      const res = await handler({ action: 'getEnablingConfiguration', body: { codmarket: '1000' } });

      expect(res.statusCode).toBe(502);
      expect(JSON.parse(res.body)).toEqual({ success: false, message: 'connection lost' });
    });
  });

  describe('runGetEnablingConfiguration / runSetEnablingConfiguration (CLI helpers)', () => {
    it('runGetEnablingConfiguration delegates to HqManager and returns the result', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([{ oic: '00006821' }]),
      });

      const result = await runGetEnablingConfiguration('1000');

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(result).toEqual([{ oic: '00006821' }]);
    });

    it('runSetEnablingConfiguration delegates to HqManager and returns a summary', async () => {
      const instance = makeManagerInstance({
        setEnablingConfiguration: jest.fn().mockResolvedValue(undefined),
      });

      const result = await runSetEnablingConfiguration('1000', '00006821', 1, 0);

      expect(instance.setEnablingConfiguration).toHaveBeenCalledWith('1000', '00006821', 1, 0);
      expect(result).toEqual({ success: true, codmarket: '1000', oic: '00006821', enableWOC: 1, enableSignature: 0 });
    });
  });

  describe('main (CLI dispatcher)', () => {
    const ORIGINAL_ARGV = process.argv;
    let exitSpy;

    beforeEach(() => {
      exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
      process.argv = ORIGINAL_ARGV;
    });

    it('prints usage and exits 0 when no command is given', async () => {
      process.argv = ['node', 'index.js'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('prints usage and exits 1 when command is unknown', async () => {
      process.argv = ['node', 'index.js', 'notACommand'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 when getEnablingConfiguration is called without codmarket', async () => {
      process.argv = ['node', 'index.js', 'getEnablingConfiguration'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('runs getEnablingConfiguration via CLI', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });
      process.argv = ['node', 'index.js', 'getEnablingConfiguration', '1000'];

      await main();

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits 1 when setEnablingConfiguration is called with missing args', async () => {
      process.argv = ['node', 'index.js', 'setEnablingConfiguration', '1000'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 when setEnablingConfiguration is called with no args at all', async () => {
      process.argv = ['node', 'index.js', 'setEnablingConfiguration'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 when setEnablingConfiguration is missing enableWOC/enableSignature', async () => {
      process.argv = ['node', 'index.js', 'setEnablingConfiguration', '1000', '00006821'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('runs setEnablingConfiguration via CLI', async () => {
      const instance = makeManagerInstance({
        setEnablingConfiguration: jest.fn().mockResolvedValue(undefined),
      });
      process.argv = ['node', 'index.js', 'setEnablingConfiguration', '1000', '00006821', '1', '0'];

      await main();

      expect(instance.setEnablingConfiguration).toHaveBeenCalledWith('1000', '00006821', 1, 0);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('logs error and exits 1 when the CLI action throws', async () => {
      makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockRejectedValue(new Error('boom')),
      });
      process.argv = ['node', 'index.js', 'getEnablingConfiguration', '1000'];

      await main();

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
