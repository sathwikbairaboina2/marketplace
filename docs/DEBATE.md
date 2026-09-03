# The debate — CEO and Product Manager, two rounds

**Date:** 2026-09-03 · Both roles were played by the session, in turn, each
arguing from its own document and from `docs/RESEARCH-shopify-gaps.md`. The
point of writing it down is that the disagreements are the decisions; the
agreements are already in `docs/DECISIONS.md` and `docs/BACKLOG.md`. The
owner's own reading of the product — "nowhere close to competing with
Shopify" — was the prompt for the round, and both roles were asked to take
it as true rather than argue with it.

## Round 1 — the PM on the CEO's decisions

**On "not close to Shopify".** Correct, and it should stay correct. The
research is unambiguous that nobody beats Shopify at being Shopify; the
platforms that grow beside it each own one thing — no monthly fee, bookings
in the box, a flat rupee fee. The mistake to avoid is a backlog that tries
to close the feature gap item by item. The CEO's decisions mostly avoid it;
two do not.

**Decision 1, India first.** Agreed on the market; disagree on the sequence
implied. Razorpay before a shop is on a real URL is building a webhook with
nowhere to receive it. The VM comes first, in days, then the provider. The
backlog orders it that way.

**Decision 2, pricing.** Agreed on flat and on zero take. Disagree with
"unlimited orders" on Studio at ₹999: the research shows Shoopy's flat
per-order fee after a threshold and Dukaan's capped percentage exist because
a shop doing five hundred orders a month at ₹999 costs its host more than
₹999 in inference and support. Propose: Studio unlimited *orders*, but the
agents carry a monthly conversation budget per plan, surfaced as a problem
document, as Theme E already planned. The CEO's decision 4 measurement
decides the number.

**Decision 3, one VM.** Agreed entirely. The roadmap's Theme G is a
large-company plan for a one-person company. The one thing to add: the
restore drill is not optional, it is item 1's acceptance test.

**Decision 4, own GPU.** Agreed, with a challenge: the roadmap's model
decision was taken before anybody priced a GPU hour per merchant. Until the
measurement exists, decision 2's prices are guesses. The backlog puts the
measurement before the second merchant, not the tenth.

**Decision 6, makers who teach, bookings before variants.** This is the
real disagreement, and the PM concedes it. The PM's instinct was variants
first, because every maker sells a mug in three sizes and the roadmap ranked
variants first "by how often the long tail needs it". The research changes
the ranking: variants are table stakes everybody has, and a maker who only
needs variants has Etsy and Square today; sessions, courses and a second
staff member on the base plan are what nobody gives away. Bookings depth
moves to item 4, variants to item 9. The PM asks one concession back: a
single option axis (size *or* colour) inside the first quarter, because the
interviews will surface it and "later" reads as "never" to a potter.

**What the CEO's document does not say.** Who does the twenty interviews,
when, and what stops the build if they come back wrong. A decision without
a kill criterion is a preference. The PM proposes: interviews in week 2,
written up in `docs/`, and if fewer than five of twenty makers who teach
say they would pay ₹999 a month for one shop for both, decision 6 is
reopened before item 5 starts.

## Round 2 — the CEO on the PM's backlog

**On sequence.** Accepted: VM, then Razorpay, then email, then bookings.
The CEO's decisions were written as if the URL already existed; it does not.

**On scope creep in item 4.** Sessions, courses, staff, attendance, check-in,
buyer cancellation, guest booking in six days is optimistic by the PM's own
calibration (guest checkout: one day, forty files, and it touched fewer
concepts). Cut check-in and buyer cancellation from the first pass; a
studio owner marks attendance on paper for the first month and cancels from
the cockpit on the buyer's behalf. Six days becomes four, and the two saved
days go to the interviews.

**On item 5 before item 6.** The PM has self-serve signup (5) before
customers-not-staff (6). The CEO would swap them if signup were the goal;
it is not. The goal is ten shops with a stranger's money, and the first ten
merchants can be provisioned by hand from a seed script in an afternoon
each. Customers-not-staff, on the other hand, is what makes a guest's second
purchase possible and is the natural home for the guest ticket that already
exists. But the CEO accepts the PM's order for one reason the PM did not
give: the onboarding agent is the demo, and a merchant who signs up alone
and reaches a published shop is the sales pitch made by the product. Keep 5
before 6; provision the first three merchants by hand anyway, in parallel,
so the metric starts before item 5 lands.

**On pricing and the conversation budget.** Accepted. Studio: unlimited
orders, a monthly agent budget with a visible meter, top-ups on Pro. This is
the only usage-based element and it is on the one thing that costs us by
the token.

**On the kill criterion.** Accepted as written: interviews in week 2, five of
twenty, or decision 6 reopens before item 5.

**On what the backlog still has too much of.** Items 14 to 17 are a second
quarter and should say so in one line rather than four sections; a reader
skimming the backlog should see nine items, not eighteen. The PM keeps the
long form in the file for the sizing record and adds a nine-item view at the
top of the strategy document instead.

**On what is missing.** A demo shop that is *ours* — a real studio, real
classes, real mugs, real stranger's money — run by the founder, on the
platform, from week 4. It is the eleventh merchant, the one that never
churns, and the one every interview can be shown. The CEO adds it to the
strategy as a standing commitment rather than a backlog item.

## What changed because of the debate

1. Sequence: VM before Razorpay, email before bookings, bookings before
   variants (both agreed).
2. Item 4 loses check-in and buyer self-cancellation in its first pass; four
   days, not six.
3. Studio pricing gains a monthly agent budget with a meter; orders stay
   unlimited.
4. A kill criterion on the positioning: five of twenty makers who teach, by
   week 2, or decision 6 reopens.
5. The first three merchants are provisioned by hand in parallel with the
   self-serve work so the metric starts in week 4.
6. A founder-run demo studio on the platform from week 4.
7. One option axis for variants inside the first quarter (item 9 pulled to
   the end of week 12, not next quarter).
