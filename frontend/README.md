# Delineate Observability Dashboard

A real-time observability frontend for monitoring and managing long-running download jobs.

## Features

- **Service Health Monitoring**: Auto-refreshing health status with storage availability checks
- **Job Initiation**: Create new download jobs with custom file IDs
- **Job Tracking**: View recent jobs in a responsive grid with live progress updates
- **Progress Visualization**: Beautiful progress bars and percentage displays
- **Result URLs**: Access presigned download links when jobs complete
- **Error Handling**: Clear error messages and status indicators
- **Auto-polling**: Background polling with automatic stop when job completes

## Quick Start (Local Dev)

```bash
cd frontend
npm install
npm run dev
```

The dashboard will open at `http://localhost:5173`.

**Note**: The frontend expects the API to be running on `http://localhost:3000`. Vite dev server includes a proxy for `/health` and `/v1` endpoints.

## Quick Start (Docker)

```bash
npm run docker:dev
```

All services will start:

- Frontend: http://localhost:5173
- API: http://localhost:3000
- Jaeger traces: http://localhost:16686
- MinIO console: http://localhost:9001

## How to Use

### 1. Check Service Health

The dashboard automatically fetches and displays the service health status every 5 seconds. You'll see:

- **HEALTHY** (green) — All systems operational, storage OK
- **UNHEALTHY** (red) — Service has issues

### 2. Initiate a Download

1. Enter comma-separated file IDs in the "Initiate Download" section
   - Example: `70000,70001,70002`
   - Files must be valid IDs (10000–100000000)

2. Click "Start Download"

3. The job is created immediately and added to the job list

### 3. Monitor Job Progress

- Click any job in the "Recent Jobs" list to view its details
- Progress updates automatically every 2.5 seconds
- See processed count, total files, and current progress percentage

### 4. Download Files

When a job reaches **READY** status:

- Result URLs appear in the job details
- Click "Download" to save each file
- Status shows **UNAVAILABLE** if a file was not found in storage

### 5. Error Handling

If a job fails:

- Status changes to **FAILED** (red)
- Error message appears explaining the issue
- Polling stops automatically

## Architecture

The frontend uses:

- **React 18** with TypeScript for type safety
- **Vite** for ultra-fast hot-reload development and optimized production builds
- **Fetch API** for HTTP communication with zero external dependencies
- **CSS Grid + Flexbox** for responsive, modern layouts

## Build for Production

```bash
npm run build
```

Output will be in the `dist/` directory, ready for deployment.

## Environment & Configuration

The dev server proxies API calls:

- `/health` → `http://localhost:3000/health`
- `/v1/**` → `http://localhost:3000/v1/**`

For production deployments, ensure your frontend and API are on the same origin or configure CORS appropriately.

## Troubleshooting

**Q: Health shows "Loading..." for a long time**

- Ensure the API is running on `http://localhost:3000`
- Check browser DevTools Network tab for failed requests
- Verify CORS is enabled in the API

**Q: Jobs don't progress**

- Check the API container logs: `docker logs delineate-delineate-app-1`
- Ensure MinIO S3 storage is healthy
- Verify Redis is running and accessible

**Q: Can't download files**

- Presigned URLs are only available when job status is **READY**
- Check the API logs if downloads fail

---

**Built for the CUET Micro-Ops Hackathon 2025**
