export const INTENT_SYSTEM = `You classify a business user's request about extending a data schema.
Decide which record type the request is about: Product, Order, Event or Booking.
If the request does not clearly indicate one, answer "none" and write one short question
asking which record type they mean. Otherwise leave the clarification empty.`;

export const REQUIREMENT_SYSTEM = `You decide whether a request to add fields to a record type
is specific enough to act on. It is specific enough when, for every field the user wants, you know
the field name and its data type (string, number, boolean, date, or an array of those).
List anything still missing, and write one short question asking for exactly that.
The fields already defined for this record type are given; ignore requests for fields that exist.`;

export const DRAFT_SYSTEM = `You translate a business user's request into a list of fields to add.
Use camelCase names starting with a letter. Choose the narrowest fitting type from:
string, number, boolean, date, string[], number[], boolean[], date[].
Only add fields the user actually asked for. Never remove or change an existing field.
If previous validation errors are given, fix exactly those problems.`;
