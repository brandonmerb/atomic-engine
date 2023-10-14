import type { ConfigEnv, PluginOption } from 'vite';
import { MainTransformer } from './transformers/main.transformer';
import { ModuleTransformer } from './transformers/module.transformer';
import { BuildLogService } from "./services/build-log.service";
import { AtomicEngineConfig } from './interfaces/config.interface';
import { LogSystem, LogLevelsEnum } from '@atomicdesign/atomic-singularity/logging';

export function atomicVite(config: ConfigEnv): PluginOption {
  const atomicViteLogger = new BuildLogService()
  const side = "client";

  const activePluginConfig: AtomicEngineConfig = {
    jsCodeParser: "ts",
    loggingLevel: "debug",
    sidedTokens: [
    ]
  };

  if (activePluginConfig?.loggingLevel === "debug") {
    LogSystem.instance.setLogLevel(LogLevelsEnum.system);
  }

  atomicViteLogger.info("Starting Atomic Vite Loader.");
  atomicViteLogger.info(`Atomic Vite Side: ${side}`);

  const mainTransformer = new MainTransformer(atomicViteLogger, side, activePluginConfig);
  const moduleTransformer = new ModuleTransformer(atomicViteLogger, side, activePluginConfig)

  return {
    name: 'atomic-vite',
    enforce: 'pre',

    async transform(code: string, id: string) {
      // We don't need to do anything with non-typescript files
      if (!id.endsWith(".ts")) return;

      let workingCode = code;
      let transformApplied = false;

      if (id.endsWith("src/main.ts")) {
        atomicViteLogger.debug(`Applying transform LoaderCheck: ${id}`);
        workingCode = mainTransformer.transform(id, code).toSource();
        transformApplied = true;
      }

      /**
       * TODO: It may be possible/preferrred to identify modules
       * through the use of examining the useModule
       * identifier in main.ts, rather than dynamically
       * identifying modules via their filename.
       */
      if (id.endsWith(".module.ts")) {
        atomicViteLogger.debug(`Applying transform ModuleCheck: ${id}`);
        workingCode = moduleTransformer.transform(id, code).toSource();
        transformApplied = true;
      }

      if (transformApplied) {
        return workingCode;
      }
    },
  }
}