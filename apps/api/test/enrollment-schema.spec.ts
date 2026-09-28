import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COURSE_LEVEL_CODES, COURSE_STATUS_CODES, LKP_TYPE_CODES, ROLE_CODES } from '@lms/shared';

import { seedLookups } from '../src/reference/seed-lookups';

/**
 * What the `enrollment` table promises with no HTTP in the way: that a student holds one
 * place in a course rather than several competing ones, that leaving does not put that place
 * up for grabs, that a course a student is inside of cannot be deleted underneath them, and
 * that the row is written by a person with a role — not by a flag copied onto the course.
 *
 * Whether a person may enroll is decided by the endpoint that makes one: the table only knows
 * that somebody did, and when.
 */
const RUN = randomUUID().slice(0, 8);
const emailFor = (name: string) => `${name}.${RUN}@localtest.me`;

const prisma = new PrismaClient();

async function lookupValue(typeCode: string, code: string): Promise<string> {
  return (await prisma.lkpValue.findFirstOrThrow({ where: { type: { code: typeCode }, code } })).id;
}

let teacherRoleId: string;
let studentRoleId: string;
let activeStatusId: string;
let beginnerId: string;
let courseDraftId: string;

const createUser = (email: string, roleValueId: string) =>
  prisma.user.create({
    data: {
      email,
      passwordHash: 'scrypt$placeholder',
      fullName: 'Enrollment Schema Test',
      timezone: 'Asia/Kolkata',
      roleValueId,
      statusValueId: activeStatusId,
    },
  });

const createStudent = (email: string) => createUser(email, studentRoleId);
const createTeacher = (email: string) => createUser(email, teacherRoleId);

async function createCourse(teacherId: string, slug: string) {
  return prisma.course.create({
    data: {
      teacherUserId: teacherId,
      title: 'Fractions, slowly',
      slug,
      levelValueId: beginnerId,
      statusValueId: courseDraftId,
    },
  });
}

const enroll = (studentId: string, courseId: string) =>
  prisma.enrollment.create({ data: { studentUserId: studentId, courseId } });

beforeAll(async () => {
  await seedLookups(prisma);
  teacherRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.TEACHER);
  studentRoleId = await lookupValue(LKP_TYPE_CODES.USER_ROLE, ROLE_CODES.STUDENT);
  activeStatusId = await lookupValue(LKP_TYPE_CODES.ACCOUNT_STATUS, 'active');
  beginnerId = await lookupValue(LKP_TYPE_CODES.COURSE_LEVEL, COURSE_LEVEL_CODES.BEGINNER);
  courseDraftId = await lookupValue(LKP_TYPE_CODES.COURSE_STATUS, COURSE_STATUS_CODES.DRAFT);
});

afterAll(async () => {
  const userIds = (
    await prisma.user.findMany({ where: { email: { contains: `.${RUN}@` } }, select: { id: true } })
  ).map((row) => row.id);
  const courseIds = (
    await prisma.course.findMany({ where: { teacherUserId: { in: userIds } }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.enrollment.deleteMany({ where: { studentUserId: { in: userIds } } });
  await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.mailOutbox.deleteMany({ where: { recipientUserId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('enrollment table', () => {
  it('claims one place per student per course, and no more', async () => {
    const owner = await createTeacher(emailFor('owner'));
    const student = await createStudent(emailFor('student'));
    const course = await createCourse(owner.id, `one-place-${RUN}`);
    const other = await createCourse(owner.id, `second-course-${RUN}`);

    await enroll(student.id, course.id);

    // Two rows for the same pair would read as a student enrolled twice, which is two
    // answers to the one question this row exists to answer — and a roster that counts
    // bodies would start counting the same body more than once.
    await expect(enroll(student.id, course.id)).rejects.toMatchObject({ code: 'P2002' });
    // A second course is a second decision, so the key is the pair and not the student.
    await expect(enroll(student.id, other.id)).resolves.toMatchObject({ courseId: other.id });
  });

  it('keeps a place claimed after the student leaves', async () => {
    const owner = await createTeacher(emailFor('leaver-owner'));
    const student = await createStudent(emailFor('leaver'));
    const course = await createCourse(owner.id, `left-${RUN}`);

    const first = await enroll(student.id, course.id);
    await prisma.enrollment.update({ where: { id: first.id }, data: { isActive: false } });

    // Leaving is a state of the one record that this person enrolled here, not an
    // erasure of it — so the way back is the same row reopened, never a second row that
    // would leave the roster with two truths about the same student.
    await expect(enroll(student.id, course.id)).rejects.toMatchObject({ code: 'P2002' });

    const again = await prisma.enrollment.update({
      where: { id: first.id },
      data: { isActive: true },
    });
    expect(again.id).toBe(first.id);
    // And the date they first walked in survives the visit, because "enrolled since" is a
    // fact about the first enrollment, not about the most recent one.
    expect(again.createdAt).toEqual(first.createdAt);
  });

  it('starts an enrollment active', async () => {
    const owner = await createTeacher(emailFor('defaults-owner'));
    const student = await createStudent(emailFor('defaults'));
    const course = await createCourse(owner.id, `defaults-${RUN}`);

    const created = await enroll(student.id, course.id);

    // A row written by an enroll button is the button's whole answer; nothing is pending.
    // A default of `false` would file a silent refusal under a success message.
    expect(created).toMatchObject({ isActive: true, studentUserId: student.id, courseId: course.id });
  });

  it('will not name a student or a course that does not exist', async () => {
    const owner = await createTeacher(emailFor('ghost-owner'));
    const student = await createStudent(emailFor('ghost'));
    const course = await createCourse(owner.id, `ghost-${RUN}`);

    await expect(enroll(randomUUID(), course.id)).rejects.toThrow();
    await expect(enroll(student.id, randomUUID())).rejects.toThrow();
  });

  it('will not let a course disappear while a student is inside it', async () => {
    const owner = await createTeacher(emailFor('kept-owner'));
    const student = await createStudent(emailFor('kept'));
    const course = await createCourse(owner.id, `kept-${RUN}`);
    await enroll(student.id, course.id);

    // Archiving is what retires a course. A delete that swept enrollments with it would
    // erase the reason a student could read pages they had already worked through.
    await expect(prisma.course.delete({ where: { id: course.id } })).rejects.toThrow();
  });

  it('makes no decision about who may enroll', async () => {
    const owner = await createTeacher(emailFor('self-owner'));
    const course = await createCourse(owner.id, `self-${RUN}`);

    // A teacher taking their own course is refused by the endpoint, not by a constraint:
    // the table has no notion of ownership, and encoding one here would put a business
    // rule where a lookup row can change it.
    await expect(enroll(owner.id, course.id)).resolves.toMatchObject({
      studentUserId: owner.id,
    });
  });
});
