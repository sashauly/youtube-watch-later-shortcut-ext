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

import { describe, it, expect } from 'vitest';
import { isYouTubeVideo, isYouTubeShorts } from './background';

describe('YouTube URL detection', () => {
  it('detects regular YouTube video URLs', () => {
    expect(isYouTubeVideo('https://www.youtube.com/watch?v=abc123')).toBe(true);
    expect(isYouTubeVideo('https://www.youtube.com/shorts/xyz456')).toBe(false);
  });

  it('detects YouTube Shorts URLs', () => {
    expect(isYouTubeShorts('https://www.youtube.com/shorts/xyz456')).toBe(true);
    expect(isYouTubeShorts('https://www.youtube.com/watch?v=abc123')).toBe(false);
  });

  it('handles invalid URLs gracefully', () => {
    expect(isYouTubeVideo('not a url')).toBe(false);
    expect(isYouTubeShorts('')).toBe(false);
  });
});
