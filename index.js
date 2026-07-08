import express from 'express';
import dotenv from 'dotenv';
// import { db } from './db.js'; // If you want to persist the deployment queue

dotenv.config();
const app = express();
app.use(express.json());

// A simple in-memory queue to hold commits waiting for approval
let pendingDeployments = [];

// 1. RECEIVE FROM GITHUB
// This endpoint listens to GitHub Webhooks (e.g., 'push' or 'pull_request' events)
app.post('/webhooks/github', (req, res) => {
    const repoName = req.body.repository?.name;
    const commitMessage = req.body.head_commit?.message;
    const commitId = req.body.head_commit?.id;

    if (!repoName) return res.status(400).send('Invalid webhook payload');

    // Instead of deploying immediately, we hold it in the middleman queue
    pendingDeployments.push({
        id: commitId || Date.now().toString(),
        repo: repoName,
        message: commitMessage || 'No commit message',
        status: 'pending'
    });

    console.log(`[index] Intercepted push to ${repoName}. Holding for approval.`);
    res.status(202).send('Webhook intercepted and queued.');
});

// 2. DASHBOARD API
// This serves the data to your layout rows (repo-here | production-here)
app.get('/api/queue', (req, res) => {
    res.json(pendingDeployments);
});

// 3. APPROVE & DEPLOY TO RAILWAY
// This endpoint fires when you click "Approve Update" on your dashboard
app.post('/api/deploy/:id', async (req, res) => {
    const { id } = req.params;
    const deployment = pendingDeployments.find(d => d.id === id);

    if (!deployment) return res.status(404).send('Deployment not found in queue');

    try {
        console.log(`[index] Triggering Railway deployment for ${deployment.repo}...`);

        // Triggering Railway's API (Example using their Webhook Trigger URL)
        // Alternatively, use Railway's GraphQL API to trigger a specific deployment ID
        const railwayTriggerUrl = process.env.RAILWAY_DEPLOY_WEBHOOK_URL;
        
        const response = await fetch(railwayTriggerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            deployment.status = 'approved';
            // Remove from active queue or mark as deployed
            pendingDeployments = pendingDeployments.filter(d => d.id !== id);
            
            return res.json({ success: true, message: 'Deployment forwarded to Railway!' });
        } else {
            throw new Error('Railway API responded with an error');
        }

    } catch (error) {
        console.error('[index] Failed to deploy to Railway:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[index] Middleman gateway listening on port ${PORT}`);
});
