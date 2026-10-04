import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClassRoll } from '@lms/shared';

import { ApiError } from '@/lib/api';

import { RollSheet } from './roll-sheet';

const api = vi.hoisted(() => ({ myClassRoll: vi.fn(), saveClassRoll: vi.fn() }));
const session = vi.hoisted(() => ({
  value: { status: 'signed-in', user: { timezone: 'Asia/Kolkata' } },
}));
const { notify } = vi.hoisted(() => ({ notify: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/lib/class-roll', () => api);
vi.mock('./session-provider', () => ({ useSession: () => session.value }));
vi.mock('@lms/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, notify };
});

function roll(overrides: Partial<ClassRoll> = {}): ClassRoll {
  return {
    classId: 'o1',
    course: { id: 'c1', slug: 'veena-basics', title: 'Veena Basics' },
    startsAt: '2026-09-28T04:00:00.000Z',
    endsAt: '2026-09-28T04:45:00.000Z',
    canMark: true,
    lines: [
      { id: 'a1', student: { id: 's1', fullName: 'Sima Kundu' }, status: 'present' },
      { id: 'a2', student: { id: 's2', fullName: 'Arun Basu' }, status: null },
    ],
    ...overrides,
  };
}

function sheet(name: string): HTMLElement {
  const found = screen.queryByRole('list', { name });
  if (!found) throw new Error(`no list named "${name}" on the page`);
  return found;
}

function row(fullName: string): HTMLElement {
  const found = within(sheet('The roll'))
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(fullName));
  if (!found) throw new Error(`no row for ${fullName}`);
  return found as HTMLElement;
}

function mark(name: string, word: 'Present' | 'Absent'): HTMLButtonElement {
  return within(row(name)).getByRole('button', { name: `${word} ${name}` });
}

beforeEach(() => {
  api.myClassRoll.mockReset().mockResolvedValue(roll());
  api.saveClassRoll.mockReset().mockResolvedValue(roll());
  notify.success.mockReset();
  notify.error.mockReset();
});

/**
 * The sheet a teacher goes down after the lesson.
 *
 * The tests here are mostly about what a mark is *not*: a line nobody marked carries no word, a
 * class that has not started cannot be marked from here, and the roll the screen shows after a save
 * is the one the API read back rather than the one that was typed.
 */
describe('RollSheet', () => {
  it('names every student the class stands for, with the mark already on the line', async () => {
    render(<RollSheet classId="o1" />);

    await screen.findByRole('list', { name: 'The roll' });

    expect(mark('Sima Kundu', 'Present')).toHaveAttribute('aria-pressed', 'true');
    expect(mark('Sima Kundu', 'Absent')).toHaveAttribute('aria-pressed', 'false');
    expect(mark('Arun Basu', 'Present')).toHaveAttribute('aria-pressed', 'false');
    expect(mark('Arun Basu', 'Absent')).toHaveAttribute('aria-pressed', 'false');
  });

  it('says which class this is and when it ran, on the teacher’s own clock', async () => {
    render(<RollSheet classId="o1" />);

    const heading = await screen.findByRole('heading', { name: 'Veena Basics' });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('Mon 28 Sept, 09:30–10:15')).toBeInTheDocument();
  });

  it('sends the whole sheet when the teacher saves, marks and all', async () => {
    render(<RollSheet classId="o1" />);
    await screen.findByRole('list', { name: 'The roll' });

    await userEvent.click(mark('Arun Basu', 'Present'));
    await userEvent.click(screen.getByRole('button', { name: 'Save roll' }));

    await vi.waitFor(() =>
      expect(api.saveClassRoll).toHaveBeenCalledWith('o1', {
        lines: [
          { studentId: 's1', status: 'present' },
          { studentId: 's2', status: 'present' },
        ],
      }),
    );
  });

  it('pressing the word a line already wears takes the mark off', async () => {
    render(<RollSheet classId="o1" />);
    await screen.findByRole('list', { name: 'The roll' });

    await userEvent.click(mark('Sima Kundu', 'Present'));
    expect(mark('Sima Kundu', 'Present')).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Save roll' }));

    await vi.waitFor(() =>
      expect(api.saveClassRoll).toHaveBeenCalledWith('o1', {
        lines: [
          { studentId: 's1', status: null },
          { studentId: 's2', status: null },
        ],
      }),
    );
  });

  it('shows the tally of the sheet as it stands, because a missed name is the failure here', async () => {
    render(<RollSheet classId="o1" />);
    await screen.findByRole('list', { name: 'The roll' });

    expect(screen.getByText(/1 present · 0 absent · 1 unmarked/)).toBeInTheDocument();

    await userEvent.click(mark('Arun Basu', 'Absent'));
    expect(screen.getByText(/1 present · 1 absent · 0 unmarked/)).toBeInTheDocument();
  });

  it('renders the roll the table read back rather than the one that was typed', async () => {
    api.saveClassRoll.mockResolvedValue(
      roll({
        lines: [
          { id: 'a1', student: { id: 's1', fullName: 'Sima Kundu' }, status: 'absent' },
          { id: 'a2', student: { id: 's2', fullName: 'Arun Basu' }, status: 'absent' },
        ],
      }),
    );

    render(<RollSheet classId="o1" />);
    await screen.findByRole('list', { name: 'The roll' });

    await userEvent.click(mark('Arun Basu', 'Present'));
    await userEvent.click(screen.getByRole('button', { name: 'Save roll' }));

    await vi.waitFor(() =>
      expect(mark('Sima Kundu', 'Absent')).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(mark('Arun Basu', 'Present')).toHaveAttribute('aria-pressed', 'false');
    expect(notify.success).toHaveBeenCalledWith('Roll saved');
  });

  it('keeps the marks shut until the class has started', async () => {
    api.myClassRoll.mockResolvedValue(roll({ canMark: false }));

    render(<RollSheet classId="o1" />);
    await screen.findByRole('list', { name: 'The roll' });

    expect(mark('Sima Kundu', 'Present')).toBeDisabled();
    expect(mark('Sima Kundu', 'Absent')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save roll' })).not.toBeInTheDocument();
    expect(screen.getByText(/opens when the class starts/i)).toBeInTheDocument();
  });

  it('says so when a class stands for nobody', async () => {
    api.myClassRoll.mockResolvedValue(roll({ lines: [] }));

    render(<RollSheet classId="o1" />);

    await screen.findByText(/nobody is on this roll/i);
    expect(screen.queryByRole('list', { name: 'The roll' })).not.toBeInTheDocument();
  });

  it('names the reason the roll stayed shut and reads it again on a press', async () => {
    api.myClassRoll
      .mockRejectedValueOnce(
        new ApiError({
          statusCode: 404,
          code: 'NOT_FOUND',
          message: 'No class here is yours to mark.',
          details: undefined,
          requestId: null,
        }),
      )
      .mockResolvedValueOnce(roll());

    render(<RollSheet classId="o1" />);

    await screen.findByText('No class here is yours to mark.');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    await vi.waitFor(() =>
      expect(screen.getByRole('list', { name: 'The roll' })).toBeInTheDocument(),
    );
    expect(api.myClassRoll).toHaveBeenCalledTimes(2);
  });

  it('takes a refusal as a refresh, because the sheet underneath may have moved', async () => {
    api.saveClassRoll.mockRejectedValue(
      new ApiError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'No class here is yours to mark.',
        details: undefined,
        requestId: null,
      }),
    );

    render(<RollSheet classId="o1" />);
    await screen.findByRole('list', { name: 'The roll' });

    await userEvent.click(mark('Arun Basu', 'Present'));
    await userEvent.click(screen.getByRole('button', { name: 'Save roll' }));

    await vi.waitFor(() => expect(notify.error).toHaveBeenCalled());
    await vi.waitFor(() => expect(api.myClassRoll).toHaveBeenCalledTimes(2));
    // The re-read lands after the call, so the sheet the screen shows is the one that came back.
    await vi.waitFor(() =>
      expect(mark('Arun Basu', 'Present')).toHaveAttribute('aria-pressed', 'false'),
    );
  });

  it('will not send the same sheet twice while the first is still in the air', async () => {
    let release: ((value: ClassRoll) => void) | undefined;
    api.saveClassRoll.mockImplementation(
      () =>
        new Promise<ClassRoll>((resolve) => {
          release = resolve;
        }),
    );

    render(<RollSheet classId="o1" />);
    await screen.findByRole('list', { name: 'The roll' });

    await userEvent.click(mark('Arun Basu', 'Present'));
    const save = screen.getByRole('button', { name: /save roll/i });
    await userEvent.click(save);

    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(api.saveClassRoll).toHaveBeenCalledTimes(1);

    release?.(roll());
    await vi.waitFor(() => expect(notify.success).toHaveBeenCalled());
  });

  it('closes the save until something is actually marked', async () => {
    render(<RollSheet classId="o1" />);
    await screen.findByRole('list', { name: 'The roll' });

    expect(screen.getByRole('button', { name: 'Save roll' })).toBeDisabled();

    await userEvent.click(mark('Arun Basu', 'Present'));
    expect(screen.getByRole('button', { name: 'Save roll' })).toBeEnabled();
  });
});
