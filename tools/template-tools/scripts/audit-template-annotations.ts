import generatedManifest from "../../../shared/src/data/meme-template-manifest.generated.json";
import promotedManifest from "../../../shared/src/data/meme-template-manifest.promoted.json";
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

  if (result.errors > 0) {
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
  if (region.font.min_size < 8 || region.font.min_size > region.font.max_size) {
    add("error", "invalid font min/max size");
  }
  if (region.font.max_size > 72) {
    add("warn", `font max_size=${region.font.max_size} may overpower the meme`);
  }
  if (region.font.stroke_ratio < 0.06 || region.font.stroke_ratio > 0.2) {
    add("warn", `stroke_ratio=${region.font.stroke_ratio} is outside normal Impact range`);
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

  for (const [exampleIndex, example] of template.caption_guidance.good_examples.entries()) {
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
  const padding = Math.max(4, Math.min(widthPx, heightPx) * 0.055);
  const safeWidth = Math.max(8, widthPx - padding * 2);
  const safeHeight = Math.max(8, heightPx - padding * 2);
  const lineCount = Math.max(1, Math.min(region.max_lines, Math.floor(safeHeight / (region.font.min_size * 1.08))));
  const charsPerLine = safeWidth / (region.font.min_size * 0.62);
  return lineCount * charsPerLine;
}

function estimateTextFit(region: MemeTextTemplateRegion, rawText: string) {
  const text = rawText.trim().toUpperCase();
  const words = text.split(/\s+/).filter(Boolean);
  const widthPx = region.width * 1000;
  const heightPx = region.height * 833;
  const padding = Math.max(4, Math.min(widthPx, heightPx) * 0.055);
  const safeWidth = Math.max(8, widthPx - padding * 2);
  const safeHeight = Math.max(8, heightPx - padding * 2);
  let fontSize = region.font.max_size;
  let lines = wrapApproxLines(words, safeWidth, fontSize, region.max_lines);

  while (
    fontSize - 0.5 >= region.font.min_size &&
    (lines.length * fontSize * 1.08 > safeHeight ||
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
