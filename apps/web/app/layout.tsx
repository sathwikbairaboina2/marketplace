import { Inter } from 'next/font/google';
import { AntdRegistry } from '@ant-design/nextjs-registry';
// ANTD v5 targets React 18's rendering entry points. Next.js ships React 19,
// and without this patch `message`, `notification` and `Modal` -- the whole
// error surface of this app -- log compatibility errors and can fail to mount.
import '@ant-design/v5-patch-for-react-19';
import './theme.css';
import { ThemeProvider } from '../lib/theme/theme-context';
import { AuthProvider } from '../lib/auth/auth-context';
import { SchemaProvider } from '../lib/schemas/schema-cache';
import { CartProvider } from '../lib/cart/cart-context';
import { ContractBanner } from '../components/contract-banner';
import { AppShell } from '../components/app-shell';

// Downloaded at build time and self-hosted, so nothing fetches a font at
// runtime -- which matters because the container is the only place this ever
// runs, and a webfont request that fails there fails silently into a fallback
// nobody chose.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = { title: 'Marketplace' };

/**
 * Runs before first paint. Without it the page renders light and then corrects
 * itself on hydration -- the most conspicuous defect a dark mode can have, and
 * the hardest to un-see once noticed.
 */
const THEME_BOOTSTRAP = `
(function(){try{
  var s=localStorage.getItem('marketplace.theme');
  var m=s==='dark'||s==='light'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  document.documentElement.dataset.theme=m;
}catch(e){}})();`;

// SchemaProvider sits inside AuthProvider because it fetches whenever `token`
// changes. ContractBanner is a sibling above the shell rather than a wrapper:
// it renders nothing until something reports a mismatch, and it has to stay
// mounted while the page below it keeps working.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <AntdRegistry>
          <ThemeProvider>
            <AuthProvider>
              <SchemaProvider>
                <CartProvider>
                  <ContractBanner />
                  <AppShell>{children}</AppShell>
                </CartProvider>
              </SchemaProvider>
            </AuthProvider>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
