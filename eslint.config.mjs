// Copyright (C) 2025 Sasha Ulyanov
//
// This file is part of youtube-watch-later-hotkeys-extension.
//
// youtube-watch-later-hotkeys-extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// youtube-watch-later-hotkeys-extension is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with youtube-watch-later-hotkeys-extension.  If not, see <https://www.gnu.org/licenses/>.

import { defineConfig } from 'eslint/config';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  {
    extends: compat.extends('eslint:recommended', 'prettier'),
    plugins: {},

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },

      ecmaVersion: 'latest',
      sourceType: 'module',
    },

    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
    },
  },
]);
