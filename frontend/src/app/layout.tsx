import "./globals.css";
import GlobalRemoteControlBanner from "@/components/GlobalRemoteControlBanner";

export const metadata = {
  title: "Sentiment Trading Alpha",
  description: "Sentiment-driven trading signals for 3x leveraged ETFs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white antialiased">
        <GlobalRemoteControlBanner />
        {children}
      </body>
    </html>
  );
}
