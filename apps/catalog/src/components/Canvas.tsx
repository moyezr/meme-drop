import { useRef, useState } from "react";

import type { RegionAnnotation, TemplateAnnotation, VisualQaAnnotation } from "../types";
import { CaptionPreview } from "./CaptionPreview";

interface CanvasProps {
  imageUrl: string;
  name: string;
  annotation: TemplateAnnotation;
  regions: RegionAnnotation[];
  selectedRegionId: string | null;
  onSelectRegion: (id: string) => void;
  onChangeRegion: (region: RegionAnnotation) => void;
  onAddRegion: () => void;
  onVisualQaChange: (value: VisualQaAnnotation | null) => void;
}

interface PointerInteraction {
  pointerId: number;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  region: RegionAnnotation;
}

export function Canvas({
  imageUrl,
  name,
  annotation,
  regions,
  selectedRegionId,
  onSelectRegion,
  onChangeRegion,
  onAddRegion,
  onVisualQaChange,
}: CanvasProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const [zoom, setZoom] = useState(100);
  const [showBoxes, setShowBoxes] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"layout" | "render">("layout");

  function beginInteraction(
    event: React.PointerEvent,
    region: RegionAnnotation,
    mode: "move" | "resize",
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectRegion(region.id);
    interactionRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      region: structuredClone(region),
    };
    stageRef.current?.setPointerCapture(event.pointerId);
  }

  function moveInteraction(event: React.PointerEvent) {
    const interaction = interactionRef.current;
    const image = imageRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || !image) return;
    const dx = (event.clientX - interaction.startX) / image.clientWidth;
    const dy = (event.clientY - interaction.startY) / image.clientHeight;
    const next = structuredClone(interaction.region);
    if (interaction.mode === "move") {
      next.x = clamp(interaction.region.x + dx, 0, 1 - next.width);
      next.y = clamp(interaction.region.y + dy, 0, 1 - next.height);
    } else {
      next.width = clamp(interaction.region.width + dx, 0.04, 1 - next.x);
      next.height = clamp(interaction.region.height + dy, 0.04, 1 - next.y);
    }
    for (const key of ["x", "y", "width", "height"] as const) {
      next[key] = Math.round(next[key] * 1000) / 1000;
    }
    onChangeRegion(next);
  }

  return (
    <section className="canvas-shell">
      <div className="canvas-toolbar">
        <div className="canvas-toolbar-group">
          <button
            className={mode === "layout" ? "tool-toggle active" : "tool-toggle"}
            onClick={() => setMode("layout")}
            type="button"
          >
            <span className="tool-icon">▣</span> Layout
          </button>
          <button
            className={mode === "render" ? "tool-toggle active" : "tool-toggle"}
            onClick={() => setMode("render")}
            type="button"
          >
            <span className="tool-icon">◉</span> Render QA
          </button>
          <button
            className={showBoxes ? "tool-toggle active" : "tool-toggle"}
            onClick={() => setShowBoxes((value) => !value)}
            type="button"
          >
            <span className="tool-icon">▣</span> Regions
          </button>
          <button
            className={showGrid ? "tool-toggle active" : "tool-toggle"}
            onClick={() => setShowGrid((value) => !value)}
            type="button"
          >
            <span className="tool-icon">⌗</span> Grid
          </button>
        </div>
        <div className="zoom-control">
          <button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(60, value - 10))} type="button">−</button>
          <input
            aria-label="Canvas zoom"
            max="140"
            min="60"
            onChange={(event) => setZoom(Number(event.target.value))}
            type="range"
            value={zoom}
          />
          <span>{zoom}%</span>
          <button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(140, value + 10))} type="button">+</button>
        </div>
      </div>

      <div className={`canvas-viewport ${showGrid ? "show-grid" : ""} ${mode === "render" ? "render-mode" : ""}`}>
        {mode === "render" ? (
          <CaptionPreview
            annotation={annotation}
            imageUrl={imageUrl}
            onVisualQaChange={onVisualQaChange}
          />
        ) : (
        <div
          className="meme-stage"
          onPointerCancel={() => (interactionRef.current = null)}
          onPointerMove={moveInteraction}
          onPointerUp={() => (interactionRef.current = null)}
          ref={stageRef}
          style={{ width: `${zoom}%` }}
        >
          <img alt={name} draggable={false} ref={imageRef} src={imageUrl} />
          {showBoxes
            ? regions.map((region, index) => {
                const previewCopy = formatPreviewCopy(previews[region.id] || region.role, region.text_transform);
                const previewFontSize = Math.max(12, Math.min(34, region.font.max_size * 0.48));
                return (
                  <button
                    className={`caption-region ${selectedRegionId === region.id ? "selected" : ""}`}
                    key={region.id}
                    onPointerDown={(event) => beginInteraction(event, region, "move")}
                    onClick={() => onSelectRegion(region.id)}
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`,
                      alignItems: { top: "flex-start", middle: "center", bottom: "flex-end" }[
                        region.valign
                      ],
                      justifyContent: { left: "flex-start", center: "center", right: "flex-end" }[
                        region.align
                      ],
                      textAlign: region.align,
                      fontFamily: canvasFontFamily(region.font.family),
                      fontWeight: region.font.weight,
                      fontSize: `${previewFontSize}px`,
                      lineHeight: region.font.line_height_ratio,
                      color: region.font.fill_color,
                      WebkitTextStroke: `${region.font.stroke_ratio === 0 ? 0 : Math.max(1, previewFontSize * region.font.stroke_ratio)}px ${region.font.stroke_color}`,
                    }}
                    type="button"
                  >
                    <span className="region-number">{index + 1}</span>
                    <span className="region-copy">{previewCopy}</span>
                    <span
                      aria-hidden="true"
                      className="resize-handle"
                      onPointerDown={(event) => beginInteraction(event, region, "resize")}
                    />
                  </button>
                );
              })
            : null}
        </div>
        )}
      </div>

      <div className="canvas-footer">
        {mode === "layout" ? <><div className="region-legend">
          {regions.map((region, index) => (
            <button
              className={selectedRegionId === region.id ? "active" : ""}
              key={region.id}
              onClick={() => onSelectRegion(region.id)}
              type="button"
            >
              <span>{index + 1}</span>
              {region.id.replaceAll("_", " ")}
            </button>
          ))}
          <button className="add-region-inline" disabled={regions.length >= 8} onClick={onAddRegion} type="button">
            + Add region
          </button>
        </div>
        {selectedRegionId ? (
          <label className="preview-field">
            <span>Preview copy</span>
            <input
              onChange={(event) =>
                setPreviews((values) => ({ ...values, [selectedRegionId]: event.target.value }))
              }
              placeholder="Type sample caption text…"
              value={previews[selectedRegionId] || ""}
            />
          </label>
        ) : null}
        </> : <div className="render-footer-note"><span>◉</span> Render QA uses the production canvas renderer. A clean check is required before local approval.</div>}
      </div>
    </section>
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function canvasFontFamily(family: RegionAnnotation["font"]["family"]): string {
  return family === "Impact"
    ? "Impact, Haettenschweiler, 'Arial Black', sans-serif"
    : `${family}, sans-serif`;
}

function formatPreviewCopy(value: string, transform: RegionAnnotation["text_transform"]): string {
  if (transform === "uppercase") return value.toUpperCase();
  if (transform === "mocking") {
    let upper = false;
    return value
      .toLowerCase()
      .split("")
      .map((character) => {
        if (!/[a-z]/.test(character)) return character;
        upper = !upper;
        return upper ? character.toUpperCase() : character;
      })
      .join("");
  }
  return value;
}
