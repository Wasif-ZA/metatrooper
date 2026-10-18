/** A stable colour per session, so its grant frame, both cursors, its tile dot and its watch dot match (D49: a hue hash, so two sessions can be close). */
export function sessionColour(sessionId: string): string {
  let h = 0;
  for (const c of sessionId) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 85%, 60%)`;
}
