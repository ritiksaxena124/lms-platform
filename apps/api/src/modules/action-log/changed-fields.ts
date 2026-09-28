/**
 * The fields a patch actually moved, named the way the API names them.
 *
 * A record is earned by a write that *changed something*, and a patch body is a list of what the
 * caller sent rather than a list of what moved: a form that posts the title back unchanged is a no-op
 * that would otherwise file an edit nobody made, and a price cleared on a course that never had one
 * would file a decision that was already made. So every service taking a patch answers the same two
 * questions here — did any of it move, and what is each field called in the language of the API
 * rather than of the table.
 *
 * The names come out sorted, so two presses that moved the same two fields write the same string and
 * a reader can compare them without treating a set as a fact.
 *
 * `fieldByColumn` is where the two languages are reconciled, and it is allowed to name one field for
 * two columns: a price is one decision even though `price_minor_units` and `price_currency_value_id`
 * move together, and a `Set` is what keeps that pair from reading as two edits in one press.
 *
 * Both row arguments are read by key rather than by shape, so they are typed as the loosest thing
 * that still answers `Object.entries`. A caller's column bag is a `Prisma` payload as often as it is
 * a literal, and an interface has no implicit index signature — a function comparing two rows should
 * not ask every caller to spread one of them to satisfy it.
 */
export function movedFields(
  before: object,
  columns: object,
  fieldByColumn: Record<string, string>,
): string[] {
  const standing = before as Record<string, unknown>;
  const next = columns as Record<string, unknown>;
  const names = new Set<string>();

  for (const [column, value] of Object.entries(next)) {
    if (standing[column] === value) continue;
    names.add(fieldByColumn[column] ?? column);
  }

  return [...names].sort();
}
