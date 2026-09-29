// Campus locations shown on the Pulse map.
// x / y are positions (0-100) on the schematic campus map, not GPS coordinates.
// Rename or add places here to match the real IITH layout, then run `npm run seed`.
// openHours: [openHour, closeHour) in 24h local time; the forecast only suggests times inside them.
// registered (messes only): students who eat there; the base of the mess headcount forecast.

export const PLACES = [
  { id: 'dh1', name: 'Dining Hall 1', type: 'mess', capacity: 600, registered: 950, x: 22, y: 30, openHours: [7, 22] },
  { id: 'dh2', name: 'Dining Hall 2', type: 'mess', capacity: 500, registered: 750, x: 30, y: 62, openHours: [7, 22] },
  { id: 'lib', name: 'Central Library', type: 'library', capacity: 400, x: 55, y: 40, openHours: [8, 24] },
  { id: 'lhc', name: 'Lecture Hall Complex', type: 'academic', capacity: 3000, x: 68, y: 23, openHours: [8, 19] },
  { id: 'acad', name: 'Department Blocks', type: 'academic', capacity: 3200, x: 78, y: 43, openHours: [8, 20] },
  { id: 'gym', name: 'Gym', type: 'gym', capacity: 80, x: 36, y: 84, openHours: [6, 22] },
  { id: 'sports', name: 'Sports Complex', type: 'sports', capacity: 300, x: 17, y: 83, openHours: [6, 22] },
  { id: 'food', name: 'Food Court', type: 'cafe', capacity: 150, x: 48, y: 60, openHours: [9, 24] },
  { id: 'health', name: 'Health Centre', type: 'health', capacity: 40, x: 85, y: 75, openHours: [0, 24] },
  { id: 'shuttle', name: 'Main Gate Shuttle Stop', type: 'transport', capacity: 60, x: 90, y: 15, openHours: [6, 23] },
];

export const PLACE_TYPES = {
  mess: 'Dining',
  library: 'Study',
  academic: 'Academic',
  gym: 'Fitness',
  sports: 'Sports',
  cafe: 'Food',
  health: 'Health',
  transport: 'Transport',
};
