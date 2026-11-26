/**
 * verify-badges.test.ts — badge-system acceptance test.
 *
 * The badge system is the shared <Badge> component in src/lib/badges.tsx. It is
 * the single source of truth for status and priority pills and is rendered by
 * the detail modal, monitoring view, execution history, and create modal.
 *
 * The task card no longer renders badges (status is communicated by the column,
 * priority lives in the detail modal), so this test renders the shared <Badge>
 * component directly — the real source of truth — and verifies the pill
 * pattern, dot centering, and Title Case labels for every status and priority
 * value.
 *
 * Rendered with React.createElement (no JSX) because the headless test loader
 * uses Node's native type-stripping, which does not transform JSX in .ts files.
 */

import "./setup";
import { test } from "node:test";
import assert from "node:assert";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Badge, STATUS_STYLES, PRIORITY_STYLES, statusBadge, priorityBadge } from "../src/lib/badges";

test("Shared Badge component: Title Case, colored dot, flex-centered", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  // Render every status and every priority value through the shared <Badge>.
  const statuses = Object.keys(STATUS_STYLES) as (keyof typeof STATUS_STYLES)[];
  const priorities = Object.keys(PRIORITY_STYLES) as (keyof typeof PRIORITY_STYLES)[];

  flushSync(() => {
    root.render(
      React.createElement(
        "div",
        null,
        ...statuses.map((s) =>
          React.createElement(Badge, { key: s, style: statusBadge(s)!, pulse: s === "running" })
        ),
        ...priorities.map((p) =>
          React.createElement(Badge, { key: p, style: priorityBadge(p) })
        )
      )
    );
  });

  // 1. The shared Badge pill pattern must be present in the DOM.
  const badgePills = container.querySelectorAll("span[class*='flex items-center gap-1.5 rounded-full px-2.5 py-0.5']");
  assert.ok(badgePills.length >= 4, `expected >=4 badge pills (4 priority badges minimum), found ${badgePills.length}`);

  // 2. Every badge pill must contain a dot that is vertically centered (flex items-center).
  let pillsWithDot = 0;
  badgePills.forEach((pill) => {
    const dot = pill.querySelector("span[class*='h-1.5 w-1.5 shrink-0 rounded-full']");
    if (dot) pillsWithDot++;
  });
  assert.strictEqual(pillsWithDot, badgePills.length, "every badge pill must contain a centered dot");

  // 3. Title Case labels must render for every priority value.
  const text = container.textContent ?? "";
  for (const label of ["Low", "Medium", "High", "Critical"]) {
    assert.ok(text.includes(label), `priority label "${label}" must be Title Case in the DOM`);
  }

  // 4. No lowercase raw values may leak into badge text.
  const badgeTexts = Array.from(badgePills).map((p) => p.textContent?.trim() ?? "");
  for (const t of badgeTexts) {
    assert.ok(!/^(low|medium|high|critical|running|failed|completed|pending|queued|cancelled)$/.test(t), `badge text must be Title Case, got "${t}"`);
  }

  console.log(`Badge pills: ${badgePills.length}, all with centered dot: ${pillsWithDot}`);
  console.log(`Sample badge texts: ${badgeTexts.slice(0, 6).join(" | ")}`);

  root.unmount();
  container.remove();
});
