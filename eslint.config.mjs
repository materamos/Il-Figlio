import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".astro/",
      ".vercel/",
      "coverage/",
      "dist/",
      "node_modules/",
    ],
  },
  {
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["*.mjs", "scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["public/scripts/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["apps-script/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: {
        ContentService: "readonly",
        DriveApp: "readonly",
        LockService: "readonly",
        PropertiesService: "readonly",
        ScriptApp: "readonly",
        SpreadsheetApp: "readonly",
        UrlFetchApp: "readonly",
        Utilities: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^(doGet|handlePublishEdit|onOpen|setupProject|verifyPublishedRevision)$",
        },
      ],
    },
  },
);
