export function calculateAge(dob: string, asOf = new Date()): number | null {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;

  let age = asOf.getFullYear() - birth.getFullYear();
  const monthDelta = asOf.getMonth() - birth.getMonth();
  const dayDelta = asOf.getDate() - birth.getDate();
  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) age -= 1;
  return age >= 0 ? age : null;
}

export function isMinor(dob: string, adultAge = 18, asOf = new Date()): boolean {
  const age = calculateAge(dob, asOf);
  return age !== null && age < adultAge;
}

