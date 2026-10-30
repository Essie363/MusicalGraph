import { processPendingSubmissions } from "./feedback-agent.mjs";
import { handleReviewApi } from "./review-api.mjs";

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/admin/feedback-reviews")) {
      return handleReviewApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      processPendingSubmissions(env).then((result) => {
        console.log("feedback-agent", JSON.stringify(result));
      }),
    );
  },
};
