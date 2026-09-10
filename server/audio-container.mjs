import { open } from 'node:fs/promises';

export class AudioUploadError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}

const invalid = () => { throw new AudioUploadError('INVALID_AUDIO_CONTAINER', 415,
  'This file is not a complete supported AAC/M4A recording. Use the original saved recording or record again.'); };

// Bounded ISO BMFF/QuickTime structure validation, not an audio decoder. Seek past
// media/sample tables rather than loading audio or trusting MIME/filename/ftyp alone.
export async function validateM4aContainer(filename, expectedSize, signal) {
  const file = await open(filename, 'r');
  let boxCount = 0;
  try {
    const { size } = await file.stat();
    if (size !== expectedSize || size < 32) invalid();
    const read = async (offset, length, end = size) => {
      signal?.throwIfAborted();
      if (length > 4096 || offset < 0 || offset + length > end) invalid();
      const buffer = Buffer.alloc(length);
      const result = await file.read(buffer, 0, length, offset);
      if (result.bytesRead !== length) invalid();
      return buffer;
    };
    const boxes = async (start, end) => {
      const result = [];
      while (start < end) {
        if (++boxCount > 10_000) invalid();
        const header = await read(start, 8, end);
        let length = header.readUInt32BE(0), headerSize = 8;
        if (length === 1) {
          const extended = (await read(start + 8, 8, end)).readBigUInt64BE(0);
          if (extended > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
          length = Number(extended); headerSize = 16;
        } else if (length === 0) length = end - start;
        if (length < headerSize || length > end - start) invalid();
        result.push({ type: header.toString('latin1', 4, 8), start, payload: start + headerSize, end: start + length });
        start += length;
      }
      return result;
    };
    const one = (list, type) => {
      const found = list.filter(box => box.type === type);
      if (found.length !== 1) invalid();
      return found[0];
    };
    const children = box => boxes(box.payload, box.end);
    const top = await boxes(0, size), ftyp = one(top, 'ftyp'), movie = one(top, 'moov');
    if (!top.some(box => box.type === 'mdat' && box.end > box.payload)) invalid();
    const brandBytes = await read(ftyp.payload, ftyp.end - ftyp.payload, ftyp.end);
    if (brandBytes.length < 8 || brandBytes.length % 4) invalid();
    const brands = [brandBytes.toString('latin1', 0, 4)];
    for (let i = 8; i < brandBytes.length; i += 4) brands.push(brandBytes.toString('latin1', i, i + 4));
    if (!brands.some(brand => /^(M4A |isom|iso[2-9]|mp4[12]|qt  )$/.test(brand))) invalid();
    const tracks = (await children(movie)).filter(box => box.type === 'trak');
    if (!tracks.length || tracks.length > 16) invalid();
    let durationMillis = 0;
    for (const track of tracks) {
      const media = one(await children(track), 'mdia'), mediaBoxes = await children(media);
      const handler = one(mediaBoxes, 'hdlr');
      if ((await read(handler.payload, 12, handler.end)).toString('latin1', 8, 12) !== 'soun') invalid();
      const mdhd = one(mediaBoxes, 'mdhd');
      const version = (await read(mdhd.payload, 1, mdhd.end))[0];
      if (version !== 0 && version !== 1) invalid();
      const timing = await read(mdhd.payload, version === 1 ? 32 : 20, mdhd.end);
      const timescale = timing.readUInt32BE(version === 1 ? 20 : 12);
      const duration = version === 1 ? Number(timing.readBigUInt64BE(24)) : timing.readUInt32BE(16);
      if (!timescale || !Number.isSafeInteger(duration) || duration <= 0) invalid();
      durationMillis = Math.max(durationMillis, duration * 1000 / timescale);
      const minf = one(mediaBoxes, 'minf'), stbl = one(await children(minf), 'stbl');
      const stsd = one(await children(stbl), 'stsd');
      const description = await read(stsd.payload, 8, stsd.end);
      const entries = await boxes(stsd.payload + 8, stsd.end);
      if (!entries.length || entries.length > 16 || description.readUInt32BE(4) !== entries.length) invalid();
      for (const entry of entries) {
        if (entry.type !== 'mp4a' || entry.end - entry.payload < 28) invalid();
        const audio = await read(entry.payload, 28, entry.end);
        if (!audio.readUInt16BE(16)) invalid(); // Actual sound sample entry, not an ftyp-only disguise.
      }
    }
    return { container: 'm4a', codec: 'aac', durationMillis };
  } finally { await file.close(); }
}
