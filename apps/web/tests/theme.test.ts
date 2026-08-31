import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const palette = {
  bg: "#0B0B0F", primary: "#FF2E88", accent: "#D4FF3D",
  "text-primary": "#F5F5F0", "text-secondary": "#9A9AA5",
  border: "#3A3A42", "on-primary": "#1A0510",
};
const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
const mix = (a: number[], b: number[], amount: number) => a.map((value, index) => value * amount + b[index] * (1 - amount));
const luminance = (color: number[]) => color.reduce((sum, value, index) => {
  const channel = value / 255;
  return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
}, 0);
const contrast = (a: number[], b: number[]) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

test("Tailwind v4 owns the exact palette without introducing a layout reset", async () => {
  const [theme, globals, landing, manifest, config] = await Promise.all([
    read("../src/app/theme.css"), read("../src/app/globals.css"), read("../src/app/landing.css"),
    read("../package.json"), read("../postcss.config.mjs"),
  ]);
  for (const [name, value] of Object.entries(palette)) {
    assert.ok(theme.includes(`--color-${name}: ${value};`));
  }
  assert.match(theme, /@theme static/);
  assert.doesNotMatch(theme, /@import ["']tailwindcss["']|@import[^;]*preflight/);
  assert.match(JSON.parse(manifest).devDependencies.tailwindcss, /^4\./);
  assert.match(config, /@tailwindcss\/postcss/);
  assert.doesNotMatch(globals + landing, /#[\da-f]{3,8}\b|\brgba?\(|:\s*(?:white|black)\b|var\(--(?:ink|muted|line|surface|blue)/i);
  const result = await postcss([tailwind({ optimize: false })]).process(globals, {
    from: new URL("../src/app/globals.css", import.meta.url).pathname,
  });
  assert.doesNotMatch(result.css, /@apply|@theme/);
  assert.match(result.css, /background-color: var\(--color-bg\)/);
  assert.match(result.css, /font-family: var\(--font-google-body\)/);
});

test("all theme text pairings meet normal-text AA, including hover and badges", async () => {
  const theme = await read("../src/app/theme.css");
  // Keep the contrast model tied to the actual derived surface/hover definitions.
  assert.match(theme, /--color-surface: color-mix\(in srgb, var\(--color-bg\) 96%, var\(--color-text-primary\)\)/);
  assert.match(theme, /--color-primary-hover: color-mix\(in srgb, var\(--color-primary\) 85%, var\(--color-text-primary\)\)/);
  const colors = Object.fromEntries(Object.entries(palette).map(([name, value]) => [name, rgb(value)]));
  const surface = mix(colors.bg, colors["text-primary"], 0.96);
  const hover = mix(colors.primary, colors["text-primary"], 0.85);
  for (const background of [colors.bg, surface]) {
    for (const foreground of [colors["text-primary"], colors["text-secondary"], colors.primary, colors.accent, hover]) {
      assert.ok(contrast(foreground, background) >= 4.5);
    }
    // Focus rings and control boundaries (decorative separators are not controls).
    assert.ok(contrast(colors.primary, background) >= 3);
    assert.ok(contrast(colors["text-secondary"], background) >= 3);
  }
  for (const background of [colors.primary, hover]) {
    assert.ok(contrast(colors["on-primary"], background) >= 4.5);
  }
});

test("Google display/body fonts are wired and filled actions use dark text", async () => {
  const [layout, theme, globals, landing] = await Promise.all([
    read("../src/app/layout.tsx"), read("../src/app/theme.css"),
    read("../src/app/globals.css"), read("../src/app/landing.css"),
  ]);
  assert.match(layout, /import \{ Mouse_Memoirs, TikTok_Sans \} from "next\/font\/google"/);
  assert.match(layout, /variable: "--font-google-display"/);
  assert.match(layout, /variable: "--font-google-body"/);
  // Omitting a fixed TikTok Sans weight loads the variable font, including 400/500/700.
  assert.doesNotMatch(layout.match(/TikTok_Sans\(\{([\s\S]*?)\}\)/)?.[1] ?? "", /weight:/);
  assert.match(theme, /--font-display: var\(--font-google-display\), "Mouse Memoirs", sans-serif/);
  assert.match(theme, /--font-body: var\(--font-google-body\), "TikTok Sans", sans-serif/);
  assert.match(globals, /h1, h2, h3, h4, h5, h6 \{\s*@apply font-display/);
  for (const selector of ["authButton", "primaryButton", "landingButton", "skipLink"]) {
    const rule = (globals + landing).match(new RegExp(`\\.${selector} \\{([^}]+)\\}`))?.[1];
    assert.ok(rule?.includes("background: var(--color-primary)"));
    assert.ok(rule?.includes("color: var(--color-on-primary)"));
  }
  assert.match(landing, /\.landingButton:hover \{[^}]*color: var\(--color-on-primary\)/);
});
