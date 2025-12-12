#!/usr/bin/env bash
set -euo pipefail
# Rebuild & test stack script
# Usage: ./rebuild_and_test.sh [HEALTH_URL] [BACKEND_PORT]
# Defaults: HEALTH_URL=http://localhost:3000/health  BACKEND_PORT=3847

HEALTH_URL="${1:-http://localhost:3000/health}"
BACKEND_PORT="${2:-3847}"
S3_MINIO_ENDPOINT="${S3_MINIO_ENDPOINT:-http://localhost:9000}"
S3_BUCKET_NAME="${S3_BUCKET_NAME:-downloads}"
MAX_WAIT_SECONDS=120
SLEEP_INTERVAL=3

echo "Starting rebuild_and_test.sh"
echo "Health URL: $HEALTH_URL"
echo "Backend port assumed: $BACKEND_PORT"
echo

# Helper: detect docker-compose file
find_compose_file() {
  if [ -f "./docker-compose.yml" ]; then
    echo "./docker-compose.yml"
  elif [ -f "./docker-compose.yaml" ]; then
    echo "./docker-compose.yaml"
  elif [ -f "./docker/compose.dev.yml" ]; then
    echo "./docker/compose.dev.yml"
  elif [ -f "./docker/compose.prod.yml" ]; then
    echo "./docker/compose.prod.yml"
  elif [ -d "./docker" ] && ls docker/*compose*.yml 1>/dev/null 2>&1; then
    ls docker/*compose*.yml | head -n1
  else
    echo ""
  fi
}

COMPOSE_FILE="$(find_compose_file)"

if [ -n "$COMPOSE_FILE" ]; then
  echo "Found compose file: $COMPOSE_FILE"
  echo
  echo "Stopping any existing compose stack (if running)..."
  docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans || true

  echo
  echo "Building images (this may take a few minutes)..."
  # Build with no cache to ensure fresh build; remove --no-cache if too slow
  docker compose -f "$COMPOSE_FILE" build --pull --no-cache

  echo
  echo "Starting stack in detached mode..."
  docker compose -f "$COMPOSE_FILE" up -d

else
  echo "No docker-compose file found. Attempting to find Dockerfiles and build images per directory..."
  # Find directories with a Dockerfile and build
  mapfile -t DOCKERFILES < <(find . -maxdepth 3 -type f -iname 'Dockerfile*' | sed 's|^\./||')
  if [ ${#DOCKERFILES[@]} -eq 0 ]; then
    echo "No Dockerfiles found. Aborting."
    exit 1
  fi
  for df in "${DOCKERFILES[@]}"; do
    dir=$(dirname "$df")
    name=$(basename "$dir" | tr '[:upper:]' '[:lower:]')
    echo "Building image for $dir as ${name}:latest"
    docker build --pull --no-cache -t "${name}:latest" "$dir"
  done
  echo "Built images for directories with Dockerfiles. You will need to run containers manually or create a compose file."
fi

echo
echo "Waiting up to $MAX_WAIT_SECONDS seconds for containers to become healthy..."
elapsed=0
while [ $elapsed -lt $MAX_WAIT_SECONDS ]; do
  # show running containers
  docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" | sed -n '1,200p'
  # check if any container reports "(healthy)" in status
  healthy_count=$(docker ps --format "{{.Names}} {{.Status}}" | grep -c "(healthy)" || true)
  if [ "$healthy_count" -gt 0 ]; then
    echo "At least one container reports healthy."
    break
  fi
  sleep $SLEEP_INTERVAL
  elapsed=$((elapsed + SLEEP_INTERVAL))
done

echo
echo "Snapshot of containers (final):"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"

echo
echo "Tailing last 200 lines of logs from backend & gateway (if exist) to show startup output..."
for name in backend gateway api gateway-server server app; do
  if docker ps --format '{{.Names}}' | grep -q "^${name}$"; then
    echo "----- Logs for container: $name -----"
    docker logs --tail 200 "$name" || true
  fi
done

echo
echo "Health endpoint test (will poll until success or timeout)..."
elapsed=0
SUCCESS=0
while [ $elapsed -lt $MAX_WAIT_SECONDS ]; do
  http_code=$(curl -s -o /tmp/health_resp.json -w "%{http_code}" --retry 2 --connect-timeout 5 "$HEALTH_URL" || echo "000")
  if [ "$http_code" = "200" ]; then
    echo "Health endpoint returned 200. Response:"
    cat /tmp/health_resp.json | jq -C . || cat /tmp/health_resp.json
    # check expected JSON fields
    ok=$(jq -r 'select(.status == "healthy") | .checks.storage' /tmp/health_resp.json 2>/dev/null || true)
    if [ "$ok" = "ok" ]; then
      echo "✅ Health endpoint reports storage: ok"
      SUCCESS=1
      break
    else
      echo "⚠️ Health responded 200 but did not report checks.storage == \"ok\"."
      SUCCESS=1
      break
    fi
  else
    echo "Health check returned HTTP $http_code; retrying in $SLEEP_INTERVAL seconds..."
  fi
  sleep $SLEEP_INTERVAL
  elapsed=$((elapsed + SLEEP_INTERVAL))
done

if [ "$SUCCESS" -ne 1 ]; then
  echo "ERROR: Health endpoint did not return success within $MAX_WAIT_SECONDS seconds."
else
  echo "Health check PASSED or returned OK-ish."
fi

echo
echo "S3 / MinIO checks:"
# 1) MinIO readiness endpoint
if curl -s --fail "$S3_MINIO_ENDPOINT/minio/health/ready" > /dev/null 2>&1; then
  echo "✅ MinIO readiness endpoint ($S3_MINIO_ENDPOINT/minio/health/ready) responded OK."
else
  echo "⚠️ MinIO readiness endpoint not reachable or not responding 200. Trying basic GET on endpoint..."
  curl -s -I "$S3_MINIO_ENDPOINT" || true
fi

# 2) Try to HEAD the 'downloads' bucket via HTTP if MinIO anonymous access is on (best-effort)
echo "Attempting HTTP HEAD on bucket path: $S3_MINIO_ENDPOINT/$S3_BUCKET_NAME"
curl -s -I "$S3_MINIO_ENDPOINT/$S3_BUCKET_NAME" || true

# 3) If aws CLI exists, try head-bucket (needs env credentials set)
if command -v aws >/dev/null 2>&1; then
  echo "aws CLI detected. Attempting 'aws s3api head-bucket' (must have AWS env vars configured)"
  if aws s3api head-bucket --bucket "$S3_BUCKET_NAME" 2>/tmp/aws_head_err.txt; then
    echo "✅ aws head-bucket succeeded for bucket: $S3_BUCKET_NAME"
  else
    echo "aws head-bucket failed. Error:"
    cat /tmp/aws_head_err.txt || true
  fi
else
  echo "aws CLI not installed. Skipping authenticated S3 head-bucket test."
fi

echo
echo "Basic endpoint tests (curl):"
echo " - Health: $HEALTH_URL"
curl -sS -o /tmp/last_health.json "$HEALTH_URL" || true
echo " => HTTP code: $(cat /tmp/last_health.json >/dev/null 2>&1; echo $?) (see /tmp/last_health.json contents above)"
if [ -f /tmp/last_health.json ]; then
  echo "Health body preview:"
  head -n 40 /tmp/last_health.json || true
fi

echo
echo "If things failed: review the logs above and check the gateway vs backend routes. Use the x-request-id from HTTP headers if present to search logs."

echo "Rebuild & test script finished."
