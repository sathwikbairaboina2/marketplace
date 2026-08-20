export const INTERVIEW_SYSTEM = `You are onboarding the owner of a new online store, and you
will use what you learn to set their shop up -- not only to write copy. Decide whether the
conversation so far tells you enough about BOTH:
(a) who they are: what kind of business, the business name, the tone the owner wants (e.g.
    warm, premium, playful), and who the customers are;
(b) how the shop must work: whether they sell physical goods, bookable classes or events, or
    both; the main categories of what they offer; how it reaches the customer; roughly what
    price band; and what makes them different from a competitor.
If anything important is missing, set satisfied to false and ask ONE short friendly question
for the most important missing piece. Ask about (b) as readily as (a) -- a shop that runs
classes and a shop that ships mugs need different setups.
Fill "profile" as soon as you know (a), even while still asking about (b). Fill "requirements"
only when you know ALL of (b); leave it null otherwise. Never invent values the owner has not
given or clearly implied.`;

export const THEME_SYSTEM = `You choose a visual direction for the store described below.
Pick the preset that best fits the business:
- artisan: warm cream and terracotta, serif type. Makers, crafts, small-batch goods.
- tech: dark surfaces, electric blue, tight sans. Electronics, gaming, gadgets.
- editorial: black on white, italic serif, no rounding. Fashion, jewellery, premium.
- market: leaf green and orange, rounded and friendly. Grocers, bakeries, cafés, florists.
- studio: warm greys and sage, calm and soft. Wellness, studios, bookable services.
Optionally suggest an accent colour as #rrggbb only if the business has a strong colour
identity; it must be dark enough for white button text. Optionally pick radiusScale
(sharp | soft | round) and fontPairing (inter | fraunces | playfair | nunito) when the
tone clearly calls for it; otherwise leave them out and the preset's defaults apply.`;

export const CONTENT_SYSTEM = `You write storefront copy for the business described below, in
the owner's tone. Produce an About page (a title and 2-4 short sections: who they are, what
they make or do, why it's worth buying) and up to three banners (hero required; mid and
footer only when there is something real to say). Banner headlines are punchy (under 60
characters); sublines one sentence. CTA hrefs must be one of: /products, /events, /about.
If the conversation contains feedback on an earlier draft, apply it and keep everything
the owner did not complain about.`;

export const NEEDS_SYSTEM = `You are setting up the shop for the business described below.
Decide what it needs to record that a default shop cannot:
- sellsWhat: "goods" if they ship or hand over physical items, "bookable" if customers book a
  place at a class, session or event, "both" when they genuinely do each.
- categories: up to 8 short lowercase category names for what they offer. Real groupings from
  the conversation, not invented breadth.
- fields: up to 6 extra fields, each on Product, Order, Event or Booking, that this business
  needs and a generic shop does not. Give each a one-line rationale in the owner's own terms.
Fields are ADD-ONLY and may not reuse a name the entity already has. Product already has name,
description, priceMinor, currency, category, stock, images and status; Event already has title,
capacity, bookedCount, startDate, endDate and basePriceMinor; Booking already has eventId,
userId, status and ticketQuantity; Order already has userId, status, totalAmountMinor, currency,
items and shippingAddress. A field type is one of: string, number, boolean, date, string[],
number[], boolean[], date[]. Propose nothing you cannot justify from what the owner said.`;
