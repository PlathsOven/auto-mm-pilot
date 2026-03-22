import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isWeb = process.env.VITE_WEB === "true";

export default defineConfig(async () => {
  const plugins = [react()];

  if (!isWeb) {
    const electron = (await import("vite-plugin-electron")).default;
    const electronRenderer = (await import("vite-plugin-electron-renderer")).default;
    plugins.push(
      electron([
        {
          entry: "electron/main.ts",
          vite: {
            build: {
              outDir: "dist-electron",
            },
          },
        },
        {
          entry: "electron/preload.ts",
          onstart(args) {
            args.reload();
          },
          vite: {
            build: {
              outDir: "dist-electron",
            },
          },
        },
      ]),
      electronRenderer(),
    );
  }

  return {
    plugins,
    build: {
      outDir: "dist",
    },
  };
});
