import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    minify: false,
    rollupOptions: {
      external: ['onnxruntime-web/webgpu', 'onnxruntime-web'],
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom')) return 'react-dom';
            if (id.includes('react')) return 'react';
            if (id.includes('firebase/app') || id.includes('@firebase/app')) return 'firebase-app';
            if (id.includes('firebase/auth') || id.includes('@firebase/auth')) return 'firebase-auth';
            if (id.includes('firebase/firestore') || id.includes('@firebase/firestore')) return 'firebase-firestore';
            if (id.includes('firebase/storage') || id.includes('@firebase/storage')) return 'firebase-storage';
            if (id.includes('firebase/functions') || id.includes('@firebase/functions')) return 'firebase-functions';
            if (id.includes('firebase')) return 'firebase-other';
            if (id.includes('@anthropic') || id.includes('anthropic')) return 'anthropic';
            if (id.includes('lucide')) return 'lucide';
            if (id.includes('@imgly') || id.includes('background-removal')) return 'imgly';
            return 'vendor';
          }
        },
      },
    },
  },
})
