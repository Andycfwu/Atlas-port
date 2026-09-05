# Run with Windows PowerShell (System.Speech). Generates test speech, never records a microphone.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$fixturePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.expo/live-counting.wav'))
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($fixturePath)) | Out-Null
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $speaker.Rate = -2
  $speaker.SetOutputToWaveFile($fixturePath, $format)
  $speaker.Speak('This is an Atlas live transcription test. One, two, three, four, five. Six, seven, eight, nine, ten. Eleven, twelve, thirteen, fourteen, fifteen. Sixteen, seventeen, eighteen, nineteen, twenty. This is the end of the test recording.')
} finally {
  $speaker.Dispose()
}
Write-Output $fixturePath
