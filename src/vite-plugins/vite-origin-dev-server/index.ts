import type { ConfigEnv, PluginOption, ViteDevServer } from 'vite';

import express from 'express';

const app = express();

app.get('/api', (req, res) => {
  res.send('Hello world!').end()
})

export function viteOriginDevServerPlugin(config?: ConfigEnv): PluginOption {
  return {
    name: "vite-origin-dev-server",
    enforce: "post",

    config() {
      return {
        server: {
          proxy: {
            '/api': {
              changeOrigin: true
            }
          }
        }
      }
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(app);
    }
  }
}