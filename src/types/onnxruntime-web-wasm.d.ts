// The WebAssembly-only build of onnxruntime-web has the same API as the main entry;
// "moduleResolution": "node" does not read package exports, so name it here.
declare module 'onnxruntime-web/wasm' {
  export * from 'onnxruntime-web';
}
