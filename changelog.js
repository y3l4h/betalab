// Newest first. Bump APP_VERSION (and CACHE in sw.js) with every release; people see the entries they haven't seen yet
export const APP_VERSION = '1.6';

export const CHANGES = [
  {
    version: '1.6', date: '2026-10-09', items: [
      'Gyms: keep separate colour grades for each gym you climb at (Urban Climb and 9 Degrees are built in) and switch between them on Climbs and Progress.',
      'Edit a finished session’s date, start time and length (Progress → Sessions → Edit time).',
      'Forgot to tap Finish? BetaLab now asks “Still climbing?” and can finish the session at your last set.',
      'You’ll see this “What’s new” note after each update.',
    ],
  },
  {
    version: '1.5', date: '2026-10-08', items: [
      'Add a climb from a video: BetaLab saves a still frame as the photo.',
      'Grade with your gym’s colours or the V-scale.',
      'Backup reminders after a session, and an About page.',
    ],
  },
  {
    version: '1.4', date: '2026-10-08', items: [
      'Unsaved plan edits are kept when you close the editor.',
      'Training types with icons, a start confirmation and recent sessions on Train.',
      'Android back button support.',
    ],
  },
];
