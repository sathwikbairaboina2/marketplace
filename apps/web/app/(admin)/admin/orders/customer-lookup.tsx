'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card, Input, Empty } from 'antd';
import type { OrderResponse } from '@marketplace/contracts';
import { customerHistory } from '../../../../lib/api/orders';
import { formatDate, formatPrice } from '../../../../lib/format';
import { notifyProblem } from '../../../../lib/problem-notify';

/**
 * "Priya, the speckled one — the same as last time."
 *
 * Seventy per cent of this merchant's money is repeat business, and until now
 * a returning customer was a stranger: order lookup needed a 26-character id
 * the customer deleted in March. She knows people by phone number, so that is
 * what this takes.
 */
export function CustomerLookup() {
  const [handle, setHandle] = useState('');
  const [orders, setOrders] = useState<OrderResponse[] | null>(null);
  const [busy, setBusy] = useState(false);

  const find = async () => {
    const typed = handle.trim();
    if (!typed) return;
    setBusy(true);
    try {
      // A number or an address; whichever they typed is the handle.
      const looksLikeEmail = typed.includes('@');
      setOrders(
        await customerHistory(looksLikeEmail ? { email: typed } : { phone: typed }),
      );
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mp-form-card" title="Who is this?">
      <p style={{ marginTop: 0, color: 'var(--mp-muted)' }}>
        Type the number they are calling from, or their email, to see everything they have
        bought here.
      </p>
      <Input.Search
        allowClear
        value={handle}
        placeholder="+91 98765 43210"
        enterButton="Find"
        loading={busy}
        onChange={(e) => setHandle(e.target.value)}
        onSearch={() => void find()}
        style={{ maxWidth: 380 }}
      />

      {orders !== null &&
        (orders.length === 0 ? (
          <Empty
            style={{ marginTop: 'var(--mp-space-5)' }}
            description="Nothing bought here under that number or address"
          />
        ) : (
          <ul className="mp-history">
            {orders.map((order) => (
              <li key={order.id}>
                <Link href={`/admin/orders/${order.id}`}>
                  <strong className="mp-num">{order.reference}</strong>
                </Link>
                <span className="mp-sub">
                  {formatDate(order.createdAt)} ·{' '}
                  {formatPrice(order.totalAmountMinor, order.currency)} ·{' '}
                  {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                  {order.balanceDueMinor > 0
                    ? ` · ${formatPrice(order.balanceDueMinor, order.currency)} still owed`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </Card>
  );
}
