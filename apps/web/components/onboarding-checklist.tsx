'use client';

import Link from 'next/link';
import { Button, message } from 'antd';
import { CheckOutlined, LinkOutlined } from '@ant-design/icons';

/**
 * The first screen that knows it is someone's first screen. Replaces the bare
 * "No products yet" empty state until the shop has a listing; the moment it
 * does, the products table takes over and this never appears again -- which is
 * also why step 2 is always the live step here: this component only renders
 * while the shop has nothing listed.
 */
export function OnboardingChecklist({ shopId }: { shopId: string }) {
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/products`);
    void message.success('Shop link copied');
  };

  return (
    <div className="mp-onboard">
      <h2 className="mp-onboard-title">Your shop is ready</h2>
      <p className="mp-onboard-sub">Three steps between here and your first sale.</p>

      <ol className="mp-onboard-steps">
        <li data-done="true">
          <span className="mp-onboard-pip" aria-hidden="true">
            <CheckOutlined />
          </span>
          <span>
            <strong>Shop created</strong>
            <br />
            <span className="mp-onboard-desc">{shopId} is live and yours</span>
          </span>
        </li>
        <li>
          <span className="mp-onboard-pip" aria-hidden="true">2</span>
          <span>
            <strong>List your first product</strong>
            <br />
            <span className="mp-onboard-desc">A name, a photo and a price is enough</span>
          </span>
        </li>
        <li>
          <span className="mp-onboard-pip" aria-hidden="true">3</span>
          <span>
            <strong>Share your shop link</strong>
            <br />
            <span className="mp-onboard-desc">Anyone with it can buy from you</span>
          </span>
        </li>
      </ol>

      <div className="mp-onboard-actions">
        <Link href="/admin/products/new">
          <Button type="primary">List a product</Button>
        </Link>
        <Button icon={<LinkOutlined />} onClick={() => void copyLink()}>
          Copy shop link
        </Button>
      </div>
    </div>
  );
}
