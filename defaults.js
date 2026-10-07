export const DEFAULT_GRADES = [
  { id: 'yellow', name: 'Yellow', color: '#facc15' },
  { id: 'blue', name: 'Blue', color: '#3b82f6' },
  { id: 'purple', name: 'Purple', color: '#a855f7' },
  { id: 'green', name: 'Green', color: '#22c55e' },
  { id: 'orange', name: 'Orange', color: '#f97316' },
  { id: 'red', name: 'Red', color: '#ef4444' },
  { id: 'black', name: 'Black', color: '#1f2937' },
  { id: 'white', name: 'White', color: '#f8fafc' },
];

export const SECTIONS = ['Warm-up', 'Main', 'Strength', 'Antagonist', 'Cool-down'];

export const CLIMB_EXERCISES = ['Easy climbs', 'Circuit: 4 problems', 'Progressive climbs', 'Project attempts', 'Flash attempts', 'Mobility + easy climbs'];

const ex = (section, name, sets, reps, rest, tip = '') =>
  ({ section, name, sets, reps, rest, tip, trackClimbs: CLIMB_EXERCISES.includes(name) });

const pulse = ex('Warm-up', 'Pulse raiser', 1, '5 min skip, row or jog', 0);
const mobility = ex('Warm-up', 'Mobility', 1, 'Shoulders, wrists, hips', 0,
  'Arm circles, band pull-aparts, wrist rolls, hip openers, deep squat hold.');
const stretch = ex('Cool-down', 'Stretch', 1, '5–10 min', 0,
  'Forearm flexors and extensors, lats, chest, hips. Easy downclimbing works too.');

export const defaultPlans = () => [
  {
    name: 'Capacity circuit',
    description: '4 problems climbed back-to-back for 5 rounds = 20 climbs. Builds power-endurance.',
    exercises: [
      pulse,
      mobility,
      ex('Warm-up', 'Easy climbs', 6, '1 climb, building up', 60,
        'Start 2–3 colours below your max and work up. Focus on quiet feet and straight arms.'),
      ex('Main', 'Circuit: 4 problems', 5, '4 problems back-to-back', 180,
        'Pick 4 problems 1–2 colours below your max that you could nearly flash. Climb all 4 with only the walk between them, then rest 3 min. If you fall, step back on and finish. Too easy? Pick harder ones next time. Too hard? Drop a colour.'),
      ex('Antagonist', 'Push-ups', 3, '10–15 reps', 60),
      stretch,
    ],
  },
  {
    name: 'Project + strength',
    description: 'Short warm-up, high-quality attempts on your projects, then strength work.',
    exercises: [
      pulse,
      mobility,
      ex('Warm-up', 'Progressive climbs', 5, '1 climb, building to near max', 90),
      ex('Main', 'Project attempts', 6, '1–3 good attempts', 180,
        'Limit bouldering: pick 1–3 problems at or above your max colour. Rest a full 3+ min so every go is high quality. Stop when you stop improving or after ~45 min. Log the project in Climbs with a photo.'),
      ex('Strength', 'Hangboard max hangs', 5, '10 s on 20 mm edge', 180,
        'Optional – best after about a year of climbing. Half-crimp or open hand, never full crimp. Adjust weight so 10 s is hard but clean. Skip if fingers feel tweaky.'),
      ex('Strength', 'Pull-ups', 4, '5 reps (add weight if easy)', 120),
      ex('Strength', 'Hanging knee raises', 3, '8–12 reps', 60, 'Progress to straight-leg raises, then toes-to-bar.'),
      ex('Antagonist', 'Push-ups or dips', 3, '10–12 reps', 60),
      ex('Antagonist', 'Reverse wrist curls', 2, '15 reps, light', 45),
      stretch,
    ],
  },
  {
    name: 'Fun session',
    description: 'No pressure. Flash attempts, new sets and games with friends.',
    exercises: [
      ex('Warm-up', 'Mobility + easy climbs', 5, '1 climb, building up', 60),
      ex('Main', 'Flash attempts', 6, '1 new problem, one go', 90,
        'Read the problem from the ground first, then try to flash it. Log anything you flash!'),
      ex('Main', 'Climb what looks fun', 1, '30–45 min', 0,
        'New sets, styles you usually avoid, your friends’ projects.'),
      ex('Main', 'Game: Add-on', 3, 'rounds', 120,
        'One person sets two moves, the next repeats them and adds one, and so on until someone falls.'),
      ex('Main', 'Downclimb challenge', 4, 'up and down an easy problem', 60),
      stretch,
    ],
  },
];
