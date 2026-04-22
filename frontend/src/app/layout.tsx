import "./globals.css";

export const metadata = {
  title: "3x Sentiment Trading System",
  description: "Sentiment-driven trading signals for 3x leveraged ETFs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white antialiased">{children}</body>
    </html>
  );
}
