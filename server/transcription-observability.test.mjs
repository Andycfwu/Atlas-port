import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeOpenAIError,
  normalizeUploadError,
  resolveAtlasTraceId,
  serverErrorLogDetails,
  toSafeErrorResponse,
} from './transcription-observability.mjs';

test('preserves a valid client trace ID', () => {
  const traceId = 'atlas-tx-mobile-12345678';
  assert.equal(resolveAtlasTraceId(traceId), traceId);
});

test('replaces an invalid trace ID with a safe server trace ID', () => {
  const traceId = resolveAtlasTraceId('unsafe trace\nvalue');
  assert.match(traceId, /^atlas-tx-server-[0-9a-f-]+$/);
});

test('classifies oversized Multer uploads', () => {
  const error = normalizeUploadError({
    code: 'LIMIT_FILE_SIZE',
    message: 'File too large',
    name: 'MulterError',
  });
  assert.equal(error.code, 'FILE_TOO_LARGE');
  assert.equal(error.httpStatus, 413);
  assert.equal(error.stage, 'upload_rejected');
});

test('classifies OpenAI authentication errors and retains safe diagnostics', () => {
  const source = Object.assign(new Error('Incorrect API key provided'), {
    code: 'invalid_api_key',
    requestID: 'req_auth_123',
    status: 401,
    type: 'invalid_request_error',
  });
  const error = normalizeOpenAIError(source);
  assert.equal(error.code, 'OPENAI_AUTHENTICATION_FAILED');
  assert.equal(error.openAIStatus, 401);
  assert.equal(error.openAIErrorCode, 'invalid_api_key');
  assert.equal(error.openAIErrorType, 'invalid_request_error');
  assert.equal(error.openAIRequestId, 'req_auth_123');
});

test('classifies OpenAI rate limits and timeouts separately', () => {
  const rateLimit = normalizeOpenAIError(
    Object.assign(new Error('Rate limit reached'), { status: 429 }),
  );
  const timeout = normalizeOpenAIError(
    Object.assign(new Error('Request timed out'), {
      name: 'APIConnectionTimeoutError',
    }),
  );

  assert.equal(rateLimit.code, 'OPENAI_RATE_LIMITED');
  assert.equal(rateLimit.httpStatus, 503);
  assert.equal(timeout.code, 'REQUEST_TIMEOUT');
  assert.equal(timeout.httpStatus, 504);
});

test('safe backend responses contain no upstream diagnostics', () => {
  const error = normalizeOpenAIError(
    Object.assign(new Error('Incorrect API key provided'), {
      code: 'invalid_api_key',
      requestID: 'req_auth_123',
      status: 401,
      type: 'invalid_request_error',
    }),
  );
  const response = toSafeErrorResponse(error, 'atlas-tx-mobile-12345678');

  assert.deepEqual(Object.keys(response).sort(), [
    'code',
    'message',
    'stage',
    'traceId',
  ]);
  assert.equal(response.traceId, 'atlas-tx-mobile-12345678');
  assert.equal(JSON.stringify(response).includes('req_auth_123'), false);
});

test('structured log details redact API keys and local paths', () => {
  const source = Object.assign(
    new Error(
      'Incorrect API key sk-example-secret-value in /private/tmp/upload.m4a',
    ),
    { status: 401 },
  );
  const details = serverErrorLogDetails(normalizeOpenAIError(source));
  const serialized = JSON.stringify(details);

  assert.equal(serialized.includes('sk-example-secret-value'), false);
  assert.equal(serialized.includes('/private/tmp/upload.m4a'), false);
  assert.match(serialized, /REDACTED_API_KEY/);
  assert.match(serialized, /REDACTED_LOCAL_PATH/);
});
