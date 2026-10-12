import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TCT Research",
  description: "Private trading journal and market research workspace",
  applicationName: "TCT Research",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
