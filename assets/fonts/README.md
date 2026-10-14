# Local interface fonts

These are real, self-hosted WOFF2 font assets. The application does not need an
OS font installation or a connection to Google Fonts at runtime.

| Use | Family | Variable weight | Shards | Total size |
| --- | --- | --- | ---: | ---: |
| Chinese interface | Noto Sans SC | 100–900 | 101 | 4,500,544 bytes |
| Chinese display titles | Noto Serif SC | 200–900 | 101 | 6,030,988 bytes |
| Brand, Latin labels, numerals | Space Grotesk | 300–700 | 3 | 47,940 bytes |

Total font payload is 10,579,472 bytes (10.09 MiB). The largest individual file is
104,964 bytes (102.50 KiB), below the server's 2 MiB resource limit. The browser
fetches only the `unicode-range` shards required by the text being rendered.
Do not preload every shard.

## Coverage

All WOFF2 shards returned by the official Google Fonts CSS API were preserved;
the fonts were not subset to the current interface copy. This supports new
world names and changing narrative text. The original character maps were
decoded and checked: Noto Sans SC contains 13,635 distinct mapped Unicode code
points, including 12,269 Han characters; Noto Serif SC contains 13,666 mapped
code points, including 12,295 Han characters. Space Grotesk contains 634 mapped
code points for Latin text, numerals, and symbols. See `coverage.json`.

This is broad Simplified Chinese web-font coverage, not every Unicode CJK
character. Characters outside the delivered fonts use the explicit Chinese
system fallbacks in `src/fonts.css`.

## Sources and licensing

The files were retrieved unmodified from Google's official
`fonts.gstatic.com` font distribution using the
[Google Fonts CSS API](https://developers.google.com/fonts/docs/css2).
The request, retrieval timestamp, original URL, Unicode range, file size, and
SHA-256 checksum for every file are recorded in `manifest.json`.

All three families are distributed under the **SIL Open Font License 1.1**.
The complete upstream licenses are included alongside the fonts:

- [Noto Sans SC metadata](https://github.com/google/fonts/blob/main/ofl/notosanssc/METADATA.pb)
  and [license source](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt):
  `noto-sans-sc-OFL.txt`.
- [Noto Serif SC metadata](https://github.com/google/fonts/blob/main/ofl/notoserifsc/METADATA.pb)
  and [license source](https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/OFL.txt):
  `noto-serif-sc-OFL.txt`.
- [Space Grotesk upstream](https://github.com/floriankarsten/space-grotesk)
  and [license source](https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/OFL.txt):
  `space-grotesk-OFL.txt`.

The fonts may be bundled with the application under those licenses. Preserve
the copyright notices and license files when redistributing the assets.

## CSS integration

Load `/src/fonts.css` before the application styles. It defines the font faces
and these stacks:

- `var(--font-ui)`: Noto Sans SC with Chinese sans-serif fallbacks.
- `var(--font-display)`: Noto Serif SC with Chinese serif fallbacks.
- `var(--font-brand)`: Space Grotesk, then Noto Sans SC for Chinese characters.

All `src` URLs are local `/assets/fonts/*.woff2` resources. The font-family
names match the upstream names, and the binary assets are not modified.
