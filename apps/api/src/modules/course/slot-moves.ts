/** Higher than any slot a course or a module reaches by appending one row at a time, and the
 * reason a lift can never land on a row the transaction is not touching. */
export const SLOT_CLEARANCE = 100_000;

/** A row and the slot it currently holds — the whole of what a reorder needs to know. */
export interface Slot {
  id: string;
  position: number;
}

/** Where a row is going, and the temporary slot it leaves through to get there. */
export interface SlotMove {
  id: string;
  into: number;
  lift: number;
}

/**
 * Pairs a new order with the slots the rows already hold: the nth id takes the nth slot.
 *
 * Shared by a course's syllabus and the lessons inside one module because both write order
 * the same way, and this is the part with an invariant in it — the two-phase write that
 * needs it is explained at each call site, where the table being lifted is visible.
 */
export function planSlotMoves(
  slots: Slot[],
  orderedIds: string[],
  kind: 'module' | 'lesson',
): SlotMove[] {
  // The service has already proved the two lists describe the same rows, so pairing them
  // here is the whole of the arithmetic.
  const moves = slots.map((slot, index) => {
    const id = orderedIds[index];
    if (!id) throw new Error(`No ${kind} to place in slot ${slot.position}`);
    return { id, into: slot.position, lift: slot.position + SLOT_CLEARANCE };
  });
  if (moves.length !== orderedIds.length) {
    throw new Error(`Reorder named more ${kind}s than there were slots`);
  }
  return moves;
}

/** How many of the rows would leave the slot they hold, given the new order.
 *
 * The pair of lists a reorder arrives as says what the teacher wants, not whether it differs from
 * what the container already holds — and a request that lost its response and came back is the same
 * order sent twice. So a caller asks this before it writes, and files no record and moves no row for
 * an order that was already in place.
 */
export function countMovedSlots(slots: Slot[], orderedIds: string[]): number {
  const positionById = new Map(slots.map((slot) => [slot.id, slot.position]));
  return slots.reduce((moved, slot, index) => {
    const id = orderedIds[index];
    return id !== undefined && positionById.get(id) !== slot.position ? moved + 1 : moved;
  }, 0);
}
