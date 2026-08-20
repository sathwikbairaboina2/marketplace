import { Fraunces, Inter, Nunito, Playfair_Display } from 'next/font/google';
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

// Downloaded at build time and self-hosted, so nothing fetches a font at
// runtime -- which matters because the container is the only place this ever
// runs, and a webfont request that fails there fails silently into a fallback
// nobody chose.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// The three faces the storefront presets can pick beyond Inter. Loaded here
// unconditionally: a tenant's theme is data, and a font that only loads for
// some data value would flash fallback on the first themed paint.
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], variable: '--font-nunito', display: 'swap' });

export const metadata = { title: 'Marketplace' };

/**
 * Runs before first paint. Without it the page renders light and then corrects
 * itself on hydration -- the most conspicuous defect a dark mode can have, and
 * the hardest to un-see once noticed.
 */
const THEME_BOOTSTRAP = `
(function(){try{
  var s=localStorage.getItem('marketplace.theme');
  document.documentElement.dataset.theme=(s==='dark'||s==='light')?s:'light';
}catch(e){}})();`;

// SchemaProvider sits inside AuthProvider because it fetches whenever `token`
// changes. The shells live in the route groups -- (shop) and (admin) each own
// their chrome -- so this layout carries only the providers both share, which
// is what lets a cart survive a walk through the back office.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${playfair.variable} ${nunito.variable}`}
    >
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
                  {children}
                </CartProvider>
              </SchemaProvider>
            </AuthProvider>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
