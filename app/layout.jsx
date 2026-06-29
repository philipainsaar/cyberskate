import './globals.css';

export const metadata = {
  title: 'Cyber Skate',
  description: 'PS1 inspired cyber-goth skateboarding prototype built with Next.js and Three.js.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
