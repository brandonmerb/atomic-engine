import type { ConfigEnv, PluginOption } from 'vite';
import { isMatch, scan } from 'picomatch';
export interface ViteMonorepoOptionalLocalsConfig {
  root?: string;
  overrides: {[key: string]: string};
}

export function viteMonorepoOptionalLocals(config: ViteMonorepoOptionalLocalsConfig): PluginOption {

  const basePathsFromOverrides: {[key: string]: string} = {};
  for (let [key, value] of Object.entries(config.overrides)) {
    basePathsFromOverrides[key] = scan(key).base;
  }

  return {
    name: "vite-monorepo-optional-locals",
    enforce: "pre",

    config(config, env) {
      return {
        ...config,
        resolve: {
          alias: {
            //"@atomicdesign/atomic-singularity": path.resolve("../libs/@atomicdesign/atomic-singularity")
          }
        }
      }
    },

    configResolved(config) {
      console.log(config.root);
      console.log(config.base);
    },
    
    resolveId(source, importer, options) {
      console.log(`${importer}:${source}`);
      // console.log(source);
      // for (let [key, value] of Object.entries(config.overrides)) {
      //   if (isMatch(source, key)) {
      //     const replacementBase = basePathsFromOverrides[key];
      //     const newString = path.resolve(source.replace(replacementBase, config.overrides[key]));
      //     console.log(`Replaced ${source} with ${newString}`)

      //     return newString;
      //   }
      // }
    },
    load(id, options) {
      // Replace things?
      console.log(`Load: ${id}`);
    },
  }
}