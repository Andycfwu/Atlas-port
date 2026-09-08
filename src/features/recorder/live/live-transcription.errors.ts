/** UI copy is derived from known failure codes, never raw socket/upstream text. */
export const getLiveTranscriptionUserMessage = (code: string, apiUrl: string | null): string => {
  let endpoint = 'the transcription server';
  try {
    if (apiUrl) endpoint = new URL(apiUrl).host || endpoint;
  } catch { /* Invalid URLs are handled as missing configuration below. */ }

  switch (code) {
    case 'LIVE_API_URL_MISSING':
      return 'The transcription server address is missing or invalid. Set EXPO_PUBLIC_API_URL to your computer’s current Wi-Fi address and reload Expo. You can still save this recording.';
    case 'LIVE_CONNECTION_TIMEOUT':
      return `Live transcription timed out at ${endpoint}. Check that the backend is running, its Wi-Fi address is current, and your iPhone can reach it. Metro connecting does not confirm the transcription connection. Save this recording, then start a new one after reconnecting.`;
    case 'LIVE_CONNECTION_FAILED':
    case 'LIVE_CONNECTION_CLOSED':
      return `The live transcription connection at ${endpoint} failed. Check the backend and your iPhone’s Wi-Fi / Local Network access. Save this recording, then start a new one after reconnecting.`;
    case 'LIVE_CAPTURE_UNAVAILABLE':
    case 'LIVE_STREAM_FORMAT_CHANGED':
      return 'Live microphone streaming is unavailable. Save this recording before restarting the app and trying again. Saved-file transcription remains separate.';
    case 'LIVE_BACKPRESSURE':
      return 'The live connection could not keep up with the microphone. Save this recording, check the network, and start a new recording. Live text has stopped; audio capture is separate.';
    default:
      return 'Live transcript unavailable. After saving, use the recording’s Transcribe action.';
  }
};
