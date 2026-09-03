# Decisions — the CEO's answers

**Date:** 2026-09-03 · **Written in role** by the session acting as CEO, after
`docs/ROADMAP.md`, `docs/STATUS.md`, the two Theme A designs and
`docs/RESEARCH-shopify-gaps.md`. The plan proceeds under these answers until
the owner overrules one. Each decision says what would reverse it.

## The company in one paragraph

We are not building Shopify. We are building the shop for people who make
something and also teach it: the potter who sells mugs and runs Saturday
classes, the baker with a sourdough course, the framer, the yoga teacher with
a merch rail, the repair shop that books slots. Shopify serves them with a
template and three apps; Wix bolts a bookings module beside a store; nobody
gives them one catalogue, one cart, one order queue and one customer, set up
by describing the business in a conversation. That is the product. Everything
below is in service of the first ten of those merchants taking a stranger's
money through it.

## Decision 1 — Launch market and payments: India first, Stripe second

**Decision.** The first ten merchants are in India; the first real payment
provider is Razorpay (cards, UPI, net banking) with no platform surcharge on
top of the gateway's fee; Stripe follows as the second provider behind the
same `PAYMENT_PROVIDER` seam, before any non-Indian merchant is onboarded.

**Why.** The founder can reach Indian makers in person, which is the only
acquisition channel a team of one has. Shopify Payments is absent in India
and Shopify adds a surcharge on every third-party gateway, so an Indian maker
on Shopify Basic pays roughly four percent per order plus the plan; the local
builders that undercut it charge a flat rupee fee but have no bookings, no
agents and no real storefront. That is the widest gap the research found, and
it is a gap we can walk into with what already exists. The roadmap assumed
Stripe first "because it is provider-agnostic to build against"; the seam
gives us that regardless of which provider is first, so the argument does not
hold and I overrule it.

**Rules out.** Building Stripe first; any pricing that takes a percentage of
payments; launching outside India before Razorpay is live with a real
merchant.

**Reverses it.** Razorpay onboarding for a sole proprietor taking longer than
two weeks for two of the first three merchants, or the first ten interviews
showing makers who teach are not in reach.

## Decision 2 — Pricing: flat, bounded, zero take on payments

**Decision.** Three plans. Free: up to 30 orders or bookings a month, platform
badge on the shop, one staff account. Studio: a flat monthly fee in the region
of ₹999 (about $12), unlimited orders, three staff, custom domain, the agents.
Pro: about ₹2,999 with more staff, image generation and priority support.
Never a percentage of sales, never a per-order fee. Payment processing is the
gateway's fee and nothing else.

**Why.** The single most-cited grievance with Shopify is that the plan is a
floor and the bill is assembled from apps and surcharges; the Indian builders
compete on a flat per-order rupee fee. A flat monthly price a maker can
predict is the cheapest credible promise we can make and the one that
survives a comparison table. A volume-bounded free tier (Square, Ecwid,
Dukaan all do it) lets a maker's first sales cost nothing, which is how a
maker who has never sold online starts at all.

**Rules out.** Usage-based pricing on agents (a token budget per plan
instead), paid apps, revenue share on anything before Theme H.

**Reverses it.** Inference cost per active merchant above a third of the
Studio price after the measurement in decision 4.

## Decision 3 — Hosting: one rented box, not AWS, until ten merchants pay

**Decision.** Production and staging are the Compose stack on a single rented
Linux VM (a Hetzner or DigitalOcean box of about 8 vCPU and 32 GB) behind
Caddy for TLS and wildcard subdomains, with nightly DynamoDB Local and Redis
snapshots to object storage. DynamoDB Local stays the database until the tenth
paying merchant, at which point the AWS path in Theme G is reopened with
CDK. The Redis Stack question (decision #08 in the status docs) is moot on a
VM and stays moot until then.

**Why.** A team of one with no revenue cannot carry ECS, Cognito, SQS, S3,
CloudFront, ElastiCache alternatives and CDK and also ship product. The
Compose stack is already the local truth and boots in six minutes; a VM
running it is a deploy path that costs an afternoon and about $60 a month.
The roadmap's own phase-0 target ("demo tenants reachable on a real URL") is
met this way this week rather than in a month. The risk this takes on is
durability of DynamoDB Local's data file, which nightly snapshots and a
scripted restore drill bound.

**Rules out.** CDK, ECS and ElastiCache work before merchant ten; any
deployment that cannot be reproduced from the Compose file.

**Reverses it.** Losing a merchant's data to a snapshot gap, or a single
merchant whose order volume the box cannot hold.

## Decision 4 — The model: our own, on our own GPU, in production too

**Decision.** "No hosted provider" is confirmed and sharpened: production
inference is the same Ollama image and the same `qwen3.8:27b` weights on a
rented GPU VM (one 24 GB card, about $0.50–1.00 an hour on demand, or a
reserved instance once utilisation justifies it). No OpenAI, Anthropic or
Gemini API in any environment. Before the first merchant, measure cost per
onboarding conversation and per support answer at that price and write the
numbers into `docs/STATUS.md`.

**Why.** The agents are the reason to choose this over Shopify, and the
research shows Shopify's own AI is a copy assistant that hallucinates
attributes and recommends apps. Owning the model is what lets us promise a
merchant that their catalogue, orders and customers never leave a box we
run, which is a real sentence in a sales conversation with a small business
in India. It also keeps every graph prompt tuned against one model, which is
how the eval set in Theme E stays meaningful.

**Rules out.** Any hosted LLM, including "just for the eval set". Per-merchant
GPU isolation before there is a merchant who needs it.

**Reverses it.** Measured inference cost above a third of Studio revenue per
active merchant, or the local-model quality bar failing the eval set on the
onboarding interview.

## Decision 5 — Cancel restores stock: per stage, default on before dispatch

**Decision.** Confirm the roadmap's assumption. A third per-stage switch,
`restocks`, beside `cancellable` and `messageable`; default on for every
stage before the first stage the owner marks as the goods leaving; a
cancellation in a `restocks` stage puts the stock back in the same
transaction that flips the order. Bookings restore capacity on the same rule.

**Why.** It is the only answer that is right for both a mistake at "Received"
and a change of heart at "Shipped", and it is already the shape of every
other order rule in the engine. It closes an open decision with zero new
concepts.

**Reverses it.** Nothing foreseeable; a merchant who wants a stage that
restocks after dispatch flips the switch.

## Decision 6 — Positioning: makers who teach, and say so on the door

**Decision.** Confirm the product-and-service long tail and narrow the
first-year message to one line: *one shop for what you make and what you
teach*. The preset gallery leads with the studio, bakery and atelier skins;
Theme C's order changes so that bookings depth (group classes, multi-session
courses, a second staff member, on the base plan) ships before variants.

**Why.** Every booking app on Shopify gates group classes and a second staff
member behind a higher tier; that is the tier we give away. A maker who only
sells goods has Etsy, Square and Big Cartel; a maker who teaches has nobody
who treats the class and the mug as one catalogue. Narrow beats broad for
the first hundred merchants, and the narrow story still uses every part of
what is built.

**Rules out.** Leading with themes, with variants, or with "AI store builder"
as the headline.

**Reverses it.** Ten interviews in which makers who teach say a separate
booking tool is fine and the pain is elsewhere.

## The quarter

**One metric.** Ten shops that have taken a stranger's money through the
platform in the last thirty days. Not signups, not published stores.

**Deliberately not built before phase 3.** The theme editor and preset
gallery beyond three skins; webhooks and any extensibility; multi-currency;
POS; a mobile app; variants beyond a single option axis; any hosted model.

**Three risks and the cheapest test of each.**
1. *Nobody wants goods and classes in one shop.* Test: twenty conversations
   with makers who teach, this month, before the self-serve work; a landing
   page with the one-line pitch and a wait-list.
2. *Inference costs more than the plan.* Test: one week of the onboarding
   graph and the support agent on a rented GPU, cost per conversation written
   down, before the second merchant.
3. *Payments and KYC stall an Indian sole proprietor.* Test: put one real
   merchant through Razorpay onboarding on our sandbox before building the
   provider properly, and time it.

---

## Addendum, 3 September 2026 — after `docs/DEBATE-surface.md`

The surface debate produced three further decisions. They stand under the
same rule as the six above: the plan proceeds under them until the owner
overrules one.

## Decision 7 — Free bookings, paid at the door, are a product for v1

**Decision.** A class booked online without an account and paid in cash or
by UPI in the room is a booking the platform supports, from week 2, before
Razorpay exists. Guest booking ships ahead of the payment provider.

**Why.** Backlog item 4 asked this and nobody answered. A significant share
of studio teaching in India is sold exactly this way today. Answering yes
makes the wedge demonstrable in the week-2 interviews — a maker books a
place at a real class in her own shop, on her own phone, with no password —
and lets a studio use the platform for its purpose a fortnight before the
gateway.

**Rules out.** Leaving the login wall on the event page for a month; putting
guest booking inside Razorpay's week.

**Reverses it.** Guest booking costing more than three days.

## Decision 8 — A tenant record exists, and carries the plan

**Decision.** From week 3 the engine holds one row per shop — identity,
default currency, timezone, and the plan fields decision 2 needs: `plan`,
`billingAnchor`, `platformBadge`, `agentBudget`, `billingRef` — stored and
unenforced. Enforcement is backlog item 7. It is infrastructure spend, not
design spend, and is reported as such.

**Why.** `TENANT#<id>` is a key prefix, not an item; the shop's name lives
only in a published storefront config; currency is per product; and three
plans cannot be charged for without a field that says which one a merchant
is on. Four later backlog items each need something from this row.

**Rules out.** Free-form brand customisation; a `tenants` module when the
settings seam is 26 lines and proven; any meter or gate this quarter.

**Reverses it.** The record costing more than four days, in which case the
name band-aid stays for the interviews and the record slips behind Razorpay.

## Decision 9 — The stop date

**Decision.** The quarter's metric — ten shops that have taken a stranger's
money through the platform in the last thirty days — starts counting the
week of Monday 5 October 2026, a two-week slip from the debate's plan. If no
stranger has paid a real merchant through the platform by **Monday 19
October 2026**, all surface work stops that morning; the only thing built
from then is the shortest path from one merchant to one payment, ugly if
need be; and decision 6 reopens, because by then the twenty interviews will
have said whether the fault is the wedge or the execution.

**Why.** Two weeks buys a shop that carries the merchant's name, a class a
stranger can book, prices in rupees, an order desk that names the buyer, and
a phone that does not eat the price off a table. Four weeks would not have
been worth it, and an open-ended slip is how a positioning becomes a hobby.

**Rules out.** Any further surface work being scheduled past 19 October
without a payment on the books.

**Reverses it.** Nothing. The founder-run demo studio from week 4 is the
backstop: if it has not taken a payment by 19 October either, the problem is
us, not the market.
