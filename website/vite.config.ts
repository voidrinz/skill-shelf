import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  ssr: { noExternal: ['@skill-shelf/i18n', '@skill-shelf/ui'] },
})
