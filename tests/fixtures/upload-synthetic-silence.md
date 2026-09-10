# Synthetic audio upload fixture

`upload-synthetic-silence.m4a` contains ten seconds of digitally generated silence,
44.1 kHz stereo AAC in an M4A container. It contains no person's voice or private audio.

Generated locally with the existing FFmpeg installation:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi -i anullsrc=r=44100:cl=stereo \
  -t 10 -c:a aac -b:a 128k -map_metadata -1 -n upload-synthetic-silence.m4a
```

Upload tests use counting fake providers; they do not submit this file to an AI
provider or claim real transcription/diarization quality. Format validation also
needs the documented physical Expo Go recording check.
