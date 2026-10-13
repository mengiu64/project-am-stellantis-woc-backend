'use strict';

const { EC2Client, DescribeInstancesCommand, StartInstancesCommand } = require('@aws-sdk/client-ec2');
const { startBastionIfStopped } = require('../src/services/bastionInstanceService');

const BASTION = 'ec2-np-bsn0027990-stage-bastion';

function instance(instanceId, state) {
  return { InstanceId: instanceId, State: { Name: state } };
}

describe('bastionInstanceService.startBastionIfStopped', () => {
  function makeFakeClient(describeResult) {
    const send = jest.fn().mockImplementation((command) => {
      if (command instanceof DescribeInstancesCommand) {
        return Promise.resolve(describeResult);
      }
      if (command instanceof StartInstancesCommand) {
        return Promise.resolve({});
      }
      return Promise.reject(new Error('Unexpected command'));
    });
    return { send };
  }

  test('cerca il bastion per tag Name, escludendo le istanze terminate', async () => {
    const ec2Client = makeFakeClient({ Reservations: [{ Instances: [instance('i-1', 'running')] }] });

    await startBastionIfStopped(BASTION, { ec2Client });

    expect(ec2Client.send.mock.calls[0][0]).toBeInstanceOf(DescribeInstancesCommand);
    expect(ec2Client.send.mock.calls[0][0].input).toEqual({
      Filters: [
        { Name: 'tag:Name', Values: [BASTION] },
        { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
      ],
    });
  });

  test('avvia il bastion quando lo stato è "stopped"', async () => {
    const ec2Client = makeFakeClient({ Reservations: [{ Instances: [instance('i-1', 'stopped')] }] });

    const result = await startBastionIfStopped(BASTION, { ec2Client });

    expect(ec2Client.send).toHaveBeenCalledTimes(2);
    expect(ec2Client.send.mock.calls[1][0]).toBeInstanceOf(StartInstancesCommand);
    expect(ec2Client.send.mock.calls[1][0].input).toEqual({ InstanceIds: ['i-1'] });
    expect(result).toEqual({
      instanceName: BASTION,
      instances: [
        {
          instanceId: 'i-1',
          previousStatus: 'stopped',
          action: 'started',
          message: expect.stringContaining('Comando di avvio inviato con successo'),
        },
      ],
    });
  });

  test.each(['running', 'pending', 'stopping'])('non fa nulla se il bastion è "%s"', async (state) => {
    const ec2Client = makeFakeClient({ Reservations: [{ Instances: [instance('i-1', state)] }] });

    const result = await startBastionIfStopped(BASTION, { ec2Client });

    expect(ec2Client.send).toHaveBeenCalledTimes(1);
    expect(result.instances).toEqual([
      {
        instanceId: 'i-1',
        previousStatus: state,
        action: 'skipped',
        message: expect.stringContaining('Nessuna azione'),
      },
    ]);
  });

  test('con più istanze con lo stesso tag Name avvia (in un\'unica chiamata) solo quelle spente', async () => {
    const ec2Client = makeFakeClient({
      Reservations: [
        { Instances: [instance('i-1', 'stopped'), instance('i-2', 'running')] },
        { Instances: [instance('i-3', 'stopped')] },
      ],
    });

    const result = await startBastionIfStopped(BASTION, { ec2Client });

    expect(ec2Client.send).toHaveBeenCalledTimes(2);
    expect(ec2Client.send.mock.calls[1][0].input).toEqual({ InstanceIds: ['i-1', 'i-3'] });
    expect(result.instances.map(({ instanceId, action }) => [instanceId, action])).toEqual([
      ['i-1', 'started'],
      ['i-2', 'skipped'],
      ['i-3', 'started'],
    ]);
  });

  test.each([
    ['nessuna reservation', { Reservations: [] }],
    ['Reservations assente', {}],
  ])('lancia un errore se il bastion non viene trovato (%s)', async (_label, describeResult) => {
    const ec2Client = makeFakeClient(describeResult);

    await expect(startBastionIfStopped('bastion-inesistente', { ec2Client })).rejects.toThrow(
      'Istanza EC2 con tag Name "bastion-inesistente" non trovata'
    );
    expect(ec2Client.send).toHaveBeenCalledTimes(1);
  });

  test('propaga l\'errore se StartInstances fallisce', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ Reservations: [{ Instances: [instance('i-1', 'stopped')] }] })
      .mockRejectedValueOnce(new Error('InsufficientInstanceCapacity'));

    await expect(startBastionIfStopped(BASTION, { ec2Client: { send } })).rejects.toThrow(
      'InsufficientInstanceCapacity'
    );
  });

  test('usa un EC2Client reale (istanziato internamente) quando non viene iniettato', async () => {
    // Copre il ramo di default "deps.ec2Client || new EC2Client({})": mockiamo
    // EC2Client.prototype.send per evitare qualunque chiamata reale ad AWS.
    const sendSpy = jest
      .spyOn(EC2Client.prototype, 'send')
      .mockResolvedValue({ Reservations: [{ Instances: [instance('i-1', 'running')] }] });

    const result = await startBastionIfStopped(BASTION);

    expect(result.instances[0].action).toBe('skipped');
    sendSpy.mockRestore();
  });
});
