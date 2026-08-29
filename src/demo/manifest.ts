import type { DailyLog, Photo, Project, PunchItem } from '../domain/types.ts';

export const DEMO_META_KEY = 'agent-closeout-demo';
export const DEMO_PROJECT_ID = 'maple-street-kitchen-demo-2025';
export const DEMO_PROJECT_NAME = 'Maple Street Kitchen Demo';
export const DEMO_MARKER = 'fieldproof:synthetic-workday-ledger-demo:v2';
export const LEGACY_DEMO_MARKER = 'fieldproof:synthetic-agent-closeout-demo:v1';

export const DEMO_PROJECT: Project = {
  id: DEMO_PROJECT_ID,
  name: DEMO_PROJECT_NAME,
  client: 'Sample homeowner',
  address: '1250 Maple Street, Demo City (synthetic)',
  startDate: '2025-05-13',
  notes: `${DEMO_MARKER}\nAll people, places, work notes, coordinates, and images in this project are synthetic.`,
  status: 'active',
  createdAt: '2025-05-13T07:30:00',
  updatedAt: '2025-05-15T16:30:00',
};

export type DemoPhotoManifest = Omit<Photo, 'sha256' | 'size'> & { assetPath: string };

const PHOTO_CAPTURES = [
  ['2025-05-13T08:00:00', 'Floor protection at the kitchen entry'],
  ['2025-05-13T08:20:00', 'Floors and nearby finishes covered before work'],
  ['2025-05-13T08:40:00', 'Existing cabinets before removal'],
  ['2025-05-13T10:45:00', 'Existing cabinet boxes removed'],
  ['2025-05-13T12:50:00', 'Exposed wall condition after cabinet removal'],
  ['2025-05-13T14:10:00', 'Water and electrical service locations checked'],
  ['2025-05-14T08:05:00', 'Cabinet layout marks at the wall'],
  ['2025-05-14T09:15:00', 'First base cabinet box set in position'],
  ['2025-05-14T11:30:00', 'Cabinet boxes leveled and fastened'],
  ['2025-05-14T13:10:00', 'Sink base installed'],
  ['2025-05-14T14:20:00', 'Appliance opening prepared to plan'],
  ['2025-05-14T16:05:00', 'Supply and drain connections tested'],
  ['2025-05-15T09:50:00', 'Cabinet fronts and hardware installed'],
  ['2025-05-15T11:20:00', 'Doors aligned after adjustment'],
  ['2025-05-15T11:40:00', 'Drawer fronts aligned and operating'],
  ['2025-05-15T13:15:00', 'Finished cabinet run and hardware detail'],
  ['2025-05-15T15:50:00', 'Work area cleaned for final walk-through'],
  ['2025-05-15T16:20:00', 'Completed kitchen at final walk-through'],
] as const;

export const DEMO_PHOTOS: readonly DemoPhotoManifest[] = PHOTO_CAPTURES.map(
  ([capturedAt, caption], index) => {
    const id = `msk25p${String(index + 1).padStart(2, '0')}`;
    return {
      id,
      projectId: DEMO_PROJECT_ID,
      assetPath: `/demo/${id}.jpg`,
      capturedAt,
      width: 960,
      height: 720,
      lat: 45.5 + index * 0.000001,
      lon: -122.6 - index * 0.000001,
      accuracy: 12,
      caption,
    };
  },
);

type WorkFact = readonly [doneAt: string, text: string, photoIds: readonly string[]];

const WORK_FACTS: readonly WorkFact[] = [
  ['2025-05-13T08:30:00', 'Protect floors and nearby finishes', ['msk25p02']],
  ['2025-05-13T11:00:00', 'Remove existing cabinets', ['msk25p04']],
  ['2025-05-13T14:20:00', 'Check walls and service locations', ['msk25p06']],
  ['2025-05-14T11:40:00', 'Set and level cabinet boxes', ['msk25p09']],
  ['2025-05-14T13:20:00', 'Install sink base', ['msk25p10']],
  ['2025-05-14T14:30:00', 'Prepare appliance openings', ['msk25p11']],
  ['2025-05-14T16:15:00', 'Connect and test plumbing', ['msk25p12']],
  ['2025-05-15T10:00:00', 'Install cabinet fronts and hardware', []],
  ['2025-05-15T11:30:00', 'Adjust doors and drawers', ['msk25p14']],
  ['2025-05-15T16:00:00', 'Final cleanup and walk-through', []],
];

export const DEMO_WORK_ITEMS: readonly PunchItem[] = WORK_FACTS.map(
  ([doneAt, text, photoIds], index) => ({
    id: `msk25w${String(index + 1).padStart(2, '0')}`,
    projectId: DEMO_PROJECT_ID,
    text,
    status: 'done',
    photoIds: [...photoIds],
    createdAt: `${doneAt.slice(0, 10)}T07:45:00`,
    doneAt,
    updatedAt: doneAt,
  }),
);

export const DEMO_DAILY_LOGS: readonly DailyLog[] = [
  {
    id: 'msk25d01',
    projectId: DEMO_PROJECT_ID,
    logDate: '2025-05-13',
    body: 'Protected the floors and nearby finishes, removed the existing cabinets, and checked the exposed walls and service locations.',
    crew: 'Alex and Sam',
    weather: 'Mild and dry',
    createdAt: '2025-05-13T16:35:00',
    updatedAt: '2025-05-13T16:35:00',
  },
  {
    id: 'msk25d02',
    projectId: DEMO_PROJECT_ID,
    logDate: '2025-05-14',
    body: 'Set and leveled the cabinet boxes, installed the sink base, prepared the appliance openings, and connected and tested the plumbing.',
    crew: 'Alex and Sam',
    weather: 'Cloudy and dry',
    createdAt: '2025-05-14T16:40:00',
    updatedAt: '2025-05-14T16:40:00',
  },
];

export const DEMO_META = { version: 2 as const, projectId: DEMO_PROJECT_ID };
