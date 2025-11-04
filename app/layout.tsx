export const metadata = {
  title: "Audio Kaleidoscope",
  description: "Hypnotic canvas audio visualizer with kaleidoscope",
};

import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
