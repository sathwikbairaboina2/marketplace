import { AntdRegistry } from '@ant-design/nextjs-registry';
// ANTD v5 targets React 18's rendering entry points. Next.js ships React 19,
// and without this patch `message`, `notification` and `Modal` -- the whole
// error surface of this app -- log compatibility errors and can fail to mount.
import '@ant-design/v5-patch-for-react-19';
import { AuthProvider } from '../lib/auth/auth-context';

export const metadata = { title: 'Marketplace' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <AuthProvider>{children}</AuthProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
