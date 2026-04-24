/**
 * Minimal Plugin SDK Types (same pattern as MAX plugin)
 * Real implementations provided by OpenClaw Gateway at runtime.
 */

export interface ChannelPlugin<ResolvedAccount = any, Probe = any> {
  id: string;
  meta: any;
  capabilities?: any;
  reload?: { configPrefixes: string[] };
  config: any;
  pairing?: any;
  security?: any;
  messaging?: any;
  directory?: any;
  setup?: any;
  outbound?: any;
  gateway?: any;
}

export type PluginRuntime = any;

export interface OpenClawPluginApi {
  runtime: PluginRuntime;
  registerChannel: (opts: { plugin: ChannelPlugin }) => void;
}

export interface OpenClawExtension {
  id: string;
  name: string;
  configSchema?: any;
  register: (api: OpenClawPluginApi) => void;
}

export function emptyPluginConfigSchema(): any {
  return {};
}

export function createPluginRuntimeStore<T>(errorMsg: string): {
  setRuntime: (r: T) => void;
  getRuntime: () => T;
} {
  let _runtime: T | undefined;
  return {
    setRuntime: (r: T) => { _runtime = r; },
    getRuntime: () => {
      if (_runtime === undefined) throw new Error(errorMsg);
      return _runtime as T;
    },
  };
}
