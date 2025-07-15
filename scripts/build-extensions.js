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

const { copyFileSync, existsSync, rmSync, mkdirSync, readdirSync, statSync } = require('fs');
const { resolve, join } = require('path');

function isTestFile(filename) {
  return /\.(test|spec)\.(js|mjs)$/i.test(filename);
}

function copyDir(src, dest) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const item of readdirSync(src)) {
    const srcPath = join(src, item);
    const destPath = join(dest, item);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (!isTestFile(item)) {
      copyFileSync(srcPath, destPath);
    }
  }
}

const dist = resolve('dist');
const chromeDist = join(dist, 'chrome');
const firefoxDist = join(dist, 'firefox');
const shared = resolve('shared');

if (existsSync(chromeDist)) rmSync(chromeDist, { recursive: true, force: true });
if (existsSync(firefoxDist)) rmSync(firefoxDist, { recursive: true, force: true });

copyDir(shared, chromeDist);
copyDir(shared, firefoxDist);

copyFileSync(resolve('chrome/manifest.json'), join(chromeDist, 'manifest.json'));
copyFileSync(resolve('firefox/manifest.json'), join(firefoxDist, 'manifest.json'));

console.log('Built dist/chrome and dist/firefox with correct manifests, skipping test files.');
