const dayMs=86400000;
export function taipeiCalendarDate(now:Date,offsetDays=0) {
  return new Date(+now+8*3600000+offsetDays*dayMs).toISOString().slice(0,10);
}
export function exclusiveTaipeiExpiry(date:string):Date|null {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start=new Date(`${date}T00:00:00+08:00`);
  if(!Number.isFinite(+start) || taipeiCalendarDate(start)!==date) return null;
  return new Date(+start+dayMs);
}
