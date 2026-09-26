import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Progress Forge',
    short_name: 'Progress',
    description: 'Cloud-synced gym progression tracker',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0a0d12',
    theme_color: '#0a0d12',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }
}
