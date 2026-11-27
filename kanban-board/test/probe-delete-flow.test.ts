import "./setup";
import { test } from "node:test";
import { activate } from "../extension.js";

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean, timeout = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (fn()) return true; await sleep(10); }
  return fn();
}
function makeHost() {
  let tasks = [{ id: "t1", title: "Probe task", status: "todo", assignee: "Ada", projectId: "p1", waitingOn: null, tags: [], dueDate: null }];
  let render: any = null;
  const host: any = {
    apiVersion: "1",
    registerPage(id: string, fn: any) { render = fn; return () => { render = null; }; },
    agentServer: {
      request: async (opts: any) => {
        if (opts.method === "GET" && opts.path.startsWith("/api/file/download")) return tasks;
        if (opts.method === "POST" && opts.path.startsWith("/api/file/upload")) {
          const form = opts.body as FormData; const file = form?.get("file") as Blob | null;
          if (file) tasks = JSON.parse(await file.text());
          return {};
        }
        if (opts.path === "/api/agent-profiles") return { profiles: [{ id: "profile-scout", name: "Scout" }] };
        return {};
      },
    },
  };
  return {
    host,
    trigger: () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      render!({ container, path: "/kanban-board" });
      return container;
    },
  };
}
test("probe delete flow", async () => {
  (globalThis as any).FormData = window.FormData;
  localStorage.clear();
  const fixture = makeHost();
  const cleanup = activate(fixture.host);
  const container = fixture.trigger();
  await waitFor(() => container.textContent?.includes("Probe task") ?? false);
  const card = [...container.querySelectorAll<HTMLElement>("[data-task-id]")].find((c) => c.textContent?.includes("Probe task")) as HTMLElement;
  card.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  card.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  await waitFor(() => container.textContent?.includes("Edit Task") ?? false);
  const buttonsBefore = [...container.querySelectorAll("button")].map((b) => b.textContent?.trim());
  console.log("BEFORE:", JSON.stringify(buttonsBefore));
  const delBtn = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Delete");
  console.log("Delete found:", Boolean(delBtn));
  console.log("Has Confirm Delete:", buttonsBefore.includes("Confirm Delete"));
  cleanup();
  container.remove();
});
