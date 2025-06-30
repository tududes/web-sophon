// Job management service for interval captures
export class JobManager {
    constructor() {
        this.jobs = new Map(); // jobId -> job data
        this.domainJobs = new Map(); // domain -> jobId
        this.loadJobs();
    }

    /**
     * Create or update an interval capture job
     * @param {Object} jobData - Job configuration
     * @returns {string} jobId
     */
    async createJob(jobData) {
        const {
            domain,
            url,
            interval,
            tabId,
            status = 'active',
            jobId = null, // For cloud runner jobs
            isCloudJob = false
        } = jobData;

        const existingJobId = this.domainJobs.get(domain);
        if (existingJobId) {
            // Update existing job
            return this.updateJob(existingJobId, jobData);
        }

        const newJobId = jobId || this.generateJobId();
        const job = {
            id: newJobId,
            domain,
            url,
            interval,
            tabId,
            status, // 'active', 'paused', 'stopped', 'error'
            isCloudJob,
            createdAt: new Date().toISOString(),
            lastRun: null,
            runCount: 0,
            errorCount: 0,
            lastError: null
        };

        this.jobs.set(newJobId, job);
        this.domainJobs.set(domain, newJobId);
        await this.saveJobs();

        console.log(`JobManager: Created job ${newJobId} for domain ${domain}`);
        return newJobId;
    }

    /**
     * Update an existing job
     * @param {string} jobId - Job ID
     * @param {Object} updates - Updates to apply
     */
    async updateJob(jobId, updates) {
        const job = this.jobs.get(jobId);
        if (!job) return false;

        Object.assign(job, updates, { updatedAt: new Date().toISOString() });
        await this.saveJobs();
        return true;
    }

    /**
     * Get job by ID
     * @param {string} jobId - Job ID
     * @returns {Object|null} Job data
     */
    getJob(jobId) {
        return this.jobs.get(jobId) || null;
    }

    /**
     * Get job by domain
     * @param {string} domain - Domain name
     * @returns {Object|null} Job data
     */
    getJobByDomain(domain) {
        const jobId = this.domainJobs.get(domain);
        return jobId ? this.jobs.get(jobId) : null;
    }

    /**
     * Get all active jobs (including paused, disconnected, and error jobs for UI display)
     * @returns {Array} Array of job objects
     */
    getActiveJobs() {
        return Array.from(this.jobs.values()).filter(job =>
            job.status === 'active' ||
            job.status === 'paused' ||
            job.status === 'disconnected' ||
            job.status === 'error'
        );
    }

    /**
     * Pause a job
     * @param {string} jobId - Job ID
     */
    async pauseJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job || job.status !== 'active') return false;

        job.status = 'paused';
        job.pausedAt = new Date().toISOString();
        await this.saveJobs();
        return true;
    }

    /**
     * Resume a paused job
     * @param {string} jobId - Job ID
     */
    async resumeJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job || job.status !== 'paused') return false;

        job.status = 'active';
        delete job.pausedAt;
        job.resumedAt = new Date().toISOString();
        await this.saveJobs();
        return true;
    }

    /**
     * Stop and remove a job
     * @param {string} jobId - Job ID
     */
    async deleteJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return false;

        this.jobs.delete(jobId);
        this.domainJobs.delete(job.domain);
        await this.saveJobs();

        console.log(`JobManager: Deleted job ${jobId} for domain ${job.domain}`);
        return true;
    }

    /**
     * Record job execution
     * @param {string} jobId - Job ID
     * @param {boolean} success - Whether the run was successful
     * @param {string} error - Error message if any
     */
    async recordJobRun(jobId, success = true, error = null) {
        const job = this.jobs.get(jobId);
        if (!job) return false;

        job.lastRun = new Date().toISOString();
        job.runCount++;

        if (success) {
            job.lastError = null;
        } else {
            job.errorCount++;
            job.lastError = error;

            // Auto-stop job after too many consecutive errors
            if (job.errorCount >= 5) {
                job.status = 'error';
                console.warn(`JobManager: Stopped job ${jobId} due to repeated errors`);
            }
        }

        await this.saveJobs();
        return true;
    }

    /**
     * Generate unique job ID
     * @returns {string} Job ID
     */
    generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Load jobs from storage
     */
    async loadJobs() {
        try {
            const { intervalJobs = {} } = await chrome.storage.local.get(['intervalJobs']);

            this.jobs.clear();
            this.domainJobs.clear();

            Object.entries(intervalJobs).forEach(([jobId, jobData]) => {
                this.jobs.set(jobId, jobData);
                this.domainJobs.set(jobData.domain, jobId);
            });

            console.log(`JobManager: Loaded ${this.jobs.size} jobs from storage`);
        } catch (error) {
            console.error('JobManager: Error loading jobs:', error);
        }
    }

    /**
     * Save jobs to storage
     */
    async saveJobs() {
        try {
            const intervalJobs = {};
            this.jobs.forEach((job, jobId) => {
                intervalJobs[jobId] = job;
            });

            await chrome.storage.local.set({ intervalJobs });
            console.log(`JobManager: Saved ${this.jobs.size} jobs to storage`);
        } catch (error) {
            console.error('JobManager: Error saving jobs:', error);
        }
    }

    /**
     * Clean up stopped/error jobs older than specified time
     * @param {number} maxAge - Maximum age in milliseconds (default: 24 hours)
     */
    async cleanupOldJobs(maxAge = 24 * 60 * 60 * 1000) {
        const cutoff = new Date(Date.now() - maxAge);
        let cleaned = 0;

        for (const [jobId, job] of this.jobs.entries()) {
            if ((job.status === 'stopped' || job.status === 'error') &&
                new Date(job.updatedAt || job.createdAt) < cutoff) {
                await this.deleteJob(jobId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`JobManager: Cleaned up ${cleaned} old jobs`);
        }
    }

    /**
     * Get job statistics
     * @returns {Object} Job statistics
     */
    getStatistics() {
        const jobs = Array.from(this.jobs.values());
        return {
            total: jobs.length,
            active: jobs.filter(j => j.status === 'active').length,
            paused: jobs.filter(j => j.status === 'paused').length,
            stopped: jobs.filter(j => j.status === 'stopped').length,
            error: jobs.filter(j => j.status === 'error').length,
            cloud: jobs.filter(j => j.isCloudJob).length,
            local: jobs.filter(j => !j.isCloudJob).length
        };
    }
} 