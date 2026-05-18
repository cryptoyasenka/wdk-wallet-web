// Plain Svelte + Vite (deliberately NOT SvelteKit — D-05: the lighter tool
// that still builds a static client; the proof is the engine seam, not a
// framework's routing/SSR). `vitePreprocess` lets <script lang="ts"> blocks
// in .svelte components be type-checked by svelte-check and bundled by Vite.
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
