import { resolveMemeTextFont, type MemeTextOverlay } from "@memedrop/shared";

const requestedFontLoads = new Map<string, Promise<void>>();

/**
 * Canvas does not wait for web fonts. Load only the custom faces an overlay
 * needs, so existing Impact templates preserve their current fast path.
 */
export async function ensureMemeOverlayFonts(overlay: MemeTextOverlay): Promise<void> {
  if (!("fonts" in document)) return;

  const loads = new Set<string>();
  for (const region of overlay.regions) {
    const font = resolveMemeTextFont(region.font);
    if (font.family === "Impact") continue;
    loads.add(`${font.weight} 16px ${font.family}`);
  }

  await Promise.all(Array.from(loads, loadFont));
}

function loadFont(font: string): Promise<void> {
  let load = requestedFontLoads.get(font);
  if (!load) {
    // If a browser declines a font load, canvas still has its deterministic
    // fallback stack. A preview should not become impossible to attach.
    load = document.fonts.load(font).then(
      () => undefined,
      () => undefined
    );
    requestedFontLoads.set(font, load);
  }
  return load;
}
