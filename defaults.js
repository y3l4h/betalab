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

// Built-in gyms; people can rename, recolour, delete or add their own
export const GYM_PRESETS = [
  { id: 'urban-climb', name: 'Urban Climb', scale: 'colours', grades: DEFAULT_GRADES },
  {
    id: '9-degrees', name: '9 Degrees', scale: 'colours',
    grades: [
      ['yellow', 'Yellow', '#facc15'], ['blue', 'Blue', '#3b82f6'], ['teal', 'Teal', '#14b8a6'],
      ['purple', 'Purple', '#a855f7'], ['green', 'Green', '#22c55e'], ['pink', 'Pink', '#ec4899'],
      ['red', 'Red', '#ef4444'], ['black', 'Black', '#1f2937'], ['white', 'White', '#f8fafc'],
    ].map(([id, name, color]) => ({ id, name, color })),
  },
];

// V-scale for gyms that grade by number; colours run light to dark so harder reads heavier
export const V_SCALE = [
  ['vb', 'VB', '#bef264'], ['v0', 'V0', '#4ade80'], ['v1', 'V1', '#22c55e'], ['v2', 'V2', '#14b8a6'],
  ['v3', 'V3', '#06b6d4'], ['v4', 'V4', '#3b82f6'], ['v5', 'V5', '#6366f1'], ['v6', 'V6', '#8b5cf6'],
  ['v7', 'V7', '#a855f7'], ['v8', 'V8', '#d946ef'], ['v9', 'V9', '#e11d48'], ['v10', 'V10+', '#1f2937'],
].map(([id, name, color]) => ({ id, name, color }));

export const SECTIONS = ['Warm-up', 'Main', 'Strength', 'Antagonist', 'Cool-down'];

// Climbing exercises from the old starter plans; used once to switch on per-climb tracking for plans already on a phone
export const CLIMB_EXERCISES = ['Easy climbs', 'Circuit: 4 problems', 'Progressive climbs', 'Project attempts', 'Flash attempts', 'Mobility + easy climbs'];
