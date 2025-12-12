import React, { useEffect, useState } from "react";

type JobStatus = {
  jobId: string;
  status: string;
  progress: number;
  processed: number;
  total: number;
  resultUrls: (string | null)[] | null;
  error: string | null;
};

export default function App() {
  const [health, setHealth] = useState<{ status: string; checks: any } | null>(
    null
  );
  const [fileIds, setFileIds] = useState("70000,70001,70002");
  const [initiating, setInitiating] = useState(false);
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedJob, setSelectedJob] = useState<JobStatus | null>(null);
  const [polling, setPolling] = useState(false);

  // Auto-refresh health every 5 seconds
  useEffect(() => {
    const refreshHealth = () => {
      fetch("/health")
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => setHealth(null));
    };
    refreshHealth();
    const iv = setInterval(refreshHealth, 5000);
    return () => clearInterval(iv);
  }, []);

  // Initiate new download job
  const handleInitiateDownload = async () => {
    setInitiating(true);
    try {
      const ids = fileIds
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));

      const res = await fetch("/v1/download/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: ids }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const newJob = (await res.json()) as JobStatus;

      setJobs((prev) => [newJob, ...prev.slice(0, 9)]);
      setSelectedJobId(newJob.jobId);
      setSelectedJob(newJob);
      setPolling(true);
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInitiating(false);
    }
  };

  // Poll selected job status
  useEffect(() => {
    if (!polling || !selectedJobId) return;
    const fetchJob = async () => {
      try {
        const res = await fetch(`/v1/download/status/${selectedJobId}`);
        if (res.status === 404) {
          setSelectedJob(null);
          return;
        }
        const job = (await res.json()) as JobStatus;
        setSelectedJob(job);
        setJobs((prev) =>
          prev.map((j) => (j.jobId === selectedJobId ? job : j))
        );

        // Stop polling when job is done
        if (job.status === "ready" || job.status === "failed") {
          setPolling(false);
        }
      } catch (e) {
        console.error("Poll error:", e);
      }
    };

    fetchJob();
    const iv = setInterval(fetchJob, 2500);
    return () => clearInterval(iv);
  }, [polling, selectedJobId]);

  const statusColor = (status: string) => {
    switch (status) {
      case "ready":
        return "#4caf50";
      case "processing":
        return "#2196f3";
      case "failed":
        return "#f44336";
      default:
        return "#ff9800";
    }
  };

  return (
    <div className="container">
      <h1>🚀 Delineate — Observability Dashboard</h1>

      {/* Health Status */}
      <section className="health-section">
        <h2>Service Health</h2>
        {health ? (
          <div className="health-card">
            <div
              className="status-badge"
              style={{
                background: health.status === "healthy" ? "#4caf50" : "#f44336",
              }}
            >
              {health.status.toUpperCase()}
            </div>
            <p>
              Storage: <strong>{health.checks?.storage || "unknown"}</strong>
            </p>
          </div>
        ) : (
          <div className="loading">Fetching health...</div>
        )}
      </section>

      {/* Initiate New Job */}
      <section className="initiate-section">
        <h2>Initiate Download</h2>
        <div className="form">
          <input
            type="text"
            placeholder="File IDs (comma-separated, e.g., 70000,70001,70002)"
            value={fileIds}
            onChange={(e) => setFileIds(e.target.value)}
            disabled={initiating}
          />
          <button onClick={handleInitiateDownload} disabled={initiating}>
            {initiating ? "Creating..." : "Start Download"}
          </button>
        </div>
      </section>

      {/* Job List */}
      <section className="jobs-section">
        <h2>Recent Jobs ({jobs.length})</h2>
        <div className="job-list">
          {jobs.length === 0 ? (
            <div className="empty">No jobs yet. Initiate a download above.</div>
          ) : (
            jobs.map((job) => (
              <div
                key={job.jobId}
                className={`job-item ${selectedJobId === job.jobId ? "selected" : ""}`}
                onClick={() => {
                  setSelectedJobId(job.jobId);
                  setSelectedJob(job);
                  if (job.status !== "ready" && job.status !== "failed") {
                    setPolling(true);
                  }
                }}
              >
                <div className="job-header">
                  <span
                    className="status-dot"
                    style={{ background: statusColor(job.status) }}
                  />
                  <span className="job-status">{job.status}</span>
                  <span className="job-progress">{job.progress}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
                <div className="job-id-small">
                  {job.jobId.substring(0, 8)}...
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Selected Job Details */}
      {selectedJob && (
        <section className="details-section">
          <h2>Job Details</h2>
          <div className="job-details">
            <div className="detail-row">
              <span className="label">Job ID:</span>
              <span className="value">{selectedJob.jobId}</span>
            </div>
            <div className="detail-row">
              <span className="label">Status:</span>
              <span
                className="value"
                style={{ color: statusColor(selectedJob.status) }}
              >
                {selectedJob.status.toUpperCase()}
              </span>
            </div>
            <div className="detail-row">
              <span className="label">Progress:</span>
              <div className="progress-container">
                <div className="progress-large">
                  <div
                    className="progress-fill"
                    style={{ width: `${selectedJob.progress}%` }}
                  />
                </div>
                <span className="percentage">
                  {selectedJob.progress}% ({selectedJob.processed}/
                  {selectedJob.total})
                </span>
              </div>
            </div>

            {selectedJob.resultUrls && selectedJob.resultUrls.length > 0 && (
              <div className="detail-row">
                <span className="label">Result URLs:</span>
                <div className="urls-list">
                  {selectedJob.resultUrls.map((url, i) => (
                    <div key={i} className="url-item">
                      {url ? (
                        <>
                          <span className="url-index">File {i}:</span>
                          <a href={url} target="_blank" rel="noreferrer">
                            Download
                          </a>
                        </>
                      ) : (
                        <>
                          <span className="url-index">File {i}:</span>
                          <span className="unavailable">Not available</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedJob.error && (
              <div className="detail-row error-row">
                <span className="label">Error:</span>
                <span className="error">{selectedJob.error}</span>
              </div>
            )}

            {polling &&
              selectedJob.status !== "ready" &&
              selectedJob.status !== "failed" && (
                <div className="polling-indicator">
                  <span className="pulse">⟳</span> Polling for updates...
                </div>
              )}
          </div>
        </section>
      )}
    </div>
  );
}
