import RealTorchApp from './app/index';
import MinimalRecorderRepro from './diagnostics/minimal-recorder-repro/MinimalRecorderRepro';

const App =
  __DEV__ && process.env.EXPO_PUBLIC_MINIMAL_RECORDER_REPRO === '1'
    ? MinimalRecorderRepro
    : RealTorchApp;

export default App;
