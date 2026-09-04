import { BookingResponse, OrderResponse, ProductResponse } from '@marketplace/contracts';

/**
 * What the shop actually says. Plain text, because this is the first thing
 * this product has ever sent and a customer reading it on a phone needs the
 * order number and nothing else to work.
 *
 * The reference leads every message: it is the one string a shopper is asked
 * to keep, and burying it under a greeting is how it gets lost.
 */
export function orderConfirmation(
  order: OrderResponse,
  shopName: string,
  money: (minor: number) => string,
): { subject: string; body: string } {
  const collecting = order.fulfilment === 'collection';
  const lines = [
    `Your order number is ${order.reference}.`,
    '',
    `Total: ${money(order.totalAmountMinor)}`,
  ];
  if (order.balanceDueMinor > 0) {
    lines.push(
      `Paid now: ${money(order.totalAmountMinor - order.balanceDueMinor)}`,
      `To pay ${collecting ? 'when you collect' : 'on delivery'}: ${money(order.balanceDueMinor)}`,
    );
  }
  lines.push(
    '',
    collecting
      ? 'You are collecting this one. We will call you when it is ready.'
      : 'We will let you know when it is on its way.',
    '',
    `Keep this number with the email address you gave — together they find the order again from any browser.`,
    '',
    shopName,
  );
  return { subject: `${shopName}: order ${order.reference}`, body: lines.join('\n') };
}

export function bookingConfirmation(
  booking: BookingResponse,
  eventTitle: string,
  when: string,
  where: string | undefined,
  shopName: string,
): { subject: string; body: string } {
  const lines = [
    `Your booking number is ${booking.reference}.`,
    '',
    eventTitle,
    when,
  ];
  if (where) lines.push(where);
  lines.push(
    '',
    `${booking.ticketQuantity} ${booking.ticketQuantity === 1 ? 'place' : 'places'} reserved.`,
    '',
    shopName,
  );
  return { subject: `${shopName}: ${eventTitle}`, body: lines.join('\n') };
}

export function backInStock(
  product: ProductResponse,
  shopName: string,
  url: string,
): { subject: string; body: string } {
  return {
    subject: `${shopName}: ${product.name} is back`,
    body: [
      `${product.name} is out of the kiln and back on the shop.`,
      '',
      url,
      '',
      'One of a kind, so it may not last — this is the only message you will get about it.',
      '',
      shopName,
    ].join('\n'),
  };
}
