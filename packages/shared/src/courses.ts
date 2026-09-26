/**
 * The course wire contract, written once so the API that produces it and the portal that
 * renders it cannot drift apart mid-request. Status and level values are the codes and
 * labels the `CourseStatus` / `CourseLevel` lookup rows carry: a label travels with the
 * code precisely so no client keeps a translation table that goes stale when Ops edits one.
 */

export interface CourseChoice {
  code: string;
  label: string;
}

/**
 * What a teacher says the course will cost. A number and a unit are one thing: `499900` on
 * its own is a fortune in one currency and a rounding error in another, so the pair travels
 * together or the price does not travel at all.
 *
 * The amount is in minor units (paise, cents) exactly as `Money` in this package holds it,
 * because a portal that converted it to a float to render a rupee sign would be doing
 * arithmetic on a figure it is only supposed to print. The currency is a `CourseChoice`
 * rather than a bare code for the same reason the level is one: the label is a lookup row's
 * business, not the client's.
 *
 * `null` — the absence of this object on a course — means "the teacher has not said", which
 * is a different sentence from `minorUnits: 0`, "the teacher says free". A shelf that
 * confused them would be making a promise nobody wrote.
 */
export interface CoursePrice {
  minorUnits: number;
  currency: CourseChoice;
}

/** What a writer sends: the same pair, with the currency named by its code because the code
 * is what a picker holds and the label is what it shows. */
export interface CoursePriceInput {
  minorUnits: number;
  currency: string;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  description: string | null;
  level: CourseChoice;
  status: CourseChoice;
  /** A quote, not a charge: nothing in this platform takes money yet, and an enrollment
   * buys a place rather than a receipt. */
  price: CoursePrice | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseResponse {
  course: Course;
}

export interface CourseListResponse {
  items: Course[];
}

/** What a create sends. `status` is absent on purpose — publishing is a transition the
 * API checks, not a field a form can write. `price` is absent in a plainer way: a course can
 * be published and shelved with no number on it, and a teacher who quotes one writes both
 * halves at once. */
export interface CourseDraftInput {
  title: string;
  level: string;
  slug?: string;
  summary?: string;
  description?: string;
  price?: CoursePriceInput | null;
}

/** What an edit sends: only the fields the person touched, so an untouched one is not
 * rewritten behind their back by a form that loaded a stale copy. */
export type CourseEditInput = Partial<CourseDraftInput>;
