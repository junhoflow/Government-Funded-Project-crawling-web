const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const githubToken = Deno.env.get("GITHUB_TRIGGER_TOKEN") || "";
  const githubOwner = Deno.env.get("GITHUB_REPO_OWNER") || "";
  const githubRepo = Deno.env.get("GITHUB_REPO_NAME") || "";
  const workflowId = Deno.env.get("GITHUB_WORKFLOW_ID") || "daily-sync.yml";
  const githubRef = Deno.env.get("GITHUB_REF") || "main";

  if (!githubToken || !githubOwner || !githubRepo) {
    return json(
      {
        error:
          "Edge Function secrets are missing. Set GITHUB_TRIGGER_TOKEN, GITHUB_REPO_OWNER, and GITHUB_REPO_NAME.",
      },
      500,
    );
  }

  const dispatchResponse = await fetch(
    `https://api.github.com/repos/${githubOwner}/${githubRepo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: githubRef,
      }),
    },
  );

  if (!dispatchResponse.ok) {
    return json(
      {
        error: `GitHub workflow dispatch failed: ${dispatchResponse.status}`,
        detail: await dispatchResponse.text(),
      },
      500,
    );
  }

  return json({
    ok: true,
    message: "동기화 요청을 전송했습니다.",
    workflowId,
    ref: githubRef,
  });
});
