# Recall API Integration

This document covers the integration with [Recall](https://recall.network) for submitting verified EigenAI signatures. This enables the agent to maintain a "verified badge" status proving it uses verifiable AI inference.

## Overview

When using EigenAI with wallet signing, every inference produces a cryptographic signature. The Recall integration automatically submits these signatures to the Recall API for verification and badge status tracking.

```
┌─────────────────────────────────────────────────────────────┐
│                    RECALL SUBMISSION FLOW                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Agent makes trading decision via EigenAI                │
│  2. EigenAI returns response + cryptographic signature      │
│  3. Inference stored in local database (eigenai_inferences) │
│  4. Every 15 minutes: submit most recent to Recall API      │
│  5. Recall verifies signature → updates badge status        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

Add these environment variables to your `.env`:

```bash
# Recall API Configuration
RECALL_API_URL=https://api.competitions.recall.network
RECALL_API_KEY=your-agent-api-key
RECALL_COMPETITION_ID=your-competition-uuid
```

| Variable | Description |
|----------|-------------|
| `RECALL_API_URL` | Base URL for the Recall API (no trailing `/api`) |
| `RECALL_API_KEY` | Agent API key for authentication |
| `RECALL_COMPETITION_ID` | Competition UUID the agent is participating in |

## How It Works

### Automatic Submission

When `LLM_PROVIDER=eigenai` is set and Recall is configured, the agent automatically:

1. **Captures verification data** - Every EigenAI response is stored locally with its signature
2. **Submits periodically** - Every 15 minutes, the most recent unsubmitted inference is sent to Recall
3. **Tracks status** - Submissions are marked as submitted to avoid duplicates

### Badge Status

The Recall API tracks your agent's "verified badge" status:

| Metric | Description |
|--------|-------------|
| `isBadgeActive` | Whether the agent has an active EigenAI badge |
| `signaturesLast24h` | Number of verified signatures in the last 24 hours |
| `lastVerifiedAt` | Timestamp of the most recent verified signature |

To maintain an active badge, submit at least one verified signature every 24 hours.

## Database Schema

EigenAI inferences are stored in the `eigenai_inferences` table:

```sql
CREATE TABLE eigenai_inferences (
  id UUID PRIMARY KEY,
  request_prompt TEXT NOT NULL,
  response_model TEXT NOT NULL,
  response_output TEXT NOT NULL,
  signature TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  submitted_to_recall BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP,
  recall_submission_id UUID,
  inferred_at TIMESTAMP DEFAULT NOW()
);
```

## Manual Testing

You can test the integration manually with curl:

```bash
# 1. Get a response from EigenAI
curl -s 'https://eigenai.eigencloud.xyz/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: YOUR_EIGENAI_API_KEY' \
  -d '{
    "model": "qwen3-32b-128k-bf16",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "max_tokens": 64
  }'

# Response includes a "signature" field

# 2. Submit to Recall
curl -s 'https://api.staging.competitions.recall.network/api/eigenai/signatures' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_RECALL_API_KEY' \
  -d '{
    "competitionId": "YOUR_COMPETITION_UUID",
    "requestPrompt": "What is 2+2?",
    "responseModel": "qwen3-32b-128k-bf16",
    "responseOutput": "4",
    "signature": "SIGNATURE_FROM_EIGENAI_RESPONSE"
  }'
```

## API Endpoints

The Recall client supports these endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/eigenai/signatures` | Submit a signature for verification |
| `GET` | `/api/eigenai/badge` | Get badge status for the agent |
| `GET` | `/api/eigenai/submissions` | Get submission history |
| `GET` | `/api/eigenai/competitions/:id/stats` | Get competition-wide stats (public) |

## Code Reference

The Recall integration is implemented in:

```
src/services/recall/
├── types.ts                      # Type definitions
├── recall-client.ts              # HTTP client for Recall API
├── recall-submission.service.ts  # Periodic submission service
└── index.ts                      # Exports
```

### Usage Example

```typescript
import { recallSubmissionService } from './services/recall'

// Start automatic submissions (every 15 minutes)
recallSubmissionService.start()

// Or submit manually
const result = await recallSubmissionService.submitMostRecent()
if (result?.success) {
  console.log(`Submitted: ${result.submissionId}, verified: ${result.verified}`)
}

// Check badge status
const badgeStatus = await recallSubmissionService.getBadgeStatus()
console.log(`Badge active: ${badgeStatus?.data.isBadgeActive}`)

// Stop submissions
recallSubmissionService.stop()
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Not configured" warning | Ensure all three env vars are set: `RECALL_API_URL`, `RECALL_API_KEY`, `RECALL_COMPETITION_ID` |
| Submissions not happening | Verify `LLM_PROVIDER=eigenai` is set |
| Badge not active | Submit at least one verified signature in 24 hours |
| Signature verification fails | Ensure you're capturing the full response from EigenAI |

