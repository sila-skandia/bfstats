// Drives `viewer/seat-view.js` and `viewer/server-settings.js` and prints one
// JSON blob. `tests/test_seat_view.py` asserts on it.

import {
  SEAT_VIEW_ORDER, SEAT_VIEW_MODE_ID, NOSE_CAM_OFFSETS,
  noseCamOffset, seatViewModes,
  VIEW_COCKPIT, VIEW_NOSE, VIEW_CHASE, VIEW_FRONT, VIEW_FLYBY,
} from './seat-view.js';
import {
  SERVER_SETTINGS_DEFAULTS, SERVER_SETTINGS_PARAMS, SERVER_SETTINGS_STORE_KEY,
  ServerSettings, readServerSettings, truthyParam,
} from './server-settings.js';

const results = {
  order: SEAT_VIEW_ORDER,
  modeIds: SEAT_VIEW_MODE_ID,
  noseCamTable: NOSE_CAM_OFFSETS,
  defaults: SERVER_SETTINGS_DEFAULTS,
  params: SERVER_SETTINGS_PARAMS,
  storeKey: SERVER_SETTINGS_STORE_KEY,
};

// A vanilla vehicle seat declares no CVM word at all: the whole cycle, the
// nose only where the seat has one.
results.plainSeat = seatViewModes({});
results.plainSeatWithNose = seatViewModes({ nose: true });

// The ten artillery seats write `CVMExternTrace 1` and nothing else: still
// the whole cycle, because the four the cycle walks are seeded on.
results.externTraceOnly = seatViewModes({ cvm: { CVMEXTERNTRACE: true } });

// FinnWars' 67 locked cameras: the three external words written to 0.
results.lockedInside = seatViewModes({
  cvm: { CVMChase: false, CVMFrontChase: false, CVMFlyBy: false },
});

// One word off, any case.
results.noFlyby = seatViewModes({ cvm: { cvmflyby: 0 } });

// The server switches.
results.externalViewsOff = seatViewModes({ nose: true, settings: { externalViews: false } });
results.noseCamOff = seatViewModes({ nose: true, settings: { allowNoseCam: false } });
results.bothOff = seatViewModes({
  nose: true, settings: { externalViews: false, allowNoseCam: false },
});

// Nose cam placement: the table, Z-mirrored; the exporter's own number wins;
// a suffixed instance name still hits; a tank has none.
results.noseCorsair = noseCamOffset('CorsairCamera');
results.noseCorsairLower = noseCamOffset('corsaircamera');
results.noseCorsairSuffixed = noseCamOffset('CorsairCamera_2');
results.noseDeclared = noseCamOffset('CorsairCamera', { outsideHudOffset: [0, 0, -2.5] });
results.noseTank = noseCamOffset('ShermanCamera');
results.noseNull = noseCamOffset(null);
results.noseCount = Object.keys(NOSE_CAM_OFFSETS).length;

// Server settings: defaults, storage, query string precedence.
const fakeParams = (obj) => ({
  has: (k) => Object.prototype.hasOwnProperty.call(obj, k),
  get: (k) => (Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : null),
});
const fakeStorage = (obj = {}) => ({
  getItem: (k) => (k in obj ? obj[k] : null),
  setItem: (k, v) => { obj[k] = v; },
  dump: () => ({ ...obj }),
});
results.readDefaults = readServerSettings(null, null);
results.readStored = readServerSettings(null, fakeStorage({
  [SERVER_SETTINGS_STORE_KEY]: JSON.stringify({ externalViews: false, junk: 1 }),
}));
results.readParamsOverStored = readServerSettings(
  fakeParams({ externalViews: '1', noseCam: '0', foot3p: 'off' }),
  fakeStorage({ [SERVER_SETTINGS_STORE_KEY]: JSON.stringify({ externalViews: false }) }));
results.readFoot3pOldSpelling = readServerSettings(fakeParams({ foot3p: '1' }), null);
results.readBadStorage = readServerSettings(null, {
  getItem: () => { throw new Error('private window'); },
});
results.truthy = {
  one: truthyParam('1'), zero: truthyParam('0'), empty: truthyParam(''),
  off: truthyParam('off'), no: truthyParam('NO'), missing: truthyParam(null),
};

// The live object: a write persists, fires, and is idempotent.
{
  const store = fakeStorage();
  const live = new ServerSettings(readServerSettings(null, null), store);
  const fired = [];
  live.onChange((key, value) => fired.push([key, value]));
  live.set('externalViews', false);
  live.set('externalViews', false);
  live.set('nonsense', true);
  results.live = {
    externalViews: live.externalViews,
    fired,
    stored: JSON.parse(store.dump()[SERVER_SETTINGS_STORE_KEY]),
    json: live.toJSON(),
  };
}

process.stdout.write(JSON.stringify(results));
