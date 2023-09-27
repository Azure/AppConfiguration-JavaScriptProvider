// rollup.config.js
import typescript from "@rollup/plugin-typescript";
import dts from "rollup-plugin-dts";

export default [
  {
    external: ["@azure/app-configuration", "@azure/keyvault-secrets"],
    input: "src/index.ts",
    output: [
      {
        file: "dist/index.js",
        format: "cjs",
        sourcemap: true
      },
    ],
    plugins: [
      typescript({
        compilerOptions: {
          "module": "ESNext",
          "moduleResolution": "Node",
          "target": "ES2022",
          "strictNullChecks": true,
          "strictFunctionTypes": true,
          "sourceMap": true,
          "inlineSources": true
        }
      })
    ],
  },
  {
    input: "src/index.ts",
    output: [{ file: "types/index.d.ts", format: "es" }],
    plugins: [dts()],
  },
];
