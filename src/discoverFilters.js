export const defaultFilters = { date: 'any', type: 'any', level: 'any', sort: 'smart', radius: 'any', start: '', end: '', free: false, query: '' };
export function distanceKm(a, b) {
  if (!a || !b) return null;
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.latitude-a.latitude)/2)**2 + Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1,h)));
}
export function filterSessions(sessions, f, position) {
  return sessions.map(s => ({...s, distanceKm: distanceKm(position, s.coordinates)})).filter(s => {
    if (f.query && !`${s.name} ${s.club} ${s.location}`.toLowerCase().includes(f.query.toLowerCase().trim())) return false;
    if (f.date !== 'any' && s.dateISO !== f.date) return false;
    if (f.type !== 'any' && s.type !== f.type) return false;
    if (f.level !== 'any') { const [lo,hi] = f.level.split('-').map(Number); if(s.levelMax<lo || s.levelMin>hi) return false; }
    if (f.radius !== 'any' && (s.distanceKm === null || s.distanceKm > Number(f.radius))) return false;
    if (f.free && s.price !== 0) return false;
    if (f.start && s.timeStart < f.start) return false;
    if (f.end && s.timeStart >= f.end) return false;
    return true;
  }).sort((a,b) => f.sort === 'distance' ? (a.distanceKm ?? Infinity)-(b.distanceKm ?? Infinity) : f.sort === 'time' ? `${a.dateISO}T${a.timeStart}`.localeCompare(`${b.dateISO}T${b.timeStart}`) : b.reliability-a.reliability);
}
