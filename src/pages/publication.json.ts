import type { APIRoute } from "astro";

import { loadPublishedMenu } from "../utils/menuContent";

export const prerender = true;

export const GET: APIRoute = async () => {
  const snapshot = await loadPublishedMenu();

  return new Response(JSON.stringify({
    schemaVersion: 1,
    revision: snapshot.content.revision,
    sourceHash: snapshot.sourceHash,
    builtAt: new Date().toISOString(),
  }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
};
