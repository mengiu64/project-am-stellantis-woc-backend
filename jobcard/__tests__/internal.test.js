'use strict';

jest.mock('../authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../jobCardService', () => ({ getJobCardDetails: jest.fn() }));
const { getBearerToken } = require('../authService');
const { getJobCardDetails } = require('../jobCardService');
const { handler } = require('../internal');
test('REST detail lookup owns the upstream token and jobcard cache', async () => {
  getBearerToken.mockResolvedValue('token');
  getJobCardDetails.mockResolvedValue({ roInfo: { dmsSynchroStatus: 'OK' } });
  const response = await handler({
    path: '/internal/jobcard/getJobCardDetails', httpMethod: 'POST',
    requestContext: { identity: { userArn: 'role' } }, body: '{"args":["JOB123"]}',
  });
  expect(JSON.parse(response.body).data).toEqual({ roInfo: { dmsSynchroStatus: 'OK' } });
  expect(getJobCardDetails).toHaveBeenCalledWith('token', 'JOB123');
});
