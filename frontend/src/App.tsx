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

type UploadedFile = {
  fileId: number;
  fileName: string;
  uploadedAt: number;
};

export default function App() {
  const [health, setHealth] = useState<{ status: string; checks: any } | null>(
    null
  );

  // Upload section state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Download section state
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

  // Handle file selection for upload
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files) {
      setSelectedFiles(Array.from(files));
      setUploadError(null);
    }
  };

  // Upload files to backend
  const handleUploadFiles = async () => {
    if (selectedFiles.length === 0) {
      setUploadError("Please select at least one file");
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      const res = await fetch("/v1/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Upload failed: ${res.statusText}`);
      }

      const data = await res.json();
      setUploadedFiles((prev) => [...data.files, ...prev]);
      setSelectedFiles([]);
      setFileIds(data.files.map((f: UploadedFile) => f.fileId).join(","));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Initiate new download job
  const handleInitiateDownload = async () => {
    setInitiating(true);
    try {
      const ids = fileIds
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n));

      if (ids.length === 0) {
        alert("Please enter at least one file ID");
        setInitiating(false);
        return;
      }

      const res = await fetch("/v1/download/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: ids }),
      });

      if (!res.ok) {
        throw new Error(`Failed to initiate: ${res.statusText}`);
      }

      const newJob = await res.json();
      setJobs((prev) => [
        {
          jobId: newJob.jobId,
          status: newJob.status,
          progress: 0,
          processed: 0,
          total: newJob.totalFileIds,
          resultUrls: null,
          error: null,
        },
        ...prev.slice(0, 9),
      ]);
      setSelectedJobId(newJob.jobId);
      setPolling(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to initiate job");
    } finally {
      setInitiating(false);
    }
  };

  // Poll for job status
  useEffect(() => {
    if (!polling || !selectedJobId) return;
    const fetchJob = async () => {
      try {
        const res = await fetch(`/v1/download/status/${selectedJobId}`);
        if (!res.ok) return;
        const job = await res.json();
        setSelectedJob(job);
        setJobs((prev) =>
          prev.map((j) => (j.jobId === selectedJobId ? job : j))
        );
        if (job.status === "ready" || job.status === "failed") {
          setPolling(false);
        }
      } catch {
        // Ignore polling errors
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
      case "queued":
        return "#ff9800";
      case "failed":
        return "#f44336";
      default:
        return "#9e9e9e";
    }
  };

  return (
    <div className="container">
      <header>
        <span className="rocket">🚀</span> Delineate Download Dashboard
      </header>

      {/* Service Health */}
      <section className="health-section">
        <h2>Service Health</h2>
        {health ? (
          <div className="health-card">
            <span
              className="health-badge"
              style={{
                background: health.status === "healthy" ? "#4caf50" : "#f44336",
              }}
            >
              {health.status?.toUpperCase() || "UNKNOWN"}
            </span>
            <span className="health-text">
              Storage: <strong>{health.checks?.storage || "unknown"}</strong>
            </span>
          </div>
        ) : (
          <div className="loading">Fetching health...</div>
        )}
      </section>

      {/* File Upload Section */}
      <section className="upload-section">
        <h2>📤 Upload Files</h2>
        <div className="upload-form">
          <input
            type="file"
            multiple
            onChange={handleFileSelect}
            disabled={uploading}
            accept="*"
          />
          <button
            onClick={handleUploadFiles}
            disabled={uploading || selectedFiles.length === 0}
          >
            {uploading ? "Uploading..." : "Upload Files"}
          </button>
        </div>
        {uploadError && <div className="error-message">{uploadError}</div>}
        {uploadedFiles.length > 0 && (
          <div className="uploaded-files">
            <h3>Uploaded Files ({uploadedFiles.length})</h3>
            <div className="files-grid">
              {uploadedFiles.map((file) => (
                <div key={file.fileId} className="file-card">
                  <div className="file-id">ID: {file.fileId}</div>
                  <div className="file-name">{file.fileName}</div>
                  <div className="file-date">
                    {new Date(file.uploadedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Initiate Download Section */}
      <section className="initiate-section">
        <h2>📥 Initiate Download</h2>
        <div className="form">
          <input
            type="text"
            placeholder="File IDs (comma-separated, e.g., 70000,70001,70002)"
            value={fileIds}
            onChange={(e) => {
              const target = e.target as HTMLInputElement;
              setFileIds(target.value);
            }}
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
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            download
                          >
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
              <div className="detail-row">
                <span className="label">Error:</span>
                <span className="error-text">{selectedJob.error}</span>
              </div>
            )}

            {polling && (
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
