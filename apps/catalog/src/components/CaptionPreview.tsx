import { drawMemeTextOverlay } from "@memedrop/shared/overlay-renderer";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { checkVisualQa } from "../api";
import type { TemplateAnnotation, VisualQaAnnotation } from "../types";

type PreviewSource = "example" | "custom";

interface RenderDiagnostic {
  regionId: string;
  text: string;
  lines: string[];
  fontSize: number;
  truncated: boolean;
  overflowed: boolean;
  widthOverflow: boolean;
  heightOverflow: boolean;
  charLimitExceeded: boolean;
}

interface CaptionPreviewProps {
  annotation: TemplateAnnotation;
  imageUrl: string;
  onVisualQaChange: (value: VisualQaAnnotation | null) => void;
}

/** Renders with the same canvas routine used for a generated overlay, never a CSS approximation. */
export function CaptionPreview({ annotation, imageUrl, onVisualQaChange }: CaptionPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRequest = useRef(0);
  const renderRequest = useRef(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [source, setSource] = useState<PreviewSource>("example");
  const [exampleIndex, setExampleIndex] = useState(0);
  const [customCaptions, setCustomCaptions] = useState<Record<string, string>>({});
  const [diagnostics, setDiagnostics] = useState<RenderDiagnostic[]>([]);
  const [rendering, setRendering] = useState(false);
  const [renderedSignature, setRenderedSignature] = useState<string | null>(null);
  const [reviewedExamples, setReviewedExamples] = useState<number[]>(
    annotation.visual_qa?.reviewed_example_indexes ?? [],
  );
  const [qaError, setQaError] = useState<string | null>(null);
  const [checkingQa, setCheckingQa] = useState(false);

  const examples = annotation.caption_guidance.good_examples;
  const reviewSignature = useMemo(
    () => JSON.stringify({ regions: annotation.regions, examples }),
    [annotation.regions, examples],
  );
  const selectedExample = examples[exampleIndex] ?? {};
  const captions = source === "example" ? selectedExample : customCaptions;
  const deferredCaptions = useDeferredValue(captions);
  const overlay = useMemo(
    () => ({
      enabled: true as const,
      style: "impact" as const,
      template_id: annotation.template_id,
      alt_text: `${annotation.name} rendered caption preview`,
      regions: annotation.regions.map((region) => ({ ...region, text: deferredCaptions[region.id] ?? "" })),
    }),
    [annotation.name, annotation.regions, annotation.template_id, deferredCaptions],
  );
  const overlaySignature = useMemo(() => JSON.stringify(overlay.regions), [overlay.regions]);

  useEffect(() => {
    const request = ++imageRequest.current;
    setImage(null);
    setImageError(null);
    setRenderedSignature(null);
    const next = new Image();
    next.onload = () => {
      if (request === imageRequest.current) setImage(next);
    };
    next.onerror = () => {
      if (request === imageRequest.current) setImageError("The source image could not be loaded for a rendered check.");
    };
    next.src = imageUrl;
    return () => {
      if (request === imageRequest.current) next.src = "";
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    const request = ++renderRequest.current;
    setRendering(true);
    setRenderedSignature(null);
    const frame = window.requestAnimationFrame(() => {
      if (request !== renderRequest.current || !canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0);
      const result = drawMemeTextOverlay(context, canvas.width, canvas.height, overlay);
      if (request !== renderRequest.current) return;
      setDiagnostics(result.regions as RenderDiagnostic[]);
      setRenderedSignature(overlaySignature);
      setRendering(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [image, overlay, overlaySignature]);

  useEffect(() => {
    setExampleIndex((index) => Math.min(index, Math.max(0, examples.length - 1)));
  }, [examples.length]);

  // Never let a local checkmark survive a change to the captions it represents.
  useEffect(() => {
    setReviewedExamples(annotation.visual_qa?.reviewed_example_indexes ?? []);
    setQaError(null);
  }, [reviewSignature]);

  const localIssues = diagnostics.filter(hasRenderIssue);
  const reviewedCurrent = source === "example" && reviewedExamples.includes(exampleIndex);
  const canReviewCurrent =
    source === "example" &&
    !rendering &&
    renderedSignature === overlaySignature &&
    !localIssues.length;
  const allExamplesReviewed = examples.length > 0 && examples.every((_, index) => reviewedExamples.includes(index));

  function setCustomCaption(regionId: string, value: string) {
    setSource("custom");
    setCustomCaptions((current) => ({ ...current, [regionId]: value }));
  }

  function toggleCurrentReview() {
    if (!canReviewCurrent) return;
    setQaError(null);
    setReviewedExamples((current) =>
      current.includes(exampleIndex)
        ? current.filter((index) => index !== exampleIndex)
        : [...current, exampleIndex].sort((left, right) => left - right),
    );
  }

  async function recordVisualQa() {
    if (!allExamplesReviewed || localIssues.length || checkingQa) return;
    setCheckingQa(true);
    setQaError(null);
    try {
      const result = await checkVisualQa(annotation);
      if (result.issues.length) {
        setQaError(result.issues.map((issue) => issue.message).join(" "));
        return;
      }
      onVisualQaChange({
        status: "passed",
        render_fingerprint: result.fingerprint,
        reviewed_region_ids: annotation.regions.map((region) => region.id),
        reviewed_example_indexes: reviewedExamples,
        reviewed_at: new Date().toISOString(),
      });
    } catch (error) {
      setQaError(error instanceof Error ? error.message : "The visual QA check could not run.");
    } finally {
      setCheckingQa(false);
    }
  }

  return (
    <div className="caption-preview">
      <div className="render-source-bar">
        <div className="preview-mode-toggle" aria-label="Caption preview source">
          <button className={source === "example" ? "active" : ""} onClick={() => setSource("example")} type="button">
            Good examples
          </button>
          <button className={source === "custom" ? "active" : ""} onClick={() => setSource("custom")} type="button">
            Custom copy
          </button>
        </div>
        {source === "example" && examples.length ? (
          <div className="example-pager">
            {examples.map((_, index) => (
              <button
                aria-label={`Preview good example ${index + 1}`}
                className={exampleIndex === index ? "active" : ""}
                key={index}
                onClick={() => setExampleIndex(index)}
                type="button"
              >
                {index + 1}{reviewedExamples.includes(index) ? " ✓" : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rendered-meme-frame">
        {imageError ? <p className="render-empty error">{imageError}</p> : null}
        {!image && !imageError ? <p className="render-empty">Loading source image…</p> : null}
        {image ? <canvas aria-label="Rendered meme preview" ref={canvasRef} /> : null}
        {rendering ? <span className="rendering-indicator">Rendering…</span> : null}
      </div>

      {source === "custom" ? (
        <div className="custom-copy-grid">
          {annotation.regions.map((region) => (
            <label key={region.id}>
              <span>{region.id.replaceAll("_", " ")}</span>
              <input
                maxLength={region.max_chars * 2}
                onChange={(event) => setCustomCaption(region.id, event.target.value)}
                placeholder={region.role}
                value={customCaptions[region.id] ?? ""}
              />
            </label>
          ))}
        </div>
      ) : !examples.length ? (
        <p className="render-empty compact">Add a good example in Content to start visual QA.</p>
      ) : null}

      <div className="render-diagnostics" aria-live="polite">
        <div className="render-diagnostics-heading">
          <div><span className="section-kicker">Production renderer</span><strong>Per-region diagnostics</strong></div>
          <span className={localIssues.length ? "qa-badge blocked" : "qa-badge clear"}>
            {localIssues.length ? `${localIssues.length} issue${localIssues.length === 1 ? "" : "s"}` : "Clear"}
          </span>
        </div>
        {diagnostics.map((diagnostic) => (
          <div className={hasRenderIssue(diagnostic) ? "diagnostic-row issue" : "diagnostic-row"} key={diagnostic.regionId}>
            <strong>{diagnostic.regionId.replaceAll("_", " ")}</strong>
            <span>{diagnostic.fontSize}px</span>
            <span>{diagnostic.lines.length} line{diagnostic.lines.length === 1 ? "" : "s"}</span>
            <span className={hasRenderIssue(diagnostic) ? "diagnostic-status issue" : "diagnostic-status"}>
              {!diagnostic.text.trim() ? "Missing copy" : diagnostic.truncated || diagnostic.charLimitExceeded ? "Truncated" : diagnostic.overflowed || diagnostic.widthOverflow || diagnostic.heightOverflow ? "Overflow" : "Readable"}
            </span>
          </div>
        ))}
      </div>

      {source === "example" && examples.length ? (
        <div className="qa-actions">
          <button className={reviewedCurrent ? "review-sample done" : "review-sample"} disabled={!canReviewCurrent} onClick={toggleCurrentReview} type="button">
            {reviewedCurrent ? "✓ Sample reviewed" : `Mark example ${exampleIndex + 1} reviewed`}
          </button>
          <button className="record-qa" disabled={!allExamplesReviewed || localIssues.length > 0 || checkingQa} onClick={() => void recordVisualQa()} type="button">
            {checkingQa ? "Verifying…" : "Record clean visual QA"}
          </button>
        </div>
      ) : null}
      <p className="qa-hint">
        {allExamplesReviewed ? "All good examples have been reviewed. Record the server-verified fingerprint to make this QA current." : "Review each good example after checking the rendered output. Custom copy is exploratory and does not count toward approval."}
      </p>
      {qaError ? <p className="qa-error">{qaError}</p> : null}
    </div>
  );
}

function hasRenderIssue(diagnostic: RenderDiagnostic): boolean {
  return !diagnostic.text.trim() || diagnostic.truncated || diagnostic.overflowed || diagnostic.widthOverflow || diagnostic.heightOverflow || diagnostic.charLimitExceeded;
}
