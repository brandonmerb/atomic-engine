import { defineConfig, splitVendorChunkPlugin, loadEnv, UserConfig, ConfigEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import swc from 'rollup-plugin-swc';

// TSConfig Paths is mostly for package Atomic Singularity, since it uses module paths
// which confuse Vite & SWC during the build
import tsconfigPaths from 'vite-tsconfig-paths'

import dts from 'vite-plugin-dts';

export default defineConfig((config: ConfigEnv): UserConfig => {
  let plugins = [
    tsconfigPaths(),
    splitVendorChunkPlugin(),
    dts({
      rollupTypes: true
    }),
    swc({
      configFile: "./.swcrc",
      rollup: {
        include: "**/*.ts",
        exclude: ""
      },
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