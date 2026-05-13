# OpenPaint R2 Storage Security Review

**Date:** 2026-03-27
**Scope:** R2 storage integration, API routes, cloud error handling
**Branch:** `mos-overlay`

## Executive Summary

The R2 storage integration introduces a solid foundation with presigned URLs, key normalization, and structured error handling. However, the API routes lack authentication, input validation, and rate limiting.

**Overall risk: Medium** — storage layer is secure, API layer is not.

## Strengths

- Key normalization prevents path traversal (`..`, `\`)
- Bounded presigned URL expiry (60-3600s)
- Structured error normalization with retryable/requiresRelogin flags
- Same-origin R2 proxy keeps credentials server-side
- Config status without secret leakage
- 503 on unconfigured storage

## Critical Issues

### No Authentication on API Routes
All files in `api/storage/r2/` have no auth verification. Any unauthenticated request can generate upload/download/delete presigned URLs. Attach auth middleware and validate resource ownership.

### No Content-Type Validation on Upload Presign
`contentType` from request body is passed directly to presigned URL. Whitelist allowed types (images only) to prevent stored XSS.

### No Rate Limiting on Presign Endpoints
Attackers could generate thousands of presigned URLs for cost amplification or data exfiltration.

### No Object Key Scoping to User/Project
Object keys from client are not validated against the requesting user's project scope.

### No Audit Logging
No logging of who performed what action on which objects.

## Recommendations

| Priority | Issue | Effort |
|---|---|---|
| Critical | Add auth middleware to all R2 API routes | Medium |
| High | Validate content-type on upload presign | Low |
| High | Rate limit presign endpoints | Medium |
| Medium | Scope object keys to user/project | Medium |
| Medium | Add audit logging | Medium |
