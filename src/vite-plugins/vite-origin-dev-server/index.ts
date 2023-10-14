import type { ConfigEnv, PluginOption } from 'vite';

export function viteOriginDevServerPlugin(config?: ConfigEnv): PluginOption {
  return {
    name: "vite-origin-dev-server"
  }
}