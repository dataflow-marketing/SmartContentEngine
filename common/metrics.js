class Metrics {
  constructor() {
    this.startTime = Date.now();
    this.processedFiles = 0;
    this.failedFiles = 0;
  }

  incrementProcessed() {
    this.processedFiles++;
  }

  incrementFailed() {
    this.failedFiles++;
  }

  getElapsedTime() {
    return Date.now() - this.startTime;
  }

  getMetrics() {
    return {
      processedFiles: this.processedFiles,
      failedFiles: this.failedFiles,
      elapsedTimeMs: this.getElapsedTime()
    };
  }
}

export const metrics = new Metrics();
