import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Manrope } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-sans",
});

const display = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600"],
  variable: "--font-manrope",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-ibm-mono",
});

export const metadata: Metadata = {
  title: "Студия образовательных программ",
  description:
    "ИИ-агент собирает программу обучения: структуру, компетенции, тесты, семинары и лекции.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('edu-course-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
