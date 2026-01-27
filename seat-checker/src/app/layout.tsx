import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Seat Checker - Analiza miejsc',
  description: 'Sprawdz dostepnosc miejsc na wydarzeniach',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pl">
      <body className="bg-gray-100 min-h-screen">
        {children}
      </body>
    </html>
  )
}
