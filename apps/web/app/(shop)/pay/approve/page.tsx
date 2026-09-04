'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Card } from 'antd';
import { useShop } from '../../../../lib/shop/shop-context';
import { ENGINE_URL } from '../../../../lib/env';
import { PageHeader } from '../../../../components/page-header';

/**
 * A banking app, for a stack that does not have one.
 *
 * This exists only where the local payment provider is running. Approving here
 * does not mark anything paid: it asks the engine to sign a gateway-shaped
 * message and deliver it to its own webhook route, so a local run exercises
 * signature verification, the replay claim, the amount re-check and the
 * conditional write — the same code a real gateway will reach.
 *
 * "Walk away" is a first-class choice because it is the one this product
 * handled worst: somebody who opens their banking app and thinks better of it
 * used to leave a one-of-a-kind piece reserved for ever.
 */
function Approve() {
  const params = useSearchParams();
  const router = useRouter();
  const shop = useShop();
  const intentId = params.get('intent') ?? '';
  const [done, setDone] = useState<'approved' | 'declined' | null>(null);
  const [busy, setBusy] = useState(false);

  const decide = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${ENGINE_URL}/payments/local/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intentId }),
      });
      const body = (await res.json()) as { approved?: boolean };
      setDone(body.approved ? 'approved' : 'declined');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Approve this payment"
        subtitle="Standing in for your UPI app, because this stack does not have one."
      />
      <Card className="mp-form-card">
        {done ? (
          <Alert
            type={done === 'approved' ? 'success' : 'warning'}
            showIcon
            message={done === 'approved' ? 'Approved' : 'Declined'}
            description="Go back to the shop's tab — it finds out on its own."
          />
        ) : (
          <div className="mp-approve-actions">
            <Button type="primary" size="large" loading={busy} onClick={() => void decide()}>
              Approve
            </Button>
            {/* Closing the tab is a real thing customers do, and the sweeper is
                what makes it survivable. Offered here so it can be tested. */}
            <Button size="large" onClick={() => router.push(shop ? '/products' : '/')}>
              Walk away
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

// useSearchParams needs a Suspense boundary above it or `next build` refuses.
export default function ApprovePage() {
  return (
    <Suspense fallback={null}>
      <Approve />
    </Suspense>
  );
}
