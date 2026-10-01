import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceBoundary, isChunkLoadError } from "../src/hud/WorkspaceBoundary";

describe("optional workspace recovery", () => {
  it("identifies browser module-loading failures without treating all failures as network errors", () => {
    for (const message of ["Failed to fetch dynamically imported module: /assets/method.js", "Loading chunk 5 failed", "Importing a module script failed", "Error loading dynamically imported module"]) {
      expect(isChunkLoadError(new TypeError(message))).toBe(true);
    }
    expect(isChunkLoadError(new Error("Invalid evidence source"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("preserves healthy children", () => {
    const boundary = new WorkspaceBoundary({ children: createElement("div", null, "Retained report") });
    expect(renderToStaticMarkup(createElement("div", null, boundary.render()))).toContain("Retained report");
  });

  it("offers explicit refresh rather than silently reloading or rendering an empty shell", () => {
    let reloads = 0;
    const boundary = new WorkspaceBoundary({ children: null, onReload: () => { reloads++; } });
    boundary.state = WorkspaceBoundary.getDerivedStateFromError(new TypeError("Failed to fetch dynamically imported module: private-debug-value"));
    const markup = renderToStaticMarkup(boundary.render());
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Refresh workspace");
    expect(markup).toContain("Unsaved input edits may be lost");
    expect(markup).not.toContain("private-debug-value");
    expect(reloads).toBe(0);
  });

  it("keeps non-network failures distinct and handles non-Error thrown values safely", () => {
    const boundary = new WorkspaceBoundary({ children: null });
    boundary.state = WorkspaceBoundary.getDerivedStateFromError("untrusted details");
    const markup = renderToStaticMarkup(boundary.render());
    expect(markup).toContain("could not be displayed");
    expect(markup).not.toContain("untrusted details");
  });
});
