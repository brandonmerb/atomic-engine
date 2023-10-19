import type { ConfigEnv, PluginOption } from 'vite';
import { isMatch, scan, makeRe } from 'picomatch';
import path from 'path';

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

    config(config: ConfigEnv, env: ConfigEnv) {
      console.log(path.resolve("../../../libs/@atomicdesign/atomic-singularity"));
      // let resolutionExp = makeRe("@atomicdesign/*/**");
      // console.log(resolutionExp);
      // { find:/^i18n\!(.*)/, replacement: '$1.js' }
      return {
        ...config,
        // resolve: {
        //   alias: [
        //     { find: /^@atomicdesign\/(.*)/, replacement: '@atomicdesign/$1/ts' }
        //   ]
        // }
      }
    },

    // configResolved(config: ConfigEnv) {
    //   console.log(config.root);
    //   console.log(config.base);
    // },
    
    resolveId(source: string, importer: string, options: any) {
      // console.log(`${importer}:${source}`);
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
    load(id: string, options: any) {
      // Replace things?
      console.log(`Load: ${id}`);
    },
  }
}