import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Progress Forge',
  description: 'Cloud-synced strength, workout and bodyweight progression tracker.',
  applicationName: 'Progress Forge',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
