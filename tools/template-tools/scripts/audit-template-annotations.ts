import generatedManifest from "../../../packages/shared/src/data/meme-template-manifest.generated.json";
import promotedManifest from "../../../packages/shared/src/data/meme-template-manifest.promoted.json";
import {
  MEME_TEMPLATE_MANIFEST,
  type MemeTemplate,
  type MemeTextTemplateRegion,
} from "@memedrop/shared";

interface Finding {
  severity: "error" | "warn";
  template_id: string;
  region_id?: string;
  message: string;
}

interface AuditResult {
  scope: "verified" | "all";
  checked: number;
  verified: number;
  draft: number;
  disabled: number;
  errors: number;
  warnings: number;
  findings: Finding[];
}

const args = parseArgs(process.argv.slice(2));
const scope = args.scope === "all" ? "all" : "verified";

function main() {
  const allTemplates = [
    ...MEME_TEMPLATE_MANIFEST.templates,
    ...(promotedManifest.templates as MemeTemplate[]),
    ...(generatedManifest.templates as MemeTemplate[]),
  ];
  const runtimeTemplates = [
    ...MEME_TEMPLATE_MANIFEST.templates,
    ...(promotedManifest.templates as MemeTemplate[]),
  ];
  const templates =
    scope === "all"
      ? allTemplates
      : runtimeTemplates.filter(
          (template) => template.quality === "verified" && template.supports_overlay
        );
  const findings: Finding[] = [];
  const seenIds = new Map<string, number>();

  for (const template of templates) {
    seenIds.set(template.template_id, (seenIds.get(template.template_id) || 0) + 1);
    auditTemplate(template, findings);
  }

  for (const [templateId, count] of seenIds) {
    if (count > 1) {
      findings.push({
        severity: "warn",
        template_id: templateId,
        message: `duplicate template_id appears ${count} times; verify lookup precedence before promotion`,
      });
    }
  }

  const result: AuditResult = {
    scope,
    checked: templates.length,
    verified: templates.filter((template) => template.quality === "verified").length,
    draft: templates.filter((template) => template.quality === "draft").length,
    disabled: templates.filter((template) => template.quality === "disabled").length,
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warn").length,
    findings,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }

  const maxWarnings = args["max-warnings"] === undefined
    ? Number.POSITIVE_INFINITY
    : Number(args["max-warnings"]);
  if (!Number.isFinite(maxWarnings) && args["max-warnings"] !== undefined) {
    throw new Error("--max-warnings must be a non-negative number");
  }
  if (maxWarnings < 0) {
    throw new Error("--max-warnings must be a non-negative number");
  }
  if (result.errors > 0 || result.warnings > maxWarnings) {
    process.exitCode = 1;
  }
}

function auditTemplate(template: MemeTemplate, findings: Finding[]) {
  if (!template.template_id.trim()) {
    findings.push({
      severity: "error",
      template_id: "(missing)",
      message: "missing template_id",
    });
  }

  if (!template.supports_overlay) return;

  if (template.quality === "draft") {
    findings.push({
      severity: "warn",
      template_id: template.template_id,
      message: "draft template is excluded from runtime unless MEMEDROP_USE_DRAFT_TEMPLATES=true",
    });
  }

  if (template.regions.length === 0) {
    findings.push({
      severity: "error",
      template_id: template.template_id,
      message: "overlay template has no regions",
    });
  }

  for (const region of template.regions) {
    auditRegion(template, region, findings);
  }

  auditRegionOverlap(template, findings);
  auditGuidanceExamples(template, findings);
}

function auditRegion(
  template: MemeTemplate,
  region: MemeTextTemplateRegion,
  findings: Finding[]
) {
  const typography = region as unknown as Record<string, unknown>;
  const fontTypography = region.font as Record<string, unknown>;
  const add = (severity: Finding["severity"], message: string) => {
    findings.push({
      severity,
      template_id: template.template_id,
      region_id: region.id,
      message,
    });
  };

  if (!region.id.trim()) add("error", "missing region id");
  if (region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0) {
    add("error", "region has invalid normalized geometry");
  }
  if (region.x + region.width > 1 || region.y + region.height > 1) {
    add("error", "region extends outside image bounds");
  }
  if (region.max_lines < 1 || region.max_lines > 6) {
    add("warn", `unusual max_lines=${region.max_lines}`);
  }
  if (region.max_chars < 4) {
    add("warn", `max_chars=${region.max_chars} may be too restrictive`);
  }
  if (region.max_chars > 42 && region.width < 0.45) {
    add("warn", `max_chars=${region.max_chars} is high for a narrow region`);
  }
  const paddingRatio = numberOrDefault(typography.padding_ratio, 0.055);
  if (paddingRatio < 0 || paddingRatio > 0.2) {
    add("error", `padding_ratio=${paddingRatio} must be between 0 and 0.2`);
  }
  const textTransform = stringOrDefault(typography.text_transform, "uppercase");
  if (!["uppercase", "none", "mocking"].includes(textTransform)) {
    add("error", `unsupported text_transform=${textTransform}`);
  }
  if (region.font.min_size < 8 || region.font.min_size > region.font.max_size) {
    add("error", "invalid font min/max size");
  }
  if (region.font.max_size > 72) {
    add("warn", `font max_size=${region.font.max_size} may overpower the meme`);
  }
  const family = stringOrDefault(fontTypography.family, "Impact");
  if (!["Impact", "Anton", "Inter"].includes(family)) {
    add("error", `unsupported font.family=${family}`);
  }
  const rawWeight = fontTypography.weight;
  const weight = numberOrDefault(rawWeight, family === "Anton" ? 400 : 900);
  if (![400, 700, 900].includes(weight)) {
    add("error", `unsupported font.weight=${weight}`);
  }
  if (family === "Anton" && rawWeight !== undefined && weight !== 400) {
    add("error", "Anton must use its bundled 400 weight");
  }
  for (const [field, value] of [
    ["fill_color", stringOrDefault(fontTypography.fill_color, "#FFFFFF")],
    ["stroke_color", stringOrDefault(fontTypography.stroke_color, "#000000")],
  ] as const) {
    if (!/^#[0-9a-f]{6}$/i.test(value)) {
      add("error", `font.${field} must be #RRGGBB`);
    }
  }
  const strokeRatio = numberOrDefault(fontTypography.stroke_ratio, 0.12);
  if (strokeRatio < 0 || strokeRatio > 0.25) {
    add("error", `stroke_ratio=${strokeRatio} must be between 0 and 0.25`);
  }
  const lineHeightRatio = numberOrDefault(fontTypography.line_height_ratio, 1.08);
  if (lineHeightRatio < 0.8 || lineHeightRatio > 1.5) {
    add("error", `line_height_ratio=${lineHeightRatio} must be between 0.8 and 1.5`);
  }

  const capacity = estimateRegionCapacity(region);
  if (capacity < region.max_chars * 0.75) {
    add(
      "warn",
      `estimated visual capacity ${Math.floor(capacity)} chars is lower than max_chars=${region.max_chars}`
    );
  }
}

function auditRegionOverlap(template: MemeTemplate, findings: Finding[]) {
  for (let i = 0; i < template.regions.length; i += 1) {
    for (let j = i + 1; j < template.regions.length; j += 1) {
      const a = template.regions[i];
      const b = template.regions[j];
      const overlap = intersectionArea(a, b);
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      if (smaller > 0 && overlap / smaller > 0.2) {
        findings.push({
          severity: "warn",
          template_id: template.template_id,
          message: `regions ${a.id} and ${b.id} overlap by ${Math.round((overlap / smaller) * 100)}% of the smaller region`,
        });
      }
    }
  }
}

function auditGuidanceExamples(template: MemeTemplate, findings: Finding[]) {
  const regions = new Map(template.regions.map((region) => [region.id, region]));

  if (!template.caption_guidance.pattern.trim()) {
    findings.push({
      severity: "warn",
      template_id: template.template_id,
      message: "missing caption guidance pattern",
    });
  }

  if (template.caption_guidance.good_examples.length < 2) {
    findings.push({
      severity: "warn",
      template_id: template.template_id,
      message: `needs two reviewed good examples; found ${template.caption_guidance.good_examples.length}`,
    });
  }
  if (template.caption_guidance.bad_examples.length < 1) {
    findings.push({
      severity: "warn",
      template_id: template.template_id,
      message: "needs a reviewed bad example for contrastive caption guidance",
    });
  }

  for (const [exampleIndex, example] of template.caption_guidance.good_examples.entries()) {
    for (const regionId of regions.keys()) {
      const value = example[regionId];
      if (typeof value !== "string" || !value.trim()) {
        findings.push({
          severity: "warn",
          template_id: template.template_id,
          region_id: regionId,
          message: `good example ${exampleIndex + 1} is missing required region copy`,
        });
      }
    }
    for (const [regionId, text] of Object.entries(example)) {
      const region = regions.get(regionId);
      if (!region) {
        findings.push({
          severity: "error",
          template_id: template.template_id,
          region_id: regionId,
          message: `good example ${exampleIndex + 1} references unknown region`,
        });
        continue;
      }

      const fit = estimateTextFit(region, String(text));
      if (String(text).length > region.max_chars) {
        findings.push({
          severity: "error",
          template_id: template.template_id,
          region_id: region.id,
          message: `good example ${exampleIndex + 1} exceeds max_chars`,
        });
      }
      if (fit.truncated || fit.tooSmall) {
        findings.push({
          severity: "warn",
          template_id: template.template_id,
          region_id: region.id,
          message: `good example ${exampleIndex + 1} risks poor fit: ${fit.reason}`,
        });
      }
    }
  }
}

function estimateRegionCapacity(region: MemeTextTemplateRegion): number {
  const widthPx = region.width * 1000;
  const heightPx = region.height * 833;
  const typography = region as unknown as Record<string, unknown>;
  const fontTypography = region.font as Record<string, unknown>;
  const padding = resolvePadding(widthPx, heightPx, typography.padding_ratio);
  const safeWidth = Math.max(8, widthPx - padding * 2);
  const safeHeight = Math.max(8, heightPx - padding * 2);
  const lineHeight = numberOrDefault(fontTypography.line_height_ratio, 1.08);
  const lineCount = Math.max(1, Math.min(region.max_lines, Math.floor(safeHeight / (region.font.min_size * lineHeight))));
  const charsPerLine = safeWidth / (region.font.min_size * 0.62);
  return lineCount * charsPerLine;
}

function estimateTextFit(region: MemeTextTemplateRegion, rawText: string) {
  const typography = region as unknown as Record<string, unknown>;
  const fontTypography = region.font as Record<string, unknown>;
  const text = transformForFit(rawText.trim(), stringOrDefault(typography.text_transform, "uppercase"));
  const words = text.split(/\s+/).filter(Boolean);
  const widthPx = region.width * 1000;
  const heightPx = region.height * 833;
  const padding = resolvePadding(widthPx, heightPx, typography.padding_ratio);
  const safeWidth = Math.max(8, widthPx - padding * 2);
  const safeHeight = Math.max(8, heightPx - padding * 2);
  let fontSize = region.font.max_size;
  let lines = wrapApproxLines(words, safeWidth, fontSize, region.max_lines);

  while (
    fontSize - 0.5 >= region.font.min_size &&
    (lines.length * fontSize * numberOrDefault(fontTypography.line_height_ratio, 1.08) > safeHeight ||
      lines.some((line) => approximateImpactWidth(line, fontSize) > safeWidth))
  ) {
    fontSize -= 0.5;
    lines = wrapApproxLines(words, safeWidth, fontSize, region.max_lines);
  }

  const naturalLines = wrapApproxLines(words, safeWidth, fontSize, Number.POSITIVE_INFINITY);
  const truncated = naturalLines.length > region.max_lines;
  const tooSmall = fontSize <= region.font.min_size + 0.5 && (text.length > 14 || words.length > 3);
  const reason = [
    truncated ? "truncates" : "",
    tooSmall ? `falls to ${fontSize}px` : "",
  ].filter(Boolean).join(", ");

  return { truncated, tooSmall, reason: reason || "ok" };
}

function transformForFit(text: string, transform: string): string {
  if (transform === "none") return text;
  if (transform === "mocking") {
    let upper = false;
    return [...text.toLowerCase()]
      .map((char) => {
        if (!/[a-z]/.test(char)) return char;
        upper = !upper;
        return upper ? char.toUpperCase() : char;
      })
      .join("");
  }
  return text.toUpperCase();
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function resolvePadding(width: number, height: number, value: unknown): number {
  const ratio = Math.min(0.2, Math.max(0, numberOrDefault(value, 0.055)));
  return ratio === 0 ? 0 : Math.max(4, Math.min(width, height) * ratio);
}

function wrapApproxLines(words: string[], maxWidth: number, fontSize: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (approximateImpactWidth(test, fontSize) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  return lines.slice(0, Math.max(1, maxLines));
}

function approximateImpactWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (char === " ") units += 0.32;
    else if (/[ilI1|]/.test(char)) units += 0.32;
    else if (/[mwMW]/.test(char)) units += 0.92;
    else if (/[A-Z0-9]/.test(char)) units += 0.66;
    else units += 0.58;
  }
  return units * fontSize;
}

function intersectionArea(a: MemeTextTemplateRegion, b: MemeTextTemplateRegion): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

function parseArgs(rawArgs: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function printReport(result: AuditResult) {
  console.log(
    `MemeDrop template annotation audit (${result.scope}): checked=${result.checked} verified=${result.verified} draft=${result.draft} disabled=${result.disabled} errors=${result.errors} warnings=${result.warnings}`
  );

  const grouped = result.findings.slice(0, 80);
  for (const finding of grouped) {
    const region = finding.region_id ? `:${finding.region_id}` : "";
    console.log(`${finding.severity.toUpperCase()} ${finding.template_id}${region} - ${finding.message}`);
  }

  if (result.findings.length > grouped.length) {
    console.log(`... ${result.findings.length - grouped.length} more findings omitted; use --json for full output`);
  }
}

main();
