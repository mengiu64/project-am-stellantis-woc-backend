'use strict';

const fs = require('fs');
const path = require('path');
const { DjcManager } = require('../DjcManager');

// ─── Fixture djcJson minimale, coerente con la struttura di get.json ──────────
function makeDjcJson(roInfoOverrides = {}, jobCardDetailOverrides = {}) {
  return {
    jobCardDetail: {
      roInfo: {
        dmsRepairOrderId: 'DMS-PNR-100403',
        jobCardSrpId: 'JCID-17362',
        jobCardLegacyId: '1JSGR43CT',
        sourceApplication: 'PANIER',
        dealerId: '017721L',
        stellantisBrand: 'AP',
        status: 'CREATED',
        updateDateTime: '2026-07-02T07:55:23Z',
        dmsSynchroStatus: 'UNSYNCED',
        interiorCarWash: '0/2',
        exteriorCarWash: '1/2',
        partPreferences: [
          { old: '?', original: '?', returned: true, circularEconomy: true },
        ],
        obfcm: false,
        waitOnSite: true,
        vehicleIdentificationTagNumber: '?',
        loanerFlag: '?',
        ...roInfoOverrides,
      },
      customerInfo: [
        {
          customerId: 'CUST-001234',
          personalInfo: {
            contactInfo: {
              phone: '+91-22-40000000',
              mobile: '+91-9000000000',
              email: 'TEST@example.com',
              address: 'TEST',
              additionalAddress: 'TEST',
            },
          },
        },
      ],
      vehicleInfo: {
        identification: {
          licensePlate: 'EH-436-DG',
        },
        state: {
          odometerOut: '?',
          mileageUnits: 'km',
          fuelReserveLevel: 3,
          batteryReserveLevel: 85,
        },
      },
      jobs: [
        { jobInternalId: 'JOB-1', jobDescription: 'Cambio olio' },
      ],
      consents: [
        {
          repairer: [
            { channelCode: '1', privacyIndicator: true },
            { channelCode: '2', privacyIndicator: true },
            { channelCode: '3', privacyIndicator: true },
          ],
          stellantis: [
            { channelCode: '4', privacyIndicator: true },
            { channelCode: '5', privacyIndicator: true },
            { channelCode: '6', privacyIndicator: true },
          ],
          collectionDate: '?',
          disclaimerId: '<ID>',
          issuingName: '?',
        },
      ],
      appointments: [
        {
          appointmentInternalId: 'APT-00077',
          reception: {
            estimatedReceptionDateTime: '2025-12-05T09:30:00+05:30',
            receptionDateTime: '2025-12-05T09:45:00+05:30',
            receptionServiceAdvisorId: 'SG36544',
            receptionServiceAdvisorName: 'TEST',
          },
          delivery: {
            estimatedDeliveryDateTime: '2025-12-05T17:30:00+05:30',
            deliveryDateTime: '2025-12-05T17:45:00+05:30',
            deliveryServiceAdvisorId: 'SG5477',
            deliveryServiceAdvisorName: 'Peter',
          },
        },
      ],
      ...jobCardDetailOverrides,
    },
  };
}

const ROINFO_BASE = {
  dmsRepairOrderId: 'DMS-PNR-100403',
  jobCardSrpId: 'JCID-17362',
  jobCardLegacyId: '1JSGR43CT',
  sourceApplication: 'PANIER',
  dealerId: '017721L',
  stellantisBrand: 'AP',
  status: 'CREATED',
  updateDateTime: '2026-07-02T07:55:23Z',
  dmsSynchroStatus: 'UNSYNCED',
};

describe('DjcManager', () => {
  describe('constructor', () => {
    test('accepts an explicit djcJson (used for tests)', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);
      expect(manager.djcJson).toBe(djcJson);
    });

    test('loads djcJson from get.json when not provided and jobCardId is absent', () => {
      const manager = new DjcManager();
      expect(manager.djcJson).toHaveProperty('jobCardDetail.roInfo');
    });

    test('loads djcJson from /tmp/<jobCardId>.json when jobCardId is provided', () => {
      const jobCardId = 'TEST-JOBCARD-84564621';
      const tmpFile = path.join('/tmp', `${jobCardId}.json`);
      const fromTmp = makeDjcJson({ jobCardSrpId: 'FROM-TMP' });
      fs.writeFileSync(tmpFile, JSON.stringify(fromTmp), 'utf8');

      try {
        const manager = new DjcManager(undefined, jobCardId);
        expect(manager.djcJson.jobCardDetail.roInfo.jobCardSrpId).toBe('FROM-TMP');
        expect(manager.jobCardId).toBe(jobCardId);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    test('throws a clear error when /tmp/<jobCardId>.json is missing', () => {
      expect(() => new DjcManager(undefined, 'MISSING-JOBCARD-ID'))
        .toThrow('[djc] impossibile leggere /tmp/MISSING-JOBCARD-ID.json');
    });

    test('explicit djcJson takes precedence over jobCardId', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson, 'IGNORED-JOBCARD-ID');
      expect(manager.djcJson).toBe(djcJson);
    });
  });

  describe('SaveRoInfo', () => {
    test('json_orig contains only the expected subset of roInfo fields', () => {
      const djcJson = makeDjcJson({ extraField: 'should-not-appear', anotherOne: 123 });
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveRoInfo(
        '2/2', '2/2', 'yes', 'yes', false, false, true, false, 'TAG-999', 'Y'
      );

      expect(json_orig).toEqual({
        roInfo: {
          dmsRepairOrderId: 'DMS-PNR-100403',
          jobCardSrpId: 'JCID-17362',
          jobCardLegacyId: '1JSGR43CT',
          sourceApplication: 'PANIER',
          dealerId: '017721L',
          stellantisBrand: 'AP',
          status: 'CREATED',
          updateDateTime: '2026-07-02T07:55:23Z',
          dmsSynchroStatus: 'UNSYNCED',
          interiorCarWash: '0/2',
          exteriorCarWash: '1/2',
          partPreferences: [
            { old: '?', original: '?', returned: true, circularEconomy: true },
          ],
          obfcm: false,
          waitOnSite: true,
          vehicleIdentificationTagNumber: '?',
          loanerFlag: '?',
        },
      });
    });

    test('json_orig is a deep copy (mutating it does not affect djcJson)', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveRoInfo(
        '2/2', '2/2', 'yes', 'yes', false, false, true, false, 'TAG-999', 'Y'
      );
      json_orig.roInfo.interiorCarWash = 'TAMPERED';

      expect(djcJson.jobCardDetail.roInfo.interiorCarWash).toBe('0/2');
    });

    test('json_mod overrides the fields received as arguments', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_mod } = manager.SaveRoInfo(
        '2/2', '2/2', 'yes', 'yes', false, false, true, false, 'TAG-999', 'Y'
      );

      expect(json_mod.roInfo).toMatchObject({
        interiorCarWash: '2/2',
        exteriorCarWash: '2/2',
        obfcm: true,
        waitOnSite: false,
        vehicleIdentificationTagNumber: 'TAG-999',
        loanerFlag: 'Y',
      });
      expect(json_mod.roInfo.partPreferences[0]).toEqual({
        old: 'yes',
        original: 'yes',
        returned: false,
        circularEconomy: false,
      });
    });

    test('json_mod keeps other roInfo fields untouched', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_mod } = manager.SaveRoInfo(
        '2/2', '2/2', 'yes', 'yes', false, false, true, false, 'TAG-999', 'Y'
      );

      expect(json_mod.roInfo.jobCardSrpId).toBe('JCID-17362');
      expect(json_mod.roInfo.dmsSynchroStatus).toBe('UNSYNCED');
      expect(json_mod.roInfo.status).toBe('CREATED');
    });

    test('creates partPreferences when missing from source roInfo', () => {
      const djcJson = makeDjcJson({ partPreferences: undefined });
      const manager = new DjcManager(djcJson);

      const { json_mod } = manager.SaveRoInfo(
        '1/2', '0/2', 'a', 'b', true, true, false, true, 'TAG-1', 'N'
      );

      expect(json_mod.roInfo.partPreferences).toEqual([
        { old: 'a', original: 'b', returned: true, circularEconomy: true },
      ]);
    });

    test('creates partPreferences when source array is empty', () => {
      const djcJson = makeDjcJson({ partPreferences: [] });
      const manager = new DjcManager(djcJson);

      const { json_mod } = manager.SaveRoInfo(
        '1/2', '0/2', 'a', 'b', true, true, false, true, 'TAG-1', 'N'
      );

      expect(json_mod.roInfo.partPreferences).toEqual([
        { old: 'a', original: 'b', returned: true, circularEconomy: true },
      ]);
    });

    test('falls back to empty roInfo when djcJson.jobCardDetail is missing', () => {
      const manager = new DjcManager({});

      const { json_orig, json_mod } = manager.SaveRoInfo(
        '1/2', '0/2', 'a', 'b', true, true, false, true, 'TAG-1', 'N'
      );

      expect(json_orig).toEqual({ roInfo: { partPreferences: [] } });
      expect(json_mod.roInfo).toMatchObject({
        interiorCarWash: '1/2',
        exteriorCarWash: '0/2',
        obfcm: false,
        waitOnSite: true,
        vehicleIdentificationTagNumber: 'TAG-1',
        loanerFlag: 'N',
      });
    });
  });

  describe('SaveDmsSync', () => {
    test('json_orig contains only the roInfo base subset, unchanged', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveDmsSync('SYNCED');

      expect(json_orig).toEqual({ roInfo: ROINFO_BASE });
    });

    test('json_mod overrides dmsSynchroStatus with the argument value', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_mod } = manager.SaveDmsSync('SYNCED');

      expect(json_mod).toEqual({ roInfo: { ...ROINFO_BASE, dmsSynchroStatus: 'SYNCED' } });
    });

    test('does not mutate djcJson', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      manager.SaveDmsSync('SYNCED');

      expect(djcJson.jobCardDetail.roInfo.dmsSynchroStatus).toBe('UNSYNCED');
    });

    test('falls back to empty roInfo when djcJson.jobCardDetail is missing', () => {
      const manager = new DjcManager({});

      const { json_orig, json_mod } = manager.SaveDmsSync('SYNCED');

      expect(json_orig).toEqual({ roInfo: {} });
      expect(json_mod).toEqual({ roInfo: { dmsSynchroStatus: 'SYNCED' } });
    });
  });

  describe('SaveCustomer', () => {
    test('json_orig contains roInfo base subset + current contactInfo, unchanged', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveCustomer(
        '+39-06-1111111', '+39-333-2222222', 'new@example.com', 'Via Nuova 1', 'Scala B'
      );

      expect(json_orig).toEqual({
        roInfo: ROINFO_BASE,
        customerInfo: [
          {
            customerId: 'CUST-001234',
            contactInfo: {
              phone: '+91-22-40000000',
              mobile: '+91-9000000000',
              email: 'TEST@example.com',
              address: 'TEST',
              additionalAddress: 'TEST',
            },
          },
        ],
      });
    });

    test('json_mod overrides contactInfo with the argument values', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_mod } = manager.SaveCustomer(
        '+39-06-1111111', '+39-333-2222222', 'new@example.com', 'Via Nuova 1', 'Scala B'
      );

      expect(json_mod.customerInfo[0].contactInfo).toEqual({
        phone: '+39-06-1111111',
        mobile: '+39-333-2222222',
        email: 'new@example.com',
        address: 'Via Nuova 1',
        additionalAddress: 'Scala B',
      });
      expect(json_mod.customerInfo[0].customerId).toBe('CUST-001234');
      expect(json_mod.roInfo).toEqual(ROINFO_BASE);
    });

    test('does not mutate djcJson', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      manager.SaveCustomer('+39-06-1111111', '+39-333-2222222', 'new@example.com', 'Via Nuova 1', 'Scala B');

      expect(djcJson.jobCardDetail.customerInfo[0].personalInfo.contactInfo.phone).toBe('+91-22-40000000');
    });

    test('falls back to empty contactInfo when customerInfo is missing', () => {
      const manager = new DjcManager({});

      const { json_orig, json_mod } = manager.SaveCustomer('p', 'm', 'e', 'a', 'aa');

      expect(json_orig).toEqual({
        roInfo: {},
        customerInfo: [{ contactInfo: {} }],
      });
      expect(json_mod.customerInfo[0].contactInfo).toEqual({
        phone: 'p', mobile: 'm', email: 'e', address: 'a', additionalAddress: 'aa',
      });
    });
  });

  describe('SaveVehicle', () => {
    test('json_orig contains roInfo base subset + current vehicle fields, unchanged', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveVehicle('NEW-PLATE', 30000, 'mi', 2, 60);

      expect(json_orig).toEqual({
        roInfo: ROINFO_BASE,
        vehicleInfo: {
          identification: { licensePlate: 'EH-436-DG' },
          state: {
            odometerOut: '?',
            mileageUnits: 'km',
            fuelReserveLevel: 3,
            batteryReserveLevel: 85,
          },
        },
      });
    });

    test('json_mod overrides vehicle fields with the argument values', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_mod } = manager.SaveVehicle('NEW-PLATE', 30000, 'mi', 2, 60);

      expect(json_mod.vehicleInfo).toEqual({
        identification: { licensePlate: 'NEW-PLATE' },
        state: {
          odometerOut: 30000,
          mileageUnits: 'mi',
          fuelReserveLevel: 2,
          batteryReserveLevel: 60,
        },
      });
      expect(json_mod.roInfo).toEqual(ROINFO_BASE);
    });

    test('does not mutate djcJson', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      manager.SaveVehicle('NEW-PLATE', 30000, 'mi', 2, 60);

      expect(djcJson.jobCardDetail.vehicleInfo.identification.licensePlate).toBe('EH-436-DG');
    });

    test('falls back to empty vehicleInfo when missing from djcJson', () => {
      const manager = new DjcManager({});

      const { json_orig, json_mod } = manager.SaveVehicle('NEW-PLATE', 30000, 'mi', 2, 60);

      expect(json_orig).toEqual({
        roInfo: {},
        vehicleInfo: { identification: {}, state: {} },
      });
      expect(json_mod.vehicleInfo).toEqual({
        identification: { licensePlate: 'NEW-PLATE' },
        state: { odometerOut: 30000, mileageUnits: 'mi', fuelReserveLevel: 2, batteryReserveLevel: 60 },
      });
    });
  });

  describe('SaveJobs', () => {
    test('json_orig contains roInfo base subset + copy of jobCardDetail.jobs', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveJobs();

      expect(json_orig).toEqual({
        roInfo: ROINFO_BASE,
        jobs: [{ jobInternalId: 'JOB-1', jobDescription: 'Cambio olio' }],
      });
    });

    test('json_mod is identical to json_orig (no arguments to override)', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig, json_mod } = manager.SaveJobs();

      expect(json_mod).toEqual(json_orig);
    });

    test('jobs is a deep copy (mutating it does not affect djcJson)', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveJobs();
      json_orig.jobs[0].jobDescription = 'TAMPERED';

      expect(djcJson.jobCardDetail.jobs[0].jobDescription).toBe('Cambio olio');
    });

    test('falls back to empty jobs array when missing from djcJson', () => {
      const manager = new DjcManager({});

      const { json_orig } = manager.SaveJobs();

      expect(json_orig).toEqual({ roInfo: {}, jobs: [] });
    });

    test('strips packageType/packageCharge added by jobCardService enrichment to GET jobCardDetails', () => {
      const djcJson = makeDjcJson({}, {
        jobs: [
          { jobInternalId: 'JOB-1', jobDescription: 'Cambio olio', packageType: 'GC', packageCharge: 'CUSTOMER' },
        ],
      });
      const manager = new DjcManager(djcJson);

      const { json_orig, json_mod } = manager.SaveJobs();

      expect(json_orig.jobs).toEqual([{ jobInternalId: 'JOB-1', jobDescription: 'Cambio olio' }]);
      expect(json_mod.jobs).toEqual([{ jobInternalId: 'JOB-1', jobDescription: 'Cambio olio' }]);
      expect(djcJson.jobCardDetail.jobs[0]).toHaveProperty('packageType', 'GC');
      expect(djcJson.jobCardDetail.jobs[0]).toHaveProperty('packageCharge', 'CUSTOMER');
    });
  });

  describe('SaveConsents', () => {
    test('json_orig contains roInfo base subset + current consents, unchanged', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveConsents(false, false, false, false, false, false);

      expect(json_orig).toEqual({
        roInfo: ROINFO_BASE,
        consents: [
          {
            repairer: [
              { channelCode: '1', privacyIndicator: true },
              { channelCode: '2', privacyIndicator: true },
              { channelCode: '3', privacyIndicator: true },
            ],
            stellantis: [
              { channelCode: '4', privacyIndicator: true },
              { channelCode: '5', privacyIndicator: true },
              { channelCode: '6', privacyIndicator: true },
            ],
          },
        ],
      });
    });

    test('json_mod overrides privacyIndicator with the argument values, keeping channelCode unchanged', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_mod } = manager.SaveConsents(true, false, true, false, true, false);

      expect(json_mod.consents[0]).toEqual({
        repairer: [
          { channelCode: '1', privacyIndicator: true },
          { channelCode: '2', privacyIndicator: false },
          { channelCode: '3', privacyIndicator: true },
        ],
        stellantis: [
          { channelCode: '4', privacyIndicator: false },
          { channelCode: '5', privacyIndicator: true },
          { channelCode: '6', privacyIndicator: false },
        ],
      });
    });

    test('consents is a deep copy (mutating result does not affect djcJson)', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveConsents(true, true, true, true, true, true);
      json_orig.consents[0].repairer[0].privacyIndicator = 'TAMPERED';

      expect(djcJson.jobCardDetail.consents[0].repairer[0].privacyIndicator).toBe(true);
    });

    test('falls back to empty repairer/stellantis arrays when consents is missing', () => {
      const manager = new DjcManager({});

      const { json_orig, json_mod } = manager.SaveConsents(true, true, true, true, true, true);

      expect(json_orig).toEqual({ roInfo: {}, consents: [{ repairer: [], stellantis: [] }] });
      expect(json_mod).toEqual({ roInfo: {}, consents: [{ repairer: [], stellantis: [] }] });
    });
  });

  describe('SaveAppointments', () => {
    test('json_orig contains roInfo base subset + current appointment, unchanged', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveAppointments(
        'X', 'X', 'X', 'X', 'X', 'X', 'X', 'X'
      );

      expect(json_orig).toEqual({
        roInfo: ROINFO_BASE,
        appointments: [
          {
            appointmentInternalId: 'APT-00077',
            reception: {
              estimatedReceptionDateTime: '2025-12-05T09:30:00+05:30',
              receptionDateTime: '2025-12-05T09:45:00+05:30',
              receptionServiceAdvisorId: 'SG36544',
              receptionServiceAdvisorName: 'TEST',
            },
            delivery: {
              estimatedDeliveryDateTime: '2025-12-05T17:30:00+05:30',
              deliveryDateTime: '2025-12-05T17:45:00+05:30',
              deliveryServiceAdvisorId: 'SG5477',
              deliveryServiceAdvisorName: 'Peter',
            },
          },
        ],
      });
    });

    test('json_mod overrides reception/delivery fields with the argument values', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_mod } = manager.SaveAppointments(
        '2026-01-01T09:00:00Z',
        '2026-01-01T09:10:00Z',
        'SA-1',
        'Mario',
        '2026-01-01T17:00:00Z',
        '2026-01-01T17:10:00Z',
        'SA-2',
        'Luigi'
      );

      expect(json_mod.appointments[0]).toEqual({
        appointmentInternalId: 'APT-00077',
        reception: {
          estimatedReceptionDateTime: '2026-01-01T09:00:00Z',
          receptionDateTime: '2026-01-01T09:10:00Z',
          receptionServiceAdvisorId: 'SA-1',
          receptionServiceAdvisorName: 'Mario',
        },
        delivery: {
          estimatedDeliveryDateTime: '2026-01-01T17:00:00Z',
          deliveryDateTime: '2026-01-01T17:10:00Z',
          deliveryServiceAdvisorId: 'SA-2',
          deliveryServiceAdvisorName: 'Luigi',
        },
      });
    });

    test('appointments is a deep copy (mutating result does not affect djcJson)', () => {
      const djcJson = makeDjcJson();
      const manager = new DjcManager(djcJson);

      const { json_orig } = manager.SaveAppointments('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
      json_orig.appointments[0].reception.receptionServiceAdvisorName = 'TAMPERED';

      expect(djcJson.jobCardDetail.appointments[0].reception.receptionServiceAdvisorName).toBe('TEST');
    });

    test('falls back to empty reception/delivery objects when appointments is missing', () => {
      const manager = new DjcManager({});

      const { json_orig } = manager.SaveAppointments('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');

      expect(json_orig).toEqual({ roInfo: {}, appointments: [{ reception: {}, delivery: {} }] });
    });
  });
});
