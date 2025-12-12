# ARCHITECTURE.md

## Purpose

This document explains the chosen architecture to handle long-running downloads (10–120s per file) in a robust, production-ready way while keeping HTTP request durations short and user experience responsive.

Goals

- Ensure the API never blocks HTTP requests for prolonged processing (avoid proxy timeouts).
- Provide reliable progress reporting to clients.
- Support scalable workers and persistence (Redis/BullMQ + DB) for production.
- Generate presigned download URLs for clients when processing completes.

Summary (one-liner)
Use an asynchronous job-based processing pattern: client initiates a job, server enqueues it, returns a `jobId` immediately; background workers process files and update job state; clients poll `GET /v1/download/status/:jobId` to receive progress and final presigned URLs.

When to use this pattern

- Work durations exceed reasonable HTTP timeouts (e.g., > 10s behind proxies).
- You need progress reporting without holding open HTTP connections.
- You prefer a simpler, robust model over WebSocket/SSE complexity or client-maintained webhooks.

High-level components

- Client (Browser / Mobile / CLI)
- API (Hono Node service)
- Queue (Redis + BullMQ recommended for production; in-memory Map for dev)
- Workers (stateless, multiple instances) that process queued jobs and generate presigned URLs
- Object Storage (S3-compatible: MinIO for local dev, AWS S3 for production)
- Persistence (optional relational DB / NoSQL for audit logs and job history)
- Observability (OpenTelemetry + Jaeger + Sentry)

Sequence Diagram (simplified)

Client -> API: POST /v1/download/initiate { file_ids }
API -> Queue: enqueue(job)
API -> Client: 200 { jobId, status: "queued" }

Worker <- Queue: dequeue job
Worker -> S3: check availability / generate presigned URLs
Worker -> DataStore: update job.progress, resultUrls

Client -> API: GET /v1/download/status/:jobId
API -> DataStore: read job state
API -> Client: { status, progress, resultUrls }

When job.status == "ready": client downloads files using presigned URLs

Job lifecycle and schema

JobRecord (example)

```
{
  jobId: string,
  fileIds: number[],
  status: "queued" | "processing" | "ready" | "failed" | "cancelled",
  progress: number, // 0..100
  processed: number,
  total: number,
  resultUrls: (string | null)[],
  error: string | null,
  createdAt: number,
  updatedAt: number
}
```

- `queued`: job accepted and waiting to be processed
- `processing`: worker has taken the job
- `ready`: all file processing complete; `resultUrls` contains presigned URLs or `null` for missing files
- `failed`: unrecoverable error
- `cancelled`: cancelled by user

Persistence strategy (dev vs production)

- Dev: In-memory Map (current hackathon implementation) — fine for demo and passing E2E
- Prod: Redis + BullMQ for queueing, and a database (Postgres / DynamoDB) for durable job records and audit logs

Worker design and idempotency

- Workers must be idempotent: if a job is retried, resume from `processed` index
- Use Redis locks when claiming jobs to avoid double processing
- Worker steps per file:
  1. Mark job.status = "processing"
  2. For each file from job.processed to job.total:
     - Attempt to fetch object metadata (HEAD) to determine existence and size
     - If present, create presigned URL using `@aws-sdk/s3-request-presigner` or platform equivalent
     - Update `resultUrls[i]`, `processed`, `progress`
     - Persist job progress frequently (every file or every N files)
  3. On completion, mark `status = "ready"`
  4. On error, record `error` and set `status = "failed"`; worker may re-enqueue based on retry policy

Retries and error handling

- Retry transient S3/network errors with exponential backoff (e.g., 3 retries)
- For repeated failures, mark job as `failed` and include helpful `error` message
- Consider dead-letter queue (DLQ) for manual inspection

Scaling and performance

- Scale workers horizontally; each worker is stateless and reads from Redis queue
- Use priority queues for urgent/cost-sensitive jobs
- Use Redis clusters for high throughput
- Monitor queue length to autoscale worker pool

Progress reporting and UX

- Polling pattern (simple, reliable): client calls `GET /v1/download/status/:jobId` every 2–5s
- SSE/WebSocket (optional): for interactive UIs, workers can push progress events via pub/sub or via a WebSocket gateway; requires connection management

Proxy and timeout configuration (practical recommendations)

- Avoid keeping long-lived HTTP requests open. The API returns quickly.
- Nginx example for proxying API (short timeouts; let workers handle long tasks):

```
# Nginx snippet (reverse proxy to API)
proxy_read_timeout 90s;  # short, since API returns quickly
proxy_connect_timeout 5s;
proxy_send_timeout 30s;
client_body_timeout 60s;
send_timeout 60s;
```

- AWS ALB / Application Load Balancer: default idle timeout 60s is fine; API should return under that.

Presigned URL generation (security)

- Generate presigned URLs with short TTL (e.g., 5–15 minutes) to limit exposure
- Use `getSignedUrl(s3Client, new PutObjectCommand(...), { expiresIn: ttlSeconds })` for uploads; `GetObject` for downloads
- For production, use IAM roles and temporary credentials (avoid embedding long-lived keys)

Tracing and observability

- Instrument API and workers with OpenTelemetry and export to Jaeger/OTLP
- Capture errors with Sentry
- Emit metrics: job_processed_count, job_failed_count, job_processing_time, queue_length

API contract (summary)

- `POST /v1/download/initiate` — request: { file_ids: number[] } → response: { jobId, status: "queued", totalFileIds }
- `GET /v1/download/status/:jobId` — response: JobRecord (subset)
- `POST /v1/download/check` — synchronous availability check per file (keeps compatibility)
- `POST /v1/download/start` — legacy blocking path (deprecated; avoid in production)

Frontend integration (React example)

1. POST to `/v1/download/initiate` → get `jobId`
2. show progress UI and poll `/v1/download/status/:jobId` every 2–3s
3. update progress bar based on `progress` and show available `resultUrls` as links
4. when status is `ready`, enable download buttons

Security considerations

- Validate `file_ids` in the API; reject invalid values early
- Rate limit `POST /v1/download/initiate` to prevent queue overload
- Authenticate/authorize who may initiate downloads
- Log events for auditing

Trade-offs: Polling vs Push

- Polling (chosen): Simple, firewall-friendly, reliable, easier to test (E2E), and works with load balancers and CDNs
- Push (WebSocket/SSE): More real-time, but requires connection maintenance, scaling considerations, and runs into proxies and mobile background limitations
- Webhook: Requires client servers and complexity; not suitable for browser clients

Migration plan from in-memory to production

1. Replace in-memory `jobs` Map with persistent store (Redis for queue state, Postgres for job history)
2. Introduce BullMQ workers with named queues
3. Add job persistence and resume support on restarts
4. Harden S3 retries and backoff
5. Add observability dashboards and alerting (Sentry + Jaeger + Prometheus/Grafana)

Appendix: Example Nginx reverse-proxy and client polling snippet

Nginx server block snippet:

```nginx
server {
  listen 80;
  server_name api.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_connect_timeout 5s;
    proxy_send_timeout 30s;
    proxy_read_timeout 90s;
  }
}
```

Client polling (JS) snippet:

```js
async function initiate(files) {
  const res = await fetch("/v1/download/initiate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_ids: files }),
  });
  const { jobId } = await res.json();
  pollStatus(jobId);
}

async function pollStatus(jobId) {
  const interval = setInterval(async () => {
    const r = await fetch(`/v1/download/status/${jobId}`);
    const json = await r.json();
    // update UI
    if (json.status === "ready" || json.status === "failed")
      clearInterval(interval);
  }, 2500);
}
```

---

End of document.
