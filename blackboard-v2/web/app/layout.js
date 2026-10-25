import './globals.css';
import './polish.css';

export const metadata = { title: 'Team board', robots: 'noindex' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
