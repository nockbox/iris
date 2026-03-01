/**
 * Extension consumes wasm via @nockbox/iris-sdk so sdk branch can vendor a
 * prebuilt wasm package and extension only depends on sdk.
 */
import * as wasm from '@nockbox/iris-sdk/wasm';

export { wasm };
export const initWasm = (wasm as { default: (arg?: unknown) => Promise<unknown> }).default;
export default wasm;
