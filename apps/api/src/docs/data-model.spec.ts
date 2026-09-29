import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectModels, renderDataModel, type ModelDoc } from './data-model';

const COMMITTED = resolve(process.cwd(), '../site/content/data-model.json');

function find(models: ModelDoc[], name: string): ModelDoc {
  const found = models.find((model) => model.name === name);

  if (!found) {
    throw new Error(`${name} is not in the export`);
  }
  return found;
}

describe('the data model reference', () => {
  const models = collectModels();

  it('reads every model the schema declares', () => {
    expect(models).toHaveLength(16);
    expect(models.map((model) => model.name)).toEqual(
      expect.arrayContaining(['User', 'Course', 'Module', 'Lesson', 'Booking', 'ActionLog']),
    );
    // `@@map` is how a model gets its snake_case table name, so a model without one is this export
    // inventing a table the database does not have.
    for (const model of models) {
      expect(model.table, model.name).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it('names the rows a model points at and the column each pointer lives in', () => {
    // `Booking` is the row where the whole loop comes together, so its five pointers are the most
    // useful thing on the page — and the two that both go to `User` have to be told apart.
    expect(find(models, 'Booking').relations).toEqual(
      expect.arrayContaining([
        { field: 'student', type: 'User', columns: ['studentUserId'], onDelete: 'Restrict' },
        { field: 'teacher', type: 'User', columns: ['teacherUserId'], onDelete: 'Restrict' },
        { field: 'course', type: 'Course', columns: ['courseId'], onDelete: 'Restrict' },
      ]),
    );
  });

  it('lists the columns under the names the database uses', () => {
    const booking = find(models, 'Booking');

    expect(booking.columns).toEqual(
      expect.arrayContaining([
        { name: 'studentUserId', column: 'student_user_id', type: 'String', optional: false },
        { name: 'slotHeldAt', column: 'slot_held_at', type: 'DateTime', optional: true },
        { name: 'id', column: 'id', type: 'String', optional: false },
      ]),
    );
    // A pointer is not a column: the foreign key beside it is, and listing both would show one fact
    // twice under two names.
    expect(booking.columns.map((column) => column.name)).not.toContain('student');
    expect(booking.columns).toHaveLength(13);
  });

  it('reports no referential action but Restrict anywhere', () => {
    // The rule the conventions page states as prose: nothing cascades, so a delete that would take
    // a teacher's history with it is refused by the database rather than quietly carried out. It is
    // worth a test because the sentence is only true while every relation holds the line.
    const actions = models.flatMap((model) => model.relations.map((relation) => relation.onDelete));

    expect(actions.length).toBeGreaterThan(20);
    expect([...new Set(actions)]).toEqual(['Restrict']);
  });

  it('keeps the ledger the one table that cannot be edited or retired', () => {
    // Every other row is soft-deleteable and timestamped. A record of what somebody did is allowed
    // neither: retiring it would be the same act of rewriting it.
    const ledger = find(models, 'ActionLog');

    expect(ledger.softDelete).toBe(false);
    expect(ledger.tracksUpdates).toBe(false);
    expect(models.filter((model) => !model.softDelete)).toEqual([ledger]);
    expect(models.filter((model) => !model.tracksUpdates)).toEqual([ledger]);
  });

  it('records the keys that cannot repeat', () => {
    const booking = find(models, 'Booking');

    // The slot hold is the pair that keeps two learners off one minute, and the nullable room name
    // is a one-field key — both are the kind of fact a reader checks this page for.
    expect(booking.uniqueKeys).toContainEqual(['teacherUserId', 'slotHeldAt']);
    expect(booking.uniqueKeys).toContainEqual(['roomName']);
    expect(find(models, 'User').uniqueKeys).toContainEqual(['email']);
  });

  it('matches the file the public docs render', () => {
    // Same bargain as the route table: committed so the static build has it, compared so a schema
    // change without a re-export is a red gate rather than a stale page.
    const committed = readFileSync(COMMITTED, 'utf8').replace(/\r\n/g, '\n');

    expect(committed).toBe(renderDataModel());
  });
});
