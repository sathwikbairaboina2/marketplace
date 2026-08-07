'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { onUnauthorized } from '../../lib/api/http';
import { ShopHeader } from '../../components/shop-header';

export default function ShopShell({ children }: { children: React.ReactNode }) {
  const { principal, ready } = useAuth();
  const router = useRouter();

  useEffect(() => onUnauthorized(() => router.push('/login')), [router]);

  useEffect(() => {
    if (ready && !principal) router.push('/login');
  }, [ready, principal, router]);

  if (!ready || !principal) return null;

  return (
    <div className="mp-shop">
      <ShopHeader />
      <main className="mp-shop-main">{children}</main>
    </div>
  );
}
