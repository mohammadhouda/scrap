#!/usr/bin/env bash
# Chaos test: SIGKILL one worker container mid-crawl (no graceful drain, no
# SIGTERM handler — the process just dies) and leave the rest running.
#
# Expected behaviour afterwards:
#   - the remaining workers keep consuming jobs without interruption;
#   - the killed worker's in-flight jobs are detected as stalled by BullMQ
#     (lock expiry, ~30s) and re-queued to a surviving worker;
#   - the crawl run still finishes with pagesDone + pagesFailed == pagesQueued
#     (verify in the admin UI or the CrawlRun row — that equality is the
#     "no lost jobs" check);
#   - worst case (worker died exactly between settling a page and decrementing
#     the outstanding counter) the scheduler's stale-run reconciler finalizes
#     the run after CRAWL_STALE_AFTER_MS (default 30 min).
#
# Usage: run a crawl (pnpm --filter @scraper/worker run bench, or the admin
# UI), then while it's in flight:
#   ./scripts/kill-worker.sh          # kill 1 worker
#   ./scripts/kill-worker.sh 2        # kill 2 workers
set -euo pipefail

count="${1:-1}"

mapfile -t workers < <(docker compose ps -q worker)
if [ "${#workers[@]}" -eq 0 ]; then
  echo "no running worker containers — start the stack first:" >&2
  echo "  docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d" >&2
  exit 1
fi

if [ "$count" -ge "${#workers[@]}" ]; then
  echo "refusing to kill $count of ${#workers[@]} workers — at least one must survive" >&2
  exit 1
fi

for victim in "${workers[@]:0:$count}"; do
  name=$(docker inspect --format '{{.Name}}' "$victim" | sed 's|^/||')
  echo "SIGKILL -> $name ($victim)"
  docker kill --signal SIGKILL "$victim" > /dev/null
done

echo
echo "killed $count worker(s); ${#workers[@]} -> $(( ${#workers[@]} - count )) remaining."
echo "watch the queues drain: admin UI at /admin, or 'docker compose logs -f worker'."
echo "stalled jobs from the dead worker re-queue within ~30s (BullMQ lock expiry)."
