import { AntdRegistry } from '@ant-design/nextjs-registry';
// ANTD v5 targets React 18's rendering entry points. Next.js ships React 19,
// and without this patch `message`, `notification` and `Modal` -- the whole
// error surface of this app -- log compatibility errors and can fail to mount.
import '@ant-design/v5-patch-for-react-19';
import { AuthProvider } from '../lib/auth/auth-context';
import { SchemaProvider } from '../lib/schemas/schema-cache';
import { CartProvider } from '../lib/cart/cart-context';
import { ContractBanner } from '../components/contract-banner';
import { AppShell } from '../components/app-shell';

export const metadata = { title: 'Marketplace' };

// SchemaProvider sits inside AuthProvider because it fetches whenever `token`
// changes. ContractBanner is a sibling above AppShell rather than a wrapper: it
// renders nothing until something reports a mismatch, and it has to stay
// mounted while the page below it keeps working.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <AuthProvider>
            <SchemaProvider>
              <CartProvider>
                <ContractBanner />
                <AppShell>{children}</AppShell>
              </CartProvider>
            </SchemaProvider>
          </AuthProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
