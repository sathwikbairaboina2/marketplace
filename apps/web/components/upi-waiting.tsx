'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Progress } from 'antd';
import type { PaymentIntentResponse } from '@marketplace/contracts';
import { formatPrice } from '../lib/format';

/** How long before the page stops pretending this is going well. */
const PATIENT_MS = 30_000;
/** How long before it says plainly that nothing came back. */
const GIVE_UP_MS = 120_000;
const POLL_MS = 3_000;

/**
 * The screen that waits.
 *
 * The customer is approving in another application, and this page finds out
 * later — or never. So it says what it knows and nothing more.
 *
 * It must never announce a failure on a timeout: "we haven't heard back yet"
 * and "you were not charged" are different sentences, and only the first one
 * is true. It must never offer a second Pay button, because a shopper who
 * presses it while the first request is still in flight pays twice. It must
 * never navigate on its own. And it must never lose the order number, which is
 * the one string that gets this order back.
 */
export function UpiWaiting({
  amountMinor,
  currency,
  reference,
  approvalUrl,
  onCheck,
  onSettled,
  onGiveUp,
}: {
  amountMinor: number;
  currency: string;
  reference: string;
  approvalUrl?: string;
  /** Asks the engine what became of the attempt. */
  onCheck: () => Promise<PaymentIntentResponse>;
  onSettled: (result: PaymentIntentResponse) => void;
  /** Abandon this attempt and go back to choosing how to pay. */
  onGiveUp: () => void;
}) {
  const [waitedMs, setWaitedMs] = useState(0);
  const [checking, setChecking] = useState(false);
  const settled = useRef(false);

  // The pay form was scrolled to when the shopper filled it in, so without
  // this the waiting screen opens with its explanation above the fold and the
  // customer sees a progress bar and no sentence.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => setWaitedMs(Date.now() - started), 1_000);

    const poll = setInterval(() => {
      if (settled.current) return;
      void onCheck()
        .then((result) => {
          if (result.state !== 'pending' && !settled.current) {
            settled.current = true;
            onSettled(result);
          }
        })
        .catch(() => {
          // A failed check is not a failed payment. Keep waiting; the page
          // already says what it does and does not know.
        });
    }, POLL_MS);

    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [onCheck, onSettled]);

  const patient = waitedMs >= PATIENT_MS;
  const gaveUp = waitedMs >= GIVE_UP_MS;

  return (
    <div className="mp-waiting">
      <h2>{formatPrice(amountMinor, currency)}</h2>
      <p className="mp-waiting-lead">
        {gaveUp
          ? 'We have not heard back about this payment yet.'
          : patient
            ? 'Still waiting for your bank.'
            : 'Approve the request in your UPI app.'}
      </p>

      {/* Indeterminate, and no countdown: a number ticking towards zero
          promises something this page cannot promise. */}
      {!gaveUp && (
        <Progress
          percent={100}
          status="active"
          showInfo={false}
          strokeColor="var(--mp-primary)"
        />
      )}

      <p className="mp-waiting-ref">
        Order <strong className="mp-num">{reference}</strong>
      </p>

      {/* A real Button wrapping a link: the antd class names are hashed at
          build time, so hand-written ones style nothing. */}
      {approvalUrl && !gaveUp && (
        <Button type="primary" size="large" href={approvalUrl}>
          Open the payment request
        </Button>
      )}

      {/* Not a second Pay button. This asks the engine what it already knows;
          it can never start another payment. */}
      {patient && (
        <Button
          loading={checking}
          onClick={() => {
            setChecking(true);
            void onCheck()
              .then((result) => {
                if (result.state !== 'pending' && !settled.current) {
                  settled.current = true;
                  onSettled(result);
                }
              })
              .finally(() => setChecking(false));
          }}
        >
          I have paid — check again
        </Button>
      )}

      {gaveUp && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 'var(--mp-space-4)' }}
          message="Nothing has been taken from your account by us"
          description={
            <>
              If your bank shows the money as gone, keep the order number above and get in touch —
              the shop can find it. Otherwise you can try again.
            </>
          }
        />
      )}

      {patient && (
        <Button type="link" onClick={onGiveUp}>
          Pay a different way
        </Button>
      )}
    </div>
  );
}
