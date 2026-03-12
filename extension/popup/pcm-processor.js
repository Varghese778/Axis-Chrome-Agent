// popup/pcm-processor.js (AudioWorklet)
// Reference pattern: AudioRecorderProcessor with VAD for barge-in

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // VAD parameters
    this.energyThreshold = 0.00125;
    this.speechDuration = 0.2;
    this.silenceDuration = 0.5;

    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.isSpeaking = false;
    this.sampleRate = 16000;
  }

  calculateEnergy(pcmData) {
    let sum = 0;
    for (let i = 0; i < pcmData.length; i++) {
      sum += pcmData[i] * pcmData[i];
    }
    return Math.sqrt(sum / pcmData.length);
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    // VAD — detect speech start for barge-in
    const energy = this.calculateEnergy(input);
    const frameDuration = input.length / this.sampleRate;

    if (energy > this.energyThreshold) {
      this.speechFrames += frameDuration;
      this.silenceFrames = 0;
      if (this.speechFrames > this.speechDuration && !this.isSpeaking) {
        this.isSpeaking = true;
        this.port.postMessage({ type: 'speech_start' });
      }
    } else {
      this.silenceFrames += frameDuration;
      if (this.silenceFrames > this.silenceDuration && this.isSpeaking) {
        this.isSpeaking = false;
        this.speechFrames = 0;
      }
    }

    // Convert float32 to int16 PCM
    const pcm16 = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    this.port.postMessage(
      { type: 'audio_data', buffer: pcm16.buffer },
      [pcm16.buffer]
    );
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
