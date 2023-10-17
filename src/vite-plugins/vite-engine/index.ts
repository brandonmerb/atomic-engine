import type { ConfigEnv, PluginOption } from 'vite';

export function viteEngine(config?: ConfigEnv): PluginOption {
  return {
    name: "vite-origin-dev-server",
    enforce: "pre"
  }
}