import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const involve = localFont({
  src: "../fonts/Involve-VF.ttf",
  variable: "--font-involve",
  weight: "100 900",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-ibm-mono",
});

export const metadata: Metadata = {
  title: "Методий",
  description:
    "ИИ-агент собирает программу обучения: структуру, компетенции, тесты, семинары и лекции.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${involve.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('edu-course-theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
