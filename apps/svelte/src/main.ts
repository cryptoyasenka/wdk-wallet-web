/**
 * Svelte 5 client entry. Mounts the wallet app into #app.
 *
 * Everything wallet-related lives behind `@wdk-web/wallet-core` + the
 * app-local host ports; this file is intentionally trivial — the proof is
 * that the engine, not the framework shell, carries the wallet.
 */
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("missing #app mount point");
}

export default mount(App, { target });
