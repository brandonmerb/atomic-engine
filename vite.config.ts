import { defineConfig, splitVendorChunkPlugin, loadEnv, UserConfig, ConfigEnv } from 'vite'

// TSConfig Paths is mostly for package Atomic Singularity, since it uses module paths
// which confuse Vite & SWC during the build
import tsconfigPaths from 'vite-tsconfig-paths'

// This is to generate types, since SWC does not do this
import dts from 'vite-plugin-dts';

// SWC for vite to actually handle the rendering
import swc from 'unplugin-swc'

// We use Vue in this project, so the compiler needs a way to handle that via plugins
import vue from '@vitejs/plugin-vue'


export default defineConfig((config: ConfigEnv): UserConfig => {
  let plugins = [
    tsconfigPaths(),
    splitVendorChunkPlugin(),
      // dts({
      //   rollupTypes: true,
      // }),
    swc.vite({
      configFile: './.swcrc'
    }),
    vue()
  ]

  return {
    plugins: plugins,
    build: {
      rollupOptions: {
        preserveEntrySignatures: 'strict',
        input: {
          "index": "./src/index.ts"
        },
        output: {
          entryFileNames: '[name].js'
        },
        external: [
          "vue",
          "express",
          "@atomicdesign/atomic-singularity",
          "@atomicdesign/atomic-vue",
          "@atomicdesign/atomic-origin"
        ]
      }
    },

    clearScreen: true,
    esbuild: false,
  }
})