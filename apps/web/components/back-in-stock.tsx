'use client';

import { useState } from 'react';
import { Alert, Button, Input } from 'antd';
import { joinWaitlist } from '../lib/api/shop';
import { useShop } from '../lib/shop/shop-context';
import { notifyProblem } from '../lib/problem-notify';

/**
 * What a shopper can do on the page of a thing they cannot buy.
 *
 * For a maker of one-of-a-kind pieces, "Sold out" is the *normal* state of the
 * shop rather than an error, and the page offered a disabled button and
 * nothing else. This replaces it.
 *
 * Confirmed inline rather than by a toast: the answer belongs where the
 * question was asked, and a toast on a phone lands at the other end of the
 * page from the thumb.
 */
export function BackInStock({ productId }: { productId: string }) {
  const shop = useShop();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);

  // Only a shop host can take this: on the platform host there is no tenant in
  // the address to ask.
  if (!shop) return null;

  if (asked) {
    return (
      <Alert
        type="success"
        showIcon
        style={{ marginTop: 'var(--mp-space-4)' }}
        message="We will write to you when there is another one"
        description="One message, about this piece. Nothing else."
      />
    );
  }

  const submit = async () => {
    const typed = email.trim();
    if (!typed) return;
    setBusy(true);
    try {
      await joinWaitlist(shop.tenantId, productId, typed);
      setAsked(true);
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mp-restock">
      <p className="mp-restock-lead">
        Every piece is made one at a time. Leave your email and we will tell you when the next
        one is out of the kiln.
      </p>
      <div className="mp-restock-row">
        <Input
          type="email"
          value={email}
          placeholder="you@example.com"
          autoComplete="email"
          aria-label="Email for a restock message"
          onChange={(e) => setEmail(e.target.value)}
          onPressEnter={() => void submit()}
        />
        <Button type="primary" size="large" loading={busy} onClick={() => void submit()}>
          Tell me
        </Button>
      </div>
    </div>
  );
}
