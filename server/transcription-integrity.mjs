// Optional header keeps older phone builds compatible. Never infer audio completeness
// from Metro connectivity or a successful HTTP response alone.
export function uploadSizeMatches(expected, received) {
  return expected === undefined || (typeof expected === 'string' && /^\d+$/.test(expected)
    && Number.isSafeInteger(Number(expected)) && Number(expected) === received);
}
export function originalTranscriptionText(response) {
  return typeof response === 'string' ? response : typeof response?.text === 'string' ? response.text : '';
}
