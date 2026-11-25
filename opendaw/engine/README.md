# Flowtu audio region fades

The browser AudioWorklet and the offline WAV worker both load `wasm/engine.wasm`. This build adds sine fade-in and cosine fade-out as optional region fields 5 and 6 within Fading. False is the default for existing projects. The interface keeps the ordinary slope parameters intact, including when switching back to a custom bend.

## Rebuild the native module

Use the [openDAW source at b78d6b0](https://github.com/andremichelle/openDAW/tree/b78d6b0df53bc563010808a01789dd0a98b7a459) published for `@opendaw/studio-core-wasm@0.0.22`. From that checkout, set `FLOWTU_ENGINE_DIR` to the absolute path to this directory and run:

```sh
git apply "$FLOWTU_ENGINE_DIR/equal-power.patch"
rustup toolchain install 1.92.0 --profile minimal --target wasm32-unknown-unknown
cd crates
RUSTFLAGS="-C target-feature=+simd128" cargo +1.92.0 rustc --locked \
  -p engine --release --target wasm32-unknown-unknown -- \
  -C link-arg=--import-memory -C link-arg=--import-table -C link-arg=--no-check-features
cp target/wasm32-unknown-unknown/release/engine.wasm "$FLOWTU_ENGINE_DIR/engine.wasm"
```

The Vite configuration copies this module and the pinned package’s matching plugins into the same directory for development and production. The upstream AGPL license is included at `../LICENSE`.
