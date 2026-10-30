"""On-demand bridge between this Codex conversation and the Worker review API."""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

from migrate_supabase import load_env, open_retry


def settings():
    env = load_env()
    url = env.get("FEEDBACK_REVIEW_URL", "").rstrip("/")
    token = env.get("FEEDBACK_REVIEW_TOKEN", "")
    if not url or not token:
        raise SystemExit("请先在 .env 配置 FEEDBACK_REVIEW_URL 和 FEEDBACK_REVIEW_TOKEN")
    return url, token


def request_json(url, token, path, method="GET", payload=None, timeout=300):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url + path,
        data=data,
        method=method,
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": "Mozilla/5.0 MusicGraph-Codex-Review/1.0"},
    )
    try:
        with open_retry(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:1000]
        raise SystemExit(f"审核接口 HTTP {error.code}: {detail}") from error


def list_reviews(url, token, include_deferred=False):
    suffix = "?include_deferred=true" if include_deferred else ""
    return request_json(url, token, "/api/admin/feedback-reviews" + suffix)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="MusicGraph 对话反馈审核")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("refresh", help="先运行 Agent，再列出尚未处理的审核结果")
    listing = commands.add_parser("list", help="列出已有待审结果")
    listing.add_argument("--include-deferred", action="store_true")
    commands.add_parser("issues", help="列出初审失败、处理中或尚未初审的反馈")
    commands.add_parser("retry-failed", help="重试所有初审失败的反馈")
    group = commands.add_parser("curate-group", help="建立团体、成员及成员间关系")
    group.add_argument("--payload", required=True, help="团体 JSON")
    correction = commands.add_parser("correct-relation", help="修正唯一匹配的已批准 CP 名")
    correction.add_argument("--payload", required=True, help="关系修正 JSON")
    shared = commands.add_parser("curate-shared-musicals", help="为两位演员补充共同参演剧目")
    shared.add_argument("--payload", required=True, help="共同作品 JSON")
    reassignment = commands.add_parser("reassign-relation-actor", help="替换唯一匹配关系中的错误演员")
    reassignment.add_argument("--payload", required=True, help="关系演员修正 JSON")
    recover = commands.add_parser("recover", help="回收一条停滞的 processing 反馈")
    recover.add_argument("id", type=int)
    decision = commands.add_parser("decide", help="批准、拒绝或暂缓一条反馈")
    decision.add_argument("id", type=int)
    decision.add_argument("decision", choices=["approve", "reject", "defer"])
    decision.add_argument("--note", default="")
    decision.add_argument("--changes", default="{}", help="批准前修正字段的 JSON 对象")
    args = parser.parse_args()
    url, token = settings()

    if args.command == "refresh":
        processing = request_json(url, token, "/api/admin/feedback-reviews/run", method="POST", payload={})
        result = {**processing, **list_reviews(url, token)}
    elif args.command == "list":
        result = list_reviews(url, token, args.include_deferred)
    elif args.command == "issues":
        result = request_json(url, token, "/api/admin/feedback-reviews/issues")
    elif args.command == "retry-failed":
        result = request_json(url, token, "/api/admin/feedback-reviews/retry-failed",
                              method="POST", payload={})
    elif args.command == "curate-group":
        try:
            payload = json.loads(args.payload)
        except json.JSONDecodeError as error:
            raise SystemExit("--payload 必须是合法 JSON") from error
        result = request_json(url, token, "/api/admin/feedback-reviews/curate-group",
                              method="POST", payload=payload)
    elif args.command == "correct-relation":
        try:
            payload = json.loads(args.payload)
        except json.JSONDecodeError as error:
            raise SystemExit("--payload 必须是合法 JSON") from error
        result = request_json(url, token, "/api/admin/feedback-reviews/correct-relation",
                              method="POST", payload=payload)
    elif args.command == "curate-shared-musicals":
        try:
            payload = json.loads(args.payload)
        except json.JSONDecodeError as error:
            raise SystemExit("--payload 必须是合法 JSON") from error
        result = request_json(url, token, "/api/admin/feedback-reviews/curate-shared-musicals",
                              method="POST", payload=payload)
    elif args.command == "reassign-relation-actor":
        try:
            payload = json.loads(args.payload)
        except json.JSONDecodeError as error:
            raise SystemExit("--payload 必须是合法 JSON") from error
        result = request_json(url, token, "/api/admin/feedback-reviews/reassign-relation-actor",
                              method="POST", payload=payload)
    elif args.command == "recover":
        result = request_json(url, token, f"/api/admin/feedback-reviews/{args.id}/recover",
                              method="POST", payload={})
    else:
        current = list_reviews(url, token, include_deferred=True)
        review = next((item for item in current.get("reviews", []) if item["id"] == args.id), None)
        if review is None:
            raise SystemExit(f"没有找到可审核的反馈 #{args.id}，请重新检查待审列表")
        try:
            changes = json.loads(args.changes)
        except json.JSONDecodeError as error:
            raise SystemExit("--changes 必须是合法 JSON 对象") from error
        payload = {"decision": args.decision, "revision": review["revision"],
                   "note": args.note, "changes": changes}
        result = request_json(
            url, token, f"/api/admin/feedback-reviews/{args.id}/decision",
            method="POST", payload=payload)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
